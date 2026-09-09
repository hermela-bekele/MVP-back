import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db/pool.js';
import { loadBootstrap } from '../db/bootstrap.js';
import { isPrivilegedStaff } from '../lib/roles.js';
import { isTrainingAssignmentComplete, nextTrainingAssignmentStatus } from '../lib/training.js';
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
  mapTrainingPlan,
  mapTrainingPlanAssignment,
  mapSchoolCheckIn,
  mapAcademicCalendar,
  mapLessonDelivery,
  mapCommunityPost,
  mapCommunityReply,
  mapStaffMessage,
  mapCommunity,
  mapCommunityMember,
  mapCommunityChannel,
  mapCommunityThread,
  mapCommunityMessage,
  mapMentionNotification,
  mapTeacherSelfAssessment,
  mapTeacherTrainingAssignment,
  mapTeacherLessonAdjustment,
} from '../lib/serialize.js';
import { resourceUpload } from '../lib/uploads.js';
import { admissionsRouter } from './admissions.js';
import { billingRouter } from './billing.js';
import { permissionsRouter } from './permissions.js';
import { portalRouter } from './portal.js';
import { communityRouter } from './community.js';
import { registrarRouter } from './registrar.js';
import { hrRouter } from './hr.js';
import { financeRouter } from './finance.js';
import { budgetRouter } from './budget.js';
import { expensesRouter } from './expenses.js';
import { payablesRouter } from './payables.js';
import { academicResultsRouter, isSubjectTermLocked } from './academicResults.js';
import { attachPermissions, optionalAuth, requireAuth, requirePermission } from '../middleware/auth.js';
import { signAccessToken } from '../lib/tokens.js';
import { writeAudit } from '../lib/audit.js';
import { rateLimit } from '../lib/rateLimit.js';
import { runBillingJobs } from '../services/jobs.js';
import { currentAcademicYear } from '../lib/academicYear.js';
import {
  ensureCommunitiesSeeded,
  ensureDefaultChannels,
} from '../lib/communitySeed.js';

export const apiRouter = Router();

apiRouter.use('/admissions', admissionsRouter);
apiRouter.use('/billing', billingRouter);
apiRouter.use('/permissions', permissionsRouter);
apiRouter.use('/portal', portalRouter);
apiRouter.use('/registrar', registrarRouter);
apiRouter.use('/hr', hrRouter);
apiRouter.use('/finance', financeRouter);
apiRouter.use('/finance', budgetRouter);
apiRouter.use('/finance', expensesRouter);
apiRouter.use('/finance', payablesRouter);
apiRouter.use('/academic-results', academicResultsRouter);
apiRouter.use(communityRouter);

apiRouter.post('/jobs/billing', async (_req, res, next) => {
  try {
    res.json(await runBillingJobs());
  } catch (err) {
    next(err);
  }
});

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
  type: string,
  linkPath?: string | null
) {
  const id = `not-gen-${Date.now()}`;
  await query(
    `INSERT INTO notifications (id, title, description, timestamp_label, read, type, link_path) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, title, description, 'Just now', false, type, linkPath ?? null]
  );
  const { rows } = await query('SELECT * FROM notifications WHERE id = $1', [id]);
  return mapNotification(rows[0]);
}

async function getRequestUser(
  req: Request
): Promise<{ id: string; displayName: string; role: string } | null> {
  const userId = String(req.headers['x-user-id'] || '');
  if (!userId) return null;
  const { rows } = await query(
    'SELECT id, display_name, role FROM portal_users WHERE id = $1',
    [userId]
  );
  if (!rows.length) return null;
  return {
    id: rows[0].id as string,
    displayName: rows[0].display_name as string,
    role: rows[0].role as string,
  };
}

/** Teacher <-> portal_user linkage is by email (see routes/portal.ts); there is no
 * teacher_id column on portal_users. */
async function resolveOwnTeacherId(user: { role: string; email: string }): Promise<string | null> {
  const { rows } = await query('SELECT id FROM teachers WHERE LOWER(email) = LOWER($1)', [user.email]);
  return (rows[0]?.id as string | undefined) ?? null;
}

/** For self-service actions (a teacher recording their own delivery, resource, feedback,
 * etc.) — never trusts a client-supplied teacherId, always resolves it from the
 * authenticated session. */
async function requireOwnTeacherId(req: Request, res: Response): Promise<string | null> {
  const user = req.user!;
  if (user.role !== 'teacher') {
    res.status(403).json({ error: 'Only teachers can perform this action' });
    return null;
  }
  const id = await resolveOwnTeacherId(user);
  if (!id) {
    res.status(403).json({ error: 'No teacher record is linked to this account' });
    return null;
  }
  return id;
}

/** For actions that may be authored either by the teacher themself or, on their behalf,
 * by a department head / school head / head of academics (e.g. an HoD-authored exam).
 * Privileged roles must still pass an explicit teacherId; it is validated against the
 * teachers table by the caller. */
async function resolveActingTeacherId(
  req: Request,
  res: Response,
  bodyTeacherId?: unknown
): Promise<string | null> {
  const user = req.user!;
  if (user.role === 'teacher') {
    const id = await resolveOwnTeacherId(user);
    if (!id) {
      res.status(403).json({ error: 'No teacher record is linked to this account' });
      return null;
    }
    return id;
  }
  if (isPrivilegedStaff(user.role) && typeof bodyTeacherId === 'string' && bodyTeacherId.trim()) {
    return bodyTeacherId;
  }
  res.status(403).json({ error: 'Forbidden' });
  return null;
}

/** Ownership gate for edits to an existing row: the teacher who owns it, or a
 * privileged staff role, may proceed. */
async function assertOwnsTeacherRow(
  req: Request,
  res: Response,
  ownerTeacherId: string | null
): Promise<boolean> {
  const user = req.user!;
  if (isPrivilegedStaff(user.role)) return true;
  if (user.role !== 'teacher') {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  const ownTeacherId = await resolveOwnTeacherId(user);
  if (!ownTeacherId || !ownerTeacherId || ownTeacherId !== ownerTeacherId) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

async function requireCommunityMembership(
  userId: string,
  communityId: string,
  res: Response
): Promise<string | null> {
  const { rows } = await query(
    'SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2',
    [communityId, userId]
  );
  if (!rows.length) {
    res.status(403).json({ error: 'Not a member of this community' });
    return null;
  }
  return rows[0].role as string;
}

async function attachReactions(rows: Record<string, unknown>[], userId: string) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id as string);
  const { rows: reactionRows } = await query(
    `SELECT message_id, emoji, user_id FROM community_message_reactions WHERE message_id = ANY($1::text[])`,
    [ids]
  );
  const byMessage = new Map<string, Map<string, { count: number; me: boolean }>>();
  for (const r of reactionRows) {
    const mid = r.message_id as string;
    const emoji = r.emoji as string;
    if (!byMessage.has(mid)) byMessage.set(mid, new Map());
    const emojiMap = byMessage.get(mid)!;
    const current = emojiMap.get(emoji) ?? { count: 0, me: false };
    current.count += 1;
    if (r.user_id === userId) current.me = true;
    emojiMap.set(emoji, current);
  }
  return rows.map((row) => {
    const emojiMap = byMessage.get(row.id as string);
    const reactions = emojiMap
      ? Array.from(emojiMap.entries()).map(([emoji, v]) => ({ emoji, count: v.count, me: v.me }))
      : [];
    return mapCommunityMessage(row, reactions);
  });
}

/** Notify members whose display name is @mentioned in a channel/thread message. */
async function createMentionNotifications(
  messageId: string,
  content: string,
  communityId: string,
  authorId: string
) {
  const names = Array.from(content.matchAll(/@([A-Za-z][\w .'-]*)/g)).map((m) => m[1].trim());
  if (names.length === 0) return;
  const { rows: members } = await query(
    `SELECT pu.id, pu.display_name FROM community_members cm
     JOIN portal_users pu ON pu.id = cm.user_id
     WHERE cm.community_id = $1`,
    [communityId]
  );
  const matchedIds = new Set<string>();
  for (const name of names) {
    const lower = name.toLowerCase();
    for (const m of members) {
      const displayName = String(m.display_name).toLowerCase();
      if ((displayName === lower || displayName.startsWith(lower)) && m.id !== authorId) {
        matchedIds.add(m.id as string);
      }
    }
  }
  for (const uid of matchedIds) {
    await query(
      `INSERT INTO community_mention_notifications (id, user_id, message_id) VALUES ($1,$2,$3)`,
      [`ment-${Date.now()}-${uid}`, uid, messageId]
    );
  }
}

/** Quizzes/baselines never need approval; HoD-authored exams are ready immediately. */
function assessmentInitialStatus(type: string, createdByRole?: string): string {
  const role = (createdByRole || 'teacher').toLowerCase();
  if (role === 'department-head' || role === 'hod') return 'Approved';
  if (type === 'Quiz' || type === 'Baseline') return 'Approved';
  return 'Pending Dept Head';
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
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await loadBootstrap(req.user!));
  })
);

const PORTAL_ROLES = [
  'moe',
  'school-head',
  'registrar',
  'hr',
  'head-of-academics',
  'department-head',
  'teacher',
  'student',
  'parent',
  'finance',
] as const;

const SELF_REGISTER_ROLES = ['parent', 'student'] as const;

function mapPortalUser(user: {
  id: string;
  email: string;
  role: string;
  display_name: string;
  subject?: string | null;
  department_id?: string | null;
  school_id?: string | null;
  linked_student_id?: string | null;
  linked_parent_id?: string | null;
  permissions?: string[];
}) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    displayName: user.display_name,
    schoolId: user.school_id ?? null,
    linkedStudentId: user.linked_student_id ?? null,
    linkedParentId: user.linked_parent_id ?? null,
    permissions: user.permissions ?? [],
    ...(user.subject ? { subject: user.subject } : {}),
    ...(user.department_id ? { departmentId: user.department_id } : {}),
  };
}

async function verifyPassword(user: { password?: string; password_hash?: string | null }, password: string) {
  if (user.password_hash) {
    return bcrypt.compare(password, user.password_hash);
  }
  return user.password === password;
}

// Auth
apiRouter.post(
  '/auth/login',
  rateLimit({ windowMs: 60_000, max: 20 }),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password required' });
      return;
    }
    const { rows } = await query(
      'SELECT * FROM portal_users WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    if (rows.length === 0) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const user = rows[0];
    if (!(await verifyPassword(user, password))) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    // Migrate plaintext seed passwords to hash on successful login
    if (!user.password_hash && user.password) {
      try {
        const hash = await bcrypt.hash(password, 10);
        await query(
          `UPDATE portal_users SET password_hash = $1, password = NULL WHERE id = $2`,
          [hash, user.id]
        );
      } catch (err) {
        // Schema may be behind (missing password_hash / NOT NULL on password).
        // Login should still succeed; ensurePortalAuthSchema + migrate fix this permanently.
        console.warn('[auth/login] password hash upgrade skipped:', err);
      }
    }
    const withPerms = await attachPermissions({
      id: user.id,
      email: user.email,
      role: user.role,
      displayName: user.display_name,
      schoolId: user.school_id ?? null,
      linkedStudentId: user.linked_student_id ?? null,
      linkedParentId: user.linked_parent_id ?? null,
      subject: user.subject ?? undefined,
      departmentId: user.department_id ?? undefined,
    });
    const token = signAccessToken({
      id: user.id,
      role: user.role,
      schoolId: user.school_id ?? null,
    });
    await writeAudit({
      schoolId: user.school_id,
      actorUserId: user.id,
      action: 'auth.login',
      entityType: 'portal_user',
      entityId: user.id,
    });
    res.json({
      ...mapPortalUser({
        ...user,
        permissions: withPerms.permissions,
      } as Parameters<typeof mapPortalUser>[0]),
      token,
    });
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
    const passwordHash = await bcrypt.hash(password, 10);
    const schoolId = (req.body as { schoolId?: string }).schoolId ?? null;

    await query(
      `INSERT INTO portal_users (id, email, password, password_hash, role, display_name, school_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, normalizedEmail, '', passwordHash, role, displayName.trim(), schoolId]
    );

    const { rows } = await query('SELECT * FROM portal_users WHERE id = $1', [id]);
    const withPerms = await attachPermissions({
      id: rows[0].id,
      email: rows[0].email,
      role: rows[0].role,
      displayName: rows[0].display_name,
      schoolId: rows[0].school_id ?? null,
      linkedStudentId: rows[0].linked_student_id ?? null,
      linkedParentId: rows[0].linked_parent_id ?? null,
    });
    const token = signAccessToken({
      id: rows[0].id,
      role: rows[0].role,
      schoolId: rows[0].school_id ?? null,
    });
    res.status(201).json({
      ...mapPortalUser({
        ...(rows[0] as Parameters<typeof mapPortalUser>[0]),
        permissions: withPerms.permissions,
      }),
      token,
    });
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

// Teachers — creating/editing a teacher record touches personal contact info
// (email/phone), so only privileged institutional staff may do it server-side.
function requirePrivilegedStaff(req: Request, res: Response): boolean {
  if (!req.user || !isPrivilegedStaff(req.user.role)) {
    res.status(403).json({ error: 'Only department/school/academic leadership may manage teacher records' });
    return false;
  }
  return true;
}

apiRouter.post(
  '/teachers',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!requirePrivilegedStaff(req, res)) return;
    const b = req.body;
    const { rows: cnt } = await query('SELECT COUNT(*)::int AS c FROM teachers');
    const id = `tch-${Number(cnt[0].c) + 1}`;
    await query(
      `INSERT INTO teachers (id, name, email, phone, department_id, school_id, status, subjects, grades, certification, training_progress, years_experience)
       VALUES ($1,$2,$3,$4,$5,$6,'Active',$7,$8,$9,0,$10)`,
      [id, b.name, b.email, b.phone, b.departmentId, b.schoolId, JSON.stringify(b.subjects ?? []), JSON.stringify(b.grades ?? []), b.certification ?? '', Number(b.yearsOfExperience ?? 0)]
    );
    await query('UPDATE schools SET teachers_count = teachers_count + 1 WHERE id = $1', [b.schoolId]);
    const { rows } = await query('SELECT * FROM teachers WHERE id = $1', [id]);
    res.status(201).json(mapTeacher(rows[0]));
  })
);

// Fields a teacher may change on their own record via self-service settings —
// everything else (department, status, subjects, experienceOverride, ...) is an
// institutional decision reserved for privileged staff.
const TEACHER_SELF_EDIT_FIELDS = new Set(['name', 'email', 'phone', 'yearsOfExperience']);

apiRouter.patch(
  '/teachers/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const privileged = isPrivilegedStaff(req.user!.role);
    if (!privileged) {
      const ownId = req.user!.role === 'teacher' ? await resolveOwnTeacherId(req.user!) : null;
      if (!ownId || ownId !== req.params.id) {
        res.status(403).json({ error: 'Only department/school/academic leadership may manage teacher records' });
        return;
      }
      const disallowed = Object.keys(req.body ?? {}).filter((k) => !TEACHER_SELF_EDIT_FIELDS.has(k));
      if (disallowed.length) {
        res.status(403).json({ error: `Cannot self-edit: ${disallowed.join(', ')}` });
        return;
      }
    }
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
      yearsOfExperience: 'years_experience',
    };
    for (const [k, col] of Object.entries(map)) {
      if (b[k] !== undefined) {
        fields.push(`${col} = $${i++}`);
        vals.push(b[k]);
      }
    }
    // experienceOverride is nullable — 'new' | 'experienced' | null clears the manual override.
    if ('experienceOverride' in b) {
      fields.push(`experience_override = $${i++}`);
      vals.push(b.experienceOverride ?? null);
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
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!requirePrivilegedStaff(req, res)) return;
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
  optionalAuth,
  asyncHandler(async (req, res) => {
    const b = req.body;
    const { rows: cnt } = await query('SELECT COUNT(*)::int AS c FROM students');
    const id = `std-${Number(cnt[0].c) + 1}`;
    const studentId = `PTS/${Math.floor(1000 + Math.random() * 9000)}/18`;
    const academicYear = currentAcademicYear();
    await query(
      `INSERT INTO students (id, student_id, name, email, grade, section, school_id, parent_name, parent_phone, parent_email, status, gpa, attendance_rate, medical_info, emergency_contact, date_of_birth, academic_year)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Active',0,100,$11,$12,$13,$14)`,
      [id, studentId, b.name, b.email ?? null, b.grade, b.section, b.schoolId, b.parentName, b.parentPhone, b.parentEmail, b.medicalInfo ?? null, b.emergencyContact, b.dateOfBirth ?? null, academicYear]
    );
    const { rows } = await query('SELECT * FROM students WHERE id = $1', [id]);
    await writeAudit({
      schoolId: b.schoolId ?? null,
      actorUserId: req.user?.id ?? null,
      action: 'student.create',
      entityType: 'student',
      entityId: id,
      metadata: { name: b.name, grade: b.grade, section: b.section },
    });
    res.status(201).json(mapStudent(rows[0]));
  })
);

apiRouter.patch(
  '/students/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const b = req.body;
    // Status changes with optional tuition proration go through transfers service
    if (b.status !== undefined && Object.keys(b).every((k) => ['status', 'notes', 'applyProration'].includes(k))) {
      const { changeStudentStatus } = await import('../services/transfers.js');
      const result = await changeStudentStatus({
        studentId: String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id),
        status: b.status,
        notes: b.notes,
        applyProration: b.applyProration,
        actorUserId: req.user?.id,
      });
      const { mapStudent } = await import('../lib/serialize.js');
      res.json({
        ...mapStudent(result.student),
        prorationCredit: result.prorationCredit,
        creditedInvoiceId: result.creditedInvoiceId,
      });
      return;
    }
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
      dateOfBirth: 'date_of_birth',
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
    await writeAudit({
      schoolId: (rows[0]?.school_id as string | undefined) ?? null,
      actorUserId: req.user?.id ?? null,
      action: 'student.update',
      entityType: 'student',
      entityId: String(req.params.id),
      metadata: { changed: cols.map(([c]) => c) },
    });
    res.json(mapStudent(rows[0]));
  })
);

// Lesson plans
apiRouter.post(
  '/lesson-plans',
  requireAuth,
  asyncHandler(async (req, res) => {
    const b = req.body;
    const teacherId = await resolveActingTeacherId(req, res, b.teacherId);
    if (!teacherId) return;
    const { rows: tch } = await query('SELECT name FROM teachers WHERE id = $1', [teacherId]);
    const id = `lp-${Date.now()}`;
    // A teacher account cannot self-approve by passing status/createdByRole in the body —
    // only privileged staff (who legitimately author plans that publish immediately) may.
    const createdByRole = req.user!.role;
    const status = isPrivilegedStaff(createdByRole)
      ? (typeof b.status === 'string' && b.status.trim() ? b.status : 'Approved')
      : 'Pending Dept Head';
    const teacherName =
      (typeof b.teacherName === 'string' && b.teacherName.trim()) ||
      tch[0]?.name ||
      'Teacher';
    // Avoid FK failure when publisher is a dept-head without a teachers row
    const resolvedTeacherId = tch.length ? teacherId : null;

    await query(
      `INSERT INTO lesson_plans (
         id, subject, grade, title, sessions, teacher_id, teacher_name, status, version,
         objectives, activities, assessments, homework,
         plan_type, plan_detail, created_by_role, created_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10,$11,$12,$13,$14,$15,NOW()
       )`,
      [
        id,
        b.subject,
        b.grade,
        b.title,
        b.sessions,
        resolvedTeacherId,
        teacherName,
        status,
        JSON.stringify(b.objectives ?? []),
        JSON.stringify(b.activities ?? []),
        JSON.stringify(b.assessments ?? []),
        b.homework ?? '',
        b.planType ?? null,
        b.planDetail ?? null,
        createdByRole,
      ],
    );
    const { rows } = await query('SELECT * FROM lesson_plans WHERE id = $1', [id]);
    res.status(201).json(mapLessonPlan(rows[0]));
  })
);

apiRouter.patch(
  '/lesson-plans/:id/approve',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!isPrivilegedStaff(req.user!.role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const { role, comments } = req.body as { role: 'dept' | 'school'; comments: string };
    const { rows: cur } = await query('SELECT * FROM lesson_plans WHERE id = $1', [req.params.id]);
    if (!cur.length) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    // Weekly lesson plans: department head is the final (and only) approver.
    // School head does not approve weekly plans.
    if (role === 'school') {
      const { rows } = await query('SELECT * FROM lesson_plans WHERE id = $1', [req.params.id]);
      res.json(mapLessonPlan(rows[0]));
      return;
    }
    const status = 'Approved';
    await query(
      `UPDATE lesson_plans SET status = $1, dept_comments = COALESCE($2, dept_comments), version = version + 1 WHERE id = $3`,
      [status, comments ?? null, req.params.id]
    );
    const { rows } = await query('SELECT * FROM lesson_plans WHERE id = $1', [req.params.id]);
    res.json(mapLessonPlan(rows[0]));
  })
);

apiRouter.patch(
  '/lesson-plans/:id/reject',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!isPrivilegedStaff(req.user!.role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
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
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows: cur } = await query('SELECT teacher_id FROM lesson_plans WHERE id = $1', [req.params.id]);
    if (!cur.length) {
      res.status(404).json({ error: 'Lesson plan not found' });
      return;
    }
    if (!(await assertOwnsTeacherRow(req, res, cur[0].teacher_id as string | null))) return;
    const { title, objectives, sessions, homework } = req.body;
    await query(
      `UPDATE lesson_plans SET title = $1, objectives = $2, sessions = $3, homework = $4, status = 'Pending Dept Head', version = version + 1 WHERE id = $5`,
      [title, JSON.stringify(objectives), sessions, homework, req.params.id]
    );
    const { rows } = await query('SELECT * FROM lesson_plans WHERE id = $1', [req.params.id]);
    res.json(mapLessonPlan(rows[0]));
  })
);

apiRouter.patch(
  '/lesson-plans/:id/annual',
  requireAuth,
  asyncHandler(async (req, res) => {
    const b = req.body;
    const { rows: cur } = await query('SELECT * FROM lesson_plans WHERE id = $1', [req.params.id]);
    if (!cur[0]) {
      res.status(404).json({ error: 'Lesson plan not found' });
      return;
    }
    if (!(await assertOwnsTeacherRow(req, res, cur[0].teacher_id as string | null))) return;
    await query(
      `UPDATE lesson_plans SET
        title = $1, grade = $2, subject = $3, sessions = $4,
        objectives = $5, activities = $6, assessments = $7, homework = $8,
        plan_detail = $9, status = 'Approved', version = version + 1
       WHERE id = $10`,
      [
        b.title,
        b.grade,
        b.subject,
        b.sessions,
        JSON.stringify(b.objectives ?? []),
        JSON.stringify(b.activities ?? []),
        JSON.stringify(b.assessments ?? []),
        b.homework ?? '',
        b.planDetail ?? null,
        req.params.id,
      ],
    );
    const { rows } = await query('SELECT * FROM lesson_plans WHERE id = $1', [req.params.id]);
    res.json(mapLessonPlan(rows[0]));
  }),
);

apiRouter.patch(
  '/lesson-plans/:id/meta',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows: curOwner } = await query('SELECT teacher_id FROM lesson_plans WHERE id = $1', [req.params.id]);
    if (!curOwner.length) {
      res.status(404).json({ error: 'Lesson plan not found' });
      return;
    }
    if (!(await assertOwnsTeacherRow(req, res, curOwner[0].teacher_id as string | null))) return;
    const b = req.body as Record<string, unknown>;
    // createdByRole and status both gate the approval workflow (see POST /lesson-plans and
    // /lesson-plans/:id/approve) — an owning teacher must never be able to set either
    // directly here, or they could forge "authored by department-head" / self-approve.
    if ((b.createdByRole !== undefined || b.status !== undefined) && !isPrivilegedStaff(req.user!.role)) {
      res.status(403).json({ error: 'Only department/school/academic leadership may set plan status or authorship' });
      return;
    }
    const fields: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (b.planType !== undefined) {
      fields.push(`plan_type = $${i++}`);
      vals.push(b.planType);
    }
    if (b.createdByRole !== undefined) {
      fields.push(`created_by_role = $${i++}`);
      vals.push(b.createdByRole);
    }
    if (b.subject !== undefined) {
      fields.push(`subject = $${i++}`);
      vals.push(b.subject);
    }
    if (b.grade !== undefined) {
      fields.push(`grade = $${i++}`);
      vals.push(b.grade);
    }
    if (b.title !== undefined) {
      fields.push(`title = $${i++}`);
      vals.push(b.title);
    }
    if (b.status !== undefined) {
      fields.push(`status = $${i++}`);
      vals.push(b.status);
    }
    if (!fields.length) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }
    vals.push(req.params.id);
    await query(`UPDATE lesson_plans SET ${fields.join(', ')} WHERE id = $${i}`, vals);
    const { rows } = await query('SELECT * FROM lesson_plans WHERE id = $1', [req.params.id]);
    res.json(mapLessonPlan(rows[0]));
  }),
);

apiRouter.delete(
  '/lesson-plans/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows: cur } = await query('SELECT id, teacher_id FROM lesson_plans WHERE id = $1', [req.params.id]);
    if (!cur[0]) {
      res.status(404).json({ error: 'Lesson plan not found' });
      return;
    }
    if (!(await assertOwnsTeacherRow(req, res, cur[0].teacher_id as string | null))) return;
    const { rows: notes } = await query(
      'SELECT id FROM teaching_notes WHERE lesson_plan_id = $1',
      [req.params.id],
    );
    for (const n of notes) {
      await query('UPDATE community_posts SET teaching_note_id = NULL WHERE teaching_note_id = $1', [
        n.id,
      ]);
      try {
        await query('UPDATE lesson_deliveries SET teaching_note_id = NULL WHERE teaching_note_id = $1', [
          n.id,
        ]);
      } catch {
        /* optional */
      }
    }
    try {
      await query('UPDATE lesson_deliveries SET lesson_plan_id = NULL WHERE lesson_plan_id = $1', [
        req.params.id,
      ]);
    } catch {
      /* optional column */
    }
    await query('DELETE FROM teaching_notes WHERE lesson_plan_id = $1', [req.params.id]);
    await query('DELETE FROM lesson_plans WHERE id = $1', [req.params.id]);
    res.status(204).end();
  }),
);

// TE-004: Teacher Adjustments — every departure from the annual plan is logged here
// rather than overwriting it. The annual plan (lesson_plans) stays the untouched
// baseline; this table is the record of what changed, why, and its pacing impact.
apiRouter.post(
  '/teacher-lesson-adjustments',
  requireAuth,
  asyncHandler(async (req, res) => {
    const teacherId = await requireOwnTeacherId(req, res);
    if (!teacherId) return;
    const b = req.body;
    if (!b.originalTopic || !b.revisedTopic || !b.reason || !b.grade || !b.subject) {
      res.status(400).json({ error: 'grade, subject, originalTopic, revisedTopic and reason are required' });
      return;
    }
    const id = `adj-${Date.now()}`;
    const today = new Date().toISOString().split('T')[0];
    await query(
      `INSERT INTO teacher_lesson_adjustments
       (id, teacher_id, annual_plan_id, weekly_plan_id, grade, subject, original_topic, revised_topic, reason, pacing_impact, adjustment_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        id,
        teacherId,
        b.annualPlanId ?? null,
        b.weeklyPlanId ?? null,
        b.grade,
        b.subject,
        b.originalTopic,
        b.revisedTopic,
        b.reason,
        b.pacingImpact ?? null,
        today,
      ]
    );
    const { rows } = await query('SELECT * FROM teacher_lesson_adjustments WHERE id = $1', [id]);
    res.status(201).json(mapTeacherLessonAdjustment(rows[0]));
  })
);

apiRouter.get(
  '/teacher-lesson-adjustments/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    const teacherId = await requireOwnTeacherId(req, res);
    if (!teacherId) return;
    const { rows } = await query(
      'SELECT * FROM teacher_lesson_adjustments WHERE teacher_id = $1 ORDER BY created_at DESC',
      [teacherId]
    );
    res.json(rows.map(mapTeacherLessonAdjustment));
  })
);

// Assessments
apiRouter.post(
  '/assessments',
  requireAuth,
  asyncHandler(async (req, res) => {
    const b = req.body;
    const teacherId = await resolveActingTeacherId(req, res, b.teacherId);
    if (!teacherId) return;
    // Derived from the session, not the request body — a teacher account cannot claim
    // 'department-head' to short-circuit assessmentInitialStatus's auto-approve path.
    const createdByRole = req.user!.role;
    const { rows: tch } = await query('SELECT name FROM teachers WHERE id = $1', [teacherId]);
    const authorName =
      b.teacherName ||
      (createdByRole === 'department-head' ? b.authorName : null) ||
      tch[0]?.name ||
      'Teacher';
    const status = assessmentInitialStatus(String(b.type), createdByRole);
    const id = `asm-${Date.now()}`;

    // TE-007: for a Unit Test, only IDs of teaching notes this teacher actually
    // delivered (a real lesson_deliveries row exists) may be attached as coverage —
    // never an arbitrary/unverified list.
    let coveredTeachingNoteIds: string[] = [];
    if (String(b.type) === 'Unit Test' && Array.isArray(b.coveredTeachingNoteIds)) {
      const candidateIds = b.coveredTeachingNoteIds.filter((x: unknown) => typeof x === 'string');
      if (candidateIds.length) {
        const { rows: delivered } = await query(
          `SELECT tn.id FROM teaching_notes tn
           JOIN lesson_deliveries ld ON ld.teaching_note_id = tn.id
           WHERE tn.id = ANY($1::text[]) AND tn.teacher_id = $2`,
          [candidateIds, teacherId]
        );
        coveredTeachingNoteIds = delivered.map((r) => r.id as string);
      }
    }

    await query(
      `INSERT INTO assessments (id, title, type, subject, grade, teacher_id, teacher_name, status, difficulty, questions, created_by_role, covered_teaching_note_ids, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())`,
      [
        id,
        b.title,
        b.type,
        b.subject,
        b.grade,
        teacherId,
        authorName,
        status,
        b.difficulty,
        JSON.stringify(b.questions ?? []),
        createdByRole,
        JSON.stringify(coveredTeachingNoteIds),
      ]
    );
    if (status === 'Approved') {
      await insertNotification(
        'Assessment ready',
        `"${b.title}" is ready to link in the gradebook.`,
        'success',
        '/dashboard/teacher/manage-students'
      );
    } else {
      await insertNotification(
        'Assessment awaiting approval',
        `"${b.title}" was submitted for department head review.`,
        'request',
        '/dashboard/department-head/assessments'
      );
    }
    const { rows } = await query('SELECT * FROM assessments WHERE id = $1', [id]);
    res.status(201).json(mapAssessment(rows[0]));
  })
);

apiRouter.patch(
  '/assessments/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows: cur } = await query('SELECT teacher_id FROM assessments WHERE id = $1', [req.params.id]);
    if (!cur.length) {
      res.status(404).json({ error: 'Assessment not found' });
      return;
    }
    if (!(await assertOwnsTeacherRow(req, res, cur[0].teacher_id as string | null))) return;
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
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!isPrivilegedStaff(req.user!.role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const { comments } = req.body;
    await query(`UPDATE assessments SET status = 'Approved', comments = $1 WHERE id = $2`, [comments, req.params.id]);
    const { rows } = await query('SELECT * FROM assessments WHERE id = $1', [req.params.id]);
    res.json(mapAssessment(rows[0]));
  })
);

apiRouter.patch(
  '/assessments/:id/reject',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!isPrivilegedStaff(req.user!.role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const { comments } = req.body;
    await query(`UPDATE assessments SET status = 'Rejected', comments = $1 WHERE id = $2`, [comments, req.params.id]);
    const { rows } = await query('SELECT * FROM assessments WHERE id = $1', [req.params.id]);
    res.json(mapAssessment(rows[0]));
  })
);

apiRouter.delete(
  '/assessments/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows: cur } = await query('SELECT id, teacher_id FROM assessments WHERE id = $1', [req.params.id]);
    if (!cur[0]) {
      res.status(404).json({ error: 'Assessment not found' });
      return;
    }
    if (!(await assertOwnsTeacherRow(req, res, cur[0].teacher_id as string | null))) return;
    await query('DELETE FROM assessments WHERE id = $1', [req.params.id]);
    res.status(204).end();
  }),
);

// Attendance batch
apiRouter.post(
  '/attendance/batch',
  requireAuth,
  requirePermission('attendance.enter'),
  asyncHandler(async (req, res) => {
    const { records, timetableSlotId } = req.body as {
      records: { studentId: string; status: string; remarks?: string }[];
      timetableSlotId?: string;
    };
    // TE-002/CM-006: attendance is attributed to the recording teacher, and — when the
    // caller names the scheduled session it was taken for — linked to that timetable
    // slot, so it can be traced back to which class/subject/period it belongs to.
    const teacherId = await resolveActingTeacherId(req, res, req.body.teacherId);
    if (!teacherId) return;
    let resolvedSlotId: string | null = null;
    if (typeof timetableSlotId === 'string' && timetableSlotId.trim()) {
      const { rows: slot } = await query('SELECT id FROM timetable_slots WHERE id = $1', [timetableSlotId]);
      resolvedSlotId = slot.length ? timetableSlotId : null;
    }
    const today = new Date().toISOString().split('T')[0];

    // CM-006: reject the whole batch up front if this scheduled session already has
    // attendance recorded for any of these students, instead of partially saving and
    // then hitting the unique index mid-loop.
    if (resolvedSlotId) {
      const studentIds = records.map((r) => r.studentId);
      const { rows: existing } = await query(
        `SELECT student_id FROM attendance WHERE timetable_slot_id = $1 AND date = $2 AND student_id = ANY($3::text[])`,
        [resolvedSlotId, today, studentIds]
      );
      if (existing.length) {
        res.status(409).json({
          error: `Attendance for this session has already been recorded for ${existing.length} student${existing.length === 1 ? '' : 's'} today.`,
        });
        return;
      }
    }

    const created: ReturnType<typeof mapAttendance>[] = [];
    for (const rec of records) {
      const { rows: std } = await query('SELECT * FROM students WHERE id = $1', [rec.studentId]);
      const student = std[0];
      const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await query(
        `INSERT INTO attendance (id, student_id, student_name, grade, section, date, status, remarks, teacher_id, timetable_slot_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, rec.studentId, student?.name ?? 'Unknown', student?.grade ?? '', student?.section ?? '', today, rec.status, rec.remarks ?? null, teacherId, resolvedSlotId]
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

// STEP self-assessment: a teacher submits (or resubmits) their rubric self-rating.
apiRouter.post(
  '/teacher-self-assessments',
  requireAuth,
  asyncHandler(async (req, res) => {
    const teacherId = await requireOwnTeacherId(req, res);
    if (!teacherId) return;
    const { responses, overallScore, weakestCompetencyId } = req.body;
    const id = `sa-${Date.now()}`;
    await query(
      `INSERT INTO teacher_self_assessments (id, teacher_id, responses, overall_score, weakest_competency_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, teacherId, JSON.stringify(responses ?? []), overallScore ?? 0, weakestCompetencyId ?? null]
    );
    const { rows } = await query('SELECT * FROM teacher_self_assessments WHERE id = $1', [id]);
    res.status(201).json(mapTeacherSelfAssessment(rows[0]));
  })
);

// HoD/School Head assigns a TIP/STEP/ELEP module to a specific teacher or leader.
apiRouter.post(
  '/teacher-training-assignments',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!isPrivilegedStaff(req.user!.role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const { teacherId, program, moduleId, moduleTitle, reason, dueDate, sessionsTotal } = req.body;
    if (!teacherId) {
      res.status(400).json({ error: 'teacherId required' });
      return;
    }
    const { rows: tch } = await query('SELECT id FROM teachers WHERE id = $1', [teacherId]);
    if (!tch.length) {
      res.status(404).json({ error: 'Teacher not found' });
      return;
    }
    const id = `assign-${Date.now()}`;
    await query(
      `INSERT INTO teacher_training_assignments (id, teacher_id, program, module_id, module_title, assigned_by_name, reason, due_date, sessions_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, teacherId, program, moduleId, moduleTitle, req.user!.displayName, reason ?? null, dueDate ?? null, sessionsTotal ?? null]
    );
    const { rows } = await query('SELECT * FROM teacher_training_assignments WHERE id = $1', [id]);
    res.status(201).json(mapTeacherTrainingAssignment(rows[0]));
  })
);

// A teacher's own assigned training, regardless of program — the "Assigned to Me" view.
apiRouter.get(
  '/teacher-training-assignments/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    const teacherId = await requireOwnTeacherId(req, res);
    if (!teacherId) return;
    const { rows } = await query(
      'SELECT * FROM teacher_training_assignments WHERE teacher_id = $1 ORDER BY created_at DESC',
      [teacherId]
    );
    res.json(rows.map(mapTeacherTrainingAssignment));
  })
);

// Manual status edits (e.g. an HoD reopening or cancelling an assignment). Completion
// can NEVER be set here — only /progress can mark an assignment completed, and only
// once all three of its requirements are actually met (TR-007).
apiRouter.patch(
  '/teacher-training-assignments/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows: cur } = await query('SELECT teacher_id FROM teacher_training_assignments WHERE id = $1', [req.params.id]);
    if (!cur.length) {
      res.status(404).json({ error: 'Assignment not found' });
      return;
    }
    if (!(await assertOwnsTeacherRow(req, res, cur[0].teacher_id as string | null))) return;
    const { status } = req.body as { status?: string };
    if (status === 'completed') {
      res.status(400).json({
        error: 'A module can only be completed via /progress, once sessions, assessment, and reflection are all done.',
      });
      return;
    }
    if (status !== 'assigned' && status !== 'in_progress') {
      res.status(400).json({ error: "status must be 'assigned' or 'in_progress'" });
      return;
    }
    await query('UPDATE teacher_training_assignments SET status = $1 WHERE id = $2', [status, req.params.id]);
    const { rows } = await query('SELECT * FROM teacher_training_assignments WHERE id = $1', [req.params.id]);
    res.json(mapTeacherTrainingAssignment(rows[0]));
  })
);

// TR-007: the only path that can mark a module completed. Completion requires ALL of:
// every session done, the final assessment passed, and the reflection submitted —
// enforced here server-side, not left to the client to decide.
apiRouter.patch(
  '/teacher-training-assignments/:id/progress',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows: cur } = await query('SELECT * FROM teacher_training_assignments WHERE id = $1', [req.params.id]);
    if (!cur.length) {
      res.status(404).json({ error: 'Assignment not found' });
      return;
    }
    if (!(await assertOwnsTeacherRow(req, res, cur[0].teacher_id as string | null))) return;

    const b = req.body as {
      sessionsCompleted?: number;
      sessionsTotal?: number;
      assessmentScore?: number;
      assessmentPassed?: boolean;
      reflectionSubmitted?: boolean;
      reflectionAnswers?: unknown;
    };
    const row = cur[0];
    const sessionsCompleted = b.sessionsCompleted ?? Number(row.sessions_completed ?? 0);
    const sessionsTotal = b.sessionsTotal ?? (row.sessions_total != null ? Number(row.sessions_total) : undefined);
    const assessmentScore = b.assessmentScore ?? (row.assessment_score != null ? Number(row.assessment_score) : undefined);
    const assessmentPassed = b.assessmentPassed ?? row.assessment_passed ?? undefined;
    const reflectionSubmitted = b.reflectionSubmitted ?? Boolean(row.reflection_submitted);
    const reflectionAnswers = b.reflectionAnswers ?? row.reflection_answers ?? null;

    const isComplete = isTrainingAssignmentComplete({
      sessionsCompleted,
      sessionsTotal,
      assessmentPassed,
      reflectionSubmitted,
    });
    const wasComplete = row.status === 'completed';
    const nextStatus = nextTrainingAssignmentStatus({
      sessionsCompleted,
      sessionsTotal,
      assessmentScore,
      assessmentPassed,
      reflectionSubmitted,
      currentStatus: String(row.status),
    });

    await query(
      `UPDATE teacher_training_assignments SET
         sessions_completed = $1, sessions_total = COALESCE($2, sessions_total),
         assessment_score = $3, assessment_passed = $4,
         reflection_submitted = $5, reflection_answers = $6::jsonb,
         status = $7, completed_at = CASE WHEN $7 = 'completed' AND completed_at IS NULL THEN NOW() ELSE completed_at END
       WHERE id = $8`,
      [
        sessionsCompleted,
        sessionsTotal ?? null,
        assessmentScore ?? null,
        assessmentPassed ?? null,
        reflectionSubmitted,
        reflectionAnswers != null ? JSON.stringify(reflectionAnswers) : null,
        nextStatus,
        req.params.id,
      ]
    );
    if (isComplete && !wasComplete) {
      await insertNotification(
        'Training module completed',
        `${row.module_title} — sessions, assessment, and reflection all complete.`,
        'success',
        '/dashboard/department-head/training'
      );
    }
    const { rows } = await query('SELECT * FROM teacher_training_assignments WHERE id = $1', [req.params.id]);
    res.json(mapTeacherTrainingAssignment(rows[0]));
  })
);

// HR training planning: schedule a Continuous Development or In-Person training
// and assign it to individual teachers or a whole academic team (department).
apiRouter.post(
  '/training-plans',
  asyncHandler(async (req, res) => {
    const { title, description, type, startDate, endDate, location, facilitator, createdByName } = req.body;
    const id = `plan-${Date.now()}`;
    await query(
      `INSERT INTO training_plans (id, title, description, type, start_date, end_date, location, facilitator, created_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        title,
        description ?? null,
        type,
        startDate,
        endDate ?? null,
        location ?? null,
        facilitator ?? null,
        createdByName,
      ]
    );
    const { rows } = await query('SELECT * FROM training_plans WHERE id = $1', [id]);
    res.status(201).json(mapTrainingPlan(rows[0]));
  })
);

apiRouter.patch(
  '/training-plans/:id',
  asyncHandler(async (req, res) => {
    const { title, description, status, startDate, endDate, location, facilitator } = req.body;
    await query(
      `UPDATE training_plans SET
         title = COALESCE($1, title),
         description = COALESCE($2, description),
         status = COALESCE($3, status),
         start_date = COALESCE($4, start_date),
         end_date = COALESCE($5, end_date),
         location = COALESCE($6, location),
         facilitator = COALESCE($7, facilitator)
       WHERE id = $8`,
      [
        title ?? null,
        description ?? null,
        status ?? null,
        startDate ?? null,
        endDate ?? null,
        location ?? null,
        facilitator ?? null,
        req.params.id,
      ]
    );
    const { rows } = await query('SELECT * FROM training_plans WHERE id = $1', [req.params.id]);
    if (!rows.length) {
      res.status(404).json({ error: 'Training plan not found' });
      return;
    }
    res.json(mapTrainingPlan(rows[0]));
  })
);

apiRouter.post(
  '/training-plans/:id/assignments',
  asyncHandler(async (req, res) => {
    const { targetType, teacherId, departmentId, assignedByName } = req.body;
    const id = `plan-assign-${Date.now()}`;
    await query(
      `INSERT INTO training_plan_assignments (id, training_plan_id, target_type, teacher_id, department_id, assigned_by_name)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, req.params.id, targetType, teacherId ?? null, departmentId ?? null, assignedByName]
    );
    const { rows } = await query('SELECT * FROM training_plan_assignments WHERE id = $1', [id]);
    res.status(201).json(mapTrainingPlanAssignment(rows[0]));
  })
);

apiRouter.delete(
  '/training-plan-assignments/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await query('DELETE FROM training_plan_assignments WHERE id = $1 RETURNING id', [
      req.params.id,
    ]);
    if (!rows.length) {
      res.status(404).json({ error: 'Assignment not found' });
      return;
    }
    res.status(204).end();
  })
);

// Academic calendars
apiRouter.post(
  '/academic-calendars',
  asyncHandler(async (req, res) => {
    const b = req.body;
    const id = b.id ?? `cal-${Date.now()}`;
    const today = new Date().toISOString().split('T')[0];
    const schoolId = b.schoolId ?? 'sch-1';
    const existing = await query('SELECT id FROM academic_calendars WHERE id = $1', [id]);
    if (existing.rows.length) {
      await query(
        `UPDATE academic_calendars SET school_id=$1, academic_year=$2, title=$3, moe_reference=$4, quarters=$5,
         quarter_break_weeks=$6, semester_break_weeks=$7, mid_exam_count=$8, mid_exam_days=$9, final_exam_weeks=$10,
         events=$11, status=$12 WHERE id=$13`,
        [
          schoolId,
          b.academicYear,
          b.title,
          b.moeReference ?? null,
          b.quarters,
          b.quarterBreakWeeks,
          b.semesterBreakWeeks,
          b.midExamCount,
          b.midExamDays ?? null,
          b.finalExamWeeks ?? null,
          JSON.stringify(b.events ?? []),
          b.status ?? 'Draft',
          id,
        ]
      );
    } else {
      await query(
        `INSERT INTO academic_calendars (id, school_id, academic_year, title, moe_reference, quarters, quarter_break_weeks,
         semester_break_weeks, mid_exam_count, mid_exam_days, final_exam_weeks, events, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          id,
          schoolId,
          b.academicYear,
          b.title,
          b.moeReference ?? null,
          b.quarters,
          b.quarterBreakWeeks,
          b.semesterBreakWeeks,
          b.midExamCount,
          b.midExamDays ?? null,
          b.finalExamWeeks ?? null,
          JSON.stringify(b.events ?? []),
          b.status ?? 'Draft',
          today,
        ]
      );
    }
    const { rows } = await query('SELECT * FROM academic_calendars WHERE id = $1', [id]);
    res.status(201).json(mapAcademicCalendar(rows[0]));
  })
);

apiRouter.patch(
  '/academic-calendars/:id/publish',
  asyncHandler(async (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    await query(
      `UPDATE academic_calendars SET status = 'Published', published_at = $1 WHERE id = $2`,
      [today, req.params.id]
    );
    const { rows } = await query('SELECT * FROM academic_calendars WHERE id = $1', [req.params.id]);
    if (!rows.length) {
      res.status(404).json({ error: 'Calendar not found' });
      return;
    }
    res.json(mapAcademicCalendar(rows[0]));
  })
);

// Teaching notes
apiRouter.post(
  '/teaching-notes',
  requireAuth,
  asyncHandler(async (req, res) => {
    const b = req.body;
    const id = b.id ?? `tn-${Date.now()}`;
    const today = new Date().toISOString().split('T')[0];
    const existing = await query('SELECT id, teacher_id FROM teaching_notes WHERE id = $1', [id]);
    if (existing.rows.length) {
      if (!(await assertOwnsTeacherRow(req, res, existing.rows[0].teacher_id as string | null))) return;
      await query(
        `UPDATE teaching_notes SET title=$1, grade=$2, subject=$3, topic=$4, language=$5, content_summary=$6, content_body=$7, lesson_plan_id=$8, session_scope=$9, updated_at=$10 WHERE id=$11`,
        [b.title, b.grade, b.subject, b.topic, b.language, b.contentSummary, b.contentBody ?? null, b.lessonPlanId ?? null, b.sessionScope ?? null, today, id]
      );
    } else {
      const teacherId = await requireOwnTeacherId(req, res);
      if (!teacherId) return;
      // TE-005: a note with no linked lesson plan is a Supplementary/Unplanned Session —
      // an exception to the plan -> note evidence chain, so it must carry a reason.
      const standaloneReason = typeof b.standaloneReason === 'string' ? b.standaloneReason.trim() : '';
      if (!b.lessonPlanId && !standaloneReason) {
        res.status(400).json({
          error: 'A reason is required for a note with no linked lesson plan (Supplementary / Unplanned Session).',
        });
        return;
      }
      await query(
        `INSERT INTO teaching_notes (id, teacher_id, lesson_plan_id, title, grade, subject, topic, language, content_summary, content_body, status, session_scope, standalone_reason, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
        [id, teacherId, b.lessonPlanId ?? null, b.title, b.grade, b.subject, b.topic, b.language, b.contentSummary, b.contentBody ?? null, b.status ?? 'Saved', b.sessionScope ?? null, b.lessonPlanId ? null : standaloneReason, today]
      );
    }
    const { rows } = await query('SELECT * FROM teaching_notes WHERE id = $1', [id]);
    res.status(201).json(mapTeachingNote(rows[0]));
  })
);

apiRouter.patch(
  '/teaching-notes/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows: curOwner } = await query('SELECT teacher_id FROM teaching_notes WHERE id = $1', [req.params.id]);
    if (!curOwner.length) {
      res.status(404).json({ error: 'Teaching note not found' });
      return;
    }
    if (!(await assertOwnsTeacherRow(req, res, curOwner[0].teacher_id as string | null))) return;
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
      deptComments: 'dept_comments',
      sessionScope: 'session_scope',
      standaloneReason: 'standalone_reason',
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
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows: curOwner } = await query('SELECT teacher_id FROM teaching_notes WHERE id = $1', [req.params.id]);
    if (!curOwner.length) {
      res.status(404).json({ error: 'Teaching note not found' });
      return;
    }
    if (!(await assertOwnsTeacherRow(req, res, curOwner[0].teacher_id as string | null))) return;
    const today = new Date().toISOString().split('T')[0];
    await query(`UPDATE teaching_notes SET status = 'Saved', updated_at = $1 WHERE id = $2`, [today, req.params.id]);
    const { rows } = await query('SELECT * FROM teaching_notes WHERE id = $1', [req.params.id]);
    res.json(mapTeachingNote(rows[0]));
  })
);

apiRouter.delete(
  '/teaching-notes/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows: cur } = await query('SELECT id, teacher_id FROM teaching_notes WHERE id = $1', [req.params.id]);
    if (!cur[0]) {
      res.status(404).json({ error: 'Teaching note not found' });
      return;
    }
    if (!(await assertOwnsTeacherRow(req, res, cur[0].teacher_id as string | null))) return;
    await query('UPDATE community_posts SET teaching_note_id = NULL WHERE teaching_note_id = $1', [
      req.params.id,
    ]);
    try {
      await query('UPDATE lesson_deliveries SET teaching_note_id = NULL WHERE teaching_note_id = $1', [
        req.params.id,
      ]);
    } catch {
      /* column may not exist in older schemas */
    }
    await query('DELETE FROM teaching_notes WHERE id = $1', [req.params.id]);
    res.status(204).end();
  }),
);

// Grade entries
apiRouter.post(
  '/grade-entries',
  requireAuth,
  requirePermission('grades.enter'),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const teacherId = await resolveActingTeacherId(req, res, b.teacherId);
    if (!teacherId) return;
    const today = new Date().toISOString().split('T')[0];
    const questionResultsJson =
      b.questionResults != null ? JSON.stringify(b.questionResults) : null;

    if (b.studentId && b.subject && b.gradeLevel && b.section && b.term) {
      const locked = await isSubjectTermLocked({
        studentId: b.studentId,
        subject: b.subject,
        gradeLevel: b.gradeLevel,
        section: b.section,
        term: b.term,
      });
      if (locked) {
        const { userHasPermission } = await import('../lib/permissions.js');
        const canOverride =
          req.user!.role !== 'teacher' &&
          (await userHasPermission(req.user!.id, req.user!.role, req.user!.schoolId, 'grades.finalize'));
        if (!canOverride) {
          res.status(409).json({
            error: 'This subject/term has already been submitted or finalized. Ask your Academic Head to reopen it before editing.',
          });
          return;
        }
      }
    }

    // CM-003: resolve the real class this result belongs to (rather than only the
    // free-text grade/section pair) whenever exactly one class matches.
    let classId: string | null = null;
    if (b.gradeLevel && b.section) {
      const { rows: classRows } = await query(
        'SELECT id FROM school_classes WHERE grade = $1 AND section = $2',
        [b.gradeLevel, b.section]
      );
      if (classRows.length === 1) classId = classRows[0].id as string;
    }

    let id = b.id;
    if (id) {
      await query(
        `UPDATE student_grade_entries SET student_id=$1, subject=$2, grade_level=$3, section=$4, entry_type=$5, title=$6, assessment_id=$7, score=$8, max_score=$9, weight=$10, term=$11, remarks=$12, recorded_at=$13, teacher_id=$14, question_results=$15::jsonb, class_id=$16 WHERE id=$17`,
        [
          b.studentId,
          b.subject,
          b.gradeLevel,
          b.section,
          b.entryType,
          b.title,
          b.assessmentId ?? null,
          b.score,
          b.maxScore,
          b.weight,
          b.term,
          b.remarks ?? null,
          today,
          teacherId,
          questionResultsJson,
          classId,
          id,
        ]
      );
    } else {
      id = `ge-${Date.now()}`;
      await query(
        `INSERT INTO student_grade_entries (id, student_id, teacher_id, subject, grade_level, section, entry_type, title, assessment_id, score, max_score, weight, term, recorded_at, remarks, question_results, class_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17)`,
        [
          id,
          b.studentId,
          teacherId,
          b.subject,
          b.gradeLevel,
          b.section,
          b.entryType,
          b.title,
          b.assessmentId ?? null,
          b.score,
          b.maxScore,
          b.weight,
          b.term,
          today,
          b.remarks ?? null,
          questionResultsJson,
          classId,
        ]
      );
    }
    const { rows } = await query('SELECT * FROM student_grade_entries WHERE id = $1', [id]);
    res.status(201).json(mapStudentGradeEntry(rows[0]));
  })
);

apiRouter.delete(
  '/grade-entries/:id',
  requireAuth,
  requirePermission('grades.enter'),
  asyncHandler(async (req, res) => {
    const { rows: existing } = await query('SELECT * FROM student_grade_entries WHERE id = $1', [req.params.id]);
    const entry = existing[0];
    if (entry) {
      const locked = await isSubjectTermLocked({
        studentId: entry.student_id,
        subject: entry.subject,
        gradeLevel: entry.grade_level,
        section: entry.section,
        term: entry.term,
      });
      if (locked) {
        const { userHasPermission } = await import('../lib/permissions.js');
        const canOverride =
          req.user!.role !== 'teacher' &&
          (await userHasPermission(req.user!.id, req.user!.role, req.user!.schoolId, 'grades.finalize'));
        if (!canOverride) {
          res.status(409).json({
            error: 'This subject/term has already been submitted or finalized. Ask your Academic Head to reopen it before editing.',
          });
          return;
        }
      }
    }
    await query('DELETE FROM student_grade_entries WHERE id = $1', [req.params.id]);
    res.status(204).send();
  })
);

apiRouter.post(
  '/students/:id/recalculate-gpa',
  requireAuth,
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
  requireAuth,
  asyncHandler(async (req, res) => {
    const teacherId = await requireOwnTeacherId(req, res);
    if (!teacherId) return;
    const b = req.body;
    const id = `tres-${Date.now()}`;
    const today = new Date().toISOString().split('T')[0];
    await query(
      `INSERT INTO teacher_resources (id, teacher_id, title, type, grade, subject, url, downloads, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8)`,
      [id, teacherId, b.title, b.type, b.grade, b.subject, b.url, today]
    );
    const { rows } = await query('SELECT * FROM teacher_resources WHERE id = $1', [id]);
    res.status(201).json(mapTeacherResource(rows[0]));
  })
);

// TE-010: a teacher's own uploads regardless of review status (bootstrap only
// returns APPROVED resources, so pending/rejected ones aren't visible there).
apiRouter.get(
  '/teacher-resources/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    const teacherId = await requireOwnTeacherId(req, res);
    if (!teacherId) return;
    const { rows } = await query(
      'SELECT * FROM teacher_resources WHERE teacher_id = $1 ORDER BY created_at DESC',
      [teacherId]
    );
    res.json(rows.map(mapTeacherResource));
  })
);

// TE-010: the HoD review queue.
apiRouter.get(
  '/teacher-resources/pending',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!isPrivilegedStaff(req.user!.role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const { rows } = await query(
      "SELECT * FROM teacher_resources WHERE status = 'PENDING' ORDER BY created_at ASC"
    );
    res.json(rows.map(mapTeacherResource));
  })
);

// TE-010: HoD review workflow. A teacher can never approve/reject/remove their own
// upload — only a privileged staff role may.
apiRouter.patch(
  '/teacher-resources/:id/approve',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!isPrivilegedStaff(req.user!.role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const { comment } = req.body as { comment?: string };
    const { rows } = await query(
      `UPDATE teacher_resources SET status = 'APPROVED', reviewed_by = $1, reviewed_at = NOW(), review_comment = $2 WHERE id = $3 RETURNING *`,
      [req.user!.id, comment ?? null, req.params.id]
    );
    if (!rows.length) {
      res.status(404).json({ error: 'Resource not found' });
      return;
    }
    res.json(mapTeacherResource(rows[0]));
  })
);

apiRouter.patch(
  '/teacher-resources/:id/reject',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!isPrivilegedStaff(req.user!.role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const { comment } = req.body as { comment?: string };
    const { rows } = await query(
      `UPDATE teacher_resources SET status = 'REJECTED', reviewed_by = $1, reviewed_at = NOW(), review_comment = $2 WHERE id = $3 RETURNING *`,
      [req.user!.id, comment ?? null, req.params.id]
    );
    if (!rows.length) {
      res.status(404).json({ error: 'Resource not found' });
      return;
    }
    res.json(mapTeacherResource(rows[0]));
  })
);

apiRouter.patch(
  '/teacher-resources/:id/remove',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!isPrivilegedStaff(req.user!.role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const { comment } = req.body as { comment?: string };
    const { rows } = await query(
      `UPDATE teacher_resources SET status = 'REMOVED', reviewed_by = $1, reviewed_at = NOW(), review_comment = $2 WHERE id = $3 RETURNING *`,
      [req.user!.id, comment ?? null, req.params.id]
    );
    if (!rows.length) {
      res.status(404).json({ error: 'Resource not found' });
      return;
    }
    res.json(mapTeacherResource(rows[0]));
  })
);

apiRouter.post(
  '/parent-messages',
  requireAuth,
  asyncHandler(async (req, res) => {
    const teacherId = await requireOwnTeacherId(req, res);
    if (!teacherId) return;
    const b = req.body;
    const id = `pm-${Date.now()}`;
    const today = new Date().toISOString().split('T')[0];
    await query(
      `INSERT INTO parent_messages (id, teacher_id, student_id, student_name, parent_name, message, sent_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, teacherId, b.studentId, b.studentName, b.parentName, b.message, today]
    );
    const { rows } = await query('SELECT * FROM parent_messages WHERE id = $1', [id]);
    res.status(201).json(mapParentMessage(rows[0]));
  })
);

apiRouter.post(
  '/teacher-feedbacks',
  requireAuth,
  asyncHandler(async (req, res) => {
    const teacherId = await requireOwnTeacherId(req, res);
    if (!teacherId) return;
    const b = req.body;
    const { rows: tch } = await query('SELECT name FROM teachers WHERE id = $1', [teacherId]);
    const id = `tfb-${Date.now()}`;
    const today = new Date().toISOString().split('T')[0];
    await query(
      `INSERT INTO teacher_feedbacks (id, teacher_id, student_id, student_name, direction, author_name, author_role, subject, comment, rating, date)
       VALUES ($1,$2,$3,$4,'from_teacher',$5,$6,$7,$8,$9,$10)`,
      [id, teacherId, b.studentId ?? null, b.studentName ?? null, tch[0]?.name ?? 'Teacher', b.authorRole ?? null, b.subject, b.comment, b.rating ?? null, today]
    );
    const { rows } = await query('SELECT * FROM teacher_feedbacks WHERE id = $1', [id]);
    res.status(201).json(mapTeacherFeedback(rows[0]));
  })
);

apiRouter.patch(
  '/teacher-check-in-prompts/:id/respond',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user!.role !== 'teacher') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
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
  requireAuth,
  asyncHandler(async (req, res) => {
    const { title, description, type, linkPath } = req.body;
    const notif = await insertNotification(title, description, type, linkPath);
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
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!isPrivilegedStaff(req.user!.role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    await query('DELETE FROM notifications');
    res.status(204).send();
  })
);

// Lesson deliveries (mark taught + grasp feedback)
apiRouter.post(
  '/lesson-deliveries',
  requireAuth,
  asyncHandler(async (req, res) => {
    const teacherId = await requireOwnTeacherId(req, res);
    if (!teacherId) return;
    const b = req.body;
    const graspOutcome = b.graspOutcome as string;
    if (!['well_grasped', 'majority_grasped', 'challenged'].includes(graspOutcome)) {
      res.status(400).json({ error: 'Invalid grasp outcome' });
      return;
    }
    if (graspOutcome === 'challenged' && !String(b.challengeText ?? '').trim()) {
      res.status(400).json({ error: 'Challenge / opportunity text required' });
      return;
    }

    const noteResult = await query('SELECT * FROM teaching_notes WHERE id = $1', [
      b.teachingNoteId,
    ]);
    if (!noteResult.rows.length) {
      res.status(404).json({ error: 'Teaching note not found' });
      return;
    }
    const note = noteResult.rows[0];
    if ((note.teacher_id as string | null) !== teacherId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const noteStatus = String(note.status || '');
    if (noteStatus !== 'Approved') {
      // Soft path: classroom delivery implies the note was taught — promote to Approved
      // so HoD exam topics and delivery lists stay consistent.
      // Teaching notes no longer need HOD approval to be marked as delivered
      // Auto-approve if not already approved
      if (noteStatus !== 'Approved') {
        await query(
          `UPDATE teaching_notes
           SET status = 'Approved',
               dept_comments = COALESCE(NULLIF(TRIM(dept_comments), ''), 'Auto-approved — classroom delivery recorded.'),
               updated_at = CURRENT_DATE
           WHERE id = $1`,
          [note.id],
        );
        note.status = 'Approved';
      }
    }

    const existingResult = await query(
      'SELECT * FROM lesson_deliveries WHERE teaching_note_id = $1',
      [b.teachingNoteId],
    );
    if (existingResult.rows.length) {
      res.status(409).json({
        error: 'This note is already marked delivered',
        delivery: mapLessonDelivery(existingResult.rows[0]),
      });
      return;
    }

    const { rows: teacherRows } = await query('SELECT * FROM teachers WHERE id = $1', [teacherId]);
    const teacher = teacherRows[0];
    const departmentId = (teacher?.department_id as string | null) ?? null;
    const teacherName = (teacher?.name as string) ?? 'Teacher';

    const postedToHod = Boolean(b.postedToHod);
    const postedToCommunity = Boolean(b.postedToCommunity);
    const deliveryId = b.id ?? `ld-${Date.now()}`;
    let communityPostId: string | null = null;
    let communityMessage: ReturnType<typeof mapCommunityMessage> | null = null;

    const challengeBody =
      graspOutcome === 'challenged' ? String(b.challengeText).trim() : '';

    // Resolve + authorize the Discord-style community channel before writing anything.
    let resolvedChannelId = '';
    let resolvedCommunityId = '';
    const requestUser = req.user!;
    if (graspOutcome === 'challenged' && postedToCommunity) {
      resolvedChannelId = String(b.channelId ?? '').trim();
      resolvedCommunityId = String(b.communityId ?? '').trim();

      if (!resolvedChannelId && resolvedCommunityId) {
        const { rows: chRows } = await query(
          `SELECT id FROM community_channels
           WHERE community_id = $1
           ORDER BY
             CASE WHEN LOWER(name) = 'general' THEN 0 WHEN type = 'text' THEN 1 ELSE 2 END,
             position ASC
           LIMIT 1`,
          [resolvedCommunityId],
        );
        resolvedChannelId = chRows[0]?.id ? String(chRows[0].id) : '';
      }

      if (!resolvedChannelId) {
        res.status(400).json({
          error: 'Select a community channel to post this challenge into.',
        });
        return;
      }

      const { rows: chMeta } = await query(
        'SELECT community_id FROM community_channels WHERE id = $1',
        [resolvedChannelId],
      );
      if (!chMeta.length) {
        res.status(404).json({ error: 'Community channel not found' });
        return;
      }
      resolvedCommunityId = String(chMeta[0].community_id);
      const memberRole = await requireCommunityMembership(
        requestUser.id,
        resolvedCommunityId,
        res,
      );
      if (!memberRole) return;
    }

    if (graspOutcome === 'challenged' && postedToCommunity) {
      communityPostId = `cp-${Date.now()}`;
      const title =
        String(b.challengeTitle ?? '').trim() ||
        `Challenge: ${note.topic || note.title}`;
      await query(
        `INSERT INTO community_posts
         (id, author_id, author_name, author_role, department_id, subject, grade, title, body, teaching_note_id, lesson_plan_id, created_at)
         VALUES ($1,$2,$3,'teacher',$4,$5,$6,$7,$8,$9,$10,NOW())`,
        [
          communityPostId,
          teacherId,
          teacherName,
          departmentId,
          note.subject,
          note.grade,
          title,
          challengeBody,
          note.id,
          note.lesson_plan_id ?? b.lessonPlanId ?? null,
        ],
      );

      const msgContent = [
        `**Classroom challenge** after delivering "${note.title}"`,
        note.subject || note.grade
          ? `_${[note.grade, note.subject].filter(Boolean).join(' · ')}_`
          : '',
        '',
        challengeBody,
      ]
        .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
        .join('\n');

      const msgId = `cmsg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await query(
        `INSERT INTO community_messages (id, channel_id, thread_id, author_id, author_name, author_role, content)
         VALUES ($1,$2,NULL,$3,$4,$5,$6)`,
        [
          msgId,
          resolvedChannelId,
          requestUser!.id,
          requestUser!.displayName,
          requestUser!.role,
          msgContent,
        ],
      );
      await query(
        `INSERT INTO community_channel_reads (channel_id, user_id, last_read_at) VALUES ($1,$2,NOW())
         ON CONFLICT (channel_id, user_id) DO UPDATE SET last_read_at = NOW()`,
        [resolvedChannelId, requestUser!.id],
      );
      const { rows: msgRows } = await query(
        'SELECT * FROM community_messages WHERE id = $1',
        [msgId],
      );
      if (msgRows.length) {
        communityMessage = mapCommunityMessage(msgRows[0], []);
      }
    }

    await query(
      `INSERT INTO lesson_deliveries
       (id, teaching_note_id, lesson_plan_id, teacher_id, grasp_outcome, challenge_text, posted_to_hod, posted_to_community, community_post_id, delivered_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
      [
        deliveryId,
        note.id,
        note.lesson_plan_id ?? b.lessonPlanId ?? null,
        teacherId,
        graspOutcome,
        graspOutcome === 'challenged' ? challengeBody : null,
        postedToHod,
        postedToCommunity,
        communityPostId,
      ],
    );

    if (graspOutcome === 'challenged' && postedToHod) {
      const msgId = `sm-${Date.now()}`;
      await query(
        `INSERT INTO staff_messages
         (id, teacher_id, department_id, sender_id, sender_name, sender_role, body, related_delivery_id, related_post_id, read, created_at)
         VALUES ($1,$2,$3,$4,$5,'teacher',$6,$7,$8,false,NOW())`,
        [
          msgId,
          teacherId,
          departmentId,
          teacherId,
          teacherName,
          `Classroom challenge / opportunity after delivering "${note.title}":\n\n${challengeBody}`,
          deliveryId,
          communityPostId,
        ],
      );
      await insertNotification(
        'Classroom challenge shared',
        `${teacherName} posted a challenge after delivering "${note.title}".`,
        'request',
        '/dashboard/department-head/communication'
      );
    }

    const { rows } = await query('SELECT * FROM lesson_deliveries WHERE id = $1', [deliveryId]);
    const delivery = mapLessonDelivery(rows[0]);
    let communityPost: ReturnType<typeof mapCommunityPost> | null = null;
    if (communityPostId) {
      const { rows: postRows } = await query('SELECT * FROM community_posts WHERE id = $1', [
        communityPostId,
      ]);
      if (postRows.length) communityPost = mapCommunityPost(postRows[0]);
    }
    res.status(201).json({ delivery, communityPost, communityMessage });
  })
);

// Community posts & threaded replies
apiRouter.get(
  '/community/posts',
  asyncHandler(async (_req, res) => {
    const posts = await query('SELECT * FROM community_posts ORDER BY created_at DESC');
    const replies = await query('SELECT * FROM community_replies ORDER BY created_at ASC');
    res.json({
      posts: posts.rows.map(mapCommunityPost),
      replies: replies.rows.map(mapCommunityReply),
    });
  })
);

apiRouter.post(
  '/community/posts',
  asyncHandler(async (req, res) => {
    const b = req.body;
    const id = b.id ?? `cp-${Date.now()}`;
    await query(
      `INSERT INTO community_posts
       (id, author_id, author_name, author_role, department_id, subject, grade, title, body, teaching_note_id, lesson_plan_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
      [
        id,
        b.authorId,
        b.authorName,
        b.authorRole ?? 'teacher',
        b.departmentId ?? null,
        b.subject ?? null,
        b.grade ?? null,
        b.title,
        b.body,
        b.teachingNoteId ?? null,
        b.lessonPlanId ?? null,
      ],
    );
    const { rows } = await query('SELECT * FROM community_posts WHERE id = $1', [id]);
    res.status(201).json(mapCommunityPost(rows[0]));
  })
);

apiRouter.post(
  '/community/posts/:id/replies',
  asyncHandler(async (req, res) => {
    const b = req.body;
    const postId = req.params.id;
    const { rows: posts } = await query('SELECT id FROM community_posts WHERE id = $1', [postId]);
    if (!posts.length) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }
    const id = b.id ?? `cr-${Date.now()}`;
    await query(
      `INSERT INTO community_replies
       (id, post_id, parent_reply_id, author_id, author_name, author_role, body, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
      [
        id,
        postId,
        b.parentReplyId ?? null,
        b.authorId,
        b.authorName,
        b.authorRole ?? 'teacher',
        b.body,
      ],
    );
    const { rows } = await query('SELECT * FROM community_replies WHERE id = $1', [id]);
    res.status(201).json(mapCommunityReply(rows[0]));
  })
);

// Discord-style communities: department "Teachers" communities + a school-wide "Heads of
// Department" community. Teachers only see their own department's community; HoDs see both.
apiRouter.get(
  '/communities',
  asyncHandler(async (req, res) => {
    const user = await getRequestUser(req);
    if (!user) {
      res.status(401).json({ error: 'Missing or unknown user' });
      return;
    }
    await ensureCommunitiesSeeded();
    const { rows } = await query(
      `SELECT c.*, cm.role AS member_role,
        COALESCE((
          SELECT COUNT(*) FROM community_messages msg
          JOIN community_channels ch ON ch.id = msg.channel_id
          LEFT JOIN community_channel_reads r ON r.channel_id = ch.id AND r.user_id = $1
          WHERE ch.community_id = c.id
            AND msg.author_id != $1
            AND msg.is_deleted = FALSE
            AND msg.created_at > COALESCE(r.last_read_at, cm.joined_at)
        ), 0) AS unread_count
       FROM communities c
       JOIN community_members cm ON cm.community_id = c.id AND cm.user_id = $1
       ORDER BY (c.type = 'department') DESC, c.name ASC`,
      [user.id]
    );
    res.json(rows.map(mapCommunity));
  })
);

apiRouter.post(
  '/communities',
  asyncHandler(async (req, res) => {
    const user = await getRequestUser(req);
    if (!user) {
      res.status(401).json({ error: 'Missing or unknown user' });
      return;
    }
    const b = req.body as {
      name?: string;
      description?: string;
      type?: string;
      departmentId?: string;
      iconUrl?: string;
    };
    if (!b.name?.trim()) {
      res.status(400).json({ error: 'Community name is required' });
      return;
    }
    const id = `community-${Date.now()}`;
    await query(
      `INSERT INTO communities (id, name, description, icon_url, type, department_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        b.name.trim(),
        b.description?.trim() || '',
        b.iconUrl ?? null,
        b.type || 'custom',
        b.departmentId ?? null,
        user.id,
      ]
    );
    await ensureDefaultChannels(id);
    await query(
      `INSERT INTO community_members (id, community_id, user_id, role) VALUES ($1,$2,$3,'owner')`,
      [`${id}-${user.id}`, id, user.id]
    );
    const { rows } = await query(
      `SELECT c.*, 'owner' AS member_role, 0 AS unread_count FROM communities c WHERE c.id = $1`,
      [id]
    );
    res.status(201).json(mapCommunity(rows[0]));
  })
);

apiRouter.get(
  '/communities/:id/channels',
  asyncHandler(async (req, res) => {
    const user = await getRequestUser(req);
    if (!user) {
      res.status(401).json({ error: 'Missing or unknown user' });
      return;
    }
    const role = await requireCommunityMembership(user.id, String(req.params.id), res);
    if (!role) return;
    const { rows } = await query(
      `SELECT cc.*,
        COALESCE((
          SELECT COUNT(*) FROM community_messages m
          WHERE m.channel_id = cc.id AND m.author_id != $2 AND m.is_deleted = FALSE
            AND m.created_at > COALESCE(
              (SELECT last_read_at FROM community_channel_reads r WHERE r.channel_id = cc.id AND r.user_id = $2),
              '1970-01-01'
            )
        ), 0) AS unread_count
       FROM community_channels cc
       WHERE cc.community_id = $1
       ORDER BY cc.position ASC, cc.created_at ASC`,
      [req.params.id, user.id]
    );
    res.json(rows.map(mapCommunityChannel));
  })
);

apiRouter.post(
  '/communities/:id/channels',
  asyncHandler(async (req, res) => {
    const user = await getRequestUser(req);
    if (!user) {
      res.status(401).json({ error: 'Missing or unknown user' });
      return;
    }
    const role = await requireCommunityMembership(user.id, String(req.params.id), res);
    if (!role) return;
    if (role !== 'owner' && role !== 'admin') {
      res.status(403).json({ error: 'Only community admins can create channels' });
      return;
    }
    const b = req.body as { name?: string; description?: string; type?: string };
    if (!b.name?.trim()) {
      res.status(400).json({ error: 'Channel name is required' });
      return;
    }
    const id = `chn-${Date.now()}`;
    const { rows: posRows } = await query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM community_channels WHERE community_id = $1',
      [req.params.id]
    );
    await query(
      `INSERT INTO community_channels (id, community_id, name, description, type, position)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        id,
        req.params.id,
        b.name.trim().toLowerCase().replace(/\s+/g, '-'),
        b.description?.trim() || '',
        b.type || 'text',
        posRows[0].pos,
      ]
    );
    const { rows } = await query(
      'SELECT *, 0 AS unread_count FROM community_channels WHERE id = $1',
      [id]
    );
    res.status(201).json(mapCommunityChannel(rows[0]));
  })
);

apiRouter.get(
  '/communities/:id/members',
  asyncHandler(async (req, res) => {
    const user = await getRequestUser(req);
    if (!user) {
      res.status(401).json({ error: 'Missing or unknown user' });
      return;
    }
    const role = await requireCommunityMembership(user.id, String(req.params.id), res);
    if (!role) return;
    const { rows } = await query(
      `SELECT cm.*, pu.display_name, pu.email, pu.role AS user_role
       FROM community_members cm
       JOIN portal_users pu ON pu.id = cm.user_id
       WHERE cm.community_id = $1
       ORDER BY pu.display_name ASC`,
      [req.params.id]
    );
    res.json(rows.map(mapCommunityMember));
  })
);

apiRouter.get(
  '/communities/:id/mention-suggestions',
  asyncHandler(async (req, res) => {
    const user = await getRequestUser(req);
    if (!user) {
      res.status(401).json({ error: 'Missing or unknown user' });
      return;
    }
    const role = await requireCommunityMembership(user.id, String(req.params.id), res);
    if (!role) return;
    const q = String(req.query.q || '').trim().toLowerCase();
    const { rows } = await query(
      `SELECT pu.id, pu.display_name, pu.email, pu.role
       FROM community_members cm
       JOIN portal_users pu ON pu.id = cm.user_id
       WHERE cm.community_id = $1 AND ($2 = '' OR LOWER(pu.display_name) LIKE '%' || $2 || '%')
       ORDER BY pu.display_name ASC
       LIMIT 8`,
      [req.params.id, q]
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        displayName: r.display_name,
        email: r.email,
        role: r.role,
      }))
    );
  })
);

apiRouter.get(
  '/channels/:id/messages',
  asyncHandler(async (req, res) => {
    const user = await getRequestUser(req);
    if (!user) {
      res.status(401).json({ error: 'Missing or unknown user' });
      return;
    }
    const { rows: chRows } = await query(
      'SELECT community_id FROM community_channels WHERE id = $1',
      [req.params.id]
    );
    if (!chRows.length) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }
    const role = await requireCommunityMembership(user.id, chRows[0].community_id, res);
    if (!role) return;
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const before = typeof req.query.before === 'string' ? req.query.before : null;
    const params: unknown[] = [req.params.id];
    let whereBefore = '';
    if (before) {
      params.push(before);
      whereBefore = `AND m.created_at < (SELECT created_at FROM community_messages WHERE id = $${params.length})`;
    }
    params.push(limit + 1);
    const { rows } = await query(
      `SELECT m.*,
        (SELECT t.id FROM community_threads t WHERE t.root_message_id = m.id LIMIT 1) AS thread_id_for_root,
        (SELECT COUNT(*) FROM community_messages tm
          WHERE tm.thread_id = (SELECT t.id FROM community_threads t WHERE t.root_message_id = m.id LIMIT 1)
            AND tm.is_deleted = FALSE) AS thread_reply_count
       FROM community_messages m
       WHERE m.channel_id = $1 AND m.is_deleted = FALSE ${whereBefore}
       ORDER BY m.created_at DESC
       LIMIT $${params.length}`,
      params
    );
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse();
    const messages = await attachReactions(page, user.id);
    res.json({ messages, hasMore });
  })
);

apiRouter.post(
  '/channels/:id/messages',
  asyncHandler(async (req, res) => {
    const user = await getRequestUser(req);
    if (!user) {
      res.status(401).json({ error: 'Missing or unknown user' });
      return;
    }
    const { rows: chRows } = await query(
      'SELECT community_id FROM community_channels WHERE id = $1',
      [req.params.id]
    );
    if (!chRows.length) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }
    const role = await requireCommunityMembership(user.id, chRows[0].community_id, res);
    if (!role) return;
    const content = String((req.body as { content?: string }).content || '').trim();
    if (!content) {
      res.status(400).json({ error: 'Message cannot be empty' });
      return;
    }
    const id = `cmsg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await query(
      `INSERT INTO community_messages (id, channel_id, thread_id, author_id, author_name, author_role, content)
       VALUES ($1,$2,NULL,$3,$4,$5,$6)`,
      [id, req.params.id, user.id, user.displayName, user.role, content]
    );
    await query(
      `INSERT INTO community_channel_reads (channel_id, user_id, last_read_at) VALUES ($1,$2,NOW())
       ON CONFLICT (channel_id, user_id) DO UPDATE SET last_read_at = NOW()`,
      [req.params.id, user.id]
    );
    await createMentionNotifications(id, content, chRows[0].community_id, user.id);
    const { rows } = await query('SELECT * FROM community_messages WHERE id = $1', [id]);
    res.status(201).json(mapCommunityMessage(rows[0], []));
  })
);

apiRouter.post(
  '/channels/:id/read',
  asyncHandler(async (req, res) => {
    const user = await getRequestUser(req);
    if (!user) {
      res.status(401).json({ error: 'Missing or unknown user' });
      return;
    }
    await query(
      `INSERT INTO community_channel_reads (channel_id, user_id, last_read_at) VALUES ($1,$2,NOW())
       ON CONFLICT (channel_id, user_id) DO UPDATE SET last_read_at = NOW()`,
      [req.params.id, user.id]
    );
    res.json({ ok: true });
  })
);

apiRouter.post(
  '/messages/:id/thread',
  asyncHandler(async (req, res) => {
    const user = await getRequestUser(req);
    if (!user) {
      res.status(401).json({ error: 'Missing or unknown user' });
      return;
    }
    const { rows: msgRows } = await query('SELECT * FROM community_messages WHERE id = $1', [
      req.params.id,
    ]);
    if (!msgRows.length) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    const msg = msgRows[0];
    if (!msg.channel_id) {
      res.status(400).json({ error: 'Only channel messages can start a thread' });
      return;
    }
    const { rows: chRows } = await query(
      'SELECT community_id FROM community_channels WHERE id = $1',
      [msg.channel_id]
    );
    const role = await requireCommunityMembership(user.id, chRows[0]?.community_id, res);
    if (!role) return;
    const { rows: existing } = await query(
      'SELECT * FROM community_threads WHERE root_message_id = $1',
      [req.params.id]
    );
    if (existing.length) {
      res.status(200).json(mapCommunityThread(existing[0], 0));
      return;
    }
    const id = `thr-${Date.now()}`;
    const title = String((req.body as { title?: string }).title || msg.content).slice(0, 80);
    await query(
      `INSERT INTO community_threads (id, channel_id, title, created_by, root_message_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, msg.channel_id, title, user.id, req.params.id]
    );
    const { rows } = await query('SELECT * FROM community_threads WHERE id = $1', [id]);
    res.status(201).json(mapCommunityThread(rows[0], 0));
  })
);

apiRouter.get(
  '/threads/:id',
  asyncHandler(async (req, res) => {
    const user = await getRequestUser(req);
    if (!user) {
      res.status(401).json({ error: 'Missing or unknown user' });
      return;
    }
    const { rows } = await query('SELECT * FROM community_threads WHERE id = $1', [
      req.params.id,
    ]);
    if (!rows.length) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    const { rows: countRows } = await query(
      'SELECT COUNT(*)::int AS c FROM community_messages WHERE thread_id = $1 AND is_deleted = FALSE',
      [req.params.id]
    );
    res.json(mapCommunityThread(rows[0], countRows[0].c));
  })
);

apiRouter.get(
  '/threads/:id/messages',
  asyncHandler(async (req, res) => {
    const user = await getRequestUser(req);
    if (!user) {
      res.status(401).json({ error: 'Missing or unknown user' });
      return;
    }
    const { rows: threadRows } = await query('SELECT * FROM community_threads WHERE id = $1', [
      req.params.id,
    ]);
    if (!threadRows.length) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    const thread = threadRows[0];
    let rootMessage: ReturnType<typeof mapCommunityMessage> | null = null;
    if (thread.root_message_id) {
      const { rows: rootRows } = await query('SELECT * FROM community_messages WHERE id = $1', [
        thread.root_message_id,
      ]);
      if (rootRows.length) rootMessage = mapCommunityMessage(rootRows[0], []);
    }
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const { rows } = await query(
      `SELECT * FROM community_messages WHERE thread_id = $1 AND is_deleted = FALSE
       ORDER BY created_at ASC LIMIT $2`,
      [req.params.id, limit]
    );
    const messages = await attachReactions(rows, user.id);
    const { rows: countRows } = await query(
      'SELECT COUNT(*)::int AS c FROM community_messages WHERE thread_id = $1 AND is_deleted = FALSE',
      [req.params.id]
    );
    res.json({
      thread: mapCommunityThread(thread, countRows[0].c),
      rootMessage,
      messages,
      hasMore: false,
    });
  })
);

apiRouter.post(
  '/threads/:id/messages',
  asyncHandler(async (req, res) => {
    const user = await getRequestUser(req);
    if (!user) {
      res.status(401).json({ error: 'Missing or unknown user' });
      return;
    }
    const { rows: threadRows } = await query('SELECT * FROM community_threads WHERE id = $1', [
      req.params.id,
    ]);
    if (!threadRows.length) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    const content = String((req.body as { content?: string }).content || '').trim();
    if (!content) {
      res.status(400).json({ error: 'Message cannot be empty' });
      return;
    }
    const id = `tmsg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await query(
      `INSERT INTO community_messages (id, channel_id, thread_id, author_id, author_name, author_role, content)
       VALUES ($1,NULL,$2,$3,$4,$5,$6)`,
      [id, req.params.id, user.id, user.displayName, user.role, content]
    );
    const { rows: chanRows } = await query(
      'SELECT community_id FROM community_channels WHERE id = $1',
      [threadRows[0].channel_id]
    );
    if (chanRows.length) {
      await createMentionNotifications(id, content, chanRows[0].community_id, user.id);
    }
    const { rows } = await query('SELECT * FROM community_messages WHERE id = $1', [id]);
    res.status(201).json(mapCommunityMessage(rows[0], []));
  })
);

apiRouter.post(
  '/threads/:id/read',
  asyncHandler(async (req, res) => {
    const user = await getRequestUser(req);
    if (!user) {
      res.status(401).json({ error: 'Missing or unknown user' });
      return;
    }
    await query(
      `INSERT INTO community_thread_reads (thread_id, user_id, last_read_at) VALUES ($1,$2,NOW())
       ON CONFLICT (thread_id, user_id) DO UPDATE SET last_read_at = NOW()`,
      [req.params.id, user.id]
    );
    res.json({ ok: true });
  })
);

apiRouter.post(
  '/messages/:id/reactions',
  asyncHandler(async (req, res) => {
    const user = await getRequestUser(req);
    if (!user) {
      res.status(401).json({ error: 'Missing or unknown user' });
      return;
    }
    const emoji = String((req.body as { emoji?: string }).emoji || '').trim();
    if (!emoji) {
      res.status(400).json({ error: 'Emoji is required' });
      return;
    }
    const { rows: existing } = await query(
      'SELECT id FROM community_message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
      [req.params.id, user.id, emoji]
    );
    if (existing.length) {
      await query('DELETE FROM community_message_reactions WHERE id = $1', [existing[0].id]);
      res.json({ toggled: 'removed', emoji });
      return;
    }
    await query(
      `INSERT INTO community_message_reactions (id, message_id, user_id, emoji) VALUES ($1,$2,$3,$4)`,
      [`rxn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, req.params.id, user.id, emoji]
    );
    res.json({ toggled: 'added', emoji });
  })
);

apiRouter.delete(
  '/messages/:id',
  asyncHandler(async (req, res) => {
    const user = await getRequestUser(req);
    if (!user) {
      res.status(401).json({ error: 'Missing or unknown user' });
      return;
    }
    const { rows } = await query('SELECT author_id FROM community_messages WHERE id = $1', [
      req.params.id,
    ]);
    if (!rows.length) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    const isModerator = ['department-head', 'school-head', 'moe'].includes(user.role);
    if (rows[0].author_id !== user.id && !isModerator) {
      res.status(403).json({ error: 'Not allowed to delete this message' });
      return;
    }
    await query('UPDATE community_messages SET is_deleted = TRUE WHERE id = $1', [req.params.id]);
    res.status(204).end();
  })
);

apiRouter.patch(
  '/messages/:id',
  asyncHandler(async (req, res) => {
    const user = await getRequestUser(req);
    if (!user) {
      res.status(401).json({ error: 'Missing or unknown user' });
      return;
    }
    const { rows } = await query('SELECT author_id FROM community_messages WHERE id = $1', [
      req.params.id,
    ]);
    if (!rows.length) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    if (rows[0].author_id !== user.id) {
      res.status(403).json({ error: 'Not allowed to edit this message' });
      return;
    }
    const content = String((req.body as { content?: string }).content || '').trim();
    if (!content) {
      res.status(400).json({ error: 'Message cannot be empty' });
      return;
    }
    await query('UPDATE community_messages SET content = $1, edited_at = NOW() WHERE id = $2', [
      content,
      req.params.id,
    ]);
    const { rows: updated } = await query('SELECT * FROM community_messages WHERE id = $1', [
      req.params.id,
    ]);
    res.json(mapCommunityMessage(updated[0], []));
  })
);

apiRouter.get(
  '/community/notifications',
  asyncHandler(async (req, res) => {
    const user = await getRequestUser(req);
    if (!user) {
      res.status(401).json({ error: 'Missing or unknown user' });
      return;
    }
    const { rows } = await query(
      `SELECT n.*, m.content, m.author_name, m.channel_id, m.thread_id, cc.community_id
       FROM community_mention_notifications n
       JOIN community_messages m ON m.id = n.message_id
       LEFT JOIN community_threads th ON th.id = m.thread_id
       LEFT JOIN community_channels cc ON cc.id = COALESCE(m.channel_id, th.channel_id)
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC
       LIMIT 50`,
      [user.id]
    );
    res.json(rows.map(mapMentionNotification));
  })
);

apiRouter.post(
  '/community/notifications/:id/read',
  asyncHandler(async (req, res) => {
    await query('UPDATE community_mention_notifications SET is_read = TRUE WHERE id = $1', [
      req.params.id,
    ]);
    res.json({ ok: true });
  })
);

apiRouter.post(
  '/community/notifications/read-all',
  asyncHandler(async (req, res) => {
    const user = await getRequestUser(req);
    if (!user) {
      res.status(401).json({ error: 'Missing or unknown user' });
      return;
    }
    await query('UPDATE community_mention_notifications SET is_read = TRUE WHERE user_id = $1', [
      user.id,
    ]);
    res.json({ ok: true });
  })
);

// Teacher ↔ HoD staff messages (polled for near-real-time)
apiRouter.get(
  '/staff-messages',
  requireAuth,
  asyncHandler(async (req, res) => {
    let teacherId = typeof req.query.teacherId === 'string' ? req.query.teacherId : null;
    if (req.user!.role === 'teacher') {
      teacherId = await resolveOwnTeacherId(req.user!);
      if (!teacherId) {
        res.status(403).json({ error: 'No teacher record is linked to this account' });
        return;
      }
    } else if (!isPrivilegedStaff(req.user!.role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const departmentId =
      typeof req.query.departmentId === 'string' ? req.query.departmentId : null;
    const since = typeof req.query.since === 'string' ? req.query.since : null;

    let sql = 'SELECT * FROM staff_messages WHERE 1=1';
    const vals: unknown[] = [];
    let i = 1;
    if (teacherId) {
      sql += ` AND teacher_id = $${i++}`;
      vals.push(teacherId);
    }
    if (departmentId) {
      sql += ` AND department_id = $${i++}`;
      vals.push(departmentId);
    }
    if (since) {
      sql += ` AND created_at > $${i++}`;
      vals.push(since);
    }
    sql += ' ORDER BY created_at ASC';
    const { rows } = await query(sql, vals);
    res.json(rows.map(mapStaffMessage));
  })
);

apiRouter.post(
  '/staff-messages',
  requireAuth,
  asyncHandler(async (req, res) => {
    const b = req.body;
    if (!b.body?.trim()) {
      res.status(400).json({ error: 'Missing required message fields' });
      return;
    }
    const senderRole = req.user!.role === 'teacher' ? 'teacher' : 'department-head';
    let teacherId: string | null;
    if (senderRole === 'teacher') {
      teacherId = await resolveOwnTeacherId(req.user!);
      if (!teacherId) {
        res.status(403).json({ error: 'No teacher record is linked to this account' });
        return;
      }
    } else {
      if (!isPrivilegedStaff(req.user!.role) || !b.teacherId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      teacherId = b.teacherId;
    }
    const id = b.id ?? `sm-${Date.now()}`;
    let departmentId = b.departmentId ?? null;
    if (!departmentId) {
      const { rows: tch } = await query('SELECT department_id FROM teachers WHERE id = $1', [
        teacherId,
      ]);
      departmentId = tch[0]?.department_id ?? null;
    }
    await query(
      `INSERT INTO staff_messages
       (id, teacher_id, department_id, sender_id, sender_name, sender_role, body, related_delivery_id, related_post_id, read, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false,NOW())`,
      [
        id,
        teacherId,
        departmentId,
        req.user!.id,
        req.user!.displayName,
        senderRole,
        String(b.body).trim(),
        b.relatedDeliveryId ?? null,
        b.relatedPostId ?? null,
      ],
    );
    if (senderRole === 'teacher') {
      const isMissReport = String(b.body).includes('[GRADE_MISS_REPORT]');
      await insertNotification(
        isMissReport ? 'Grade gap report' : 'Message from teacher',
        `${req.user!.displayName}: ${String(b.body).trim().slice(0, 120)}`,
        isMissReport ? 'request' : 'info',
        isMissReport
          ? '/dashboard/department-head/training'
          : '/dashboard/department-head/communication',
      );
    } else {
      await insertNotification(
        'Message from HoD',
        `${req.user!.displayName}: ${String(b.body).trim().slice(0, 120)}`,
        'info',
        '/dashboard/teacher/communication',
      );
    }
    const { rows } = await query('SELECT * FROM staff_messages WHERE id = $1', [id]);
    res.status(201).json(mapStaffMessage(rows[0]));
  })
);

apiRouter.patch(
  '/staff-messages/mark-read',
  requireAuth,
  asyncHandler(async (req, res) => {
    let teacherId: string | null;
    const readerRole: 'teacher' | 'department-head' = req.user!.role === 'teacher' ? 'teacher' : 'department-head';
    if (readerRole === 'teacher') {
      teacherId = await resolveOwnTeacherId(req.user!);
      if (!teacherId) {
        res.status(403).json({ error: 'No teacher record is linked to this account' });
        return;
      }
    } else {
      if (!isPrivilegedStaff(req.user!.role)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      teacherId = typeof req.body?.teacherId === 'string' ? req.body.teacherId : null;
      if (!teacherId) {
        res.status(400).json({ error: 'teacherId required' });
        return;
      }
    }
    const opposite = readerRole === 'teacher' ? 'department-head' : 'teacher';
    await query(
      `UPDATE staff_messages SET read = true WHERE teacher_id = $1 AND sender_role = $2 AND read = false`,
      [teacherId, opposite],
    );
    res.json({ ok: true });
  })
);
