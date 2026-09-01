import { query } from '../db/pool.js';
import { newId, toDateOnly } from '../lib/ids.js';
import { writeAudit } from '../lib/audit.js';
import { resolveApprovedBudgetLine, assertWithinBudget } from './budget.js';

const EDITABLE_STATUSES = ['draft', 'returned'];

export function mapExpense(row: Record<string, unknown>) {
  return {
    id: row.id,
    schoolId: row.school_id,
    financialYearId: row.financial_year_id,
    department: row.department,
    accountId: row.account_id,
    accountCode: row.account_code as string | undefined,
    accountName: row.account_name as string | undefined,
    budgetLineId: row.budget_line_id,
    vendor: row.vendor,
    description: row.description,
    amount: Number(row.amount),
    expenseDate: toDateOnly(row.expense_date as string | Date),
    status: row.status,
    attachmentUrl: row.attachment_url,
    notes: row.notes,
    requestedBy: row.requested_by,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    decisionReason: row.decision_reason,
    paymentMethod: row.payment_method,
    paymentReference: row.payment_reference,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getExpenseRow(id: string) {
  const row = (await query('SELECT * FROM expenses WHERE id = $1', [id])).rows[0];
  if (!row) throw Object.assign(new Error('Expense not found'), { status: 404 });
  return row;
}

export async function listExpenses(schoolId: string, filters?: { status?: string; department?: string }) {
  const params: unknown[] = [schoolId];
  let where = 'e.school_id = $1';
  if (filters?.status) {
    params.push(filters.status);
    where += ` AND e.status = $${params.length}`;
  }
  if (filters?.department) {
    params.push(filters.department);
    where += ` AND e.department = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT e.*, coa.code AS account_code, coa.name AS account_name
     FROM expenses e
     JOIN chart_of_accounts coa ON coa.id = e.account_id
     WHERE ${where}
     ORDER BY e.created_at DESC`,
    params
  );
  return rows.map(mapExpense);
}

export async function getExpense(id: string) {
  const { rows } = await query(
    `SELECT e.*, coa.code AS account_code, coa.name AS account_name
     FROM expenses e JOIN chart_of_accounts coa ON coa.id = e.account_id
     WHERE e.id = $1`,
    [id]
  );
  if (!rows[0]) throw Object.assign(new Error('Expense not found'), { status: 404 });
  return mapExpense(rows[0]);
}

export async function createExpense(opts: {
  schoolId: string;
  department: string;
  accountId: string;
  vendor?: string;
  description: string;
  amount: number;
  expenseDate: string;
  notes?: string;
  attachmentUrl?: string;
  actorUserId?: string;
}) {
  if (opts.amount <= 0) throw Object.assign(new Error('Amount must be positive'), { status: 400 });
  const account = (await query('SELECT * FROM chart_of_accounts WHERE id = $1', [opts.accountId])).rows[0];
  if (!account) throw Object.assign(new Error('Account not found'), { status: 404 });
  if (account.account_type !== 'expense') {
    throw Object.assign(new Error('Expenses must post to an expense account'), { status: 400 });
  }
  const activeYear = (await query('SELECT id FROM financial_years WHERE school_id = $1 AND status = $2', [opts.schoolId, 'active'])).rows[0];

  const id = newId('exp');
  await query(
    `INSERT INTO expenses (id, school_id, financial_year_id, department, account_id, vendor, description, amount, expense_date, notes, attachment_url, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      id,
      opts.schoolId,
      activeYear?.id ?? null,
      opts.department,
      opts.accountId,
      opts.vendor ?? null,
      opts.description,
      opts.amount,
      opts.expenseDate,
      opts.notes ?? null,
      opts.attachmentUrl ?? null,
      opts.actorUserId ?? null,
    ]
  );
  await writeAudit({
    schoolId: opts.schoolId,
    actorUserId: opts.actorUserId,
    action: 'finance.expense.create',
    entityType: 'expense',
    entityId: id,
    metadata: { department: opts.department, amount: opts.amount },
  });
  return getExpense(id);
}

export async function updateExpense(
  id: string,
  updates: { vendor?: string; description?: string; amount?: number; expenseDate?: string; notes?: string; attachmentUrl?: string },
  actorUserId?: string
) {
  const row = await getExpenseRow(id);
  if (!EDITABLE_STATUSES.includes(row.status)) {
    throw Object.assign(new Error(`Cannot edit an expense with status ${row.status}`), { status: 400 });
  }
  if (updates.amount !== undefined && updates.amount <= 0) {
    throw Object.assign(new Error('Amount must be positive'), { status: 400 });
  }
  await query(
    `UPDATE expenses SET
       vendor = COALESCE($1, vendor),
       description = COALESCE($2, description),
       amount = COALESCE($3, amount),
       expense_date = COALESCE($4, expense_date),
       notes = COALESCE($5, notes),
       attachment_url = COALESCE($6, attachment_url),
       updated_at = NOW()
     WHERE id = $7`,
    [updates.vendor ?? null, updates.description ?? null, updates.amount ?? null, updates.expenseDate ?? null, updates.notes ?? null, updates.attachmentUrl ?? null, id]
  );
  await writeAudit({
    schoolId: row.school_id,
    actorUserId,
    action: 'finance.expense.update',
    entityType: 'expense',
    entityId: id,
    metadata: updates as Record<string, unknown>,
  });
  return getExpense(id);
}

export async function removeExpense(id: string, actorUserId?: string) {
  const row = await getExpenseRow(id);
  if (row.status !== 'draft') {
    throw Object.assign(new Error('Only draft expenses can be deleted — cancel it instead'), { status: 400 });
  }
  await query('DELETE FROM expenses WHERE id = $1', [id]);
  await writeAudit({
    schoolId: row.school_id,
    actorUserId,
    action: 'finance.expense.delete',
    entityType: 'expense',
    entityId: id,
  });
}

export async function submitExpense(id: string, actorUserId?: string) {
  const row = await getExpenseRow(id);
  if (!EDITABLE_STATUSES.includes(row.status)) {
    throw Object.assign(new Error(`Cannot submit an expense with status ${row.status}`), { status: 400 });
  }
  const budgetLine = await resolveApprovedBudgetLine(row.school_id, row.department, row.account_id);
  await assertWithinBudget(budgetLine, row.school_id, Number(row.amount));

  await query(
    `UPDATE expenses SET status = 'submitted', budget_line_id = $1, decision_reason = NULL, updated_at = NOW() WHERE id = $2`,
    [budgetLine?.id ?? null, id]
  );
  await writeAudit({
    schoolId: row.school_id,
    actorUserId,
    action: 'finance.expense.submit',
    entityType: 'expense',
    entityId: id,
    metadata: { budgetLineId: budgetLine?.id ?? null },
  });
  return getExpense(id);
}

async function decideExpense(id: string, status: 'approved' | 'rejected' | 'returned', actorUserId?: string, reason?: string) {
  const row = await getExpenseRow(id);
  if (row.status !== 'submitted') {
    throw Object.assign(new Error(`Cannot decide on an expense with status ${row.status}`), { status: 400 });
  }
  await query(
    `UPDATE expenses SET status = $1, decided_by = $2, decided_at = NOW(), decision_reason = $3, updated_at = NOW() WHERE id = $4`,
    [status, actorUserId ?? null, reason ?? null, id]
  );
  await writeAudit({
    schoolId: row.school_id,
    actorUserId,
    action: `finance.expense.${status}`,
    entityType: 'expense',
    entityId: id,
    metadata: reason ? { reason } : undefined,
  });
  return getExpense(id);
}

export const approveExpense = (id: string, actorUserId?: string) => decideExpense(id, 'approved', actorUserId);
export const rejectExpense = (id: string, reason: string, actorUserId?: string) =>
  decideExpense(id, 'rejected', actorUserId, reason);
export const returnExpense = (id: string, reason: string, actorUserId?: string) =>
  decideExpense(id, 'returned', actorUserId, reason);

export async function cancelExpense(id: string, reason: string, actorUserId?: string) {
  const row = await getExpenseRow(id);
  if (row.status === 'paid') {
    throw Object.assign(new Error('Cannot cancel a paid expense'), { status: 400 });
  }
  await query(`UPDATE expenses SET status = 'cancelled', decision_reason = $1, updated_at = NOW() WHERE id = $2`, [
    reason,
    id,
  ]);
  await writeAudit({
    schoolId: row.school_id,
    actorUserId,
    action: 'finance.expense.cancel',
    entityType: 'expense',
    entityId: id,
    metadata: { reason },
  });
  return getExpense(id);
}

export async function payExpense(
  id: string,
  opts: { paymentMethod: 'cash' | 'bank_transfer' | 'mobile_money' | 'cheque'; paymentReference?: string },
  actorUserId?: string
) {
  const row = await getExpenseRow(id);
  if (row.status !== 'approved') {
    throw Object.assign(new Error('Only an approved expense can be paid'), { status: 400 });
  }
  await query(
    `UPDATE expenses SET status = 'paid', payment_method = $1, payment_reference = $2, paid_at = NOW(), paid_by = $3, updated_at = NOW() WHERE id = $4`,
    [opts.paymentMethod, opts.paymentReference ?? null, actorUserId ?? null, id]
  );
  await writeAudit({
    schoolId: row.school_id,
    actorUserId,
    action: 'finance.expense.pay',
    entityType: 'expense',
    entityId: id,
    metadata: { paymentMethod: opts.paymentMethod, amount: Number(row.amount) },
  });
  return getExpense(id);
}
