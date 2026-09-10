/**
 * Diagnostic only — checks why English portal_user logins might be failing without
 * printing or logging any actual password/hash. Reports, per account:
 *   - whether the row exists
 *   - whether password_hash is set at all
 *   - whether the password we told the user to try ('teacher123' / 'dept123')
 *     actually matches the stored hash
 *
 * Usage: DATABASE_URL="<production connection string>" npx tsx src/db/checkEnglishAuth.ts
 */
import { query, pool } from './pool.js';
import bcrypt from 'bcryptjs';

const CHECKS = [
  { id: 'usr-teacher-english', triedPassword: 'teacher123' },
  { id: 'usr-dept-eng', triedPassword: 'dept123' },
  // Known-working control, for comparison — same checks against a Math account.
  { id: 'usr-teacher', triedPassword: 'teacher123' },
];

async function main() {
  for (const c of CHECKS) {
    const { rows } = await query(
      'SELECT id, email, role, password, password_hash FROM portal_users WHERE id = $1',
      [c.id]
    );
    if (rows.length === 0) {
      console.log(`${c.id}: NOT FOUND`);
      continue;
    }
    const row = rows[0] as { email: string; role: string; password: string | null; password_hash: string | null };
    const hasHash = Boolean(row.password_hash);
    const hasPlain = Boolean(row.password);
    let matchesExpected: string;
    if (hasHash) {
      matchesExpected = (await bcrypt.compare(c.triedPassword, row.password_hash as string))
        ? 'YES — stored hash matches the password we told the user to try'
        : 'NO — stored hash does NOT match that password';
    } else if (hasPlain) {
      matchesExpected = row.password === c.triedPassword
        ? 'YES (plaintext column matches)'
        : 'NO (plaintext column does not match)';
    } else {
      matchesExpected = 'N/A — no password_hash AND no plaintext password set at all';
    }
    console.log(
      `${c.id} (${row.email}, role=${row.role}): password_hash set=${hasHash}, plaintext password set=${hasPlain}, "${c.triedPassword}" matches: ${matchesExpected}`
    );
  }
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
