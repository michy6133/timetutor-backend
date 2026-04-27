import type { Response, NextFunction } from 'express';
import { z } from 'zod';
import { ulid } from 'ulid';
import { query } from '../config/database';
import { env } from '../config/env';
import { sendInvitation, sendReminder } from '../services/email.service';
import { sendWhatsAppNotification } from '../services/notification.service';
import type { AuthRequest, TeacherRequest } from '../types';
import { createError } from '../middleware/errorHandler';
import { assertCanAddTeacher, assertFeatureEnabled } from '../services/subscription.service';

const teacherSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
  subjectIds: z.array(z.string().uuid()).min(1, 'Au moins une matière est requise').max(1, 'Une seule matière est autorisée'),
});

const teacherUpdateSchema = z.object({
  fullName: z.string().min(2).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  subjectIds: z.array(z.string().uuid()).min(1, 'Au moins une matière est requise').max(1, 'Une seule matière est autorisée').optional(),
});

async function assertSubjectsBelongToSchool(subjectIds: string[], schoolId: string): Promise<void> {
  if (!subjectIds.length) throw createError('Une matière est obligatoire', 400);
  const { rows } = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM subjects
     WHERE school_id = $1
       AND id = ANY($2::uuid[])`,
    [schoolId, subjectIds]
  );
  const count = parseInt(rows[0]?.count ?? '0', 10);
  if (count !== subjectIds.length) {
    throw createError('Matière invalide pour cet établissement', 400);
  }
}

export async function listTeachers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { sessionId } = req.params;
    const { rows } = await query(
      `SELECT t.*,
        (SELECT COALESCE(json_agg(json_build_object('id', sb.id, 'name', sb.name) ORDER BY sb.name), '[]'::json)
         FROM subjects sb
         WHERE sb.id = ANY(t.subject_ids)) AS subjects,
        (SELECT COUNT(*) FROM slot_selections WHERE teacher_id = t.id AND session_id = t.session_id) AS slots_selected
       FROM teachers t WHERE t.session_id = $1 ORDER BY t.full_name`,
      [sessionId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

export async function searchSchoolTeachers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const schoolId = req.user!.schoolId;
    if (!schoolId) { res.json([]); return; }
    const q = (req.query['q'] as string | undefined)?.trim() ?? '';
    const like = `%${q}%`;
    const { rows } = await query(
      `SELECT DISTINCT ON (LOWER(t.email))
          t.id, t.full_name, t.email, t.phone, t.status, t.invitation_sent_at, t.session_id,
          s.name AS session_name, s.academic_year, s.status AS session_status,
          (SELECT COUNT(*) FROM slot_selections WHERE teacher_id = t.id AND session_id = t.session_id) AS slots_selected
       FROM teachers t
       JOIN sessions s ON s.id = t.session_id
       WHERE s.school_id = $1
         AND ($2 = '' OR t.full_name ILIKE $3 OR t.email ILIKE $3 OR COALESCE(t.phone,'') ILIKE $3)
       ORDER BY LOWER(t.email), t.invitation_sent_at DESC NULLS LAST
       LIMIT 50`,
      [schoolId, q, like]
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
    await assertSubjectsBelongToSchool(data.subjectIds, req.user!.schoolId!);
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
    if (req.user?.schoolId) await assertFeatureEnabled(req.user.schoolId, 'csvImport');
    const { sessionId } = req.params;
    if (!req.file) throw createError('Fichier CSV requis', 400);

    const { parse } = await import('csv-parse/sync');
    const records = parse(req.file.buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Array<{ full_name?: string; email?: string; phone?: string; matiere?: string; subject?: string }>;

    // Validate that the matiere column is present
    if (records.length > 0 && !('matiere' in records[0]) && !('subject' in records[0])) {
      throw createError('Colonne "matiere" manquante dans le CSV. Format requis : full_name,email,phone,matiere', 400);
    }

    const schoolRes = await query<{ school_id: string }>(
      `SELECT school_id FROM sessions WHERE id=$1`,
      [sessionId]
    );
    const schoolId = schoolRes.rows[0]?.school_id;

    let imported = 0;
    for (const r of records) {
      if (!r.full_name || !r.email) continue;
      const matiereName = r.matiere ?? r.subject ?? '';
      if (!matiereName) continue;

      // Look up subject by name (case-insensitive)
      let subjectId: string | null = null;
      if (schoolId && matiereName) {
        const subRes = await query<{ id: string }>(
          `SELECT id FROM subjects WHERE school_id=$1 AND LOWER(name)=LOWER($2) LIMIT 1`,
          [schoolId, matiereName]
        );
        if (subRes.rows[0]) {
          subjectId = subRes.rows[0].id;
        } else {
          const newSubRes = await query<{ id: string }>(
            `INSERT INTO subjects (school_id, name) VALUES ($1,$2)
             ON CONFLICT (school_id, name) DO UPDATE SET name=EXCLUDED.name
             RETURNING id`,
            [schoolId, matiereName]
          );
          subjectId = newSubRes.rows[0]?.id ?? null;
        }
      }

      await assertCanAddTeacher(sessionId);
      await query(
        `INSERT INTO teachers (session_id, full_name, email, phone, subject_ids)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (session_id, email) DO NOTHING`,
        [sessionId, r.full_name, r.email, r.phone ?? null, subjectId ? [subjectId] : []]
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

export async function updateTeacher(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id, sessionId } = req.params;
    const data = teacherUpdateSchema.parse(req.body);
    if (data.subjectIds) {
      await assertSubjectsBelongToSchool(data.subjectIds, req.user!.schoolId!);
    }
    await query(
      `UPDATE teachers
       SET full_name = COALESCE($1, full_name),
           email = COALESCE($2, email),
           phone = COALESCE($3, phone),
           subject_ids = COALESCE($4, subject_ids),
           updated_at = NOW()
       WHERE id=$5 AND session_id=$6
       AND EXISTS (SELECT 1 FROM sessions s WHERE s.id=$6 AND s.school_id=$7)`,
      [data.fullName, data.email, data.phone, data.subjectIds, id, sessionId, req.user!.schoolId]
    );
    res.json({ message: 'Enseignant mis à jour' });
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

export async function inviteAllTeachers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { sessionId } = req.params;
    const totalRes = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM teachers t
       JOIN sessions s ON s.id = t.session_id
       WHERE t.session_id = $1
         AND s.school_id = $2`,
      [sessionId, req.user!.schoolId]
    );
    const totalTeachers = parseInt(totalRes.rows[0]?.count ?? '0', 10);

    const teachersRes = await query<{ id: string; full_name: string; email: string; phone: string | null }>(
      `SELECT t.id
            , t.full_name
            , t.email
            , t.phone
       FROM teachers t
       JOIN sessions s ON s.id = t.session_id
       WHERE t.session_id = $1
         AND s.school_id = $2
         AND t.invitation_sent_at IS NULL`,
      [sessionId, req.user!.schoolId]
    );

    const sRes = await query<{ name: string; academic_year: string; deadline: Date | null }>(
      `SELECT name, academic_year, deadline FROM sessions WHERE id=$1 AND school_id=$2`,
      [sessionId, req.user!.schoolId]
    );
    const session = sRes.rows[0];
    if (!session) throw createError('Session introuvable', 404);

    let invited = 0;
    let failed = 0;
    for (const teacher of teachersRes.rows) {
      try {
        const token = await generateMagicToken(teacher.id, sessionId);
        const magicLink = `${env.MAGIC_LINK_BASE_URL}/${token}`;
        await sendInvitation(
          { fullName: teacher.full_name, email: teacher.email },
          magicLink,
          { name: session.name, academicYear: session.academic_year, deadline: session.deadline }
        );
        await query(`UPDATE teachers SET invitation_sent_at=NOW() WHERE id=$1`, [teacher.id]);
        if (teacher.phone) {
          await sendWhatsAppNotification(teacher.phone, `TimeTutor: invitation envoyee pour la session ${session.name}.`);
        }
        invited++;
      } catch (err) {
        console.error('[invite-all] échec pour', teacher.email, teacher.id, err);
        failed++;
      }
    }

    res.json({
      invited,
      failed,
      eligible: teachersRes.rows.length,
      totalTeachers,
      alreadyInvited: Math.max(0, totalTeachers - teachersRes.rows.length),
    });
  } catch (err) {
    next(err);
  }
}

export async function myScheduleForTeacher(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userRes = await query<{ email: string }>(`SELECT email FROM users WHERE id=$1`, [req.user!.userId]);
    const email = userRes.rows[0]?.email;
    if (!email) { res.status(404).json({ error: 'Utilisateur introuvable' }); return; }

    const { rows } = await query(
      `SELECT ts.id AS slot_id, ts.day_of_week, ts.start_time::text, ts.end_time::text, ts.room, ts.status,
              sess.id AS session_id, sess.name AS session_name, sess.academic_year,
              sch.name AS school_name,
              sub.name AS subject_name
       FROM teachers t
       JOIN slot_selections ss ON ss.teacher_id = t.id
       JOIN time_slots ts ON ts.id = ss.slot_id
       JOIN sessions sess ON sess.id = ss.session_id
       JOIN schools sch ON sch.id = sess.school_id
       LEFT JOIN subjects sub ON sub.id = ts.subject_id
       WHERE LOWER(TRIM(t.email)) = LOWER(TRIM($1))
       ORDER BY CASE ts.day_of_week
         WHEN 'Lundi' THEN 1 WHEN 'Mardi' THEN 2 WHEN 'Mercredi' THEN 3
         WHEN 'Jeudi' THEN 4 WHEN 'Vendredi' THEN 5 WHEN 'Samedi' THEN 6 ELSE 7 END,
         ts.start_time`,
      [email]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

export async function myScheduleForToken(req: TeacherRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const teacherId = req.teacher?.teacherId;
    if (!teacherId) {
      res.status(401).json({ error: 'Token invalide' });
      return;
    }
    const teacherRes = await query<{ email: string }>(`SELECT email FROM teachers WHERE id=$1`, [teacherId]);
    const email = teacherRes.rows[0]?.email;
    if (!email) {
      res.status(404).json({ error: 'Enseignant introuvable' });
      return;
    }
    const { rows } = await query(
      `SELECT ts.id AS slot_id, ts.day_of_week, ts.start_time::text, ts.end_time::text, ts.room, ts.status,
              sess.id AS session_id, sess.name AS session_name, sess.academic_year,
              sch.name AS school_name,
              sub.name AS subject_name
       FROM teachers t
       JOIN slot_selections ss ON ss.teacher_id = t.id
       JOIN time_slots ts ON ts.id = ss.slot_id
       JOIN sessions sess ON sess.id = ss.session_id
       JOIN schools sch ON sch.id = sess.school_id
       LEFT JOIN subjects sub ON sub.id = ts.subject_id
       WHERE LOWER(TRIM(t.email)) = LOWER(TRIM($1))
       ORDER BY CASE ts.day_of_week
         WHEN 'Lundi' THEN 1 WHEN 'Mardi' THEN 2 WHEN 'Mercredi' THEN 3
         WHEN 'Jeudi' THEN 4 WHEN 'Vendredi' THEN 5 WHEN 'Samedi' THEN 6 ELSE 7 END,
         ts.start_time`,
      [email]
    );
    res.json(rows);
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
      `SELECT t.id AS "id",
          t.session_id AS "sessionId",
          t.status,
          t.invitation_sent_at AS "invitationSentAt",
          t.last_seen_at AS "lastSeenAt",
          (SELECT COUNT(*)::int FROM slot_selections WHERE teacher_id=t.id) AS "slotsSelected",
          s.name AS "sessionName",
          s.academic_year AS "academicYear",
          s.status AS "sessionStatus",
          s.deadline,
          sch.name AS "schoolName",
          sc.name AS "schoolClassName",
          (SELECT token FROM magic_tokens WHERE teacher_id=t.id AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1) AS "magicToken"
       FROM teachers t
       JOIN sessions s ON s.id = t.session_id
       JOIN schools sch ON sch.id = s.school_id
       LEFT JOIN school_classes sc ON sc.id = s.school_class_id
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
    const tr = tRes.rows[0];
    const sr = sRes.rows[0];
    res.json({
      valid: true,
      sessionId: teacher.sessionId,
      teacherId: teacher.teacherId,
      teacher: tr
        ? { fullName: tr.full_name, email: tr.email }
        : null,
      session: sr
        ? { name: sr.name, academicYear: sr.academic_year, status: sr.status }
        : null,
    });
  } catch (err) {
    next(err);
  }
}
