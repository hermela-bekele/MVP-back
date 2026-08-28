import { query } from '../db/pool.js';
import { financeAgingReport } from './billing.js';
import { getActiveFinancialYear } from './financeCore.js';

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Real, server-side finance KPIs for Phase 1. Only sources that exist and are
 * populated today (invoices/payments for AR, payroll_records for payroll) are
 * aggregated here — budget/banking/payables/approvals keys are omitted rather
 * than faked until those modules ship in later phases.
 */
export async function getFinanceDashboardSummary(schoolId: string) {
  const [revenueTotals, monthlyRevenue, aging, payrollThisMonth, activeFinancialYear] = await Promise.all([
    query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::float AS total FROM payments WHERE school_id = $1 AND status = 'succeeded'`,
      [schoolId]
    ),
    query<{ month: string; total: string }>(
      `SELECT to_char(date_trunc('month', paid_at), 'YYYY-MM') AS month, SUM(amount)::float AS total
       FROM payments
       WHERE school_id = $1 AND status = 'succeeded' AND paid_at >= NOW() - INTERVAL '11 months'
       GROUP BY 1
       ORDER BY 1 ASC`,
      [schoolId]
    ),
    financeAgingReport(schoolId),
    query<{ total: string }>(
      `SELECT COALESCE(SUM(net_pay), 0)::float AS total FROM payroll_records WHERE school_id = $1 AND month = $2`,
      [schoolId, currentMonthKey()]
    ),
    getActiveFinancialYear(schoolId),
  ]);

  return {
    schoolId,
    activeFinancialYear,
    revenue: {
      total: Number(revenueTotals.rows[0]?.total ?? 0),
      monthlyTrend: monthlyRevenue.rows.map((r) => ({ name: r.month, total: Number(r.total) })),
    },
    receivables: {
      outstandingAmount: aging.upcomingAmount + aging.overdueAmount,
      overdueAmount: aging.overdueAmount,
      overdueCount: aging.overdueCount,
      collectionRate: aging.collectionRate,
      buckets: aging.buckets,
    },
    payroll: {
      currentMonth: currentMonthKey(),
      totalNetPay: Number(payrollThisMonth.rows[0]?.total ?? 0),
    },
  };
}
