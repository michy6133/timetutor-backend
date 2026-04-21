import type { Response, NextFunction } from 'express';
import { query } from '../config/database';
import type { AuthRequest } from '../types';

export async function listSchools(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT s.*,
        (SELECT COUNT(*) FROM users WHERE school_id = s.id) AS directors_count,
        (SELECT COUNT(*) FROM sessions WHERE school_id = s.id) AS sessions_count
       FROM schools s ORDER BY s.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

export async function globalStats(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const [schools, sessions, teachers, slots] = await Promise.all([
      query<{ count: string }>('SELECT COUNT(*) FROM schools WHERE is_active = true'),
      query<{ count: string }>('SELECT COUNT(*) FROM sessions WHERE status = $1', ['open']),
      query<{ count: string }>('SELECT COUNT(*) FROM teachers'),
      query<{ count: string }>('SELECT COUNT(*) FROM time_slots WHERE status = $1', ['validated']),
    ]);
    res.json({
      activeSchools: parseInt(schools.rows[0]?.count ?? '0'),
      openSessions: parseInt(sessions.rows[0]?.count ?? '0'),
      totalTeachers: parseInt(teachers.rows[0]?.count ?? '0'),
      validatedSlots: parseInt(slots.rows[0]?.count ?? '0'),
    });
  } catch (err) {
    next(err);
  }
}

export async function listNotifications(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`,
      [req.user!.userId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

export async function markNotificationRead(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    await query(
      `UPDATE notifications SET is_read=true WHERE id=$1 AND user_id=$2`,
      [id, req.user!.userId]
    );
    res.json({ message: 'Notification marquée comme lue' });
  } catch (err) {
    next(err);
  }
}

export async function toggleSchool(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const { rows } = await query<{ is_active: boolean }>(
      `UPDATE schools SET is_active = NOT is_active WHERE id=$1 RETURNING is_active`,
      [id]
    );
    if (!rows[0]) { res.status(404).json({ error: 'École introuvable' }); return; }
    res.json({ isActive: rows[0].is_active });
  } catch (err) {
    next(err);
  }
}

export async function markAllNotificationsRead(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await query(
      `UPDATE notifications SET is_read=true WHERE user_id=$1`,
      [req.user!.userId]
    );
    res.json({ message: 'Toutes les notifications marquées comme lues' });
  } catch (err) {
    next(err);
  }
}
