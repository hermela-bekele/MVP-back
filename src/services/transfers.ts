import { query } from '../db/pool.js';
import { newId } from '../lib/ids.js';
import { writeAudit } from '../lib/audit.js';
import { resolveGradeFees } from './admissions.js';
import { refreshInvoiceTotals } from './billing.js';

/**
 * Change student enrollment status. On transfer/graduate, apply a prorated
 * tuition credit line to the latest open monthly invoice when present.
 */
export async function changeStudentStatus(opts: {
  studentId: string;
  status: 'Active' | 'Suspended' | 'Transferred' | 'Graduated';
  notes?: string;
  actorUserId?: string;
  applyProration?: boolean;
}) {
  const { rows } = await query('SELECT * FROM students WHERE id = $1', [opts.studentId]);
  const student = rows[0];
  if (!student) throw Object.assign(new Error('Student not found'), { status: 404 });

  await query(`UPDATE students SET status = $1 WHERE id = $2`, [opts.status, opts.studentId]);

  const leaving = opts.status === 'Transferred' || opts.status === 'Graduated';
  if (leaving) {
    await query(
      `UPDATE enrollments SET status = 'withdrawn', withdrawn_at = NOW()
       WHERE student_id = $1 AND status IN ('active','provisional')`,
      [opts.studentId]
    );
  } else if (opts.status === 'Active') {
    await query(
      `UPDATE enrollments SET status = 'active', activated_at = COALESCE(activated_at, NOW()), withdrawn_at = NULL
       WHERE id = (
         SELECT id FROM enrollments WHERE student_id = $1 ORDER BY created_at DESC LIMIT 1
       )`,
      [opts.studentId]
    );
  } else if (opts.status === 'Suspended') {
    await query(
      `UPDATE enrollments SET status = 'suspended' WHERE student_id = $1 AND status = 'active'`,
      [opts.studentId]
    );
  }

  let prorationCredit = 0;
  let creditedInvoiceId: string | null = null;
  if (leaving && opts.applyProration !== false) {
    const fees = await resolveGradeFees(student.school_id, student.grade);
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysRemaining = Math.max(0, daysInMonth - now.getDate());
    const credit = Math.round((daysRemaining / daysInMonth) * fees.monthlyTuition * 100) / 100;

    if (credit > 0) {
      const open = (
        await query(
          `SELECT id FROM invoices
           WHERE student_id = $1 AND balance_due > 0 AND status NOT IN ('cancelled','paid')
           ORDER BY due_date DESC LIMIT 1`,
          [opts.studentId]
        )
      ).rows[0];
      if (open) {
        await query(
          `INSERT INTO invoice_line_items (id, invoice_id, description, quantity, unit_amount, line_total, line_type)
           VALUES ($1,$2,$3,1,$4,$4,'credit')`,
          [
            newId('ili'),
            open.id,
            `Transfer proration credit (${daysRemaining}/${daysInMonth} days)${opts.notes ? `: ${opts.notes}` : ''}`,
            -Math.min(credit, Number((await query('SELECT balance_due FROM invoices WHERE id = $1', [open.id])).rows[0]?.balance_due || credit)),
          ]
        );
        await refreshInvoiceTotals(open.id);
        creditedInvoiceId = open.id;
        prorationCredit = credit;
      }
    }
  }

  await writeAudit({
    schoolId: student.school_id,
    actorUserId: opts.actorUserId,
    action: 'enrollment.status_change',
    entityType: 'student',
    entityId: opts.studentId,
    metadata: { status: opts.status, notes: opts.notes, prorationCredit, creditedInvoiceId },
  });

  const updated = (await query('SELECT * FROM students WHERE id = $1', [opts.studentId])).rows[0];
  return { student: updated, prorationCredit, creditedInvoiceId };
}
