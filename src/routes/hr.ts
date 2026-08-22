import { Router, type Request, type Response } from 'express';
import { requireAuth, requirePermission, enforceSchoolScope } from '../middleware/auth.js';
import {
  listHrEmployees,
  createHrEmployee,
  updateHrEmployee,
  toggleHrEmployeeStatus,
  listLeaveRequests,
  submitLeaveRequest,
  reviewLeaveRequest,
  listPayrollRecords,
  processPayroll,
  updatePayrollStatus,
  listJobPostings,
  createJobPosting,
  updateJobPosting,
  listJobApplications,
  updateJobApplication,
  listPerformanceReviews,
  createPerformanceReview,
  updatePerformanceReview,
  listOnboardingTasks,
  createOnboardingTask,
  toggleOnboardingTask,
  listStaffAttendance,
  recordStaffAttendance,
} from '../services/hr.js';

export const hrRouter = Router();

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

// ---- Employees ----

hrRouter.get(
  '/employees',
  requireAuth,
  requirePermission('hr.view_employees'),
  asyncHandler(async (req, res) => {
    res.json(await listHrEmployees(schoolIdOf(req)));
  })
);

hrRouter.post(
  '/employees',
  requireAuth,
  requirePermission('hr.manage_employees'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    try {
      res.status(201).json(await createHrEmployee({ ...req.body, schoolId: req.body.schoolId || req.user!.schoolId }));
    } catch (err) {
      httpError(err, res);
    }
  })
);

hrRouter.patch(
  '/employees/:id',
  requireAuth,
  requirePermission('hr.manage_employees'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await updateHrEmployee(param(req, 'id'), req.body));
    } catch (err) {
      httpError(err, res);
    }
  })
);

hrRouter.patch(
  '/employees/:id/toggle-status',
  requireAuth,
  requirePermission('hr.manage_employees'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await toggleHrEmployeeStatus(param(req, 'id')));
    } catch (err) {
      httpError(err, res);
    }
  })
);

// ---- Leave requests ----

hrRouter.get(
  '/leave-requests',
  requireAuth,
  requirePermission('hr.view_employees'),
  asyncHandler(async (req, res) => {
    res.json(await listLeaveRequests(schoolIdOf(req)));
  })
);

hrRouter.post(
  '/leave-requests',
  requireAuth,
  requirePermission('hr.manage_leave'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    try {
      res.status(201).json(await submitLeaveRequest({ ...req.body, schoolId: req.body.schoolId || req.user!.schoolId }));
    } catch (err) {
      httpError(err, res);
    }
  })
);

hrRouter.patch(
  '/leave-requests/:id/review',
  requireAuth,
  requirePermission('hr.approve_leave'),
  asyncHandler(async (req, res) => {
    try {
      res.json(
        await reviewLeaveRequest(param(req, 'id'), req.body.status, req.body.reviewerNotes, req.user!.id)
      );
    } catch (err) {
      httpError(err, res);
    }
  })
);

// ---- Payroll ----

hrRouter.get(
  '/payroll',
  requireAuth,
  requirePermission('hr.view_employees'),
  asyncHandler(async (req, res) => {
    res.json(await listPayrollRecords(schoolIdOf(req)));
  })
);

hrRouter.post(
  '/payroll/process',
  requireAuth,
  requirePermission('hr.manage_payroll'),
  asyncHandler(async (req, res) => {
    try {
      res.status(201).json(await processPayroll(req.body.employeeId, req.body.month));
    } catch (err) {
      httpError(err, res);
    }
  })
);

hrRouter.patch(
  '/payroll/:id/status',
  requireAuth,
  requirePermission('hr.manage_payroll'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await updatePayrollStatus(param(req, 'id'), req.body.status));
    } catch (err) {
      httpError(err, res);
    }
  })
);

// ---- Recruitment ----

hrRouter.get(
  '/job-postings',
  requireAuth,
  requirePermission('hr.view_employees'),
  asyncHandler(async (req, res) => {
    res.json(await listJobPostings(schoolIdOf(req)));
  })
);

hrRouter.post(
  '/job-postings',
  requireAuth,
  requirePermission('hr.manage_recruitment'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    try {
      res.status(201).json(await createJobPosting({ ...req.body, schoolId: req.body.schoolId || req.user!.schoolId }));
    } catch (err) {
      httpError(err, res);
    }
  })
);

hrRouter.patch(
  '/job-postings/:id',
  requireAuth,
  requirePermission('hr.manage_recruitment'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await updateJobPosting(param(req, 'id'), req.body));
    } catch (err) {
      httpError(err, res);
    }
  })
);

hrRouter.get(
  '/job-applications',
  requireAuth,
  requirePermission('hr.view_employees'),
  asyncHandler(async (req, res) => {
    res.json(await listJobApplications(schoolIdOf(req)));
  })
);

hrRouter.patch(
  '/job-applications/:id',
  requireAuth,
  requirePermission('hr.manage_recruitment'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await updateJobApplication(param(req, 'id'), req.body.status, req.body.notes));
    } catch (err) {
      httpError(err, res);
    }
  })
);

// ---- Performance reviews ----

hrRouter.get(
  '/performance-reviews',
  requireAuth,
  requirePermission('hr.view_employees'),
  asyncHandler(async (req, res) => {
    res.json(await listPerformanceReviews(schoolIdOf(req)));
  })
);

hrRouter.post(
  '/performance-reviews',
  requireAuth,
  requirePermission('hr.manage_performance'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    try {
      res
        .status(201)
        .json(await createPerformanceReview({ ...req.body, schoolId: req.body.schoolId || req.user!.schoolId }));
    } catch (err) {
      httpError(err, res);
    }
  })
);

hrRouter.patch(
  '/performance-reviews/:id',
  requireAuth,
  requirePermission('hr.manage_performance'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await updatePerformanceReview(param(req, 'id'), req.body));
    } catch (err) {
      httpError(err, res);
    }
  })
);

// ---- Onboarding ----

hrRouter.get(
  '/onboarding-tasks',
  requireAuth,
  requirePermission('hr.view_employees'),
  asyncHandler(async (req, res) => {
    res.json(await listOnboardingTasks(schoolIdOf(req)));
  })
);

hrRouter.post(
  '/onboarding-tasks',
  requireAuth,
  requirePermission('hr.manage_onboarding'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    try {
      res
        .status(201)
        .json(await createOnboardingTask({ ...req.body, schoolId: req.body.schoolId || req.user!.schoolId }));
    } catch (err) {
      httpError(err, res);
    }
  })
);

hrRouter.patch(
  '/onboarding-tasks/:id/toggle',
  requireAuth,
  requirePermission('hr.manage_onboarding'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await toggleOnboardingTask(param(req, 'id')));
    } catch (err) {
      httpError(err, res);
    }
  })
);

// ---- Attendance ----

hrRouter.get(
  '/attendance',
  requireAuth,
  requirePermission('hr.view_employees'),
  asyncHandler(async (req, res) => {
    res.json(await listStaffAttendance(schoolIdOf(req)));
  })
);

hrRouter.post(
  '/attendance',
  requireAuth,
  requirePermission('hr.manage_attendance'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    try {
      res
        .status(201)
        .json(await recordStaffAttendance({ ...req.body, schoolId: req.body.schoolId || req.user!.schoolId }));
    } catch (err) {
      httpError(err, res);
    }
  })
);
