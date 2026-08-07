/**
 * Copy all public table data from local Postgres (PG_*) to remote (DATABASE_URL).
 * Usage: npx tsx scripts/copy-local-to-remote.ts
 */
import dotenv from 'dotenv';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { Pool } = pg;

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing ${key}`);
  return v.replace(/^['"]|['"]$/g, '');
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.replace(/^['"]|['"]$/g, '');
  if (!databaseUrl) {
    throw new Error('DATABASE_URL (remote) is required');
  }

  const local = new Pool({
    user: requireEnv('PG_USER_NAME'),
    password: requireEnv('PG_PASSWORD'),
    host: process.env.PG_HOST?.replace(/^['"]|['"]$/g, '') || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432', 10),
    database: requireEnv('PG_DATABASE'),
  });

  const remote = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const localInfo = await local.query('SELECT current_database() AS db');
    const remoteInfo = await remote.query('SELECT current_database() AS db');
    console.log('local DB:', localInfo.rows[0].db);
    console.log('remote DB:', remoteInfo.rows[0].db);

    if (localInfo.rows[0].db === remoteInfo.rows[0].db) {
      throw new Error('Local and remote appear to be the same database — aborting');
    }

    const tablesRes = await local.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    const tables: string[] = tablesRes.rows.map((r) => r.tablename);
    console.log('tables to copy:', tables.length);

    // Ensure remote has schema
    const remoteTables = await remote.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `);
    if (remoteTables.rows.length === 0) {
      throw new Error('Remote has no tables. Run npm run db:migrate against DATABASE_URL first.');
    }

    // Disable FKs, wipe remote data, copy
    await remote.query('BEGIN');
    await remote.query(`
      DO $$ DECLARE r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
          EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);

    // Copy in dependency-friendly order: put base tables first
    const preferred = [
      'schools',
      'departments',
      'teachers',
      'students',
      'school_classes',
      'portal_users',
      'lesson_plans',
      'assessments',
      'attendance',
      'teacher_trainings',
      'school_check_ins',
      'exams',
      'training_materials',
      'teaching_notes',
      'student_grade_entries',
      'teacher_resources',
      'teacher_feedbacks',
      'parent_messages',
      'teacher_check_in_prompts',
      'notifications',
      'academic_calendars',
      'lesson_deliveries',
      'community_posts',
      'community_replies',
      'staff_messages',
      'teacher_self_assessments',
      'teacher_training_assignments',
      'communities',
      'community_members',
      'community_channels',
      'community_channel_reads',
      'community_threads',
      'community_thread_reads',
      'community_messages',
      'community_message_reactions',
      'community_mention_notifications',
    ];
    const ordered = [
      ...preferred.filter((t) => tables.includes(t)),
      ...tables.filter((t) => !preferred.includes(t)),
    ];

    for (const table of ordered) {
      const { rows } = await local.query(`SELECT * FROM public.${quoteIdent(table)}`);
      if (rows.length === 0) {
        console.log(`  ${table}: 0 rows`);
        continue;
      }
      const cols = Object.keys(rows[0]);
      const colList = cols.map(quoteIdent).join(', ');
      let inserted = 0;
      for (const row of rows) {
        const values = cols.map((c) => serializeValue(row[c]));
        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
        await remote.query(
          `INSERT INTO public.${quoteIdent(table)} (${colList}) VALUES (${placeholders})`,
          values,
        );
        inserted += 1;
      }
      console.log(`  ${table}: ${inserted} rows`);
    }

    await remote.query('COMMIT');

    const check = await remote.query(`
      SELECT
        (SELECT COUNT(*)::int FROM lesson_plans) AS lesson_plans,
        (SELECT COUNT(*)::int FROM teaching_notes) AS teaching_notes,
        (SELECT COUNT(*)::int FROM assessments) AS assessments,
        (SELECT COUNT(*)::int FROM academic_calendars) AS calendars,
        (SELECT COUNT(*)::int FROM notifications) AS notifications
    `);
    console.log('remote counts after copy:', check.rows[0]);
    console.log('DONE: local data copied to remote');
  } catch (e) {
    try {
      await remote.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('COPY_FAILED:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    await local.end();
    await remote.end();
  }
}

function serializeValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(v)) return v;
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

function quoteIdent(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe identifier: ${name}`);
  }
  return `"${name}"`;
}

void main();
