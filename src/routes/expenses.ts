import { Router, type Request, type Response } from 'express';
import { requireAuth, requirePermission, enforceSchoolScope } from '../middleware/auth.js';
import {
  listExpenses,
  getExpense,
  createExpense,
  updateExpense,
  removeExpense,
  submitExpense,
  approveExpense,
  rejectExpense,
  returnExpense,
  cancelExpense,
  payExpense,
} from '../services/expenses.js';

export const expensesRouter = Router();

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

function requireSchoolId(req: Request, res: Response): string | undefined {
  const schoolId = (req.query.schoolId as string | undefined) || req.user?.schoolId || undefined;
  if (!schoolId) {
    res.status(400).json({ error: 'schoolId required' });
    return undefined;
  }
  return schoolId;
}

expensesRouter.get(
  '/expenses',
  requireAuth,
  requirePermission('finance.view_dashboard'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const schoolId = requireSchoolId(req, res);
    if (!schoolId) return;
    res.json(
      await listExpenses(schoolId, {
        status: req.query.status as string | undefined,
        department: req.query.department as string | undefined,
      })
    );
  })
);

expensesRouter.get(
  '/expenses/:id',
  requireAuth,
  requirePermission('finance.view_dashboard'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await getExpense(param(req, 'id')));
    } catch (err) {
      httpError(err, res);
    }
  })
);

expensesRouter.post(
  '/expenses',
  requireAuth,
  requirePermission('finance.manage_expense'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    try {
      const schoolId = requireSchoolId(req, res);
      if (!schoolId) return;
      res.status(201).json(
        await createExpense({
          schoolId,
          department: req.body.department,
          accountId: req.body.accountId,
          vendor: req.body.vendor,
          description: req.body.description,
          amount: Number(req.body.amount),
          expenseDate: req.body.expenseDate,
          notes: req.body.notes,
          attachmentUrl: req.body.attachmentUrl,
          actorUserId: req.user!.id,
        })
      );
    } catch (err) {
      httpError(err, res);
    }
  })
);

expensesRouter.patch(
  '/expenses/:id',
  requireAuth,
  requirePermission('finance.manage_expense'),
  asyncHandler(async (req, res) => {
    try {
      res.json(
        await updateExpense(
          param(req, 'id'),
          {
            vendor: req.body.vendor,
            description: req.body.description,
            amount: req.body.amount !== undefined ? Number(req.body.amount) : undefined,
            expenseDate: req.body.expenseDate,
            notes: req.body.notes,
            attachmentUrl: req.body.attachmentUrl,
          },
          req.user!.id
        )
      );
    } catch (err) {
      httpError(err, res);
    }
  })
);

expensesRouter.delete(
  '/expenses/:id',
  requireAuth,
  requirePermission('finance.manage_expense'),
  asyncHandler(async (req, res) => {
    try {
      await removeExpense(param(req, 'id'), req.user!.id);
      res.status(204).end();
    } catch (err) {
      httpError(err, res);
    }
  })
);

expensesRouter.post(
  '/expenses/:id/submit',
  requireAuth,
  requirePermission('finance.manage_expense'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await submitExpense(param(req, 'id'), req.user!.id));
    } catch (err) {
      httpError(err, res);
    }
  })
);

expensesRouter.post(
  '/expenses/:id/approve',
  requireAuth,
  requirePermission('finance.approve_expense'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await approveExpense(param(req, 'id'), req.user!.id));
    } catch (err) {
      httpError(err, res);
    }
  })
);

expensesRouter.post(
  '/expenses/:id/reject',
  requireAuth,
  requirePermission('finance.approve_expense'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await rejectExpense(param(req, 'id'), req.body.reason || 'Rejected', req.user!.id));
    } catch (err) {
      httpError(err, res);
    }
  })
);

expensesRouter.post(
  '/expenses/:id/return',
  requireAuth,
  requirePermission('finance.approve_expense'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await returnExpense(param(req, 'id'), req.body.reason || 'Returned for correction', req.user!.id));
    } catch (err) {
      httpError(err, res);
    }
  })
);

expensesRouter.post(
  '/expenses/:id/cancel',
  requireAuth,
  requirePermission('finance.manage_expense'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await cancelExpense(param(req, 'id'), req.body.reason || 'Cancelled', req.user!.id));
    } catch (err) {
      httpError(err, res);
    }
  })
);

expensesRouter.post(
  '/expenses/:id/pay',
  requireAuth,
  requirePermission('finance.manage_expense'),
  asyncHandler(async (req, res) => {
    try {
      res.json(
        await payExpense(
          param(req, 'id'),
          { paymentMethod: req.body.paymentMethod, paymentReference: req.body.paymentReference },
          req.user!.id
        )
      );
    } catch (err) {
      httpError(err, res);
    }
  })
);
