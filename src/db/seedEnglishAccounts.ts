/**
 * Non-destructive top-up: adds the English department, its teacher, and department-head
 * login accounts if they don't already exist — without touching anything else in the
 * database. Safe to run against a live production database with real data, unlike
 * `db:seed` (which truncates and rebuilds every table from the demo dataset).
 *
 * Every insert uses a bare `ON CONFLICT DO NOTHING` (not `ON CONFLICT (id)`) because both
 * `teachers.email` and `portal_users.email` are independently UNIQUE — a plain `(id)` target
 * would still throw if the email already exists under a different id.
 *
 * Usage (against production, one-off — never write DATABASE_URL into .env):
 *   DATABASE_URL="<production connection string>" npx tsx src/db/seedEnglishAccounts.ts
 */
import { pool, query } from './pool.js';
import bcrypt from 'bcryptjs';

async function main() {
  const summary: string[] = [];

  // 1. English department (matches mockDepartments' 'dept-eng' entry in lib/mockData.ts).
  const deptResult = await query(
    `INSERT INTO departments (id, name, head_name, teachers_count, subjects_count, status)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id`,
    ['dept-eng', 'Languages & English', 'Tigist Assefa', 2, 1, 'Active']
  );
  summary.push(`departments.dept-eng: ${deptResult.rowCount ? 'inserted' : 'already existed'}`);

  // 2. English teacher directory record (matches mockTeachers' 'tch-english-1' entry).
  const teacherResult = await query(
    `INSERT INTO teachers (id, name, email, phone, department_id, school_id, status, subjects, grades, certification, training_progress, years_experience)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING RETURNING id`,
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
    ]
  );
  summary.push(`teachers.tch-english-1: ${teacherResult.rowCount ? 'inserted' : 'already existed'}`);

  // 3. English teacher's portal login (matches PORTAL_USERS' 'usr-teacher-english' entry).
  const teacherPasswordHash = await bcrypt.hash('teacher123', 10);
  const teacherLoginResult = await query(
    `INSERT INTO portal_users (id, email, password, password_hash, role, display_name, subject, department_id, school_id, linked_student_id)
     VALUES ($1,$2,'',$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id`,
    ['usr-teacher-english', 'sarah.thompson@prime.edu.et', teacherPasswordHash, 'teacher', 'Sarah Thompson', 'English Language', 'dept-eng', 'sch-1', null]
  );
  summary.push(`portal_users.usr-teacher-english: ${teacherLoginResult.rowCount ? 'inserted' : 'already existed'}`);

  // 4. English department-head login — never existed in seed.ts at all (only Math's 'usr-dept'
  //    and Biology's 'usr-dept-bio' did), even though 'dept-eng' already names "Tigist Assefa"
  //    as its head. Mirrors 'usr-dept-bio's shape exactly.
  const deptHeadPasswordHash = await bcrypt.hash('dept123', 10);
  const deptHeadResult = await query(
    `INSERT INTO portal_users (id, email, password, password_hash, role, display_name, subject, department_id, school_id, linked_student_id)
     VALUES ($1,$2,'',$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id`,
    ['usr-dept-eng', 'dept.head.english@prime.edu.et', deptHeadPasswordHash, 'department-head', 'Tigist Assefa', 'English Language', 'dept-eng', 'sch-1', null]
  );
  summary.push(`portal_users.usr-dept-eng: ${deptHeadResult.rowCount ? 'inserted' : 'already existed'}`);

  console.log(summary.join('\n'));
  console.log('\nLogin credentials (only for rows that were actually inserted just now):');
  console.log('  Teacher:         sarah.thompson@prime.edu.et / teacher123');
  console.log('  Department head: dept.head.english@prime.edu.et / dept123');
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('Failed:', err);
    await pool.end();
    process.exit(1);
  });
