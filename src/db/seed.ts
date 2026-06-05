import { pool, query } from './pool.js';
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
} from '../../../src/lib/mockData.js';

const PORTAL_USERS = [
  { id: 'usr-moe', email: 'moe.admin@prime.gov.et', password: 'moe123', role: 'moe', displayName: 'MOE Admin' },
  { id: 'usr-school', email: 'principal.semeneh@prime.edu.et', password: 'school123', role: 'school-head', displayName: 'School Head' },
  { id: 'usr-curr', email: 'curriculum.lead@prime.edu.et', password: 'curr123', role: 'curriculum-head', displayName: 'Curriculum Head' },
  { id: 'usr-dept', email: 'dept.head.math@prime.edu.et', password: 'dept123', role: 'department-head', displayName: 'Dept Head' },
  { id: 'usr-teacher', email: 'martha.feyissa@prime.edu.et', password: 'teacher123', role: 'teacher', displayName: 'Martha Feyissa' },
  { id: 'usr-student', email: 'selam.abebe@std.edu.et', password: 'student123', role: 'student', displayName: 'Selam Abebe' },
  { id: 'usr-parent', email: 'abebe.demeke@gmail.com', password: 'parent123', role: 'parent', displayName: 'Abebe Demeke' },
];

const INITIAL_NOTIFICATIONS = [
  { id: 'not-1', title: 'New Lesson Plan Submitted', description: 'Martha Feyissa submitted a Biology lesson plan for approval.', timestamp: '10 mins ago', read: false, type: 'request' },
  { id: 'not-2', title: 'National Exam Schedule', description: 'MOE published Grade 12 National Exam timelines for June.', timestamp: '1 hour ago', read: false, type: 'info' },
  { id: 'not-3', title: 'Low Attendance Alert', description: 'Student Yonas Kassa attendance has dropped below 86%.', timestamp: '2 hours ago', read: false, type: 'alert' },
];

async function truncateAll() {
  await pool.query(`
    TRUNCATE TABLE
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
      `INSERT INTO teachers (id, name, email, phone, department_id, school_id, status, subjects, grades, certification, training_progress)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [t.id, t.name, t.email, t.phone, t.departmentId, t.schoolId, t.status, JSON.stringify(t.subjects), JSON.stringify(t.grades), t.certification, t.trainingProgress]
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
    await query(
      `INSERT INTO lesson_plans (id, subject, grade, title, sessions, teacher_id, teacher_name, status, dept_comments, school_head_comments, version, objectives, activities, assessments, homework, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [lp.id, lp.subject, lp.grade, lp.title, lp.sessions, lp.teacherId, lp.teacherName, lp.status, lp.deptComments ?? null, lp.schoolHeadComments ?? null, lp.version, JSON.stringify(lp.objectives), JSON.stringify(lp.activities), JSON.stringify(lp.assessments), lp.homework, lp.createdAt]
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
      `INSERT INTO training_materials (id, title, resource_url, category, training_type, uploaded_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tm.id, tm.title, tm.resourceUrl, tm.category, tm.trainingType ?? null, tm.uploadedAt]
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
    await query(
      `INSERT INTO student_grade_entries (id, student_id, teacher_id, subject, grade_level, section, entry_type, title, assessment_id, score, max_score, weight, term, recorded_at, remarks)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [ge.id, ge.studentId, ge.teacherId, ge.subject, ge.gradeLevel, ge.section, ge.entryType, ge.title, ge.assessmentId ?? null, ge.score, ge.maxScore, ge.weight, ge.term, ge.recordedAt, ge.remarks ?? null]
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
    await query(
      `INSERT INTO portal_users (id, email, password, role, display_name) VALUES ($1,$2,$3,$4,$5)`,
      [u.id, u.email.toLowerCase(), u.password, u.role, u.displayName]
    );
  }

  for (const n of INITIAL_NOTIFICATIONS) {
    await query(
      `INSERT INTO notifications (id, title, description, timestamp_label, read, type) VALUES ($1,$2,$3,$4,$5,$6)`,
      [n.id, n.title, n.description, n.timestamp, n.read, n.type]
    );
  }

  console.log('Database seeded successfully.');
  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
