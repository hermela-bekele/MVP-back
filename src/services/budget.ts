import { query, withTransaction } from '../db/pool.js';
import { newId } from '../lib/ids.js';
import { writeAudit } from '../lib/audit.js';
import type { PoolClient } from 'pg';

const EDITABLE_STATUSES = ['draft', 'returned'];
/** The chart-of-accounts code the default seed uses for salaries — the account whose "actual"
 * is computed from real payroll_records data (in addition to any paid expenses/invoices that
 * also happen to post to it). Every other account's actual comes solely from paid expenses and
 * supplier invoices — see computeAccountActuals. */
const SALARY_ACCOUNT_CODE = '5100';

export function mapBudget(row: Record<string, unknown>) {
  return {
    id: row.id,
    schoolId: row.school_id,
    financialYearId: row.financial_year_id,
    name: row.name,
    status: row.status,
    version: row.version,
    revisedFromBudgetId: row.revised_from_budget_id,
    notes: row.notes,
    createdBy: row.created_by,
    submittedAt: row.submitted_at,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    decisionReason: row.decision_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapBudgetLine(row: Record<string, unknown>) {
  return {
    id: row.id,
    budgetId: row.budget_id,
    schoolId: row.school_id,
    department: row.department,
    accountId: row.account_id,
    accountCode: row.account_code as string | undefined,
    accountName: row.account_name as string | undefined,
    allocatedAmount: Number(row.allocated_amount),
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export function mapBudgetTransfer(row: Record<string, unknown>) {
  return {
    id: row.id,
    schoolId: row.school_id,
    budgetId: row.budget_id,
    fromLineId: row.from_line_id,
    toLineId: row.to_line_id,
    amount: Number(row.amount),
    reason: row.reason,
    status: row.status,
    requestedBy: row.requested_by,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    decisionReason: row.decision_reason,
    createdAt: row.created_at,
  };
}

async function getBudgetRow(id: string) {
  const row = (await query('SELECT * FROM budgets WHERE id = $1', [id])).rows[0];
  if (!row) throw Object.assign(new Error('Budget not found'), { status: 404 });
  return row;
}

export async function listBudgets(schoolId: string, financialYearId?: string) {
  const params: unknown[] = [schoolId];
  let where = 'school_id = $1';
  if (financialYearId) {
    params.push(financialYearId);
    where += ` AND financial_year_id = $${params.length}`;
  }
  const { rows } = await query(`SELECT * FROM budgets WHERE ${where} ORDER BY created_at DESC`, params);
  return rows.map(mapBudget);
}

async function listBudgetLines(budgetId: string) {
  const { rows } = await query(
    `SELECT bl.*, coa.code AS account_code, coa.name AS account_name
     FROM budget_lines bl
     JOIN chart_of_accounts coa ON coa.id = bl.account_id
     WHERE bl.budget_id = $1
     ORDER BY bl.department, coa.code`,
    [budgetId]
  );
  return rows.map(mapBudgetLine);
}

async function listBudgetTransfers(budgetId: string) {
  const { rows } = await query(
    `SELECT * FROM budget_transfers WHERE budget_id = $1 ORDER BY created_at DESC`,
    [budgetId]
  );
  return rows.map(mapBudgetTransfer);
}

export async function getBudget(id: string) {
  const row = await getBudgetRow(id);
  const [lines, transfers] = await Promise.all([listBudgetLines(id), listBudgetTransfers(id)]);
  return { ...mapBudget(row), lines, transfers };
}

export async function createBudget(opts: {
  schoolId: string;
  financialYearId: string;
  name: string;
  actorUserId?: string;
}) {
  const fy = (await query('SELECT * FROM financial_years WHERE id = $1', [opts.financialYearId])).rows[0];
  if (!fy) throw Object.assign(new Error('Financial year not found'), { status: 404 });

  const id = newId('bud');
  await query(
    `INSERT INTO budgets (id, school_id, financial_year_id, name, status, created_by)
     VALUES ($1,$2,$3,$4,'draft',$5)`,
    [id, opts.schoolId, opts.financialYearId, opts.name, opts.actorUserId ?? null]
  );
  await writeAudit({
    schoolId: opts.schoolId,
    actorUserId: opts.actorUserId,
    action: 'finance.budget.create',
    entityType: 'budget',
    entityId: id,
    metadata: { name: opts.name, financialYearId: opts.financialYearId },
  });
  return getBudget(id);
}

function assertEditable(budget: Record<string, unknown>) {
  if (!EDITABLE_STATUSES.includes(budget.status as string)) {
    throw Object.assign(
      new Error(`Budget lines can only be edited while the budget is draft or returned (currently ${budget.status})`),
      { status: 400 }
    );
  }
}

export async function addBudgetLine(
  budgetId: string,
  opts: { department: string; accountId: string; allocatedAmount: number; notes?: string },
  actorUserId?: string
) {
  const budget = await getBudgetRow(budgetId);
  assertEditable(budget);
  if (opts.allocatedAmount < 0) {
    throw Object.assign(new Error('Allocated amount cannot be negative'), { status: 400 });
  }
  const account = (await query('SELECT * FROM chart_of_accounts WHERE id = $1', [opts.accountId])).rows[0];
  if (!account) throw Object.assign(new Error('Account not found'), { status: 404 });
  if (account.account_type !== 'expense') {
    throw Object.assign(new Error('Budget lines must post to an expense account'), { status: 400 });
  }

  const id = newId('bl');
  await query(
    `INSERT INTO budget_lines (id, budget_id, school_id, department, account_id, allocated_amount, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, budgetId, budget.school_id, opts.department, opts.accountId, opts.allocatedAmount, opts.notes ?? null]
  );
  await writeAudit({
    schoolId: budget.school_id,
    actorUserId,
    action: 'finance.budget.add_line',
    entityType: 'budget_line',
    entityId: id,
    metadata: { budgetId, department: opts.department, accountId: opts.accountId, allocatedAmount: opts.allocatedAmount },
  });
  return getBudget(budgetId);
}

export async function updateBudgetLine(
  lineId: string,
  updates: { allocatedAmount?: number; notes?: string },
  actorUserId?: string
) {
  const line = (await query('SELECT * FROM budget_lines WHERE id = $1', [lineId])).rows[0];
  if (!line) throw Object.assign(new Error('Budget line not found'), { status: 404 });
  const budget = await getBudgetRow(line.budget_id);
  assertEditable(budget);
  if (updates.allocatedAmount !== undefined && updates.allocatedAmount < 0) {
    throw Object.assign(new Error('Allocated amount cannot be negative'), { status: 400 });
  }
  await query(
    `UPDATE budget_lines SET
       allocated_amount = COALESCE($1, allocated_amount),
       notes = COALESCE($2, notes),
       updated_at = NOW()
     WHERE id = $3`,
    [updates.allocatedAmount ?? null, updates.notes ?? null, lineId]
  );
  await writeAudit({
    schoolId: budget.school_id,
    actorUserId,
    action: 'finance.budget.update_line',
    entityType: 'budget_line',
    entityId: lineId,
    metadata: updates as Record<string, unknown>,
  });
  return getBudget(line.budget_id);
}

export async function removeBudgetLine(lineId: string, actorUserId?: string) {
  const line = (await query('SELECT * FROM budget_lines WHERE id = $1', [lineId])).rows[0];
  if (!line) throw Object.assign(new Error('Budget line not found'), { status: 404 });
  const budget = await getBudgetRow(line.budget_id);
  assertEditable(budget);
  await query('DELETE FROM budget_lines WHERE id = $1', [lineId]);
  await writeAudit({
    schoolId: budget.school_id,
    actorUserId,
    action: 'finance.budget.remove_line',
    entityType: 'budget_line',
    entityId: lineId,
    metadata: { budgetId: line.budget_id },
  });
  return getBudget(line.budget_id);
}

export async function submitBudget(id: string, actorUserId?: string) {
  const budget = await getBudgetRow(id);
  if (!EDITABLE_STATUSES.includes(budget.status)) {
    throw Object.assign(new Error(`Cannot submit a budget with status ${budget.status}`), { status: 400 });
  }
  const lineCount = await query('SELECT COUNT(*)::int AS c FROM budget_lines WHERE budget_id = $1', [id]);
  if (Number(lineCount.rows[0].c) === 0) {
    throw Object.assign(new Error('Add at least one budget line before submitting'), { status: 400 });
  }
  await query(
    `UPDATE budgets SET status = 'submitted', submitted_at = NOW(), updated_at = NOW(), decision_reason = NULL WHERE id = $1`,
    [id]
  );
  await writeAudit({
    schoolId: budget.school_id,
    actorUserId,
    action: 'finance.budget.submit',
    entityType: 'budget',
    entityId: id,
  });
  return getBudget(id);
}

async function decideBudget(
  id: string,
  status: 'approved' | 'rejected' | 'returned',
  actorUserId?: string,
  reason?: string
) {
  const budget = await getBudgetRow(id);
  if (!['submitted', 'under_review'].includes(budget.status)) {
    throw Object.assign(new Error(`Cannot decide on a budget with status ${budget.status}`), { status: 400 });
  }
  await query(
    `UPDATE budgets SET status = $1, decided_by = $2, decided_at = NOW(), decision_reason = $3, updated_at = NOW() WHERE id = $4`,
    [status, actorUserId ?? null, reason ?? null, id]
  );
  await writeAudit({
    schoolId: budget.school_id,
    actorUserId,
    action: `finance.budget.${status}`,
    entityType: 'budget',
    entityId: id,
    metadata: reason ? { reason } : undefined,
  });
  return getBudget(id);
}

export const approveBudget = (id: string, actorUserId?: string) => decideBudget(id, 'approved', actorUserId);
export const rejectBudget = (id: string, reason: string, actorUserId?: string) =>
  decideBudget(id, 'rejected', actorUserId, reason);
export const returnBudget = (id: string, reason: string, actorUserId?: string) =>
  decideBudget(id, 'returned', actorUserId, reason);

export async function reviseBudget(id: string, actorUserId?: string) {
  const source = await getBudgetRow(id);
  const lines = await listBudgetLines(id);
  return withTransaction(async (client: PoolClient) => {
    const newBudgetId = newId('bud');
    await client.query(
      `INSERT INTO budgets (id, school_id, financial_year_id, name, status, version, revised_from_budget_id, created_by)
       VALUES ($1,$2,$3,$4,'draft',$5,$6,$7)`,
      [newBudgetId, source.school_id, source.financial_year_id, source.name, Number(source.version) + 1, id, actorUserId ?? null]
    );
    for (const line of lines) {
      await client.query(
        `INSERT INTO budget_lines (id, budget_id, school_id, department, account_id, allocated_amount, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [newId('bl'), newBudgetId, source.school_id, line.department, line.accountId, line.allocatedAmount, line.notes ?? null]
      );
    }
    await writeAudit({
      schoolId: source.school_id,
      actorUserId,
      action: 'finance.budget.revise',
      entityType: 'budget',
      entityId: newBudgetId,
      metadata: { revisedFromBudgetId: id, version: Number(source.version) + 1 },
    });
    return newBudgetId;
  }).then((newBudgetId) => getBudget(newBudgetId));
}

// ---- Budget transfers ----

export async function createBudgetTransfer(opts: {
  schoolId: string;
  budgetId: string;
  fromLineId: string;
  toLineId: string;
  amount: number;
  reason: string;
  actorUserId?: string;
}) {
  if (opts.amount <= 0) throw Object.assign(new Error('Transfer amount must be positive'), { status: 400 });
  if (opts.fromLineId === opts.toLineId) {
    throw Object.assign(new Error('Source and destination lines must differ'), { status: 400 });
  }
  const budget = await getBudgetRow(opts.budgetId);
  if (budget.status !== 'approved') {
    throw Object.assign(new Error('Transfers can only be requested against an approved budget'), { status: 400 });
  }
  const fromLine = (await query('SELECT * FROM budget_lines WHERE id = $1 AND budget_id = $2', [opts.fromLineId, opts.budgetId])).rows[0];
  const toLine = (await query('SELECT * FROM budget_lines WHERE id = $1 AND budget_id = $2', [opts.toLineId, opts.budgetId])).rows[0];
  if (!fromLine || !toLine) throw Object.assign(new Error('Budget line not found on this budget'), { status: 404 });
  if (Number(fromLine.allocated_amount) < opts.amount) {
    throw Object.assign(new Error('Transfer amount exceeds the source line’s allocated amount'), { status: 400 });
  }

  const id = newId('bxf');
  await query(
    `INSERT INTO budget_transfers (id, school_id, budget_id, from_line_id, to_line_id, amount, reason, status, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8)`,
    [id, opts.schoolId, opts.budgetId, opts.fromLineId, opts.toLineId, opts.amount, opts.reason, opts.actorUserId ?? null]
  );
  await writeAudit({
    schoolId: opts.schoolId,
    actorUserId: opts.actorUserId,
    action: 'finance.budget_transfer.request',
    entityType: 'budget_transfer',
    entityId: id,
    metadata: { budgetId: opts.budgetId, fromLineId: opts.fromLineId, toLineId: opts.toLineId, amount: opts.amount },
  });
  return mapBudgetTransfer((await query('SELECT * FROM budget_transfers WHERE id = $1', [id])).rows[0]);
}

async function decideBudgetTransfer(
  id: string,
  status: 'approved' | 'rejected',
  actorUserId?: string,
  reason?: string
) {
  const transfer = (await query('SELECT * FROM budget_transfers WHERE id = $1', [id])).rows[0];
  if (!transfer) throw Object.assign(new Error('Transfer not found'), { status: 404 });
  if (transfer.status !== 'pending') {
    throw Object.assign(new Error(`Transfer already ${transfer.status}`), { status: 400 });
  }

  return withTransaction(async (client: PoolClient) => {
    if (status === 'approved') {
      const fromLine = (await client.query('SELECT * FROM budget_lines WHERE id = $1 FOR UPDATE', [transfer.from_line_id])).rows[0];
      if (!fromLine || Number(fromLine.allocated_amount) < Number(transfer.amount)) {
        throw Object.assign(new Error('Source line no longer has sufficient allocated funds for this transfer'), { status: 400 });
      }
      await client.query('UPDATE budget_lines SET allocated_amount = allocated_amount - $1, updated_at = NOW() WHERE id = $2', [
        transfer.amount,
        transfer.from_line_id,
      ]);
      await client.query('UPDATE budget_lines SET allocated_amount = allocated_amount + $1, updated_at = NOW() WHERE id = $2', [
        transfer.amount,
        transfer.to_line_id,
      ]);
    }
    await client.query(
      `UPDATE budget_transfers SET status = $1, decided_by = $2, decided_at = NOW(), decision_reason = $3 WHERE id = $4`,
      [status, actorUserId ?? null, reason ?? null, id]
    );
    await writeAudit({
      schoolId: transfer.school_id,
      actorUserId,
      action: `finance.budget_transfer.${status}`,
      entityType: 'budget_transfer',
      entityId: id,
      metadata: { amount: Number(transfer.amount), reason },
    });
    return mapBudgetTransfer((await client.query('SELECT * FROM budget_transfers WHERE id = $1', [id])).rows[0]);
  });
}

export const approveBudgetTransfer = (id: string, actorUserId?: string) =>
  decideBudgetTransfer(id, 'approved', actorUserId);
export const rejectBudgetTransfer = (id: string, reason: string, actorUserId?: string) =>
  decideBudgetTransfer(id, 'rejected', actorUserId, reason);

// ---- Budget control (used by Expenses and Accounts Payable before they post) ----

/** The approved budget line — if any — that a department/account combo should be checked against
 * for the school's currently active financial year. Returns null when there's no active budget or
 * no matching line, in which case callers skip budget enforcement rather than blocking blindly. */
export async function resolveApprovedBudgetLine(schoolId: string, department: string, accountId: string) {
  const { rows } = await query(
    `SELECT bl.*, coa.code AS account_code, coa.name AS account_name
     FROM budget_lines bl
     JOIN budgets b ON b.id = bl.budget_id
     JOIN financial_years fy ON fy.id = b.financial_year_id
     JOIN chart_of_accounts coa ON coa.id = bl.account_id
     WHERE b.school_id = $1 AND b.status = 'approved' AND fy.status = 'active'
       AND bl.department = $2 AND bl.account_id = $3
     LIMIT 1`,
    [schoolId, department, accountId]
  );
  return rows[0] ? mapBudgetLine(rows[0]) : null;
}

/** Real actual-so-far for one department/account combo, from paid expenses and the paid portion
 * of supplier invoices (plus payroll, if this happens to be the salary account). Used both for
 * budget-vs-actual reporting and to enforce "don't exceed remaining budget" before a new
 * expense/invoice is submitted. */
async function actualForLine(schoolId: string, department: string, accountId: string, accountCode: string, financialYearId: string) {
  const [expenseRow, invoiceRow] = await Promise.all([
    query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::float AS total FROM expenses
       WHERE school_id = $1 AND department = $2 AND account_id = $3 AND status = 'paid'`,
      [schoolId, department, accountId]
    ),
    query<{ total: string }>(
      `SELECT COALESCE(SUM(amount_paid), 0)::float AS total FROM supplier_invoices
       WHERE school_id = $1 AND department = $2 AND account_id = $3 AND status <> 'cancelled'`,
      [schoolId, department, accountId]
    ),
  ]);
  let total = Number(expenseRow.rows[0].total) + Number(invoiceRow.rows[0].total);
  if (accountCode === SALARY_ACCOUNT_CODE) {
    const fy = (await query('SELECT * FROM financial_years WHERE id = $1', [financialYearId])).rows[0];
    if (fy) {
      const payroll = await query<{ total: string }>(
        `SELECT COALESCE(SUM(pr.net_pay), 0)::float AS total
         FROM payroll_records pr
         JOIN hr_employees he ON he.id = pr.employee_id
         WHERE pr.school_id = $1 AND he.department = $2 AND pr.status IN ('Processed', 'Paid')
           AND to_date(pr.month || '-01', 'YYYY-MM-DD') BETWEEN $3 AND $4`,
        [schoolId, department, fy.start_date, fy.end_date]
      );
      total += Number(payroll.rows[0].total);
    }
  }
  return total;
}

/** Throws 400 if posting `amount` against this line would exceed its remaining allocation.
 * A null budgetLine means no budget covers this department/account — nothing to enforce. */
export async function assertWithinBudget(
  budgetLine: Awaited<ReturnType<typeof resolveApprovedBudgetLine>>,
  schoolId: string,
  amount: number
) {
  if (!budgetLine) return;
  const budget = await getBudgetRow(budgetLine.budgetId as string);
  const actualSoFar = await actualForLine(
    schoolId,
    budgetLine.department as string,
    budgetLine.accountId as string,
    budgetLine.accountCode as string,
    budget.financial_year_id
  );
  const remaining = budgetLine.allocatedAmount - actualSoFar;
  if (amount > remaining) {
    throw Object.assign(
      new Error(
        `This exceeds the remaining budget for ${budgetLine.department} / ${budgetLine.accountName ?? budgetLine.accountCode}: ${remaining.toLocaleString()} remaining, ${amount.toLocaleString()} requested`
      ),
      { status: 400 }
    );
  }
}

// ---- Utilization (budget vs. actual) ----

export async function getBudgetUtilization(id: string) {
  const budget = await getBudgetRow(id);
  const [lines, transfers] = await Promise.all([listBudgetLines(id), listBudgetTransfers(id)]);

  const lineUtilization = await Promise.all(
    lines.map(async (line) => {
      const actual = await actualForLine(
        budget.school_id,
        line.department as string,
        line.accountId as string,
        line.accountCode as string,
        budget.financial_year_id
      );
      const committed = 0; // No purchase-commitment source exists yet (arrives with full Procurement).
      const remaining = Math.max(line.allocatedAmount - committed - actual, 0);
      const variance = line.allocatedAmount - actual;
      const utilizationPct = line.allocatedAmount > 0 ? Math.round((actual / line.allocatedAmount) * 1000) / 10 : 0;
      return {
        ...line,
        committed,
        actual,
        remaining,
        variance,
        utilizationPct,
        actualTrackingAvailable: true,
      };
    })
  );

  const totals = lineUtilization.reduce(
    (acc, l) => ({
      allocated: acc.allocated + l.allocatedAmount,
      committed: acc.committed + l.committed,
      actual: acc.actual + l.actual,
      remaining: acc.remaining + l.remaining,
    }),
    { allocated: 0, committed: 0, actual: 0, remaining: 0 }
  );

  return {
    budget: { ...mapBudget(budget), transfers },
    lines: lineUtilization,
    totals: {
      ...totals,
      utilizationPct: totals.allocated > 0 ? Math.round((totals.actual / totals.allocated) * 1000) / 10 : 0,
    },
  };
}
