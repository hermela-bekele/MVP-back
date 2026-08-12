-- PRIME EduAI — PostgreSQL schema

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
  training_progress INTEGER NOT NULL DEFAULT 0,
  years_experience INTEGER NOT NULL DEFAULT 0,
  experience_override TEXT CHECK (experience_override IN ('new', 'experienced'))
);

ALTER TABLE teachers ADD COLUMN IF NOT EXISTS years_experience INTEGER NOT NULL DEFAULT 0;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS experience_override TEXT CHECK (experience_override IN ('new', 'experienced'));

-- STEP self-assessment: a teacher's self-rating against the competency rubric.
CREATE TABLE IF NOT EXISTS teacher_self_assessments (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  responses JSONB NOT NULL DEFAULT '[]',
  overall_score NUMERIC NOT NULL DEFAULT 0,
  weakest_competency_id TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_self_assessments_teacher ON teacher_self_assessments(teacher_id);

-- Modules assigned to a specific teacher/leader by their HoD or School Head,
-- covering TIP (induction), STEP (in-service) and ELEP (leadership) programs.
CREATE TABLE IF NOT EXISTS teacher_training_assignments (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  program TEXT NOT NULL CHECK (program IN ('TIP', 'STEP', 'ELEP')),
  module_id TEXT NOT NULL,
  module_title TEXT NOT NULL,
  assigned_by_name TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'in_progress', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_training_assignments_teacher ON teacher_training_assignments(teacher_id);

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
  plan_type TEXT,
  plan_detail TEXT,
  created_by_role TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE lesson_plans ADD COLUMN IF NOT EXISTS plan_type TEXT;
ALTER TABLE lesson_plans ADD COLUMN IF NOT EXISTS plan_detail TEXT;
ALTER TABLE lesson_plans ADD COLUMN IF NOT EXISTS created_by_role TEXT;

-- HoD is the final approver for weekly plans; normalize legacy school-head queue status.
UPDATE lesson_plans SET status = 'Approved'
 WHERE status = 'Pending School Head';

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
  created_by_role TEXT NOT NULL DEFAULT 'teacher',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE assessments ADD COLUMN IF NOT EXISTS created_by_role TEXT NOT NULL DEFAULT 'teacher';

-- Quizzes/baselines never needed approval; backfill any leftover pending/draft/rejected ones.
UPDATE assessments SET status = 'Approved', comments = NULL
 WHERE type IN ('Quiz', 'Baseline') AND status IN ('Pending Dept Head', 'Draft', 'Rejected');

-- HoD-authored exams publish immediately; backfill any leftover pending ones.
UPDATE assessments SET status = 'Approved'
 WHERE created_by_role = 'department-head' AND status IN ('Pending Dept Head', 'Draft');

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
  department_id TEXT REFERENCES departments(id),
  grade TEXT,
  subject TEXT,
  disseminated BOOLEAN NOT NULL DEFAULT FALSE,
  uploaded_at DATE NOT NULL
);

ALTER TABLE training_materials ADD COLUMN IF NOT EXISTS department_id TEXT REFERENCES departments(id);
ALTER TABLE training_materials ADD COLUMN IF NOT EXISTS grade TEXT;
ALTER TABLE training_materials ADD COLUMN IF NOT EXISTS subject TEXT;
ALTER TABLE training_materials ADD COLUMN IF NOT EXISTS disseminated BOOLEAN NOT NULL DEFAULT FALSE;

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
  remarks TEXT,
  question_results JSONB
);

ALTER TABLE student_grade_entries ADD COLUMN IF NOT EXISTS question_results JSONB;

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
  link_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link_path TEXT;

CREATE TABLE IF NOT EXISTS portal_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL,
  display_name TEXT NOT NULL,
  subject TEXT,
  department_id TEXT REFERENCES departments(id)
);

ALTER TABLE portal_users ADD COLUMN IF NOT EXISTS subject TEXT;
ALTER TABLE portal_users ADD COLUMN IF NOT EXISTS department_id TEXT REFERENCES departments(id);

CREATE INDEX IF NOT EXISTS idx_students_school ON students(school_id);
CREATE INDEX IF NOT EXISTS idx_lesson_plans_teacher ON lesson_plans(teacher_id);
CREATE INDEX IF NOT EXISTS idx_assessments_teacher ON assessments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_grade_entries_student ON student_grade_entries(student_id);
CREATE INDEX IF NOT EXISTS idx_grade_entries_teacher ON student_grade_entries(teacher_id);
CREATE TABLE IF NOT EXISTS academic_calendars (
  id TEXT PRIMARY KEY,
  school_id TEXT REFERENCES schools(id),
  academic_year TEXT NOT NULL,
  title TEXT NOT NULL,
  moe_reference TEXT,
  quarters INTEGER NOT NULL,
  quarter_break_weeks INTEGER NOT NULL,
  semester_break_weeks INTEGER NOT NULL,
  mid_exam_count INTEGER NOT NULL,
  mid_exam_days INTEGER,
  final_exam_weeks INTEGER,
  events JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('Draft', 'Published')),
  created_at DATE NOT NULL,
  published_at DATE
);

CREATE INDEX IF NOT EXISTS idx_academic_calendars_school ON academic_calendars(school_id);
CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id);

-- Lesson delivery + classroom grasp feedback
CREATE TABLE IF NOT EXISTS lesson_deliveries (
  id TEXT PRIMARY KEY,
  teaching_note_id TEXT REFERENCES teaching_notes(id) ON DELETE CASCADE,
  lesson_plan_id TEXT REFERENCES lesson_plans(id),
  teacher_id TEXT REFERENCES teachers(id),
  grasp_outcome TEXT NOT NULL CHECK (grasp_outcome IN ('well_grasped', 'majority_grasped', 'challenged')),
  challenge_text TEXT,
  posted_to_hod BOOLEAN NOT NULL DEFAULT FALSE,
  posted_to_community BOOLEAN NOT NULL DEFAULT FALSE,
  community_post_id TEXT,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lesson_deliveries_note ON lesson_deliveries(teaching_note_id);
CREATE INDEX IF NOT EXISTS idx_lesson_deliveries_teacher ON lesson_deliveries(teacher_id);

-- Notes already marked delivered in class should count as approved for HoD review / exam topics.
UPDATE teaching_notes
SET status = 'Approved',
    dept_comments = COALESCE(NULLIF(TRIM(dept_comments), ''), 'Auto-approved — classroom delivery recorded.'),
    updated_at = COALESCE(updated_at, CURRENT_DATE)
WHERE id IN (
  SELECT teaching_note_id FROM lesson_deliveries WHERE teaching_note_id IS NOT NULL
)
AND status IN ('Draft', 'Saved', 'Pending Dept Head');

-- Teacher community: challenges & threaded replies
CREATE TABLE IF NOT EXISTS community_posts (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_role TEXT NOT NULL DEFAULT 'teacher',
  department_id TEXT REFERENCES departments(id),
  subject TEXT,
  grade TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  teaching_note_id TEXT REFERENCES teaching_notes(id),
  lesson_plan_id TEXT REFERENCES lesson_plans(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_replies (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  parent_reply_id TEXT REFERENCES community_replies(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_role TEXT NOT NULL DEFAULT 'teacher',
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_posts_created ON community_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_replies_post ON community_replies(post_id);

-- Real-time-style teacher ↔ HoD messaging
CREATE TABLE IF NOT EXISTS staff_messages (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id),
  department_id TEXT REFERENCES departments(id),
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('teacher', 'department-head')),
  body TEXT NOT NULL,
  related_delivery_id TEXT REFERENCES lesson_deliveries(id),
  related_post_id TEXT REFERENCES community_posts(id),
  read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_messages_teacher ON staff_messages(teacher_id, created_at);
CREATE INDEX IF NOT EXISTS idx_staff_messages_dept ON staff_messages(department_id, created_at);

-- Discord-style communities: department & school-wide group chat with channels, threads, reactions, mentions.
CREATE TABLE IF NOT EXISTS communities (
  id TEXT PRIMARY KEY,
  school_id TEXT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon_url TEXT,
  type TEXT NOT NULL DEFAULT 'custom' CHECK (type IN ('department', 'general', 'custom')),
  department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_members (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(community_id, user_id)
);

CREATE TABLE IF NOT EXISTS community_channels (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'announcement')),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_channel_reads (
  channel_id TEXT NOT NULL REFERENCES community_channels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS community_threads (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES community_channels(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  root_message_id TEXT,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_thread_reads (
  thread_id TEXT NOT NULL REFERENCES community_threads(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (thread_id, user_id)
);

CREATE TABLE IF NOT EXISTS community_messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT REFERENCES community_channels(id) ON DELETE CASCADE,
  thread_id TEXT REFERENCES community_threads(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_role TEXT,
  content TEXT NOT NULL,
  parent_message_id TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS community_message_reactions (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES community_messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS community_mention_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  message_id TEXT NOT NULL REFERENCES community_messages(id) ON DELETE CASCADE,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_members_user ON community_members(user_id);
CREATE INDEX IF NOT EXISTS idx_community_channels_community ON community_channels(community_id, position);
CREATE INDEX IF NOT EXISTS idx_community_messages_channel ON community_messages(channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_community_messages_thread ON community_messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_community_mentions_user ON community_mention_notifications(user_id, is_read);
