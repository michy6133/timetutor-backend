import { Router } from 'express';
import type { Response, NextFunction } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { authenticateJWT, requireRole } from '../middleware/auth';
import type { AuthRequest } from '../types';
import { createError } from '../middleware/errorHandler';

const router = Router();

router.put('/me', authenticateJWT, requireRole('director'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.schoolId) throw createError('École introuvable', 403);
    const { name, contactEmail, timezone } = z.object({
      name: z.string().min(2).max(200).optional(),
      contactEmail: z.string().email().optional(),
      timezone: z.string().max(80).optional(),
    }).parse(req.body);

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name); }
    if (contactEmail !== undefined) { updates.push(`contact_email = $${idx++}`); values.push(contactEmail); }
    if (timezone !== undefined) { updates.push(`timezone = $${idx++}`); values.push(timezone); }
    if (updates.length === 0) { res.json({ message: 'Rien à mettre à jour' }); return; }

    values.push(req.user.schoolId);
    const result = await query(
      `UPDATE schools SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, name, slug`,
      values
    );
    if (!result.rows[0]) throw createError('École introuvable', 404);
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
