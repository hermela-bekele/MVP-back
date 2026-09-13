-- Portal / admissions / billing / RBAC extensions (multi-school ready)

ALTER TABLE schools ADD COLUMN IF NOT EXISTS slug TEXT;
UPDATE schools SET slug = LOWER(REGEXP_REPLACE(code, '[^a-zA-Z0-9]+', '-', 'g')) WHERE slug IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_schools_slug ON schools(slug);

-- MOE's authoritative region catalog. `schools.region` stays a plain name column
-- (changing it to a FK would touch every existing reader of that field); this table
-- is instead the one source of truth the region dropdowns/filters must read from,
-- replacing what used to be three separately-hardcoded, drifting region lists.
CREATE TABLE IF NOT EXISTS regions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO regions (id, name) VALUES
  ('reg-addis-ababa', 'Addis Ababa'),
  ('reg-oromia', 'Oromia'),
  ('reg-amhara', 'Amhara'),
  ('reg-tigray', 'Tigray'),
  ('reg-sidama', 'Sidama'),
  ('reg-snnpr', 'SNNPR')
ON CONFLICT (name) DO NOTHING;

-- Prepares schools for future EMIS reconciliation (MOE EMIS -> authoritative
-- registry -> PRIME matching -> activation) without pretending that integration
-- is live today. Every school connected through the current manual flow is
-- 'manual' with no emis_id; a real EMIS sync can later populate emis_id and
-- flip the source once credentials/API access exist.
ALTER TABLE schools ADD COLUMN IF NOT EXISTS registry_source TEXT NOT NULL DEFAULT 'manual' CHECK (registry_source IN ('manual', 'emis'));
ALTER TABLE schools ADD COLUMN IF NOT EXISTS emis_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_schools_emis_id ON schools(emis_id) WHERE emis_id IS NOT NULL;

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

CREATE TABLE IF NOT EXISTS registration_form_templates (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  code TEXT NOT NULL UNIQUE,
  fields JSONB NOT NULL DEFAULT '[]',
  required_documents JSONB NOT NULL DEFAULT '[]',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT REFERENCES portal_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
  form_template_id TEXT REFERENCES registration_form_templates(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, reference_code)
);

-- §31: which intake cycle this application belongs to. Captured automatically
-- at submission time (the applicant doesn't choose it) rather than added as
-- another question on the form.
ALTER TABLE admission_applications ADD COLUMN IF NOT EXISTS academic_year TEXT;

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

ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS academic_year TEXT;

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

-- TE-002: a real teacher relationship, not just the free-text teacher_name display
-- field. Backfilled by matching teacher_name against teachers.name within the same
-- school; slots that don't match (e.g. stale/typo'd names) are left null rather than
-- guessed at.
ALTER TABLE timetable_slots ADD COLUMN IF NOT EXISTS teacher_id TEXT REFERENCES teachers(id);
CREATE INDEX IF NOT EXISTS idx_timetable_slots_teacher ON timetable_slots(teacher_id);
UPDATE timetable_slots ts
SET teacher_id = t.id
FROM teachers t
WHERE ts.teacher_id IS NULL
  AND t.school_id = ts.school_id
  AND LOWER(t.name) = LOWER(ts.teacher_name);

-- CM-006: attendance.timetable_slot_id (added in schema.sql, before this table existed)
-- must actually point at a real scheduled session — enforce it here now that
-- timetable_slots exists. Null out any stale/orphaned value first so the constraint
-- can never fail to apply on an existing database.
UPDATE attendance SET timetable_slot_id = NULL
 WHERE timetable_slot_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM timetable_slots ts WHERE ts.id = attendance.timetable_slot_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'attendance_timetable_slot_id_fkey'
  ) THEN
    ALTER TABLE attendance
      ADD CONSTRAINT attendance_timetable_slot_id_fkey
      FOREIGN KEY (timetable_slot_id) REFERENCES timetable_slots(id);
  END IF;
END $$;

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

-- Login sessions, one row per issued access token (jti). Lets a user see where
-- they're signed in and revoke a session individually or "everywhere else".
CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  user_agent TEXT,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, revoked_at);

-- School Administration > Integrations: real, persisted configuration per school.
-- Saving marks a row 'configured' — this only records the settings an admin entered;
-- it does not attempt to contact any external system (no live EMIS/SMS/email
-- credentials exist yet), so status never claims a verified connection.
CREATE TABLE IF NOT EXISTS school_integrations (
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  integration_type TEXT NOT NULL CHECK (integration_type IN ('emis', 'sms', 'email')),
  status TEXT NOT NULL DEFAULT 'not_configured' CHECK (status IN ('not_configured', 'configured', 'disabled')),
  config JSONB NOT NULL DEFAULT '{}',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, integration_type)
);

ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS report_card_template JSONB NOT NULL DEFAULT '{}';

-- MOE Documents: national policy/curriculum/compliance documents MOE uploads and
-- manages. `audience` is categorization only (All/Regional/Woredas/Schools) — there
-- is no automatic distribution/visibility logic tied to it (see MOE requirements
-- §11), so this stays a MOE-portal-managed catalog for now, not a subscriber feed.
CREATE TABLE IF NOT EXISTS moe_documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'Policy', 'Syllabus', 'Curriculum Framework', 'Text Books', 'Teachers Guide',
    'Training Manuals', 'Compliance Checklist', 'Directives', 'SOP',
    'Assessment Blueprint', 'Exam Guideline', 'Annual Performance Report',
    'Audit and Inspection Reports', 'Budget Allocation'
  )),
  audience TEXT NOT NULL DEFAULT 'All' CHECK (audience IN ('All', 'Regional', 'Woredas', 'Schools')),
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER,
  uploaded_by TEXT REFERENCES portal_users(id),
  uploaded_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_moe_documents_category ON moe_documents(category);
CREATE INDEX IF NOT EXISTS idx_moe_documents_created ON moe_documents(created_at DESC);

-- Training resources/programs: MOE needs the same audience categorization used for
-- MOE Documents, plus a real description field for resources and a subject-matter
-- category for programs (distinct from `training_plans.type`, which is delivery
-- mode: continuous_development vs in_person).
ALTER TABLE training_materials ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE training_materials ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'All' CHECK (audience IN ('All', 'Regional', 'Woredas', 'Schools'));
ALTER TABLE training_plans ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE training_plans ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'All' CHECK (audience IN ('All', 'Regional', 'Woredas', 'Schools'));

-- Leadership Actions: one general-purpose structured-action entity backing both
-- the School Head dashboard's "Leadership Attention & Actions" exception queue
-- (category='exception') and "School Improvement & Quality" initiative tracker
-- (category='improvement_initiative', which additionally uses progress_percent).
-- Deliberately one table, not two near-identical ones — and this same table is
-- meant to be reused later for turning a formal communication into a tracked
-- action (see cross-portal requirement on formal actions from messages).
CREATE TABLE IF NOT EXISTS leadership_actions (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'exception' CHECK (category IN ('exception', 'improvement_initiative')),
  issue TEXT NOT NULL,
  evidence TEXT,
  source TEXT,
  severity TEXT NOT NULL DEFAULT 'Medium' CHECK (severity IN ('Low', 'Medium', 'High', 'Critical')),
  owner TEXT,
  decision_required TEXT,
  recommended_action TEXT,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  progress_percent INTEGER CHECK (progress_percent BETWEEN 0 AND 100),
  created_by TEXT REFERENCES portal_users(id),
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_leadership_actions_school ON leadership_actions(school_id, category, status);

-- School Resource Library: lets a School Head catalog resources that are
-- external to the platform (a publisher's site, a third-party LMS course, a
-- government portal, etc.) so they can be classified alongside the other
-- resource sources already visible in the school head's Resource Library view
-- (MOE-issued documents, department-disseminated training materials, teacher
-- uploads approved through the existing review workflow, and PRIME's own
-- built-in programme modules — none of which needed a new table). This table
-- exists only for the one source that had no home anywhere else: resources
-- that live outside the platform and that the school has vetted for use.
CREATE TABLE IF NOT EXISTS school_resources (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  grade TEXT,
  subject TEXT,
  added_by TEXT REFERENCES portal_users(id),
  added_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_school_resources_school ON school_resources(school_id, created_at DESC);

-- Regulatory Engine: MOE issues a compliance requirement (a policy directive,
-- a reporting obligation, an inspection prerequisite, etc.) once, and every
-- school tracks its own status against it in a separate per-school row —
-- mirrors the moe_documents / school_resources split (one MOE-authored
-- catalog, many school-scoped tracking rows) rather than duplicating the
-- requirement text per school.
CREATE TABLE IF NOT EXISTS compliance_requirements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  authority TEXT NOT NULL,
  due_date DATE,
  evidence_required TEXT,
  audience TEXT NOT NULL DEFAULT 'Schools' CHECK (audience IN ('All', 'Regional', 'Woredas', 'Schools')),
  created_by TEXT REFERENCES portal_users(id),
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_compliance_requirements_due ON compliance_requirements(due_date);

CREATE TABLE IF NOT EXISTS school_compliance_status (
  id TEXT PRIMARY KEY,
  requirement_id TEXT NOT NULL REFERENCES compliance_requirements(id) ON DELETE CASCADE,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'Not Started' CHECK (status IN ('Not Started', 'In Progress', 'Submitted', 'Verified', 'Rejected')),
  responsible_person TEXT,
  evidence_submitted_url TEXT,
  evidence_submitted_at TIMESTAMPTZ,
  outstanding_issue TEXT,
  verified_by TEXT REFERENCES portal_users(id),
  verified_by_name TEXT,
  verified_at TIMESTAMPTZ,
  verification_note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (requirement_id, school_id)
);
CREATE INDEX IF NOT EXISTS idx_school_compliance_status_school ON school_compliance_status(school_id);
CREATE INDEX IF NOT EXISTS idx_school_compliance_status_requirement ON school_compliance_status(requirement_id);

-- Message MOE: a real, persisted case-numbered thread per school, replacing
-- the session-local chat that used to live entirely in component state.
-- Read status is tracked as two timestamps rather than per-message flags —
-- a message is unread by a party if it postdates that party's last-read mark
-- and wasn't sent by them.
CREATE TABLE IF NOT EXISTS moe_message_threads (
  id TEXT PRIMARY KEY,
  reference_number TEXT NOT NULL UNIQUE,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'awaiting_moe', 'awaiting_school', 'resolved', 'closed')),
  created_by TEXT REFERENCES portal_users(id),
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  school_last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  moe_last_read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_moe_message_threads_school ON moe_message_threads(school_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS moe_thread_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES moe_message_threads(id) ON DELETE CASCADE,
  sender_user_id TEXT REFERENCES portal_users(id),
  sender_role TEXT NOT NULL CHECK (sender_role IN ('school-head', 'moe')),
  sender_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_moe_thread_messages_thread ON moe_thread_messages(thread_id, created_at);

-- MOE Academic Calendar (§6): the national reference calendar MOE disseminates.
-- Previously this lived only in each browser's localStorage — MOE publishing
-- it on one machine never reached anyone else's session at all. This table is
-- the real, shared source of truth: MOE sees its own latest draft (Draft or
-- Published) so it can resume editing; every other role only ever sees the
-- latest Published row (enforced in the route, not just the UI).
CREATE TABLE IF NOT EXISTS moe_calendar_drafts (
  id TEXT PRIMARY KEY,
  academic_year TEXT NOT NULL,
  title TEXT NOT NULL,
  events JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Published')),
  created_by TEXT REFERENCES portal_users(id),
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_moe_calendar_drafts_created ON moe_calendar_drafts(created_at DESC);

-- Government (Public) school departure notice + MOE teacher replacement assignment.
CREATE TABLE IF NOT EXISTS teacher_replacement_requests (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  departing_teacher_id TEXT NOT NULL REFERENCES teachers(id),
  departure_date DATE NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('resignation', 'transfer', 'retirement', 'other')),
  subjects_needed JSONB NOT NULL DEFAULT '[]',
  grade_levels_needed JSONB NOT NULL DEFAULT '[]',
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'under_review', 'assigned', 'rejected', 'cancelled')),
  assigned_teacher_id TEXT REFERENCES teachers(id),
  moe_reviewed_by TEXT REFERENCES portal_users(id),
  moe_notes TEXT,
  moe_thread_id TEXT REFERENCES moe_message_threads(id),
  created_by TEXT REFERENCES portal_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_teacher_replacement_requests_school
  ON teacher_replacement_requests(school_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_teacher_replacement_requests_status
  ON teacher_replacement_requests(status, created_at DESC);

INSERT INTO permissions (code, label, module, description)
VALUES
  ('staffing.request', 'Request MOE teacher replacement (Public schools)', 'hr', ''),
  ('staffing.assign', 'Assign / transfer teachers for Public schools', 'hr', '')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role, permission_code, school_id)
SELECT 'school-head', 'staffing.request', id FROM schools
ON CONFLICT DO NOTHING;
