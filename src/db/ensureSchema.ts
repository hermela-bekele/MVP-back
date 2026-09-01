import { pool } from './pool.js';

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
