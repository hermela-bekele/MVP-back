/**
 * Adds what's missing for the English department to whichever database DATABASE_URL
 * points at, WITHOUT touching any other data:
 *   - the dept-eng department (if missing)
 *   - the English teacher login (Sarah Thompson)
 *   - the English department-head login (Tigist Assefa) — dept-eng already lists her as
 *     headName, but she previously had no portal_users row at all, so she couldn't log in
 *     as department-head the way Math/Biology's heads can.
 *
 * Unlike `npm run db:seed`, this does NOT truncate any tables. Every insert uses
 * ON CONFLICT ... DO NOTHING, so it's safe to run more than once.
 *
 * Usage against the deployed database:
 *   1. Copy the deployed DATABASE_URL from the Render dashboard.
 *   2. DATABASE_URL="<paste-it-here>" npx tsx scripts/add-english-teacher.ts
 *      (or set DATABASE_URL in your local .env temporarily, then run
 *       `npx tsx scripts/add-english-teacher.ts`)
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { Pool } = pg;

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.replace(/^['"]|['"]$/g, '');
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required (point it at the target database before running this).');
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED === 'true' },
  });

  try {
    const { rows } = await pool.query('SELECT current_database() AS db');
    console.log(`Connected to: ${rows[0].db}`);

    await pool.query(
      `INSERT INTO departments (id, name, head_name, teachers_count, subjects_count, status)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO NOTHING`,
      ['dept-eng', 'Languages & English', 'Tigist Assefa', 2, 1, 'Active'],
    );

    await pool.query(
      `INSERT INTO teachers (id, name, email, phone, department_id, school_id, status, subjects, grades, certification, training_progress, years_experience)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO NOTHING`,
      [
        'tch-english-1',
        'Sarah Thompson',
        'sarah.thompson@prime.edu.et',
        '+251-916-778899',
        'dept-eng',
        'sch-1',
        'Active',
        JSON.stringify(['English Language']),
        JSON.stringify(['Grade 10', 'Grade 11', 'Grade 12']),
        'Cambridge CELTA Certified',
        70,
        8,
      ],
    );

    const passwordHash = await bcrypt.hash('teacher123', 10);
    await pool.query(
      `INSERT INTO portal_users (id, email, password, password_hash, role, display_name, subject, department_id, school_id, linked_student_id)
       VALUES ($1,$2,'',$3,$4,$5,$6,$7,$8,NULL)
       ON CONFLICT (id) DO NOTHING`,
      [
        'usr-teacher-english',
        'sarah.thompson@prime.edu.et',
        passwordHash,
        'teacher',
        'Sarah Thompson',
        'English Language',
        'dept-eng',
        'sch-1',
      ],
    );

    const deptHeadPasswordHash = await bcrypt.hash('dept123', 10);
    await pool.query(
      `INSERT INTO portal_users (id, email, password, password_hash, role, display_name, subject, department_id, school_id, linked_student_id)
       VALUES ($1,$2,'',$3,$4,$5,$6,$7,$8,NULL)
       ON CONFLICT (id) DO NOTHING`,
      [
        'usr-dept-eng',
        'dept.head.eng@prime.edu.et',
        deptHeadPasswordHash,
        'department-head',
        'Tigist Assefa',
        'English Language',
        'dept-eng',
        'sch-1',
      ],
    );

    const check = await pool.query(
      `SELECT id, email, role FROM portal_users WHERE id IN ('usr-teacher-english', 'usr-dept-eng') ORDER BY id`,
    );
    console.log('portal_users rows now present:', check.rows);
    console.log('Done.');
    console.log('  Teacher login:        sarah.thompson@prime.edu.et / teacher123');
    console.log('  Department-head login: dept.head.eng@prime.edu.et / dept123');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
