import { query } from '../db/pool.js';
import {
  sendInvoiceReminder,
  sendOverdueInvoiceNotice,
  applyLateFee,
  createMonthlyInvoice,
  refreshInvoiceTotals,
} from './billing.js';
import { expireUnpaidAdmission, getSchoolSettings } from './admissions.js';
import { daysUntil } from '../lib/ids.js';

export async function runBillingJobs() {
  const results = {
    reminders: 0,
    expiredAdmissions: 0,
    lateFees: 0,
    monthlyInvoices: 0,
    overdueNotices: 0,
  };

  // 1) Single reminder before deadline (reminder_days_before from school settings)
  const { rows: dueSoon } = await query(
    `SELECT i.*, s.reminder_days_before
     FROM invoices i
     JOIN school_settings s ON s.school_id = i.school_id
     WHERE i.status IN ('sent','partially_paid','overdue')
       AND i.balance_due > 0
       AND i.reminder_sent_at IS NULL`
  );

  for (const inv of dueSoon) {
    const remaining = daysUntil(String(inv.due_date));
    const remindAt = Number(inv.reminder_days_before ?? 3);
    if (remaining <= remindAt && remaining >= 0) {
      const sent = await sendInvoiceReminder(inv.id);
      if (sent) results.reminders += 1;
    }
  }

  // 2) Expire unpaid admission invoices past due
  const { rows: overdueAdmission } = await query(
    `SELECT * FROM invoices
     WHERE invoice_type = 'admission'
       AND status IN ('sent','partially_paid','overdue')
       AND balance_due > 0
       AND due_date < CURRENT_DATE`
  );
  for (const inv of overdueAdmission) {
    await expireUnpaidAdmission(inv.id);
    results.expiredAdmissions += 1;
  }

  // 3) Late fees + overdue notice for monthly invoices past due (once)
  const { rows: overdueMonthly } = await query(
    `SELECT i.*, s.late_fee_type, s.late_fee_amount
     FROM invoices i
     JOIN school_settings s ON s.school_id = i.school_id
     WHERE i.invoice_type = 'monthly'
       AND i.status IN ('sent','partially_paid','overdue')
       AND i.balance_due > 0
       AND i.due_date < CURRENT_DATE
       AND i.overdue_notified_at IS NULL`
  );
  for (const inv of overdueMonthly) {
    const noticed = await sendOverdueInvoiceNotice(inv.id);
    if (noticed) results.overdueNotices += 1;
    const fee =
      inv.late_fee_type === 'percent'
        ? (Number(inv.balance_due) * Number(inv.late_fee_amount)) / 100
        : Number(inv.late_fee_amount);
    if (fee > 0) {
      await applyLateFee(inv.id, fee);
      results.lateFees += 1;
    }
    await query(`UPDATE invoices SET overdue_notified_at = NOW(), status = 'overdue' WHERE id = $1`, [
      inv.id,
    ]);
    await refreshInvoiceTotals(inv.id);
  }

  // 4) Generate monthly invoices for active enrollments (idempotent per period)
  const period = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const { rows: active } = await query(
    `SELECT e.*, st.parent_email, p.id AS resolved_parent_id, sch.code AS school_code
     FROM enrollments e
     JOIN students st ON st.id = e.student_id
     JOIN schools sch ON sch.id = e.school_id
     LEFT JOIN parent_student_links psl ON psl.student_id = st.id
     LEFT JOIN parents p ON p.id = psl.parent_id
     WHERE e.status = 'active'`
  );

  const seen = new Set<string>();
  for (const enr of active) {
    const key = `${enr.student_id}:${period}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const settings = await getSchoolSettings(enr.school_id);
    const { resolveGradeFees } = await import('./admissions.js');
    const fees = await resolveGradeFees(enr.school_id, enr.grade);
    let amount = fees.monthlyTuition;
    if (fees.siblingDiscountPercent > 0 && enr.resolved_parent_id) {
      const sib = await query(
        `SELECT COUNT(*)::int AS c FROM parent_student_links psl
         JOIN students s ON s.id = psl.student_id
         WHERE psl.parent_id = $1 AND s.school_id = $2 AND s.id <> $3 AND s.status = 'Active'`,
        [enr.resolved_parent_id, enr.school_id, enr.student_id]
      );
      if (Number(sib.rows[0]?.c || 0) > 0) {
        amount = Math.round(amount * (1 - fees.siblingDiscountPercent / 100) * 100) / 100;
      }
    }
    const before = await query(
      `SELECT id FROM invoices WHERE school_id = $1 AND student_id = $2 AND invoice_type = 'monthly' AND billing_period = $3`,
      [enr.school_id, enr.student_id, period]
    );
    await createMonthlyInvoice({
      schoolId: enr.school_id,
      studentId: enr.student_id,
      parentId: enr.resolved_parent_id ?? null,
      amount,
      currency: fees.currency,
      schoolCode: enr.school_code,
      dueDay: Number(settings.monthly_due_day),
      billingPeriod: period,
    });
    if (!before.rows[0]) results.monthlyInvoices += 1;
  }

  return results;
}
