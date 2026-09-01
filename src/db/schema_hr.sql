-- HR module: personnel records for academic staff only (School Head, Head of Academics,
-- Department Head, Teacher, Teacher Assistant). hr_employees.teacher_id links to the
-- instructional roster (teachers) for the three positions that overlap with it, instead
-- of duplicating pedagogical data (subjects, grades, certification) here.

CREATE TABLE IF NOT EXISTS hr_employees (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  position TEXT NOT NULL CHECK (position IN ('School Head', 'Head of Academics', 'Department Head', 'Teacher', 'Teacher Assistant')),
  department TEXT NOT NULL,
  employment_type TEXT NOT NULL CHECK (employment_type IN ('Full-time', 'Part-time', 'Contract', 'Intern')),
  hire_date DATE NOT NULL,
  salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('Active', 'On Leave', 'Probation', 'Terminated')),
  school_id TEXT NOT NULL REFERENCES schools(id),
  manager TEXT,
  emergency_contact TEXT,
  teacher_id TEXT REFERENCES teachers(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, employee_id),
  UNIQUE (school_id, email)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES hr_employees(id),
  employee_name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Annual', 'Sick', 'Maternity', 'Paternity', 'Unpaid', 'Emergency')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Cancelled')),
  school_id TEXT NOT NULL REFERENCES schools(id),
  submitted_at DATE NOT NULL,
  reviewed_at DATE,
  reviewer_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payroll_records (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES hr_employees(id),
  employee_name TEXT NOT NULL,
  month TEXT NOT NULL,
  base_salary NUMERIC(12,2) NOT NULL,
  allowances NUMERIC(12,2) NOT NULL DEFAULT 0,
  deductions NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_pay NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Draft', 'Processed', 'Paid')),
  school_id TEXT NOT NULL REFERENCES schools(id),
  processed_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, month)
);

CREATE TABLE IF NOT EXISTS job_postings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  department TEXT NOT NULL,
  employment_type TEXT NOT NULL CHECK (employment_type IN ('Full-time', 'Part-time', 'Contract', 'Intern')),
  salary_range TEXT NOT NULL,
  description TEXT NOT NULL,
  requirements JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('Open', 'Closed', 'On Hold')),
  school_id TEXT NOT NULL REFERENCES schools(id),
  posted_at DATE NOT NULL,
  closing_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_applications (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES job_postings(id),
  job_title TEXT NOT NULL,
  applicant_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  experience TEXT NOT NULL,
  education TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('New', 'Screening', 'Interview', 'Offered', 'Hired', 'Rejected')),
  school_id TEXT NOT NULL REFERENCES schools(id),
  applied_at DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS performance_reviews (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES hr_employees(id),
  employee_name TEXT NOT NULL,
  period TEXT NOT NULL,
  rating NUMERIC(3,1) NOT NULL DEFAULT 0,
  goals JSONB NOT NULL DEFAULT '[]',
  strengths TEXT NOT NULL DEFAULT '',
  improvements TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('Draft', 'In Progress', 'Completed')),
  reviewer_name TEXT NOT NULL,
  school_id TEXT NOT NULL REFERENCES schools(id),
  completed_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS onboarding_tasks (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES hr_employees(id),
  employee_name TEXT NOT NULL,
  task TEXT NOT NULL,
  assignee TEXT NOT NULL,
  due_date DATE NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  school_id TEXT NOT NULL REFERENCES schools(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staff_attendance (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES hr_employees(id),
  employee_name TEXT NOT NULL,
  date DATE NOT NULL,
  check_in TEXT,
  check_out TEXT,
  status TEXT NOT NULL CHECK (status IN ('Present', 'Absent', 'Late', 'Half Day', 'On Leave')),
  notes TEXT,
  school_id TEXT NOT NULL REFERENCES schools(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, date)
);
