import { query } from '../db/pool.js';
import { newId, addDays, toDateOnly, invoiceNumber, daysUntil, deadlineColor } from '../lib/ids.js';
import {
  queueEmail,
  invoiceReminderEmail,
  invoiceIssuedEmail,
  paymentReceiptEmail,
  type EmailAttachment,
} from '../lib/email.js';
import { buildInvoicePdf, invoicePdfFilename } from '../lib/invoicePdf.js';
import type { PoolClient } from 'pg';
import { writeAudit } from '../lib/audit.js';

export function mapInvoice(row: Record<string, unknown>) {
  const due = toDateOnly(row.due_date as string | Date);
  const issue = toDateOnly(row.issue_date as string | Date);
  const remaining = daysUntil(due);
  return {
    id: row.id,
    schoolId: row.school_id,
    studentId: row.student_id,
    enrollmentId: row.enrollment_id,
    applicationId: row.application_id,
    parentId: row.parent_id,
    invoiceNumber: row.invoice_number,
    invoiceType: row.invoice_type,
    status: row.status,
    issueDate: issue,
    dueDate: due,
    currency: row.currency,
    subtotal: Number(row.subtotal),
    lateFeeTotal: Number(row.late_fee_total),
    amountPaid: Number(row.amount_paid),
    balanceDue: Number(row.balance_due),
    reminderSentAt: row.reminder_sent_at,
    overdueNotifiedAt: row.overdue_notified_at,
    billingPeriod: row.billing_period,
    notes: row.notes,
    daysRemaining: remaining,
    deadlineColor: deadlineColor(remaining),
    studentName: (row.student_name as string) || undefined,
    applicantName: (row.applicant_name as string) || undefined,
    schoolName: (row.school_name as string) || undefined,
    parentName: (row.parent_name as string) || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function resolveInvoiceParties(inv: Record<string, unknown>) {
  let parentName = 'Parent';
  let studentName = 'Student';
  let toEmail = '';
  let schoolName = 'School';

  const school = (await query('SELECT name FROM schools WHERE id = $1', [inv.school_id])).rows[0];
  schoolName = school?.name ?? schoolName;

  if (inv.parent_id) {
    const p = (await query('SELECT * FROM parents WHERE id = $1', [inv.parent_id])).rows[0];
    parentName = p?.full_name ?? parentName;
    toEmail = p?.email ?? '';
  }
  if (inv.application_id) {
    const a = (await query('SELECT * FROM admission_applications WHERE id = $1', [inv.application_id]))
      .rows[0];
    if (a) {
      parentName = a.parent_name || parentName;
      studentName = a.applicant_name || studentName;
      toEmail = a.parent_email || toEmail;
    }
  }
  if (inv.student_id) {
    const s = (await query('SELECT * FROM students WHERE id = $1', [inv.student_id])).rows[0];
    if (s) {
      studentName = s.name || studentName;
      toEmail = toEmail || s.parent_email;
      parentName = parentName === 'Parent' ? s.parent_name || parentName : parentName;
    }
  }

  return { parentName, studentName, toEmail, schoolName };
}

export async function buildInvoicePdfAttachment(invoiceId: string): Promise<{
  attachment: EmailAttachment;
  parties: Awaited<ReturnType<typeof resolveInvoiceParties>>;
  invoice: ReturnType<typeof mapInvoice>;
  lineItems: { description: string; lineTotal: number; lineType: string }[];
} | null> {
  const inv = (await query('SELECT * FROM invoices WHERE id = $1', [invoiceId])).rows[0];
  if (!inv) return null;
  const parties = await resolveInvoiceParties(inv);
  const items = await query(
    `SELECT description, line_total, line_type FROM invoice_line_items WHERE invoice_id = $1 ORDER BY id`,
    [invoiceId]
  );
  const lineItems = items.rows.map((li) => ({
    description: String(li.description),
    lineTotal: Number(li.line_total),
    lineType: String(li.line_type),
  }));
  const mapped = mapInvoice(inv);
  const pdf = buildInvoicePdf({
    invoiceNumber: String(inv.invoice_number),
    schoolName: parties.schoolName,
    studentName: parties.studentName,
    parentName: parties.parentName,
    invoiceType: String(inv.invoice_type),
    issueDate: mapped.issueDate,
    dueDate: mapped.dueDate,
    currency: String(inv.currency),
    subtotal: Number(inv.subtotal),
    lateFeeTotal: Number(inv.late_fee_total),
    amountPaid: Number(inv.amount_paid),
    balanceDue: Number(inv.balance_due),
    notes: inv.notes as string | null,
    lineItems,
  });
  return {
    attachment: {
      filename: invoicePdfFilename(String(inv.invoice_number)),
      content: pdf,
      contentType: 'application/pdf',
    },
    parties,
    invoice: mapped,
    lineItems,
  };
}

/** Email invoice PDF (issued / reminder / overdue) to the billed parent. */
export async function emailInvoiceWithPdf(opts: {
  invoiceId: string;
  templateKey: string;
  overdue?: boolean;
  issued?: boolean;
}) {
  const built = await buildInvoicePdfAttachment(opts.invoiceId);
  if (!built || !built.parties.toEmail) return null;
  const { attachment, parties, invoice } = built;

  const mail = opts.issued
    ? invoiceIssuedEmail({
        parentName: parties.parentName,
        studentName: parties.studentName,
        invoiceNumber: String(invoice.invoiceNumber),
        amount: Number(invoice.balanceDue),
        currency: String(invoice.currency),
        dueDate: String(invoice.dueDate),
        schoolName: parties.schoolName,
        billingPeriod: invoice.billingPeriod ? String(invoice.billingPeriod) : undefined,
      })
    : invoiceReminderEmail({
        parentName: parties.parentName,
        studentName: parties.studentName,
        invoiceNumber: String(invoice.invoiceNumber),
        balanceDue: Number(invoice.balanceDue),
        currency: String(invoice.currency),
        dueDate: String(invoice.dueDate),
        schoolName: parties.schoolName,
        overdue: opts.overdue,
      });

  await queueEmail({
    schoolId: String(invoice.schoolId),
    toEmail: parties.toEmail,
    ...mail,
    templateKey: opts.templateKey,
    relatedType: 'invoice',
    relatedId: opts.invoiceId,
    idempotent: true,
    attachments: [attachment],
  });
  return true;
}

export function mapPayment(row: Record<string, unknown>) {
  return {
    id: row.id,
    schoolId: row.school_id,
    invoiceId: row.invoice_id,
    amount: Number(row.amount),
    currency: row.currency,
    provider: row.provider,
    providerRef: row.provider_ref,
    status: row.status,
    paidAt: row.paid_at,
    recordedBy: row.recorded_by,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export async function refreshInvoiceTotals(invoiceId: string) {
  const lines = await query(
    `SELECT COALESCE(SUM(line_total),0)::float AS subtotal FROM invoice_line_items WHERE invoice_id = $1 AND line_type <> 'late_fee'`,
    [invoiceId]
  );
  const late = await query(
    `SELECT COALESCE(SUM(line_total),0)::float AS late_fee FROM invoice_line_items WHERE invoice_id = $1 AND line_type = 'late_fee'`,
    [invoiceId]
  );
  const paid = await query(
    `SELECT COALESCE(SUM(amount),0)::float AS paid FROM payments WHERE invoice_id = $1 AND status = 'succeeded'`,
    [invoiceId]
  );
  const subtotal = Number(lines.rows[0].subtotal);
  const lateFeeTotal = Number(late.rows[0].late_fee);
  const amountPaid = Number(paid.rows[0].paid);
  const balanceDue = Math.max(subtotal + lateFeeTotal - amountPaid, 0);

  let status = 'sent';
  if (amountPaid <= 0 && balanceDue > 0) {
    const inv = (await query('SELECT due_date FROM invoices WHERE id = $1', [invoiceId])).rows[0];
    status = daysUntil(String(inv.due_date)) < 0 ? 'overdue' : 'sent';
  } else if (balanceDue <= 0) {
    status = 'paid';
  } else if (amountPaid > 0) {
    status = daysUntil(
      String((await query('SELECT due_date FROM invoices WHERE id = $1', [invoiceId])).rows[0].due_date)
    ) < 0
      ? 'overdue'
      : 'partially_paid';
  }

  await query(
    `UPDATE invoices SET subtotal = $1, late_fee_total = $2, amount_paid = $3, balance_due = $4, status = $5, updated_at = NOW() WHERE id = $6`,
    [subtotal, lateFeeTotal, amountPaid, balanceDue, status, invoiceId]
  );

  return mapInvoice((await query('SELECT * FROM invoices WHERE id = $1', [invoiceId])).rows[0]);
}

async function nextInvoiceSeq(schoolId: string) {
  const { rows } = await query('SELECT COUNT(*)::int AS c FROM invoices WHERE school_id = $1', [
    schoolId,
  ]);
  return rows[0].c + 1;
}

export async function createAdmissionInvoice(opts: {
  schoolId: string;
  applicationId: string;
  enrollmentId: string;
  parentId: string;
  registrationFee: number;
  monthlyTuition: number;
  dueDays: number;
  currency: string;
  schoolCode: string;
  siblingDiscountPercent?: number;
  client?: PoolClient;
}) {
  const q = opts.client ? opts.client.query.bind(opts.client) : query;
  const id = newId('inv');
  const seqRows = await q('SELECT COUNT(*)::int AS c FROM invoices WHERE school_id = $1', [
    opts.schoolId,
  ]);
  const seq = Number(seqRows.rows[0].c) + 1;
  const number = invoiceNumber(opts.schoolCode, seq);
  const issue = new Date();
  const due = addDays(issue, opts.dueDays);
  let registrationFee = opts.registrationFee;
  let monthlyTuition = opts.monthlyTuition;
  const discountPct = Number(opts.siblingDiscountPercent || 0);
  let discount = 0;
  if (discountPct > 0) {
    discount = Math.round(((registrationFee + monthlyTuition) * discountPct) / 100);
  }
  const subtotal = Math.max(registrationFee + monthlyTuition - discount, 0);

  await q(
    `INSERT INTO invoices (
      id, school_id, enrollment_id, application_id, parent_id, invoice_number, invoice_type,
      status, issue_date, due_date, currency, subtotal, late_fee_total, amount_paid, balance_due, notes
    ) VALUES ($1,$2,$3,$4,$5,$6,'admission','sent',$7,$8,$9,$10,0,0,$10,$11)`,
    [
      id,
      opts.schoolId,
      opts.enrollmentId,
      opts.applicationId,
      opts.parentId,
      number,
      toDateOnly(issue),
      toDateOnly(due),
      opts.currency,
      subtotal,
      discount > 0 ? `Registration + first month tuition (−${discountPct}% sibling discount)` : 'Registration + first month tuition',
    ]
  );

  await q(
    `INSERT INTO invoice_line_items (id, invoice_id, description, quantity, unit_amount, line_total, line_type)
     VALUES ($1,$2,$3,1,$4,$4,'fee'), ($5,$2,$6,1,$7,$7,'fee')`,
    [
      newId('ili'),
      id,
      'Registration fee',
      registrationFee,
      newId('ili'),
      'First month tuition',
      monthlyTuition,
    ]
  );
  if (discount > 0) {
    await q(
      `INSERT INTO invoice_line_items (id, invoice_id, description, quantity, unit_amount, line_total, line_type)
       VALUES ($1,$2,$3,1,$4,$4,'discount')`,
      [newId('ili'), id, `Sibling discount (${discountPct}%)`, -discount]
    );
  }

  if (opts.client) {
    // Totals already set; skip refresh that uses global pool mid-transaction
    return mapInvoice((await q('SELECT * FROM invoices WHERE id = $1', [id])).rows[0]);
  }
  return refreshInvoiceTotals(id);
}

export async function createMonthlyInvoice(opts: {
  schoolId: string;
  studentId: string;
  parentId: string | null;
  amount: number;
  currency: string;
  schoolCode: string;
  dueDay: number;
  billingPeriod: string;
}) {
  const existing = await query(
    `SELECT id FROM invoices WHERE school_id = $1 AND student_id = $2 AND invoice_type = 'monthly' AND billing_period = $3`,
    [opts.schoolId, opts.studentId, opts.billingPeriod]
  );
  if (existing.rows[0]) {
    return mapInvoice(
      (await query('SELECT * FROM invoices WHERE id = $1', [existing.rows[0].id])).rows[0]
    );
  }

  const id = newId('inv');
  const seq = await nextInvoiceSeq(opts.schoolId);
  const number = invoiceNumber(opts.schoolCode, seq);
  const now = new Date();
  const due = new Date(now.getFullYear(), now.getMonth(), opts.dueDay);
  if (due < now) due.setMonth(due.getMonth() + 1);

  await query(
    `INSERT INTO invoices (
      id, school_id, student_id, parent_id, invoice_number, invoice_type, status,
      issue_date, due_date, currency, subtotal, late_fee_total, amount_paid, balance_due, billing_period
    ) VALUES ($1,$2,$3,$4,$5,'monthly','sent',$6,$7,$8,$9,0,0,$9,$10)`,
    [
      id,
      opts.schoolId,
      opts.studentId,
      opts.parentId,
      number,
      toDateOnly(now),
      toDateOnly(due),
      opts.currency,
      opts.amount,
      opts.billingPeriod,
    ]
  );
  await query(
    `INSERT INTO invoice_line_items (id, invoice_id, description, quantity, unit_amount, line_total, line_type)
     VALUES ($1,$2,$3,1,$4,$4,'fee')`,
    [newId('ili'), id, `Monthly tuition ${opts.billingPeriod}`, opts.amount]
  );
  const created = await refreshInvoiceTotals(id);
  // Email newly issued monthly invoice with PDF (idempotent per invoice)
  await emailInvoiceWithPdf({
    invoiceId: id,
    templateKey: 'invoice_issued',
    issued: true,
  }).catch((err) => console.error('[billing] monthly invoice email failed', err));
  return created;
}

export async function recordPayment(opts: {
  schoolId: string;
  invoiceId: string;
  amount: number;
  provider: string;
  providerRef?: string;
  recordedBy?: string;
  notes?: string;
  rawPayload?: unknown;
}) {
  if (opts.amount <= 0) throw Object.assign(new Error('Amount must be positive'), { status: 400 });

  const inv = (await query('SELECT * FROM invoices WHERE id = $1', [opts.invoiceId])).rows[0];
  if (!inv) throw Object.assign(new Error('Invoice not found'), { status: 404 });
  if (['cancelled', 'void'].includes(inv.status)) {
    throw Object.assign(new Error('Invoice is cancelled'), { status: 400 });
  }

  const id = newId('pay');
  await query(
    `INSERT INTO payments (id, school_id, invoice_id, amount, currency, provider, provider_ref, status, paid_at, recorded_by, notes, raw_payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'succeeded',NOW(),$8,$9,$10)`,
    [
      id,
      opts.schoolId,
      opts.invoiceId,
      opts.amount,
      inv.currency,
      opts.provider,
      opts.providerRef ?? null,
      opts.recordedBy ?? null,
      opts.notes ?? null,
      opts.rawPayload ? JSON.stringify(opts.rawPayload) : null,
    ]
  );

  const updated = await refreshInvoiceTotals(opts.invoiceId);

  // Lazy import to avoid circular init issues at module load
  const { activateEnrollmentAfterPayment } = await import('./admissions.js');
  if (updated.balanceDue <= 0 && updated.invoiceType === 'admission') {
    await activateEnrollmentAfterPayment(opts.invoiceId);
  }

  // Payment receipt email (non-blocking)
  try {
    const parties = await resolveInvoiceParties(inv);
    if (parties.toEmail) {
      const receipt = paymentReceiptEmail({
        parentName: parties.parentName,
        studentName: parties.studentName,
        invoiceNumber: String(inv.invoice_number),
        amountPaid: opts.amount,
        balanceDue: Number(updated.balanceDue),
        currency: String(inv.currency),
        schoolName: parties.schoolName,
      });
      await queueEmail({
        schoolId: opts.schoolId,
        toEmail: parties.toEmail,
        ...receipt,
        templateKey: 'payment_receipt',
        relatedType: 'payment',
        relatedId: id,
        idempotent: true,
      });
    }
  } catch (err) {
    console.error('[billing] payment receipt email failed', err);
  }

  return {
    payment: mapPayment((await query('SELECT * FROM payments WHERE id = $1', [id])).rows[0]),
    invoice: updated,
  };
}

export async function applyLateFee(invoiceId: string, amount: number, description?: string) {
  await query(
    `INSERT INTO invoice_line_items (id, invoice_id, description, quantity, unit_amount, line_total, line_type)
     VALUES ($1,$2,$3,1,$4,$4,'late_fee')`,
    [newId('ili'), invoiceId, description ?? 'Late payment fee', amount]
  );
  return refreshInvoiceTotals(invoiceId);
}

export async function listInvoices(filters: {
  schoolId?: string;
  parentId?: string;
  studentId?: string;
  status?: string;
  invoiceId?: string;
}) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.invoiceId) {
    params.push(filters.invoiceId);
    clauses.push(`i.id = $${params.length}`);
  }
  if (filters.schoolId) {
    params.push(filters.schoolId);
    clauses.push(`i.school_id = $${params.length}`);
  }
  if (filters.parentId) {
    params.push(filters.parentId);
    clauses.push(`i.parent_id = $${params.length}`);
  }
  if (filters.studentId) {
    params.push(filters.studentId);
    clauses.push(`i.student_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    clauses.push(`i.status = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT i.*,
            st.name AS student_name,
            aa.applicant_name,
            sch.name AS school_name,
            p.full_name AS parent_name
     FROM invoices i
     LEFT JOIN students st ON st.id = i.student_id
     LEFT JOIN admission_applications aa ON aa.id = i.application_id
     LEFT JOIN schools sch ON sch.id = i.school_id
     LEFT JOIN parents p ON p.id = i.parent_id
     ${where}
     ORDER BY i.due_date ASC`,
    params
  );
  const invoices = rows.map((r) => mapInvoice(r));
  for (const inv of invoices) {
    const items = await query('SELECT * FROM invoice_line_items WHERE invoice_id = $1', [inv.id]);
    const pays = await query(
      `SELECT * FROM payments WHERE invoice_id = $1 ORDER BY created_at DESC`,
      [inv.id]
    );
    (inv as { lineItems?: unknown; payments?: unknown }).lineItems = items.rows.map((li) => ({
      id: li.id,
      description: li.description,
      quantity: Number(li.quantity),
      unitAmount: Number(li.unit_amount),
      lineTotal: Number(li.line_total),
      lineType: li.line_type,
    }));
    (inv as { payments?: unknown }).payments = pays.rows.map(mapPayment);
  }
  return invoices;
}

export async function initiateProviderPayment(opts: {
  schoolId: string;
  invoiceId: string;
  amount: number;
  provider: 'telebirr' | 'bank_transfer' | 'chapa' | 'manual';
  returnUrl?: string;
}) {
  // Adapter stub — real Telebirr/Chapa/bank APIs plug in here
  const providerRef = `${opts.provider.toUpperCase()}-${Date.now()}`;
  if (opts.provider === 'bank_transfer') {
    return {
      status: 'pending_transfer',
      provider: opts.provider,
      providerRef,
      instructions:
        'Transfer the amount to the school bank account and include this reference in the memo. Finance will confirm receipt.',
      amount: opts.amount,
    };
  }
  if (opts.provider === 'telebirr' || opts.provider === 'chapa') {
    return {
      status: 'pending',
      provider: opts.provider,
      providerRef,
      checkoutUrl: `https://pay.example.local/${opts.provider}/${providerRef}`,
      amount: opts.amount,
      message: `${opts.provider} sandbox checkout (integrate live keys per school).`,
    };
  }
  return { status: 'ready_manual', provider: opts.provider, providerRef, amount: opts.amount };
}

export async function sendInvoiceReminder(invoiceId: string) {
  const inv = (await query('SELECT * FROM invoices WHERE id = $1', [invoiceId])).rows[0];
  if (!inv || inv.reminder_sent_at || Number(inv.balance_due) <= 0) return null;

  const sent = await emailInvoiceWithPdf({
    invoiceId,
    templateKey: 'invoice_reminder',
  });
  if (!sent) return null;
  await query(`UPDATE invoices SET reminder_sent_at = NOW() WHERE id = $1`, [invoiceId]);
  return true;
}

/** Separate overdue notice — does not require reminder_sent_at to be null. */
export async function sendOverdueInvoiceNotice(invoiceId: string) {
  const inv = (await query('SELECT * FROM invoices WHERE id = $1', [invoiceId])).rows[0];
  if (!inv || inv.overdue_notified_at || Number(inv.balance_due) <= 0) return null;

  const sent = await emailInvoiceWithPdf({
    invoiceId,
    templateKey: 'invoice_overdue',
    overdue: true,
  });
  if (!sent) return null;
  return true;
}

export async function extendInvoiceDeadline(
  invoiceId: string,
  dueDate: string,
  actorUserId?: string
) {
  const inv = (await query('SELECT * FROM invoices WHERE id = $1', [invoiceId])).rows[0];
  if (!inv) throw Object.assign(new Error('Invoice not found'), { status: 404 });
  await query(`UPDATE invoices SET due_date = $1, updated_at = NOW(), overdue_notified_at = NULL WHERE id = $2`, [
    dueDate,
    invoiceId,
  ]);
  await writeAudit({
    schoolId: inv.school_id,
    actorUserId,
    action: 'billing.extend_deadline',
    entityType: 'invoice',
    entityId: invoiceId,
    metadata: { dueDate },
  });
  return refreshInvoiceTotals(invoiceId);
}

export async function waiveInvoiceBalance(
  invoiceId: string,
  amount: number,
  reason: string,
  actorUserId?: string
) {
  const inv = (await query('SELECT * FROM invoices WHERE id = $1', [invoiceId])).rows[0];
  if (!inv) throw Object.assign(new Error('Invoice not found'), { status: 404 });
  const waive = Math.min(amount, Number(inv.balance_due));
  if (waive <= 0) throw Object.assign(new Error('Nothing to waive'), { status: 400 });
  await query(
    `INSERT INTO invoice_line_items (id, invoice_id, description, quantity, unit_amount, line_total, line_type)
     VALUES ($1,$2,$3,1,$4,$4,'waiver')`,
    [newId('ili'), invoiceId, reason || 'Fee waiver', -waive]
  );
  const updated = await refreshInvoiceTotals(invoiceId);
  await writeAudit({
    schoolId: inv.school_id,
    actorUserId,
    action: 'billing.waive',
    entityType: 'invoice',
    entityId: invoiceId,
    metadata: { amount: waive, reason },
  });
  if (updated.balanceDue <= 0 && updated.invoiceType === 'admission') {
    const { activateEnrollmentAfterPayment } = await import('./admissions.js');
    await activateEnrollmentAfterPayment(invoiceId);
  }
  return updated;
}

export async function cancelInvoice(invoiceId: string, reason: string, actorUserId?: string) {
  const inv = (await query('SELECT * FROM invoices WHERE id = $1', [invoiceId])).rows[0];
  if (!inv) throw Object.assign(new Error('Invoice not found'), { status: 404 });
  if (Number(inv.amount_paid) > 0) {
    throw Object.assign(new Error('Cannot cancel an invoice with payments — waive remaining instead'), {
      status: 400,
    });
  }
  await query(
    `UPDATE invoices SET status = 'cancelled', notes = COALESCE(notes,'') || $1, updated_at = NOW(), balance_due = 0 WHERE id = $2`,
    [`\nCancelled: ${reason}`, invoiceId]
  );
  await writeAudit({
    schoolId: inv.school_id,
    actorUserId,
    action: 'billing.cancel_invoice',
    entityType: 'invoice',
    entityId: invoiceId,
    metadata: { reason },
  });
  return mapInvoice((await query('SELECT * FROM invoices WHERE id = $1', [invoiceId])).rows[0]);
}

/** Idempotent webhook handler for provider callbacks */
export async function handlePaymentWebhook(opts: {
  schoolId: string;
  provider: string;
  providerRef: string;
  status: 'succeeded' | 'failed' | 'pending';
  amount: number;
  invoiceId: string;
  rawPayload?: unknown;
}) {
  const existing = await query(
    `SELECT * FROM payments WHERE provider = $1 AND provider_ref = $2 LIMIT 1`,
    [opts.provider, opts.providerRef]
  );
  if (existing.rows[0]) {
    return {
      payment: mapPayment(existing.rows[0]),
      invoice: await refreshInvoiceTotals(opts.invoiceId),
      duplicate: true,
    };
  }
  if (opts.status !== 'succeeded') {
    const id = newId('pay');
    await query(
      `INSERT INTO payments (id, school_id, invoice_id, amount, currency, provider, provider_ref, status, notes, raw_payload)
       VALUES ($1,$2,$3,$4,(SELECT currency FROM invoices WHERE id=$3),$5,$6,$7,$8,$9)`,
      [
        id,
        opts.schoolId,
        opts.invoiceId,
        opts.amount,
        opts.provider,
        opts.providerRef,
        opts.status,
        `Webhook ${opts.status}`,
        opts.rawPayload ? JSON.stringify(opts.rawPayload) : null,
      ]
    );
    return {
      payment: mapPayment((await query('SELECT * FROM payments WHERE id = $1', [id])).rows[0]),
      invoice: await refreshInvoiceTotals(opts.invoiceId),
      duplicate: false,
    };
  }
  return {
    ...(await recordPayment({
      schoolId: opts.schoolId,
      invoiceId: opts.invoiceId,
      amount: opts.amount,
      provider: opts.provider,
      providerRef: opts.providerRef,
      notes: 'Webhook confirmed',
      rawPayload: opts.rawPayload,
    })),
    duplicate: false,
  };
}

export async function financeAgingReport(schoolId: string) {
  const { rows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE balance_due > 0 AND due_date >= CURRENT_DATE)::int AS upcoming,
       COUNT(*) FILTER (WHERE balance_due > 0 AND due_date < CURRENT_DATE)::int AS overdue,
       COALESCE(SUM(balance_due) FILTER (WHERE balance_due > 0 AND due_date >= CURRENT_DATE),0)::float AS upcoming_amount,
       COALESCE(SUM(balance_due) FILTER (WHERE balance_due > 0 AND due_date < CURRENT_DATE),0)::float AS overdue_amount,
       COALESCE(SUM(amount_paid),0)::float AS collected,
       COALESCE(SUM(subtotal + late_fee_total),0)::float AS billed,
       COALESCE(SUM(balance_due) FILTER (WHERE balance_due > 0 AND due_date < CURRENT_DATE AND CURRENT_DATE - due_date <= 30),0)::float AS overdue_0_30,
       COALESCE(SUM(balance_due) FILTER (WHERE balance_due > 0 AND CURRENT_DATE - due_date BETWEEN 31 AND 60),0)::float AS overdue_31_60,
       COALESCE(SUM(balance_due) FILTER (WHERE balance_due > 0 AND CURRENT_DATE - due_date BETWEEN 61 AND 90),0)::float AS overdue_61_90,
       COALESCE(SUM(balance_due) FILTER (WHERE balance_due > 0 AND CURRENT_DATE - due_date > 90),0)::float AS overdue_90_plus,
       COUNT(*) FILTER (WHERE balance_due > 0 AND due_date < CURRENT_DATE AND CURRENT_DATE - due_date <= 30)::int AS count_0_30,
       COUNT(*) FILTER (WHERE balance_due > 0 AND CURRENT_DATE - due_date BETWEEN 31 AND 60)::int AS count_31_60,
       COUNT(*) FILTER (WHERE balance_due > 0 AND CURRENT_DATE - due_date BETWEEN 61 AND 90)::int AS count_61_90,
       COUNT(*) FILTER (WHERE balance_due > 0 AND CURRENT_DATE - due_date > 90)::int AS count_90_plus
     FROM invoices
     WHERE school_id = $1 AND status <> 'cancelled'`,
    [schoolId]
  );
  const r = rows[0];
  const billed = Number(r.billed) || 0;
  const collected = Number(r.collected) || 0;
  return {
    upcomingCount: Number(r.upcoming),
    overdueCount: Number(r.overdue),
    upcomingAmount: Number(r.upcoming_amount),
    overdueAmount: Number(r.overdue_amount),
    collected,
    billed,
    collectionRate: billed > 0 ? Math.round((collected / billed) * 1000) / 10 : 0,
    buckets: {
      d0_30: { count: Number(r.count_0_30), amount: Number(r.overdue_0_30) },
      d31_60: { count: Number(r.count_31_60), amount: Number(r.overdue_31_60) },
      d61_90: { count: Number(r.count_61_90), amount: Number(r.overdue_61_90) },
      d90_plus: { count: Number(r.count_90_plus), amount: Number(r.overdue_90_plus) },
    },
  };
}
