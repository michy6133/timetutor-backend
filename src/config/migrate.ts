import fs from 'fs';
import path from 'path';
import { pool } from './database';
import dotenv from 'dotenv';
dotenv.config();

const MIGRATIONS = [
  '001_initial.sql',
  '002_teacher_role.sql',
  '003_auth_subscriptions.sql',
  '004_roster_payments_exchanges.sql',
  '005_school_classes_gdpr.sql',
  '006_preset_subjects.sql',
  '007_slot_negotiations.sql',
  '008_admin_seed_plan_features.sql',
];

async function migrate() {
  const client = await pool.connect();
  try {
    for (const file of MIGRATIONS) {
      const sqlPath = path.join(__dirname, '../../migrations', file);
      const sql = fs.readFileSync(sqlPath, 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('COMMIT');
        console.log(`✅ ${file} appliqué`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`❌ Erreur dans ${file}:`, err);
        process.exit(1);
      }
    }
    console.log('✅ Toutes les migrations appliquées');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
