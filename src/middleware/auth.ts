import type { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { query } from '../config/database';
import type { AuthRequest, TeacherRequest, AuthPayload } from '../types';

export function authenticateJWT(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token manquant' });
    return;
  }
  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, env.JWT_SECRET) as AuthPayload;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Accès non autorisé' });
      return;
    }
    next();
  };
}

export async function authenticateMagicToken(
  req: TeacherRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.params['token'] ?? req.query['token'] as string | undefined;
  if (!token) {
    res.status(401).json({ error: 'Token magique manquant' });
    return;
  }
  try {
    const result = await query<{ teacher_id: string; session_id: string; expires_at: Date }>(
      `SELECT teacher_id, session_id, expires_at FROM magic_tokens WHERE token = $1`,
      [token]
    );
    const row = result.rows[0];
    if (!row) {
      res.status(401).json({ error: 'Lien invalide' });
      return;
    }
    if (new Date() > row.expires_at) {
      res.status(401).json({ error: 'Lien expiré' });
      return;
    }
    req.teacher = { teacherId: row.teacher_id, sessionId: row.session_id, token };
    // Update last_seen on teacher
    await query(`UPDATE teachers SET last_seen_at = NOW(), status = 'active' WHERE id = $1`, [row.teacher_id]);
    next();
  } catch (err) {
    next(err);
  }
}
