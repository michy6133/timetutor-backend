import type { Response, NextFunction } from 'express';
import { z } from 'zod';
import { ulid } from 'ulid';
import { query } from '../config/database';
import type { AuthRequest } from '../types';
import { createError } from '../middleware/errorHandler';

const rosterSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  phone: z.string().nullable().optional(),
});

export async function listRoster(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT id, full_name AS "fullName", email, phone, created_at AS "createdAt"
       FROM school_roster WHERE school_id=$1 ORDER BY full_name`,
      [req.user!.schoolId]
    );
    res.json(rows);
  } catch (err) { next(err); }
}

export async function addToRoster(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = rosterSchema.parse(req.body);
    const id = ulid();
    const { rows } = await query(
      `INSERT INTO school_roster (id, school_id, full_name, email, phone)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (school_id, email) DO UPDATE SET full_name=$3, phone=$5, updated_at=NOW()
       RETURNING id, full_name AS "fullName", email, phone, created_at AS "createdAt"`,
      [id, req.user!.schoolId, data.fullName, data.email, data.phone ?? null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
}

export async function updateRoster(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const data = rosterSchema.partial().parse(req.body);
    const { rows } = await query(
      `UPDATE school_roster
       SET full_name=COALESCE($1,full_name), email=COALESCE($2,email), phone=COALESCE($3,phone), updated_at=NOW()
       WHERE id=$4 AND school_id=$5
       RETURNING id, full_name AS "fullName", email, phone`,
      [data.fullName, data.email, data.phone, id, req.user!.schoolId]
    );
    if (!rows[0]) throw createError('Introuvable', 404);
    res.json(rows[0]);
  } catch (err) { next(err); }
}

export async function deleteFromRoster(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    await query(`DELETE FROM school_roster WHERE id=$1 AND school_id=$2`, [id, req.user!.schoolId]);
    res.json({ message: 'Supprimé' });
  } catch (err) { next(err); }
}

export async function importRosterCsv(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) throw createError('Fichier CSV requis', 400);
    const { parse } = await import('csv-parse/sync');
    const records = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true }) as Array<{
      full_name?: string; email?: string; phone?: string;
    }>;
    let imported = 0;
    for (const r of records) {
      if (!r.full_name || !r.email) continue;
      const id = ulid();
      await query(
        `INSERT INTO school_roster (id, school_id, full_name, email, phone)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (school_id, email) DO UPDATE SET full_name=$3, phone=$5, updated_at=NOW()`,
        [id, req.user!.schoolId, r.full_name, r.email, r.phone ?? null]
      );
      imported++;
    }
    res.json({ imported });
  } catch (err) { next(err); }
}

export async function addRosterTeachersToSession(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { sessionId } = req.params;
    const { rosterIds } = z.object({ rosterIds: z.array(z.string()).min(1) }).parse(req.body);

    const sessionCheck = await query(
      `SELECT id FROM sessions WHERE id=$1 AND school_id=$2`, [sessionId, req.user!.schoolId]
    );
    if (!sessionCheck.rows[0]) throw createError('Session introuvable', 404);

    const rosterRes = await query(
      `SELECT full_name, email, phone FROM school_roster WHERE id = ANY($1) AND school_id=$2`,
      [rosterIds, req.user!.schoolId]
    );

    let added = 0;
    for (const t of rosterRes.rows) {
      await query(
        `INSERT INTO teachers (session_id, full_name, email, phone)
         VALUES ($1,$2,$3,$4) ON CONFLICT (session_id, email) DO NOTHING`,
        [sessionId, t.full_name, t.email, t.phone ?? null]
      );
      added++;
    }
    res.json({ added });
  } catch (err) { next(err); }
}
