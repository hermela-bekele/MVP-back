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
 * Idempotent assessment workflow columns for databases created before reviewer
 * gating and draft saving were introduced.
 */
export async function ensureAssessmentSchema() {
  const statements = [
    `ALTER TABLE assessments ADD COLUMN IF NOT EXISTS covered_teaching_note_ids JSONB NOT NULL DEFAULT '[]'`,
    `ALTER TABLE assessments ADD COLUMN IF NOT EXISTS moderation_rubric JSONB`,
    `ALTER TABLE assessments ADD COLUMN IF NOT EXISTS review_department_id TEXT REFERENCES departments(id) ON DELETE SET NULL`,
    `ALTER TABLE assessments ADD COLUMN IF NOT EXISTS created_by_role TEXT NOT NULL DEFAULT 'teacher'`,
    `CREATE TABLE IF NOT EXISTS assessment_reviewers (
      id TEXT PRIMARY KEY,
      department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
      teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      granted_by TEXT REFERENCES portal_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (department_id, teacher_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_assessment_reviewers_teacher ON assessment_reviewers(teacher_id)`,
    `CREATE INDEX IF NOT EXISTS idx_assessment_reviewers_department ON assessment_reviewers(department_id)`,
  ];
  for (const sql of statements) {
    await pool.query(sql);
  }
}

/**
 * Allow Resigned roster status for MOE departure notices (idempotent).
 */
export async function ensureTeacherStatusSchema() {
  const statements = [
    `ALTER TABLE teachers DROP CONSTRAINT IF EXISTS teachers_status_check`,
    `ALTER TABLE teachers ADD CONSTRAINT teachers_status_check CHECK (status IN ('Active', 'On Leave', 'Left', 'Resigned'))`,
  ];
  for (const sql of statements) {
    await pool.query(sql);
  }
}
