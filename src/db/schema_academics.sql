-- Academic results: finalized subject marks, student term summaries, and a proper
-- multi-template system for report cards / transcripts (extends student_grade_entries,
-- does not replace it — see schema.sql:278).

CREATE TABLE IF NOT EXISTS subject_term_results (
  id TEXT PRIMARY KEY,
  school_id TEXT REFERENCES schools(id),
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher_id TEXT REFERENCES teachers(id),
  subject TEXT NOT NULL,
  grade_level TEXT NOT NULL,
  section TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  term TEXT NOT NULL,
  average_percent NUMERIC,
  letter_grade TEXT,
  remark TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'finalized')),
  submitted_at TIMESTAMPTZ,
  submitted_by TEXT,
  finalized_at TIMESTAMPTZ,
  finalized_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, subject, grade_level, section, academic_year, term)
);
CREATE INDEX IF NOT EXISTS idx_subject_term_results_scope
  ON subject_term_results(school_id, grade_level, section, academic_year, term);
CREATE INDEX IF NOT EXISTS idx_subject_term_results_student
  ON subject_term_results(student_id, academic_year, term);
CREATE INDEX IF NOT EXISTS idx_subject_term_results_teacher
  ON subject_term_results(teacher_id);

CREATE TABLE IF NOT EXISTS student_term_summaries (
  id TEXT PRIMARY KEY,
  school_id TEXT REFERENCES schools(id),
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  grade_level TEXT NOT NULL,
  section TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  term TEXT NOT NULL,
  overall_average NUMERIC,
  rank INTEGER,
  rank_population INTEGER,
  conduct TEXT,
  promotion_status TEXT,
  general_remark TEXT,
  finalized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_by TEXT,
  UNIQUE (student_id, grade_level, section, academic_year, term)
);
CREATE INDEX IF NOT EXISTS idx_student_term_summaries_scope
  ON student_term_summaries(school_id, grade_level, section, academic_year, term);

CREATE TABLE IF NOT EXISTS report_templates (
  id TEXT PRIMARY KEY,
  school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('report_card', 'transcript')),
  name TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  based_on_template_id TEXT REFERENCES report_templates(id),
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_report_templates_school_kind ON report_templates(school_id, kind);

ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS active_report_card_template_id TEXT REFERENCES report_templates(id);
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS active_transcript_template_id TEXT REFERENCES report_templates(id);

-- Seed the two Ethiopian-style system default templates (school_id IS NULL = global system row).
INSERT INTO report_templates (id, school_id, kind, name, is_system, is_active, config)
VALUES (
  'tpl-sys-report-card-et',
  NULL,
  'report_card',
  'Ethiopian Standard Secondary Student Report Card',
  TRUE,
  TRUE,
  '{
    "header": {
      "showLogo": true,
      "showSeal": true,
      "title": "Student Report Card",
      "subtitle": "Ethiopian Secondary Education",
      "addressLine": ""
    },
    "studentInfoFields": [
      { "key": "name", "label": "Student Name", "enabled": true },
      { "key": "studentId", "label": "Student ID", "enabled": true },
      { "key": "grade", "label": "Grade", "enabled": true },
      { "key": "section", "label": "Section", "enabled": true },
      { "key": "academicYear", "label": "Academic Year", "enabled": true },
      { "key": "term", "label": "Academic Period", "enabled": true },
      { "key": "parentName", "label": "Parent/Guardian", "enabled": true }
    ],
    "gradingScale": [
      { "minPercent": 90, "maxPercent": 100, "letter": "A", "gpaPoints": 4.0 },
      { "minPercent": 80, "maxPercent": 89, "letter": "B", "gpaPoints": 3.0 },
      { "minPercent": 70, "maxPercent": 79, "letter": "C", "gpaPoints": 2.0 },
      { "minPercent": 60, "maxPercent": 69, "letter": "D", "gpaPoints": 1.0 },
      { "minPercent": 0, "maxPercent": 59, "letter": "F", "gpaPoints": 0.0 }
    ],
    "subjectColumns": {
      "showScore": true,
      "showMaxScore": false,
      "showPercentage": true,
      "showLetterGrade": true,
      "showRemarks": true
    },
    "summaryBlock": {
      "showTermAverage": true,
      "showGpa": false,
      "showRank": true,
      "showRankPopulation": true,
      "showAttendanceRate": true,
      "showConduct": true,
      "showPromotionStatus": true
    },
    "signatureLines": [
      { "id": "sig-1", "label": "Class Teacher" },
      { "id": "sig-2", "label": "Academic Head" },
      { "id": "sig-3", "label": "School Head" }
    ],
    "footerText": "This report card is an official record and must be signed and sealed to be valid."
  }'::jsonb
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO report_templates (id, school_id, kind, name, is_system, is_active, config)
VALUES (
  'tpl-sys-transcript-et',
  NULL,
  'transcript',
  'Ethiopian Standard Secondary Student Transcript',
  TRUE,
  TRUE,
  '{
    "header": {
      "showLogo": true,
      "showSeal": true,
      "title": "Student Transcript",
      "subtitle": "School Leaving / Academic Transcript",
      "addressLine": ""
    },
    "studentInfoFields": [
      { "key": "name", "label": "Full Name", "enabled": true },
      { "key": "studentId", "label": "Student ID / Admission No.", "enabled": true },
      { "key": "grade", "label": "Current / Completed Grade", "enabled": true },
      { "key": "section", "label": "Section", "enabled": false },
      { "key": "academicYear", "label": "Academic Year", "enabled": false },
      { "key": "term", "label": "Academic Period", "enabled": false },
      { "key": "parentName", "label": "Parent/Guardian", "enabled": false }
    ],
    "gradingScale": [
      { "minPercent": 90, "maxPercent": 100, "letter": "A", "gpaPoints": 4.0 },
      { "minPercent": 80, "maxPercent": 89, "letter": "B", "gpaPoints": 3.0 },
      { "minPercent": 70, "maxPercent": 79, "letter": "C", "gpaPoints": 2.0 },
      { "minPercent": 60, "maxPercent": 69, "letter": "D", "gpaPoints": 1.0 },
      { "minPercent": 0, "maxPercent": 59, "letter": "F", "gpaPoints": 0.0 }
    ],
    "subjectColumns": {
      "showScore": false,
      "showMaxScore": false,
      "showPercentage": true,
      "showLetterGrade": true,
      "showRemarks": false
    },
    "summaryBlock": {
      "showTermAverage": true,
      "showGpa": false,
      "showRank": true,
      "showRankPopulation": true,
      "showAttendanceRate": false,
      "showConduct": false,
      "showPromotionStatus": false
    },
    "signatureLines": [
      { "id": "sig-1", "label": "Record Officer" },
      { "id": "sig-2", "label": "Academic Head" },
      { "id": "sig-3", "label": "School Head" }
    ],
    "footerText": "This transcript is an official academic record issued by the school."
  }'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- Backfill the grades.finalize permission for schools whose role_permissions were already
-- seeded before this permission existed (getEffectivePermissions only falls back to the
-- in-code ROLE_DEFAULT_PERMISSIONS when a role has zero rows for a school, so a new
-- permission code must also be inserted directly for schools that already have rows).
INSERT INTO permissions (code, label, module, description)
VALUES ('grades.finalize', 'Finalize academic results', 'academics', '')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role, permission_code, school_id)
SELECT 'head-of-academics', 'grades.finalize', id FROM schools
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role, permission_code, school_id)
SELECT 'school-head', 'grades.finalize', id FROM schools
ON CONFLICT DO NOTHING;
