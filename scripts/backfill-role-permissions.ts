import 'dotenv/config';
import { pool } from '../src/db/pool.js';
import { PERMISSIONS, ROLE_DEFAULT_PERMISSIONS } from '../src/lib/permissions.js';

async function main() {
  for (const p of PERMISSIONS) {
    await pool.query(
      'INSERT INTO permissions (code, label, module, description) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [p.code, p.label, p.module, '']
    );
  }

  const { rows: schools } = await pool.query('SELECT id FROM schools');
  let inserted = 0;
  for (const sch of schools as { id: string }[]) {
    for (const [role, codes] of Object.entries(ROLE_DEFAULT_PERMISSIONS)) {
      for (const code of codes) {
        const r = await pool.query(
          'INSERT INTO role_permissions (role, permission_code, school_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [role, code, sch.id]
        );
        inserted += r.rowCount ?? 0;
      }
    }
  }
  console.log('Backfilled role_permissions rows inserted:', inserted);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
