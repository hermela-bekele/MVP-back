import { query, withTransaction } from '../db/pool.js';
import { newId } from '../lib/ids.js';
import { writeAudit } from '../lib/audit.js';
import {
  mapHrEmployee,
  mapLeaveRequest,
  mapPayrollRecord,
  mapJobPosting,
  mapJobApplication,
  mapPerformanceReview,
  mapOnboardingTask,
  mapStaffAttendanceRecord,
} from '../lib/serialize.js';

function notFound(what: string) {
  return Object.assign(new Error(`${what} not found`), { status: 404 });
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

export async function listHrEmployees(schoolId?: string) {
  const { rows } = schoolId
    ? await query('SELECT * FROM hr_employees WHERE school_id = $1 ORDER BY name', [schoolId])
    : await query('SELECT * FROM hr_employees ORDER BY name');
  return rows.map(mapHrEmployee);
}

async function nextEmployeeId(schoolId: string): Promise<string> {
  const { rows } = await query('SELECT COUNT(*)::int AS c FROM hr_employees WHERE school_id = $1', [schoolId]);
  const year = new Date().getFullYear();
  return `EMP-${year}-${String(Number(rows[0].c) + 1).padStart(3, '0')}`;
}

export async function createHrEmployee(data: {
  name: string;
  email: string;
  phone: string;
  position: string;
  department: string;
  employmentType: string;
  hireDate: string;
  salary: number;
  status?: string;
  schoolId: string;
  manager?: string;
  emergencyContact?: string;
  teacherId?: string;
}) {
  const id = newId('emp');
  const employeeId = await nextEmployeeId(data.schoolId);
  await query(
    `INSERT INTO hr_employees
       (id, employee_id, name, email, phone, position, department, employment_type, hire_date, salary, status, school_id, manager, emergency_contact, teacher_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      id,
      employeeId,
      data.name,
      data.email,
      data.phone,
      data.position,
      data.department,
      data.employmentType,
      data.hireDate,
      data.salary,
      data.status ?? 'Active',
      data.schoolId,
      data.manager ?? null,
      data.emergencyContact ?? null,
      data.teacherId ?? null,
    ]
  );
  await writeAudit({
    schoolId: data.schoolId,
    action: 'hr.employee.create',
    entityType: 'hr_employee',
    entityId: id,
    metadata: { name: data.name, position: data.position },
  });
  const { rows } = await query('SELECT * FROM hr_employees WHERE id = $1', [id]);
  return mapHrEmployee(rows[0]);
}

const EMPLOYEE_UPDATE_COLUMNS: Record<string, string> = {
  name: 'name',
  email: 'email',
  phone: 'phone',
  position: 'position',
  department: 'department',
  employmentType: 'employment_type',
  hireDate: 'hire_date',
  salary: 'salary',
  status: 'status',
  manager: 'manager',
  emergencyContact: 'emergency_contact',
  teacherId: 'teacher_id',
};

export async function updateHrEmployee(id: string, updates: Record<string, unknown>) {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  for (const [key, column] of Object.entries(EMPLOYEE_UPDATE_COLUMNS)) {
    if (key in updates) {
      sets.push(`${column} = $${i}`);
      params.push(updates[key] ?? null);
      i++;
    }
  }
  if (sets.length > 0) {
    sets.push('updated_at = NOW()');
    params.push(id);
    const { rowCount } = await query(`UPDATE hr_employees SET ${sets.join(', ')} WHERE id = $${i}`, params);
    if (rowCount === 0) throw notFound('Employee');
  }
  const { rows } = await query('SELECT * FROM hr_employees WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('Employee');
  return mapHrEmployee(rows[0]);
}

export async function toggleHrEmployeeStatus(id: string) {
  const { rows } = await query('SELECT * FROM hr_employees WHERE id = $1', [id]);
  const emp = rows[0];
  if (!emp) throw notFound('Employee');
  const nextStatus =
    emp.status === 'Active' ? 'Terminated' : emp.status === 'Terminated' ? 'Active' : emp.status;
  await query('UPDATE hr_employees SET status = $1, updated_at = NOW() WHERE id = $2', [nextStatus, id]);
  await writeAudit({
    schoolId: emp.school_id as string,
    action: 'hr.employee.status_toggle',
    entityType: 'hr_employee',
    entityId: id,
    metadata: { from: emp.status, to: nextStatus },
  });
  const { rows: updated } = await query('SELECT * FROM hr_employees WHERE id = $1', [id]);
  return mapHrEmployee(updated[0]);
}

// ---------------------------------------------------------------------------
// Leave requests
// ---------------------------------------------------------------------------

export async function listLeaveRequests(schoolId?: string) {
  const { rows } = schoolId
    ? await query('SELECT * FROM leave_requests WHERE school_id = $1 ORDER BY submitted_at DESC', [schoolId])
    : await query('SELECT * FROM leave_requests ORDER BY submitted_at DESC');
  return rows.map(mapLeaveRequest);
}

export async function submitLeaveRequest(data: {
  employeeId: string;
  employeeName: string;
  type: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  schoolId: string;
}) {
  const id = newId('leave');
  const submittedAt = new Date().toISOString().slice(0, 10);
  await query(
    `INSERT INTO leave_requests (id, employee_id, employee_name, type, start_date, end_date, days, reason, status, school_id, submitted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Pending',$9,$10)`,
    [id, data.employeeId, data.employeeName, data.type, data.startDate, data.endDate, data.days, data.reason, data.schoolId, submittedAt]
  );
  const { rows } = await query('SELECT * FROM leave_requests WHERE id = $1', [id]);
  return mapLeaveRequest(rows[0]);
}

export async function reviewLeaveRequest(
  id: string,
  status: 'Approved' | 'Rejected' | 'Cancelled',
  reviewerNotes: string | undefined,
  actorUserId?: string
) {
  return withTransaction(async (client) => {
    const { rows: reqRows } = await client.query('SELECT * FROM leave_requests WHERE id = $1', [id]);
    const req = reqRows[0];
    if (!req) throw notFound('Leave request');

    const reviewedAt = new Date().toISOString().slice(0, 10);
    await client.query(
      `UPDATE leave_requests SET status = $1, reviewer_notes = $2, reviewed_at = $3, updated_at = NOW() WHERE id = $4`,
      [status, reviewerNotes ?? null, reviewedAt, id]
    );

    if (status === 'Approved') {
      const { rows: empRows } = await client.query('SELECT * FROM hr_employees WHERE id = $1', [req.employee_id]);
      const employee = empRows[0];
      if (employee) {
        await client.query(`UPDATE hr_employees SET status = 'On Leave', updated_at = NOW() WHERE id = $1`, [
          employee.id,
        ]);
        if (employee.teacher_id) {
          await client.query(`UPDATE teachers SET status = 'On Leave' WHERE id = $1`, [employee.teacher_id]);
        }
      }
    }

    await writeAudit({
      schoolId: req.school_id as string,
      actorUserId: actorUserId ?? null,
      action: 'hr.leave.review',
      entityType: 'leave_request',
      entityId: id,
      metadata: { status },
    });

    const { rows } = await client.query('SELECT * FROM leave_requests WHERE id = $1', [id]);
    return mapLeaveRequest(rows[0]);
  });
}

// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------

export async function listPayrollRecords(schoolId?: string) {
  const { rows } = schoolId
    ? await query('SELECT * FROM payroll_records WHERE school_id = $1 ORDER BY month DESC', [schoolId])
    : await query('SELECT * FROM payroll_records ORDER BY month DESC');
  return rows.map(mapPayrollRecord);
}

export async function processPayroll(employeeId: string, month: string) {
  const { rows: empRows } = await query('SELECT * FROM hr_employees WHERE id = $1', [employeeId]);
  const employee = empRows[0];
  if (!employee) throw notFound('Employee');

  const { rows: existing } = await query(
    'SELECT * FROM payroll_records WHERE employee_id = $1 AND month = $2',
    [employeeId, month]
  );
  if (existing[0]) return mapPayrollRecord(existing[0]);

  const salary = Number(employee.salary);
  const allowances = Math.round(salary * 0.12);
  const deductions = Math.round(salary * 0.17);
  const netPay = salary + allowances - deductions;
  const id = newId('pay');
  const processedAt = new Date().toISOString().slice(0, 10);

  await query(
    `INSERT INTO payroll_records (id, employee_id, employee_name, month, base_salary, allowances, deductions, net_pay, status, school_id, processed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Processed',$9,$10)`,
    [id, employeeId, employee.name, month, salary, allowances, deductions, netPay, employee.school_id, processedAt]
  );
  await writeAudit({
    schoolId: employee.school_id as string,
    action: 'hr.payroll.process',
    entityType: 'payroll_record',
    entityId: id,
    metadata: { employeeId, month, netPay },
  });
  const { rows } = await query('SELECT * FROM payroll_records WHERE id = $1', [id]);
  return mapPayrollRecord(rows[0]);
}

export async function updatePayrollStatus(id: string, status: string) {
  const { rowCount } = await query('UPDATE payroll_records SET status = $1, updated_at = NOW() WHERE id = $2', [
    status,
    id,
  ]);
  if (rowCount === 0) throw notFound('Payroll record');
  const { rows } = await query('SELECT * FROM payroll_records WHERE id = $1', [id]);
  return mapPayrollRecord(rows[0]);
}

// ---------------------------------------------------------------------------
// Recruitment
// ---------------------------------------------------------------------------

const JOB_POSTING_SELECT = `
  SELECT jp.*, COALESCE(ja.applicant_count, 0) AS applicant_count
  FROM job_postings jp
  LEFT JOIN (
    SELECT job_id, COUNT(*)::int AS applicant_count FROM job_applications GROUP BY job_id
  ) ja ON ja.job_id = jp.id
`;

export async function listJobPostings(schoolId?: string) {
  const { rows } = schoolId
    ? await query(`${JOB_POSTING_SELECT} WHERE jp.school_id = $1 ORDER BY jp.posted_at DESC`, [schoolId])
    : await query(`${JOB_POSTING_SELECT} ORDER BY jp.posted_at DESC`);
  return rows.map(mapJobPosting);
}

export async function createJobPosting(data: {
  title: string;
  department: string;
  employmentType: string;
  salaryRange: string;
  description: string;
  requirements: string[];
  status?: string;
  closingDate?: string;
  schoolId: string;
}) {
  const id = newId('job');
  const postedAt = new Date().toISOString().slice(0, 10);
  await query(
    `INSERT INTO job_postings (id, title, department, employment_type, salary_range, description, requirements, status, school_id, posted_at, closing_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      id,
      data.title,
      data.department,
      data.employmentType,
      data.salaryRange,
      data.description,
      JSON.stringify(data.requirements ?? []),
      data.status ?? 'Open',
      data.schoolId,
      postedAt,
      data.closingDate ?? null,
    ]
  );
  const { rows } = await query(`${JOB_POSTING_SELECT} WHERE jp.id = $1`, [id]);
  return mapJobPosting(rows[0]);
}

const JOB_POSTING_UPDATE_COLUMNS: Record<string, string> = {
  title: 'title',
  department: 'department',
  employmentType: 'employment_type',
  salaryRange: 'salary_range',
  description: 'description',
  status: 'status',
  closingDate: 'closing_date',
};

export async function updateJobPosting(id: string, updates: Record<string, unknown>) {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  for (const [key, column] of Object.entries(JOB_POSTING_UPDATE_COLUMNS)) {
    if (key in updates) {
      sets.push(`${column} = $${i}`);
      params.push(updates[key] ?? null);
      i++;
    }
  }
  if ('requirements' in updates) {
    sets.push(`requirements = $${i}`);
    params.push(JSON.stringify(updates.requirements ?? []));
    i++;
  }
  if (sets.length > 0) {
    sets.push('updated_at = NOW()');
    params.push(id);
    const { rowCount } = await query(`UPDATE job_postings SET ${sets.join(', ')} WHERE id = $${i}`, params);
    if (rowCount === 0) throw notFound('Job posting');
  }
  const { rows } = await query(`${JOB_POSTING_SELECT} WHERE jp.id = $1`, [id]);
  if (!rows[0]) throw notFound('Job posting');
  return mapJobPosting(rows[0]);
}

export async function listJobApplications(schoolId?: string) {
  const { rows } = schoolId
    ? await query('SELECT * FROM job_applications WHERE school_id = $1 ORDER BY applied_at DESC', [schoolId])
    : await query('SELECT * FROM job_applications ORDER BY applied_at DESC');
  return rows.map(mapJobApplication);
}

export async function updateJobApplication(id: string, status: string, notes: string | undefined) {
  return withTransaction(async (client) => {
    const { rows: appRows } = await client.query('SELECT * FROM job_applications WHERE id = $1', [id]);
    const app = appRows[0];
    if (!app) throw notFound('Job application');

    await client.query(
      `UPDATE job_applications SET status = $1, notes = COALESCE($2, notes), updated_at = NOW() WHERE id = $3`,
      [status, notes ?? null, id]
    );

    let createdEmployeeId: string | null = null;
    if (status === 'Hired') {
      const { rows: jobRows } = await client.query('SELECT * FROM job_postings WHERE id = $1', [app.job_id]);
      const posting = jobRows[0];
      const id2 = newId('emp');
      const { rows: countRows } = await client.query(
        'SELECT COUNT(*)::int AS c FROM hr_employees WHERE school_id = $1',
        [app.school_id]
      );
      const employeeId = `EMP-${new Date().getFullYear()}-${String(Number(countRows[0].c) + 1).padStart(3, '0')}`;
      const hireDate = new Date().toISOString().slice(0, 10);
      await client.query(
        `INSERT INTO hr_employees (id, employee_id, name, email, phone, position, department, employment_type, hire_date, salary, status, school_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Probation',$11)`,
        [
          id2,
          employeeId,
          app.applicant_name,
          app.email,
          app.phone,
          app.job_title.split('—')[0]?.trim() || 'Staff',
          posting?.department ?? 'Administration',
          'Full-time',
          hireDate,
          12000,
          app.school_id,
        ]
      );
      createdEmployeeId = id2;
    }

    await writeAudit({
      schoolId: app.school_id as string,
      action: 'hr.application.update_status',
      entityType: 'job_application',
      entityId: id,
      metadata: { status, createdEmployeeId },
    });

    const { rows } = await client.query('SELECT * FROM job_applications WHERE id = $1', [id]);
    return mapJobApplication(rows[0]);
  });
}

// ---------------------------------------------------------------------------
// Performance reviews
// ---------------------------------------------------------------------------

export async function listPerformanceReviews(schoolId?: string) {
  const { rows } = schoolId
    ? await query('SELECT * FROM performance_reviews WHERE school_id = $1 ORDER BY created_at DESC', [schoolId])
    : await query('SELECT * FROM performance_reviews ORDER BY created_at DESC');
  return rows.map(mapPerformanceReview);
}

export async function createPerformanceReview(data: {
  employeeId: string;
  employeeName: string;
  period: string;
  rating: number;
  goals: string[];
  strengths: string;
  improvements: string;
  reviewerName: string;
  schoolId: string;
}) {
  const id = newId('perf');
  await query(
    `INSERT INTO performance_reviews (id, employee_id, employee_name, period, rating, goals, strengths, improvements, status, reviewer_name, school_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'In Progress',$9,$10)`,
    [
      id,
      data.employeeId,
      data.employeeName,
      data.period,
      data.rating,
      JSON.stringify(data.goals ?? []),
      data.strengths,
      data.improvements,
      data.reviewerName,
      data.schoolId,
    ]
  );
  const { rows } = await query('SELECT * FROM performance_reviews WHERE id = $1', [id]);
  return mapPerformanceReview(rows[0]);
}

const PERFORMANCE_REVIEW_UPDATE_COLUMNS: Record<string, string> = {
  period: 'period',
  rating: 'rating',
  strengths: 'strengths',
  improvements: 'improvements',
  status: 'status',
  reviewerName: 'reviewer_name',
};

export async function updatePerformanceReview(id: string, updates: Record<string, unknown>) {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  for (const [key, column] of Object.entries(PERFORMANCE_REVIEW_UPDATE_COLUMNS)) {
    if (key in updates) {
      sets.push(`${column} = $${i}`);
      params.push(updates[key] ?? null);
      i++;
    }
  }
  if ('goals' in updates) {
    sets.push(`goals = $${i}`);
    params.push(JSON.stringify(updates.goals ?? []));
    i++;
  }
  if (updates.status === 'Completed') {
    sets.push(`completed_at = $${i}`);
    params.push(new Date().toISOString().slice(0, 10));
    i++;
  }
  if (sets.length > 0) {
    sets.push('updated_at = NOW()');
    params.push(id);
    const { rowCount } = await query(`UPDATE performance_reviews SET ${sets.join(', ')} WHERE id = $${i}`, params);
    if (rowCount === 0) throw notFound('Performance review');
  }
  const { rows } = await query('SELECT * FROM performance_reviews WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('Performance review');
  return mapPerformanceReview(rows[0]);
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

export async function listOnboardingTasks(schoolId?: string) {
  const { rows } = schoolId
    ? await query('SELECT * FROM onboarding_tasks WHERE school_id = $1 ORDER BY due_date', [schoolId])
    : await query('SELECT * FROM onboarding_tasks ORDER BY due_date');
  return rows.map(mapOnboardingTask);
}

export async function createOnboardingTask(data: {
  employeeId: string;
  employeeName: string;
  task: string;
  assignee: string;
  dueDate: string;
  schoolId: string;
}) {
  const id = newId('onb');
  await query(
    `INSERT INTO onboarding_tasks (id, employee_id, employee_name, task, assignee, due_date, completed, school_id)
     VALUES ($1,$2,$3,$4,$5,$6,FALSE,$7)`,
    [id, data.employeeId, data.employeeName, data.task, data.assignee, data.dueDate, data.schoolId]
  );
  const { rows } = await query('SELECT * FROM onboarding_tasks WHERE id = $1', [id]);
  return mapOnboardingTask(rows[0]);
}

export async function toggleOnboardingTask(id: string) {
  const { rows } = await query('SELECT * FROM onboarding_tasks WHERE id = $1', [id]);
  const task = rows[0];
  if (!task) throw notFound('Onboarding task');
  await query('UPDATE onboarding_tasks SET completed = $1, updated_at = NOW() WHERE id = $2', [
    !task.completed,
    id,
  ]);
  const { rows: updated } = await query('SELECT * FROM onboarding_tasks WHERE id = $1', [id]);
  return mapOnboardingTask(updated[0]);
}

// ---------------------------------------------------------------------------
// Staff attendance
// ---------------------------------------------------------------------------

export async function listStaffAttendance(schoolId?: string) {
  const { rows } = schoolId
    ? await query('SELECT * FROM staff_attendance WHERE school_id = $1 ORDER BY date DESC', [schoolId])
    : await query('SELECT * FROM staff_attendance ORDER BY date DESC');
  return rows.map(mapStaffAttendanceRecord);
}

export async function recordStaffAttendance(data: {
  employeeId: string;
  employeeName: string;
  date: string;
  checkIn?: string;
  checkOut?: string;
  status: string;
  notes?: string;
  schoolId: string;
}) {
  const id = newId('satt');
  await query(
    `INSERT INTO staff_attendance (id, employee_id, employee_name, date, check_in, check_out, status, notes, school_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (employee_id, date) DO UPDATE SET
       check_in = EXCLUDED.check_in,
       check_out = EXCLUDED.check_out,
       status = EXCLUDED.status,
       notes = EXCLUDED.notes,
       updated_at = NOW()`,
    [id, data.employeeId, data.employeeName, data.date, data.checkIn ?? null, data.checkOut ?? null, data.status, data.notes ?? null, data.schoolId]
  );
  const { rows } = await query('SELECT * FROM staff_attendance WHERE employee_id = $1 AND date = $2', [
    data.employeeId,
    data.date,
  ]);
  return mapStaffAttendanceRecord(rows[0]);
}
