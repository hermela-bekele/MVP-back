import { Router, type Request, type Response } from 'express';
import { requireAuth, requirePermission, enforceSchoolScope } from '../middleware/auth.js';
import {
  listFinancialYears,
  createFinancialYear,
  activateFinancialYear,
  closeFinancialYear,
  listFinancialPeriods,
  closeFinancialPeriod,
  reopenFinancialPeriod,
  listAccounts,
  createAccount,
  updateAccount,
  seedDefaultChartOfAccounts,
} from '../services/financeCore.js';
import { getFinanceDashboardSummary } from '../services/financeDashboard.js';

export const financeRouter = Router();

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: (err?: unknown) => void) => {
    fn(req, res).catch(next);
  };
}

function param(req: Request, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : String(v);
}

function httpError(err: unknown, res: Response) {
  const e = err as { status?: number; message?: string };
  res.status(e.status ?? 500).json({ error: e.message ?? 'Error' });
}

function schoolIdOf(req: Request): string | undefined {
  return (req.query.schoolId as string | undefined) || req.user?.schoolId || undefined;
}

function requireSchoolId(req: Request, res: Response): string | undefined {
  const schoolId = schoolIdOf(req);
  if (!schoolId) {
    res.status(400).json({ error: 'schoolId required' });
    return undefined;
  }
  return schoolId;
}

// ---- Dashboard ----

financeRouter.get(
  '/dashboard-summary',
  requireAuth,
  requirePermission('finance.view_dashboard'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const schoolId = requireSchoolId(req, res);
    if (!schoolId) return;
    res.json(await getFinanceDashboardSummary(schoolId));
  })
);

// ---- Financial years ----

financeRouter.get(
  '/financial-years',
  requireAuth,
  requirePermission('finance.view_dashboard'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const schoolId = requireSchoolId(req, res);
    if (!schoolId) return;
    res.json(await listFinancialYears(schoolId));
  })
);

financeRouter.post(
  '/financial-years',
  requireAuth,
  requirePermission('finance.manage_financial_years'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    try {
      const schoolId = requireSchoolId(req, res);
      if (!schoolId) return;
      const created = await createFinancialYear({
        schoolId,
        name: req.body.name,
        startDate: req.body.startDate,
        endDate: req.body.endDate,
        actorUserId: req.user!.id,
      });
      res.status(201).json(created);
    } catch (err) {
      httpError(err, res);
    }
  })
);

financeRouter.post(
  '/financial-years/:id/activate',
  requireAuth,
  requirePermission('finance.manage_financial_years'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await activateFinancialYear(param(req, 'id'), req.user!.id));
    } catch (err) {
      httpError(err, res);
    }
  })
);

financeRouter.post(
  '/financial-years/:id/close',
  requireAuth,
  requirePermission('finance.manage_financial_years'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await closeFinancialYear(param(req, 'id'), req.user!.id));
    } catch (err) {
      httpError(err, res);
    }
  })
);

// ---- Financial periods ----

financeRouter.get(
  '/financial-periods',
  requireAuth,
  requirePermission('finance.view_dashboard'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const schoolId = requireSchoolId(req, res);
    if (!schoolId) return;
    res.json(await listFinancialPeriods(schoolId, req.query.financialYearId as string | undefined));
  })
);

financeRouter.post(
  '/financial-periods/:id/close',
  requireAuth,
  requirePermission('finance.manage_periods'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await closeFinancialPeriod(param(req, 'id'), req.user!.id));
    } catch (err) {
      httpError(err, res);
    }
  })
);

financeRouter.post(
  '/financial-periods/:id/reopen',
  requireAuth,
  requirePermission('finance.manage_periods'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await reopenFinancialPeriod(param(req, 'id'), req.user!.id));
    } catch (err) {
      httpError(err, res);
    }
  })
);

// ---- Chart of accounts ----

financeRouter.get(
  '/accounts',
  requireAuth,
  requirePermission('finance.view_dashboard'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const schoolId = requireSchoolId(req, res);
    if (!schoolId) return;
    res.json(await listAccounts(schoolId));
  })
);

financeRouter.post(
  '/accounts',
  requireAuth,
  requirePermission('finance.manage_accounts'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    try {
      const schoolId = requireSchoolId(req, res);
      if (!schoolId) return;
      const created = await createAccount({
        schoolId,
        code: req.body.code,
        name: req.body.name,
        accountType: req.body.accountType,
        parentId: req.body.parentId || null,
        description: req.body.description,
        actorUserId: req.user!.id,
      });
      res.status(201).json(created);
    } catch (err) {
      httpError(err, res);
    }
  })
);

financeRouter.patch(
  '/accounts/:id',
  requireAuth,
  requirePermission('finance.manage_accounts'),
  asyncHandler(async (req, res) => {
    try {
      res.json(
        await updateAccount(
          param(req, 'id'),
          {
            name: req.body.name,
            description: req.body.description,
            isActive: req.body.isActive,
          },
          req.user!.id
        )
      );
    } catch (err) {
      httpError(err, res);
    }
  })
);

financeRouter.post(
  '/accounts/seed-defaults',
  requireAuth,
  requirePermission('finance.manage_accounts'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const schoolId = requireSchoolId(req, res);
    if (!schoolId) return;
    res.json(await seedDefaultChartOfAccounts(schoolId, req.user!.id));
  })
);
