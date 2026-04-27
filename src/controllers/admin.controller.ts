import type { Response, NextFunction } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import type { AuthRequest } from '../types';
import { resolveLimits } from '../services/subscription.service';

export async function listSchools(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT s.*, COALESCE(ss.plan_code, 'standard') AS subscription_plan,
        (SELECT COUNT(*) FROM users WHERE school_id = s.id) AS directors_count,
        (SELECT COUNT(*) FROM sessions WHERE school_id = s.id) AS sessions_count
       FROM schools s
       LEFT JOIN school_subscriptions ss ON ss.school_id = s.id
       ORDER BY s.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

export async function globalStats(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const [schools, sessions, teachers, slots, userRoles] = await Promise.all([
      query<{ count: string }>('SELECT COUNT(*) FROM schools WHERE is_active = true'),
      query<{ count: string }>('SELECT COUNT(*) FROM sessions WHERE status = $1', ['open']),
      query<{ count: string }>('SELECT COUNT(*) FROM teachers'),
      query<{ count: string }>('SELECT COUNT(*) FROM time_slots WHERE status = $1', ['validated']),
      query<{ role: string; count: string }>('SELECT role, COUNT(*)::text AS count FROM users GROUP BY role'),
    ]);
    const byRole: Record<string, number> = {};
    for (const r of userRoles.rows) byRole[r.role] = parseInt(r.count, 10);
    res.json({
      activeSchools: parseInt(schools.rows[0]?.count ?? '0'),
      openSessions: parseInt(sessions.rows[0]?.count ?? '0'),
      totalTeachers: parseInt(teachers.rows[0]?.count ?? '0'),
      validatedSlots: parseInt(slots.rows[0]?.count ?? '0'),
      totalUsers: Object.values(byRole).reduce((a, b) => a + b, 0),
      directorCount: byRole['director'] ?? 0,
      teacherCount: byRole['teacher'] ?? 0,
      adminCount: byRole['super_admin'] ?? 0,
    });
  } catch (err) {
    next(err);
  }
}

export async function listUsers(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT u.id, u.email, u.full_name, u.role, u.is_active, u.created_at,
              s.name AS school_name
       FROM users u
       LEFT JOIN schools s ON s.id = u.school_id
       ORDER BY u.role, u.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

export async function createAdminUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, fullName, password } = z.object({
      email: z.string().email(),
      fullName: z.string().min(2),
      password: z.string().min(8),
    }).parse(req.body);
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name, role, is_active, email_verified)
       VALUES ($1, $2, $3, 'super_admin', true, true)
       RETURNING id`,
      [email, hash, fullName]
    );
    res.status(201).json({ id: rows[0].id, email, fullName, role: 'super_admin' });
  } catch (err: any) {
    if (err.code === '23505') { res.status(409).json({ error: 'Cet email est déjà utilisé.' }); return; }
    next(err);
  }
}

export async function deleteUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    if (id === req.user!.userId) { res.status(400).json({ error: 'Impossible de supprimer votre propre compte.' }); return; }
    const { rowCount } = await query(`DELETE FROM users WHERE id = $1`, [id]);
    if (!rowCount) { res.status(404).json({ error: 'Utilisateur introuvable.' }); return; }
    res.json({ ok: true });
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

export async function listPlans(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await query(`SELECT * FROM plan_definitions WHERE is_active = true ORDER BY code`);
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

export async function getSchoolSubscription(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const { rows } = await query(
      `SELECT ss.*, pd.display_name, pd.limits_json, pd.features_json
       FROM school_subscriptions ss
       JOIN plan_definitions pd ON pd.code = ss.plan_code
       WHERE ss.school_id = $1`,
      [id]
    );
    if (!rows[0]) { res.status(404).json({ error: 'Abonnement introuvable' }); return; }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function updateSchoolSubscription(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const payload = z.object({
      planCode: z.string().min(1),
      status: z.enum(['trial', 'active', 'past_due', 'canceled', 'expired']).optional(),
      currentPeriodEnd: z.string().datetime().nullable().optional(),
    }).parse(req.body);
    const { rows } = await query(
      `UPDATE school_subscriptions
       SET plan_code = $1,
           status = COALESCE($2, status),
           current_period_end = COALESCE($3, current_period_end),
           updated_at = NOW()
       WHERE school_id = $4
       RETURNING *`,
      [payload.planCode, payload.status ?? null, payload.currentPeriodEnd ?? null, id]
    );
    if (!rows[0]) { res.status(404).json({ error: 'Abonnement introuvable' }); return; }
    await query(
      `INSERT INTO subscription_events (school_id, event_type, actor_user_id, metadata)
       VALUES ($1, 'subscription_updated', $2, $3)`,
      [id, req.user!.userId, JSON.stringify(payload)]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function getMySubscription(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user?.schoolId) { res.status(404).json({ error: 'École introuvable' }); return; }
    let { rows } = await query(
      `SELECT ss.*, pd.display_name, pd.limits_json, pd.features_json
       FROM school_subscriptions ss
       JOIN plan_definitions pd ON pd.code = ss.plan_code
       WHERE ss.school_id = $1`,
      [req.user.schoolId]
    );
    if (!rows[0]) {
      await query(
        `INSERT INTO school_subscriptions (school_id, plan_code, status)
         VALUES ($1, 'standard', 'trial') ON CONFLICT (school_id) DO NOTHING`,
        [req.user.schoolId]
      );
      const retry = await query(
        `SELECT ss.*, pd.display_name, pd.limits_json, pd.features_json
         FROM school_subscriptions ss
         JOIN plan_definitions pd ON pd.code = ss.plan_code
         WHERE ss.school_id = $1`,
        [req.user.schoolId]
      );
      rows = retry.rows;
      if (!rows[0]) { res.status(404).json({ error: 'Abonnement introuvable' }); return; }
    }
    const row = rows[0] as Record<string, unknown> & {
      limits_json: Record<string, number | undefined>;
      limits_override_json: Record<string, number | undefined>;
    };
    const limits = resolveLimits(row.limits_json ?? {}, row.limits_override_json ?? {});
    const [sessCount, busiestTeachers] = await Promise.all([
      query<{ c: string }>('SELECT COUNT(*)::text AS c FROM sessions WHERE school_id = $1', [req.user!.schoolId]),
      query<{ m: string }>(
        `SELECT COALESCE(MAX(cnt), 0)::text AS m FROM (
           SELECT COUNT(*)::int AS cnt FROM teachers t
           JOIN sessions s ON s.id = t.session_id WHERE s.school_id = $1 GROUP BY s.id
         ) x`,
        [req.user!.schoolId]
      ),
    ]);
    const sessionsCount = parseInt(sessCount.rows[0]?.c ?? '0', 10);
    const maxTeachersInSession = parseInt(busiestTeachers.rows[0]?.m ?? '0', 10);
    const usageAlerts: string[] = [];
    const sl = limits.maxSessionsPerSchool;
    if (sl != null) {
      if (sessionsCount >= sl) usageAlerts.push(`Limite du plan atteinte : ${sessionsCount}/${sl} sessions.`);
      else if (sessionsCount >= Math.max(1, Math.floor(sl * 0.8))) {
        usageAlerts.push(`Vous approchez de la limite de sessions du plan (${sessionsCount}/${sl}).`);
      }
    }
    const tl = limits.maxTeachersPerSession;
    if (tl != null && maxTeachersInSession >= Math.max(1, Math.floor(tl * 0.8))) {
      usageAlerts.push(`Au moins une session approche la limite d'enseignants par session (${maxTeachersInSession}/${tl}).`);
    }
    res.json({
      ...row,
      usage: {
        sessionsCount,
        sessionsLimit: sl ?? null,
        maxTeachersInSession,
        teachersPerSessionLimit: tl ?? null,
      },
      usageAlerts,
    });
  } catch (err) {
    next(err);
  }
}
export async function updatePlan(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { code } = req.params;
    const payload = z.object({
      displayName: z.string().min(1).optional(),
      limitsJson: z.record(z.number().nullable()).optional(),
      featuresJson: z.record(z.boolean()).optional(),
      validityDays: z.number().int().min(1).optional(),
      isActive: z.boolean().optional(),
    }).parse(req.body);

    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;
    if (payload.displayName !== undefined) { sets.push(`display_name = $${idx++}`); vals.push(payload.displayName); }
    if (payload.limitsJson !== undefined) { sets.push(`limits_json = $${idx++}`); vals.push(JSON.stringify(payload.limitsJson)); }
    if (payload.featuresJson !== undefined) { sets.push(`features_json = $${idx++}`); vals.push(JSON.stringify(payload.featuresJson)); }
    if (payload.validityDays !== undefined) { sets.push(`validity_days = $${idx++}`); vals.push(payload.validityDays); }
    if (payload.isActive !== undefined) { sets.push(`is_active = $${idx++}`); vals.push(payload.isActive); }
    if (sets.length === 0) { res.status(400).json({ error: 'Rien à mettre à jour' }); return; }

    sets.push(`updated_at = NOW()`);
    vals.push(code);
    const { rows } = await query(
      `UPDATE plan_definitions SET ${sets.join(', ')} WHERE code = $${idx} RETURNING *`,
      vals
    );
    if (!rows[0]) { res.status(404).json({ error: 'Plan introuvable' }); return; }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function setSchoolLimitsOverride(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const payload = z.object({
      limitsOverride: z.record(z.number().nullable()),
    }).parse(req.body);
    const { rows } = await query(
      `UPDATE school_subscriptions SET limits_override_json = $1, updated_at = NOW()
       WHERE school_id = $2 RETURNING *`,
      [JSON.stringify(payload.limitsOverride), id]
    );
    if (!rows[0]) { res.status(404).json({ error: 'Abonnement introuvable' }); return; }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function checkoutSubscription(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user?.schoolId) { res.status(404).json({ error: 'École introuvable' }); return; }
    
    const payload = z.object({
      planCode: z.string().min(1),
      isAnnual: z.boolean().optional(),
    }).parse(req.body);

    // Get plan details
    const planResult = await query<{ validity_days: number }>(`SELECT validity_days FROM plan_definitions WHERE code = $1`, [payload.planCode]);
    if (!planResult.rows[0]) {
      res.status(400).json({ error: 'Plan invalide' });
      return;
    }

    // Calculate new period end (simple add days, or add 1 year if annual)
    let days = planResult.rows[0].validity_days || 30;
    if (payload.isAnnual) days = 365;

    // We simulate payment validation and update the subscription
    const { rows } = await query(
      `INSERT INTO school_subscriptions (school_id, plan_code, status, current_period_end, updated_at)
       VALUES ($1, $2, 'active', NOW() + interval '1 day' * $3, NOW())
       ON CONFLICT (school_id) 
       DO UPDATE SET 
         plan_code = EXCLUDED.plan_code, 
         status = 'active', 
         current_period_end = NOW() + interval '1 day' * $3,
         updated_at = NOW()
       RETURNING *`,
      [req.user.schoolId, payload.planCode, days]
    );

    await query(
      `INSERT INTO subscription_events (school_id, event_type, actor_user_id, metadata)
       VALUES ($1, 'subscription_checkout', $2, $3)`,
      [req.user.schoolId, req.user.userId, JSON.stringify(payload)]
    );

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}
