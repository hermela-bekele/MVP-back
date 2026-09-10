import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Idempotent auth-column fixes so login/register work even if
 * schema_portal.sql was never applied on the deployed database.
 */
export async function ensurePortalAuthSchema() {
  const statements = [
    `ALTER TABLE portal_users ADD COLUMN IF NOT EXISTS school_id TEXT`,
    `ALTER TABLE portal_users ADD COLUMN IF NOT EXISTS password_hash TEXT`,
    `ALTER TABLE portal_users ADD COLUMN IF NOT EXISTS linked_student_id TEXT`,
    `ALTER TABLE portal_users ADD COLUMN IF NOT EXISTS linked_parent_id TEXT`,
    `ALTER TABLE portal_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`,
    `ALTER TABLE portal_users ALTER COLUMN password DROP NOT NULL`,
  ];
  for (const sql of statements) {
    await pool.query(sql);
  }
}

/**
 * Idempotent creation of the registration-form-templates feature so it works even if
 * schema_portal.sql was never re-applied on the deployed database.
 */
export async function ensureRegistrationFormsSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS registration_form_templates (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      code TEXT NOT NULL UNIQUE,
      fields JSONB NOT NULL DEFAULT '[]',
      required_documents JSONB NOT NULL DEFAULT '[]',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT REFERENCES portal_users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `ALTER TABLE admission_applications ADD COLUMN IF NOT EXISTS form_template_id TEXT REFERENCES registration_form_templates(id)`,
  ];
  for (const sql of statements) {
    await pool.query(sql);
  }
}

/**
 * Idempotent creation of the academic-results / report-card / transcript feature
 * (subject_term_results, student_term_summaries, report_templates + seeded Ethiopian
 * defaults) so it works even if schema_academics.sql was never re-applied on the
 * deployed database.
 */
export async function ensureAcademicResultsSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema_academics.sql'), 'utf-8');
  await pool.query(sql);
}

/**
 * Idempotent teacher-status + MOE replacement request tables for Public-school
 * departure / assignment workflow.
 */
export async function ensureTeacherStaffingSchema() {
  const statements = [
    `DO $$ BEGIN
       ALTER TABLE teachers DROP CONSTRAINT IF EXISTS teachers_status_check;
       ALTER TABLE teachers ADD CONSTRAINT teachers_status_check CHECK (status IN ('Active', 'On Leave', 'Left'));
     EXCEPTION
       WHEN duplicate_object THEN NULL;
     END $$`,
    `CREATE TABLE IF NOT EXISTS teacher_replacement_requests (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      departing_teacher_id TEXT NOT NULL REFERENCES teachers(id),
      departure_date DATE NOT NULL,
      reason TEXT NOT NULL CHECK (reason IN ('resignation', 'transfer', 'retirement', 'other')),
      subjects_needed JSONB NOT NULL DEFAULT '[]',
      grade_levels_needed JSONB NOT NULL DEFAULT '[]',
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'under_review', 'assigned', 'rejected', 'cancelled')),
      assigned_teacher_id TEXT REFERENCES teachers(id),
      moe_reviewed_by TEXT REFERENCES portal_users(id),
      moe_notes TEXT,
      moe_thread_id TEXT REFERENCES moe_message_threads(id),
      created_by TEXT REFERENCES portal_users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    )`,
    `CREATE INDEX IF NOT EXISTS idx_teacher_replacement_requests_school
      ON teacher_replacement_requests(school_id, status, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_teacher_replacement_requests_status
      ON teacher_replacement_requests(status, created_at DESC)`,
    `INSERT INTO permissions (code, label, module, description)
     VALUES
       ('staffing.request', 'Request MOE teacher replacement (Public schools)', 'hr', ''),
       ('staffing.assign', 'Assign / transfer teachers for Public schools', 'hr', '')
     ON CONFLICT (code) DO NOTHING`,
    `INSERT INTO role_permissions (role, permission_code, school_id)
     SELECT 'school-head', 'staffing.request', id FROM schools
     ON CONFLICT DO NOTHING`,
  ];
  for (const sql of statements) {
    await pool.query(sql);
  }
}
