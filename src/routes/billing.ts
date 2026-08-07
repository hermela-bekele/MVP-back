import { Router, type Request, type Response } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import {
  listInvoices,
  recordPayment,
  initiateProviderPayment,
  applyLateFee,
  mapInvoice,
  extendInvoiceDeadline,
  waiveInvoiceBalance,
  cancelInvoice,
  handlePaymentWebhook,
  financeAgingReport,
} from '../services/billing.js';
import { runBillingJobs } from '../services/jobs.js';
import { query } from '../db/pool.js';
import { writeAudit } from '../lib/audit.js';
import { enforceSchoolScope } from '../middleware/auth.js';

export const billingRouter = Router();

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

billingRouter.get(
  '/invoices',
  requireAuth,
  asyncHandler(async (req, res) => {
    const role = req.user!.role;
    if (role === 'parent') {
      const parentId = req.user!.linkedParentId;
      if (!parentId) {
        res.json([]);
        return;
      }
      res.json(
        await listInvoices({
          parentId,
          studentId: req.query.studentId as string | undefined,
          status: req.query.status as string | undefined,
        })
      );
      return;
    }
    const schoolId = (req.query.schoolId as string) || req.user!.schoolId || undefined;
    res.json(
      await listInvoices({
        schoolId,
        studentId: req.query.studentId as string | undefined,
        status: req.query.status as string | undefined,
      })
    );
  })
);

billingRouter.get(
  '/invoices/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = param(req, 'id');
    const list = await listInvoices({ invoiceId: id });
    const inv = list[0];
    if (!inv) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    if (req.user!.role === 'parent') {
      if (!req.user!.linkedParentId || inv.parentId !== req.user!.linkedParentId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
    } else if (req.user!.schoolId && inv.schoolId !== req.user!.schoolId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    res.json(inv);
  })
);

billingRouter.post(
  '/invoices/:id/pay',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const amount = Number(req.body.amount);
      const provider = (req.body.provider || 'manual') as
        | 'telebirr'
        | 'bank_transfer'
        | 'chapa'
        | 'manual';
      const inv = (await query('SELECT * FROM invoices WHERE id = $1', [param(req, 'id')])).rows[0];
      if (!inv) {
        res.status(404).json({ error: 'Invoice not found' });
        return;
      }

      if (req.user!.role === 'parent') {
        if (!req.user!.linkedParentId || inv.parent_id !== req.user!.linkedParentId) {
          res.status(403).json({ error: 'Forbidden' });
          return;
        }
      } else if (req.user!.schoolId && inv.school_id !== req.user!.schoolId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      if (provider === 'telebirr' || provider === 'chapa' || provider === 'bank_transfer') {
        if (req.body.confirm !== true) {
          const session = await initiateProviderPayment({
            schoolId: inv.school_id,
            invoiceId: inv.id,
            amount: amount || Number(inv.balance_due),
            provider,
          });
          res.json(session);
          return;
        }
      }

      const result = await recordPayment({
        schoolId: inv.school_id,
        invoiceId: inv.id,
        amount: amount || Number(inv.balance_due),
        provider,
        providerRef: req.body.providerRef,
        recordedBy: req.user!.id,
        notes: req.body.notes,
      });
      res.status(201).json(result);
    } catch (err) {
      httpError(err, res);
    }
  })
);

billingRouter.post(
  '/invoices/:id/record-payment',
  requireAuth,
  requirePermission('billing.record_payment'),
  asyncHandler(async (req, res) => {
    try {
      const inv = (await query('SELECT * FROM invoices WHERE id = $1', [param(req, 'id')])).rows[0];
      if (!inv) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      const result = await recordPayment({
        schoolId: inv.school_id,
        invoiceId: inv.id,
        amount: Number(req.body.amount),
        provider: req.body.provider || 'manual',
        providerRef: req.body.providerRef,
        recordedBy: req.user!.id,
        notes: req.body.notes,
      });
      res.status(201).json(result);
    } catch (err) {
      httpError(err, res);
    }
  })
);

billingRouter.post(
  '/invoices/:id/late-fee',
  requireAuth,
  requirePermission('billing.late_fee'),
  asyncHandler(async (req, res) => {
    res.json(await applyLateFee(param(req, 'id'), Number(req.body.amount), req.body.description));
  })
);

billingRouter.post(
  '/jobs/run',
  requireAuth,
  requirePermission('billing.reconcile'),
  asyncHandler(async (_req, res) => {
    res.json(await runBillingJobs());
  })
);

billingRouter.patch(
  '/invoices/:id/deadline',
  requireAuth,
  requirePermission('admissions.override_deadline'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await extendInvoiceDeadline(param(req, 'id'), req.body.dueDate, req.user!.id));
    } catch (err) {
      httpError(err, res);
    }
  })
);

billingRouter.post(
  '/invoices/:id/waive',
  requireAuth,
  requirePermission('billing.waive'),
  asyncHandler(async (req, res) => {
    try {
      res.json(
        await waiveInvoiceBalance(
          param(req, 'id'),
          Number(req.body.amount),
          req.body.reason || 'Fee waiver',
          req.user!.id
        )
      );
    } catch (err) {
      httpError(err, res);
    }
  })
);

billingRouter.post(
  '/invoices/:id/cancel',
  requireAuth,
  requirePermission('billing.waive'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await cancelInvoice(param(req, 'id'), req.body.reason || 'Cancelled', req.user!.id));
    } catch (err) {
      httpError(err, res);
    }
  })
);

billingRouter.post(
  '/webhooks/:provider',
  asyncHandler(async (req, res) => {
    try {
      const result = await handlePaymentWebhook({
        schoolId: req.body.schoolId,
        provider: param(req, 'provider'),
        providerRef: req.body.providerRef || req.body.tx_ref || req.body.reference,
        status: req.body.status === 'failed' ? 'failed' : req.body.status === 'pending' ? 'pending' : 'succeeded',
        amount: Number(req.body.amount),
        invoiceId: req.body.invoiceId,
        rawPayload: req.body,
      });
      res.json(result);
    } catch (err) {
      httpError(err, res);
    }
  })
);

billingRouter.get(
  '/reports/aging',
  requireAuth,
  requirePermission('billing.view'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const schoolId = (req.query.schoolId as string) || req.user!.schoolId;
    if (!schoolId) {
      res.status(400).json({ error: 'schoolId required' });
      return;
    }
    res.json(await financeAgingReport(schoolId));
  })
);
