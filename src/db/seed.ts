import { pool, query } from './pool.js';
import bcrypt from 'bcryptjs';
import {
  mockSchools,
  mockTeachers,
  mockStudents,
  mockLessonPlans,
  mockAssessments,
  mockAttendanceRecords,
  mockTrainingPrograms,
  mockCheckIns,
  mockDepartments,
  mockClasses,
  mockExams,
  mockTrainingMaterials,
  mockTeachingNotes,
  mockStudentGradeEntries,
  mockTeacherResources,
  mockTeacherFeedbacks,
  mockParentMessages,
  mockTeacherCheckInPrompts,
} from '../lib/mockData.js';

const PORTAL_USERS = [
  { id: 'usr-moe', email: 'moe.admin@prime.gov.et', password: 'moe123', role: 'moe', displayName: 'MOE Admin' },
  { id: 'usr-school', email: 'principal.semeneh@prime.edu.et', password: 'school123', role: 'school-head', displayName: 'School Head' },
  { id: 'usr-registrar', email: 'registrar.office@prime.edu.et', password: 'registrar123', role: 'registrar', displayName: 'Tigist Haile' },
  { id: 'usr-hr', email: 'hr.officer@prime.edu.et', password: 'hr123', role: 'hr', displayName: 'Sara Bekele' },
  { id: 'usr-curr', email: 'curriculum.lead@prime.edu.et', password: 'curr123', role: 'head-of-academics', displayName: 'Head of Academics' },
  {
    id: 'usr-dept',
    email: 'dept.head.math@prime.edu.et',
    password: 'dept123',
    role: 'department-head',
    displayName: 'Ato Belayneh Kassahun',
    subject: 'Mathematics',
    departmentId: 'dept-math',
  },
  {
    id: 'usr-dept-bio',
    email: 'dept.head.bio@prime.edu.et',
    password: 'dept123',
    role: 'department-head',
    displayName: 'Department Head — Biology',
    subject: 'Biology',
    departmentId: 'dept-bio',
  },
  { id: 'usr-teacher', email: 'martha.feyissa@prime.edu.et', password: 'teacher123', role: 'teacher', displayName: 'Martha Feyissa', subject: 'Mathematics', departmentId: 'dept-math' },
  { id: 'usr-teacher-math', email: 'abebe.kebede@prime.edu.et', password: 'teacher123', role: 'teacher', displayName: 'Abebe Kebede' },
  { id: 'usr-student', email: 'selam.abebe@std.edu.et', password: 'student123', role: 'student', displayName: 'Selam Abebe' },
  { id: 'usr-parent', email: 'abebe.demeke@gmail.com', password: 'parent123', role: 'parent', displayName: 'Abebe Demeke' },
  { id: 'usr-finance', email: 'finance.office@prime.edu.et', password: 'finance123', role: 'finance', displayName: 'Finance Officer' },
];

const INITIAL_NOTIFICATIONS = [
  { id: 'not-1', title: 'New Lesson Plan Submitted', description: 'Martha Feyissa submitted a Biology lesson plan for approval.', timestamp: '10 mins ago', read: false, type: 'request' },
  { id: 'not-2', title: 'National Exam Schedule', description: 'MOE published Grade 12 National Exam timelines for June.', timestamp: '1 hour ago', read: false, type: 'info' },
  { id: 'not-3', title: 'Low Attendance Alert', description: 'Student Yonas Kassa attendance has dropped below 86%.', timestamp: '2 hours ago', read: false, type: 'alert' },
];

async function truncateAll() {
  await pool.query(`
    TRUNCATE TABLE
      community_thread_reads, community_channel_reads,
      community_mention_notifications, community_reactions,
      community_messages, community_threads, community_channels,
      community_members, communities,
      audit_logs, email_outbox, thread_messages, message_threads,
      practice_set_questions, practice_sets, question_bank,
      student_documents, timetable_slots, academic_calendar_events, announcements,
      payments, invoice_line_items, invoices, enrollments, waitlist_entries,
      admission_documents, admission_applications, parent_student_links, parents,
      user_permissions, role_permissions, permissions, school_settings, grade_section_capacity,
      notifications, portal_users, parent_messages, teacher_feedbacks,
      teacher_check_in_prompts, teacher_resources, student_grade_entries,
      teaching_notes, training_materials, exams, school_check_ins,
      teacher_trainings, attendance, assessments, lesson_plans,
      school_classes, students, teachers, departments, schools
    RESTART IDENTITY CASCADE
  `);
}

async function seed() {
  await truncateAll();

  for (const s of mockSchools) {
    await query(
      `INSERT INTO schools (id, code, name, region, type, principal, email, phone, capacity, students_count, teachers_count, status, gps)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [s.id, s.code, s.name, s.region, s.type, s.principal, s.email, s.phone, s.capacity, s.studentsCount, s.teachersCount, s.status, s.gps]
    );
  }

  const departments = [
    ...mockDepartments,
    { id: 'dept-bio', name: 'Biology Department', headName: 'Martha Feyissa', teachersCount: 2, subjectsCount: 1, status: 'Active' as const },
    { id: 'dept-phy', name: 'Physics Department', headName: 'W/t Selamawit Hailu', teachersCount: 1, subjectsCount: 1, status: 'Active' as const },
  ];
  for (const d of departments) {
    await query(
      `INSERT INTO departments (id, name, head_name, teachers_count, subjects_count, status) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [d.id, d.name, d.headName, d.teachersCount, d.subjectsCount, d.status]
    );
  }

  for (const t of mockTeachers) {
    await query(
      `INSERT INTO teachers (id, name, email, phone, department_id, school_id, status, subjects, grades, certification, training_progress, years_experience)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [t.id, t.name, t.email, t.phone, t.departmentId, t.schoolId, t.status, JSON.stringify(t.subjects), JSON.stringify(t.grades), t.certification, t.trainingProgress, t.yearsOfExperience ?? 0]
    );
  }

  for (const s of mockStudents) {
    await query(
      `INSERT INTO students (id, student_id, name, email, grade, section, school_id, parent_name, parent_phone, parent_email, status, gpa, attendance_rate, medical_info, emergency_contact)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [s.id, s.studentId, s.name, s.email ?? null, s.grade, s.section, s.schoolId, s.parentName, s.parentPhone, s.parentEmail, s.status, s.gpa, s.attendanceRate, s.medicalInfo ?? null, s.emergencyContact]
    );
  }

  for (const c of mockClasses) {
    await query(
      `INSERT INTO school_classes (id, name, grade, section, homeroom_teacher, students_count) VALUES ($1,$2,$3,$4,$5,$6)`,
      [c.id, c.name, c.grade, c.section, c.homeroomTeacher, c.studentsCount]
    );
  }

  for (const lp of mockLessonPlans) {
    const plan = lp as typeof lp & {
      planType?: string;
      planDetail?: string | null;
      createdByRole?: string;
    };
    await query(
      `INSERT INTO lesson_plans (id, subject, grade, title, sessions, teacher_id, teacher_name, status, dept_comments, school_head_comments, version, objectives, activities, assessments, homework, plan_type, plan_detail, created_by_role, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        plan.id,
        plan.subject,
        plan.grade,
        plan.title,
        plan.sessions,
        plan.teacherId,
        plan.teacherName,
        plan.status,
        plan.deptComments ?? null,
        plan.schoolHeadComments ?? null,
        plan.version,
        JSON.stringify(plan.objectives),
        JSON.stringify(plan.activities),
        JSON.stringify(plan.assessments),
        plan.homework,
        plan.planType ?? 'weekly',
        plan.planDetail ?? null,
        plan.createdByRole ?? 'teacher',
        plan.createdAt,
      ]
    );
  }

  for (const a of mockAssessments) {
    await query(
      `INSERT INTO assessments (id, title, type, subject, grade, teacher_id, teacher_name, status, comments, difficulty, questions, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [a.id, a.title, a.type, a.subject, a.grade, a.teacherId, a.teacherName, a.status, a.comments ?? null, a.difficulty, JSON.stringify(a.questions), a.createdAt]
    );
  }

  for (const att of mockAttendanceRecords) {
    await query(
      `INSERT INTO attendance (id, student_id, student_name, grade, section, date, status, remarks) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [att.id, att.studentId, att.studentName, att.grade, att.section, att.date, att.status, att.remarks ?? null]
    );
  }

  for (const tr of mockTrainingPrograms) {
    await query(
      `INSERT INTO teacher_trainings (id, title, instructor, start_date, duration, completed_count, total_count, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tr.id, tr.title, tr.instructor, tr.startDate, tr.duration, tr.completedCount, tr.totalCount, tr.status]
    );
  }

  for (const ch of mockCheckIns) {
    await query(
      `INSERT INTO school_check_ins (id, title, type, respondent_name, rating, comment, date) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [ch.id, ch.title ?? null, ch.type, ch.respondentName, ch.rating, ch.comment, ch.date]
    );
  }

  for (const ex of mockExams) {
    await query(
      `INSERT INTO exams (id, title, type, subject, grade, department_id, teacher_name, status, questions_count, questions, comments, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [ex.id, ex.title, ex.type, ex.subject, ex.grade, ex.departmentId, ex.teacherName, ex.status, ex.questionsCount, ex.questions ? JSON.stringify(ex.questions) : null, ex.comments ?? null, ex.createdAt]
    );
  }

  for (const tm of mockTrainingMaterials) {
    await query(
      `INSERT INTO training_materials (id, title, resource_url, category, training_type, department_id, grade, subject, disseminated, uploaded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [tm.id, tm.title, tm.resourceUrl, tm.category, tm.trainingType ?? null, tm.departmentId ?? null, tm.grade ?? null, tm.subject ?? null, tm.disseminated ?? false, tm.uploadedAt]
    );
  }

  for (const tn of mockTeachingNotes) {
    await query(
      `INSERT INTO teaching_notes (id, teacher_id, lesson_plan_id, title, grade, subject, topic, language, content_summary, content_body, status, dept_comments, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [tn.id, tn.teacherId, tn.lessonPlanId ?? null, tn.title, tn.grade, tn.subject, tn.topic, tn.language, tn.contentSummary, tn.contentBody ?? null, tn.status, tn.deptComments ?? null, tn.createdAt, tn.updatedAt ?? null]
    );
  }

  for (const ge of mockStudentGradeEntries) {
    const entry = ge as typeof ge & { questionResults?: unknown };
    await query(
      `INSERT INTO student_grade_entries (id, student_id, teacher_id, subject, grade_level, section, entry_type, title, assessment_id, score, max_score, weight, term, recorded_at, remarks, question_results)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)`,
      [
        entry.id,
        entry.studentId,
        entry.teacherId,
        entry.subject,
        entry.gradeLevel,
        entry.section,
        entry.entryType,
        entry.title,
        entry.assessmentId ?? null,
        entry.score,
        entry.maxScore,
        entry.weight,
        entry.term,
        entry.recordedAt,
        entry.remarks ?? null,
        entry.questionResults ? JSON.stringify(entry.questionResults) : null,
      ]
    );
  }

  for (const res of mockTeacherResources) {
    await query(
      `INSERT INTO teacher_resources (id, teacher_id, title, type, grade, subject, url, downloads, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [res.id, res.teacherId, res.title, res.type, res.grade, res.subject, res.url, res.downloads, res.createdAt]
    );
  }

  for (const fb of mockTeacherFeedbacks) {
    await query(
      `INSERT INTO teacher_feedbacks (id, teacher_id, student_id, student_name, direction, author_name, subject, comment, rating, date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [fb.id, fb.teacherId, fb.studentId ?? null, fb.studentName ?? null, fb.direction, fb.authorName, fb.subject, fb.comment, fb.rating ?? null, fb.date]
    );
  }

  for (const pm of mockParentMessages) {
    await query(
      `INSERT INTO parent_messages (id, teacher_id, student_id, student_name, parent_name, message, sent_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [pm.id, pm.teacherId, pm.studentId, pm.studentName, pm.parentName, pm.message, pm.sentAt]
    );
  }

  for (const tcp of mockTeacherCheckInPrompts) {
    await query(
      `INSERT INTO teacher_check_in_prompts (id, title, type, due_date, teacher_response, responded_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tcp.id, tcp.title, tcp.type, tcp.dueDate, tcp.teacherResponse ?? null, tcp.respondedAt ?? null]
    );
  }

  for (const u of PORTAL_USERS) {
    const schoolId =
      u.role === 'moe' ? null : u.role === 'parent' || u.role === 'student' ? 'sch-1' : 'sch-1';
    const passwordHash = await bcrypt.hash(u.password, 10);
    await query(
      `INSERT INTO portal_users (id, email, password, password_hash, role, display_name, subject, department_id, school_id, linked_student_id)
       VALUES ($1,$2,'',$3,$4,$5,$6,$7,$8,$9)`,
      [
        u.id,
        u.email.toLowerCase(),
        passwordHash,
        u.role,
        u.displayName,
        'subject' in u ? u.subject : null,
        'departmentId' in u ? u.departmentId : null,
        schoolId,
        u.role === 'student' ? 'std-1' : null,
      ]
    );
  }

  for (const n of INITIAL_NOTIFICATIONS) {
    await query(
      `INSERT INTO notifications (id, title, description, timestamp_label, read, type) VALUES ($1,$2,$3,$4,$5,$6)`,
      [n.id, n.title, n.description, n.timestamp, n.read, n.type]
    );
  }

  // --- Portal extensions seed ---
  const { PERMISSIONS, ROLE_DEFAULT_PERMISSIONS } = await import('../lib/permissions.js');

  for (const p of PERMISSIONS) {
    await query(
      `INSERT INTO permissions (code, label, module, description) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [p.code, p.label, p.module, '']
    );
  }

  const { rows: schoolRows } = await query('SELECT id, code FROM schools');
  for (const sch of schoolRows) {
    const slug = String(sch.code).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await query(`UPDATE schools SET slug = $1 WHERE id = $2`, [slug, sch.id]);
    await query(
      `INSERT INTO school_settings (school_id, application_form_schema) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [
        sch.id,
        JSON.stringify([
          { key: 'previousSchool', label: 'Previous school', type: 'text', required: false },
          { key: 'medicalInfo', label: 'Medical notes', type: 'textarea', required: false },
        ]),
      ]
    );

    for (const [role, codes] of Object.entries(ROLE_DEFAULT_PERMISSIONS)) {
      for (const code of codes) {
        await query(
          `INSERT INTO role_permissions (role, permission_code, school_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [role, code, sch.id]
        );
      }
    }

    for (const grade of ['Grade 9', 'Grade 10', 'Grade 11']) {
      for (const section of ['A', 'B']) {
        await query(
          `INSERT INTO grade_section_capacity (id, school_id, grade, section, capacity, reserved_count, enrolled_count)
           VALUES ($1,$2,$3,$4,40,0,0) ON CONFLICT DO NOTHING`,
          [`cap-${sch.id}-${grade}-${section}`.replace(/\s/g, ''), sch.id, grade, section]
        );
      }
    }
  }

  await query(
    `UPDATE school_settings SET
      registration_fee = 500,
      monthly_tuition = 2500,
      admission_invoice_due_days = 14,
      reminder_days_before = 3,
      monthly_due_day = 5,
      late_fee_type = 'fixed',
      late_fee_amount = 100,
      yellow_deadline_days = 7,
      payment_providers = '["telebirr","chapa","bank_transfer","manual"]'::jsonb,
      sibling_discount_percent = 10,
      required_documents = '[]'::jsonb,
      branding = '{"primaryColor":"#1d4ed8","tagline":"Excellence in learning for every child at Bole Secondary.","logoUrl":"","schoolDisplayName":"Bole Secondary School"}'::jsonb
     WHERE school_id = 'sch-1'`
  );

  for (const [grade, reg, tuition] of [
    ['Grade 9', 500, 2500],
    ['Grade 10', 550, 2700],
    ['Grade 11', 600, 2900],
    ['Grade 12', 650, 3100],
  ] as const) {
    await query(
      `INSERT INTO grade_fee_plans (id, school_id, grade, registration_fee, monthly_tuition)
       VALUES ($1,'sch-1',$2,$3,$4)
       ON CONFLICT (school_id, grade) DO UPDATE SET registration_fee = EXCLUDED.registration_fee, monthly_tuition = EXCLUDED.monthly_tuition`,
      [`gfp-${grade.replace(/\s/g, '')}`, grade, reg, tuition]
    );
  }

  await query(`UPDATE school_classes SET school_id = 'sch-1' WHERE school_id IS NULL`);
  await query(`UPDATE student_grade_entries SET published = TRUE WHERE student_id IN ('std-1','std-2')`);

  await query(
    `INSERT INTO parents (id, school_id, user_id, full_name, email, phone) VALUES
      ('par-1','sch-1','usr-parent','Abebe Demeke','abebe.demeke@gmail.com','+251-911-998877'),
      ('par-2','sch-1',NULL,'Tadesse Lemma','tadesse.lemma@gmail.com','+251-911-234567')`
  );
  await query(`UPDATE portal_users SET linked_parent_id = 'par-1' WHERE id = 'usr-parent'`);
  await query(
    `INSERT INTO parent_student_links (id, parent_id, student_id, relationship) VALUES
      ('psl-1','par-1','std-1','father'),
      ('psl-2','par-1','std-2','guardian')
     ON CONFLICT DO NOTHING`
  );

  await query(
    `INSERT INTO announcements (id, school_id, title, body, audience, created_by) VALUES
      ('ann-1','sch-1','Welcome to the new term','Classes begin Monday. Please review the academic calendar in your portal.','all','usr-school'),
      ('ann-2','sch-1','Fee payment reminder','Monthly tuition is due on the 5th. Partial payments are accepted in the parent portal.','parents','usr-school'),
      ('ann-3','sch-1','Sports day','Inter-house sports day this Friday after lunch.','all','usr-school')`
  );
  await query(
    `INSERT INTO academic_calendar_events (id, school_id, title, description, event_date, event_type) VALUES
      ('cal-1','sch-1','Term 1 start','First day of classes','2026-09-01','term'),
      ('cal-2','sch-1','Midterm exams','Midterm week','2026-11-10','exam'),
      ('cal-3','sch-1','Parent-teacher conference','Book slots via messaging','2026-10-15','meeting'),
      ('cal-4','sch-1','Term 1 ends','Report cards published','2026-12-20','term')`
  );
  await query(
    `INSERT INTO timetable_slots (id, school_id, grade, section, day_of_week, start_time, end_time, subject, teacher_name, room) VALUES
      ('tt-1','sch-1','Grade 9','A',1,'08:00','08:45','Biology','Martha Feyissa','Lab 1'),
      ('tt-2','sch-1','Grade 9','A',1,'09:00','09:45','Mathematics','Abebe Kebede','R12'),
      ('tt-3','sch-1','Grade 9','A',2,'08:00','08:45','English','W/ro Almaz Tekle','R08'),
      ('tt-4','sch-1','Grade 9','B',1,'08:00','08:45','Mathematics','Abebe Kebede','R12')`
  );
  await query(
    `INSERT INTO student_documents (id, school_id, student_id, title, doc_type, file_url, uploaded_by) VALUES
      ('sdoc-1','sch-1','std-1','Birth certificate','admission','/uploads/demo-birth.pdf','usr-registrar'),
      ('sdoc-2','sch-1','std-1','Grade 9 Biology Textbook','textbook','/uploads/demo-bio-textbook.pdf','usr-teacher'),
      ('sdoc-3','sch-1','std-2','Transfer letter','admission','/uploads/demo-transfer.pdf','usr-registrar')`
  );
  await query(
    `INSERT INTO question_bank (id, school_id, teacher_id, subject, grade, question_text, question_type, options, correct_answer, difficulty) VALUES
      ('qb-1','sch-1','tch-1','Biology','Grade 9','What is the powerhouse of the cell?','mcq','["Nucleus","Mitochondria","Ribosome","Chloroplast"]','Mitochondria','easy'),
      ('qb-2','sch-1','tch-1','Biology','Grade 9','Which organelle contains chlorophyll?','mcq','["Mitochondria","Chloroplast","Golgi","Lysosome"]','Chloroplast','medium'),
      ('qb-3','sch-1','tch-2','Mathematics','Grade 9','Solve: 2x + 4 = 10','mcq','["x=2","x=3","x=4","x=5"]','x=3','easy')`
  );
  await query(
    `INSERT INTO practice_sets (id, school_id, teacher_id, title, subject, grade, published) VALUES
      ('pset-1','sch-1','tch-1','Cell Biology Warm-up','Biology','Grade 9',TRUE),
      ('pset-2','sch-1','tch-2','Algebra Basics','Mathematics','Grade 9',TRUE)`
  );
  await query(
    `INSERT INTO practice_set_questions (practice_set_id, question_id, sort_order) VALUES
      ('pset-1','qb-1',0),
      ('pset-1','qb-2',1),
      ('pset-2','qb-3',0)`
  );

  await query(
    `INSERT INTO message_threads (id, school_id, student_id, parent_user_id, staff_user_id, staff_role, subject) VALUES
      ('thr-1','sch-1','std-1','usr-parent','usr-teacher','teacher','Selam biology progress'),
      ('thr-2','sch-1','std-2','usr-parent','usr-school','school-head','Yonas attendance follow-up')`
  );
  await query(
    `INSERT INTO thread_messages (id, thread_id, sender_user_id, sender_role, body) VALUES
      ('msg-1','thr-1','usr-teacher','teacher','Selam is doing excellent work in the lab this term.'),
      ('msg-2','thr-1','usr-parent','parent','Thank you — we will keep supporting her homework routine.'),
      ('msg-3','thr-2','usr-school','school-head','Please ensure Yonas attends all chemistry labs this week.')`
  );

  // Applications across statuses for registrar demo
  await query(
    `INSERT INTO admission_applications (
      id, school_id, reference_code, parent_id, parent_name, parent_phone, parent_email, applicant_name,
      date_of_birth, grade_applied, section_requested, emergency_contact, previous_school,
      source_channel, status, submitted_at, priority_score, reviewer_notes, rejection_reason, edit_locked
    ) VALUES
      ('app-seed-1','sch-1','APP-100001','par-2','Tadesse Lemma','+251-911-234567','tadesse.lemma@gmail.com','Hanna Tadesse','2010-03-14','Grade 9','A','Aunt: +251-912-345678','Bole Primary','website','submitted',NOW(),80,NULL,NULL,FALSE),
      ('app-seed-2','sch-1','APP-100002',NULL,'Mekonnen Assefa','+251-922-456789','mekonnen.a@yahoo.com','Daniel Mekonnen','2009-08-22','Grade 10','B','Uncle: +251-933-567890','Kirkos Secondary','facebook','under_review',NOW(),65,'Documents under verification',NULL,FALSE),
      ('app-seed-3','sch-1','APP-100003',NULL,'Girma Haile','+251-944-678901','girma.haile@outlook.com','Sara Girma','2011-01-05','Grade 9','C','Grandmother: +251-955-789012','Lideta Primary','telegram','waitlisted',NOW(),90,'Strong candidate — waiting for seat',NULL,FALSE),
      ('app-seed-4','sch-1','APP-100004',NULL,'Solomon Tesfaye','+251-966-890123','solomon.t@gmail.com','Bereket Solomon','2008-11-30','Grade 11','A','Father: +251-966-890123','Adama Secondary','referral','rejected',NOW(),40,'Incomplete transfer docs','Incomplete transfer documents from previous school',TRUE),
      ('app-seed-5','sch-1','APP-100005','par-1','Abebe Demeke','+251-911-998877','abebe.demeke@gmail.com','Liya Abebe','2012-06-18','Grade 7','A','Abebe Demeke','Sunshine KG','website','submitted',NOW(),75,NULL,NULL,FALSE)`
  );
  await query(
    `INSERT INTO waitlist_entries (id, school_id, application_id, grade, priority_score, force_back, status)
     VALUES ('wl-1','sch-1','app-seed-3','Grade 9',90,FALSE,'waiting')`
  );
  await query(
    `INSERT INTO admission_documents (id, application_id, school_id, doc_type, file_name, file_url, verified) VALUES
      ('adoc-1','app-seed-1','sch-1','birth_certificate','hanna-birth.pdf','/uploads/demo-hanna-birth.pdf',FALSE),
      ('adoc-2','app-seed-2','sch-1','transcript','daniel-transcript.pdf','/uploads/demo-daniel-transcript.pdf',TRUE)`
  );

  // Demo invoices for parent Abebe (par-1) across statuses / children
  await query(
    `INSERT INTO invoices (
      id, school_id, student_id, parent_id, invoice_number, invoice_type, status,
      issue_date, due_date, currency, subtotal, late_fee_total, amount_paid, balance_due, billing_period, notes
    ) VALUES
      ('inv-seed-1','sch-1','std-1','par-1','PTS-2026-0001','monthly','sent',
       CURRENT_DATE - 10, CURRENT_DATE + 5, 'ETB', 2500, 0, 0, 2500, '2026-07', 'July tuition — Selam'),
      ('inv-seed-2','sch-1','std-2','par-1','PTS-2026-0002','monthly','partially_paid',
       CURRENT_DATE - 20, CURRENT_DATE + 2, 'ETB', 2500, 0, 1000, 1500, '2026-07', 'July tuition — Yonas (partial)'),
      ('inv-seed-3','sch-1','std-1','par-1','PTS-2026-0003','monthly','overdue',
       CURRENT_DATE - 40, CURRENT_DATE - 5, 'ETB', 2500, 100, 0, 2600, '2026-06', 'June tuition overdue'),
      ('inv-seed-4','sch-1','std-2','par-1','PTS-2026-0004','monthly','paid',
       CURRENT_DATE - 60, CURRENT_DATE - 30, 'ETB', 2500, 0, 2500, 0, '2026-05', 'May tuition paid')
    ON CONFLICT (id) DO NOTHING`
  );
  await query(
    `INSERT INTO invoice_line_items (id, invoice_id, description, quantity, unit_amount, line_total, line_type) VALUES
      ('ili-s1a','inv-seed-1','Monthly tuition 2026-07',1,2500,2500,'fee'),
      ('ili-s2a','inv-seed-2','Monthly tuition 2026-07',1,2500,2500,'fee'),
      ('ili-s3a','inv-seed-3','Monthly tuition 2026-06',1,2500,2500,'fee'),
      ('ili-s3b','inv-seed-3','Late payment fee',1,100,100,'late_fee'),
      ('ili-s4a','inv-seed-4','Monthly tuition 2026-05',1,2500,2500,'fee')
    ON CONFLICT (id) DO NOTHING`
  );
  await query(
    `INSERT INTO payments (id, school_id, invoice_id, amount, currency, provider, provider_ref, status, paid_at, notes) VALUES
      ('pay-s2','sch-1','inv-seed-2',1000,'ETB','telebirr','TB-SEED-2','succeeded',NOW() - INTERVAL '3 days','Partial payment'),
      ('pay-s4','sch-1','inv-seed-4',2500,'ETB','chapa','CH-SEED-4','succeeded',NOW() - INTERVAL '35 days','Full payment')
    ON CONFLICT (id) DO NOTHING`
  );

  // --- Teacher communities (Discord-style) ---
  // Sync teacher portal_users.department_id from teachers table for auto-membership
  await query(`
    UPDATE portal_users pu
    SET department_id = t.department_id
    FROM teachers t
    WHERE lower(pu.email) = lower(t.email)
      AND pu.role IN ('teacher', 'department-head')
      AND pu.department_id IS NULL
  `);

  const schoolId = 'sch-1';
  const ownerId = 'usr-school';

  async function seedCommunity(opts: {
    id: string;
    name: string;
    description: string;
    type: 'department' | 'general' | 'custom';
    departmentId?: string | null;
  }) {
    await query(
      `INSERT INTO communities (id, school_id, name, description, type, department_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        opts.id,
        schoolId,
        opts.name,
        opts.description,
        opts.type,
        opts.departmentId ?? null,
        ownerId,
      ]
    );

    const channelDefs = [
      { id: `${opts.id}-ch-ann`, name: 'announcements', type: 'announcement', position: 0, description: 'Official updates' },
      { id: `${opts.id}-ch-gen`, name: 'general', type: 'text', position: 1, description: 'General discussion' },
      { id: `${opts.id}-ch-plan`, name: 'lesson-planning', type: 'text', position: 2, description: 'Share plans and tips' },
    ];
    for (const ch of channelDefs) {
      await query(
        `INSERT INTO community_channels (id, community_id, name, description, type, position)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [ch.id, opts.id, ch.name, ch.description, ch.type, ch.position]
      );
    }

    // Owner: school head
    await query(
      `INSERT INTO community_members (id, community_id, user_id, role)
       VALUES ($1,$2,$3,'owner') ON CONFLICT DO NOTHING`,
      [`${opts.id}-mem-owner`, opts.id, ownerId]
    );

    // Auto-join teachers/HoDs by department (or all staff for general)
    if (opts.type === 'general') {
      const { rows: staff } = await query<{ id: string; role: string }>(
        `SELECT id, role FROM portal_users
         WHERE school_id = $1 AND role IN ('teacher', 'department-head', 'school-head', 'head-of-academics')`,
        [schoolId]
      );
      for (const u of staff) {
        const role =
          u.id === ownerId ? 'owner' : u.role === 'school-head' ? 'admin' : 'member';
        await query(
          `INSERT INTO community_members (id, community_id, user_id, role)
           VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [`${opts.id}-mem-${u.id}`, opts.id, u.id, role]
        );
      }
    } else if (opts.departmentId) {
      const { rows: deptUsers } = await query<{ id: string; role: string }>(
        `SELECT id, role FROM portal_users
         WHERE department_id = $1 AND role IN ('teacher', 'department-head')`,
        [opts.departmentId]
      );
      for (const u of deptUsers) {
        const role = u.role === 'department-head' ? 'admin' : 'member';
        await query(
          `INSERT INTO community_members (id, community_id, user_id, role)
           VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [`${opts.id}-mem-${u.id}`, opts.id, u.id, role]
        );
      }
    }

    // Welcome message in #general
    const welcomeId = `${opts.id}-msg-welcome`;
    await query(
      `INSERT INTO community_messages (id, channel_id, thread_id, author_id, author_name, author_role, content)
       VALUES ($1,$2,NULL,$3,$4,$5,$6)`,
      [
        welcomeId,
        `${opts.id}-ch-gen`,
        ownerId,
        'School Head',
        'school-head',
        `Welcome to **${opts.name}**! Use channels for topic-focused chat, and start threads so side discussions stay organized.`,
      ]
    );
  }

  await seedCommunity({
    id: 'comm-general',
    name: 'General School',
    description: 'School-wide teacher community',
    type: 'general',
  });
  await seedCommunity({
    id: 'comm-math',
    name: 'Math Department',
    description: 'Mathematics teachers workspace',
    type: 'department',
    departmentId: 'dept-math',
  });
  await seedCommunity({
    id: 'comm-bio',
    name: 'Science · Biology',
    description: 'Biology teachers workspace',
    type: 'department',
    departmentId: 'dept-bio',
  });
  await seedCommunity({
    id: 'comm-chem',
    name: 'Science · Chemistry',
    description: 'Chemistry teachers workspace',
    type: 'department',
    departmentId: 'dept-chem',
  });

  console.log('Seeded communities: General School, Math, Biology, Chemistry (+ default channels)');

  // Print human-readable demo catalog
  console.log('\n========== PRIME DEMO CATALOG ==========');
  console.log('Public apply URLs (frontend):');
  for (const sch of schoolRows) {
    const slug = String(sch.code).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    console.log(`  /apply/${slug}  (${sch.id} / ${sch.code})`);
  }
  console.log('\nPortal logins (email / password):');
  for (const u of PORTAL_USERS) {
    console.log(`  ${u.role.padEnd(16)} ${u.email} / ${u.password}`);
  }
  console.log('\nParent Abebe Demeke linked children: std-1 Selam Abebe, std-2 Yonas Kassa');
  console.log('Demo invoices for Abebe: upcoming (Selam), partial (Yonas), overdue (Selam), paid (Yonas)');
  console.log('Fees (sch-1): registration 500 + monthly 2500 ETB; due day 5; late fee 100 ETB; reminder 3 days before');
  console.log('Sample apps: APP-100001 submitted, APP-100002 under_review, APP-100003 waitlisted(score 90), APP-100004 rejected, APP-100005 submitted (Abebe/Liya)');
  console.log('Email: set SMTP_HOST or RESEND_API_KEY for real delivery; otherwise PDFs save under uploads/emails/');
  console.log('========================================\n');

  console.log('Database seeded successfully.');
  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
