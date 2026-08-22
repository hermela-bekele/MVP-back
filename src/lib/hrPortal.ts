export type EmployeeStatus = 'Active' | 'On Leave' | 'Probation' | 'Terminated';
export type EmploymentType = 'Full-time' | 'Part-time' | 'Contract' | 'Intern';
export type LeaveType = 'Annual' | 'Sick' | 'Maternity' | 'Paternity' | 'Unpaid' | 'Emergency';
export type LeaveStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
export type PayrollStatus = 'Draft' | 'Processed' | 'Paid';
export type JobStatus = 'Open' | 'Closed' | 'On Hold';
export type ApplicationStatus = 'New' | 'Screening' | 'Interview' | 'Offered' | 'Hired' | 'Rejected';
export type ReviewStatus = 'Draft' | 'In Progress' | 'Completed';
export type StaffAttendanceStatus = 'Present' | 'Absent' | 'Late' | 'Half Day' | 'On Leave';

export interface HrEmployee {
  id: string;
  employeeId: string;
  name: string;
  email: string;
  phone: string;
  position: string;
  department: string;
  employmentType: EmploymentType;
  hireDate: string;
  salary: number;
  status: EmployeeStatus;
  schoolId: string;
  manager?: string;
  emergencyContact?: string;
  teacherId?: string;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  submittedAt: string;
  reviewedAt?: string;
  reviewerNotes?: string;
}

export interface PayrollRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  month: string;
  baseSalary: number;
  allowances: number;
  deductions: number;
  netPay: number;
  status: PayrollStatus;
  processedAt?: string;
}

export interface JobPosting {
  id: string;
  title: string;
  department: string;
  employmentType: EmploymentType;
  salaryRange: string;
  description: string;
  requirements: string[];
  status: JobStatus;
  postedAt: string;
  closingDate?: string;
  applicantCount: number;
}

export interface JobApplication {
  id: string;
  jobId: string;
  jobTitle: string;
  applicantName: string;
  email: string;
  phone: string;
  experience: string;
  education: string;
  status: ApplicationStatus;
  appliedAt: string;
  notes?: string;
}

export interface PerformanceReview {
  id: string;
  employeeId: string;
  employeeName: string;
  period: string;
  rating: number;
  goals: string[];
  strengths: string;
  improvements: string;
  status: ReviewStatus;
  reviewerName: string;
  completedAt?: string;
}

export interface OnboardingTask {
  id: string;
  employeeId: string;
  employeeName: string;
  task: string;
  assignee: string;
  dueDate: string;
  completed: boolean;
}

export interface StaffAttendanceRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  checkIn?: string;
  checkOut?: string;
  status: StaffAttendanceStatus;
  notes?: string;
}

const DEMO_SCHOOL_ID = 'sch-1';

export const mockHrEmployees: HrEmployee[] = [
  {
    id: 'emp-1',
    employeeId: 'EMP-2024-001',
    name: 'Martha Feyissa',
    email: 'martha.feyissa@prime.edu.et',
    phone: '+251-911-100001',
    position: 'Teacher',
    department: 'Sciences',
    employmentType: 'Full-time',
    hireDate: '2019-09-01',
    salary: 18500,
    status: 'Active',
    schoolId: DEMO_SCHOOL_ID,
    manager: 'Dr. Semeneh Tadesse',
    emergencyContact: 'Spouse: +251-912-100001',
    teacherId: 'tch-1',
  },
  {
    id: 'emp-9',
    employeeId: 'EMP-2024-009',
    name: 'Belayneh Kassahun',
    email: 'dept.head.math@prime.edu.et',
    phone: '+251-911-100009',
    position: 'Department Head',
    department: 'Mathematics',
    employmentType: 'Full-time',
    hireDate: '2021-08-15',
    salary: 19500,
    status: 'Active',
    schoolId: DEMO_SCHOOL_ID,
    manager: 'Dr. Semeneh Tadesse',
    emergencyContact: 'Spouse: +251-912-100009',
  },
  {
    id: 'emp-10',
    employeeId: 'EMP-2024-010',
    name: 'Dr. Semeneh Tadesse',
    email: 'principal.semeneh@prime.edu.et',
    phone: '+251-911-100010',
    position: 'School Head',
    department: 'Administration',
    employmentType: 'Full-time',
    hireDate: '2015-08-01',
    salary: 28000,
    status: 'Active',
    schoolId: DEMO_SCHOOL_ID,
    emergencyContact: 'Spouse: +251-912-100010',
  },
  {
    id: 'emp-11',
    employeeId: 'EMP-2024-011',
    name: 'Meskerem Alemu',
    email: 'curriculum.lead@prime.edu.et',
    phone: '+251-911-100011',
    position: 'Head of Academics',
    department: 'Administration',
    employmentType: 'Full-time',
    hireDate: '2018-09-01',
    salary: 22000,
    status: 'Active',
    schoolId: DEMO_SCHOOL_ID,
    manager: 'Dr. Semeneh Tadesse',
  },
  {
    id: 'emp-12',
    employeeId: 'EMP-2024-012',
    name: 'Selamawit Girma',
    email: 'selamawit.girma@prime.edu.et',
    phone: '+251-911-100012',
    position: 'Teacher Assistant',
    department: 'Sciences',
    employmentType: 'Full-time',
    hireDate: '2025-09-01',
    salary: 9500,
    status: 'Probation',
    schoolId: DEMO_SCHOOL_ID,
    manager: 'Martha Feyissa',
  },
  {
    id: 'emp-7',
    employeeId: 'EMP-2024-007',
    name: 'Helen Assefa',
    email: 'helen.assefa@prime.edu.et',
    phone: '+251-911-100007',
    position: 'Teacher',
    department: 'Mathematics',
    employmentType: 'Full-time',
    hireDate: '2020-09-01',
    salary: 18200,
    status: 'On Leave',
    schoolId: DEMO_SCHOOL_ID,
    manager: 'Dr. Semeneh Tadesse',
  },
];

export const mockLeaveRequests: LeaveRequest[] = [
  {
    id: 'leave-1',
    employeeId: 'emp-7',
    employeeName: 'Helen Assefa',
    type: 'Maternity',
    startDate: '2026-04-01',
    endDate: '2026-09-30',
    days: 90,
    reason: 'Maternity leave as per school policy',
    status: 'Approved',
    submittedAt: '2026-03-15',
    reviewedAt: '2026-03-18',
    reviewerNotes: 'Approved — coverage arranged with substitute teacher',
  },
  {
    id: 'leave-2',
    employeeId: 'emp-1',
    employeeName: 'Martha Feyissa',
    type: 'Annual',
    startDate: '2026-07-10',
    endDate: '2026-07-24',
    days: 10,
    reason: 'Family vacation',
    status: 'Pending',
    submittedAt: '2026-06-01',
  },
  {
    id: 'leave-3',
    employeeId: 'emp-12',
    employeeName: 'Selamawit Girma',
    type: 'Sick',
    startDate: '2026-06-03',
    endDate: '2026-06-05',
    days: 3,
    reason: 'Medical appointment and recovery',
    status: 'Pending',
    submittedAt: '2026-06-02',
  },
  {
    id: 'leave-4',
    employeeId: 'emp-9',
    employeeName: 'Belayneh Kassahun',
    type: 'Emergency',
    startDate: '2026-05-20',
    endDate: '2026-05-21',
    days: 2,
    reason: 'Family emergency',
    status: 'Approved',
    submittedAt: '2026-05-19',
    reviewedAt: '2026-05-19',
  },
];

export const mockPayrollRecords: PayrollRecord[] = [
  {
    id: 'pay-1',
    employeeId: 'emp-1',
    employeeName: 'Martha Feyissa',
    month: '2026-05',
    baseSalary: 18500,
    allowances: 2500,
    deductions: 3200,
    netPay: 17800,
    status: 'Paid',
    processedAt: '2026-05-28',
  },
  {
    id: 'pay-2',
    employeeId: 'emp-10',
    employeeName: 'Dr. Semeneh Tadesse',
    month: '2026-05',
    baseSalary: 28000,
    allowances: 3400,
    deductions: 4700,
    netPay: 26700,
    status: 'Paid',
    processedAt: '2026-05-28',
  },
  {
    id: 'pay-3',
    employeeId: 'emp-11',
    employeeName: 'Meskerem Alemu',
    month: '2026-05',
    baseSalary: 22000,
    allowances: 2600,
    deductions: 3750,
    netPay: 20850,
    status: 'Paid',
    processedAt: '2026-05-28',
  },
  {
    id: 'pay-4',
    employeeId: 'emp-1',
    employeeName: 'Martha Feyissa',
    month: '2026-06',
    baseSalary: 18500,
    allowances: 2500,
    deductions: 3200,
    netPay: 17800,
    status: 'Processed',
    processedAt: '2026-06-01',
  },
  {
    id: 'pay-5',
    employeeId: 'emp-9',
    employeeName: 'Belayneh Kassahun',
    month: '2026-06',
    baseSalary: 19500,
    allowances: 2300,
    deductions: 3300,
    netPay: 18500,
    status: 'Draft',
  },
];

export const mockJobPostings: JobPosting[] = [
  {
    id: 'job-1',
    title: 'Mathematics Teacher — Grade 11 & 12',
    department: 'Mathematics',
    employmentType: 'Full-time',
    salaryRange: 'ETB 16,000 – 20,000',
    description: 'Seeking an experienced mathematics teacher for senior secondary classes.',
    requirements: ['B.Ed in Mathematics', '3+ years teaching experience', 'MOE certification'],
    status: 'Open',
    postedAt: '2026-05-10',
    closingDate: '2026-06-30',
    applicantCount: 4,
  },
  {
    id: 'job-2',
    title: 'Teacher Assistant — Grade 9 & 10',
    department: 'Languages',
    employmentType: 'Full-time',
    salaryRange: 'ETB 8,000 – 11,000',
    description: 'Support classroom teachers with instructional activities, grading assistance, and student supervision.',
    requirements: ['Diploma in Education or related field', 'Experience working with secondary students', 'Strong communication skills'],
    status: 'Open',
    postedAt: '2026-05-15',
    closingDate: '2026-07-15',
    applicantCount: 2,
  },
];

export const mockJobApplications: JobApplication[] = [
  {
    id: 'japp-1',
    jobId: 'job-1',
    jobTitle: 'Mathematics Teacher — Grade 11 & 12',
    applicantName: 'Mekdes Alemu',
    email: 'mekdes.alemu@gmail.com',
    phone: '+251-922-200001',
    experience: '5 years at Bole Academy',
    education: 'B.Ed Mathematics, Addis Ababa University',
    status: 'Interview',
    appliedAt: '2026-05-12',
    notes: 'Strong references from previous school',
  },
  {
    id: 'japp-2',
    jobId: 'job-1',
    jobTitle: 'Mathematics Teacher — Grade 11 & 12',
    applicantName: 'Getachew Haile',
    email: 'getachew.h@gmail.com',
    phone: '+251-933-200002',
    experience: '2 years substitute teaching',
    education: 'B.Sc Mathematics',
    status: 'Screening',
    appliedAt: '2026-05-18',
  },
  {
    id: 'japp-3',
    jobId: 'job-2',
    jobTitle: 'Teacher Assistant — Grade 9 & 10',
    applicantName: 'Rahel Desta',
    email: 'rahel.desta@yahoo.com',
    phone: '+251-944-200003',
    experience: '2 years as a classroom aide at Awash Primary School',
    education: 'Diploma in Early Childhood Education',
    status: 'New',
    appliedAt: '2026-06-01',
  },
];

export const mockPerformanceReviews: PerformanceReview[] = [
  {
    id: 'perf-1',
    employeeId: 'emp-1',
    employeeName: 'Martha Feyissa',
    period: '2025/2026 Academic Year — Semester 1',
    rating: 4.5,
    goals: ['Improve student lab participation', 'Complete advanced pedagogy certification'],
    strengths: 'Excellent classroom management and student engagement',
    improvements: 'Increase use of digital assessment tools',
    status: 'Completed',
    reviewerName: 'Dr. Semeneh Tadesse',
    completedAt: '2026-01-15',
  },
  {
    id: 'perf-2',
    employeeId: 'emp-9',
    employeeName: 'Belayneh Kassahun',
    period: '2025/2026 Academic Year — Semester 1',
    rating: 4.3,
    goals: ['Improve department-wide assessment consistency', 'Mentor two new mathematics teachers'],
    strengths: 'Strong instructional leadership and mentorship',
    improvements: 'Delegate administrative tasks more effectively',
    status: 'Completed',
    reviewerName: 'Dr. Semeneh Tadesse',
    completedAt: '2026-01-20',
  },
  {
    id: 'perf-3',
    employeeId: 'emp-12',
    employeeName: 'Selamawit Girma',
    period: 'Probation Review — Month 3',
    rating: 3.9,
    goals: ['Master classroom support routines', 'Assist independently with small-group instruction'],
    strengths: 'Quick learner, dependable, good rapport with students',
    improvements: 'Build confidence leading activities without direct supervision',
    status: 'In Progress',
    reviewerName: 'Martha Feyissa',
  },
];

export const mockOnboardingTasks: OnboardingTask[] = [
  {
    id: 'onb-1',
    employeeId: 'emp-12',
    employeeName: 'Selamawit Girma',
    task: 'Complete employment contract signing',
    assignee: 'Sara Bekele',
    dueDate: '2025-09-05',
    completed: true,
  },
  {
    id: 'onb-2',
    employeeId: 'emp-12',
    employeeName: 'Selamawit Girma',
    task: 'Classroom support orientation & safeguarding certification',
    assignee: 'Martha Feyissa',
    dueDate: '2025-09-15',
    completed: true,
  },
  {
    id: 'onb-3',
    employeeId: 'emp-12',
    employeeName: 'Selamawit Girma',
    task: 'IT systems access setup',
    assignee: 'Yonas Girma',
    dueDate: '2025-09-10',
    completed: true,
  },
  {
    id: 'onb-4',
    employeeId: 'emp-12',
    employeeName: 'Selamawit Girma',
    task: '90-day probation review',
    assignee: 'Sara Bekele',
    dueDate: '2025-12-01',
    completed: false,
  },
];

export const mockStaffAttendance: StaffAttendanceRecord[] = [
  { id: 'satt-1', employeeId: 'emp-1', employeeName: 'Martha Feyissa', date: '2026-06-05', checkIn: '07:45', checkOut: '16:30', status: 'Present' },
  { id: 'satt-2', employeeId: 'emp-10', employeeName: 'Dr. Semeneh Tadesse', date: '2026-06-05', checkIn: '07:30', checkOut: '17:30', status: 'Present' },
  { id: 'satt-3', employeeId: 'emp-12', employeeName: 'Selamawit Girma', date: '2026-06-05', status: 'Absent', notes: 'Sick leave pending approval' },
  { id: 'satt-4', employeeId: 'emp-7', employeeName: 'Helen Assefa', date: '2026-06-05', status: 'On Leave' },
  { id: 'satt-5', employeeId: 'emp-9', employeeName: 'Belayneh Kassahun', date: '2026-06-05', checkIn: '08:15', checkOut: '17:15', status: 'Late' },
  { id: 'satt-6', employeeId: 'emp-11', employeeName: 'Meskerem Alemu', date: '2026-06-05', checkIn: '07:50', checkOut: '16:45', status: 'Present' },
];
