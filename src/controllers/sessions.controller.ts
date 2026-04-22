import type { Response, NextFunction } from 'express';
import { z } from 'zod';
import PDFDocument from 'pdfkit';
import { query, getClient } from '../config/database';
import type { AuthRequest } from '../types';
import { createError } from '../middleware/errorHandler';
import { assertCanCreateSession } from '../services/subscription.service';

const sessionSchema = z.object({
  name: z.string().min(2),
  academicYear: z.string().min(4),
  deadline: z.string().datetime().optional(),
  rules: z.object({
    minSlotsPerTeacher: z.number().int().min(1).default(1),
    maxSlotsPerTeacher: z.number().int().min(1).default(20),
    allowContactRequest: z.boolean().default(true),
    notifyDirectorOnSelection: z.boolean().default(true),
    notifyDirectorOnContact: z.boolean().default(true),
    autoRemindAfterDays: z.number().int().min(1).default(3),
  }).optional(),
});

export async function listSessions(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const schoolId = req.user!.schoolId;
    const { rows } = await query(
      `SELECT s.*, sr.min_slots_per_teacher, sr.max_slots_per_teacher,
        (SELECT COUNT(*) FROM time_slots WHERE session_id = s.id) AS total_slots,
        (SELECT COUNT(*) FROM time_slots WHERE session_id = s.id AND status != 'free') AS taken_slots,
        (SELECT COUNT(*) FROM teachers WHERE session_id = s.id) AS total_teachers
       FROM sessions s
       LEFT JOIN session_rules sr ON sr.session_id = s.id
       WHERE s.school_id = $1 ORDER BY s.created_at DESC`,
      [schoolId]
    );
    res.json(rows);
  } catch (err) { next(err); }
}

export async function createSession(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = sessionSchema.parse(req.body);
    const { schoolId, userId } = req.user!;
    if (!schoolId) throw createError('Utilisateur non rattaché à une école', 403);
    await assertCanCreateSession(schoolId);
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const sess = await client.query<{ id: string }>(
        `INSERT INTO sessions (school_id, created_by, name, academic_year, deadline)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [schoolId, userId, data.name, data.academicYear, data.deadline ?? null]
      );
      const sessionId = sess.rows[0]!.id;
      const r = data.rules ?? ({} as any);
      await client.query(
        `INSERT INTO session_rules (session_id, min_slots_per_teacher, max_slots_per_teacher,
          allow_contact_request, notify_director_on_selection, notify_director_on_contact, auto_remind_after_days)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [sessionId, r.minSlotsPerTeacher ?? 1, r.maxSlotsPerTeacher ?? 20,
         r.allowContactRequest ?? true, r.notifyDirectorOnSelection ?? true,
         r.notifyDirectorOnContact ?? true, r.autoRemindAfterDays ?? 3]
      );
      await client.query('COMMIT');
      res.status(201).json({ id: sessionId, ...data });
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  } catch (err) { next(err); }
}

export async function getSession(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const { rows } = await query(
      `SELECT s.*, sr.*,
        (SELECT COUNT(*) FROM time_slots WHERE session_id = s.id) AS total_slots,
        (SELECT COUNT(*) FROM time_slots WHERE session_id = s.id AND status = 'taken') AS taken_slots,
        (SELECT COUNT(*) FROM time_slots WHERE session_id = s.id AND status = 'validated') AS validated_slots,
        (SELECT COUNT(*) FROM teachers WHERE session_id = s.id) AS total_teachers,
        (SELECT COUNT(*) FROM teachers WHERE session_id = s.id AND status != 'pending') AS responded_teachers
       FROM sessions s
       LEFT JOIN session_rules sr ON sr.session_id = s.id
       WHERE s.id = $1 AND s.school_id = $2`,
      [id, req.user!.schoolId]
    );
    if (!rows[0]) throw createError('Session introuvable', 404);
    res.json(rows[0]);
  } catch (err) { next(err); }
}

export async function updateSession(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const data = sessionSchema.partial().parse(req.body);
    await query(
      `UPDATE sessions SET name=COALESCE($1,name), academic_year=COALESCE($2,academic_year),
       deadline=COALESCE($3,deadline), updated_at=NOW() WHERE id=$4 AND school_id=$5`,
      [data.name, data.academicYear, data.deadline, id, req.user!.schoolId]
    );
    res.json({ message: 'Session mise à jour' });
  } catch (err) { next(err); }
}

export async function updateSessionStatus(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const { status } = z.object({ status: z.enum(['draft','open','closed','published']) }).parse(req.body);
    await query(
      `UPDATE sessions SET status=$1, updated_at=NOW() WHERE id=$2 AND school_id=$3`,
      [status, id, req.user!.schoolId]
    );
    res.json({ message: `Session passée en statut "${status}"` });
  } catch (err) { next(err); }
}

export async function deleteSession(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    await query(`DELETE FROM sessions WHERE id=$1 AND school_id=$2`, [id, req.user!.schoolId]);
    res.json({ message: 'Session supprimée' });
  } catch (err) { next(err); }
}

export async function exportSessionPdf(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const include = z.object({
      includeTeacherName: z.coerce.boolean().default(true),
      includeContact: z.coerce.boolean().default(true),
      includeEmail: z.coerce.boolean().default(true),
      includeSubject: z.coerce.boolean().default(true),
    }).parse(req.query);

    const sessionRes = await query<{ name: string; academic_year: string }>(
      `SELECT name, academic_year FROM sessions WHERE id = $1 AND school_id = $2`,
      [id, req.user!.schoolId]
    );
    if (!sessionRes.rows[0]) throw createError('Session introuvable', 404);
    const rows = await query<{
      day_of_week: string; start_time: string; end_time: string; room: string | null;
      teacher_name: string | null; teacher_email: string | null; teacher_phone: string | null; subject_name: string | null;
    }>(
      `SELECT ts.day_of_week, ts.start_time::text, ts.end_time::text, ts.room,
              t.full_name AS teacher_name, t.email AS teacher_email, t.phone AS teacher_phone, sb.name AS subject_name
       FROM time_slots ts
       LEFT JOIN slot_selections ss ON ss.slot_id = ts.id
       LEFT JOIN teachers t ON t.id = ss.teacher_id
       LEFT JOIN subjects sb ON sb.id = ts.subject_id
       WHERE ts.session_id = $1
       ORDER BY ts.day_of_week, ts.start_time`,
      [id]
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="session-${id}.pdf"`);
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.pipe(res);
    doc.fontSize(16).text(`Emploi du temps - ${sessionRes.rows[0].name}`);
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Année scolaire: ${sessionRes.rows[0].academic_year}`);
    doc.moveDown();
    for (const row of rows.rows) {
      const parts = [`${row.day_of_week} ${row.start_time}-${row.end_time}`, row.room ? `Salle ${row.room}` : ''];
      if (include.includeTeacherName && row.teacher_name) parts.push(`Prof: ${row.teacher_name}`);
      if (include.includeContact && row.teacher_phone) parts.push(`Tel: ${row.teacher_phone}`);
      if (include.includeEmail && row.teacher_email) parts.push(`Email: ${row.teacher_email}`);
      if (include.includeSubject && row.subject_name) parts.push(`Matière: ${row.subject_name}`);
      doc.fontSize(9).text(parts.filter(Boolean).join(' | '));
    }
    doc.end();
  } catch (err) {
    next(err);
  }
}
