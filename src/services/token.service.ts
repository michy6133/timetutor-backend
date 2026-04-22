import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { query } from '../config/database';

interface AccessPayload {
  userId: string;
  schoolId: string | null;
  role: string;
}

export function createAccessToken(payload: AccessPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  } as jwt.SignOptions);
}

export async function createRefreshToken(payload: AccessPayload): Promise<string> {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ ...payload, jti, type: 'refresh' }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
  } as jwt.SignOptions);
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, replaced_by)
     VALUES ($1, $2, NOW() + $3::interval, NULL)`,
    [payload.userId, tokenHash, env.JWT_REFRESH_EXPIRES_IN]
  );
  return token;
}

export async function rotateRefreshToken(token: string): Promise<{ accessToken: string; refreshToken: string } | null> {
  try {
    const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as jwt.JwtPayload & AccessPayload;
    if (payload.type !== 'refresh' || !payload.userId) return null;
    const oldHash = crypto.createHash('sha256').update(token).digest('hex');
    const existing = await query<{ id: string; revoked_at: Date | null; expires_at: Date }>(
      `SELECT id, revoked_at, expires_at FROM refresh_tokens WHERE token_hash = $1`,
      [oldHash]
    );
    const row = existing.rows[0];
    if (!row || row.revoked_at || new Date(row.expires_at) < new Date()) return null;

    const newRefresh = await createRefreshToken({
      userId: payload.userId,
      schoolId: payload.schoolId ?? null,
      role: payload.role,
    });
    const newHash = crypto.createHash('sha256').update(newRefresh).digest('hex');
    await query(
      `UPDATE refresh_tokens SET revoked_at = NOW(), replaced_by = $1 WHERE id = $2`,
      [newHash, row.id]
    );
    const accessToken = createAccessToken({
      userId: payload.userId,
      schoolId: payload.schoolId ?? null,
      role: payload.role,
    });
    return { accessToken, refreshToken: newRefresh };
  } catch {
    return null;
  }
}

export async function revokeRefreshToken(token: string): Promise<void> {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1`, [hash]);
}
