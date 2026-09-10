import { Router, type Request, type Response } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { newId } from '../lib/ids.js';
import { resolveFeedbackAuthorRole, resolveFeedbackCategory } from '../lib/feedback.js';

export const portalRouter = Router();

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: (err?: unknown) => void) => {
    fn(req, res).catch(next);
  };
}

portalRouter.get(
  '/children',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user!.role === 'student' && req.user!.linkedStudentId) {
      const { rows } = await query('SELECT * FROM students WHERE id = $1', [
        req.user!.linkedStudentId,
      ]);
      res.json(rows);
      return;
    }
    const parentId = req.user!.linkedParentId;
    if (!parentId) {
      // fallback: match by email on students
      const { rows } = await query(
        `SELECT * FROM students WHERE LOWER(parent_email) = LOWER($1)`,
        [req.user!.email]
      );
      res.json(rows);
      return;
    }
    const { rows } = await query(
      `SELECT s.* FROM students s
       JOIN parent_student_links l ON l.student_id = s.id
       WHERE l.parent_id = $1`,
      [parentId]
    );
    res.json(rows);
  })
);

portalRouter.get(
  '/announcements',
  requireAuth,
  asyncHandler(async (req, res) => {
    const schoolId = (req.query.schoolId as string) || req.user!.schoolId;
    const { rows } = await query(
      `SELECT * FROM announcements WHERE ($1::text IS NULL OR school_id = $1) AND is_active = TRUE
       ORDER BY published_at DESC LIMIT 50`,
      [schoolId]
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        schoolId: r.school_id,
        title: r.title,
        body: r.body,
        audience: r.audience,
        publishedAt: r.published_at,
      }))
    );
  })
);

portalRouter.post(
  '/announcements',
  requireAuth,
  requirePermission('announcements.manage'),
  asyncHandler(async (req, res) => {
    const schoolId = req.body.schoolId || req.user!.schoolId;
    const id = newId('ann');
    await query(
      `INSERT INTO announcements (id, school_id, title, body, audience, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, schoolId, req.body.title, req.body.body, req.body.audience || 'all', req.user!.id]
    );
    res.status(201).json({ id });
  })
);

portalRouter.delete(
  '/announcements/:id',
  requireAuth,
  requirePermission('announcements.manage'),
  asyncHandler(async (req, res) => {
    await query(`UPDATE announcements SET is_active = FALSE WHERE id = $1`, [
      String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id),
    ]);
    res.status(204).end();
  })
);

portalRouter.patch(
  '/announcements/:id',
  requireAuth,
  requirePermission('announcements.manage'),
  asyncHandler(async (req, res) => {
    const id = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [key, col] of [
      ['title', 'title'],
      ['body', 'body'],
      ['audience', 'audience'],
    ] as const) {
      if (req.body[key] !== undefined) {
        vals.push(req.body[key]);
        sets.push(`${col} = $${vals.length}`);
      }
    }
    if (!sets.length) {
      res.status(400).json({ error: 'No updates' });
      return;
    }
    vals.push(id);
    await query(`UPDATE announcements SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    const { rows } = await query(`SELECT * FROM announcements WHERE id = $1`, [id]);
    res.json(rows[0] ?? { id });
  })
);

portalRouter.get(
  '/calendar',
  requireAuth,
  asyncHandler(async (req, res) => {
    const schoolId = (req.query.schoolId as string) || req.user!.schoolId;
    const { rows } = await query(
      `SELECT * FROM academic_calendar_events WHERE school_id = $1 ORDER BY event_date`,
      [schoolId]
    );
    res.json(rows);
  })
);

portalRouter.post(
  '/calendar',
  requireAuth,
  requirePermission('calendar.manage'),
  asyncHandler(async (req, res) => {
    const id = newId('cal');
    await query(
      `INSERT INTO academic_calendar_events (id, school_id, title, description, event_date, end_date, event_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        req.body.schoolId || req.user!.schoolId,
        req.body.title,
        req.body.description ?? null,
        req.body.eventDate,
        req.body.endDate ?? null,
        req.body.eventType || 'general',
      ]
    );
    res.status(201).json({ id });
  })
);

portalRouter.get(
  '/timetable',
  requireAuth,
  asyncHandler(async (req, res) => {
    const grade = req.query.grade as string;
    const section = req.query.section as string;
    const schoolId = (req.query.schoolId as string) || req.user!.schoolId;
    const { rows } = await query(
      `SELECT * FROM timetable_slots WHERE school_id = $1 AND grade = $2 AND section = $3 ORDER BY day_of_week, start_time`,
      [schoolId, grade, section]
    );
    res.json(rows);
  })
);

// CM-006: a teacher's own scheduled sessions, across every grade/section they teach —
// the real timetable, keyed by teacher_id rather than requiring the caller to already
// know which grade/section to ask for.
portalRouter.get(
  '/timetable/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user!.role !== 'teacher') {
      res.status(403).json({ error: 'Only teachers have a personal timetable' });
      return;
    }
    const { rows: tch } = await query('SELECT id FROM teachers WHERE LOWER(email) = LOWER($1)', [req.user!.email]);
    if (!tch.length) {
      res.json([]);
      return;
    }
    const { rows } = await query(
      `SELECT * FROM timetable_slots WHERE teacher_id = $1 ORDER BY day_of_week, start_time`,
      [tch[0].id]
    );
    res.json(rows);
  })
);

// School Head Staff Oversight (§27): real per-teacher weekly period counts from
// the actual timetable, not a fabricated workload figure — aggregated
// server-side so the frontend never has to fan out per class.
portalRouter.get(
  '/timetable/workload',
  requireAuth,
  requirePermission('hr.view_employees'),
  asyncHandler(async (req, res) => {
    const schoolId = (req.query.schoolId as string) || req.user!.schoolId;
    const { rows } = await query(
      `SELECT teacher_id AS "teacherId", teacher_name AS "teacherName", COUNT(*)::int AS "periodsPerWeek"
       FROM timetable_slots
       WHERE school_id = $1 AND teacher_id IS NOT NULL
       GROUP BY teacher_id, teacher_name
       ORDER BY "periodsPerWeek" DESC`,
      [schoolId]
    );
    res.json(rows);
  })
);

portalRouter.get(
  '/documents',
  requireAuth,
  asyncHandler(async (req, res) => {
    const studentId = req.query.studentId as string;
    const isStudent = req.user!.role === 'student';
    const { rows } = await query(
      `SELECT * FROM student_documents WHERE student_id = $1
       AND (${isStudent ? 'visible_to_student' : 'visible_to_parent'} = TRUE)
       ORDER BY uploaded_at DESC`,
      [studentId]
    );
    res.json(rows);
  })
);

portalRouter.get(
  '/grades',
  requireAuth,
  asyncHandler(async (req, res) => {
    const studentId = req.query.studentId as string;
    const publishedOnly = req.user!.role === 'parent' || req.user!.role === 'student';
    const { rows } = await query(
      publishedOnly
        ? `SELECT * FROM student_grade_entries WHERE student_id = $1 AND published = TRUE ORDER BY recorded_at DESC`
        : `SELECT * FROM student_grade_entries WHERE student_id = $1 ORDER BY recorded_at DESC`,
      [studentId]
    );
    res.json(rows);
  })
);

portalRouter.post(
  '/grades/:id/publish',
  requireAuth,
  requirePermission('grades.publish'),
  asyncHandler(async (req, res) => {
    await query(`UPDATE student_grade_entries SET published = $1 WHERE id = $2`, [
      req.body.published !== false,
      req.params.id,
    ]);
    res.json({ ok: true });
  })
);

portalRouter.get(
  '/attendance',
  requireAuth,
  asyncHandler(async (req, res) => {
    const studentId = req.query.studentId as string;
    const { rows } = await query(
      `SELECT * FROM attendance WHERE student_id = $1 ORDER BY date DESC LIMIT 90`,
      [studentId]
    );
    res.json(rows);
  })
);

portalRouter.get(
  '/practice-sets',
  requireAuth,
  asyncHandler(async (req, res) => {
    const grade = req.query.grade as string | undefined;
    const schoolId = (req.query.schoolId as string) || req.user!.schoolId;
    const manage =
      req.user!.role === 'teacher' ||
      req.user!.role === 'school-head' ||
      req.user!.role === 'department-head';
    const params: unknown[] = [schoolId];
    let sql = manage
      ? `SELECT * FROM practice_sets WHERE school_id = $1`
      : `SELECT * FROM practice_sets WHERE school_id = $1 AND published = TRUE`;
    if (grade) {
      params.push(grade);
      sql += ` AND grade = $${params.length}`;
    }
    sql += ' ORDER BY created_at DESC NULLS LAST, title';
    const { rows } = await query(sql, params);
    res.json(rows);
  })
);

portalRouter.post(
  '/practice-sets',
  requireAuth,
  requirePermission('practice.manage'),
  asyncHandler(async (req, res) => {
    const id = newId('pset');
    await query(
      `INSERT INTO practice_sets (id, school_id, teacher_id, title, subject, grade, section, published)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        req.body.schoolId || req.user!.schoolId,
        req.body.teacherId ?? null,
        req.body.title,
        req.body.subject,
        req.body.grade,
        req.body.section ?? null,
        Boolean(req.body.published),
      ]
    );
    const questionIds: string[] = req.body.questionIds ?? [];
    let order = 0;
    for (const qid of questionIds) {
      await query(
        `INSERT INTO practice_set_questions (practice_set_id, question_id, sort_order) VALUES ($1,$2,$3)`,
        [id, qid, order++]
      );
    }
    res.status(201).json({ id });
  })
);

portalRouter.post(
  '/question-bank',
  requireAuth,
  requirePermission('practice.manage'),
  asyncHandler(async (req, res) => {
    const id = newId('qb');
    await query(
      `INSERT INTO question_bank (id, school_id, teacher_id, subject, grade, question_text, question_type, options, correct_answer, difficulty)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        req.body.schoolId || req.user!.schoolId,
        req.body.teacherId ?? null,
        req.body.subject,
        req.body.grade,
        req.body.questionText,
        req.body.questionType || 'mcq',
        JSON.stringify(req.body.options ?? []),
        req.body.correctAnswer ?? null,
        req.body.difficulty || 'medium',
      ]
    );
    res.status(201).json({ id });
  })
);

portalRouter.get(
  '/question-bank',
  requireAuth,
  requirePermission('practice.manage'),
  asyncHandler(async (req, res) => {
    const schoolId = (req.query.schoolId as string) || req.user!.schoolId;
    const { rows } = await query(
      `SELECT * FROM question_bank WHERE school_id = $1 ORDER BY created_at DESC`,
      [schoolId]
    );
    res.json(rows);
  })
);

portalRouter.get(
  '/messages/threads',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    // CO-002: message_threads has no explicit "kind" column — a thread's counterpart
    // role is what actually distinguishes a parent conversation from a teacher-peer one
    // (both just use the same parent_user_id/staff_user_id pair). Resolve both parties'
    // roles so the frontend can filter Parent Messages vs Peer Messages instead of
    // showing every thread in both places.
    const { rows } = await query(
      `SELECT t.*,
              pu.role AS parent_user_role,
              su.role AS staff_user_role,
              CASE WHEN t.parent_user_id = $1 THEN su.role ELSE pu.role END AS counterpart_role
       FROM message_threads t
       LEFT JOIN portal_users pu ON pu.id = t.parent_user_id
       LEFT JOIN portal_users su ON su.id = t.staff_user_id
       WHERE t.parent_user_id = $1 OR t.staff_user_id = $1
       ORDER BY t.updated_at DESC`,
      [userId]
    );
    res.json(rows);
  })
);

portalRouter.post(
  '/messages/threads',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = newId('thr');
    await query(
      `INSERT INTO message_threads (id, school_id, student_id, parent_user_id, staff_user_id, staff_role, subject)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        req.body.schoolId || req.user!.schoolId,
        req.body.studentId ?? null,
        req.body.parentUserId || (req.user!.role === 'parent' ? req.user!.id : req.body.parentUserId),
        req.body.staffUserId ||
          (req.user!.role !== 'parent' && req.user!.role !== 'student' ? req.user!.id : req.body.staffUserId),
        req.body.staffRole || req.user!.role,
        req.body.subject || '',
      ]
    );
    if (req.body.body) {
      await query(
        `INSERT INTO thread_messages (id, thread_id, sender_user_id, sender_role, body) VALUES ($1,$2,$3,$4,$5)`,
        [newId('msg'), id, req.user!.id, req.user!.role, req.body.body]
      );
    }
    res.status(201).json({ id });
  })
);

portalRouter.get(
  '/messages/threads/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT * FROM thread_messages WHERE thread_id = $1 ORDER BY created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  })
);

portalRouter.post(
  '/messages/threads/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = newId('msg');
    await query(
      `INSERT INTO thread_messages (id, thread_id, sender_user_id, sender_role, body) VALUES ($1,$2,$3,$4,$5)`,
      [id, req.params.id, req.user!.id, req.user!.role, req.body.body]
    );
    await query(`UPDATE message_threads SET updated_at = NOW() WHERE id = $1`, [req.params.id]);
    res.status(201).json({ id });
  })
);

// FB-002/FB-003: this route only ever writes 'to_teacher' feedback (a teacher's own
// notes about a student/parent go through the separate /teacher-feedbacks route).
// author_role records the real evidence source and category — both derived from the
// caller's authenticated role (see lib/feedback.ts), never trusted from the client.
portalRouter.post(
  '/feedback',
  requireAuth,
  asyncHandler(async (req, res) => {
    const authorRole = resolveFeedbackAuthorRole(req.user!.role);
    if (!authorRole) {
      res.status(403).json({ error: 'Your role cannot give teacher feedback' });
      return;
    }
    const category = resolveFeedbackCategory(authorRole, req.body.category);
    const id = newId('tfb');
    await query(
      `INSERT INTO teacher_feedbacks (id, teacher_id, student_id, student_name, direction, author_name, author_role, category, subject, comment, rating, date)
       VALUES ($1,$2,$3,$4,'to_teacher',$5,$6,$7,$8,$9,$10,CURRENT_DATE)`,
      [
        id,
        req.body.teacherId,
        req.body.studentId ?? null,
        req.body.studentName ?? null,
        req.user!.displayName,
        authorRole,
        category,
        req.body.subject || 'General',
        req.body.comment,
        req.body.rating ?? null,
      ]
    );
    res.status(201).json({ id });
  })
);

portalRouter.get(
  '/contacts',
  requireAuth,
  asyncHandler(async (req, res) => {
    const schoolId = (req.query.schoolId as string) || req.user!.schoolId;
    const { rows: teachers } = await query(
      `SELECT t.id AS teacher_id, t.name, t.email, u.id AS user_id
       FROM teachers t
       LEFT JOIN portal_users u ON LOWER(u.email) = LOWER(t.email) AND u.role = 'teacher'
       WHERE ($1::text IS NULL OR t.school_id = $1)
       ORDER BY t.name`,
      [schoolId]
    );
    const { rows: parents } = await query(
      `SELECT id AS user_id, display_name, email
       FROM portal_users
       WHERE role = 'parent' AND ($1::text IS NULL OR school_id = $1)
       ORDER BY display_name`,
      [schoolId]
    );
    const { rows: heads } = await query(
      `SELECT id AS user_id, display_name, email, role
       FROM portal_users
       WHERE role = 'school-head' AND ($1::text IS NULL OR school_id = $1)
       ORDER BY display_name`,
      [schoolId]
    );
    res.json({
      teachers: teachers.map((t) => ({
        teacherId: t.teacher_id,
        userId: t.user_id,
        displayName: t.name,
        email: t.email,
        role: 'teacher',
      })),
      parents: parents.map((p) => ({
        userId: p.user_id,
        displayName: p.display_name,
        email: p.email,
        role: 'parent',
      })),
      schoolHeads: heads.map((h) => ({
        userId: h.user_id,
        displayName: h.display_name,
        email: h.email,
        role: h.role,
      })),
    });
  })
);

portalRouter.get(
  '/reenroll/campaigns',
  requireAuth,
  requirePermission('enrollment.view'),
  asyncHandler(async (req, res) => {
    const { listReenrollmentCampaigns } = await import('../services/reenroll.js');
    const schoolId = (req.query.schoolId as string) || req.user!.schoolId || 'sch-1';
    res.json(await listReenrollmentCampaigns(schoolId));
  })
);

portalRouter.post(
  '/reenroll/campaigns',
  requireAuth,
  requirePermission('enrollment.transfer'),
  asyncHandler(async (req, res) => {
    const { createReenrollmentCampaign } = await import('../services/reenroll.js');
    const result = await createReenrollmentCampaign({
      schoolId: req.body.schoolId || req.user!.schoolId || 'sch-1',
      title: req.body.title || 'Re-enrollment',
      targetGrade: req.body.targetGrade,
      dueDate: req.body.dueDate,
      createdBy: req.user!.id,
    });
    res.status(201).json(result);
  })
);

portalRouter.get(
  '/reenroll/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { listParentReenrollmentInvites } = await import('../services/reenroll.js');
    res.json(await listParentReenrollmentInvites(req.user!.id, req.user!.email));
  })
);

portalRouter.post(
  '/reenroll/invites/:id/respond',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { respondReenrollmentInvite } = await import('../services/reenroll.js');
    const status = req.body.status === 'declined' ? 'declined' : 'confirmed';
    res.json(
      await respondReenrollmentInvite(
        String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id),
        status,
        req.user!.id
      )
    );
  })
);
