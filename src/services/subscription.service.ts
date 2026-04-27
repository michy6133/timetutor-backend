import { query } from '../config/database';
import { createError } from '../middleware/errorHandler';

type Limits = {
  maxSchools?: number;
  maxSessionsPerSchool?: number;
  maxTeachersPerSession?: number;
};

export async function getSchoolSubscription(schoolId: string) {
  const result = await query<{
    school_id: string;
    plan_code: string;
    status: string;
    limits_json: Limits;
    limits_override_json: Limits;
  }>(
    `SELECT ss.school_id, ss.plan_code, ss.status, pd.limits_json, ss.limits_override_json
     FROM school_subscriptions ss
     JOIN plan_definitions pd ON pd.code = ss.plan_code
     WHERE ss.school_id = $1`,
    [schoolId]
  );
  return result.rows[0] ?? null;
}

export function resolveLimits(base: Limits, override: Limits): Limits {
  return { ...base, ...override };
}

export async function assertCanCreateSession(schoolId: string): Promise<void> {
  const subscription = await getSchoolSubscription(schoolId);
  if (!subscription) return;
  if (!['active', 'trial'].includes(subscription.status)) {
    throw createError('Abonnement inactif', 403);
  }
  const limits = resolveLimits(subscription.limits_json, subscription.limits_override_json);
  if (!limits.maxSessionsPerSchool) return;
  const sessionsCount = await query<{ count: string }>('SELECT COUNT(*) FROM sessions WHERE school_id = $1', [schoolId]);
  if (Number(sessionsCount.rows[0]?.count ?? '0') >= limits.maxSessionsPerSchool) {
    throw createError(`Limite atteinte: maximum ${limits.maxSessionsPerSchool} sessions pour ce plan`, 403);
  }
}

export type FeatureKey =
  | 'pdfExport'
  | 'jpgExport'
  | 'csvImport'
  | 'slotGenerator'
  | 'gridDuplicate'
  | 'slotNegotiations'
  | 'whatsappNotifications';

export async function assertFeatureEnabled(schoolId: string, feature: FeatureKey): Promise<void> {
  const result = await query<{
    status: string;
    features_json: Record<string, boolean>;
  }>(
    `SELECT ss.status, pd.features_json
     FROM school_subscriptions ss
     JOIN plan_definitions pd ON pd.code = ss.plan_code
     WHERE ss.school_id = $1`,
    [schoolId]
  );
  const row = result.rows[0];
  if (!row) return;
  if (!['active', 'trial'].includes(row.status)) {
    throw createError('Abonnement inactif', 403);
  }
  if (row.features_json[feature] === false) {
    throw createError(`Cette fonctionnalité n'est pas disponible dans votre plan d'abonnement`, 403);
  }
}

export async function assertCanAddTeacher(sessionId: string): Promise<void> {
  const result = await query<{
    school_id: string;
    limits_json: Limits;
    limits_override_json: Limits;
    count: string;
  }>(
    `SELECT s.school_id, pd.limits_json, ss.limits_override_json, COUNT(t.id)::text AS count
     FROM sessions s
     JOIN school_subscriptions ss ON ss.school_id = s.school_id
     JOIN plan_definitions pd ON pd.code = ss.plan_code
     LEFT JOIN teachers t ON t.session_id = s.id
     WHERE s.id = $1
     GROUP BY s.school_id, pd.limits_json, ss.limits_override_json`,
    [sessionId]
  );
  const row = result.rows[0];
  if (!row) return;
  const limits = resolveLimits(row.limits_json, row.limits_override_json);
  if (!limits.maxTeachersPerSession) return;
  if (Number(row.count) >= limits.maxTeachersPerSession) {
    throw createError(`Limite atteinte: maximum ${limits.maxTeachersPerSession} enseignants pour cette session`, 403);
  }
}
