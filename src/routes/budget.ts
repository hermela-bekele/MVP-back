import { Router, type Request, type Response } from 'express';
import { requireAuth, requirePermission, enforceSchoolScope } from '../middleware/auth.js';
import {
  listBudgets,
  getBudget,
  createBudget,
  addBudgetLine,
  updateBudgetLine,
  removeBudgetLine,
  submitBudget,
  approveBudget,
  rejectBudget,
  returnBudget,
  reviseBudget,
  createBudgetTransfer,
  approveBudgetTransfer,
  rejectBudgetTransfer,
  getBudgetUtilization,
} from '../services/budget.js';

export const budgetRouter = Router();

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

budgetRouter.get(
  '/budgets',
  requireAuth,
  requirePermission('finance.view_dashboard'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const schoolId = requireSchoolId(req, res);
    if (!schoolId) return;
    res.json(await listBudgets(schoolId, req.query.financialYearId as string | undefined));
  })
);

budgetRouter.get(
  '/budgets/:id',
  requireAuth,
  requirePermission('finance.view_dashboard'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await getBudget(param(req, 'id')));
    } catch (err) {
      httpError(err, res);
    }
  })
);

budgetRouter.get(
  '/budgets/:id/utilization',
  requireAuth,
  requirePermission('finance.view_dashboard'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await getBudgetUtilization(param(req, 'id')));
    } catch (err) {
      httpError(err, res);
    }
  })
);

budgetRouter.post(
  '/budgets',
  requireAuth,
  requirePermission('finance.manage_budget'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    try {
      const schoolId = requireSchoolId(req, res);
      if (!schoolId) return;
      res
        .status(201)
        .json(await createBudget({ schoolId, financialYearId: req.body.financialYearId, name: req.body.name, actorUserId: req.user!.id }));
    } catch (err) {
      httpError(err, res);
    }
  })
);

budgetRouter.post(
  '/budgets/:id/lines',
  requireAuth,
  requirePermission('finance.manage_budget'),
  asyncHandler(async (req, res) => {
    try {
      res.status(201).json(
        await addBudgetLine(
          param(req, 'id'),
          {
            department: req.body.department,
            accountId: req.body.accountId,
            allocatedAmount: Number(req.body.allocatedAmount),
            notes: req.body.notes,
          },
          req.user!.id
        )
      );
    } catch (err) {
      httpError(err, res);
    }
  })
);

budgetRouter.patch(
  '/budget-lines/:id',
  requireAuth,
  requirePermission('finance.manage_budget'),
  asyncHandler(async (req, res) => {
    try {
      res.json(
        await updateBudgetLine(
          param(req, 'id'),
          { allocatedAmount: req.body.allocatedAmount !== undefined ? Number(req.body.allocatedAmount) : undefined, notes: req.body.notes },
          req.user!.id
        )
      );
    } catch (err) {
      httpError(err, res);
    }
  })
);

budgetRouter.delete(
  '/budget-lines/:id',
  requireAuth,
  requirePermission('finance.manage_budget'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await removeBudgetLine(param(req, 'id'), req.user!.id));
    } catch (err) {
      httpError(err, res);
    }
  })
);

budgetRouter.post(
  '/budgets/:id/submit',
  requireAuth,
  requirePermission('finance.manage_budget'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await submitBudget(param(req, 'id'), req.user!.id));
    } catch (err) {
      httpError(err, res);
    }
  })
);

budgetRouter.post(
  '/budgets/:id/approve',
  requireAuth,
  requirePermission('finance.approve_budget'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await approveBudget(param(req, 'id'), req.user!.id));
    } catch (err) {
      httpError(err, res);
    }
  })
);

budgetRouter.post(
  '/budgets/:id/reject',
  requireAuth,
  requirePermission('finance.approve_budget'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await rejectBudget(param(req, 'id'), req.body.reason || 'Rejected', req.user!.id));
    } catch (err) {
      httpError(err, res);
    }
  })
);

budgetRouter.post(
  '/budgets/:id/return',
  requireAuth,
  requirePermission('finance.approve_budget'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await returnBudget(param(req, 'id'), req.body.reason || 'Returned for correction', req.user!.id));
    } catch (err) {
      httpError(err, res);
    }
  })
);

budgetRouter.post(
  '/budgets/:id/revise',
  requireAuth,
  requirePermission('finance.manage_budget'),
  asyncHandler(async (req, res) => {
    try {
      res.status(201).json(await reviseBudget(param(req, 'id'), req.user!.id));
    } catch (err) {
      httpError(err, res);
    }
  })
);

budgetRouter.post(
  '/budget-transfers',
  requireAuth,
  requirePermission('finance.manage_budget'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    try {
      const schoolId = requireSchoolId(req, res);
      if (!schoolId) return;
      res.status(201).json(
        await createBudgetTransfer({
          schoolId,
          budgetId: req.body.budgetId,
          fromLineId: req.body.fromLineId,
          toLineId: req.body.toLineId,
          amount: Number(req.body.amount),
          reason: req.body.reason,
          actorUserId: req.user!.id,
        })
      );
    } catch (err) {
      httpError(err, res);
    }
  })
);

budgetRouter.post(
  '/budget-transfers/:id/approve',
  requireAuth,
  requirePermission('finance.approve_budget'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await approveBudgetTransfer(param(req, 'id'), req.user!.id));
    } catch (err) {
      httpError(err, res);
    }
  })
);

budgetRouter.post(
  '/budget-transfers/:id/reject',
  requireAuth,
  requirePermission('finance.approve_budget'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await rejectBudgetTransfer(param(req, 'id'), req.body.reason || 'Rejected', req.user!.id));
    } catch (err) {
      httpError(err, res);
    }
  })
);
