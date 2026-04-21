import type { Response, NextFunction } from 'express';
import { z } from 'zod';
import { query, getClient } from '../config/database';
import type { AuthRequest } from '../types';
import { createError } from '../middleware/errorHandler';

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
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const sess = await client.query<{ id: string }>(
        `INSERT INTO sessions (school_id, created_by, name, academic_year, deadline)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [schoolId, userId, data.name, data.academicYear, data.deadline ?? null]
      );
      const sessionId = sess.rows[0]!.id;
      const r = data.rules ?? {};
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
