import 'dotenv/config';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { Server as SocketServer } from 'socket.io';
import app from './app';
import { env } from './config/env';
import { pool } from './config/database';
import { connectRedis } from './config/redis';
import { setupSocketHandlers } from './socket/handler';
import { setSocketIo } from './config/socket-io';

const PORT = parseInt(env.PORT);
const server = http.createServer(app);

const io = new SocketServer(server, {
  cors:
    env.NODE_ENV === 'development'
      ? { origin: true, methods: ['GET', 'POST'], credentials: true }
      : {
          origin: env.FRONTEND_URL.split(',').map((s) => s.trim()).filter(Boolean),
          methods: ['GET', 'POST'],
          credentials: true,
        },
});

setSocketIo(io);
setupSocketHandlers(io);

async function applyMigrations(): Promise<void> {
  const migrationsDir = path.join(__dirname, '../migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  const client = await pool.connect();
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('COMMIT');
        console.log(`✅ Migration ${file} appliquée`);
      } catch (err: unknown) {
        await client.query('ROLLBACK');
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`⚠️  Migration ${file} ignorée (déjà appliquée ou erreur bénigne): ${msg}`);
      }
    }
  } finally {
    client.release();
  }
}

async function start(): Promise<void> {
  try {
    // Test DB connection
    await pool.query('SELECT 1');
    console.log('✅ PostgreSQL connecté');

    // Apply pending migrations
    await applyMigrations();

    // Connect Redis
    await connectRedis();

    server.listen(PORT, () => {
      console.log(`🚀 TimeTutor API → http://localhost:${PORT}/api/v1`);
    });
  } catch (err) {
    console.error('❌ Erreur démarrage:', err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Arrêt gracieux...');
  server.close();
  await pool.end();
  process.exit(0);
});

start();