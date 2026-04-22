import type { Response, NextFunction } from 'express';
import { z } from 'zod';
import { ulid } from 'ulid';
import { query } from '../config/database';
import { env } from '../config/env';
import { sendInvitation, sendReminder } from '../services/email.service';
import { sendWhatsAppNotification } from '../services/notification.service';
import type { AuthRequest, TeacherRequest } from '../types';
import { createError } from '../middleware/errorHandler';
import { assertCanAddTeacher } from '../services/subscription.service';

const teacherSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
  subjectIds: z.array(z.string().uuid()).default([]),
});

export async function listTeachers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { sessionId } = req.params;
    const { rows } = await query(
      `SELECT t.*,
        (SELECT COUNT(*) FROM slot_selections WHERE teacher_id = t.id AND session_id = t.session_id) AS slots_selected
       FROM teachers t WHERE t.session_id = $1 ORDER BY t.full_name`,
      [sessionId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

export async function addTeacher(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { sessionId } = req.params;
    const data = teacherSchema.parse(req.body);
    await assertCanAddTeacher(sessionId);
    const { rows } = await query<{ id: string }>(
      `INSERT INTO teachers (session_id, full_name, email, phone, subject_ids)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [sessionId, data.fullName, data.email, data.phone ?? null, data.subjectIds]
    );
    res.status(201).json({ id: rows[0]?.id, ...data });
  } catch (err) {
    next(err);
  }
}

export async function importTeachers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { sessionId } = req.params;
    if (!req.file) throw createError('Fichier CSV requis', 400);

    const { parse } = await import('csv-parse/sync');
    const records = parse(req.file.buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Array<{ full_name?: string; email?: string; phone?: string }>;

    let imported = 0;
    for (const r of records) {
      if (!r.full_name || !r.email) continue;
      await assertCanAddTeacher(sessionId);
      await query(
        `INSERT INTO teachers (session_id, full_name, email, phone)
         VALUES ($1,$2,$3,$4) ON CONFLICT (session_id, email) DO NOTHING`,
        [sessionId, r.full_name, r.email, r.phone ?? null]
      );
      imported++;
    }
    res.json({ imported });
  } catch (err) {
    next(err);
  }
}

export async function removeTeacher(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id, sessionId } = req.params;
    await query(
      `DELETE FROM teachers
       WHERE id=$1 AND session_id=$2
       AND EXISTS (SELECT 1 FROM sessions s WHERE s.id=$2 AND s.school_id=$3)`,
      [id, sessionId, req.user!.schoolId]
    );
    res.json({ message: 'Enseignant supprimé' });
  } catch (err) {
    next(err);
  }
}

async function generateMagicToken(teacherId: string, sessionId: string): Promise<string> {
  const token = ulid();
  const ttlHours = parseInt(env.MAGIC_TOKEN_TTL_HOURS);
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);
  await query(
    `INSERT INTO magic_tokens (teacher_id, session_id, token, expires_at)
     VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [teacherId, sessionId, token, expiresAt]
  );
  return token;
}

export async function inviteTeacher(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { sessionId, id: teacherId } = req.params;
    const tRes = await query<{ full_name: string; email: string; phone: string | null }>(
      `SELECT t.full_name, t.email, t.phone
       FROM teachers t
       JOIN sessions s ON s.id = t.session_id
       WHERE t.id=$1 AND t.session_id=$2 AND s.school_id=$3`,
      [teacherId, sessionId, req.user!.schoolId]
    );
    const teacher = tRes.rows[0];
    if (!teacher) throw createError('Enseignant introuvable', 404);

    const sRes = await query<{ name: string; academic_year: string; deadline: Date | null }>(
      `SELECT name, academic_year, deadline FROM sessions WHERE id=$1 AND school_id=$2`,
      [sessionId, req.user!.schoolId]
    );
    const session = sRes.rows[0];
    if (!session) throw createError('Session introuvable', 404);

    const token = await generateMagicToken(teacherId, sessionId);
    const magicLink = `${env.MAGIC_LINK_BASE_URL}/${token}`;

    await sendInvitation(
      { fullName: teacher.full_name, email: teacher.email },
      magicLink,
      { name: session.name, academicYear: session.academic_year, deadline: session.deadline }
    );

    await query(
      `UPDATE teachers SET invitation_sent_at=NOW() WHERE id=$1`, [teacherId]
    );
    if (teacher.phone) {
      await sendWhatsAppNotification(teacher.phone, `TimeTutor: invitation envoyée pour la session ${session.name}.`);
    }
    res.json({ message: 'Invitation envoyée' });
  } catch (err) {
    next(err);
  }
}

export async function remindTeacher(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { sessionId, id: teacherId } = req.params;
    const tRes = await query<{ full_name: string; email: string; phone: string | null }>(
      `SELECT t.full_name, t.email, t.phone
       FROM teachers t
       JOIN sessions s ON s.id = t.session_id
       WHERE t.id=$1 AND t.session_id=$2 AND s.school_id=$3`,
      [teacherId, sessionId, req.user!.schoolId]
    );
    const teacher = tRes.rows[0];
    if (!teacher) throw createError('Enseignant introuvable', 404);

    const sRes = await query<{ name: string; academic_year: string; deadline: Date | null }>(
      `SELECT name, academic_year, deadline FROM sessions WHERE id=$1 AND school_id=$2`,
      [sessionId, req.user!.schoolId]
    );
    const session = sRes.rows[0];
    if (!session) throw createError('Session introuvable', 404);

    // Reuse existing non-expired token or generate new one
    const tokRes = await query<{ token: string }>(
      `SELECT token FROM magic_tokens WHERE teacher_id=$1 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1`,
      [teacherId]
    );
    const token = tokRes.rows[0]?.token ?? await generateMagicToken(teacherId, sessionId);
    const magicLink = `${env.MAGIC_LINK_BASE_URL}/${token}`;

    await sendReminder(
      { fullName: teacher.full_name, email: teacher.email },
      { name: session.name, academicYear: session.academic_year, deadline: session.deadline },
      magicLink
    );
    if (teacher.phone) {
      await sendWhatsAppNotification(teacher.phone, `TimeTutor: rappel pour compléter vos choix de créneaux (${session.name}).`);
    }
    res.json({ message: 'Relance envoyée' });
  } catch (err) {
    next(err);
  }
}

export async function mySessionsForTeacher(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userRes = await query<{ email: string }>(`SELECT email FROM users WHERE id=$1`, [req.user!.userId]);
    const email = userRes.rows[0]?.email;
    if (!email) { res.status(404).json({ error: 'Utilisateur introuvable' }); return; }

    const { rows } = await query(
      `SELECT t.id, t.session_id, t.status, t.invitation_sent_at, t.last_seen_at,
          (SELECT COUNT(*) FROM slot_selections WHERE teacher_id=t.id) AS slots_selected,
          s.name AS session_name, s.academic_year, s.status AS session_status, s.deadline,
          sch.name AS school_name,
          (SELECT token FROM magic_tokens WHERE teacher_id=t.id AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1) AS magic_token
       FROM teachers t
       JOIN sessions s ON s.id = t.session_id
       JOIN schools sch ON sch.id = s.school_id
       WHERE t.email = $1
       ORDER BY t.invitation_sent_at DESC NULLS LAST`,
      [email]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

export async function verifyMagicToken(req: TeacherRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { teacher } = req;
    if (!teacher) { res.status(401).json({ error: 'Token invalide' }); return; }

    const tRes = await query<{ full_name: string; email: string }>(
      `SELECT full_name, email FROM teachers WHERE id=$1`, [teacher.teacherId]
    );
    const sRes = await query<{ name: string; academic_year: string; status: string }>(
      `SELECT name, academic_year, status FROM sessions WHERE id=$1`, [teacher.sessionId]
    );
    res.json({
      valid: true,
      sessionId: teacher.sessionId,
      teacherId: teacher.teacherId,
      teacher: tRes.rows[0],
      session: sRes.rows[0],
    });
  } catch (err) {
    next(err);
  }
}
