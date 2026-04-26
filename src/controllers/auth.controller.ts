import type { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../config/database';
import { env } from '../config/env';
import type { AuthRequest } from '../types';
import { createError } from '../middleware/errorHandler';
import jwt from 'jsonwebtoken';
import { createAccessToken, createRefreshToken, revokeRefreshToken, rotateRefreshToken } from '../services/token.service';
import { sendPasswordReset } from '../services/email.service';

/** Version affichée côté politique / consentement (à synchroniser avec la page politique). */
export const CURRENT_POLICY_VERSION = '2026-04-26';

const registerSchema = z.object({
  schoolName: z.string().min(2),
  schoolSlug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  gdprAccepted: z.boolean().refine((v) => v === true, { message: 'Consentement RGPD requis' }),
});

const teacherRegisterSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  gdprAccepted: z.boolean().refine((v) => v === true, { message: 'Consentement RGPD requis' }),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = registerSchema.parse(req.body);
    // Check email uniqueness
    const existing = await query<{ id: string }>('SELECT id FROM users WHERE email = $1', [data.email]);
    if (existing.rows.length > 0) throw createError('Email déjà utilisé', 409);

    const passwordHash = await bcrypt.hash(data.password, 12);

    const client = await (await import('../config/database')).getClient();
    try {
      await client.query('BEGIN');
      const school = await client.query<{ id: string }>(
        `INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`,
        [data.schoolName, data.schoolSlug]
      );
      const schoolId = school.rows[0]?.id;
      const user = await client.query<{ id: string; role: string }>(
        `INSERT INTO users (school_id, email, password_hash, full_name, role, gdpr_consent_at, policy_ack_version)
         VALUES ($1, $2, $3, $4, 'director', NOW(), $5) RETURNING id, role`,
        [schoolId, data.email, passwordHash, data.fullName, CURRENT_POLICY_VERSION]
      );
      
      // Create default subscription
      await client.query(
        `INSERT INTO school_subscriptions (school_id, plan_code, status)
         VALUES ($1, 'standard', 'trial')`,
        [schoolId]
      );
      
      await client.query('COMMIT');
      const userId = user.rows[0]?.id;
      const accessToken = createAccessToken({ userId, schoolId, role: 'director' });
      const refreshToken = await createRefreshToken({ userId, schoolId, role: 'director' });
      res.cookie('tt_refresh', refreshToken, {
        httpOnly: true,
        secure: env.COOKIE_SECURE === 'true',
        sameSite: 'lax',
        path: '/api/v1/auth',
      });
      res.status(201).json({ token: accessToken, user: { id: userId, email: data.email, fullName: data.fullName, role: 'director', schoolId } });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = loginSchema.parse(req.body);
    const result = await query<{ id: string; school_id: string; password_hash: string; full_name: string; role: string; is_active: boolean }>(
      `SELECT id, school_id, password_hash, full_name, role, is_active FROM users WHERE email = $1`,
      [data.email]
    );
    const user = result.rows[0];
    if (!user || !await bcrypt.compare(data.password, user.password_hash)) {
      throw createError('Email ou mot de passe incorrect', 401);
    }
    if (!user.is_active) throw createError('Compte désactivé', 403);

    await query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);

    const accessToken = createAccessToken({ userId: user.id, schoolId: user.school_id, role: user.role });
    const refreshToken = await createRefreshToken({ userId: user.id, schoolId: user.school_id, role: user.role });
    res.cookie('tt_refresh', refreshToken, {
      httpOnly: true,
      secure: env.COOKIE_SECURE === 'true',
      sameSite: 'lax',
      path: '/api/v1/auth',
    });
    res.json({ token: accessToken, user: { id: user.id, email: data.email, fullName: user.full_name, role: user.role, schoolId: user.school_id } });
  } catch (err) {
    next(err);
  }
}

export async function registerTeacher(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = teacherRegisterSchema.parse(req.body);
    const existing = await query<{ id: string }>('SELECT id FROM users WHERE email = $1', [data.email]);
    if (existing.rows.length > 0) throw createError('Email déjà utilisé', 409);

    const passwordHash = await bcrypt.hash(data.password, 12);
    const user = await query<{ id: string }>(
      `INSERT INTO users (school_id, email, password_hash, full_name, role, gdpr_consent_at, policy_ack_version)
       VALUES (NULL, $1, $2, $3, 'teacher', NOW(), $4) RETURNING id`,
      [data.email, passwordHash, data.fullName, CURRENT_POLICY_VERSION]
    );
    const userId = user.rows[0]?.id;
    const accessToken = createAccessToken({ userId, schoolId: null, role: 'teacher' });
    const refreshToken = await createRefreshToken({ userId, schoolId: null, role: 'teacher' });
    res.cookie('tt_refresh', refreshToken, {
      httpOnly: true,
      secure: env.COOKIE_SECURE === 'true',
      sameSite: 'lax',
      path: '/api/v1/auth',
    });
    res.status(201).json({ token: accessToken, user: { id: userId, email: data.email, fullName: data.fullName, role: 'teacher', schoolId: null } });
  } catch (err) {
    next(err);
  }
}

const forgotPasswordSchema = z.object({ email: z.string().email() });
const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

export async function forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);
    const result = await query<{ id: string }>('SELECT id FROM users WHERE email = $1 AND is_active = true', [email]);
    // Always respond 200 to avoid email enumeration
    if (result.rows.length > 0) {
      const userId = result.rows[0]!.id;
      const token = jwt.sign({ userId, type: 'password-reset' }, env.JWT_SECRET, { expiresIn: '1h' } as jwt.SignOptions);
      const resetLink = `${env.FRONTEND_URL}/reset-password?token=${token}`;
      await sendPasswordReset(email, resetLink);
    }
    res.json({ message: 'Si cet email existe, un lien de réinitialisation a été envoyé.' });
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token, password } = resetPasswordSchema.parse(req.body);
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
    } catch {
      throw createError('Lien invalide ou expiré', 400);
    }
    if (payload['type'] !== 'password-reset' || !payload['userId']) {
      throw createError('Lien invalide ou expiré', 400);
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const updated = await query<{ id: string }>(
      'UPDATE users SET password_hash = $1 WHERE id = $2 AND is_active = true RETURNING id',
      [passwordHash, payload['userId']]
    );
    if (updated.rows.length === 0) throw createError('Utilisateur introuvable', 404);
    res.json({ message: 'Mot de passe mis à jour avec succès.' });
  } catch (err) {
    next(err);
  }
}

export function policyMetadata(_req: Request, res: Response): void {
  res.json({
    version: CURRENT_POLICY_VERSION,
    policyPath: '/policy',
  });
}

export async function exportMyData(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) { res.status(401).json({ error: 'Non authentifié' }); return; }
    const me = await query<{
      id: string;
      email: string;
      full_name: string;
      role: string;
      school_id: string | null;
      gdpr_consent_at: Date | null;
      policy_ack_version: string | null;
      created_at: Date;
    }>(
      `SELECT id, email, full_name, role, school_id, gdpr_consent_at, policy_ack_version, created_at
       FROM users WHERE id = $1`,
      [req.user.userId]
    );
    const u = me.rows[0];
    if (!u) throw createError('Utilisateur introuvable', 404);

    let payload: Record<string, unknown> = {
      user: u,
      exportedAt: new Date().toISOString(),
    };

    if (u.role === 'teacher') {
      const schedule = await query(
        `SELECT ts.id AS slot_id, ts.day_of_week, ts.start_time::text, ts.end_time::text, ts.room, ts.status,
                sess.id AS session_id, sess.name AS session_name, sess.academic_year,
                sch.name AS school_name, sub.name AS subject_name
         FROM teachers t
         JOIN slot_selections ss ON ss.teacher_id = t.id
         JOIN time_slots ts ON ts.id = ss.slot_id
         JOIN sessions sess ON sess.id = ss.session_id
         JOIN schools sch ON sch.id = sess.school_id
         LEFT JOIN subjects sub ON sub.id = ts.subject_id
         WHERE LOWER(TRIM(t.email)) = LOWER(TRIM($1))`,
        [u.email]
      );
      const teacherRows = await query(
        `SELECT t.id, t.session_id, t.status, t.invitation_sent_at, t.last_seen_at
         FROM teachers t WHERE LOWER(TRIM(t.email)) = LOWER(TRIM($1))`,
        [u.email]
      );
      payload = { ...payload, schedule: schedule.rows, teacherInvitations: teacherRows.rows };
    }

    if (u.role === 'director' && u.school_id) {
      const [school, sessions, roster, classes] = await Promise.all([
        query(`SELECT id, name, slug, is_active, created_at FROM schools WHERE id = $1`, [u.school_id]),
        query(
          `SELECT id, name, academic_year, status, deadline, school_class_id, created_at
           FROM sessions WHERE school_id = $1`,
          [u.school_id]
        ),
        query(
          `SELECT id, full_name, email, phone, created_at FROM school_roster WHERE school_id = $1`,
          [u.school_id]
        ),
        query(
          `SELECT id, name, sort_order, is_active, is_system_template FROM school_classes WHERE school_id = $1`,
          [u.school_id]
        ),
      ]);
      payload = {
        ...payload,
        school: school.rows[0] ?? null,
        sessions: sessions.rows,
        roster: roster.rows,
        schoolClasses: classes.rows,
      };
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="timetutor-donnees-${u.id}.json"`);
    res.json(payload);
  } catch (err) {
    next(err);
  }
}

export async function updateMe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) { res.status(401).json({ error: 'Non authentifié' }); return; }
    const { fullName, phone } = z.object({
      fullName: z.string().min(2).max(120).optional(),
      phone: z.string().max(30).optional(),
    }).parse(req.body);
    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (fullName !== undefined) { updates.push(`full_name = $${idx++}`); values.push(fullName); }
    if (phone !== undefined) { updates.push(`phone = $${idx++}`); values.push(phone); }
    if (updates.length === 0) { res.json({ message: 'Rien à mettre à jour' }); return; }
    values.push(req.user.userId);
    const result = await query<{ id: string; email: string; full_name: string; role: string; school_id: string }>(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, email, full_name, role, school_id`,
      values
    );
    const u = result.rows[0];
    if (!u) throw createError('Utilisateur introuvable', 404);
    res.json({ id: u.id, email: u.email, fullName: u.full_name, role: u.role, schoolId: u.school_id });
  } catch (err) {
    next(err);
  }
}

export async function deleteMe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) { res.status(401).json({ error: 'Non authentifié' }); return; }
    await query(`UPDATE users SET is_active = false WHERE id = $1`, [req.user.userId]);
    res.clearCookie('tt_refresh', { path: '/api/v1/auth' });
    res.json({ message: 'Compte supprimé' });
  } catch (err) {
    next(err);
  }
}

export async function changePassword(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) { res.status(401).json({ error: 'Non authentifié' }); return; }
    const { currentPassword, newPassword } = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8),
    }).parse(req.body);
    const result = await query<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE id = $1`,
      [req.user.userId]
    );
    const user = result.rows[0];
    if (!user) throw createError('Utilisateur introuvable', 404);
    if (!await bcrypt.compare(currentPassword, user.password_hash)) {
      throw createError('Mot de passe actuel incorrect', 401);
    }
    const newHash = await bcrypt.hash(newPassword, 12);
    await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [newHash, req.user.userId]);
    res.json({ message: 'Mot de passe mis à jour' });
  } catch (err) {
    next(err);
  }
}

export async function me(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) { res.status(401).json({ error: 'Non authentifié' }); return; }
    const result = await query<{ id: string; email: string; full_name: string; role: string; school_id: string }>(
      `SELECT id, email, full_name, role, school_id FROM users WHERE id = $1`,
      [req.user.userId]
    );
    const user = result.rows[0];
    if (!user) throw createError('Utilisateur introuvable', 404);
    res.json({ id: user.id, email: user.email, fullName: user.full_name, role: user.role, schoolId: user.school_id });
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.tt_refresh as string | undefined;
    if (!token) throw createError('Refresh token manquant', 401);
    const rotated = await rotateRefreshToken(token);
    if (!rotated) throw createError('Refresh token invalide', 401);
    res.cookie('tt_refresh', rotated.refreshToken, {
      httpOnly: true,
      secure: env.COOKIE_SECURE === 'true',
      sameSite: 'lax',
      path: '/api/v1/auth',
    });
    res.json({ token: rotated.accessToken });
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.tt_refresh as string | undefined;
    if (token) {
      await revokeRefreshToken(token);
    }
    res.clearCookie('tt_refresh', { path: '/api/v1/auth' });
    res.json({ message: 'Déconnexion réussie' });
  } catch (err) {
    next(err);
  }
}
