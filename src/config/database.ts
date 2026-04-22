import { Pool } from 'pg';
import { env } from './env';

export const pool = new Pool({ connectionString: env.DATABASE_URL });

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL error:', err);
});

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<{ rows: T[]; rowCount: number | null }> {
  const start = Date.now();
  const result = await pool.query(text, params);
  if (env.NODE_ENV === 'development') {
    console.log(`[DB] ${text.substring(0, 80)} — ${Date.now() - start}ms`);
  }
  return result as { rows: T[]; rowCount: number | null };
}

export async function getClient() {
  return pool.connect();
}
