export interface School {
  id: string;
  code: string;
  name: string;
  region: string;
  type: 'Public' | 'Private';
  principal: string;
  email: string;
  phone: string;
  capacity: number;
  studentsCount: number;
  teachersCount: number;
  status: 'Active' | 'Suspended';
  gps: string;
}

export interface Teacher {
  id: string;
  name: string;
  email: string;
  phone: string;
  departmentId: string;
  schoolId: string;
  status: 'Active' | 'On Leave';
  subjects: string[];
  grades: string[];
  certification: string;
  trainingProgress: number; // percentage
}

export interface Student {
  id: string;
  studentId: string; // Generated ID e.g., PTS/9812/18
  name: string;
  email?: string;
  grade: string;
  section: string;
  schoolId: string;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
  status: 'Active' | 'Suspended' | 'Transferred' | 'Graduated';
  gpa: number;
  attendanceRate: number;
  medicalInfo?: string;
  emergencyContact: string;
}

export type RegistrationApplicationStatus =
  | 'Draft'
  | 'Submitted'
  | 'Under Review'
  | 'Approved'
  | 'Rejected'
  | 'Enrolled';

export interface RegistrationApplication {
  id: string;
  applicantName: string;
  dateOfBirth?: string;
  gradeApplied: string;
  sectionRequested: string;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
  emergencyContact: string;
  medicalInfo?: string;
  previousSchool?: string;
  status: RegistrationApplicationStatus;
  submittedAt: string;
  reviewedAt?: string;
  reviewerNotes?: string;
  enrolledStudentId?: string;
}

export interface LessonPlan {
  id: string;
  subject: string;
  grade: string;
  title: string;
  sessions: number;
  teacherId: string;
  teacherName: string;
  status: 'Draft' | 'Pending Dept Head' | 'Pending School Head' | 'Approved' | 'Rejected';
  deptComments?: string;
  schoolHeadComments?: string;
  version: number;
  objectives: string[];
  activities: { session: number; activity: string; duration: string }[];
  assessments: string[];
  homework: string;
  createdAt: string;
}

export interface Assessment {
  id: string;
  title: string;
  type: 'Quiz' | 'Mid Exam' | 'Final Exam' | 'Assignment' | 'Practical';
  subject: string;
  grade: string;
  teacherId: string;
  teacherName: string;
  status: 'Draft' | 'Pending Dept Head' | 'Approved' | 'Rejected';
  comments?: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  questions: { id: number; question: string; type: string; options?: string[]; answer: string }[];
  createdAt: string;
}

export interface Attendance {
  id: string;
  studentId: string;
  studentName: string;
  grade: string;
  section: string;
  date: string;
  status: 'Present' | 'Absent' | 'Late';
  remarks?: string;
}

export interface TeacherTraining {
  id: string;
  title: string;
  instructor: string;
  startDate: string;
  duration: string;
  completedCount: number;
  totalCount: number;
  status: 'Active' | 'Upcoming' | 'Completed';
}

export interface SchoolCheckIn {
  id: string;
  title?: string;
  type: 'Teacher Wellness' | 'Student Satisfaction' | 'Parent Feedback';
  respondentName: string;
  rating: number; // 1-5
  comment: string;
  date: string;
}

// ----------------------------------------------------
// Mock Collections
// ----------------------------------------------------

export const mockSchools: School[] = [
  {
    id: 'sch-1',
    code: 'BOLE-092',
    name: 'Bole Community School',
    region: 'Addis Ababa',
    type: 'Private',
    principal: 'Dr. Semeneh Yohannes',
    email: 'info@bolecommunity.edu.et',
    phone: '+251-11-662-1234',
    capacity: 1200,
    studentsCount: 1040,
    teachersCount: 58,
    status: 'Active',
    gps: '9.0192° N, 38.7891° E',
  },
  {
    id: 'sch-2',
    code: 'HAW-104',
    name: 'Hawassa Tababor Secondary School',
    region: 'Sidama',
    type: 'Public',
    principal: 'Ato Mulugeta Feyissa',
    email: 'contact@tababor-hawassa.gov.et',
    phone: '+251-46-220-4321',
    capacity: 1500,
    studentsCount: 1412,
    teachersCount: 72,
    status: 'Active',
    gps: '7.0620° N, 38.4764° E',
  },
  {
    id: 'sch-3',
    code: 'GND-018',
    name: 'Fasiledes Preparatory School',
    region: 'Amhara',
    type: 'Public',
    principal: 'W/ro Roman Tadesse',
    email: 'fasiledes.prep@gondar.gov.et',
    phone: '+251-58-111-5678',
    capacity: 1800,
    studentsCount: 1720,
    teachersCount: 88,
    status: 'Active',
    gps: '12.6075° N, 37.4578° E',
  },
  {
    id: 'sch-4',
    code: 'MEK-044',
    name: 'Mekelle Academy',
    region: 'Tigray',
    type: 'Private',
    principal: 'Ato Haile Gebriel',
    email: 'admin@mekelleacademy.edu',
    phone: '+251-34-440-9988',
    capacity: 900,
    studentsCount: 790,
    teachersCount: 42,
    status: 'Active',
    gps: '13.4967° N, 39.4678° E',
  },
  {
    id: 'sch-5',
    code: 'ADA-081',
    name: 'Adama High School',
    region: 'Oromia',
    type: 'Public',
    principal: 'Obbo Chala Kenesa',
    email: 'info@adamahigh.gov.et',
    phone: '+251-22-111-2233',
    capacity: 1400,
    studentsCount: 1350,
    teachersCount: 65,
    status: 'Suspended',
    gps: '8.5414° N, 39.2689° E',
  },
];

export const mockTeachers: Teacher[] = [
  {
    id: 'tch-1',
    name: 'Martha Feyissa',
    email: 'martha.feyissa@prime.edu.et',
    phone: '+251-911-223344',
    departmentId: 'dept-bio',
    schoolId: 'sch-1',
    status: 'Active',
    subjects: ['Biology', 'General Science'],
    grades: ['Grade 9', 'Grade 10'],
    certification: 'Professional Educator License A',
    trainingProgress: 85,
  },
  {
    id: 'tch-2',
    name: 'Abebe Kebede',
    email: 'abebe.kebede@prime.edu.et',
    phone: '+251-912-334455',
    departmentId: 'dept-math',
    schoolId: 'sch-1',
    status: 'Active',
    subjects: ['Mathematics'],
    grades: ['Grade 9', 'Grade 10', 'Grade 11'],
    certification: 'Senior Math Educator Badge',
    trainingProgress: 100,
  },
  {
    id: 'tch-3',
    name: 'Yohannes Tesfaye',
    email: 'yohannes.tesfaye@prime.edu.et',
    phone: '+251-913-445566',
    departmentId: 'dept-chem',
    schoolId: 'sch-2',
    status: 'Active',
    subjects: ['Chemistry'],
    grades: ['Grade 11', 'Grade 12'],
    certification: 'National STEM Certificate',
    trainingProgress: 60,
  },
  {
    id: 'tch-4',
    name: 'Tigist Assefa',
    email: 'tigist.assefa@prime.edu.et',
    phone: '+251-914-556677',
    departmentId: 'dept-eng',
    schoolId: 'sch-1',
    status: 'Active',
    subjects: ['English Language'],
    grades: ['Grade 9', 'Grade 12'],
    certification: 'TEFL Ethiopia Professional',
    trainingProgress: 45,
  },
  {
    id: 'tch-5',
    name: 'Obbo Kenenisa Dinka',
    email: 'kenenisa.d@prime.edu.et',
    phone: '+251-915-667788',
    departmentId: 'dept-bio',
    schoolId: 'sch-5',
    status: 'On Leave',
    subjects: ['Biology'],
    grades: ['Grade 11', 'Grade 12'],
    certification: 'Regional Senior Biology Expert',
    trainingProgress: 90,
  },
  {
    id: 'tch-6',
    name: 'W/ro Almaz Tekle',
    email: 'almaz.tekle@prime.edu.et',
    phone: '+251-916-778899',
    departmentId: 'dept-chem',
    schoolId: 'sch-1',
    status: 'Active',
    subjects: ['Chemistry', 'Physics'],
    grades: ['Grade 10', 'Grade 11'],
    certification: 'Professional Educator License B',
    trainingProgress: 70,
  },
  {
    id: 'tch-7',
    name: 'Ato Belayneh Kassahun',
    email: 'belayneh.k@prime.edu.et',
    phone: '+251-917-889900',
    departmentId: 'dept-math',
    schoolId: 'sch-1',
    status: 'Active',
    subjects: ['Mathematics'],
    grades: ['Grade 11', 'Grade 12'],
    certification: 'Advanced Pedagogy License',
    trainingProgress: 80,
  },
  {
    id: 'tch-8',
    name: 'W/t Selamawit Hailu',
    email: 'selamawit.h@prime.edu.et',
    phone: '+251-918-990011',
    departmentId: 'dept-phy',
    schoolId: 'sch-1',
    status: 'Active',
    subjects: ['Physics', 'General Science'],
    grades: ['Grade 9', 'Grade 10', 'Grade 12'],
    certification: 'National STEM Badge',
    trainingProgress: 50,
  },
  {
    id: 'tch-9',
    name: 'Obbo Chala Tolossa',
    email: 'chala.t@prime.edu.et',
    phone: '+251-919-001122',
    departmentId: 'dept-eng',
    schoolId: 'sch-3',
    status: 'Active',
    subjects: ['English Language', 'Civics'],
    grades: ['Grade 9', 'Grade 10'],
    certification: 'Professional Educator License A',
    trainingProgress: 95,
  },
];

export const mockStudents: Student[] = [
  {
    id: 'std-1',
    studentId: 'PTS/1045/18',
    name: 'Selam Abebe',
    email: 'selam.abebe@std.edu.et',
    grade: 'Grade 9',
    section: 'A',
    schoolId: 'sch-1',
    parentName: 'Abebe Demeke',
    parentPhone: '+251-911-998877',
    parentEmail: 'abebe.demeke@gmail.com',
    status: 'Active',
    gpa: 3.82,
    attendanceRate: 98.4,
    emergencyContact: 'Abebe Demeke (+251-911-998877)',
    medicalInfo: 'No known allergies',
  },
  {
    id: 'std-2',
    studentId: 'PTS/2042/18',
    name: 'Yonas Kassa',
    email: 'yonas.k@std.edu.et',
    grade: 'Grade 9',
    section: 'B',
    schoolId: 'sch-1',
    parentName: 'Kassa Belay',
    parentPhone: '+251-912-887766',
    parentEmail: 'kassa.belay@yahoo.com',
    status: 'Active',
    gpa: 2.45,
    attendanceRate: 85.2,
    emergencyContact: 'Kassa Belay (+251-912-887766)',
    medicalInfo: 'Asthma - carries inhaler',
  },
  {
    id: 'std-3',
    studentId: 'PTS/3412/18',
    name: 'Eden Yohannes',
    email: 'eden.y@std.edu.et',
    grade: 'Grade 10',
    section: 'A',
    schoolId: 'sch-2',
    parentName: 'Yohannes Tesfaye',
    parentPhone: '+251-913-445566',
    parentEmail: 'yohannes.tesfaye@prime.edu.et',
    status: 'Active',
    gpa: 3.96,
    attendanceRate: 99.1,
    emergencyContact: 'Yohannes Tesfaye (+251-913-445566)',
  },
  {
    id: 'std-4',
    studentId: 'PTS/1099/18',
    name: 'Tariku Tigist',
    grade: 'Grade 9',
    section: 'A',
    schoolId: 'sch-1',
    parentName: 'Tigist Assefa',
    parentPhone: '+251-914-556677',
    parentEmail: 'tigist.assefa@prime.edu.et',
    status: 'Active',
    gpa: 3.12,
    attendanceRate: 92.5,
    emergencyContact: 'Tigist Assefa (+251-914-556677)',
  },
  {
    id: 'std-5',
    studentId: 'PTS/4521/18',
    name: 'Abel Tesfaye',
    email: 'abel.t@std.edu.et',
    grade: 'Grade 10',
    section: 'A',
    schoolId: 'sch-1',
    parentName: 'Tesfaye Negash',
    parentPhone: '+251-919-887766',
    parentEmail: 'tesfaye.negash@gmail.com',
    status: 'Active',
    gpa: 3.54,
    attendanceRate: 96.5,
    emergencyContact: 'Tesfaye Negash (+251-919-887766)',
  },
  {
    id: 'std-6',
    studentId: 'PTS/5211/18',
    name: 'Hawi Bekele',
    email: 'hawi.b@std.edu.et',
    grade: 'Grade 11',
    section: 'B',
    schoolId: 'sch-1',
    parentName: 'Bekele Shiferaw',
    parentPhone: '+251-920-776655',
    parentEmail: 'bekele.s@yahoo.com',
    status: 'Active',
    gpa: 3.12,
    attendanceRate: 91.2,
    emergencyContact: 'Bekele Shiferaw (+251-920-776655)',
  },
  {
    id: 'std-7',
    studentId: 'PTS/6012/18',
    name: 'Yared Negash',
    email: 'yared.n@std.edu.et',
    grade: 'Grade 12',
    section: 'A',
    schoolId: 'sch-1',
    parentName: 'Negash Chala',
    parentPhone: '+251-921-665544',
    parentEmail: 'negash.c@gmail.com',
    status: 'Active',
    gpa: 3.92,
    attendanceRate: 99.4,
    emergencyContact: 'Negash Chala (+251-921-665544)',
    medicalInfo: 'Peanut allergy',
  },
  {
    id: 'std-8',
    studentId: 'PTS/7104/18',
    name: 'Meron Kebede',
    grade: 'Grade 9',
    section: 'C',
    schoolId: 'sch-1',
    parentName: 'Kebede Assefa',
    parentPhone: '+251-922-554433',
    parentEmail: 'kebede.a@yahoo.com',
    status: 'Active',
    gpa: 2.85,
    attendanceRate: 88.7,
    emergencyContact: 'Kebede Assefa (+251-922-554433)',
  },
  {
    id: 'std-9',
    studentId: 'PTS/8091/18',
    name: 'Chala Tolossa',
    grade: 'Grade 10',
    section: 'B',
    schoolId: 'sch-1',
    parentName: 'Tolossa Feyissa',
    parentPhone: '+251-923-443322',
    parentEmail: 'tolossa.f@gmail.com',
    status: 'Active',
    gpa: 3.20,
    attendanceRate: 93.1,
    emergencyContact: 'Tolossa Feyissa (+251-923-443322)',
  },
  {
    id: 'std-10',
    studentId: 'PTS/9112/18',
    name: 'Tigist Tilahun',
    email: 'tigist.t@std.edu.et',
    grade: 'Grade 11',
    section: 'A',
    schoolId: 'sch-1',
    parentName: 'Tilahun Abebe',
    parentPhone: '+251-924-332211',
    parentEmail: 'tilahun.a@gmail.com',
    status: 'Active',
    gpa: 2.10,
    attendanceRate: 82.5,
    emergencyContact: 'Tilahun Abebe (+251-924-332211)',
  },
  {
    id: 'std-11',
    studentId: 'PTS/1290/18',
    name: 'Bereket Solomon',
    email: 'bereket.s@std.edu.et',
    grade: 'Grade 12',
    section: 'B',
    schoolId: 'sch-1',
    parentName: 'Solomon Tessema',
    parentPhone: '+251-925-221100',
    parentEmail: 'solomon.t@yahoo.com',
    status: 'Active',
    gpa: 3.78,
    attendanceRate: 97.2,
    emergencyContact: 'Solomon Tessema (+251-925-221100)',
  },
  {
    id: 'std-12',
    studentId: 'PTS/2391/18',
    name: 'Lidu Mekonnen',
    grade: 'Grade 9',
    section: 'B',
    schoolId: 'sch-1',
    parentName: 'Mekonnen Hailu',
    parentPhone: '+251-926-110099',
    parentEmail: 'mekonnen.h@gmail.com',
    status: 'Active',
    gpa: 3.45,
    attendanceRate: 94.0,
    emergencyContact: 'Mekonnen Hailu (+251-926-110099)',
  },
  {
    id: 'std-13',
    studentId: 'PTS/3492/18',
    name: 'Kaleb Daniel',
    grade: 'Grade 10',
    section: 'A',
    schoolId: 'sch-1',
    parentName: 'Daniel Girma',
    parentPhone: '+251-927-009988',
    parentEmail: 'daniel.g@yahoo.com',
    status: 'Active',
    gpa: 1.95,
    attendanceRate: 79.5,
    emergencyContact: 'Daniel Girma (+251-927-009988)',
    medicalInfo: 'Asthma',
  },
];

export const mockLessonPlans: LessonPlan[] = [
  {
    id: 'lp-1',
    subject: 'Biology',
    grade: 'Grade 9',
    title: 'Cell Biology - Organelles & Membrane Transport',
    sessions: 5,
    teacherId: 'tch-1',
    teacherName: 'Martha Feyissa',
    status: 'Pending School Head',
    deptComments: 'Excellent structure. Added resources references. Recommended approval.',
    version: 2,
    objectives: [
      'Describe the structure and function of major cell organelles.',
      'Differentiate between plant cells and animal cells.',
      'Explain passive transport mechanisms including diffusion and osmosis.',
      'Demonstrate cell plasmolysis in laboratory conditions.',
    ],
    activities: [
      { session: 1, activity: 'Introduction to Cell Structure & Microscope usage', duration: '40 mins' },
      { session: 2, activity: 'Plant vs Animal Cells laboratory diagram review', duration: '45 mins' },
      { session: 3, activity: 'Membrane structure and passive transport group quiz', duration: '45 mins' },
      { session: 4, activity: 'Active transport model builder using clay', duration: '45 mins' },
      { session: 5, activity: 'Practical quiz & chapter completion analysis', duration: '50 mins' },
    ],
    assessments: ['Quiz on Membrane Transport', 'Syllabus alignment lab sheet', 'Active transport presentation'],
    homework: 'Write a 200-word paragraph describing why mitochondrion is called the powerhouse of the cell.',
    createdAt: '2026-05-18T10:00:00Z',
  },
  {
    id: 'lp-6',
    subject: 'Biology',
    grade: 'Grade 10',
    title: 'Genetics — DNA Replication & Protein Synthesis',
    sessions: 4,
    teacherId: 'tch-1',
    teacherName: 'Martha Feyissa',
    status: 'Approved',
    deptComments: 'Approved for Grade 10 Section B.',
    version: 1,
    objectives: [
      'Explain the semi-conservative model of DNA replication.',
      'Describe transcription and translation steps.',
    ],
    activities: [
      { session: 1, activity: 'DNA structure review and replication animation', duration: '45 mins' },
      { session: 2, activity: 'Membrane transport recap and lab prep', duration: '45 mins' },
      { session: 3, activity: 'Protein synthesis modeling activity', duration: '50 mins' },
      { session: 4, activity: 'Unit synthesis quiz', duration: '45 mins' },
    ],
    assessments: ['Replication diagram quiz', 'Translation worksheet'],
    homework: 'Label a replication fork diagram from textbook page 112.',
    createdAt: '2026-05-14T09:00:00Z',
  },
  {
    id: 'lp-2',
    subject: 'Mathematics',
    grade: 'Grade 10',
    title: 'Quadratic Equations & Roots',
    sessions: 4,
    teacherId: 'tch-2',
    teacherName: 'Abebe Kebede',
    status: 'Approved',
    deptComments: 'Calculations verified. Perfect alignment.',
    schoolHeadComments: 'Approved for circulation to Grade 10 sections.',
    version: 1,
    objectives: [
      'Solve quadratic equations using factorization method.',
      'Understand and apply the quadratic formula.',
      'Define the discriminant and use it to predict root types.',
    ],
    activities: [
      { session: 1, activity: 'Factoring quadratic trinomials board exercises', duration: '45 mins' },
      { session: 2, activity: 'Deriving the quadratic formula step-by-step', duration: '45 mins' },
      { session: 3, activity: 'Discriminant analysis of real vs imaginary solutions', duration: '45 mins' },
      { session: 4, activity: 'Practical physics examples (projectile motion graphs)', duration: '45 mins' },
    ],
    assessments: ['Discriminant homework sheet', 'Challenging projectile worksheet'],
    homework: 'Solve problems 1-15 on page 84 of the Grade 10 Ethiopian Math Textbook.',
    createdAt: '2026-05-15T08:30:00Z',
  },
  {
    id: 'lp-3',
    subject: 'Chemistry',
    grade: 'Grade 11',
    title: 'Chemical Bonding & Hybridization',
    sessions: 6,
    teacherId: 'tch-3',
    teacherName: 'Yohannes Tesfaye',
    status: 'Pending Dept Head',
    version: 1,
    objectives: [
      'Compare covalent and ionic chemical structures.',
      'Explain molecular geometry through VSEPR theory.',
      'Describe sp, sp2, and sp3 carbon hybridization.',
    ],
    activities: [
      { session: 1, activity: 'Lewis structures of water and ammonia', duration: '40 mins' },
      { session: 2, activity: 'Building ball-and-stick geometry mockups', duration: '50 mins' },
      { session: 3, activity: 'VSEPR shape worksheets group evaluation', duration: '45 mins' },
      { session: 4, activity: 'Hybrid orbital energy level diagrams review', duration: '45 mins' },
      { session: 5, activity: 'Double and triple bond overlap simulations', duration: '45 mins' },
      { session: 6, activity: 'Wrap-up chemistry laboratory safe practice', duration: '40 mins' },
    ],
    assessments: ['VSEPR structures test', 'Covalent bonding homework'],
    homework: 'Draw orbital overlap diagrams for methane (CH4) and ethene (C2H4).',
    createdAt: '2026-05-19T14:20:00Z',
  },
  {
    id: 'lp-4',
    subject: 'Physics',
    grade: 'Grade 10',
    title: 'Newtonian Mechanics — Forces in Equilibrium',
    sessions: 4,
    teacherId: 'tch-8',
    teacherName: 'W/t Selamawit Hailu',
    status: 'Pending Dept Head',
    version: 1,
    objectives: ['Apply free-body diagrams to static equilibrium problems.'],
    activities: [{ session: 1, activity: 'Free-body diagram workshop', duration: '45 mins' }],
    assessments: ['Forces quiz'],
    homework: 'Complete problems 1–8 on worksheet.',
    createdAt: '2026-05-20T11:00:00Z',
  },
  {
    id: 'lp-5',
    subject: 'Mathematics',
    grade: 'Grade 11',
    title: 'Trigonometric Identities & Applications',
    sessions: 5,
    teacherId: 'tch-7',
    teacherName: 'Ato Belayneh Kassahun',
    status: 'Pending Dept Head',
    version: 1,
    objectives: ['Prove basic trigonometric identities.', 'Solve height and distance problems.'],
    activities: [{ session: 1, activity: 'Identity proof board work', duration: '45 mins' }],
    assessments: ['Identity proof test'],
    homework: 'Memorize sin²θ + cos²θ = 1 and derive two corollaries.',
    createdAt: '2026-05-21T09:30:00Z',
  },
];

export const mockAssessments: Assessment[] = [
  {
    id: 'asm-1',
    title: 'Grade 9 Biology Midterm - Unit 1 & 2',
    type: 'Mid Exam',
    subject: 'Biology',
    grade: 'Grade 9',
    teacherId: 'tch-1',
    teacherName: 'Martha Feyissa',
    status: 'Approved',
    difficulty: 'Medium',
    questions: [
      { id: 1, question: 'Which organelle is responsible for cellular respiration?', type: 'MCQ', options: ['Nucleus', 'Mitochondria', 'Chloroplast', 'Ribosome'], answer: 'Mitochondria' },
      { id: 2, question: 'Osmosis is the net movement of water from high to low solute concentration.', type: 'True/False', answer: 'False' },
      { id: 3, question: 'Explain the primary differences between eukaryotic and prokaryotic cells.', type: 'Essay', answer: 'Eukaryotes have a membrane-bound nucleus and membrane-bound organelles (e.g. mitochondria), whereas prokaryotes lack a defined nucleus and their DNA is circular and floats in the nucleoid region.' },
    ],
    createdAt: '2026-05-12T09:00:00Z',
  },
  {
    id: 'asm-2',
    title: 'Grade 10 Quadratic Roots Evaluation',
    type: 'Quiz',
    subject: 'Mathematics',
    grade: 'Grade 10',
    teacherId: 'tch-2',
    teacherName: 'Abebe Kebede',
    status: 'Pending Dept Head',
    difficulty: 'Hard',
    questions: [
      { id: 1, question: 'What is the discriminant of the quadratic equation 3x^2 - 5x + 2 = 0?', type: 'Short Answer', answer: '1' },
      { id: 2, question: 'If the discriminant is negative, the equation has two distinct real roots.', type: 'True/False', answer: 'False' },
      { id: 3, question: 'Solve x^2 - 7x + 12 = 0.', type: 'MCQ', options: ['x=3, x=4', 'x=-3, x=-4', 'x=2, x=6', 'x=0'], answer: 'x=3, x=4' },
    ],
    createdAt: '2026-05-18T11:15:00Z',
  },
  {
    id: 'asm-3',
    title: 'Grade 11 Physics — Forces & Motion Quiz',
    type: 'Quiz',
    subject: 'Physics',
    grade: 'Grade 11',
    teacherId: 'tch-8',
    teacherName: 'W/t Selamawit Hailu',
    status: 'Pending Dept Head',
    difficulty: 'Medium',
    questions: [
      { id: 1, question: 'State Newton’s second law of motion.', type: 'Short Answer', answer: 'F = ma' },
      { id: 2, question: 'Acceleration due to gravity on Earth is approximately 9.8 m/s².', type: 'True/False', answer: 'True' },
    ],
    createdAt: '2026-05-19T08:00:00Z',
  },
  {
    id: 'asm-4',
    title: 'Grade 10 Chemistry — Acids & Bases Practical',
    type: 'Practical',
    subject: 'Chemistry',
    grade: 'Grade 10',
    teacherId: 'tch-6',
    teacherName: 'W/ro Almaz Tekle',
    status: 'Pending Dept Head',
    difficulty: 'Easy',
    questions: [
      { id: 1, question: 'Define pH scale range for acidic solutions.', type: 'Short Answer', answer: 'pH less than 7' },
    ],
    createdAt: '2026-05-20T14:30:00Z',
  },
  {
    id: 'asm-5',
    title: 'Grade 9 Biology — Cell Structure Quiz',
    type: 'Quiz',
    subject: 'Biology',
    grade: 'Grade 9',
    teacherId: 'tch-1',
    teacherName: 'Martha Feyissa',
    status: 'Rejected',
    difficulty: 'Easy',
    comments: 'Revise difficulty balance — too many recall questions.',
    questions: [
      { id: 1, question: 'Name the control center of the cell.', type: 'Short Answer', answer: 'Nucleus' },
    ],
    createdAt: '2026-05-10T09:00:00Z',
  },
];

export const mockAttendanceRecords: Attendance[] = [
  { id: 'att-1', studentId: 'std-1', studentName: 'Selam Abebe', grade: 'Grade 9', section: 'A', date: '2026-05-20', status: 'Present' },
  { id: 'att-2', studentId: 'std-2', studentName: 'Yonas Kassa', grade: 'Grade 9', section: 'B', date: '2026-05-20', status: 'Absent', remarks: 'Sick leave (Flu)' },
  { id: 'att-3', studentId: 'std-4', studentName: 'Tariku Tigist', grade: 'Grade 9', section: 'A', date: '2026-05-20', status: 'Late', remarks: 'Late by 10 mins (Traffic)' },
  { id: 'att-4', studentId: 'std-1', studentName: 'Selam Abebe', grade: 'Grade 9', section: 'A', date: '2026-05-19', status: 'Present' },
  { id: 'att-5', studentId: 'std-2', studentName: 'Yonas Kassa', grade: 'Grade 9', section: 'B', date: '2026-05-19', status: 'Present' },
  { id: 'att-6', studentId: 'std-4', studentName: 'Tariku Tigist', grade: 'Grade 9', section: 'A', date: '2026-05-19', status: 'Present' },
];

export const mockTrainingPrograms: TeacherTraining[] = [
  { id: 'tr-1', title: 'Pedagogy & Inclusive Learning for Secondary Classrooms', instructor: 'Dr. Zenebe Lema (AAU)', startDate: '2026-06-01', duration: '4 Weeks', completedCount: 382, totalCount: 500, status: 'Active' },
  { id: 'tr-2', title: 'AI for Education: Integrating Digital Tools in Science & Math', instructor: 'Martha Wolde (MOE Lead)', startDate: '2026-05-10', duration: '2 Weeks', completedCount: 840, totalCount: 1000, status: 'Active' },
  { id: 'tr-3', title: 'Continuous Assessment & Grading rubrics alignment', instructor: 'Ato Solomon Tessema', startDate: '2026-07-15', duration: '1 Week', completedCount: 0, totalCount: 450, status: 'Upcoming' },
];

export const mockCheckIns: SchoolCheckIn[] = [
  { id: 'ch-1', type: 'Teacher Wellness', respondentName: 'Martha Feyissa', rating: 4, comment: 'Sufficient resources. AI tools have saved me hours of scheduling and typing!', date: '2026-05-18' },
  { id: 'ch-2', type: 'Parent Feedback', respondentName: 'Abebe Demeke', rating: 5, comment: 'Extremely glad to see child grades instantly. AI advice helps me review math worksheets at home.', date: '2026-05-19' },
  { id: 'ch-3', type: 'Student Satisfaction', respondentName: 'Selam Abebe', rating: 5, comment: 'AI Study Assistant explained fractions easily. The mock quiz was fun!', date: '2026-05-20' },
  { id: 'ch-4', type: 'Teacher Wellness', respondentName: 'Abebe Kebede', rating: 4, comment: 'STEM lab scheduling is smoother this term. Need more graphing calculators for Grade 11.', date: '2026-05-17' },
  { id: 'ch-5', type: 'Teacher Wellness', respondentName: 'W/ro Almaz Tekle', rating: 3, comment: 'Chemistry practical kits running low — reorder before midterm week.', date: '2026-05-16' },
  { id: 'ch-6', type: 'Student Satisfaction', respondentName: 'Yonas Kassa', rating: 4, comment: 'Physics demonstrations in class 9-B were very clear this week.', date: '2026-05-19' },
];

// ----------------------------------------------------
// National & Regional Metrics (MOE / Analytics)
// ----------------------------------------------------

export const regionalPerformance = [
  { name: 'Addis Ababa', schools: 382, passRate: 88.5, teachersShortage: 4.2 },
  { name: 'Oromia', schools: 1240, passRate: 79.2, teachersShortage: 12.8 },
  { name: 'Amhara', schools: 940, passRate: 80.4, teachersShortage: 9.5 },
  { name: 'Tigray', schools: 410, passRate: 82.1, teachersShortage: 14.1 },
  { name: 'Sidama', schools: 310, passRate: 77.8, teachersShortage: 8.6 },
  { name: 'SNNPR', schools: 580, passRate: 76.4, teachersShortage: 11.2 },
];

export const subjectPerformance = [
  { subject: 'Mathematics', average: 64.2, status: 'Warning', riskIndex: 28.5 },
  { subject: 'Biology', average: 75.8, status: 'Stable', riskIndex: 12.4 },
  { subject: 'Chemistry', average: 69.1, status: 'Stable', riskIndex: 19.8 },
  { subject: 'Physics', average: 58.6, status: 'Critical', riskIndex: 38.2 },
  { subject: 'English', average: 79.4, status: 'Stable', riskIndex: 8.5 },
];

export const nationalStats = {
  schoolsCount: 4210,
  teachersCount: 78500,
  studentsCount: 1845000,
  averagePassRate: 81.6,
};

// ----------------------------------------------------
// Core School Administration Extensions (School Head)
// ----------------------------------------------------

export interface Department {
  id: string;
  name: string;
  headName: string;
  teachersCount: number;
  subjectsCount: number;
  status: 'Active' | 'Inactive';
}

export interface SchoolClass {
  id: string;
  name: string;
  grade: string;
  section: string;
  homeroomTeacher: string;
  studentsCount: number;
}

export interface ExamQuestion {
  text: string;
  options?: string[];
  answer?: string;
}

export interface ExamPaper {
  id: string;
  title: string;
  type: 'Mid Exam' | 'Final Exam';
  subject: string;
  grade: string;
  departmentId: string;
  teacherName: string;
  status: 'Pending Approval' | 'Approved' | 'Rejected';
  questionsCount: number;
  questions?: ExamQuestion[];
  comments?: string;
  createdAt: string;
}

export interface TrainingMaterial {
  id: string;
  title: string;
  resourceUrl: string;
  category: string;
  trainingType?: 'Pedagogy' | 'MOE Mandatory' | 'STEM' | 'Assessment' | 'Subject Specialty';
  departmentId?: string;
  grade?: string;
  subject?: string;
  disseminated?: boolean;
  uploadedAt: string;
}

export interface TeachingNote {
  id: string;
  teacherId: string;
  lessonPlanId?: string;
  title: string;
  grade: string;
  subject: string;
  topic: string;
  language: string;
  contentSummary: string;
  /** JSON-serialized AI note payload for full view/print */
  contentBody?: string;
  status: 'Draft' | 'Saved';
  deptComments?: string;
  createdAt: string;
  updatedAt?: string;
}

export type StudentGradeEntryType =
  | 'Quiz'
  | 'Test'
  | 'Assignment'
  | 'Project'
  | 'Mid Exam'
  | 'Final Exam'
  | 'Practical';

export interface StudentGradeEntry {
  id: string;
  studentId: string;
  teacherId: string;
  subject: string;
  gradeLevel: string;
  section: string;
  entryType: StudentGradeEntryType;
  title: string;
  assessmentId?: string;
  score: number;
  maxScore: number;
  weight: number;
  term: string;
  recordedAt: string;
  remarks?: string;
}

export interface TeacherResource {
  id: string;
  teacherId: string;
  title: string;
  type: 'Worksheet' | 'Slide Deck' | 'Lab Guide' | 'Reference PDF' | 'Video Link';
  grade: string;
  subject: string;
  url: string;
  downloads: number;
  createdAt: string;
}

export interface TeacherFeedback {
  id: string;
  teacherId: string;
  studentId?: string;
  studentName?: string;
  direction: 'to_teacher' | 'from_teacher';
  authorName: string;
  subject: string;
  comment: string;
  rating?: number;
  date: string;
}

export interface ParentMessage {
  id: string;
  teacherId: string;
  studentId: string;
  studentName: string;
  parentName: string;
  message: string;
  sentAt: string;
}

export interface TeacherCheckInPrompt {
  id: string;
  title: string;
  type: 'Teacher Wellness' | 'Student Satisfaction' | 'Parent Feedback';
  dueDate: string;
  teacherResponse?: string;
  respondedAt?: string;
}

export const mockDepartments: Department[] = [
  { id: 'dept-stem', name: 'STEM Department', headName: 'Ato Demis Khabte', teachersCount: 6, subjectsCount: 4, status: 'Active' },
  { id: 'dept-math', name: 'Mathematics Department', headName: 'Ato Belayneh Kassahun', teachersCount: 2, subjectsCount: 1, status: 'Active' },
  { id: 'dept-chem', name: 'Chemistry Department', headName: 'W/ro Almaz Tekle', teachersCount: 2, subjectsCount: 1, status: 'Active' },
  { id: 'dept-eng', name: 'Languages & English', headName: 'Tigist Assefa', teachersCount: 2, subjectsCount: 1, status: 'Active' },
];

export const mockClasses: SchoolClass[] = [
  { id: 'cls-1', name: 'Grade 9-A', grade: 'Grade 9', section: 'A', homeroomTeacher: 'Martha Feyissa', studentsCount: 42 },
  { id: 'cls-2', name: 'Grade 9-B', grade: 'Grade 9', section: 'B', homeroomTeacher: 'Abebe Kebede', studentsCount: 40 },
  { id: 'cls-3', name: 'Grade 10-A', grade: 'Grade 10', section: 'A', homeroomTeacher: 'W/ro Almaz Tekle', studentsCount: 38 },
  { id: 'cls-4', name: 'Grade 11-A', grade: 'Grade 11', section: 'A', homeroomTeacher: 'Ato Belayneh Kassahun', studentsCount: 35 },
  { id: 'cls-5', name: 'Grade 12-A', grade: 'Grade 12', section: 'A', homeroomTeacher: 'W/t Selamawit Hailu', studentsCount: 30 },
];

export const mockExams: ExamPaper[] = [
  {
    id: 'ex-1',
    title: 'Biology Grade 9 Midterm Exam',
    type: 'Mid Exam',
    subject: 'Biology',
    grade: 'Grade 9',
    departmentId: 'dept-stem',
    teacherName: 'Martha Feyissa',
    status: 'Pending Approval',
    questionsCount: 25,
    createdAt: '2026-05-18',
    questions: [
      { text: 'Which organelle is responsible for photosynthesis?', options: ['Mitochondria', 'Chloroplast', 'Nucleus', 'Ribosome'], answer: 'Chloroplast' },
      { text: 'What is the basic unit of life?', options: ['Tissue', 'Organ', 'Cell', 'Atom'], answer: 'Cell' },
    ],
  },
  {
    id: 'ex-2',
    title: 'Mathematics Grade 10 Final Blueprint',
    type: 'Final Exam',
    subject: 'Mathematics',
    grade: 'Grade 10',
    departmentId: 'dept-math',
    teacherName: 'Abebe Kebede',
    status: 'Pending Approval',
    questionsCount: 30,
    createdAt: '2026-05-19',
    questions: [
      { text: 'Solve for x: 2x + 5 = 15', options: ['x = 5', 'x = 10', 'x = 7.5', 'x = 3'], answer: 'x = 5' },
      { text: 'What is the slope of y = 3x - 2?', options: ['-2', '3', '2', '-3'], answer: '3' },
    ],
  },
  { id: 'ex-3', title: 'Physics Grade 12 National Mid Exam', type: 'Mid Exam', subject: 'Physics', grade: 'Grade 12', departmentId: 'dept-stem', teacherName: 'W/t Selamawit Hailu', status: 'Approved', questionsCount: 40, createdAt: '2026-05-15' },
];

export const mockTrainingMaterials: TrainingMaterial[] = [
  { id: 'tm-1', title: 'MOE Modern Secondary Pedagogy Guide v2', resourceUrl: '#', category: 'Pedagogy', trainingType: 'MOE Mandatory', uploadedAt: '2026-05-10', disseminated: true },
  { id: 'tm-2', title: 'Inclusion & Classroom Management Guide', resourceUrl: '#', category: 'Classroom Management', trainingType: 'Pedagogy', uploadedAt: '2026-05-12', disseminated: true },
  { id: 'tm-3', title: 'STEM Lab Safety & Practical Assessment Rubric', resourceUrl: '#', category: 'STEM', trainingType: 'STEM', departmentId: 'dept-stem', grade: 'Grade 9', subject: 'Biology', uploadedAt: '2026-05-14', disseminated: true },
  { id: 'tm-4', title: 'Grade 9–12 Biology Syllabus Alignment Pack', resourceUrl: '#', category: 'Biology', trainingType: 'Subject Specialty', departmentId: 'dept-stem', grade: 'Grade 9', subject: 'Biology', uploadedAt: '2026-05-15', disseminated: false },
  { id: 'tm-6', title: 'Mathematics Grade 9–12 Problem-Solving Framework', resourceUrl: '#', category: 'Mathematics', trainingType: 'Subject Specialty', departmentId: 'dept-math', grade: 'Grade 9', subject: 'Mathematics', uploadedAt: '2026-05-17', disseminated: false },
];

export const mockTeachingNotes: TeachingNote[] = [
  {
    id: 'tn-1',
    teacherId: 'tch-1',
    lessonPlanId: 'lp-1',
    title: 'Cellular Respiration Lecture Notes',
    grade: 'Grade 9',
    subject: 'Biology',
    topic: 'Cellular Respiration',
    language: 'English',
    contentSummary: 'AI-generated notes covering mitochondria, ATP synthesis, and aerobic pathways.',
    status: 'Saved',
    createdAt: '2026-05-12',
  },
  {
    id: 'tn-2',
    teacherId: 'tch-1',
    lessonPlanId: 'lp-6',
    title: 'Session 2 — Membrane Transport Handout',
    grade: 'Grade 10',
    subject: 'Biology',
    topic: 'Membrane transport',
    language: 'English',
    contentSummary: 'Student handout for passive and active transport with diagram prompts.',
    status: 'Saved',
    createdAt: '2026-05-16',
    updatedAt: '2026-05-16',
  },
  {
    id: 'tn-3',
    teacherId: 'tch-1',
    lessonPlanId: 'lp-1',
    title: 'Organelles Quick Reference (Draft)',
    grade: 'Grade 9',
    subject: 'Biology',
    topic: 'Cell organelles',
    language: 'English',
    contentSummary: 'Draft reference sheet for cell organelles.',
    status: 'Draft',
    createdAt: '2026-05-22',
  },
];

export const mockStudentGradeEntries: StudentGradeEntry[] = [
  {
    id: 'ge-1',
    studentId: 'std-1',
    teacherId: 'tch-1',
    subject: 'Biology',
    gradeLevel: 'Grade 9',
    section: 'A',
    entryType: 'Quiz',
    title: 'Unit 2 — Cell organelles quiz',
    score: 18,
    maxScore: 20,
    weight: 10,
    term: 'Term 2 · 2026',
    recordedAt: '2026-05-10',
  },
  {
    id: 'ge-2',
    studentId: 'std-1',
    teacherId: 'tch-1',
    subject: 'Biology',
    gradeLevel: 'Grade 9',
    section: 'A',
    entryType: 'Project',
    title: 'Cell model group project',
    score: 42,
    maxScore: 50,
    weight: 15,
    term: 'Term 2 · 2026',
    recordedAt: '2026-05-14',
  },
  {
    id: 'ge-3',
    studentId: 'std-1',
    teacherId: 'tch-1',
    subject: 'Biology',
    gradeLevel: 'Grade 9',
    section: 'A',
    entryType: 'Mid Exam',
    title: 'Biology midterm examination',
    score: 76,
    maxScore: 100,
    weight: 25,
    term: 'Term 2 · 2026',
    recordedAt: '2026-05-18',
  },
  {
    id: 'ge-4',
    studentId: 'std-2',
    teacherId: 'tch-1',
    subject: 'Biology',
    gradeLevel: 'Grade 9',
    section: 'A',
    entryType: 'Quiz',
    title: 'Unit 2 — Cell organelles quiz',
    score: 14,
    maxScore: 20,
    weight: 10,
    term: 'Term 2 · 2026',
    recordedAt: '2026-05-10',
    remarks: 'Needs review session',
  },
  {
    id: 'ge-5',
    studentId: 'std-2',
    teacherId: 'tch-1',
    subject: 'Biology',
    gradeLevel: 'Grade 9',
    section: 'A',
    entryType: 'Test',
    title: 'Membrane transport unit test',
    score: 62,
    maxScore: 100,
    weight: 20,
    term: 'Term 2 · 2026',
    recordedAt: '2026-05-17',
  },
  {
    id: 'ge-6',
    studentId: 'std-3',
    teacherId: 'tch-1',
    subject: 'Biology',
    gradeLevel: 'Grade 9',
    section: 'B',
    entryType: 'Assignment',
    title: 'Homework — mitochondria essay',
    score: 9,
    maxScore: 10,
    weight: 5,
    term: 'Term 2 · 2026',
    recordedAt: '2026-05-12',
  },
  {
    id: 'ge-7',
    studentId: 'std-3',
    teacherId: 'tch-1',
    subject: 'Biology',
    gradeLevel: 'Grade 9',
    section: 'B',
    entryType: 'Final Exam',
    title: 'Final exam (practice mock)',
    score: 88,
    maxScore: 100,
    weight: 30,
    term: 'Term 2 · 2026',
    recordedAt: '2026-05-20',
  },
];

export const mockTeacherResources: TeacherResource[] = [
  {
    id: 'tr-1',
    teacherId: 'tch-1',
    title: 'Grade 9 Cell Structure Lab Guide',
    type: 'Lab Guide',
    grade: 'Grade 9',
    subject: 'Biology',
    url: '#',
    downloads: 48,
    createdAt: '2026-05-08',
  },
  {
    id: 'tr-2',
    teacherId: 'tch-1',
    title: 'Mitosis Slide Deck',
    type: 'Slide Deck',
    grade: 'Grade 10',
    subject: 'Biology',
    url: '#',
    downloads: 32,
    createdAt: '2026-05-14',
  },
];

export const mockTeacherFeedbacks: TeacherFeedback[] = [
  {
    id: 'tfb-1',
    teacherId: 'tch-1',
    direction: 'to_teacher',
    authorName: 'Ato Demis Khabte',
    subject: 'Lesson plan — Unit 3',
    comment: 'Strong pedagogical sequencing. Consider adding a formative check in session 2.',
    rating: 5,
    date: '2026-05-18',
  },
  {
    id: 'tfb-2',
    teacherId: 'tch-1',
    studentId: 'std-1',
    studentName: 'Almaz Kebede',
    direction: 'from_teacher',
    authorName: 'Martha Feyissa',
    subject: 'Lab participation',
    comment: 'Excellent microscope technique and group collaboration during the genetics lab.',
    date: '2026-05-19',
  },
  {
    id: 'tfb-3',
    teacherId: 'tch-1',
    studentId: 'std-2',
    studentName: 'Yonas Kassa',
    direction: 'from_teacher',
    authorName: 'Martha Feyissa',
    subject: 'Attendance follow-up',
    comment: 'Please attend extra tutorial sessions to recover missed practicum hours.',
    date: '2026-05-20',
  },
];

export const mockParentMessages: ParentMessage[] = [
  {
    id: 'pm-1',
    teacherId: 'tch-1',
    studentId: 'std-2',
    studentName: 'Yonas Kassa',
    parentName: 'Kebede Abebe',
    message: 'Dear parent — Yonas attendance has dropped below 86%. Please confirm if a parent-teacher meeting works this week.',
    sentAt: '2026-05-20',
  },
];

export const mockRegistrationApplications: RegistrationApplication[] = [
  {
    id: 'reg-app-1',
    applicantName: 'Hanna Tadesse',
    dateOfBirth: '2010-03-14',
    gradeApplied: 'Grade 9',
    sectionRequested: 'A',
    parentName: 'Tadesse Lemma',
    parentPhone: '+251-911-234567',
    parentEmail: 'tadesse.lemma@gmail.com',
    emergencyContact: 'Aunt: +251-912-345678',
    previousSchool: 'Bole Primary School',
    status: 'Submitted',
    submittedAt: '2026-05-28',
  },
  {
    id: 'reg-app-2',
    applicantName: 'Daniel Mekonnen',
    dateOfBirth: '2009-08-22',
    gradeApplied: 'Grade 10',
    sectionRequested: 'B',
    parentName: 'Mekonnen Assefa',
    parentPhone: '+251-922-456789',
    parentEmail: 'mekonnen.a@yahoo.com',
    emergencyContact: 'Uncle: +251-933-567890',
    previousSchool: 'Kirkos Secondary School',
    status: 'Under Review',
    submittedAt: '2026-05-27',
  },
  {
    id: 'reg-app-3',
    applicantName: 'Sara Girma',
    dateOfBirth: '2011-01-05',
    gradeApplied: 'Grade 9',
    sectionRequested: 'C',
    parentName: 'Girma Haile',
    parentPhone: '+251-944-678901',
    parentEmail: 'girma.haile@outlook.com',
    emergencyContact: 'Grandmother: +251-955-789012',
    status: 'Approved',
    submittedAt: '2026-05-25',
    reviewedAt: '2026-05-26',
    reviewerNotes: 'Documents verified. Ready for enrollment.',
  },
  {
    id: 'reg-app-4',
    applicantName: 'Bereket Solomon',
    dateOfBirth: '2008-11-30',
    gradeApplied: 'Grade 11',
    sectionRequested: 'A',
    parentName: 'Solomon Tesfaye',
    parentPhone: '+251-966-890123',
    parentEmail: '',
    emergencyContact: 'Father: +251-966-890123',
    previousSchool: 'Adama Secondary School',
    status: 'Rejected',
    submittedAt: '2026-05-20',
    reviewedAt: '2026-05-21',
    reviewerNotes: 'Incomplete transfer documents from previous school.',
  },
];

export const mockTeacherCheckInPrompts: TeacherCheckInPrompt[] = [
  {
    id: 'tcp-1',
    title: 'Q2 Teacher Wellness Pulse Survey',
    type: 'Teacher Wellness',
    dueDate: '2026-05-28',
  },
  {
    id: 'tcp-2',
    title: 'Instructional Delivery Reflection',
    type: 'Student Satisfaction',
    dueDate: '2026-05-30',
    teacherResponse: 'Students were highly engaged during the genetics practicum; pacing on session 3 could improve.',
    respondedAt: '2026-05-22',
  },
  {
    id: 'tcp-3',
    title: 'Parent Communication Effectiveness',
    type: 'Parent Feedback',
    dueDate: '2026-06-02',
  },
];
