-- Portal / admissions / billing / RBAC extensions (multi-school ready)

ALTER TABLE schools ADD COLUMN IF NOT EXISTS slug TEXT;
UPDATE schools SET slug = LOWER(REGEXP_REPLACE(code, '[^a-zA-Z0-9]+', '-', 'g')) WHERE slug IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_schools_slug ON schools(slug);

ALTER TABLE portal_users ADD COLUMN IF NOT EXISTS school_id TEXT REFERENCES schools(id);
ALTER TABLE portal_users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE portal_users ADD COLUMN IF NOT EXISTS linked_student_id TEXT REFERENCES students(id);
ALTER TABLE portal_users ADD COLUMN IF NOT EXISTS linked_parent_id TEXT;
ALTER TABLE portal_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
-- Allow clearing plaintext after hashing (login upgrades password -> password_hash)
ALTER TABLE portal_users ALTER COLUMN password DROP NOT NULL;

ALTER TABLE school_classes ADD COLUMN IF NOT EXISTS school_id TEXT REFERENCES schools(id);
ALTER TABLE school_classes ADD COLUMN IF NOT EXISTS capacity INTEGER NOT NULL DEFAULT 40;
ALTER TABLE school_classes ADD COLUMN IF NOT EXISTS reserved_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE student_grade_entries ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE student_grade_entries ADD COLUMN IF NOT EXISTS school_id TEXT REFERENCES schools(id);

ALTER TABLE attendance ADD COLUMN IF NOT EXISTS school_id TEXT REFERENCES schools(id);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS school_id TEXT REFERENCES schools(id);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES portal_users(id);

CREATE TABLE IF NOT EXISTS school_settings (
  school_id TEXT PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  timezone TEXT NOT NULL DEFAULT 'Africa/Addis_Ababa',
  currency TEXT NOT NULL DEFAULT 'ETB',
  registration_fee NUMERIC(12,2) NOT NULL DEFAULT 500,
  monthly_tuition NUMERIC(12,2) NOT NULL DEFAULT 2500,
  admission_invoice_due_days INTEGER NOT NULL DEFAULT 14,
  reminder_days_before INTEGER NOT NULL DEFAULT 3,
  monthly_due_day INTEGER NOT NULL DEFAULT 5 CHECK (monthly_due_day BETWEEN 1 AND 28),
  late_fee_type TEXT NOT NULL DEFAULT 'fixed' CHECK (late_fee_type IN ('fixed', 'percent')),
  late_fee_amount NUMERIC(12,2) NOT NULL DEFAULT 100,
  sibling_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  yellow_deadline_days INTEGER NOT NULL DEFAULT 7,
  application_form_schema JSONB NOT NULL DEFAULT '[]',
  payment_providers JSONB NOT NULL DEFAULT '["telebirr","bank_transfer","manual"]',
  branding JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permissions (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  module TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT NOT NULL,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  PRIMARY KEY (role, permission_code, school_id)
);

CREATE TABLE IF NOT EXISTS user_permissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  effect TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
  school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
  granted_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, permission_code, school_id)
);

CREATE TABLE IF NOT EXISTS parents (
  id TEXT PRIMARY KEY,
  school_id TEXT REFERENCES schools(id),
  user_id TEXT REFERENCES portal_users(id),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS parent_student_links (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL DEFAULT 'guardian',
  access_level TEXT NOT NULL DEFAULT 'full',
  UNIQUE (parent_id, student_id)
);

ALTER TABLE portal_users DROP CONSTRAINT IF EXISTS portal_users_linked_parent_id_fkey;
ALTER TABLE portal_users ADD CONSTRAINT portal_users_linked_parent_id_fkey
  FOREIGN KEY (linked_parent_id) REFERENCES parents(id);

CREATE TABLE IF NOT EXISTS admission_applications (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  reference_code TEXT NOT NULL,
  parent_user_id TEXT REFERENCES portal_users(id),
  parent_id TEXT REFERENCES parents(id),
  applicant_name TEXT NOT NULL,
  date_of_birth DATE,
  grade_applied TEXT NOT NULL,
  section_requested TEXT,
  parent_name TEXT NOT NULL,
  parent_phone TEXT NOT NULL,
  parent_email TEXT NOT NULL,
  emergency_contact TEXT NOT NULL DEFAULT '',
  medical_info TEXT,
  previous_school TEXT,
  source_channel TEXT NOT NULL DEFAULT 'website',
  form_data JSONB NOT NULL DEFAULT '{}',
  priority_score NUMERIC(8,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewer_notes TEXT,
  rejection_reason TEXT,
  provisional_class_id TEXT REFERENCES school_classes(id),
  enrolled_student_id TEXT REFERENCES students(id),
  enrollment_id TEXT,
  invoice_id TEXT,
  edit_locked BOOLEAN NOT NULL DEFAULT FALSE,
  reapply_of TEXT REFERENCES admission_applications(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, reference_code)
);

CREATE TABLE IF NOT EXISTS admission_documents (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES admission_applications(id) ON DELETE CASCADE,
  school_id TEXT NOT NULL REFERENCES schools(id),
  doc_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  application_id TEXT NOT NULL UNIQUE REFERENCES admission_applications(id) ON DELETE CASCADE,
  grade TEXT NOT NULL,
  priority_score NUMERIC(8,2) NOT NULL DEFAULT 0,
  force_back BOOLEAN NOT NULL DEFAULT FALSE,
  position_hint INTEGER,
  status TEXT NOT NULL DEFAULT 'waiting',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS grade_section_capacity (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  grade TEXT NOT NULL,
  section TEXT NOT NULL,
  class_id TEXT REFERENCES school_classes(id),
  capacity INTEGER NOT NULL DEFAULT 40,
  reserved_count INTEGER NOT NULL DEFAULT 0,
  enrolled_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (school_id, grade, section)
);

CREATE TABLE IF NOT EXISTS enrollments (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  application_id TEXT REFERENCES admission_applications(id),
  student_id TEXT REFERENCES students(id),
  grade TEXT NOT NULL,
  section TEXT,
  class_id TEXT REFERENCES school_classes(id),
  status TEXT NOT NULL,
  reserved_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  withdrawn_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  student_id TEXT REFERENCES students(id),
  enrollment_id TEXT REFERENCES enrollments(id),
  application_id TEXT REFERENCES admission_applications(id),
  parent_id TEXT REFERENCES parents(id),
  invoice_number TEXT NOT NULL,
  invoice_type TEXT NOT NULL CHECK (invoice_type IN ('admission', 'monthly', 'late_fee', 'other')),
  status TEXT NOT NULL,
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ETB',
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  late_fee_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance_due NUMERIC(12,2) NOT NULL DEFAULT 0,
  reminder_sent_at TIMESTAMPTZ,
  overdue_notified_at TIMESTAMPTZ,
  billing_period TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_amount NUMERIC(12,2) NOT NULL,
  line_total NUMERIC(12,2) NOT NULL,
  line_type TEXT NOT NULL DEFAULT 'fee'
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ETB',
  provider TEXT NOT NULL,
  provider_ref TEXT,
  status TEXT NOT NULL,
  paid_at TIMESTAMPTZ,
  recorded_by TEXT,
  notes TEXT,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'all',
  created_by TEXT REFERENCES portal_users(id),
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS academic_calendar_events (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  title TEXT NOT NULL,
  description TEXT,
  event_date DATE NOT NULL,
  end_date DATE,
  event_type TEXT NOT NULL DEFAULT 'general',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS timetable_slots (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  class_id TEXT REFERENCES school_classes(id),
  grade TEXT NOT NULL,
  section TEXT NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  subject TEXT NOT NULL,
  teacher_name TEXT,
  room TEXT
);

CREATE TABLE IF NOT EXISTS student_documents (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  student_id TEXT NOT NULL REFERENCES students(id),
  title TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  file_url TEXT NOT NULL,
  visible_to_parent BOOLEAN NOT NULL DEFAULT TRUE,
  visible_to_student BOOLEAN NOT NULL DEFAULT TRUE,
  uploaded_by TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS question_bank (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  teacher_id TEXT REFERENCES teachers(id),
  subject TEXT NOT NULL,
  grade TEXT NOT NULL,
  question_text TEXT NOT NULL,
  question_type TEXT NOT NULL DEFAULT 'mcq',
  options JSONB NOT NULL DEFAULT '[]',
  correct_answer TEXT,
  difficulty TEXT NOT NULL DEFAULT 'medium',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS practice_sets (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  teacher_id TEXT REFERENCES teachers(id),
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  grade TEXT NOT NULL,
  section TEXT,
  published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS practice_set_questions (
  practice_set_id TEXT NOT NULL REFERENCES practice_sets(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES question_bank(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (practice_set_id, question_id)
);

CREATE TABLE IF NOT EXISTS message_threads (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  student_id TEXT REFERENCES students(id),
  parent_user_id TEXT REFERENCES portal_users(id),
  staff_user_id TEXT REFERENCES portal_users(id),
  staff_role TEXT NOT NULL DEFAULT 'teacher',
  subject TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS thread_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  sender_user_id TEXT REFERENCES portal_users(id),
  sender_role TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_outbox (
  id TEXT PRIMARY KEY,
  school_id TEXT REFERENCES schools(id),
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT,
  template_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  related_type TEXT,
  related_id TEXT,
  sent_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  school_id TEXT REFERENCES schools(id),
  actor_user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_applications_school_status ON admission_applications(school_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_school_status ON invoices(school_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_due ON invoices(due_date, status);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_priority ON waitlist_entries(school_id, grade, force_back, priority_score DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_announcements_school ON announcements(school_id, is_active);
CREATE INDEX IF NOT EXISTS idx_parent_links_parent ON parent_student_links(parent_id);
CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON email_outbox(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_ref
  ON payments(provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_idempotent
  ON email_outbox(template_key, related_id) WHERE template_key IS NOT NULL AND related_id IS NOT NULL;

-- Per-grade fee plans (fallback to school_settings when missing)
CREATE TABLE IF NOT EXISTS grade_fee_plans (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  grade TEXT NOT NULL,
  registration_fee NUMERIC(12,2) NOT NULL,
  monthly_tuition NUMERIC(12,2) NOT NULL,
  UNIQUE (school_id, grade)
);

ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS required_documents JSONB NOT NULL DEFAULT '["birth_certificate","previous_report"]';

ALTER TABLE admission_documents ADD COLUMN IF NOT EXISTS scan_status TEXT NOT NULL DEFAULT 'pending';

CREATE TABLE IF NOT EXISTS reenrollment_campaigns (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  target_grade TEXT,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'open',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reenrollment_invites (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES reenrollment_campaigns(id) ON DELETE CASCADE,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES parents(id),
  status TEXT NOT NULL DEFAULT 'pending',
  responded_at TIMESTAMPTZ,
  UNIQUE (campaign_id, student_id)
);

ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS report_card_template JSONB NOT NULL DEFAULT '{}';
