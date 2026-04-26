import type { NextFunction, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import type { AuthRequest } from '../types';
import { createError } from '../middleware/errorHandler';

const subjectSchema = z.object({
  name: z.string().trim().min(2).max(100),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#2563ff'),
});

const subjectUpdateSchema = subjectSchema.partial();

export async function listSubjects(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT id, name, color
       FROM subjects
       WHERE school_id = $1
       ORDER BY name`,
      [req.user!.schoolId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

export async function createSubject(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = subjectSchema.parse(req.body);
    const { rows } = await query<{ id: string; name: string; color: string }>(
      `INSERT INTO subjects (school_id, name, color)
       VALUES ($1, $2, $3)
       RETURNING id, name, color`,
      [req.user!.schoolId, data.name, data.color]
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    if (err?.code === '23505') {
      next(createError('Une matière avec ce nom existe déjà', 409));
      return;
    }
    next(err);
  }
}

export async function updateSubject(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const data = subjectUpdateSchema.parse(req.body);
    const { rows } = await query<{ id: string; name: string; color: string }>(
      `UPDATE subjects
       SET name = COALESCE($1, name),
           color = COALESCE($2, color)
       WHERE id = $3
         AND school_id = $4
       RETURNING id, name, color`,
      [data.name, data.color, id, req.user!.schoolId]
    );
    if (!rows[0]) throw createError('Matière introuvable', 404);
    res.json(rows[0]);
  } catch (err: any) {
    if (err?.code === '23505') {
      next(createError('Une matière avec ce nom existe déjà', 409));
      return;
    }
    next(err);
  }
}

export async function deleteSubject(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    await query(
      `DELETE FROM subjects
       WHERE id = $1
         AND school_id = $2`,
      [id, req.user!.schoolId]
    );
    res.json({ message: 'Matière supprimée' });
  } catch (err) {
    next(err);
  }
}
