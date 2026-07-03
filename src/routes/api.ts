import { Router, type Request, type Response } from 'express';
import { query } from '../db/pool.js';
import { loadBootstrap } from '../db/bootstrap.js';
import {
  mapSchool,
  mapStudent,
  mapTeacher,
  mapLessonPlan,
  mapAssessment,
  mapAttendance,
  mapTeachingNote,
  mapStudentGradeEntry,
  mapTeacherResource,
  mapParentMessage,
  mapTeacherFeedback,
  mapTeacherCheckInPrompt,
  mapNotification,
  mapDepartment,
  mapSchoolClass,
  mapExam,
  mapTrainingMaterial,
  mapSchoolCheckIn,
} from '../lib/serialize.js';
import { resourceUpload } from '../lib/uploads.js';

const DEMO_TEACHER_ID = 'tch-1';

export const apiRouter = Router();

function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>
) {
  return (req: Request, res: Response, next: (err?: unknown) => void) => {
    fn(req, res).catch(next);
  };
}

async function insertNotification(
  title: string,
  description: string,
  type: string
) {
  const id = `not-gen-${Date.now()}`;
  await query(
    `INSERT INTO notifications (id, title, description, timestamp_label, read, type) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, title, description, 'Just now', false, type]
  );
  const { rows } = await query('SELECT * FROM notifications WHERE id = $1', [id]);
  return mapNotification(rows[0]);
}

// Health & bootstrap
apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'prime-api' });
});

apiRouter.post('/uploads', (req, res, next) => {
  resourceUpload.single('file')(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: err.message || 'Upload failed' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }
    const url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.status(201).json({
      url,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
    });
  });
});

apiRouter.get(
  '/bootstrap',
  asyncHandler(async (_req, res) => {
    res.json(await loadBootstrap());
  })
);

const PORTAL_ROLES = [
  'moe',
  'school-head',
  'registrar',
  'hr',
  'curriculum-head',
  'department-head',
  'teacher',
  'student',
  'parent',
] as const;

const SELF_REGISTER_ROLES = PORTAL_ROLES;

function mapPortalUser(user: {
  id: string;
  email: string;
  role: string;
  display_name: string;
  subject?: string | null;
  department_id?: string | null;
}) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    displayName: user.display_name,
    ...(user.subject ? { subject: user.subject } : {}),
    ...(user.department_id ? { departmentId: user.department_id } : {}),
  };
}

// Auth
apiRouter.post(
  '/auth/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password required' });
      return;
    }
    const { rows } = await query(
      'SELECT * FROM portal_users WHERE LOWER(email) = LOWER($1) AND password = $2',
      [email, password]
    );
    if (rows.length === 0) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    res.json(mapPortalUser(rows[0] as Parameters<typeof mapPortalUser>[0]));
  })
);

apiRouter.post(
  '/auth/register',
  asyncHandler(async (req, res) => {
    const { email, password, displayName, role } = req.body as {
      email?: string;
      password?: string;
      displayName?: string;
      role?: string;
    };

    if (!email || !password || !displayName || !role) {
      res.status(400).json({ error: 'Email, password, display name, and role are required' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }

    if (!PORTAL_ROLES.includes(role as (typeof PORTAL_ROLES)[number])) {
      res.status(400).json({ error: 'Invalid role' });
      return;
    }

    if (!SELF_REGISTER_ROLES.includes(role as (typeof SELF_REGISTER_ROLES)[number])) {
      res.status(403).json({
        error: 'This role cannot be self-registered. Contact your school administrator.',
      });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const { rows: existing } = await query(
      'SELECT id FROM portal_users WHERE LOWER(email) = $1',
      [normalizedEmail]
    );
    if (existing.length > 0) {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    const { rows: countRows } = await query('SELECT COUNT(*)::int AS c FROM portal_users');
    const id = `usr-${countRows[0].c + 1}`;

    await query(
      `INSERT INTO portal_users (id, email, password, role, display_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, normalizedEmail, password, role, displayName.trim()]
    );

    const { rows } = await query('SELECT * FROM portal_users WHERE id = $1', [id]);
    res.status(201).json(mapPortalUser(rows[0] as Parameters<typeof mapPortalUser>[0]));
  })
);

// Schools
apiRouter.post(
  '/schools',
  asyncHandler(async (req, res) => {
    const body = req.body;
    const { rows: existing } = await query('SELECT COUNT(*)::int AS c FROM schools');
    const id = `sch-${existing[0].c + 1}`;
    const code = `SCH-${100 + Number(existing[0].c)}`;
    await query(
      `INSERT INTO schools (id, code, name, region, type, principal, email, phone, capacity, students_count, teachers_count, status, gps)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,0,'Active','9.0320° N, 38.7489° E')`,
      [id, code, body.name, body.region, body.type, body.principal, body.email, body.phone, body.capacity ?? 0]
    );
    const { rows } = await query('SELECT * FROM schools WHERE id = $1', [id]);
    await insertNotification('New School Registered', `School ${body.name} registered under code ${code}.`, 'success');
    res.status(201).json(mapSchool(rows[0]));
  })
);

apiRouter.patch(
  '/schools/:id/status',
  asyncHandler(async (req, res) => {
    const { rows: cur } = await query('SELECT * FROM schools WHERE id = $1', [req.params.id]);
    if (!cur.length) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const next = cur[0].status === 'Active' ? 'Suspended' : 'Active';
    await query('UPDATE schools SET status = $1 WHERE id = $2', [next, req.params.id]);
    const { rows } = await query('SELECT * FROM schools WHERE id = $1', [req.params.id]);
    res.json(mapSchool(rows[0]));
  })
);

// Teachers
apiRouter.post(
  '/teachers',
  asyncHandler(async (req, res) => {
    const b = req.body;
    const { rows: cnt } = await query('SELECT COUNT(*)::int AS c FROM teachers');
    const id = `tch-${Number(cnt[0].c) + 1}`;
    await query(
      `INSERT INTO teachers (id, name, email, phone, department_id, school_id, status, subjects, grades, certification, training_progress)
       VALUES ($1,$2,$3,$4,$5,$6,'Active',$7,$8,$9,0)`,
      [id, b.name, b.email, b.phone, b.departmentId, b.schoolId, JSON.stringify(b.subjects ?? []), JSON.stringify(b.grades ?? []), b.certification ?? '']
    );
    await query('UPDATE schools SET teachers_count = teachers_count + 1 WHERE id = $1', [b.schoolId]);
    const { rows } = await query('SELECT * FROM teachers WHERE id = $1', [id]);
    res.status(201).json(mapTeacher(rows[0]));
  })
);

apiRouter.patch(
  '/teachers/:id',
  asyncHandler(async (req, res) => {
    const b = req.body;
    const fields: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    const map: Record<string, string> = {
      name: 'name',
      email: 'email',
      phone: 'phone',
      departmentId: 'department_id',
      schoolId: 'school_id',
      status: 'status',
      certification: 'certification',
      trainingProgress: 'training_progress',
    };
    for (const [k, col] of Object.entries(map)) {
      if (b[k] !== undefined) {
        fields.push(`${col} = $${i++}`);
        vals.push(b[k]);
      }
    }
    if (b.subjects) {
      fields.push(`subjects = $${i++}`);
      vals.push(JSON.stringify(b.subjects));
    }
    if (b.grades) {
      fields.push(`grades = $${i++}`);
      vals.push(JSON.stringify(b.grades));
    }
    if (!fields.length) {
      res.status(400).json({ error: 'No updates' });
      return;
    }
    vals.push(req.params.id);
    await query(`UPDATE teachers SET ${fields.join(', ')} WHERE id = $${i}`, vals);
    const { rows } = await query('SELECT * FROM teachers WHERE id = $1', [req.params.id]);
    res.json(mapTeacher(rows[0]));
  })
);

apiRouter.patch(
  '/teachers/:id/toggle-status',
  asyncHandler(async (req, res) => {
    const { rows: cur } = await query('SELECT * FROM teachers WHERE id = $1', [req.params.id]);
    if (!cur.length) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const next = cur[0].status === 'Active' ? 'On Leave' : 'Active';
    await query('UPDATE teachers SET status = $1 WHERE id = $2', [next, req.params.id]);
    const { rows } = await query('SELECT * FROM teachers WHERE id = $1', [req.params.id]);
    res.json(mapTeacher(rows[0]));
  })
);

// Students
apiRouter.post(
  '/students',
  asyncHandler(async (req, res) => {
    const b = req.body;
    const { rows: cnt } = await query('SELECT COUNT(*)::int AS c FROM students');
    const id = `std-${Number(cnt[0].c) + 1}`;
    const studentId = `PTS/${Math.floor(1000 + Math.random() * 9000)}/18`;
    await query(
      `INSERT INTO students (id, student_id, name, email, grade, section, school_id, parent_name, parent_phone, parent_email, status, gpa, attendance_rate, medical_info, emergency_contact)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Active',0,100,$11,$12)`,
      [id, studentId, b.name, b.email ?? null, b.grade, b.section, b.schoolId, b.parentName, b.parentPhone, b.parentEmail, b.medicalInfo ?? null, b.emergencyContact]
    );
    const { rows } = await query('SELECT * FROM students WHERE id = $1', [id]);
    res.status(201).json(mapStudent(rows[0]));
  })
);

apiRouter.patch(
  '/students/:id',
  asyncHandler(async (req, res) => {
    const b = req.body;
    const cols: [string, unknown][] = [];
    const fieldMap: Record<string, string> = {
      name: 'name',
      email: 'email',
      grade: 'grade',
      section: 'section',
      parentName: 'parent_name',
      parentPhone: 'parent_phone',
      parentEmail: 'parent_email',
      status: 'status',
      gpa: 'gpa',
      attendanceRate: 'attendance_rate',
      medicalInfo: 'medical_info',
      emergencyContact: 'emergency_contact',
    };
    for (const [k, col] of Object.entries(fieldMap)) {
      if (b[k] !== undefined) cols.push([col, b[k]]);
    }
    if (!cols.length) {
      res.status(400).json({ error: 'No updates' });
      return;
    }
    const sets = cols.map(([c], idx) => `${c} = $${idx + 1}`).join(', ');
    const vals = cols.map(([, v]) => v);
    vals.push(req.params.id);
    await query(`UPDATE students SET ${sets} WHERE id = $${cols.length + 1}`, vals);
    const { rows } = await query('SELECT * FROM students WHERE id = $1', [req.params.id]);
    res.json(mapStudent(rows[0]));
  })
);

// Lesson plans
apiRouter.post(
  '/lesson-plans',
  asyncHandler(async (req, res) => {
    const b = req.body;
    const teacherId = b.teacherId ?? DEMO_TEACHER_ID;
    const { rows: tch } = await query('SELECT name FROM teachers WHERE id = $1', [teacherId]);
    const id = `lp-${Date.now()}`;
    await query(
      `INSERT INTO lesson_plans (id, subject, grade, title, sessions, teacher_id, teacher_name, status, version, objectives, activities, assessments, homework, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'Pending Dept Head',1,$8,$9,$10,$11,NOW())`,
      [id, b.subject, b.grade, b.title, b.sessions, teacherId, tch[0]?.name ?? 'Teacher', JSON.stringify(b.objectives ?? []), JSON.stringify(b.activities ?? []), JSON.stringify(b.assessments ?? []), b.homework ?? '']
    );
    const { rows } = await query('SELECT * FROM lesson_plans WHERE id = $1', [id]);
    res.status(201).json(mapLessonPlan(rows[0]));
  })
);

apiRouter.patch(
  '/lesson-plans/:id/approve',
  asyncHandler(async (req, res) => {
    const { role, comments } = req.body as { role: 'dept' | 'school'; comments: string };
    const { rows: cur } = await query('SELECT * FROM lesson_plans WHERE id = $1', [req.params.id]);
    if (!cur.length) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const lp = cur[0];
    const isDept = role === 'dept';
    const status = isDept ? 'Pending School Head' : 'Approved';
    await query(
      `UPDATE lesson_plans SET status = $1, dept_comments = COALESCE($2, dept_comments), school_head_comments = COALESCE($3, school_head_comments), version = version + 1 WHERE id = $4`,
      [status, isDept ? comments : null, !isDept ? comments : null, req.params.id]
    );
    const { rows } = await query('SELECT * FROM lesson_plans WHERE id = $1', [req.params.id]);
    res.json(mapLessonPlan(rows[0]));
  })
);

apiRouter.patch(
  '/lesson-plans/:id/reject',
  asyncHandler(async (req, res) => {
    const { role, comments } = req.body as { role: 'dept' | 'school'; comments: string };
    await query(
      `UPDATE lesson_plans SET status = 'Rejected', dept_comments = CASE WHEN $1 = 'dept' THEN $2 ELSE dept_comments END,
       school_head_comments = CASE WHEN $1 = 'school' THEN $2 ELSE school_head_comments END, version = version + 1 WHERE id = $3`,
      [role, comments, req.params.id]
    );
    const { rows } = await query('SELECT * FROM lesson_plans WHERE id = $1', [req.params.id]);
    res.json(mapLessonPlan(rows[0]));
  })
);

apiRouter.patch(
  '/lesson-plans/:id',
  asyncHandler(async (req, res) => {
    const { title, objectives, sessions, homework } = req.body;
    await query(
      `UPDATE lesson_plans SET title = $1, objectives = $2, sessions = $3, homework = $4, status = 'Pending School Head', version = version + 1 WHERE id = $5`,
      [title, JSON.stringify(objectives), sessions, homework, req.params.id]
    );
    const { rows } = await query('SELECT * FROM lesson_plans WHERE id = $1', [req.params.id]);
    res.json(mapLessonPlan(rows[0]));
  })
);

// Assessments
apiRouter.post(
  '/assessments',
  asyncHandler(async (req, res) => {
    const b = req.body;
    const teacherId = b.teacherId ?? DEMO_TEACHER_ID;
    const { rows: tch } = await query('SELECT name FROM teachers WHERE id = $1', [teacherId]);
    const id = `asm-${Date.now()}`;
    await query(
      `INSERT INTO assessments (id, title, type, subject, grade, teacher_id, teacher_name, status, difficulty, questions, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'Pending Dept Head',$8,$9,NOW())`,
      [id, b.title, b.type, b.subject, b.grade, teacherId, tch[0]?.name ?? 'Teacher', b.difficulty, JSON.stringify(b.questions ?? [])]
    );
    const { rows } = await query('SELECT * FROM assessments WHERE id = $1', [id]);
    res.status(201).json(mapAssessment(rows[0]));
  })
);

apiRouter.patch(
  '/assessments/:id',
  asyncHandler(async (req, res) => {
    const { questions } = req.body;
    if (!Array.isArray(questions)) {
      res.status(400).json({ error: 'questions array required' });
      return;
    }
    await query(
      `UPDATE assessments SET questions = $1,
       status = CASE WHEN status = 'Rejected' THEN 'Pending Dept Head' ELSE status END
       WHERE id = $2`,
      [JSON.stringify(questions), req.params.id]
    );
    const { rows } = await query('SELECT * FROM assessments WHERE id = $1', [req.params.id]);
    res.json(mapAssessment(rows[0]));
  })
);

apiRouter.patch(
  '/assessments/:id/approve',
  asyncHandler(async (req, res) => {
    const { comments } = req.body;
    await query(`UPDATE assessments SET status = 'Approved', comments = $1 WHERE id = $2`, [comments, req.params.id]);
    const { rows } = await query('SELECT * FROM assessments WHERE id = $1', [req.params.id]);
    res.json(mapAssessment(rows[0]));
  })
);

apiRouter.patch(
  '/assessments/:id/reject',
  asyncHandler(async (req, res) => {
    const { comments } = req.body;
    await query(`UPDATE assessments SET status = 'Rejected', comments = $1 WHERE id = $2`, [comments, req.params.id]);
    const { rows } = await query('SELECT * FROM assessments WHERE id = $1', [req.params.id]);
    res.json(mapAssessment(rows[0]));
  })
);

// Attendance batch
apiRouter.post(
  '/attendance/batch',
  asyncHandler(async (req, res) => {
    const { records } = req.body as {
      records: { studentId: string; status: string; remarks?: string }[];
    };
    const today = new Date().toISOString().split('T')[0];
    const created = [];
    for (const rec of records) {
      const { rows: std } = await query('SELECT * FROM students WHERE id = $1', [rec.studentId]);
      const student = std[0];
      const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await query(
        `INSERT INTO attendance (id, student_id, student_name, grade, section, date, status, remarks) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, rec.studentId, student?.name ?? 'Unknown', student?.grade ?? '', student?.section ?? '', today, rec.status, rec.remarks ?? null]
      );
      if (student) {
        const totalDays = 20;
        const presentDays = Math.round((Number(student.attendance_rate) / 100) * totalDays);
        const newPresent = rec.status === 'Present' ? presentDays + 1 : presentDays;
        const nextRate = parseFloat((((newPresent) / (totalDays + 1)) * 100).toFixed(1));
        await query('UPDATE students SET attendance_rate = $1 WHERE id = $2', [nextRate, rec.studentId]);
      }
      const { rows } = await query('SELECT * FROM attendance WHERE id = $1', [id]);
      created.push(mapAttendance(rows[0]));
    }
    res.status(201).json(created);
  })
);

// Departments & classes
apiRouter.post(
  '/departments',
  asyncHandler(async (req, res) => {
    const { name, headName } = req.body;
    const { rows: cnt } = await query('SELECT COUNT(*)::int AS c FROM departments');
    const id = `dept-${Number(cnt[0].c) + 1}`;
    await query(
      `INSERT INTO departments (id, name, head_name, teachers_count, subjects_count, status) VALUES ($1,$2,$3,0,0,'Active')`,
      [id, name, headName]
    );
    const { rows } = await query('SELECT * FROM departments WHERE id = $1', [id]);
    res.status(201).json(mapDepartment(rows[0]));
  })
);

apiRouter.post(
  '/classes',
  asyncHandler(async (req, res) => {
    const { name, grade, section, homeroomTeacher } = req.body;
    const { rows: cnt } = await query('SELECT COUNT(*)::int AS c FROM school_classes');
    const id = `cls-${Number(cnt[0].c) + 1}`;
    await query(
      `INSERT INTO school_classes (id, name, grade, section, homeroom_teacher, students_count) VALUES ($1,$2,$3,$4,$5,0)`,
      [id, name, grade, section, homeroomTeacher]
    );
    const { rows } = await query('SELECT * FROM school_classes WHERE id = $1', [id]);
    res.status(201).json(mapSchoolClass(rows[0]));
  })
);

// Exams
apiRouter.patch(
  '/exams/:id/approve',
  asyncHandler(async (req, res) => {
    const { comments } = req.body;
    await query(`UPDATE exams SET status = 'Approved', comments = $1 WHERE id = $2`, [comments, req.params.id]);
    const { rows } = await query('SELECT * FROM exams WHERE id = $1', [req.params.id]);
    res.json(mapExam(rows[0]));
  })
);

apiRouter.patch(
  '/exams/:id/reject',
  asyncHandler(async (req, res) => {
    const { comments } = req.body;
    await query(`UPDATE exams SET status = 'Rejected', comments = $1 WHERE id = $2`, [comments, req.params.id]);
    const { rows } = await query('SELECT * FROM exams WHERE id = $1', [req.params.id]);
    res.json(mapExam(rows[0]));
  })
);

// Training materials & check-ins
apiRouter.post(
  '/training-materials',
  asyncHandler(async (req, res) => {
    const { title, resourceUrl, category, trainingType, departmentId, grade, subject } = req.body;
    const id = `tm-${Date.now()}`;
    const today = new Date().toISOString().split('T')[0];
    await query(
      `INSERT INTO training_materials (id, title, resource_url, category, training_type, department_id, grade, subject, disseminated, uploaded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE,$9)`,
      [id, title, resourceUrl, category, trainingType ?? null, departmentId ?? null, grade ?? null, subject ?? null, today]
    );
    const { rows } = await query('SELECT * FROM training_materials WHERE id = $1', [id]);
    res.status(201).json(mapTrainingMaterial(rows[0]));
  })
);

apiRouter.patch(
  '/training-materials/:id/disseminate',
  asyncHandler(async (req, res) => {
    await query('UPDATE training_materials SET disseminated = TRUE WHERE id = $1', [req.params.id]);
    const { rows } = await query('SELECT * FROM training_materials WHERE id = $1', [req.params.id]);
    if (!rows.length) {
      res.status(404).json({ error: 'Resource not found' });
      return;
    }
    res.json(mapTrainingMaterial(rows[0]));
  })
);

apiRouter.post(
  '/check-ins',
  asyncHandler(async (req, res) => {
    const { title, type, respondentName, rating, comment } = req.body;
    const id = `ch-gen-${Date.now()}`;
    const today = new Date().toISOString().split('T')[0];
    await query(
      `INSERT INTO school_check_ins (id, title, type, respondent_name, rating, comment, date) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, title, type, respondentName, rating, comment, today]
    );
    const { rows } = await query('SELECT * FROM school_check_ins WHERE id = $1', [id]);
    res.status(201).json(mapSchoolCheckIn(rows[0]));
  })
);

// Teaching notes
apiRouter.post(
  '/teaching-notes',
  asyncHandler(async (req, res) => {
    const b = req.body;
    const id = b.id ?? `tn-${Date.now()}`;
    const today = new Date().toISOString().split('T')[0];
    const teacherId = b.teacherId ?? DEMO_TEACHER_ID;
    const existing = await query('SELECT id FROM teaching_notes WHERE id = $1', [id]);
    if (existing.rows.length) {
      await query(
        `UPDATE teaching_notes SET title=$1, grade=$2, subject=$3, topic=$4, language=$5, content_summary=$6, content_body=$7, lesson_plan_id=$8, updated_at=$9 WHERE id=$10`,
        [b.title, b.grade, b.subject, b.topic, b.language, b.contentSummary, b.contentBody ?? null, b.lessonPlanId ?? null, today, id]
      );
    } else {
      await query(
        `INSERT INTO teaching_notes (id, teacher_id, lesson_plan_id, title, grade, subject, topic, language, content_summary, content_body, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
        [id, teacherId, b.lessonPlanId ?? null, b.title, b.grade, b.subject, b.topic, b.language, b.contentSummary, b.contentBody ?? null, b.status ?? 'Saved', today]
      );
    }
    const { rows } = await query('SELECT * FROM teaching_notes WHERE id = $1', [id]);
    res.status(201).json(mapTeachingNote(rows[0]));
  })
);

apiRouter.patch(
  '/teaching-notes/:id',
  asyncHandler(async (req, res) => {
    const b = req.body;
    const today = new Date().toISOString().split('T')[0];
    const sets: string[] = ['updated_at = $1'];
    const vals: unknown[] = [today];
    let i = 2;
    const fields: Record<string, string> = {
      title: 'title',
      grade: 'grade',
      subject: 'subject',
      topic: 'topic',
      language: 'language',
      contentSummary: 'content_summary',
      contentBody: 'content_body',
      status: 'status',
      lessonPlanId: 'lesson_plan_id',
    };
    for (const [k, col] of Object.entries(fields)) {
      if (b[k] !== undefined) {
        sets.push(`${col} = $${i++}`);
        vals.push(b[k]);
      }
    }
    vals.push(req.params.id);
    await query(`UPDATE teaching_notes SET ${sets.join(', ')} WHERE id = $${i}`, vals);
    const { rows } = await query('SELECT * FROM teaching_notes WHERE id = $1', [req.params.id]);
    res.json(mapTeachingNote(rows[0]));
  })
);

apiRouter.post(
  '/teaching-notes/:id/submit',
  asyncHandler(async (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    await query(`UPDATE teaching_notes SET status = 'Saved', updated_at = $1 WHERE id = $2`, [today, req.params.id]);
    const { rows } = await query('SELECT * FROM teaching_notes WHERE id = $1', [req.params.id]);
    res.json(mapTeachingNote(rows[0]));
  })
);

// Grade entries
apiRouter.post(
  '/grade-entries',
  asyncHandler(async (req, res) => {
    const b = req.body;
    const teacherId = b.teacherId ?? DEMO_TEACHER_ID;
    const today = new Date().toISOString().split('T')[0];
    let id = b.id;
    if (id) {
      await query(
        `UPDATE student_grade_entries SET student_id=$1, subject=$2, grade_level=$3, section=$4, entry_type=$5, title=$6, score=$7, max_score=$8, weight=$9, term=$10, remarks=$11, recorded_at=$12, teacher_id=$13 WHERE id=$14`,
        [b.studentId, b.subject, b.gradeLevel, b.section, b.entryType, b.title, b.score, b.maxScore, b.weight, b.term, b.remarks ?? null, today, teacherId, id]
      );
    } else {
      id = `ge-${Date.now()}`;
      await query(
        `INSERT INTO student_grade_entries (id, student_id, teacher_id, subject, grade_level, section, entry_type, title, assessment_id, score, max_score, weight, term, recorded_at, remarks)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [id, b.studentId, teacherId, b.subject, b.gradeLevel, b.section, b.entryType, b.title, b.assessmentId ?? null, b.score, b.maxScore, b.weight, b.term, b.remarks ?? null, today]
      );
    }
    const { rows } = await query('SELECT * FROM student_grade_entries WHERE id = $1', [id]);
    res.status(201).json(mapStudentGradeEntry(rows[0]));
  })
);

apiRouter.delete(
  '/grade-entries/:id',
  asyncHandler(async (req, res) => {
    await query('DELETE FROM student_grade_entries WHERE id = $1', [req.params.id]);
    res.status(204).send();
  })
);

apiRouter.post(
  '/students/:id/recalculate-gpa',
  asyncHandler(async (req, res) => {
    const studentId = req.params.id;
    const { rows: entries } = await query(
      'SELECT * FROM student_grade_entries WHERE student_id = $1',
      [studentId]
    );
    if (entries.length === 0) {
      res.json({ gpa: 0 });
      return;
    }
    const totalWeight = entries.reduce((a, e) => a + Number(e.weight), 0);
    if (totalWeight === 0) {
      res.json({ gpa: 0 });
      return;
    }
    const weighted = entries.reduce((a, e) => {
      const max = Number(e.max_score);
      const pct = max > 0 ? (Number(e.score) / max) * 100 : 0;
      return a + pct * Number(e.weight);
    }, 0);
    const avgPercent = weighted / totalWeight;
    const gpa = percentToGpa(avgPercent);
    await query('UPDATE students SET gpa = $1 WHERE id = $2', [gpa, studentId]);
    res.json({ gpa });
  })
);

function percentToGpa(avgPercent: number) {
  if (avgPercent >= 93) return 4.0;
  if (avgPercent >= 90) return 3.7;
  if (avgPercent >= 87) return 3.3;
  if (avgPercent >= 83) return 3.0;
  if (avgPercent >= 80) return 2.7;
  if (avgPercent >= 77) return 2.3;
  if (avgPercent >= 73) return 2.0;
  if (avgPercent >= 70) return 1.7;
  if (avgPercent >= 67) return 1.3;
  if (avgPercent >= 65) return 1.0;
  return 0.0;
}

// Teacher resources, messages, feedback, check-in prompts
apiRouter.post(
  '/teacher-resources',
  asyncHandler(async (req, res) => {
    const b = req.body;
    const id = `tres-${Date.now()}`;
    const today = new Date().toISOString().split('T')[0];
    await query(
      `INSERT INTO teacher_resources (id, teacher_id, title, type, grade, subject, url, downloads, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8)`,
      [id, b.teacherId ?? DEMO_TEACHER_ID, b.title, b.type, b.grade, b.subject, b.url, today]
    );
    const { rows } = await query('SELECT * FROM teacher_resources WHERE id = $1', [id]);
    res.status(201).json(mapTeacherResource(rows[0]));
  })
);

apiRouter.post(
  '/parent-messages',
  asyncHandler(async (req, res) => {
    const b = req.body;
    const id = `pm-${Date.now()}`;
    const today = new Date().toISOString().split('T')[0];
    await query(
      `INSERT INTO parent_messages (id, teacher_id, student_id, student_name, parent_name, message, sent_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, b.teacherId ?? DEMO_TEACHER_ID, b.studentId, b.studentName, b.parentName, b.message, today]
    );
    const { rows } = await query('SELECT * FROM parent_messages WHERE id = $1', [id]);
    res.status(201).json(mapParentMessage(rows[0]));
  })
);

apiRouter.post(
  '/teacher-feedbacks',
  asyncHandler(async (req, res) => {
    const b = req.body;
    const { rows: tch } = await query('SELECT name FROM teachers WHERE id = $1', [b.teacherId ?? DEMO_TEACHER_ID]);
    const id = `tfb-${Date.now()}`;
    const today = new Date().toISOString().split('T')[0];
    await query(
      `INSERT INTO teacher_feedbacks (id, teacher_id, student_id, student_name, direction, author_name, subject, comment, rating, date)
       VALUES ($1,$2,$3,$4,'from_teacher',$5,$6,$7,$8,$9)`,
      [id, b.teacherId ?? DEMO_TEACHER_ID, b.studentId ?? null, b.studentName ?? null, tch[0]?.name ?? 'Teacher', b.subject, b.comment, b.rating ?? null, today]
    );
    const { rows } = await query('SELECT * FROM teacher_feedbacks WHERE id = $1', [id]);
    res.status(201).json(mapTeacherFeedback(rows[0]));
  })
);

apiRouter.patch(
  '/teacher-check-in-prompts/:id/respond',
  asyncHandler(async (req, res) => {
    const { response } = req.body;
    const today = new Date().toISOString().split('T')[0];
    await query(
      `UPDATE teacher_check_in_prompts SET teacher_response = $1, responded_at = $2 WHERE id = $3`,
      [response, today, req.params.id]
    );
    const { rows } = await query('SELECT * FROM teacher_check_in_prompts WHERE id = $1', [req.params.id]);
    res.json(mapTeacherCheckInPrompt(rows[0]));
  })
);

// Notifications
apiRouter.post(
  '/notifications',
  asyncHandler(async (req, res) => {
    const { title, description, type } = req.body;
    const notif = await insertNotification(title, description, type);
    res.status(201).json(notif);
  })
);

apiRouter.patch(
  '/notifications/:id/read',
  asyncHandler(async (req, res) => {
    await query('UPDATE notifications SET read = true WHERE id = $1', [req.params.id]);
    const { rows } = await query('SELECT * FROM notifications WHERE id = $1', [req.params.id]);
    res.json(mapNotification(rows[0]));
  })
);

apiRouter.delete(
  '/notifications',
  asyncHandler(async (_req, res) => {
    await query('DELETE FROM notifications');
    res.status(204).send();
  })
);
