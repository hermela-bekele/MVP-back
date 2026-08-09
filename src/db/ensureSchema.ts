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
