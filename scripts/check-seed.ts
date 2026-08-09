import { pool } from '../src/db/pool.js';

async function main() {
  try {
    const db = await pool.query('SELECT current_database() AS db, current_user AS user');
    console.log('connected:', db.rows[0]);

    const tables = await pool.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    console.log(
      'public_tables:',
      tables.rows.map((r) => r.tablename),
    );

    if (tables.rows.length === 0) {
      console.log('RESULT: not migrated and not seeded (no tables)');
      return;
    }

    const hasSchools = tables.rows.some((r) => r.tablename === 'schools');
    const hasUsers = tables.rows.some((r) => r.tablename === 'portal_users');
    if (!hasSchools || !hasUsers) {
      console.log('RESULT: schema incomplete — run npm run db:migrate then db:seed');
      return;
    }

    const r = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM schools) AS schools,
        (SELECT COUNT(*)::int FROM portal_users) AS users,
        (SELECT COUNT(*)::int FROM teachers) AS teachers,
        (SELECT COUNT(*)::int FROM students) AS students,
        (SELECT COUNT(*)::int FROM lesson_plans) AS lesson_plans,
        (SELECT COUNT(*)::int FROM teaching_notes) AS teaching_notes
    `);
    console.log('counts:', r.rows[0]);

    const u = await pool.query(
      'SELECT email, role FROM portal_users ORDER BY email LIMIT 8',
    );
    console.log('sample_users:', u.rows);

    const counts = r.rows[0] as Record<string, number>;
    const seeded = (counts.schools ?? 0) > 0 && (counts.users ?? 0) > 0;
    console.log(seeded ? 'RESULT: seeded' : 'RESULT: migrated but not seeded (tables empty)');
  } catch (e) {
    console.error('CHECK_FAILED:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
