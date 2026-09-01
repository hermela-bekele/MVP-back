import { Router, type Request, type Response } from 'express';
import { requireAuth, requirePermission, enforceSchoolScope } from '../middleware/auth.js';
import {
  listSuppliers,
  createSupplier,
  updateSupplier,
  listSupplierInvoices,
  getSupplierInvoice,
  createSupplierInvoice,
  submitSupplierInvoice,
  approveSupplierInvoice,
  rejectSupplierInvoice,
  cancelSupplierInvoice,
  recordSupplierPayment,
} from '../services/payables.js';

export const payablesRouter = Router();

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

// ---- Suppliers ----

payablesRouter.get(
  '/suppliers',
  requireAuth,
  requirePermission('finance.view_dashboard'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const schoolId = requireSchoolId(req, res);
    if (!schoolId) return;
    res.json(await listSuppliers(schoolId));
  })
);

payablesRouter.post(
  '/suppliers',
  requireAuth,
  requirePermission('finance.manage_payable'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    try {
      const schoolId = requireSchoolId(req, res);
      if (!schoolId) return;
      res.status(201).json(
        await createSupplier({
          schoolId,
          name: req.body.name,
          contactName: req.body.contactName,
          email: req.body.email,
          phone: req.body.phone,
          address: req.body.address,
          taxId: req.body.taxId,
          bankDetails: req.body.bankDetails,
          actorUserId: req.user!.id,
        })
      );
    } catch (err) {
      httpError(err, res);
    }
  })
);

payablesRouter.patch(
  '/suppliers/:id',
  requireAuth,
  requirePermission('finance.manage_payable'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await updateSupplier(param(req, 'id'), req.body, req.user!.id));
    } catch (err) {
      httpError(err, res);
    }
  })
);

// ---- Supplier invoices ----

payablesRouter.get(
  '/supplier-invoices',
  requireAuth,
  requirePermission('finance.view_dashboard'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const schoolId = requireSchoolId(req, res);
    if (!schoolId) return;
    res.json(
      await listSupplierInvoices(schoolId, {
        status: req.query.status as string | undefined,
        supplierId: req.query.supplierId as string | undefined,
      })
    );
  })
);

payablesRouter.get(
  '/supplier-invoices/:id',
  requireAuth,
  requirePermission('finance.view_dashboard'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await getSupplierInvoice(param(req, 'id')));
    } catch (err) {
      httpError(err, res);
    }
  })
);

payablesRouter.post(
  '/supplier-invoices',
  requireAuth,
  requirePermission('finance.manage_payable'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    try {
      const schoolId = requireSchoolId(req, res);
      if (!schoolId) return;
      res.status(201).json(
        await createSupplierInvoice({
          schoolId,
          supplierId: req.body.supplierId,
          department: req.body.department,
          accountId: req.body.accountId,
          invoiceNumber: req.body.invoiceNumber,
          poReference: req.body.poReference,
          invoiceDate: req.body.invoiceDate,
          dueDate: req.body.dueDate,
          subtotal: Number(req.body.subtotal),
          taxAmount: req.body.taxAmount !== undefined ? Number(req.body.taxAmount) : undefined,
          currency: req.body.currency,
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

payablesRouter.post(
  '/supplier-invoices/:id/submit',
  requireAuth,
  requirePermission('finance.manage_payable'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await submitSupplierInvoice(param(req, 'id'), req.user!.id));
    } catch (err) {
      httpError(err, res);
    }
  })
);

payablesRouter.post(
  '/supplier-invoices/:id/approve',
  requireAuth,
  requirePermission('finance.approve_payable'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await approveSupplierInvoice(param(req, 'id'), req.user!.id));
    } catch (err) {
      httpError(err, res);
    }
  })
);

payablesRouter.post(
  '/supplier-invoices/:id/reject',
  requireAuth,
  requirePermission('finance.approve_payable'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await rejectSupplierInvoice(param(req, 'id'), req.body.reason || 'Rejected', req.user!.id));
    } catch (err) {
      httpError(err, res);
    }
  })
);

payablesRouter.post(
  '/supplier-invoices/:id/cancel',
  requireAuth,
  requirePermission('finance.manage_payable'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await cancelSupplierInvoice(param(req, 'id'), req.body.reason || 'Cancelled', req.user!.id));
    } catch (err) {
      httpError(err, res);
    }
  })
);

payablesRouter.post(
  '/supplier-invoices/:id/payments',
  requireAuth,
  requirePermission('finance.manage_payable'),
  asyncHandler(async (req, res) => {
    try {
      res.status(201).json(
        await recordSupplierPayment(
          param(req, 'id'),
          {
            amount: Number(req.body.amount),
            method: req.body.method,
            reference: req.body.reference,
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
