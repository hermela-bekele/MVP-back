export const PERMISSIONS = [
  { code: 'portal.parent', label: 'Parent portal', module: 'portal' },
  { code: 'portal.student', label: 'Student portal', module: 'portal' },
  { code: 'portal.teacher', label: 'Teacher portal', module: 'portal' },
  { code: 'portal.registrar', label: 'Registrar portal', module: 'portal' },
  { code: 'portal.school_head', label: 'School head portal', module: 'portal' },
  { code: 'portal.finance', label: 'Finance portal', module: 'portal' },
  { code: 'admissions.view', label: 'View applications', module: 'admissions' },
  { code: 'admissions.review', label: 'Review applications', module: 'admissions' },
  { code: 'admissions.score', label: 'Score / prioritize', module: 'admissions' },
  { code: 'admissions.accept', label: 'Accept applications', module: 'admissions' },
  { code: 'admissions.reject', label: 'Reject applications', module: 'admissions' },
  { code: 'admissions.waitlist', label: 'Manage waitlist', module: 'admissions' },
  { code: 'admissions.configure_form', label: 'Configure apply form', module: 'admissions' },
  { code: 'admissions.override_deadline', label: 'Override invoice deadline', module: 'admissions' },
  { code: 'enrollment.view', label: 'View enrollments', module: 'enrollment' },
  { code: 'enrollment.assign_class', label: 'Assign class', module: 'enrollment' },
  { code: 'enrollment.transfer', label: 'Transfer students', module: 'enrollment' },
  { code: 'enrollment.withdraw', label: 'Withdraw students', module: 'enrollment' },
  { code: 'billing.view', label: 'View invoices', module: 'billing' },
  { code: 'billing.create_invoice', label: 'Create invoices', module: 'billing' },
  { code: 'billing.record_payment', label: 'Record payments', module: 'billing' },
  { code: 'billing.waive', label: 'Waive fees', module: 'billing' },
  { code: 'billing.late_fee', label: 'Apply late fees', module: 'billing' },
  { code: 'billing.reconcile', label: 'Reconcile payments', module: 'billing' },
  { code: 'billing.settings', label: 'Billing settings', module: 'billing' },
  { code: 'grades.enter', label: 'Enter grades', module: 'academics' },
  { code: 'grades.publish', label: 'Publish grades', module: 'academics' },
  { code: 'attendance.enter', label: 'Enter attendance', module: 'academics' },
  { code: 'timetable.manage', label: 'Manage timetable', module: 'academics' },
  { code: 'calendar.manage', label: 'Manage calendar', module: 'academics' },
  { code: 'materials.manage', label: 'Manage materials', module: 'academics' },
  { code: 'practice.manage', label: 'Manage practice sets', module: 'academics' },
  { code: 'announcements.manage', label: 'Manage announcements', module: 'comms' },
  { code: 'messages.teacher_parent', label: 'Teacher–parent messages', module: 'comms' },
  { code: 'messages.school_head_parent', label: 'School head–parent messages', module: 'comms' },
  { code: 'feedback.view', label: 'View feedback', module: 'comms' },
  { code: 'documents.view', label: 'View documents', module: 'documents' },
  { code: 'documents.upload', label: 'Upload documents', module: 'documents' },
  { code: 'documents.verify', label: 'Verify documents', module: 'documents' },
  { code: 'users.manage', label: 'Manage users', module: 'admin' },
  { code: 'roles.manage', label: 'Manage roles', module: 'admin' },
  { code: 'permissions.grant', label: 'Grant permissions', module: 'admin' },
  { code: 'school.settings', label: 'School settings', module: 'admin' },
  { code: 'reports.view', label: 'View reports', module: 'admin' },
  { code: 'reports.generate', label: 'Generate report cards / transcripts', module: 'academics' },
  { code: 'audit.view', label: 'View audit trail', module: 'admin' },
  { code: 'enrollment.promote', label: 'Promote students to next grade', module: 'enrollment' },
  { code: 'enrollment.bulk_import', label: 'Bulk import students', module: 'enrollment' },
  { code: 'portal.hr', label: 'HR portal', module: 'portal' },
  { code: 'hr.view_employees', label: 'View staff records', module: 'hr' },
  { code: 'hr.manage_employees', label: 'Manage staff records', module: 'hr' },
  { code: 'hr.manage_leave', label: 'Submit leave requests', module: 'hr' },
  { code: 'hr.approve_leave', label: 'Approve/reject leave requests', module: 'hr' },
  { code: 'hr.manage_payroll', label: 'Process payroll', module: 'hr' },
  { code: 'hr.manage_recruitment', label: 'Manage job postings & applications', module: 'hr' },
  { code: 'hr.manage_performance', label: 'Manage performance reviews', module: 'hr' },
  { code: 'hr.manage_onboarding', label: 'Manage onboarding tasks', module: 'hr' },
  { code: 'hr.manage_attendance', label: 'Record staff attendance', module: 'hr' },
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number]['code'];

export const ROLE_DEFAULT_PERMISSIONS: Record<string, PermissionCode[]> = {
  moe: PERMISSIONS.map((p) => p.code),
  'school-head': [
    'portal.school_head',
    'admissions.view',
    'admissions.configure_form',
    'enrollment.view',
    'enrollment.transfer',
    'enrollment.withdraw',
    'billing.view',
    'billing.settings',
    'grades.publish',
    'timetable.manage',
    'calendar.manage',
    'announcements.manage',
    'messages.school_head_parent',
    'documents.view',
    'documents.verify',
    'users.manage',
    'roles.manage',
    'permissions.grant',
    'school.settings',
    'reports.view',
    'audit.view',
    'hr.view_employees',
    'hr.approve_leave',
  ],
  registrar: [
    'portal.registrar',
    'admissions.view',
    'admissions.review',
    'admissions.score',
    'admissions.accept',
    'admissions.reject',
    'admissions.waitlist',
    'admissions.configure_form',
    'admissions.override_deadline',
    'enrollment.view',
    'enrollment.assign_class',
    'enrollment.transfer',
    'enrollment.withdraw',
    'enrollment.promote',
    'enrollment.bulk_import',
    'billing.view',
    'billing.create_invoice',
    'billing.record_payment',
    'documents.view',
    'documents.verify',
    'reports.view',
    'reports.generate',
    'audit.view',
  ],
  finance: [
    'portal.finance',
    'billing.view',
    'billing.create_invoice',
    'billing.record_payment',
    'billing.waive',
    'billing.late_fee',
    'billing.reconcile',
    'billing.settings',
    'reports.view',
  ],
  teacher: [
    'portal.teacher',
    'grades.enter',
    'grades.publish',
    'attendance.enter',
    'materials.manage',
    'practice.manage',
    'messages.teacher_parent',
    'feedback.view',
    'documents.view',
    'documents.upload',
  ],
  parent: [
    'portal.parent',
    'documents.view',
    'messages.teacher_parent',
    'feedback.view',
  ],
  student: [
    'portal.student',
    'documents.view',
    'feedback.view',
  ],
  hr: [
    'portal.hr',
    'hr.view_employees',
    'hr.manage_employees',
    'hr.manage_leave',
    'hr.approve_leave',
    'hr.manage_payroll',
    'hr.manage_recruitment',
    'hr.manage_performance',
    'hr.manage_onboarding',
    'hr.manage_attendance',
    'reports.view',
  ],
  'department-head': ['grades.publish', 'materials.manage', 'reports.view', 'hr.view_employees'],
  'head-of-academics': ['materials.manage', 'calendar.manage', 'reports.view', 'reports.generate', 'school.settings', 'hr.view_employees'],
};

import { query } from '../db/pool.js';

export async function getEffectivePermissions(
  userId: string,
  role: string,
  schoolId: string | null
): Promise<Set<string>> {
  const perms = new Set<string>();

  if (schoolId) {
    const { rows } = await query(
      `SELECT permission_code FROM role_permissions WHERE role = $1 AND school_id = $2`,
      [role, schoolId]
    );
    for (const r of rows) perms.add(r.permission_code as string);
  }

  if (perms.size === 0) {
    for (const p of ROLE_DEFAULT_PERMISSIONS[role] ?? []) perms.add(p);
  }

  if (schoolId) {
    const { rows: overrides } = await query(
      `SELECT permission_code, effect FROM user_permissions WHERE user_id = $1 AND school_id = $2`,
      [userId, schoolId]
    );
    for (const o of overrides) {
      if (o.effect === 'allow') perms.add(o.permission_code as string);
      if (o.effect === 'deny') perms.delete(o.permission_code as string);
    }
  }

  return perms;
}

export async function userHasPermission(
  userId: string,
  role: string,
  schoolId: string | null,
  code: string
): Promise<boolean> {
  const set = await getEffectivePermissions(userId, role, schoolId);
  return set.has(code);
}
