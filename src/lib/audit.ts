import { newId } from './ids.js';
import { query } from '../db/pool.js';

export async function writeAudit(opts: {
  schoolId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    await query(
      `INSERT INTO audit_logs (id, school_id, actor_user_id, action, entity_type, entity_id, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        newId('aud'),
        opts.schoolId ?? null,
        opts.actorUserId ?? null,
        opts.action,
        opts.entityType,
        opts.entityId ?? null,
        JSON.stringify(opts.metadata ?? {}),
      ]
    );
  } catch (err) {
    console.error('[audit] failed to write', err);
  }
}
