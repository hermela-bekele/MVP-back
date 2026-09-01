import { query, withTransaction } from '../db/pool.js';
import { newId, toDateOnly } from '../lib/ids.js';
import { writeAudit } from '../lib/audit.js';
import type { PoolClient } from 'pg';

export function mapFinancialYear(row: Record<string, unknown>) {
  return {
    id: row.id,
    schoolId: row.school_id,
    name: row.name,
    startDate: toDateOnly(row.start_date as string | Date),
    endDate: toDateOnly(row.end_date as string | Date),
    status: row.status,
    createdAt: row.created_at,
  };
}

export function mapFinancialPeriod(row: Record<string, unknown>) {
  return {
    id: row.id,
    financialYearId: row.financial_year_id,
    schoolId: row.school_id,
    name: row.name,
    startDate: toDateOnly(row.start_date as string | Date),
    endDate: toDateOnly(row.end_date as string | Date),
    status: row.status,
    closedAt: row.closed_at,
    closedBy: row.closed_by,
  };
}

export function mapAccount(row: Record<string, unknown>) {
  return {
    id: row.id,
    schoolId: row.school_id,
    code: row.code,
    name: row.name,
    accountType: row.account_type,
    normalBalance: row.normal_balance,
    parentId: row.parent_id,
    isActive: row.is_active,
    description: row.description,
    createdAt: row.created_at,
  };
}

// ---- Financial years & periods ----

export async function listFinancialYears(schoolId: string) {
  const { rows } = await query(
    `SELECT * FROM financial_years WHERE school_id = $1 ORDER BY start_date DESC`,
    [schoolId]
  );
  return rows.map(mapFinancialYear);
}

export async function getActiveFinancialYear(schoolId: string) {
  const { rows } = await query(
    `SELECT * FROM financial_years WHERE school_id = $1 AND status = 'active' LIMIT 1`,
    [schoolId]
  );
  return rows[0] ? mapFinancialYear(rows[0]) : null;
}

function monthlyPeriods(startDate: string, endDate: string) {
  const periods: { name: string; startDate: string; endDate: string }[] = [];
  let cursor = new Date(startDate);
  const end = new Date(endDate);
  while (cursor <= end) {
    const periodStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const periodEndCandidate = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const periodEnd = periodEndCandidate > end ? end : periodEndCandidate;
    const label = periodStart.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    periods.push({
      name: label,
      startDate: toDateOnly(periodStart < new Date(startDate) ? new Date(startDate) : periodStart),
      endDate: toDateOnly(periodEnd),
    });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return periods;
}

export async function createFinancialYear(opts: {
  schoolId: string;
  name: string;
  startDate: string;
  endDate: string;
  actorUserId?: string;
}) {
  if (new Date(opts.endDate) <= new Date(opts.startDate)) {
    throw Object.assign(new Error('End date must be after start date'), { status: 400 });
  }
  const existing = await query(
    `SELECT id FROM financial_years WHERE school_id = $1 AND name = $2`,
    [opts.schoolId, opts.name]
  );
  if (existing.rows[0]) {
    throw Object.assign(new Error('A financial year with this name already exists'), { status: 409 });
  }

  return withTransaction(async (client: PoolClient) => {
    const id = newId('fy');
    await client.query(
      `INSERT INTO financial_years (id, school_id, name, start_date, end_date, status)
       VALUES ($1,$2,$3,$4,$5,'draft')`,
      [id, opts.schoolId, opts.name, opts.startDate, opts.endDate]
    );
    for (const p of monthlyPeriods(opts.startDate, opts.endDate)) {
      await client.query(
        `INSERT INTO financial_periods (id, financial_year_id, school_id, name, start_date, end_date, status)
         VALUES ($1,$2,$3,$4,$5,$6,'open')`,
        [newId('fp'), id, opts.schoolId, p.name, p.startDate, p.endDate]
      );
    }
    const created = (await client.query('SELECT * FROM financial_years WHERE id = $1', [id])).rows[0];
    await writeAudit({
      schoolId: opts.schoolId,
      actorUserId: opts.actorUserId,
      action: 'finance.financial_year.create',
      entityType: 'financial_year',
      entityId: id,
      metadata: { name: opts.name, startDate: opts.startDate, endDate: opts.endDate },
    });
    return mapFinancialYear(created);
  });
}

export async function activateFinancialYear(id: string, actorUserId?: string) {
  const fy = (await query('SELECT * FROM financial_years WHERE id = $1', [id])).rows[0];
  if (!fy) throw Object.assign(new Error('Financial year not found'), { status: 404 });
  if (fy.status === 'closed') {
    throw Object.assign(new Error('Cannot re-activate a closed financial year'), { status: 400 });
  }

  return withTransaction(async (client: PoolClient) => {
    await client.query(
      `UPDATE financial_years SET status = 'draft', updated_at = NOW() WHERE school_id = $1 AND status = 'active'`,
      [fy.school_id]
    );
    await client.query(
      `UPDATE financial_years SET status = 'active', updated_at = NOW() WHERE id = $1`,
      [id]
    );
    const updated = (await client.query('SELECT * FROM financial_years WHERE id = $1', [id])).rows[0];
    await writeAudit({
      schoolId: fy.school_id,
      actorUserId,
      action: 'finance.financial_year.activate',
      entityType: 'financial_year',
      entityId: id,
    });
    return mapFinancialYear(updated);
  });
}

export async function closeFinancialYear(id: string, actorUserId?: string) {
  const fy = (await query('SELECT * FROM financial_years WHERE id = $1', [id])).rows[0];
  if (!fy) throw Object.assign(new Error('Financial year not found'), { status: 404 });
  const openPeriods = await query(
    `SELECT COUNT(*)::int AS c FROM financial_periods WHERE financial_year_id = $1 AND status = 'open'`,
    [id]
  );
  if (Number(openPeriods.rows[0].c) > 0) {
    throw Object.assign(
      new Error('Close all financial periods in this year before closing the year'),
      { status: 400 }
    );
  }
  await query(`UPDATE financial_years SET status = 'closed', updated_at = NOW() WHERE id = $1`, [id]);
  await writeAudit({
    schoolId: fy.school_id,
    actorUserId,
    action: 'finance.financial_year.close',
    entityType: 'financial_year',
    entityId: id,
  });
  return mapFinancialYear((await query('SELECT * FROM financial_years WHERE id = $1', [id])).rows[0]);
}

export async function listFinancialPeriods(schoolId: string, financialYearId?: string) {
  const params: unknown[] = [schoolId];
  let where = 'school_id = $1';
  if (financialYearId) {
    params.push(financialYearId);
    where += ` AND financial_year_id = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT * FROM financial_periods WHERE ${where} ORDER BY start_date ASC`,
    params
  );
  return rows.map(mapFinancialPeriod);
}

export async function closeFinancialPeriod(id: string, actorUserId?: string) {
  const fp = (await query('SELECT * FROM financial_periods WHERE id = $1', [id])).rows[0];
  if (!fp) throw Object.assign(new Error('Financial period not found'), { status: 404 });
  if (fp.status === 'closed') {
    throw Object.assign(new Error('Period is already closed'), { status: 400 });
  }
  await query(
    `UPDATE financial_periods SET status = 'closed', closed_at = NOW(), closed_by = $1 WHERE id = $2`,
    [actorUserId ?? null, id]
  );
  await writeAudit({
    schoolId: fp.school_id,
    actorUserId,
    action: 'finance.period.close',
    entityType: 'financial_period',
    entityId: id,
  });
  return mapFinancialPeriod((await query('SELECT * FROM financial_periods WHERE id = $1', [id])).rows[0]);
}

export async function reopenFinancialPeriod(id: string, actorUserId?: string) {
  const fp = (await query('SELECT * FROM financial_periods WHERE id = $1', [id])).rows[0];
  if (!fp) throw Object.assign(new Error('Financial period not found'), { status: 404 });
  if (fp.status === 'open') {
    throw Object.assign(new Error('Period is already open'), { status: 400 });
  }
  await query(
    `UPDATE financial_periods SET status = 'open', closed_at = NULL, closed_by = NULL WHERE id = $1`,
    [id]
  );
  await writeAudit({
    schoolId: fp.school_id,
    actorUserId,
    action: 'finance.period.reopen',
    entityType: 'financial_period',
    entityId: id,
  });
  return mapFinancialPeriod((await query('SELECT * FROM financial_periods WHERE id = $1', [id])).rows[0]);
}

// ---- Chart of accounts ----

export async function listAccounts(schoolId: string) {
  const { rows } = await query(
    `SELECT * FROM chart_of_accounts WHERE school_id = $1 ORDER BY code ASC`,
    [schoolId]
  );
  return rows.map(mapAccount);
}

export async function createAccount(opts: {
  schoolId: string;
  code: string;
  name: string;
  accountType: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  normalBalance?: 'debit' | 'credit';
  parentId?: string | null;
  description?: string;
  actorUserId?: string;
}) {
  const existing = await query(
    `SELECT id FROM chart_of_accounts WHERE school_id = $1 AND code = $2`,
    [opts.schoolId, opts.code]
  );
  if (existing.rows[0]) {
    throw Object.assign(new Error(`Account code ${opts.code} already exists`), { status: 409 });
  }
  const normalBalance =
    opts.normalBalance ?? (opts.accountType === 'asset' || opts.accountType === 'expense' ? 'debit' : 'credit');
  const id = newId('acc');
  await query(
    `INSERT INTO chart_of_accounts (id, school_id, code, name, account_type, normal_balance, parent_id, description)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, opts.schoolId, opts.code, opts.name, opts.accountType, normalBalance, opts.parentId ?? null, opts.description ?? null]
  );
  await writeAudit({
    schoolId: opts.schoolId,
    actorUserId: opts.actorUserId,
    action: 'finance.account.create',
    entityType: 'chart_of_account',
    entityId: id,
    metadata: { code: opts.code, name: opts.name },
  });
  return mapAccount((await query('SELECT * FROM chart_of_accounts WHERE id = $1', [id])).rows[0]);
}

export async function updateAccount(
  id: string,
  updates: { name?: string; description?: string; isActive?: boolean },
  actorUserId?: string
) {
  const acc = (await query('SELECT * FROM chart_of_accounts WHERE id = $1', [id])).rows[0];
  if (!acc) throw Object.assign(new Error('Account not found'), { status: 404 });
  await query(
    `UPDATE chart_of_accounts SET
       name = COALESCE($1, name),
       description = COALESCE($2, description),
       is_active = COALESCE($3, is_active),
       updated_at = NOW()
     WHERE id = $4`,
    [updates.name ?? null, updates.description ?? null, updates.isActive ?? null, id]
  );
  await writeAudit({
    schoolId: acc.school_id,
    actorUserId,
    action: 'finance.account.update',
    entityType: 'chart_of_account',
    entityId: id,
    metadata: updates as Record<string, unknown>,
  });
  return mapAccount((await query('SELECT * FROM chart_of_accounts WHERE id = $1', [id])).rows[0]);
}

const DEFAULT_CHART_OF_ACCOUNTS: {
  code: string;
  name: string;
  accountType: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  parentCode?: string;
}[] = [
  { code: '1000', name: 'Assets', accountType: 'asset' },
  { code: '1100', name: 'Cash', accountType: 'asset', parentCode: '1000' },
  { code: '1200', name: 'Bank', accountType: 'asset', parentCode: '1000' },
  { code: '1300', name: 'Accounts Receivable', accountType: 'asset', parentCode: '1000' },
  { code: '2000', name: 'Liabilities', accountType: 'liability' },
  { code: '2100', name: 'Accounts Payable', accountType: 'liability', parentCode: '2000' },
  { code: '2200', name: 'Payroll Payable', accountType: 'liability', parentCode: '2000' },
  { code: '4000', name: 'Revenue', accountType: 'revenue' },
  { code: '4100', name: 'Tuition', accountType: 'revenue', parentCode: '4000' },
  { code: '4200', name: 'Transportation', accountType: 'revenue', parentCode: '4000' },
  { code: '4300', name: 'Other Revenue', accountType: 'revenue', parentCode: '4000' },
  { code: '5000', name: 'Expenses', accountType: 'expense' },
  { code: '5100', name: 'Salaries', accountType: 'expense', parentCode: '5000' },
  { code: '5200', name: 'Utilities', accountType: 'expense', parentCode: '5000' },
  { code: '5300', name: 'Supplies', accountType: 'expense', parentCode: '5000' },
  { code: '5400', name: 'Maintenance', accountType: 'expense', parentCode: '5000' },
];

/** Idempotent — inserts only account codes that don't already exist for this school. */
export async function seedDefaultChartOfAccounts(schoolId: string, actorUserId?: string) {
  return withTransaction(async (client: PoolClient) => {
    const codeToId = new Map<string, string>();
    let insertedCount = 0;
    for (const entry of DEFAULT_CHART_OF_ACCOUNTS) {
      const existing = await client.query(
        `SELECT id FROM chart_of_accounts WHERE school_id = $1 AND code = $2`,
        [schoolId, entry.code]
      );
      if (existing.rows[0]) {
        codeToId.set(entry.code, existing.rows[0].id);
        continue;
      }
      const id = newId('acc');
      const parentId = entry.parentCode ? codeToId.get(entry.parentCode) ?? null : null;
      const normalBalance = entry.accountType === 'asset' || entry.accountType === 'expense' ? 'debit' : 'credit';
      await client.query(
        `INSERT INTO chart_of_accounts (id, school_id, code, name, account_type, normal_balance, parent_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, schoolId, entry.code, entry.name, entry.accountType, normalBalance, parentId]
      );
      codeToId.set(entry.code, id);
      insertedCount += 1;
    }
    if (insertedCount > 0) {
      await writeAudit({
        schoolId,
        actorUserId,
        action: 'finance.account.seed_defaults',
        entityType: 'chart_of_account',
        metadata: { insertedCount },
      });
    }
    const { rows } = await client.query(
      `SELECT * FROM chart_of_accounts WHERE school_id = $1 ORDER BY code ASC`,
      [schoolId]
    );
    return { accounts: rows.map(mapAccount), insertedCount };
  });
}
