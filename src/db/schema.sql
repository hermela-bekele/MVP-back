-- Prime Teaching System — PostgreSQL schema

CREATE TABLE IF NOT EXISTS schools (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Public', 'Private')),
  principal TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 0,
  students_count INTEGER NOT NULL DEFAULT 0,
  teachers_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('Active', 'Suspended')),
  gps TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  head_name TEXT NOT NULL,
  teachers_count INTEGER NOT NULL DEFAULT 0,
  subjects_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('Active', 'Inactive'))
);

CREATE TABLE IF NOT EXISTS teachers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  department_id TEXT REFERENCES departments(id),
  school_id TEXT REFERENCES schools(id),
  status TEXT NOT NULL CHECK (status IN ('Active', 'On Leave')),
  subjects JSONB NOT NULL DEFAULT '[]',
  grades JSONB NOT NULL DEFAULT '[]',
  certification TEXT NOT NULL DEFAULT '',
  training_progress INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  grade TEXT NOT NULL,
  section TEXT NOT NULL,
  school_id TEXT REFERENCES schools(id),
  parent_name TEXT NOT NULL,
  parent_phone TEXT NOT NULL,
  parent_email TEXT NOT NULL,
  status TEXT NOT NULL,
  gpa NUMERIC(4,2) NOT NULL DEFAULT 0,
  attendance_rate NUMERIC(5,2) NOT NULL DEFAULT 100,
  medical_info TEXT,
  emergency_contact TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS school_classes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  grade TEXT NOT NULL,
  section TEXT NOT NULL,
  homeroom_teacher TEXT NOT NULL,
  students_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lesson_plans (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  grade TEXT NOT NULL,
  title TEXT NOT NULL,
  sessions INTEGER NOT NULL,
  teacher_id TEXT REFERENCES teachers(id),
  teacher_name TEXT NOT NULL,
  status TEXT NOT NULL,
  dept_comments TEXT,
  school_head_comments TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  objectives JSONB NOT NULL DEFAULT '[]',
  activities JSONB NOT NULL DEFAULT '[]',
  assessments JSONB NOT NULL DEFAULT '[]',
  homework TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assessments (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  subject TEXT NOT NULL,
  grade TEXT NOT NULL,
  teacher_id TEXT REFERENCES teachers(id),
  teacher_name TEXT NOT NULL,
  status TEXT NOT NULL,
  comments TEXT,
  difficulty TEXT NOT NULL,
  questions JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attendance (
  id TEXT PRIMARY KEY,
  student_id TEXT REFERENCES students(id),
  student_name TEXT NOT NULL,
  grade TEXT NOT NULL,
  section TEXT NOT NULL,
  date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Present', 'Absent', 'Late')),
  remarks TEXT
);

CREATE TABLE IF NOT EXISTS teacher_trainings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  instructor TEXT NOT NULL,
  start_date DATE NOT NULL,
  duration TEXT NOT NULL,
  completed_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS school_check_ins (
  id TEXT PRIMARY KEY,
  title TEXT,
  type TEXT NOT NULL,
  respondent_name TEXT NOT NULL,
  rating INTEGER NOT NULL,
  comment TEXT NOT NULL,
  date DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS exams (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  subject TEXT NOT NULL,
  grade TEXT NOT NULL,
  department_id TEXT REFERENCES departments(id),
  teacher_name TEXT NOT NULL,
  status TEXT NOT NULL,
  questions_count INTEGER NOT NULL DEFAULT 0,
  questions JSONB,
  comments TEXT,
  created_at DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS training_materials (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  resource_url TEXT NOT NULL,
  category TEXT NOT NULL,
  training_type TEXT,
  uploaded_at DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS teaching_notes (
  id TEXT PRIMARY KEY,
  teacher_id TEXT REFERENCES teachers(id),
  lesson_plan_id TEXT REFERENCES lesson_plans(id),
  title TEXT NOT NULL,
  grade TEXT NOT NULL,
  subject TEXT NOT NULL,
  topic TEXT NOT NULL,
  language TEXT NOT NULL,
  content_summary TEXT NOT NULL,
  content_body TEXT,
  status TEXT NOT NULL,
  dept_comments TEXT,
  created_at DATE NOT NULL,
  updated_at DATE
);

CREATE TABLE IF NOT EXISTS student_grade_entries (
  id TEXT PRIMARY KEY,
  student_id TEXT REFERENCES students(id),
  teacher_id TEXT REFERENCES teachers(id),
  subject TEXT NOT NULL,
  grade_level TEXT NOT NULL,
  section TEXT NOT NULL,
  entry_type TEXT NOT NULL,
  title TEXT NOT NULL,
  assessment_id TEXT,
  score NUMERIC NOT NULL,
  max_score NUMERIC NOT NULL,
  weight NUMERIC NOT NULL,
  term TEXT NOT NULL,
  recorded_at DATE NOT NULL,
  remarks TEXT
);

CREATE TABLE IF NOT EXISTS teacher_resources (
  id TEXT PRIMARY KEY,
  teacher_id TEXT REFERENCES teachers(id),
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  grade TEXT NOT NULL,
  subject TEXT NOT NULL,
  url TEXT NOT NULL,
  downloads INTEGER NOT NULL DEFAULT 0,
  created_at DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS teacher_feedbacks (
  id TEXT PRIMARY KEY,
  teacher_id TEXT REFERENCES teachers(id),
  student_id TEXT,
  student_name TEXT,
  direction TEXT NOT NULL,
  author_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  comment TEXT NOT NULL,
  rating INTEGER,
  date DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS parent_messages (
  id TEXT PRIMARY KEY,
  teacher_id TEXT REFERENCES teachers(id),
  student_id TEXT REFERENCES students(id),
  student_name TEXT NOT NULL,
  parent_name TEXT NOT NULL,
  message TEXT NOT NULL,
  sent_at DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS teacher_check_in_prompts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  due_date DATE NOT NULL,
  teacher_response TEXT,
  responded_at DATE
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  timestamp_label TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portal_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL,
  display_name TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_students_school ON students(school_id);
CREATE INDEX IF NOT EXISTS idx_lesson_plans_teacher ON lesson_plans(teacher_id);
CREATE INDEX IF NOT EXISTS idx_assessments_teacher ON assessments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_grade_entries_student ON student_grade_entries(student_id);
CREATE INDEX IF NOT EXISTS idx_grade_entries_teacher ON student_grade_entries(teacher_id);
CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id);
