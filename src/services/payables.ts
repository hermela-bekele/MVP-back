import { query } from '../db/pool.js';
import { newId, toDateOnly } from '../lib/ids.js';
import { writeAudit } from '../lib/audit.js';
import { resolveApprovedBudgetLine, assertWithinBudget } from './budget.js';

export function mapSupplier(row: Record<string, unknown>) {
  return {
    id: row.id,
    schoolId: row.school_id,
    name: row.name,
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    taxId: row.tax_id,
    bankDetails: row.bank_details,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export function mapSupplierInvoice(row: Record<string, unknown>) {
  return {
    id: row.id,
    schoolId: row.school_id,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name as string | undefined,
    financialYearId: row.financial_year_id,
    department: row.department,
    accountId: row.account_id,
    accountCode: row.account_code as string | undefined,
    accountName: row.account_name as string | undefined,
    budgetLineId: row.budget_line_id,
    invoiceNumber: row.invoice_number,
    poReference: row.po_reference,
    invoiceDate: toDateOnly(row.invoice_date as string | Date),
    dueDate: toDateOnly(row.due_date as string | Date),
    currency: row.currency,
    subtotal: Number(row.subtotal),
    taxAmount: Number(row.tax_amount),
    amountPaid: Number(row.amount_paid),
    balanceDue: Number(row.balance_due),
    status: row.status,
    attachmentUrl: row.attachment_url,
    notes: row.notes,
    createdBy: row.created_by,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    decisionReason: row.decision_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapSupplierPayment(row: Record<string, unknown>) {
  return {
    id: row.id,
    schoolId: row.school_id,
    supplierInvoiceId: row.supplier_invoice_id,
    amount: Number(row.amount),
    method: row.method,
    reference: row.reference,
    paidAt: row.paid_at,
    recordedBy: row.recorded_by,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

// ---- Suppliers ----

export async function listSuppliers(schoolId: string) {
  const { rows } = await query('SELECT * FROM suppliers WHERE school_id = $1 ORDER BY name ASC', [schoolId]);
  return rows.map(mapSupplier);
}

export async function createSupplier(opts: {
  schoolId: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  taxId?: string;
  bankDetails?: string;
  actorUserId?: string;
}) {
  const existing = await query('SELECT id FROM suppliers WHERE school_id = $1 AND name = $2', [opts.schoolId, opts.name]);
  if (existing.rows[0]) {
    throw Object.assign(new Error(`Supplier "${opts.name}" already exists`), { status: 409 });
  }
  const id = newId('sup');
  await query(
    `INSERT INTO suppliers (id, school_id, name, contact_name, email, phone, address, tax_id, bank_details)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, opts.schoolId, opts.name, opts.contactName ?? null, opts.email ?? null, opts.phone ?? null, opts.address ?? null, opts.taxId ?? null, opts.bankDetails ?? null]
  );
  await writeAudit({
    schoolId: opts.schoolId,
    actorUserId: opts.actorUserId,
    action: 'finance.supplier.create',
    entityType: 'supplier',
    entityId: id,
    metadata: { name: opts.name },
  });
  return mapSupplier((await query('SELECT * FROM suppliers WHERE id = $1', [id])).rows[0]);
}

export async function updateSupplier(
  id: string,
  updates: Partial<{ contactName: string; email: string; phone: string; address: string; taxId: string; bankDetails: string; isActive: boolean }>,
  actorUserId?: string
) {
  const row = (await query('SELECT * FROM suppliers WHERE id = $1', [id])).rows[0];
  if (!row) throw Object.assign(new Error('Supplier not found'), { status: 404 });
  await query(
    `UPDATE suppliers SET
       contact_name = COALESCE($1, contact_name),
       email = COALESCE($2, email),
       phone = COALESCE($3, phone),
       address = COALESCE($4, address),
       tax_id = COALESCE($5, tax_id),
       bank_details = COALESCE($6, bank_details),
       is_active = COALESCE($7, is_active),
       updated_at = NOW()
     WHERE id = $8`,
    [updates.contactName ?? null, updates.email ?? null, updates.phone ?? null, updates.address ?? null, updates.taxId ?? null, updates.bankDetails ?? null, updates.isActive ?? null, id]
  );
  await writeAudit({
    schoolId: row.school_id,
    actorUserId,
    action: 'finance.supplier.update',
    entityType: 'supplier',
    entityId: id,
    metadata: updates as Record<string, unknown>,
  });
  return mapSupplier((await query('SELECT * FROM suppliers WHERE id = $1', [id])).rows[0]);
}

// ---- Supplier invoices ----

async function getSupplierInvoiceRow(id: string) {
  const row = (await query('SELECT * FROM supplier_invoices WHERE id = $1', [id])).rows[0];
  if (!row) throw Object.assign(new Error('Supplier invoice not found'), { status: 404 });
  return row;
}

async function hydrateInvoice(id: string) {
  const { rows } = await query(
    `SELECT si.*, s.name AS supplier_name, coa.code AS account_code, coa.name AS account_name
     FROM supplier_invoices si
     JOIN suppliers s ON s.id = si.supplier_id
     JOIN chart_of_accounts coa ON coa.id = si.account_id
     WHERE si.id = $1`,
    [id]
  );
  const invoice = mapSupplierInvoice(rows[0]);
  const payments = await query('SELECT * FROM supplier_payments WHERE supplier_invoice_id = $1 ORDER BY paid_at DESC', [id]);
  return { ...invoice, payments: payments.rows.map(mapSupplierPayment) };
}

export async function listSupplierInvoices(schoolId: string, filters?: { status?: string; supplierId?: string }) {
  const params: unknown[] = [schoolId];
  let where = 'si.school_id = $1';
  if (filters?.status) {
    params.push(filters.status);
    where += ` AND si.status = $${params.length}`;
  }
  if (filters?.supplierId) {
    params.push(filters.supplierId);
    where += ` AND si.supplier_id = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT si.*, s.name AS supplier_name, coa.code AS account_code, coa.name AS account_name
     FROM supplier_invoices si
     JOIN suppliers s ON s.id = si.supplier_id
     JOIN chart_of_accounts coa ON coa.id = si.account_id
     WHERE ${where}
     ORDER BY si.due_date ASC`,
    params
  );
  return rows.map(mapSupplierInvoice);
}

export async function getSupplierInvoice(id: string) {
  await getSupplierInvoiceRow(id);
  return hydrateInvoice(id);
}

export async function createSupplierInvoice(opts: {
  schoolId: string;
  supplierId: string;
  department: string;
  accountId: string;
  invoiceNumber: string;
  poReference?: string;
  invoiceDate: string;
  dueDate: string;
  subtotal: number;
  taxAmount?: number;
  currency?: string;
  notes?: string;
  attachmentUrl?: string;
  actorUserId?: string;
}) {
  if (opts.subtotal <= 0) throw Object.assign(new Error('Subtotal must be positive'), { status: 400 });
  const account = (await query('SELECT * FROM chart_of_accounts WHERE id = $1', [opts.accountId])).rows[0];
  if (!account) throw Object.assign(new Error('Account not found'), { status: 404 });
  if (account.account_type !== 'expense') {
    throw Object.assign(new Error('Supplier invoices must post to an expense account'), { status: 400 });
  }
  const dup = await query(
    `SELECT id FROM supplier_invoices WHERE school_id = $1 AND supplier_id = $2 AND invoice_number = $3`,
    [opts.schoolId, opts.supplierId, opts.invoiceNumber]
  );
  if (dup.rows[0]) {
    throw Object.assign(new Error(`Invoice ${opts.invoiceNumber} already recorded for this supplier`), { status: 409 });
  }
  const activeYear = (await query('SELECT id FROM financial_years WHERE school_id = $1 AND status = $2', [opts.schoolId, 'active'])).rows[0];
  const taxAmount = opts.taxAmount ?? 0;
  const balanceDue = opts.subtotal + taxAmount;

  const id = newId('sinv');
  await query(
    `INSERT INTO supplier_invoices (
      id, school_id, supplier_id, financial_year_id, department, account_id, invoice_number, po_reference,
      invoice_date, due_date, currency, subtotal, tax_amount, amount_paid, balance_due, notes, attachment_url, created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,$14,$15,$16,$17)`,
    [
      id,
      opts.schoolId,
      opts.supplierId,
      activeYear?.id ?? null,
      opts.department,
      opts.accountId,
      opts.invoiceNumber,
      opts.poReference ?? null,
      opts.invoiceDate,
      opts.dueDate,
      opts.currency ?? 'ETB',
      opts.subtotal,
      taxAmount,
      balanceDue,
      opts.notes ?? null,
      opts.attachmentUrl ?? null,
      opts.actorUserId ?? null,
    ]
  );
  await writeAudit({
    schoolId: opts.schoolId,
    actorUserId: opts.actorUserId,
    action: 'finance.supplier_invoice.create',
    entityType: 'supplier_invoice',
    entityId: id,
    metadata: { invoiceNumber: opts.invoiceNumber, supplierId: opts.supplierId, amount: balanceDue },
  });
  return getSupplierInvoice(id);
}

export async function submitSupplierInvoice(id: string, actorUserId?: string) {
  const row = await getSupplierInvoiceRow(id);
  if (row.status !== 'draft') {
    throw Object.assign(new Error(`Cannot submit an invoice with status ${row.status}`), { status: 400 });
  }
  const budgetLine = await resolveApprovedBudgetLine(row.school_id, row.department, row.account_id);
  await assertWithinBudget(budgetLine, row.school_id, Number(row.balance_due));

  await query(`UPDATE supplier_invoices SET status = 'submitted', budget_line_id = $1, updated_at = NOW() WHERE id = $2`, [
    budgetLine?.id ?? null,
    id,
  ]);
  await writeAudit({
    schoolId: row.school_id,
    actorUserId,
    action: 'finance.supplier_invoice.submit',
    entityType: 'supplier_invoice',
    entityId: id,
    metadata: { budgetLineId: budgetLine?.id ?? null },
  });
  return getSupplierInvoice(id);
}

async function decideSupplierInvoice(id: string, status: 'approved' | 'rejected', actorUserId?: string, reason?: string) {
  const row = await getSupplierInvoiceRow(id);
  if (row.status !== 'submitted') {
    throw Object.assign(new Error(`Cannot decide on an invoice with status ${row.status}`), { status: 400 });
  }
  await query(
    `UPDATE supplier_invoices SET status = $1, decided_by = $2, decided_at = NOW(), decision_reason = $3, updated_at = NOW() WHERE id = $4`,
    [status, actorUserId ?? null, reason ?? null, id]
  );
  await writeAudit({
    schoolId: row.school_id,
    actorUserId,
    action: `finance.supplier_invoice.${status}`,
    entityType: 'supplier_invoice',
    entityId: id,
    metadata: reason ? { reason } : undefined,
  });
  return getSupplierInvoice(id);
}

export const approveSupplierInvoice = (id: string, actorUserId?: string) => decideSupplierInvoice(id, 'approved', actorUserId);
export const rejectSupplierInvoice = (id: string, reason: string, actorUserId?: string) =>
  decideSupplierInvoice(id, 'rejected', actorUserId, reason);

export async function cancelSupplierInvoice(id: string, reason: string, actorUserId?: string) {
  const row = await getSupplierInvoiceRow(id);
  if (Number(row.amount_paid) > 0) {
    throw Object.assign(new Error('Cannot cancel an invoice with payments recorded'), { status: 400 });
  }
  await query(`UPDATE supplier_invoices SET status = 'cancelled', notes = COALESCE(notes,'') || $1, updated_at = NOW() WHERE id = $2`, [
    `\nCancelled: ${reason}`,
    id,
  ]);
  await writeAudit({
    schoolId: row.school_id,
    actorUserId,
    action: 'finance.supplier_invoice.cancel',
    entityType: 'supplier_invoice',
    entityId: id,
    metadata: { reason },
  });
  return getSupplierInvoice(id);
}

export async function recordSupplierPayment(
  invoiceId: string,
  opts: { amount: number; method: 'cash' | 'bank_transfer' | 'mobile_money' | 'cheque'; reference?: string; notes?: string },
  actorUserId?: string
) {
  if (opts.amount <= 0) throw Object.assign(new Error('Amount must be positive'), { status: 400 });
  const row = await getSupplierInvoiceRow(invoiceId);
  if (!['approved', 'partially_paid'].includes(row.status)) {
    throw Object.assign(new Error(`Cannot pay an invoice with status ${row.status}`), { status: 400 });
  }
  if (opts.amount > Number(row.balance_due)) {
    throw Object.assign(new Error(`Payment exceeds remaining balance (${Number(row.balance_due).toLocaleString()})`), { status: 400 });
  }

  const paymentId = newId('spay');
  await query(
    `INSERT INTO supplier_payments (id, school_id, supplier_invoice_id, amount, method, reference, recorded_by, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [paymentId, row.school_id, invoiceId, opts.amount, opts.method, opts.reference ?? null, actorUserId ?? null, opts.notes ?? null]
  );
  const amountPaid = Number(row.amount_paid) + opts.amount;
  const balanceDue = Number(row.subtotal) + Number(row.tax_amount) - amountPaid;
  const status = balanceDue <= 0 ? 'paid' : 'partially_paid';
  await query(`UPDATE supplier_invoices SET amount_paid = $1, balance_due = $2, status = $3, updated_at = NOW() WHERE id = $4`, [
    amountPaid,
    Math.max(balanceDue, 0),
    status,
    invoiceId,
  ]);
  await writeAudit({
    schoolId: row.school_id,
    actorUserId,
    action: 'finance.supplier_invoice.pay',
    entityType: 'supplier_invoice',
    entityId: invoiceId,
    metadata: { amount: opts.amount, method: opts.method },
  });
  return getSupplierInvoice(invoiceId);
}
