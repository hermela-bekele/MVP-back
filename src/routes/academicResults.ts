import { Router, type Request, type Response } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requirePermission, enforceSchoolScope, type AuthUser } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';
import { newId } from '../lib/ids.js';
import { currentAcademicYear } from '../lib/academicYear.js';
import { computeOverallAverage, computeRankings, computeSubjectAverage } from '../services/academicResults.js';

export const academicResultsRouter = Router();

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: (err?: unknown) => void) => {
    fn(req, res).catch(next);
  };
}

// Grade entries predate a portal_users -> teachers link; resolve the same way the
// frontend does (AppContext.tsx) — by email match — falling back to the dev/demo teacher.
const DEMO_TEACHER_ID = 'tch-1';
async function resolveOwnTeacherId(user: AuthUser): Promise<string> {
  if (!user.email) return DEMO_TEACHER_ID;
  const { rows } = await query('SELECT id FROM teachers WHERE email = $1', [user.email]);
  return rows[0]?.id ?? DEMO_TEACHER_ID;
}

const ELEVATED_ROLES = new Set(['department-head', 'head-of-academics', 'school-head']);

const APPROVAL_WINDOW_HOURS = 48;

/** If an approved edit window expired without resubmit, restore the prior lock status. */
async function expireApprovedWindowsForScope(scope: {
  subject: string;
  gradeLevel: string;
  section: string;
  term: string;
  academicYear?: string;
}) {
  const params: unknown[] = [scope.subject, scope.gradeLevel, scope.section, scope.term];
  let yearClause = '';
  if (scope.academicYear) {
    params.push(scope.academicYear);
    yearClause = ` AND academic_year = $${params.length}`;
  }
  const { rows: expired } = await query(
    `SELECT * FROM result_change_requests
     WHERE subject = $1 AND grade_level = $2 AND section = $3 AND term = $4
       ${yearClause}
       AND status = 'approved'
       AND expires_at IS NOT NULL AND expires_at < NOW()`,
    params
  );
  for (const req of expired) {
    const restore = (req.previous_status as string) || 'submitted';
    await query(
      `UPDATE subject_term_results
       SET status = $1,
           submitted_at = CASE WHEN $1 = 'submitted' THEN COALESCE(submitted_at, NOW()) ELSE submitted_at END,
           finalized_at = CASE WHEN $1 = 'finalized' THEN COALESCE(finalized_at, NOW()) ELSE finalized_at END,
           updated_at = NOW()
       WHERE subject = $2 AND grade_level = $3 AND section = $4 AND academic_year = $5 AND term = $6
         AND status = 'draft'`,
      [restore, req.subject, req.grade_level, req.section, req.academic_year, req.term]
    );
    await query(
      `UPDATE result_change_requests SET status = 'expired', updated_at = NOW() WHERE id = $1`,
      [req.id]
    );
  }
}

/** Used by the /grade-entries write path (api.ts) to block edits once a subject/term is locked. */
export async function isSubjectTermLocked(scope: {
  studentId: string;
  subject: string;
  gradeLevel: string;
  section: string;
  term: string;
}): Promise<boolean> {
  await expireApprovedWindowsForScope({
    subject: scope.subject,
    gradeLevel: scope.gradeLevel,
    section: scope.section,
    term: scope.term,
  });
  const { rows } = await query(
    `SELECT status FROM subject_term_results
     WHERE student_id = $1 AND subject = $2 AND grade_level = $3 AND section = $4 AND term = $5
     ORDER BY academic_year DESC LIMIT 1`,
    [scope.studentId, scope.subject, scope.gradeLevel, scope.section, scope.term]
  );
  const status = rows[0]?.status;
  return status === 'submitted' || status === 'finalized';
}

function mapResultChangeRequest(row: Record<string, unknown>) {
  return {
    id: row.id,
    schoolId: row.school_id ?? null,
    teacherId: row.teacher_id,
    subject: row.subject,
    gradeLevel: row.grade_level,
    section: row.section,
    academicYear: row.academic_year,
    term: row.term,
    reason: row.reason,
    status: row.status,
    previousStatus: row.previous_status ?? null,
    source: row.source,
    reviewedBy: row.reviewed_by ?? null,
    reviewedAt: row.reviewed_at ?? null,
    reviewNote: row.review_note ?? null,
    expiresAt: row.expires_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    teacherName: row.teacher_name ?? undefined,
  };
}

async function unlockSubjectScope(opts: {
  subject: string;
  gradeLevel: string;
  section: string;
  academicYear: string;
  term: string;
}): Promise<{ unlocked: number; previousStatus: 'submitted' | 'finalized' | null }> {
  const { rows: sample } = await query(
    `SELECT status FROM subject_term_results
     WHERE subject = $1 AND grade_level = $2 AND section = $3 AND academic_year = $4 AND term = $5
       AND status IN ('submitted', 'finalized')
     LIMIT 1`,
    [opts.subject, opts.gradeLevel, opts.section, opts.academicYear, opts.term]
  );
  const previousStatus = (sample[0]?.status as 'submitted' | 'finalized' | undefined) ?? null;

  const { rows: unlocked } = await query(
    `UPDATE subject_term_results
     SET status = 'draft', submitted_at = NULL, submitted_by = NULL, finalized_at = NULL, finalized_by = NULL, updated_at = NOW()
     WHERE subject = $1 AND grade_level = $2 AND section = $3 AND academic_year = $4 AND term = $5
       AND status IN ('submitted', 'finalized')
     RETURNING id`,
    [opts.subject, opts.gradeLevel, opts.section, opts.academicYear, opts.term]
  );

  // Rankings are class/term-wide; clearing them when any subject is unlocked keeps report cards honest.
  if (previousStatus === 'finalized') {
    await query(
      `DELETE FROM student_term_summaries
       WHERE grade_level = $1 AND section = $2 AND academic_year = $3 AND term = $4`,
      [opts.gradeLevel, opts.section, opts.academicYear, opts.term]
    );
  }

  return { unlocked: unlocked.length, previousStatus };
}

function mapSubjectTermResult(row: Record<string, unknown>) {
  return {
    id: row.id,
    schoolId: row.school_id,
    studentId: row.student_id,
    teacherId: row.teacher_id,
    subject: row.subject,
    gradeLevel: row.grade_level,
    section: row.section,
    academicYear: row.academic_year,
    term: row.term,
    averagePercent: row.average_percent != null ? Number(row.average_percent) : null,
    letterGrade: row.letter_grade ?? null,
    remark: row.remark ?? null,
    status: row.status,
    submittedAt: row.submitted_at ?? null,
    submittedBy: row.submitted_by ?? null,
    finalizedAt: row.finalized_at ?? null,
    finalizedBy: row.finalized_by ?? null,
  };
}

function mapStudentTermSummary(row: Record<string, unknown>) {
  return {
    id: row.id,
    studentId: row.student_id,
    gradeLevel: row.grade_level,
    section: row.section,
    academicYear: row.academic_year,
    term: row.term,
    overallAverage: row.overall_average != null ? Number(row.overall_average) : null,
    rank: row.rank != null ? Number(row.rank) : null,
    rankPopulation: row.rank_population != null ? Number(row.rank_population) : null,
    conduct: row.conduct ?? null,
    promotionStatus: row.promotion_status ?? null,
    generalRemark: row.general_remark ?? null,
    finalizedAt: row.finalized_at,
    finalizedBy: row.finalized_by ?? null,
  };
}

function mapReportTemplate(row: Record<string, unknown>, activeId?: string | null) {
  return {
    id: row.id,
    schoolId: row.school_id ?? null,
    kind: row.kind,
    name: row.name,
    isSystem: row.is_system === true,
    isActive: activeId != null && row.id === activeId,
    basedOnTemplateId: row.based_on_template_id ?? null,
    config: row.config,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Submit / finalize / reopen
// ---------------------------------------------------------------------------

// POST /academic-results/submit  { subject, gradeLevel, section, term, academicYear?, teacherId? }
academicResultsRouter.post(
  '/submit',
  requireAuth,
  requirePermission('grades.enter'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const b = req.body as {
      subject?: string;
      gradeLevel?: string;
      section?: string;
      term?: string;
      academicYear?: string;
      teacherId?: string;
    };
    if (!b.subject || !b.gradeLevel || !b.section || !b.term) {
      res.status(400).json({ error: 'subject, gradeLevel, section and term are required' });
      return;
    }

    let teacherId: string;
    if (user.role === 'teacher') {
      teacherId = await resolveOwnTeacherId(user);
    } else if (ELEVATED_ROLES.has(user.role)) {
      if (!b.teacherId) {
        res.status(400).json({ error: 'teacherId is required when submitting on behalf of a teacher' });
        return;
      }
      teacherId = b.teacherId;
    } else {
      res.status(403).json({ error: 'Not authorized to submit results' });
      return;
    }

    const academicYear = b.academicYear || currentAcademicYear();
    const schoolId = (req.body.schoolId as string | undefined) ?? user.schoolId ?? null;

    const { rows: entries } = await query(
      `SELECT student_id, score, max_score, weight FROM student_grade_entries
       WHERE teacher_id = $1 AND subject = $2 AND grade_level = $3 AND section = $4 AND term = $5`,
      [teacherId, b.subject, b.gradeLevel, b.section, b.term]
    );

    if (entries.length === 0) {
      res.status(400).json({ error: 'No grade entries found for this subject/class/term' });
      return;
    }

    const byStudent = new Map<string, { score: number; maxScore: number; weight: number }[]>();
    for (const e of entries) {
      const list = byStudent.get(e.student_id as string) ?? [];
      list.push({ score: Number(e.score), maxScore: Number(e.max_score), weight: Number(e.weight) });
      byStudent.set(e.student_id as string, list);
    }

    // Refuse to touch anything already finalized unless the caller can finalize.
    const { rows: existingFinalized } = await query(
      `SELECT student_id FROM subject_term_results
       WHERE subject = $1 AND grade_level = $2 AND section = $3 AND academic_year = $4 AND term = $5 AND status = 'finalized'`,
      [b.subject, b.gradeLevel, b.section, academicYear, b.term]
    );
    if (existingFinalized.length > 0) {
      const canOverride = await import('../lib/permissions.js').then((m) =>
        m.userHasPermission(user.id, user.role, user.schoolId, 'grades.finalize')
      );
      if (!canOverride) {
        res.status(409).json({
          error: 'These results are already finalized. Request edit approval from your Academic Head before resubmitting.',
        });
        return;
      }
    }

    const results: unknown[] = [];
    for (const [studentId, studentEntries] of byStudent) {
      const average = computeSubjectAverage(studentEntries);
      const id = newId('str');
      const { rows } = await query(
        `INSERT INTO subject_term_results
           (id, school_id, student_id, teacher_id, subject, grade_level, section, academic_year, term,
            average_percent, status, submitted_at, submitted_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'submitted',NOW(),$11,NOW())
         ON CONFLICT (student_id, subject, grade_level, section, academic_year, term)
         DO UPDATE SET average_percent = EXCLUDED.average_percent, status = 'submitted',
           submitted_at = NOW(), submitted_by = EXCLUDED.submitted_by, teacher_id = EXCLUDED.teacher_id,
           updated_at = NOW()
         RETURNING *`,
        [id, schoolId, studentId, teacherId, b.subject, b.gradeLevel, b.section, academicYear, b.term, average, user.id]
      );
      results.push(mapSubjectTermResult(rows[0]));
    }

    // Any approved edit window for this scope is now consumed by the resubmit.
    await query(
      `UPDATE result_change_requests
       SET status = 'consumed', updated_at = NOW()
       WHERE teacher_id = $1 AND subject = $2 AND grade_level = $3 AND section = $4
         AND academic_year = $5 AND term = $6 AND status = 'approved'`,
      [teacherId, b.subject, b.gradeLevel, b.section, academicYear, b.term]
    );

    await writeAudit({
      schoolId,
      actorUserId: user.id,
      action: 'academic_results.submit',
      entityType: 'subject_term_results',
      metadata: { subject: b.subject, gradeLevel: b.gradeLevel, section: b.section, academicYear, term: b.term, studentCount: results.length },
    });

    res.status(201).json(results);
  })
);

// GET /academic-results/academic-years?schoolId=
// Every year the school has actually worked with — its configured academic calendars,
// unioned with any year that already has submitted/finalized results — so the dropdown
// this feeds is never empty just because a calendar was never published.
academicResultsRouter.get(
  '/academic-years',
  requireAuth,
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const schoolId = (req.query.schoolId as string) || req.user!.schoolId;
    if (!schoolId) {
      res.status(400).json({ error: 'schoolId is required' });
      return;
    }
    const { rows } = await query(
      `SELECT DISTINCT academic_year FROM (
         SELECT academic_year FROM academic_calendars WHERE school_id = $1
         UNION
         SELECT academic_year FROM subject_term_results WHERE school_id = $1
       ) t
       WHERE academic_year IS NOT NULL
       ORDER BY academic_year DESC`,
      [schoolId]
    );
    res.json(rows.map((r) => r.academic_year as string));
  })
);

// GET /academic-results/terms?schoolId=&academicYear=&gradeLevel=&section=
// All terms that have at least one submitted/finalized result in that academic year —
// scoped to grade+section when given — sorted chronologically by when they were first
// worked on.
academicResultsRouter.get(
  '/terms',
  requireAuth,
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const schoolId = (req.query.schoolId as string) || req.user!.schoolId;
    const academicYear = req.query.academicYear as string | undefined;
    if (!schoolId || !academicYear) {
      res.status(400).json({ error: 'schoolId and academicYear are required' });
      return;
    }
    const conditions = ['school_id = $1', 'academic_year = $2'];
    const params: unknown[] = [schoolId, academicYear];
    if (req.query.gradeLevel) {
      params.push(req.query.gradeLevel);
      conditions.push(`grade_level = $${params.length}`);
    }
    if (req.query.section) {
      params.push(req.query.section);
      conditions.push(`section = $${params.length}`);
    }
    const { rows } = await query(
      `SELECT term, MIN(COALESCE(finalized_at, submitted_at, updated_at)) AS sort_ts
       FROM subject_term_results
       WHERE ${conditions.join(' AND ')}
       GROUP BY term
       ORDER BY sort_ts ASC`,
      params
    );
    res.json(rows.map((r) => r.term as string));
  })
);

// GET /academic-results?academicYear=&gradeLevel=&section=&subject=&teacherId=&term=&studentId=&status=
academicResultsRouter.get(
  '/',
  requireAuth,
  requirePermission('reports.view'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (q.schoolId) {
      params.push(q.schoolId);
      conditions.push(`str.school_id = $${params.length}`);
    }
    for (const [param, col] of [
      ['academicYear', 'str.academic_year'],
      ['gradeLevel', 'str.grade_level'],
      ['section', 'str.section'],
      ['subject', 'str.subject'],
      ['teacherId', 'str.teacher_id'],
      ['term', 'str.term'],
      ['studentId', 'str.student_id'],
      ['status', 'str.status'],
    ] as const) {
      if (q[param]) {
        params.push(q[param]);
        conditions.push(`${col} = $${params.length}`);
      }
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await query(
      `SELECT str.*, s.name AS student_name, s.student_id AS student_number, t.name AS teacher_name
       FROM subject_term_results str
       LEFT JOIN students s ON s.id = str.student_id
       LEFT JOIN teachers t ON t.id = str.teacher_id
       ${where}
       ORDER BY s.name, str.subject`,
      params
    );

    const results = rows.map((r) => ({
      ...mapSubjectTermResult(r),
      studentName: r.student_name,
      studentNumber: r.student_number,
      teacherName: r.teacher_name,
    }));

    let missing: { studentId: string; studentName: string; subject: string }[] = [];
    if (q.gradeLevel && q.section && q.academicYear && q.term) {
      const { rows: roster } = await query(
        `SELECT id, name FROM students WHERE grade = $1 AND section = $2 ${q.schoolId ? 'AND school_id = $3' : ''}`,
        q.schoolId ? [q.gradeLevel, q.section, q.schoolId] : [q.gradeLevel, q.section]
      );
      const subjectsPresent = Array.from(new Set(results.map((r) => r.subject as string)));
      const haveResult = new Set(results.map((r) => `${r.studentId}::${r.subject}`));
      for (const student of roster) {
        for (const subject of subjectsPresent) {
          if (!haveResult.has(`${student.id}::${subject}`)) {
            missing.push({ studentId: student.id, studentName: student.name, subject });
          }
        }
      }
    }

    res.json({ results, missing });
  })
);

// POST /academic-results/finalize  { gradeLevel, section, academicYear, term }
academicResultsRouter.post(
  '/finalize',
  requireAuth,
  requirePermission('grades.finalize'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const b = req.body as { gradeLevel?: string; section?: string; academicYear?: string; term?: string };
    if (!b.gradeLevel || !b.section || !b.academicYear || !b.term) {
      res.status(400).json({ error: 'gradeLevel, section, academicYear and term are required' });
      return;
    }
    const schoolId = (req.body.schoolId as string | undefined) ?? user.schoolId ?? null;

    const { rows: submitted } = await query(
      `UPDATE subject_term_results
       SET status = 'finalized', finalized_at = NOW(), finalized_by = $1, updated_at = NOW()
       WHERE grade_level = $2 AND section = $3 AND academic_year = $4 AND term = $5 AND status = 'submitted'
       RETURNING *`,
      [user.id, b.gradeLevel, b.section, b.academicYear, b.term]
    );

    const { rows: allFinalized } = await query(
      `SELECT student_id, average_percent FROM subject_term_results
       WHERE grade_level = $1 AND section = $2 AND academic_year = $3 AND term = $4 AND status = 'finalized'`,
      [b.gradeLevel, b.section, b.academicYear, b.term]
    );

    const byStudent = new Map<string, number[]>();
    for (const r of allFinalized) {
      const list = byStudent.get(r.student_id as string) ?? [];
      if (r.average_percent != null) list.push(Number(r.average_percent));
      byStudent.set(r.student_id as string, list);
    }

    const overallByStudent = Array.from(byStudent.entries()).map(([studentId, averages]) => ({
      id: studentId,
      average: computeOverallAverage(averages),
    }));
    const rankings = computeRankings(overallByStudent);

    const summaries: unknown[] = [];
    for (const r of rankings) {
      const id = newId('sts');
      const { rows } = await query(
        `INSERT INTO student_term_summaries
           (id, school_id, student_id, grade_level, section, academic_year, term, overall_average, rank, rank_population, finalized_at, finalized_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),$11)
         ON CONFLICT (student_id, grade_level, section, academic_year, term)
         DO UPDATE SET overall_average = EXCLUDED.overall_average, rank = EXCLUDED.rank,
           rank_population = EXCLUDED.rank_population, finalized_at = NOW(), finalized_by = EXCLUDED.finalized_by
         RETURNING *`,
        [id, schoolId, r.id, b.gradeLevel, b.section, b.academicYear, b.term, r.average, r.rank, r.population, user.id]
      );
      summaries.push(mapStudentTermSummary(rows[0]));
    }

    await writeAudit({
      schoolId,
      actorUserId: user.id,
      action: 'academic_results.finalize',
      entityType: 'student_term_summaries',
      metadata: { gradeLevel: b.gradeLevel, section: b.section, academicYear: b.academicYear, term: b.term, subjectResultsFinalized: submitted.length, studentsRanked: summaries.length },
    });

    res.json({ subjectResults: submitted.map(mapSubjectTermResult), summaries });
  })
);

// POST /academic-results/reopen  { gradeLevel, section, academicYear, term, reason?, subject? }
// Emergency Academic Head unlock. Prefer change-request approve for the normal path.
academicResultsRouter.post(
  '/reopen',
  requireAuth,
  requirePermission('grades.finalize'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const b = req.body as {
      gradeLevel?: string;
      section?: string;
      academicYear?: string;
      term?: string;
      reason?: string;
      subject?: string;
    };
    if (!b.gradeLevel || !b.section || !b.academicYear || !b.term) {
      res.status(400).json({ error: 'gradeLevel, section, academicYear and term are required' });
      return;
    }
    if (!b.reason || !String(b.reason).trim()) {
      res.status(400).json({ error: 'reason is required for emergency unlock' });
      return;
    }
    const schoolId = (req.body.schoolId as string | undefined) ?? user.schoolId ?? null;

    const subjectFilter = b.subject ? ' AND subject = $5' : '';
    const params: unknown[] = [b.gradeLevel, b.section, b.academicYear, b.term];
    if (b.subject) params.push(b.subject);

    const { rows: lockedRows } = await query(
      `SELECT DISTINCT subject, teacher_id FROM subject_term_results
       WHERE grade_level = $1 AND section = $2 AND academic_year = $3 AND term = $4
         AND status IN ('submitted', 'finalized')${subjectFilter}`,
      params
    );

    const { rows: reopened } = await query(
      `UPDATE subject_term_results
       SET status = 'draft', submitted_at = NULL, submitted_by = NULL, finalized_at = NULL, finalized_by = NULL, updated_at = NOW()
       WHERE grade_level = $1 AND section = $2 AND academic_year = $3 AND term = $4
         AND status IN ('submitted', 'finalized')${subjectFilter}
       RETURNING *`,
      params
    );
    await query(
      `DELETE FROM student_term_summaries WHERE grade_level = $1 AND section = $2 AND academic_year = $3 AND term = $4`,
      [b.gradeLevel, b.section, b.academicYear, b.term]
    );

    const expiresAt = new Date(Date.now() + APPROVAL_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    for (const row of lockedRows) {
      const id = newId('rcr');
      await query(
        `INSERT INTO result_change_requests
           (id, school_id, teacher_id, subject, grade_level, section, academic_year, term, reason, status,
            previous_status, source, reviewed_by, reviewed_at, review_note, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'approved',$10,'academic_head_direct',$11,NOW(),$12,$13)`,
        [
          id,
          schoolId,
          row.teacher_id ?? 'tch-1',
          row.subject,
          b.gradeLevel,
          b.section,
          b.academicYear,
          b.term,
          String(b.reason).trim(),
          'finalized',
          user.id,
          'Emergency unlock by Academic Head',
          expiresAt,
        ]
      );
    }

    await writeAudit({
      schoolId,
      actorUserId: user.id,
      action: 'academic_results.reopen',
      entityType: 'subject_term_results',
      metadata: {
        gradeLevel: b.gradeLevel,
        section: b.section,
        academicYear: b.academicYear,
        term: b.term,
        subject: b.subject ?? null,
        reason: b.reason,
        count: reopened.length,
      },
    });

    res.json({ reopened: reopened.map(mapSubjectTermResult) });
  })
);

// ---------------------------------------------------------------------------
// Result change requests (teacher → Academic Head)
// ---------------------------------------------------------------------------

academicResultsRouter.post(
  '/change-requests',
  requireAuth,
  requirePermission('grades.enter'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const b = req.body as {
      subject?: string;
      gradeLevel?: string;
      section?: string;
      term?: string;
      academicYear?: string;
      reason?: string;
      teacherId?: string;
    };
    if (!b.subject || !b.gradeLevel || !b.section || !b.term || !b.reason?.trim()) {
      res.status(400).json({ error: 'subject, gradeLevel, section, term and reason are required' });
      return;
    }

    let teacherId: string;
    if (user.role === 'teacher') {
      teacherId = await resolveOwnTeacherId(user);
    } else if (ELEVATED_ROLES.has(user.role) && b.teacherId) {
      teacherId = b.teacherId;
    } else {
      res.status(403).json({ error: 'Only the subject teacher can request edit approval' });
      return;
    }

    const academicYear = b.academicYear || currentAcademicYear();
    const schoolId = (req.body.schoolId as string | undefined) ?? user.schoolId ?? null;

    const { rows: locked } = await query(
      `SELECT status FROM subject_term_results
       WHERE teacher_id = $1 AND subject = $2 AND grade_level = $3 AND section = $4
         AND academic_year = $5 AND term = $6 AND status IN ('submitted', 'finalized')
       LIMIT 1`,
      [teacherId, b.subject, b.gradeLevel, b.section, academicYear, b.term]
    );
    if (!locked.length) {
      res.status(400).json({ error: 'No submitted or finalized results found for this scope' });
      return;
    }

    const { rows: existingPending } = await query(
      `SELECT id FROM result_change_requests
       WHERE teacher_id = $1 AND subject = $2 AND grade_level = $3 AND section = $4
         AND academic_year = $5 AND term = $6 AND status IN ('pending', 'approved')
       LIMIT 1`,
      [teacherId, b.subject, b.gradeLevel, b.section, academicYear, b.term]
    );
    if (existingPending.length) {
      res.status(409).json({ error: 'An open change request already exists for this subject/term' });
      return;
    }

    const id = newId('rcr');
    const { rows } = await query(
      `INSERT INTO result_change_requests
         (id, school_id, teacher_id, subject, grade_level, section, academic_year, term, reason, status, previous_status, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,'teacher')
       RETURNING *`,
      [
        id,
        schoolId,
        teacherId,
        b.subject,
        b.gradeLevel,
        b.section,
        academicYear,
        b.term,
        b.reason.trim(),
        locked[0].status,
      ]
    );

    await writeAudit({
      schoolId,
      actorUserId: user.id,
      action: 'academic_results.change_request.create',
      entityType: 'result_change_requests',
      entityId: id,
      metadata: { subject: b.subject, gradeLevel: b.gradeLevel, section: b.section, term: b.term },
    });

    res.status(201).json(mapResultChangeRequest(rows[0]));
  })
);

academicResultsRouter.get(
  '/change-requests',
  requireAuth,
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const q = req.query as Record<string, string | undefined>;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (user.role === 'teacher') {
      const teacherId = await resolveOwnTeacherId(user);
      params.push(teacherId);
      conditions.push(`r.teacher_id = $${params.length}`);
    } else {
      const canReview = await import('../lib/permissions.js').then((m) =>
        m.userHasPermission(user.id, user.role, user.schoolId, 'grades.finalize')
      );
      if (!canReview) {
        res.status(403).json({ error: 'Not authorized to list change requests' });
        return;
      }
      const schoolId = q.schoolId || user.schoolId;
      if (schoolId) {
        params.push(schoolId);
        conditions.push(`r.school_id = $${params.length}`);
      }
    }

    if (q.status) {
      params.push(q.status);
      conditions.push(`r.status = $${params.length}`);
    }
    if (q.subject) {
      params.push(q.subject);
      conditions.push(`r.subject = $${params.length}`);
    }
    if (q.gradeLevel) {
      params.push(q.gradeLevel);
      conditions.push(`r.grade_level = $${params.length}`);
    }
    if (q.section) {
      params.push(q.section);
      conditions.push(`r.section = $${params.length}`);
    }
    if (q.term) {
      params.push(q.term);
      conditions.push(`r.term = $${params.length}`);
    }
    if (q.academicYear) {
      params.push(q.academicYear);
      conditions.push(`r.academic_year = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT r.*, t.name AS teacher_name
       FROM result_change_requests r
       LEFT JOIN teachers t ON t.id = r.teacher_id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT 200`,
      params
    );
    res.json(rows.map(mapResultChangeRequest));
  })
);

academicResultsRouter.post(
  '/change-requests/:id/approve',
  requireAuth,
  requirePermission('grades.finalize'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const note = typeof req.body?.reviewNote === 'string' ? req.body.reviewNote.trim() : null;

    const { rows: existing } = await query('SELECT * FROM result_change_requests WHERE id = $1', [req.params.id]);
    if (!existing.length) {
      res.status(404).json({ error: 'Change request not found' });
      return;
    }
    const reqRow = existing[0];
    if (reqRow.status !== 'pending') {
      res.status(409).json({ error: `Request is already ${reqRow.status}` });
      return;
    }

    const unlock = await unlockSubjectScope({
      subject: reqRow.subject as string,
      gradeLevel: reqRow.grade_level as string,
      section: reqRow.section as string,
      academicYear: reqRow.academic_year as string,
      term: reqRow.term as string,
    });

    const expiresAt = new Date(Date.now() + APPROVAL_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    const { rows } = await query(
      `UPDATE result_change_requests
       SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(), review_note = $2,
           expires_at = $3, previous_status = COALESCE(previous_status, $4), updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [user.id, note, expiresAt, unlock.previousStatus, req.params.id]
    );

    await writeAudit({
      schoolId: (reqRow.school_id as string) ?? user.schoolId ?? null,
      actorUserId: user.id,
      action: 'academic_results.change_request.approve',
      entityType: 'result_change_requests',
      entityId: req.params.id as string,
      metadata: { unlocked: unlock.unlocked, expiresAt },
    });

    res.json(mapResultChangeRequest(rows[0]));
  })
);

academicResultsRouter.post(
  '/change-requests/:id/reject',
  requireAuth,
  requirePermission('grades.finalize'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const note = typeof req.body?.reviewNote === 'string' ? req.body.reviewNote.trim() : null;

    const { rows: existing } = await query('SELECT * FROM result_change_requests WHERE id = $1', [req.params.id]);
    if (!existing.length) {
      res.status(404).json({ error: 'Change request not found' });
      return;
    }
    if (existing[0].status !== 'pending') {
      res.status(409).json({ error: `Request is already ${existing[0].status}` });
      return;
    }

    const { rows } = await query(
      `UPDATE result_change_requests
       SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), review_note = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [user.id, note, req.params.id]
    );

    await writeAudit({
      schoolId: (existing[0].school_id as string) ?? user.schoolId ?? null,
      actorUserId: user.id,
      action: 'academic_results.change_request.reject',
      entityType: 'result_change_requests',
      entityId: req.params.id as string,
    });

    res.json(mapResultChangeRequest(rows[0]));
  })
);

// ---------------------------------------------------------------------------
// Report card / transcript assembly
// ---------------------------------------------------------------------------

// GET /academic-results/report-card?studentId=&academicYear=&term=
academicResultsRouter.get(
  '/report-card',
  requireAuth,
  requirePermission('reports.generate'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const studentId = req.query.studentId as string;
    const academicYear = (req.query.academicYear as string) || currentAcademicYear();
    const term = req.query.term as string;
    if (!studentId || !term) {
      res.status(400).json({ error: 'studentId and term are required' });
      return;
    }

    const { rows: studentRows } = await query('SELECT * FROM students WHERE id = $1', [studentId]);
    const student = studentRows[0];
    if (!student) {
      res.status(404).json({ error: 'Student not found' });
      return;
    }

    if (term === 'ANNUAL') {
      const gradeLevel = (req.query.gradeLevel as string) || student.grade;
      const section = (req.query.section as string) || student.section;
      const { rows } = await query(
        `SELECT * FROM subject_term_results
         WHERE student_id = $1 AND grade_level = $2 AND section = $3 AND academic_year = $4 AND status = 'finalized'`,
        [studentId, gradeLevel, section, academicYear]
      );
      const bySubject = new Map<string, number[]>();
      for (const r of rows) {
        if (r.average_percent == null) continue;
        const list = bySubject.get(r.subject as string) ?? [];
        list.push(Number(r.average_percent));
        bySubject.set(r.subject as string, list);
      }
      const subjects = Array.from(bySubject.entries())
        .map(([subject, averages]) => ({ subject, averagePercent: computeOverallAverage(averages) }))
        .sort((a, b) => a.subject.localeCompare(b.subject));
      const overallAverage = computeOverallAverage(subjects.map((s) => s.averagePercent));

      // Annual rank among peers in the same grade+section+year, using the same aggregation.
      const { rows: peerRows } = await query(
        `SELECT student_id, subject, average_percent FROM subject_term_results
         WHERE grade_level = $1 AND section = $2 AND academic_year = $3 AND status = 'finalized'`,
        [gradeLevel, section, academicYear]
      );
      const peerBySubject = new Map<string, Map<string, number[]>>();
      for (const r of peerRows) {
        const sid = r.student_id as string;
        const perSubject = peerBySubject.get(sid) ?? new Map<string, number[]>();
        if (r.average_percent != null) {
          const list = perSubject.get(r.subject as string) ?? [];
          list.push(Number(r.average_percent));
          perSubject.set(r.subject as string, list);
        }
        peerBySubject.set(sid, perSubject);
      }
      const peerOveralls = Array.from(peerBySubject.entries()).map(([sid, subjMap]) => ({
        id: sid,
        average: computeOverallAverage(Array.from(subjMap.values()).map((v) => computeOverallAverage(v))),
      }));
      const rankings = computeRankings(peerOveralls);
      const mine = rankings.find((r) => r.id === studentId);

      res.json({
        kind: 'report-card',
        term: 'ANNUAL',
        academicYear,
        student: { id: student.id, name: student.name, studentId: student.student_id, grade: student.grade, section: student.section, parentName: student.parent_name },
        subjects,
        overallAverage,
        rank: mine?.rank ?? null,
        rankPopulation: mine?.population ?? null,
        attendanceRate: student.attendance_rate != null ? Number(student.attendance_rate) : null,
        conduct: null,
        promotionStatus: null,
        generalRemark: null,
      });
      return;
    }

    const { rows: subjectRows } = await query(
      `SELECT * FROM subject_term_results WHERE student_id = $1 AND academic_year = $2 AND term = $3 AND status = 'finalized' ORDER BY subject`,
      [studentId, academicYear, term]
    );
    const { rows: summaryRows } = await query(
      `SELECT * FROM student_term_summaries WHERE student_id = $1 AND academic_year = $2 AND term = $3`,
      [studentId, academicYear, term]
    );
    const summary = summaryRows[0];

    res.json({
      kind: 'report-card',
      term,
      academicYear,
      student: { id: student.id, name: student.name, studentId: student.student_id, grade: student.grade, section: student.section, parentName: student.parent_name },
      subjects: subjectRows.map((r) => ({ subject: r.subject, averagePercent: r.average_percent != null ? Number(r.average_percent) : null, remark: r.remark ?? null })),
      overallAverage: summary?.overall_average != null ? Number(summary.overall_average) : null,
      rank: summary?.rank ?? null,
      rankPopulation: summary?.rank_population ?? null,
      attendanceRate: student.attendance_rate != null ? Number(student.attendance_rate) : null,
      conduct: summary?.conduct ?? null,
      promotionStatus: summary?.promotion_status ?? null,
      generalRemark: summary?.general_remark ?? null,
    });
  })
);

// GET /academic-results/transcript?studentId=&fromGrade=&toGrade=
academicResultsRouter.get(
  '/transcript',
  requireAuth,
  requirePermission('reports.generate'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const studentId = req.query.studentId as string;
    const fromGrade = req.query.fromGrade as string;
    const toGrade = req.query.toGrade as string;
    if (!studentId || !fromGrade || !toGrade) {
      res.status(400).json({ error: 'studentId, fromGrade and toGrade are required' });
      return;
    }
    const gradeNum = (g: string) => Number((g.match(/\d+/) || ['0'])[0]);
    const fromNum = gradeNum(fromGrade);
    const toNum = gradeNum(toGrade);

    const { rows: studentRows } = await query('SELECT * FROM students WHERE id = $1', [studentId]);
    const student = studentRows[0];
    if (!student) {
      res.status(404).json({ error: 'Student not found' });
      return;
    }

    const { rows: allResults } = await query(
      `SELECT * FROM subject_term_results WHERE student_id = $1 AND status = 'finalized'`,
      [studentId]
    );
    const gradeLevels = Array.from(new Set(allResults.map((r) => r.grade_level as string)))
      .filter((g) => {
        const n = gradeNum(g);
        return n >= fromNum && n <= toNum;
      })
      .sort((a, b) => gradeNum(a) - gradeNum(b));

    const { rows: enrollmentRows } = await query(
      `SELECT grade, section, academic_year FROM enrollments WHERE student_id = $1`,
      [studentId]
    );

    const grades: unknown[] = [];
    for (const gradeLevel of gradeLevels) {
      const rowsForGrade = allResults.filter((r) => r.grade_level === gradeLevel);
      const section = rowsForGrade[0]?.section as string | undefined;
      const enrollment = enrollmentRows.find((e) => e.grade === gradeLevel);
      const academicYear = enrollment?.academic_year ?? (rowsForGrade[0]?.academic_year as string | undefined) ?? null;

      const byTerm = new Map<string, typeof rowsForGrade>();
      for (const r of rowsForGrade) {
        const list = byTerm.get(r.term as string) ?? [];
        list.push(r);
        byTerm.set(r.term as string, list);
      }
      const termTimestamp = (rows: typeof rowsForGrade) => {
        const value = rows[0]?.finalized_at as Date | string | null | undefined;
        if (!value) return 0;
        return value instanceof Date ? value.getTime() : new Date(value).getTime();
      };
      const terms = Array.from(byTerm.entries())
        .sort((a, b) => termTimestamp(a[1]) - termTimestamp(b[1]))
        .map(([term, termRows]) => ({
          term,
          subjects: termRows
            .map((r) => ({ subject: r.subject, averagePercent: r.average_percent != null ? Number(r.average_percent) : null }))
            .sort((a, b) => a.subject.localeCompare(b.subject)),
          termAveragePercent: computeOverallAverage(termRows.map((r) => (r.average_percent != null ? Number(r.average_percent) : null))),
        }));
      const yearAverage = computeOverallAverage(terms.map((t) => t.termAveragePercent));

      const { rows: summaryRows } = await query(
        `SELECT rank, rank_population FROM student_term_summaries
         WHERE student_id = $1 AND grade_level = $2 ${section ? 'AND section = $3' : ''}
         ORDER BY finalized_at DESC LIMIT 1`,
        section ? [studentId, gradeLevel, section] : [studentId, gradeLevel]
      );

      grades.push({
        gradeLevel,
        academicYear,
        section: section ?? null,
        terms,
        yearAverage,
        rank: summaryRows[0]?.rank ?? null,
        rankPopulation: summaryRows[0]?.rank_population ?? null,
      });
    }

    res.json({
      kind: 'transcript',
      student: { id: student.id, name: student.name, studentId: student.student_id, grade: student.grade, section: student.section, parentName: student.parent_name },
      fromGrade,
      toGrade,
      grades,
    });
  })
);

// ---------------------------------------------------------------------------
// Report templates
// ---------------------------------------------------------------------------

async function resolveActiveTemplateIds(schoolId: string): Promise<{ reportCard: string | null; transcript: string | null }> {
  const { rows } = await query(
    `SELECT active_report_card_template_id, active_transcript_template_id, report_card_template
     FROM school_settings WHERE school_id = $1`,
    [schoolId]
  );
  const settings = rows[0];
  if (!settings) return { reportCard: null, transcript: null };

  let reportCard = settings.active_report_card_template_id as string | null;
  let transcript = settings.active_transcript_template_id as string | null;

  // Lazily migrate a school that only ever saved the legacy single-blob template.
  const legacy = settings.report_card_template as { reportCard?: unknown; transcript?: unknown } | null;
  if (!reportCard && legacy?.reportCard) {
    const id = newId('tpl');
    await query(
      `INSERT INTO report_templates (id, school_id, kind, name, is_system, config) VALUES ($1,$2,'report_card',$3,FALSE,$4)`,
      [id, schoolId, 'Custom Report Card', JSON.stringify(legacy.reportCard)]
    );
    await query(`UPDATE school_settings SET active_report_card_template_id = $1 WHERE school_id = $2`, [id, schoolId]);
    reportCard = id;
  }
  if (!transcript && legacy?.transcript) {
    const id = newId('tpl');
    await query(
      `INSERT INTO report_templates (id, school_id, kind, name, is_system, config) VALUES ($1,$2,'transcript',$3,FALSE,$4)`,
      [id, schoolId, 'Custom Transcript', JSON.stringify(legacy.transcript)]
    );
    await query(`UPDATE school_settings SET active_transcript_template_id = $1 WHERE school_id = $2`, [id, schoolId]);
    transcript = id;
  }

  return { reportCard, transcript };
}

// GET /academic-results/report-templates?kind=report_card|transcript
academicResultsRouter.get(
  '/report-templates',
  requireAuth,
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const kind = req.query.kind as string | undefined;
    const schoolId = (req.query.schoolId as string) || req.user!.schoolId;
    if (!schoolId) {
      res.status(400).json({ error: 'schoolId is required' });
      return;
    }
    const active = await resolveActiveTemplateIds(schoolId);
    const params: unknown[] = [schoolId];
    let kindFilter = '';
    if (kind) {
      params.push(kind);
      kindFilter = `AND kind = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT * FROM report_templates WHERE (school_id IS NULL OR school_id = $1) ${kindFilter} ORDER BY is_system DESC, name`,
      params
    );
    res.json(
      rows.map((r) =>
        mapReportTemplate(r, r.kind === 'report_card' ? active.reportCard ?? findDefaultSystemId(rows, 'report_card') : active.transcript ?? findDefaultSystemId(rows, 'transcript'))
      )
    );
  })
);

function findDefaultSystemId(rows: Record<string, unknown>[], kind: string): string | null {
  return (rows.find((r) => r.kind === kind && r.is_system === true)?.id as string) ?? null;
}

// GET /academic-results/report-templates/active?kind=report_card|transcript
academicResultsRouter.get(
  '/report-templates/active',
  requireAuth,
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const kind = req.query.kind as string;
    const schoolId = (req.query.schoolId as string) || req.user!.schoolId;
    if (!schoolId || (kind !== 'report_card' && kind !== 'transcript')) {
      res.status(400).json({ error: 'schoolId and a valid kind are required' });
      return;
    }
    const active = await resolveActiveTemplateIds(schoolId);
    const activeId = kind === 'report_card' ? active.reportCard : active.transcript;
    const { rows } = await query(
      `SELECT * FROM report_templates WHERE id = COALESCE($1, (SELECT id FROM report_templates WHERE school_id IS NULL AND kind = $2 AND is_system = TRUE LIMIT 1))`,
      [activeId, kind]
    );
    if (!rows[0]) {
      res.status(404).json({ error: 'No template available' });
      return;
    }
    res.json(mapReportTemplate(rows[0], rows[0].id));
  })
);

// POST /academic-results/report-templates/:id/duplicate  { name? }
academicResultsRouter.post(
  '/report-templates/:id/duplicate',
  requireAuth,
  requirePermission('school.settings'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const schoolId = (req.body.schoolId as string) || req.user!.schoolId;
    const { rows: sourceRows } = await query(
      `SELECT * FROM report_templates WHERE id = $1 AND (school_id IS NULL OR school_id = $2)`,
      [req.params.id, schoolId]
    );
    const source = sourceRows[0];
    if (!source) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    const id = newId('tpl');
    const name = (req.body.name as string) || `${source.name} (Copy)`;
    const { rows } = await query(
      `INSERT INTO report_templates (id, school_id, kind, name, is_system, based_on_template_id, config)
       VALUES ($1,$2,$3,$4,FALSE,$5,$6) RETURNING *`,
      [id, schoolId, source.kind, name, source.id, source.config]
    );
    res.status(201).json(mapReportTemplate(rows[0]));
  })
);

// PUT /academic-results/report-templates/:id  { name?, config? }
academicResultsRouter.put(
  '/report-templates/:id',
  requireAuth,
  requirePermission('school.settings'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const schoolId = (req.body.schoolId as string) || req.user!.schoolId;
    const { rows: existingRows } = await query(`SELECT * FROM report_templates WHERE id = $1 AND school_id = $2`, [req.params.id, schoolId]);
    const existing = existingRows[0];
    if (!existing) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    if (existing.is_system) {
      res.status(403).json({ error: 'System templates cannot be edited directly — duplicate it first' });
      return;
    }
    const name = (req.body.name as string) ?? existing.name;
    const config = req.body.config ?? existing.config;
    const { rows } = await query(
      `UPDATE report_templates SET name = $1, config = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
      [name, config, existing.id]
    );
    res.json(mapReportTemplate(rows[0]));
  })
);

// POST /academic-results/report-templates/:id/activate
academicResultsRouter.post(
  '/report-templates/:id/activate',
  requireAuth,
  requirePermission('school.settings'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const schoolId = (req.body.schoolId as string) || req.user!.schoolId;
    const { rows } = await query(`SELECT * FROM report_templates WHERE id = $1 AND (school_id IS NULL OR school_id = $2)`, [req.params.id, schoolId]);
    const template = rows[0];
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    const column = template.kind === 'report_card' ? 'active_report_card_template_id' : 'active_transcript_template_id';
    await query(
      `INSERT INTO school_settings (school_id, ${column}) VALUES ($1, $2)
       ON CONFLICT (school_id) DO UPDATE SET ${column} = EXCLUDED.${column}`,
      [schoolId, template.id]
    );
    res.json({ ok: true });
  })
);
