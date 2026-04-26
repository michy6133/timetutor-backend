import type { Response, NextFunction } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import type { AuthRequest } from '../types';
import { createError } from '../middleware/errorHandler';

export async function listSchoolClasses(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const schoolId = req.user!.schoolId;
    if (!schoolId) throw createError('École introuvable', 403);
    const includeInactive = req.query.includeInactive === '1' || req.query.includeInactive === 'true';
    const { rows } = await query(
      `SELECT id, school_id, name, sort_order, is_active, is_system_template, created_at
       FROM school_classes
       WHERE school_id = $1 ${includeInactive ? '' : 'AND is_active = true'}
       ORDER BY sort_order, name`,
      [schoolId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

export async function addSchoolClass(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const schoolId = req.user!.schoolId;
    if (!schoolId) throw createError('École introuvable', 403);
    const { name } = z.object({ name: z.string().min(1).max(120).trim() }).parse(req.body);
    const maxRes = await query<{ m: string }>(
      `SELECT COALESCE(MAX(sort_order), 0)::text AS m FROM school_classes WHERE school_id = $1`,
      [schoolId]
    );
    const nextOrder = parseInt(maxRes.rows[0]?.m ?? '0', 10) + 1;
    const { rows } = await query<{ id: string }>(
      `INSERT INTO school_classes (school_id, name, sort_order, is_system_template, is_active)
       VALUES ($1, $2, $3, false, true)
       ON CONFLICT (school_id, name) DO UPDATE SET is_active = true
       RETURNING id`,
      [schoolId, name, nextOrder]
    );
    res.status(201).json({ id: rows[0]?.id, name });
  } catch (err) {
    next(err);
  }
}

export async function patchSchoolClass(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const schoolId = req.user!.schoolId;
    if (!schoolId) throw createError('École introuvable', 403);
    const { id } = req.params;
    const body = z.object({ isActive: z.boolean() }).parse(req.body);
    const { rows } = await query(
      `UPDATE school_classes SET is_active = $1
       WHERE id = $2 AND school_id = $3
       RETURNING id, is_active`,
      [body.isActive, id, schoolId]
    );
    if (!rows[0]) throw createError('Classe introuvable', 404);
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function deleteSchoolClass(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const schoolId = req.user!.schoolId;
    if (!schoolId) throw createError('École introuvable', 403);
    const { id } = req.params;
    const cls = await query<{ is_system_template: boolean }>(
      `SELECT is_system_template FROM school_classes WHERE id = $1 AND school_id = $2`,
      [id, schoolId]
    );
    if (!cls.rows[0]) throw createError('Classe introuvable', 404);
    if (cls.rows[0].is_system_template) {
      throw createError('Les classes du référentiel ne peuvent pas être supprimées : désactivez-les à la place', 400);
    }
    await query(`UPDATE sessions SET school_class_id = NULL WHERE school_class_id = $1`, [id]);
    await query(`DELETE FROM school_classes WHERE id = $1 AND school_id = $2`, [id, schoolId]);
    res.json({ message: 'Classe supprimée' });
  } catch (err) {
    next(err);
  }
}
