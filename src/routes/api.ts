import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query, withTransaction } from '../db/pool.js';
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
  mapStaffMessage,
  mapCommunityMessage,
  mapTeacherSelfAssessment,
  mapTeacherTrainingAssignment,
  mapTeacherLessonAdjustment,
  mapMoeDocument,
  mapLeadershipAction,
  mapSchoolResource,
  mapComplianceRequirement,
  mapSchoolComplianceStatus,
  mapMoeMessageThread,
  mapMoeThreadMessage,
  mapMoeCalendarDraft,
} from '../lib/serialize.js';
import { resourceUpload } from '../lib/uploads.js';
import { newId, referenceCode } from '../lib/ids.js';
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
import { attachPermissions, optionalAuth, requireAuth, requirePermission, enforceSchoolScope } from '../middleware/auth.js';
import { signAccessToken } from '../lib/tokens.js';
import { writeAudit } from '../lib/audit.js';
import { rateLimit } from '../lib/rateLimit.js';
import { runBillingJobs } from '../services/jobs.js';
import { currentAcademicYear } from '../lib/academicYear.js';

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
  linkPath?: string | null,
  target?: { userId?: string | null; schoolId?: string | null }
) {
  const id = `not-gen-${Date.now()}`;
  await query(
    `INSERT INTO notifications (id, title, description, timestamp_label, read, type, link_path, user_id, school_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, title, description, 'Just now', false, type, linkPath ?? null, target?.userId ?? null, target?.schoolId ?? null]
  );
  const { rows } = await query('SELECT * FROM notifications WHERE id = $1', [id]);
  return mapNotification(rows[0]);
}

/** Teacher <-> portal_user linkage is by email (see routes/portal.ts); there is no
 * teacher_id column on portal_users. */
async function resolveOwnTeacherId(user: { role: string; email: string }): Promise<string | null> {
  const { rows } = await query('SELECT id FROM teachers WHERE LOWER(email) = LOWER($1)', [user.email]);
  return (rows[0]?.id as string | undefined) ?? null;
}

/** For self-service actions (a teacher recording their own delivery, resource, feedback,
 * etc.) ΓÇö never trusts a client-supplied teacherId, always resolves it from the
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

apiRouter.post('/uploads', requireAuth, (req, res) => {
  resourceUpload.single('file')(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: err.message || 'Upload failed' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }
    // A relative path, not an absolute host:port URL — the host that happened to handle
    // this specific upload request isn't necessarily reachable later (a local dev backend
    // can move ports across restarts, sit behind a relay, or the app can simply be
    // redeployed) which used to bake a URL that would later fail with "connection
    // refused". The frontend resolves this against whichever backend is currently
    // configured (see resolveResourceUrl in lib/api.ts).
    const url = `/uploads/${req.file.filename}`;
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

async function createUserSession(userId: string, req: Request): Promise<string> {
  const id = newId('sess');
  await query(
    `INSERT INTO user_sessions (id, user_id, user_agent, ip) VALUES ($1,$2,$3,$4)`,
    [id, userId, req.headers['user-agent'] ?? null, req.ip ?? null]
  );
  return id;
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
    const sessionId = await createUserSession(user.id, req);
    const token = signAccessToken(
      {
        id: user.id,
        role: user.role,
        schoolId: user.school_id ?? null,
      },
      undefined,
      sessionId
    );
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
    const registerSessionId = await createUserSession(rows[0].id, req);
    const token = signAccessToken(
      {
        id: rows[0].id,
        role: rows[0].role,
        schoolId: rows[0].school_id ?? null,
      },
      undefined,
      registerSessionId
    );
    res.status(201).json({
      ...mapPortalUser({
        ...(rows[0] as Parameters<typeof mapPortalUser>[0]),
        permissions: withPerms.permissions,
      }),
      token,
    });
  })
);

apiRouter.post(
  '/auth/change-password',
  requireAuth,
  rateLimit({ windowMs: 60_000, max: 10 }),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Current and new password are required' });
      return;
    }
    if (newPassword.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }
    const { rows } = await query('SELECT * FROM portal_users WHERE id = $1', [req.user!.id]);
    if (!rows.length || !(await verifyPassword(rows[0], currentPassword))) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await query(
      'UPDATE portal_users SET password_hash = $1, password = NULL WHERE id = $2',
      [passwordHash, req.user!.id]
    );
    // A password change is a security event ΓÇö sign out every other device.
    await query(
      'UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL AND id != $2',
      [req.user!.id, req.user!.sessionId ?? '']
    );
    res.json({ ok: true });
  })
);

apiRouter.get(
  '/auth/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT id, user_agent, ip, created_at, last_seen_at
       FROM user_sessions WHERE user_id = $1 AND revoked_at IS NULL
       ORDER BY last_seen_at DESC`,
      [req.user!.id]
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        userAgent: r.user_agent ?? undefined,
        ip: r.ip ?? undefined,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
        current: r.id === req.user!.sessionId,
      }))
    );
  })
);

apiRouter.delete(
  '/auth/sessions/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rowCount } = await query(
      'UPDATE user_sessions SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
      [req.params.id, req.user!.id]
    );
    if (!rowCount) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ ok: true });
  })
);

apiRouter.post(
  '/auth/sessions/revoke-others',
  requireAuth,
  asyncHandler(async (req, res) => {
    await query(
      'UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL AND id != $2',
      [req.user!.id, req.user!.sessionId ?? '']
    );
    res.json({ ok: true });
  })
);

// Regions ΓÇö MOE's authoritative catalog of region names schools are connected under.
apiRouter.get(
  '/regions',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const { rows } = await query('SELECT id, name FROM regions ORDER BY name');
    res.json(rows.map((r) => ({ id: r.id, name: r.name })));
  })
);

apiRouter.post(
  '/regions',
  requireAuth,
  requirePermission('regions.manage'),
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (!name) {
      res.status(400).json({ error: 'Region name is required' });
      return;
    }
    const { rows: dupe } = await query('SELECT id FROM regions WHERE LOWER(name) = LOWER($1)', [name]);
    if (dupe.length) {
      res.status(409).json({ error: 'A region with this name already exists' });
      return;
    }
    const id = newId('reg');
    await query('INSERT INTO regions (id, name) VALUES ($1,$2)', [id, name]);
    res.status(201).json({ id, name });
  })
);

apiRouter.patch(
  '/regions/:id',
  requireAuth,
  requirePermission('regions.manage'),
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (!name) {
      res.status(400).json({ error: 'Region name is required' });
      return;
    }
    const { rows: dupe } = await query(
      'SELECT id FROM regions WHERE LOWER(name) = LOWER($1) AND id != $2',
      [name, req.params.id]
    );
    if (dupe.length) {
      res.status(409).json({ error: 'A region with this name already exists' });
      return;
    }
    const { rows: cur } = await query('SELECT name FROM regions WHERE id = $1', [req.params.id]);
    if (!cur.length) {
      res.status(404).json({ error: 'Region not found' });
      return;
    }
    // Schools reference regions by name (see schema note), so a rename must carry forward
    // to every school currently connected under the old name.
    await withTransaction(async (client) => {
      await client.query('UPDATE schools SET region = $1 WHERE region = $2', [name, cur[0].name]);
      await client.query('UPDATE regions SET name = $1 WHERE id = $2', [name, req.params.id]);
    });
    res.json({ id: req.params.id, name });
  })
);

function generateTemporaryPassword(): string {
  return crypto.randomBytes(9).toString('base64url');
}

// School Connect/Activate ΓÇö replaces the old free-form "Register School" flow.
// MOE searches/enters the institution's details (no live EMIS registry exists yet
// ΓÇö see emis_id/registry_source schema notes), activates its PRIME participation,
// and assigns the platform administrator in one step.
apiRouter.post(
  '/schools/connect',
  requireAuth,
  requirePermission('schools.connect'),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      name?: string; region?: string; type?: string; principal?: string;
      email?: string; phone?: string; capacity?: number; emisId?: string;
      adminName?: string; adminEmail?: string;
      confirmDuplicate?: boolean;
    };
    if (!body.name || !body.region || !body.type || !body.principal || !body.email || !body.adminName || !body.adminEmail) {
      res.status(400).json({ error: 'Missing required institution or administrator details' });
      return;
    }
    const { rows: regionRows } = await query('SELECT id FROM regions WHERE LOWER(name) = LOWER($1)', [body.region]);
    if (!regionRows.length) {
      res.status(400).json({ error: 'Unknown region ΓÇö add it to the region catalog first' });
      return;
    }
    const { rows: dupes } = await query(
      `SELECT id, code FROM schools WHERE LOWER(name) = LOWER($1) AND LOWER(region) = LOWER($2)`,
      [body.name, body.region]
    );
    if (dupes.length && !body.confirmDuplicate) {
      res.status(409).json({
        error: 'A school with this name already exists in this region',
        existing: { id: dupes[0].id, code: dupes[0].code },
      });
      return;
    }
    const normalizedAdminEmail = body.adminEmail.trim().toLowerCase();
    const { rows: existingUser } = await query('SELECT id FROM portal_users WHERE LOWER(email) = $1', [normalizedAdminEmail]);
    if (existingUser.length) {
      res.status(409).json({ error: 'An account with this administrator email already exists' });
      return;
    }

    const { rows: existing } = await query('SELECT COUNT(*)::int AS c FROM schools');
    const schoolId = `sch-${existing[0].c + 1}`;
    const code = `SCH-${100 + Number(existing[0].c)}`;
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    const { rows: userCount } = await query('SELECT COUNT(*)::int AS c FROM portal_users');
    const adminUserId = `usr-${userCount[0].c + 1}`;

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO schools (id, code, name, region, type, principal, email, phone, capacity, students_count, teachers_count, status, gps, registry_source, emis_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,0,'Active','9.0320┬░ N, 38.7489┬░ E',$10,$11)`,
        [schoolId, code, body.name, body.region, body.type, body.principal, body.email, body.phone ?? '', body.capacity ?? 0, body.emisId ? 'emis' : 'manual', body.emisId ?? null]
      );
      await client.query(
        `INSERT INTO portal_users (id, email, password, password_hash, role, display_name, school_id)
         VALUES ($1,$2,'',$3,'school-head',$4,$5)`,
        [adminUserId, normalizedAdminEmail, passwordHash, body.adminName, schoolId]
      );
    });

    await writeAudit({
      schoolId,
      actorUserId: req.user!.id,
      action: 'school.connected',
      entityType: 'school',
      entityId: schoolId,
      metadata: { registrySource: body.emisId ? 'emis' : 'manual', adminEmail: normalizedAdminEmail },
    });
    await insertNotification(
      'School Connected to PRIME EduAI',
      `${body.name} was connected and activated under code ${code}.`,
      'success',
      null,
      { userId: req.user!.id }
    );

    const { rows } = await query('SELECT * FROM schools WHERE id = $1', [schoolId]);
    res.status(201).json({
      school: mapSchool(rows[0]),
      admin: { id: adminUserId, email: normalizedAdminEmail, displayName: body.adminName, temporaryPassword },
    });
  })
);

// Deliberate connection-lifecycle action (from the "Manage Connection" dialog) ΓÇö
// not a blunt one-click table toggle, since disconnecting a school from PRIME
// participation is a significant, auditable decision.
apiRouter.patch(
  '/schools/:id/integration-status',
  requireAuth,
  requirePermission('schools.connect'),
  asyncHandler(async (req, res) => {
    const status = req.body?.status === 'Suspended' ? 'Suspended' : req.body?.status === 'Active' ? 'Active' : null;
    if (!status) {
      res.status(400).json({ error: 'status must be "Active" or "Suspended"' });
      return;
    }
    const { rows: cur } = await query('SELECT * FROM schools WHERE id = $1', [req.params.id]);
    if (!cur.length) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    await query('UPDATE schools SET status = $1 WHERE id = $2', [status, req.params.id]);
    await writeAudit({
      schoolId: String(req.params.id),
      actorUserId: req.user!.id,
      action: status === 'Active' ? 'school.reactivated' : 'school.deactivated',
      entityType: 'school',
      entityId: String(req.params.id),
    });
    const { rows } = await query('SELECT * FROM schools WHERE id = $1', [req.params.id]);
    res.json(mapSchool(rows[0]));
  })
);

// Institution profile fields a school head may edit about their own school
// (name/contact/region). Status, capacity, and counts remain MOE-managed elsewhere.
const SCHOOL_PROFILE_EDIT_FIELDS = ['name', 'principal', 'email', 'phone', 'region'] as const;

apiRouter.patch(
  '/schools/:id',
  requireAuth,
  requirePermission('school.settings'),
  asyncHandler(async (req, res) => {
    if (!requireOwnSchool(req, res, req.params.id)) return;
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const key of SCHOOL_PROFILE_EDIT_FIELDS) {
      if (req.body[key] !== undefined) {
        vals.push(req.body[key]);
        sets.push(`${key} = $${vals.length}`);
      }
    }
    if (!sets.length) {
      res.status(400).json({ error: 'No profile fields provided' });
      return;
    }
    vals.push(req.params.id);
    const { rowCount } = await query(
      `UPDATE schools SET ${sets.join(', ')} WHERE id = $${vals.length}`,
      vals
    );
    if (!rowCount) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const { rows } = await query('SELECT * FROM schools WHERE id = $1', [req.params.id]);
    res.json(mapSchool(rows[0]));
  })
);

/** MOE may act on any school; everyone else is confined to their own. */
function requireOwnSchool(req: Request, res: Response, schoolId: string | string[]): boolean {
  const id = Array.isArray(schoolId) ? schoolId[0] : schoolId;
  if (req.user!.role !== 'moe' && req.user!.schoolId !== id) {
    res.status(403).json({ error: 'Cross-school access denied' });
    return false;
  }
  return true;
}

// School Administration > Integrations. Persists real configuration per school;
// never claims a verified external connection since no live credentials exist for
// any of these providers yet (see architecture notes in schema_portal.sql).
const INTEGRATION_TYPES = ['emis', 'sms', 'email'] as const;

apiRouter.get(
  '/schools/:id/integrations',
  requireAuth,
  requirePermission('school.settings'),
  asyncHandler(async (req, res) => {
    if (!requireOwnSchool(req, res, req.params.id)) return;
    const { rows } = await query(
      'SELECT integration_type, status, config, updated_at FROM school_integrations WHERE school_id = $1',
      [req.params.id]
    );
    const byType = new Map(rows.map((r) => [r.integration_type as string, r]));
    res.json(
      INTEGRATION_TYPES.map((type) => {
        const row = byType.get(type);
        return {
          type,
          status: row?.status ?? 'not_configured',
          config: row?.config ?? {},
          updatedAt: row?.updated_at ?? null,
        };
      })
    );
  })
);

apiRouter.put(
  '/schools/:id/integrations/:type',
  requireAuth,
  requirePermission('school.settings'),
  asyncHandler(async (req, res) => {
    if (!requireOwnSchool(req, res, req.params.id)) return;
    const type = req.params.type as (typeof INTEGRATION_TYPES)[number];
    if (!INTEGRATION_TYPES.includes(type)) {
      res.status(400).json({ error: 'Unknown integration type' });
      return;
    }
    const config = req.body?.config && typeof req.body.config === 'object' ? req.body.config : {};
    const status = req.body?.status === 'disabled' ? 'disabled' : 'configured';
    await query(
      `INSERT INTO school_integrations (school_id, integration_type, status, config, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (school_id, integration_type)
       DO UPDATE SET status = $3, config = $4, updated_by = $5, updated_at = NOW()`,
      [req.params.id, type, status, JSON.stringify(config), req.user!.id]
    );
    const { rows } = await query(
      'SELECT integration_type, status, config, updated_at FROM school_integrations WHERE school_id = $1 AND integration_type = $2',
      [req.params.id, type]
    );
    res.json({
      type,
      status: rows[0].status,
      config: rows[0].config,
      updatedAt: rows[0].updated_at,
    });
  })
);

// School Administration > Data & Privacy: a real, school-scoped export of the
// institution's own core records (not a fabricated "email sent" confirmation ΓÇö
// the caller downloads the actual data).
apiRouter.get(
  '/schools/:id/data-export',
  requireAuth,
  requirePermission('school.settings'),
  asyncHandler(async (req, res) => {
    if (!requireOwnSchool(req, res, req.params.id)) return;
    const schoolId = req.params.id;
    const [school, teachers, students, classes, departments] = await Promise.all([
      query('SELECT * FROM schools WHERE id = $1', [schoolId]),
      query('SELECT * FROM teachers WHERE school_id = $1', [schoolId]),
      query('SELECT * FROM students WHERE school_id = $1', [schoolId]),
      query('SELECT * FROM school_classes WHERE school_id = $1', [schoolId]),
      // departments has no school_id column in this schema (single-school scoped table)
      query('SELECT * FROM departments'),
    ]);
    res.setHeader('Content-Disposition', `attachment; filename="school-${schoolId}-export.json"`);
    res.json({
      exportedAt: new Date().toISOString(),
      school: school.rows[0] ? mapSchool(school.rows[0]) : null,
      teachers: teachers.rows.map((r) => mapTeacher(r)),
      students: students.rows.map(mapStudent),
      classes: classes.rows.map(mapSchoolClass),
      departments: departments.rows.map(mapDepartment),
    });
  })
);

// Teachers ΓÇö creating/editing a teacher record touches personal contact info
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

// Fields a teacher may change on their own record via self-service settings ΓÇö
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
    // experienceOverride is nullable ΓÇö 'new' | 'experienced' | null clears the manual override.
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
    if (cur[0].status === 'Left') {
      res.status(409).json({ error: 'Departed teachers cannot be toggled Active/On Leave' });
      return;
    }
    await query('UPDATE teachers SET status = $1 WHERE id = $2', [next, req.params.id]);
    const { rows } = await query('SELECT * FROM teachers WHERE id = $1', [req.params.id]);
    res.json(mapTeacher(rows[0]));
  })
);

function mapTeacherReplacementRequest(row: Record<string, unknown>) {
  const parseJsonArray = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        return [];
      }
    }
    return [];
  };
  return {
    id: row.id,
    schoolId: row.school_id,
    departingTeacherId: row.departing_teacher_id,
    departureDate: row.departure_date,
    reason: row.reason,
    subjectsNeeded: parseJsonArray(row.subjects_needed),
    gradeLevelsNeeded: parseJsonArray(row.grade_levels_needed),
    notes: row.notes ?? null,
    status: row.status,
    assignedTeacherId: row.assigned_teacher_id ?? null,
    moeReviewedBy: row.moe_reviewed_by ?? null,
    moeNotes: row.moe_notes ?? null,
    moeThreadId: row.moe_thread_id ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at ?? null,
    schoolName: row.school_name ?? undefined,
    departingTeacherName: row.departing_teacher_name ?? undefined,
    assignedTeacherName: row.assigned_teacher_name ?? undefined,
  };
}

// Public-school departure notice + MOE teacher replacement
apiRouter.get(
  '/teacher-replacement-requests',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const status = req.query.status as string | undefined;
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (user.role === 'moe') {
      // MOE sees all Public-school staffing requests
    } else if (user.role === 'school-head') {
      const canRequest = await import('../lib/permissions.js').then((m) =>
        m.userHasPermission(user.id, user.role, user.schoolId, 'staffing.request')
      );
      if (!canRequest) {
        res.status(403).json({ error: 'Not authorized' });
        return;
      }
      if (!user.schoolId) {
        res.status(400).json({ error: 'schoolId required' });
        return;
      }
      params.push(user.schoolId);
      conditions.push(`r.school_id = $${params.length}`);
    } else {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    if (status) {
      params.push(status);
      conditions.push(`r.status = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT r.*,
              s.name AS school_name,
              dt.name AS departing_teacher_name,
              at.name AS assigned_teacher_name
       FROM teacher_replacement_requests r
       LEFT JOIN schools s ON s.id = r.school_id
       LEFT JOIN teachers dt ON dt.id = r.departing_teacher_id
       LEFT JOIN teachers at ON at.id = r.assigned_teacher_id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT 200`,
      params
    );
    res.json(rows.map(mapTeacherReplacementRequest));
  })
);

apiRouter.post(
  '/teacher-replacement-requests',
  requireAuth,
  requirePermission('staffing.request'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const b = req.body as {
      departingTeacherId?: string;
      departureDate?: string;
      reason?: string;
      subjectsNeeded?: string[];
      gradeLevelsNeeded?: string[];
      notes?: string;
      schoolId?: string;
    };
    const schoolId = b.schoolId ?? user.schoolId;
    if (!schoolId || !b.departingTeacherId || !b.departureDate || !b.reason) {
      res.status(400).json({ error: 'departingTeacherId, departureDate, and reason are required' });
      return;
    }
    if (!['resignation', 'transfer', 'retirement', 'other'].includes(b.reason)) {
      res.status(400).json({ error: 'Invalid reason' });
      return;
    }

    const { rows: schools } = await query('SELECT id, type, name FROM schools WHERE id = $1', [schoolId]);
    if (!schools.length) {
      res.status(404).json({ error: 'School not found' });
      return;
    }
    if (schools[0].type !== 'Public') {
      res.status(403).json({
        error: 'MOE teacher assignment applies to Public (government) schools only. Private schools hire locally.',
      });
      return;
    }

    const { rows: teachers } = await query(
      'SELECT * FROM teachers WHERE id = $1 AND school_id = $2',
      [b.departingTeacherId, schoolId]
    );
    if (!teachers.length) {
      res.status(404).json({ error: 'Teacher not found at this school' });
      return;
    }
    if (teachers[0].status === 'Left') {
      res.status(409).json({ error: 'Teacher has already left' });
      return;
    }

    const { rows: open } = await query(
      `SELECT id FROM teacher_replacement_requests
       WHERE departing_teacher_id = $1 AND status IN ('pending', 'under_review')
       LIMIT 1`,
      [b.departingTeacherId]
    );
    if (open.length) {
      res.status(409).json({ error: 'An open replacement request already exists for this teacher' });
      return;
    }

    // Place departing teacher On Leave while MOE processes the request.
    await query(`UPDATE teachers SET status = 'On Leave' WHERE id = $1`, [b.departingTeacherId]);

    const subjectsNeeded = Array.isArray(b.subjectsNeeded)
      ? b.subjectsNeeded
      : ((teachers[0].subjects as string[]) ?? []);
    const gradeLevelsNeeded = Array.isArray(b.gradeLevelsNeeded)
      ? b.gradeLevelsNeeded
      : ((teachers[0].grades as string[]) ?? []);

    const threadId = newId('mthr');
    const reference = referenceCode('MOE');
    const subject = `Teacher replacement: ${teachers[0].name}`;
    const bodyText = [
      `Departure notice for ${teachers[0].name} (${schools[0].name}).`,
      `Reason: ${b.reason}. Departure date: ${b.departureDate}.`,
      b.notes ? `Notes: ${b.notes}` : null,
      `Subjects needed: ${subjectsNeeded.join(', ') || 'ΓÇö'}.`,
      `Grade levels needed: ${gradeLevelsNeeded.join(', ') || 'ΓÇö'}.`,
    ]
      .filter(Boolean)
      .join('\n');

    await query(
      `INSERT INTO moe_message_threads (id, reference_number, school_id, subject, status, created_by, created_by_name)
       VALUES ($1,$2,$3,$4,'awaiting_moe',$5,$6)`,
      [threadId, reference, schoolId, subject, user.id, user.displayName]
    );
    await query(
      `INSERT INTO moe_thread_messages (id, thread_id, sender_user_id, sender_role, sender_name, body)
       VALUES ($1,$2,$3,'school-head',$4,$5)`,
      [newId('mmsg'), threadId, user.id, user.displayName, bodyText]
    );

    const id = newId('trr');
    const { rows } = await query(
      `INSERT INTO teacher_replacement_requests
         (id, school_id, departing_teacher_id, departure_date, reason, subjects_needed, grade_levels_needed,
          notes, status, moe_thread_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,'pending',$9,$10)
       RETURNING *`,
      [
        id,
        schoolId,
        b.departingTeacherId,
        b.departureDate,
        b.reason,
        JSON.stringify(subjectsNeeded),
        JSON.stringify(gradeLevelsNeeded),
        b.notes ?? null,
        threadId,
        user.id,
      ]
    );

    await writeAudit({
      schoolId,
      actorUserId: user.id,
      action: 'teacher_replacement.create',
      entityType: 'teacher_replacement_requests',
      entityId: id,
      metadata: { departingTeacherId: b.departingTeacherId, reason: b.reason },
    });

    const mapped = mapTeacherReplacementRequest({
      ...rows[0],
      school_name: schools[0].name,
      departing_teacher_name: teachers[0].name,
    });
    res.status(201).json(mapped);
  })
);

apiRouter.post(
  '/teacher-replacement-requests/:id/assign',
  requireAuth,
  requirePermission('staffing.assign'),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    if (user.role !== 'moe') {
      res.status(403).json({ error: 'Only MOE may assign replacement teachers' });
      return;
    }
    const assignedTeacherId = req.body?.assignedTeacherId as string | undefined;
    const moeNotes = typeof req.body?.moeNotes === 'string' ? req.body.moeNotes.trim() : null;
    if (!assignedTeacherId) {
      res.status(400).json({ error: 'assignedTeacherId is required' });
      return;
    }

    const { rows: existing } = await query('SELECT * FROM teacher_replacement_requests WHERE id = $1', [
      req.params.id,
    ]);
    if (!existing.length) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }
    const reqRow = existing[0];
    if (!['pending', 'under_review'].includes(reqRow.status as string)) {
      res.status(409).json({ error: `Request is already ${reqRow.status}` });
      return;
    }
    if (assignedTeacherId === reqRow.departing_teacher_id) {
      res.status(400).json({ error: 'Replacement teacher must be different from the departing teacher' });
      return;
    }

    const { rows: assignee } = await query('SELECT * FROM teachers WHERE id = $1', [assignedTeacherId]);
    if (!assignee.length) {
      res.status(404).json({ error: 'Replacement teacher not found' });
      return;
    }
    if (assignee[0].status === 'Left') {
      res.status(409).json({ error: 'Cannot assign a departed teacher' });
      return;
    }
    if (assignee[0].school_id === reqRow.school_id) {
      res.status(409).json({ error: 'Teacher is already assigned to this school' });
      return;
    }

    const fromSchoolId = assignee[0].school_id as string | null;
    await query(`UPDATE teachers SET school_id = $1, status = 'Active' WHERE id = $2`, [
      reqRow.school_id,
      assignedTeacherId,
    ]);
    await query(`UPDATE teachers SET status = 'Left' WHERE id = $1`, [reqRow.departing_teacher_id]);
    if (fromSchoolId && fromSchoolId !== reqRow.school_id) {
      await query(
        `UPDATE schools SET teachers_count = GREATEST(teachers_count - 1, 0) WHERE id = $1`,
        [fromSchoolId]
      );
      await query(`UPDATE schools SET teachers_count = teachers_count + 1 WHERE id = $1`, [reqRow.school_id]);
    } else if (!fromSchoolId) {
      await query(`UPDATE schools SET teachers_count = teachers_count + 1 WHERE id = $1`, [reqRow.school_id]);
    }

    const { rows } = await query(
      `UPDATE teacher_replacement_requests
       SET status = 'assigned', assigned_teacher_id = $1, moe_reviewed_by = $2, moe_notes = $3,
           resolved_at = NOW(), updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [assignedTeacherId, user.id, moeNotes, req.params.id]
    );

    if (reqRow.moe_thread_id) {
      await query(
        `INSERT INTO moe_thread_messages (id, thread_id, sender_user_id, sender_role, sender_name, body)
         VALUES ($1,$2,$3,'moe',$4,$5)`,
        [
          newId('mmsg'),
          reqRow.moe_thread_id,
          user.id,
          user.displayName,
          `Assigned replacement teacher: ${assignee[0].name}.${moeNotes ? ` Notes: ${moeNotes}` : ''}`,
        ]
      );
      await query(
        `UPDATE moe_message_threads SET status = 'resolved', last_message_at = NOW() WHERE id = $1`,
        [reqRow.moe_thread_id]
      );
    }

    await writeAudit({
      schoolId: reqRow.school_id as string,
      actorUserId: user.id,
      action: 'teacher_replacement.assign',
      entityType: 'teacher_replacement_requests',
      entityId: req.params.id as string,
      metadata: {
        departingTeacherId: reqRow.departing_teacher_id,
        assignedTeacherId,
        fromSchoolId,
      },
    });

    const { rows: enriched } = await query(
      `SELECT r.*, s.name AS school_name, dt.name AS departing_teacher_name, at.name AS assigned_teacher_name
       FROM teacher_replacement_requests r
       LEFT JOIN schools s ON s.id = r.school_id
       LEFT JOIN teachers dt ON dt.id = r.departing_teacher_id
       LEFT JOIN teachers at ON at.id = r.assigned_teacher_id
       WHERE r.id = $1`,
      [req.params.id]
    );
    res.json(mapTeacherReplacementRequest(enriched[0] ?? rows[0]));
  })
);

apiRouter.post(
  '/teacher-replacement-requests/:id/reject',
  requireAuth,
  requirePermission('staffing.assign'),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    if (user.role !== 'moe') {
      res.status(403).json({ error: 'Only MOE may reject replacement requests' });
      return;
    }
    const moeNotes = typeof req.body?.moeNotes === 'string' ? req.body.moeNotes.trim() : null;
    if (!moeNotes) {
      res.status(400).json({ error: 'moeNotes is required when rejecting' });
      return;
    }

    const { rows: existing } = await query('SELECT * FROM teacher_replacement_requests WHERE id = $1', [
      req.params.id,
    ]);
    if (!existing.length) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }
    const reqRow = existing[0];
    if (!['pending', 'under_review'].includes(reqRow.status as string)) {
      res.status(409).json({ error: `Request is already ${reqRow.status}` });
      return;
    }

    // Restore departing teacher to Active if still On Leave from the notice.
    await query(
      `UPDATE teachers SET status = 'Active' WHERE id = $1 AND status = 'On Leave'`,
      [reqRow.departing_teacher_id]
    );

    const { rows } = await query(
      `UPDATE teacher_replacement_requests
       SET status = 'rejected', moe_reviewed_by = $1, moe_notes = $2, resolved_at = NOW(), updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [user.id, moeNotes, req.params.id]
    );

    if (reqRow.moe_thread_id) {
      await query(
        `INSERT INTO moe_thread_messages (id, thread_id, sender_user_id, sender_role, sender_name, body)
         VALUES ($1,$2,$3,'moe',$4,$5)`,
        [newId('mmsg'), reqRow.moe_thread_id, user.id, user.displayName, `Replacement request rejected. ${moeNotes}`]
      );
      await query(
        `UPDATE moe_message_threads SET status = 'resolved', last_message_at = NOW() WHERE id = $1`,
        [reqRow.moe_thread_id]
      );
    }

    await writeAudit({
      schoolId: reqRow.school_id as string,
      actorUserId: user.id,
      action: 'teacher_replacement.reject',
      entityType: 'teacher_replacement_requests',
      entityId: req.params.id as string,
    });

    res.json(mapTeacherReplacementRequest(rows[0]));
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
    // A teacher account cannot self-approve by passing status/createdByRole in the body ΓÇö
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
    const { role, comments, returnReasonCategory } = req.body as {
      role: 'dept' | 'school';
      comments: string;
      returnReasonCategory?: string;
    };
    await query(
      `UPDATE lesson_plans SET status = 'Rejected', dept_comments = CASE WHEN $1 = 'dept' THEN $2 ELSE dept_comments END,
       school_head_comments = CASE WHEN $1 = 'school' THEN $2 ELSE school_head_comments END,
       return_reason_category = CASE WHEN $1 = 'dept' THEN $4 ELSE return_reason_category END,
       version = version + 1 WHERE id = $3`,
      [role, comments, req.params.id, role === 'dept' ? returnReasonCategory ?? null : null]
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
    // /lesson-plans/:id/approve) ΓÇö an owning teacher must never be able to set either
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

// TE-004: Teacher Adjustments ΓÇö every departure from the annual plan is logged here
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
    // Derived from the session, not the request body ΓÇö a teacher account cannot claim
    // 'department-head' to short-circuit assessmentInitialStatus's auto-approve path.
    const createdByRole = req.user!.role;
    const { rows: tch } = await query('SELECT name FROM teachers WHERE id = $1', [teacherId]);
    const authorName =
      b.teacherName ||
      (createdByRole === 'department-head' ? b.authorName : null) ||
      tch[0]?.name ||
      'Teacher';
    const isExamType = b.type === 'Mid Exam' || b.type === 'Final Exam';

    // A designated reviewer acts with HoD authority for the department(s) they review —
    // never trust a client-asserted department, only a verified assessment_reviewers row.
    let verifiedReviewerDeptId: string | null = null;
    if (isExamType && createdByRole === 'teacher' && typeof b.reviewDepartmentId === 'string') {
      const { rows: reviewerCheck } = await query(
        `SELECT 1 FROM assessment_reviewers WHERE department_id = $1 AND teacher_id = $2`,
        [b.reviewDepartmentId, teacherId]
      );
      if (reviewerCheck.length) verifiedReviewerDeptId = b.reviewDepartmentId;
    }

    let status = assessmentInitialStatus(
      String(b.type),
      verifiedReviewerDeptId ? 'department-head' : createdByRole
    );
    const id = `asm-${Date.now()}`;

    // Reviewer gate: a department head's (or a designated reviewer's) Mid/Final Exam
    // starts life visible only to that department's reviewers + the HoD, not the whole
    // department, whenever that department actually has reviewers assigned. With no
    // reviewers assigned, behavior is unchanged from before this feature existed.
    let reviewDepartmentId: string | null = null;
    if (isExamType && status === 'Approved') {
      if (createdByRole === 'department-head') {
        reviewDepartmentId = req.user!.departmentId ?? null;
      } else if (verifiedReviewerDeptId) {
        reviewDepartmentId = verifiedReviewerDeptId;
      }

      if (reviewDepartmentId) {
        const { rows: reviewerRows } = await query(
          `SELECT 1 FROM assessment_reviewers WHERE department_id = $1 LIMIT 1`,
          [reviewDepartmentId]
        );
        if (reviewerRows.length > 0) status = 'Pending Reviewer';
      }
    }

    // TE-007: for a Unit Test, only IDs of teaching notes this teacher actually
    // delivered (a real lesson_deliveries row exists) may be attached as coverage ΓÇö
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
      `INSERT INTO assessments (id, title, type, subject, grade, teacher_id, teacher_name, status, difficulty, questions, created_by_role, covered_teaching_note_ids, review_department_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())`,
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
        reviewDepartmentId,
      ]
    );
    if (status === 'Pending Reviewer') {
      await insertNotification(
        'Exam ready for review',
        `"${b.title}" (${b.type}) needs your review before it's shared with the rest of the department.`,
        'request',
        '/dashboard/teacher/assessments'
      );
    } else if (status === 'Approved') {
      await insertNotification(
        'Assessment ready',
        `"${b.title}" is ready to link in the gradebook.`,
        'success',
        '/dashboard/teacher/manage-students',
        { userId: req.user!.id }
      );
    } else {
      await insertNotification(
        'Assessment awaiting approval',
        `"${b.title}" was submitted for department head review.`,
        'request',
        '/dashboard/department-head/assessments',
        { schoolId: req.user!.schoolId }
      );
    }
    const { rows } = await query('SELECT * FROM assessments WHERE id = $1', [id]);
    res.status(201).json(mapAssessment(rows[0]));
  })
);


// TE-011: HoD (or a reviewer, since they act with HoD authority for this department)
// disseminates a Mid/Final Exam that's been sitting in Pending Reviewer status, making
// it visible to the rest of the department's teachers.
apiRouter.patch(
  '/assessments/:id/disseminate',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows: cur } = await query(
      'SELECT status, review_department_id FROM assessments WHERE id = $1',
      [req.params.id]
    );
    if (!cur.length) {
      res.status(404).json({ error: 'Assessment not found' });
      return;
    }
    if (cur[0].status !== 'Pending Reviewer') {
      res.status(400).json({ error: 'This assessment is not awaiting dissemination' });
      return;
    }
    const departmentId = cur[0].review_department_id as string | null;
    const user = req.user!;
    const isDeptHeadOfThis = user.role === 'department-head' && user.departmentId === departmentId;
    let isReviewerOfThis = false;
    if (!isDeptHeadOfThis && user.role === 'teacher' && departmentId) {
      const teacherId = await resolveOwnTeacherId(user);
      if (teacherId) {
        const { rows: reviewerCheck } = await query(
          `SELECT 1 FROM assessment_reviewers WHERE department_id = $1 AND teacher_id = $2`,
          [departmentId, teacherId]
        );
        isReviewerOfThis = reviewerCheck.length > 0;
      }
    }
    if (!isDeptHeadOfThis && !isReviewerOfThis) {
      res.status(403).json({ error: 'Only the department head or a designated reviewer can disseminate this exam' });
      return;
    }
    await query(`UPDATE assessments SET status = 'Approved' WHERE id = $1`, [req.params.id]);
    const { rows } = await query('SELECT * FROM assessments WHERE id = $1', [req.params.id]);
    await insertNotification(
      'Exam published to teachers',
      `"${rows[0].title}" is now live for subject teachers.`,
      'success',
      '/dashboard/teacher/assessments'
    );
    res.json(mapAssessment(rows[0]));
  })
);

// Which department(s) a department head has opened up to reviewer teachers, and who
// those reviewers currently are. A reviewer both sees Mid/Final Exams pending review
// for that department AND can generate new ones themselves (acting as the HoD would).
apiRouter.get(
  '/assessment-reviewers',
  requireAuth,
  asyncHandler(async (req, res) => {
    const departmentId = (req.query.departmentId as string) || req.user!.departmentId;
    if (!departmentId) {
      res.json([]);
      return;
    }
    const { rows } = await query(
      `SELECT ar.*, t.name AS teacher_name, t.email AS teacher_email
       FROM assessment_reviewers ar
       JOIN teachers t ON t.id = ar.teacher_id
       WHERE ar.department_id = $1
       ORDER BY t.name`,
      [departmentId]
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        departmentId: r.department_id,
        teacherId: r.teacher_id,
        teacherName: r.teacher_name,
        teacherEmail: r.teacher_email,
        createdAt: r.created_at,
      }))
    );
  })
);

// Every department this teacher is a designated reviewer for — used to unlock Mid/Final
// Exam generation and the review queue in the teacher portal.
apiRouter.get(
  '/assessment-reviewers/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    const teacherId = await requireOwnTeacherId(req, res);
    if (!teacherId) return;
    const { rows } = await query(
      `SELECT ar.department_id, d.name AS department_name, d.subjects_count
       FROM assessment_reviewers ar
       JOIN departments d ON d.id = ar.department_id
       WHERE ar.teacher_id = $1`,
      [teacherId]
    );
    res.json(rows.map((r) => ({ departmentId: r.department_id, departmentName: r.department_name })));
  })
);

// HoD sets the full reviewer list for their own department (replace semantics — simpler
// and safer than incremental add/remove for a small, infrequently-changed list). Ensures
// the "Reviewers community" exists and keeps its membership in sync with the grant.
apiRouter.post(
  '/assessment-reviewers',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user!.role !== 'department-head') {
      res.status(403).json({ error: 'Only a department head can set assessment reviewers' });
      return;
    }
    const departmentId = req.user!.departmentId;
    if (!departmentId) {
      res.status(400).json({ error: 'Your account has no department on record' });
      return;
    }
    const teacherIds: string[] = Array.isArray(req.body.teacherIds)
      ? req.body.teacherIds.filter((x: unknown) => typeof x === 'string')
      : [];

    const { rows: existing } = await query(
      `SELECT teacher_id FROM assessment_reviewers WHERE department_id = $1`,
      [departmentId]
    );
    const existingIds = new Set(existing.map((r) => r.teacher_id as string));
    const nextIds = new Set(teacherIds);
    const toAdd = teacherIds.filter((id) => !existingIds.has(id));
    const toRemove = [...existingIds].filter((id) => !nextIds.has(id));

    for (const teacherId of toAdd) {
      await query(
        `INSERT INTO assessment_reviewers (id, department_id, teacher_id, granted_by)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (department_id, teacher_id) DO NOTHING`,
        [newId('arev'), departmentId, teacherId, req.user!.id]
      );
    }
    if (toRemove.length) {
      await query(
        `DELETE FROM assessment_reviewers WHERE department_id = $1 AND teacher_id = ANY($2::text[])`,
        [departmentId, toRemove]
      );
    }

    // Ensure the department's "Reviewers community" exists once there's at least one
    // reviewer, and keep its membership in sync with the grant.
    if (toAdd.length > 0) {
      const { rows: deptRows } = await query('SELECT name FROM departments WHERE id = $1', [departmentId]);
      const { rows: existingCommunity } = await query(
        `SELECT id FROM communities WHERE type = 'reviewers' AND department_id = $1`,
        [departmentId]
      );
      let communityId = existingCommunity[0]?.id as string | undefined;
      if (!communityId) {
        communityId = newId('rvwc');
        await query(
          `INSERT INTO communities (id, school_id, name, description, type, department_id, created_by)
           VALUES ($1,$2,$3,$4,'reviewers',$5,$6)`,
          [
            communityId,
            req.user!.schoolId ?? null,
            'Reviewers community',
            'Assessment reviewers for this department, plus the department head.',
            departmentId,
            req.user!.id,
          ]
        );
        await query(
          `INSERT INTO community_channels (id, community_id, name, description, type, position)
           VALUES ($1,$2,'general','General discussion','text',0)`,
          [`${communityId}-ch-gen`, communityId]
        );
      }
      // The granting HoD is always a member (admin), plus every currently-added reviewer.
      await query(
        `INSERT INTO community_members (id, community_id, user_id, role)
         VALUES ($1,$2,$3,'admin')
         ON CONFLICT (community_id, user_id) DO NOTHING`,
        [newId('cmem'), communityId, req.user!.id]
      );
      for (const teacherId of toAdd) {
        const { rows: teacherUser } = await query(
          `SELECT pu.id FROM teachers t JOIN portal_users pu ON LOWER(pu.email) = LOWER(t.email) WHERE t.id = $1`,
          [teacherId]
        );
        if (teacherUser[0]?.id) {
          await query(
            `INSERT INTO community_members (id, community_id, user_id, role)
             VALUES ($1,$2,$3,'member')
             ON CONFLICT (community_id, user_id) DO NOTHING`,
            [newId('cmem'), communityId, teacherUser[0].id]
          );
        }
        await insertNotification(
          'You were added as an exam reviewer',
          `You can now review Mid/Final Exams for ${deptRows[0]?.name ?? 'your department'} and generate them yourself.`,
          'info',
          '/dashboard/teacher/assessments'
        );
      }
    }
    // Removed reviewers lose their generate/review access immediately (enforced by the
    // assessment_reviewers row being gone); leaving them in the community chat itself is
    // a lower-stakes, reversible byproduct we don't force-clean here.

    const { rows } = await query(
      `SELECT ar.*, t.name AS teacher_name, t.email AS teacher_email
       FROM assessment_reviewers ar
       JOIN teachers t ON t.id = ar.teacher_id
       WHERE ar.department_id = $1
       ORDER BY t.name`,
      [departmentId]
    );
    res.status(201).json(
      rows.map((r) => ({
        id: r.id,
        departmentId: r.department_id,
        teacherId: r.teacher_id,
        teacherName: r.teacher_name,
        teacherEmail: r.teacher_email,
        createdAt: r.created_at,
      }))
    );
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
    const { comments, moderationRubric } = req.body;
    await query(
      `UPDATE assessments SET status = 'Approved', comments = $1, moderation_rubric = COALESCE($3, moderation_rubric) WHERE id = $2`,
      [comments, req.params.id, moderationRubric ? JSON.stringify(moderationRubric) : null]
    );
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
    const { comments, moderationRubric } = req.body;
    await query(
      `UPDATE assessments SET status = 'Rejected', comments = $1, moderation_rubric = COALESCE($3, moderation_rubric) WHERE id = $2`,
      [comments, req.params.id, moderationRubric ? JSON.stringify(moderationRubric) : null]
    );
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
    // TE-002/CM-006: attendance is attributed to the recording teacher, and ΓÇö when the
    // caller names the scheduled session it was taken for ΓÇö linked to that timetable
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
  requireAuth,
  requirePermission('training.manage'),
  asyncHandler(async (req, res) => {
    const { title, description, resourceUrl, category, audience, trainingType, departmentId, grade, subject } = req.body;
    const id = `tm-${Date.now()}`;
    const today = new Date().toISOString().split('T')[0];
    await query(
      `INSERT INTO training_materials (id, title, description, resource_url, category, audience, training_type, department_id, grade, subject, disseminated, uploaded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,FALSE,$11)`,
      [id, title, description ?? null, resourceUrl, category, audience || 'All', trainingType ?? null, departmentId ?? null, grade ?? null, subject ?? null, today]
    );
    const { rows } = await query('SELECT * FROM training_materials WHERE id = $1', [id]);
    res.status(201).json(mapTrainingMaterial(rows[0]));
  })
);

apiRouter.patch(
  '/training-materials/:id/disseminate',
  requireAuth,
  requirePermission('training.manage'),
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

const CHECK_IN_CONFIDENTIALITY = ['identified', 'restricted', 'anonymous'] as const;

apiRouter.post(
  '/check-ins',
  requireAuth,
  requirePermission('surveys.manage'),
  asyncHandler(async (req, res) => {
    const { title, type, respondentName, rating, comment } = req.body as {
      title?: string; type?: string; respondentName?: string; rating?: number; comment?: string; confidentiality?: string;
    };
    if (!type || !rating || !comment) {
      res.status(400).json({ error: 'type, rating, and comment are required' });
      return;
    }
    const confidentiality = CHECK_IN_CONFIDENTIALITY.includes(req.body.confidentiality)
      ? req.body.confidentiality
      : 'identified';
    // The anonymity guarantee is enforced here, not trusted from the client:
    // an anonymous submission never has a name written to the row at all.
    const storedRespondentName = confidentiality === 'anonymous' ? null : (respondentName || null);
    const id = `ch-gen-${Date.now()}`;
    const today = new Date().toISOString().split('T')[0];
    await query(
      `INSERT INTO school_check_ins (id, title, type, respondent_name, rating, comment, date, confidentiality) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, title ?? null, type, storedRespondentName, rating, comment, today, confidentiality]
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

// A teacher's own assigned training, regardless of program ΓÇö the "Assigned to Me" view.
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
// can NEVER be set here ΓÇö only /progress can mark an assignment completed, and only
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
// every session done, the final assessment passed, and the reflection submitted ΓÇö
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
        `${row.module_title} ΓÇö sessions, assessment, and reflection all complete.`,
        'success',
        '/dashboard/department-head/training',
        { schoolId: req.user!.schoolId }
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
  requireAuth,
  requirePermission('training.manage'),
  asyncHandler(async (req, res) => {
    const { title, description, type, category, audience, startDate, endDate, location, facilitator, createdByName } = req.body;
    const id = `plan-${Date.now()}`;
    await query(
      `INSERT INTO training_plans (id, title, description, type, category, audience, start_date, end_date, location, facilitator, created_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        id,
        title,
        description ?? null,
        type,
        category ?? null,
        audience || 'All',
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
  requireAuth,
  requirePermission('training.manage'),
  asyncHandler(async (req, res) => {
    const { title, description, status, startDate, endDate, location, facilitator, category, audience } = req.body;
    await query(
      `UPDATE training_plans SET
         title = COALESCE($1, title),
         description = COALESCE($2, description),
         status = COALESCE($3, status),
         start_date = COALESCE($4, start_date),
         end_date = COALESCE($5, end_date),
         location = COALESCE($6, location),
         facilitator = COALESCE($7, facilitator),
         category = COALESCE($8, category),
         audience = COALESCE($9, audience)
       WHERE id = $10`,
      [
        title ?? null,
        description ?? null,
        status ?? null,
        startDate ?? null,
        endDate ?? null,
        location ?? null,
        facilitator ?? null,
        category ?? null,
        audience ?? null,
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
  requireAuth,
  requirePermission('training.manage'),
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

// ┬º40: records whether an assigned teacher actually attended/completed a
// MOE/HR-scheduled training session, plus optional impact feedback ΓÇö the
// piece this training pipeline was missing for real School Head oversight.
apiRouter.patch(
  '/training-plan-assignments/:id',
  requireAuth,
  requirePermission('training.manage'),
  asyncHandler(async (req, res) => {
    const body = req.body as { attended?: boolean; impactRating?: number; impactNotes?: string };
    if (body.impactRating !== undefined && (body.impactRating < 1 || body.impactRating > 5)) {
      res.status(400).json({ error: 'impactRating must be between 1 and 5' });
      return;
    }
    await query(
      `UPDATE training_plan_assignments SET
         attended = COALESCE($1, attended),
         completed_at = CASE WHEN $1 = true AND completed_at IS NULL THEN NOW()
                              WHEN $1 = false THEN NULL
                              ELSE completed_at END,
         impact_rating = COALESCE($2, impact_rating),
         impact_notes = COALESCE($3, impact_notes)
       WHERE id = $4`,
      [body.attended ?? null, body.impactRating ?? null, body.impactNotes ?? null, req.params.id]
    );
    const { rows } = await query('SELECT * FROM training_plan_assignments WHERE id = $1', [req.params.id]);
    if (!rows.length) {
      res.status(404).json({ error: 'Assignment not found' });
      return;
    }
    res.json(mapTrainingPlanAssignment(rows[0]));
  })
);

apiRouter.delete(
  '/training-plan-assignments/:id',
  requireAuth,
  requirePermission('training.manage'),
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
      // TE-005: a note with no linked lesson plan is a Supplementary/Unplanned Session ΓÇö
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
            error: 'This subject/term has already been submitted or finalized. Request edit approval from your Academic Head before editing.',
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
            error: 'This subject/term has already been submitted or finalized. Request edit approval from your Academic Head before editing.',
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
// upload ΓÇö only a privileged staff role may.
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

// MOE Documents ΓÇö national policy/curriculum/compliance documents. Category and
// audience are categorization fields only; there is no distribution logic tied to
// audience (see schema note on moe_documents).
const MOE_DOCUMENT_CATEGORIES = [
  'Policy', 'Syllabus', 'Curriculum Framework', 'Text Books', 'Teachers Guide',
  'Training Manuals', 'Compliance Checklist', 'Directives', 'SOP',
  'Assessment Blueprint', 'Exam Guideline', 'Annual Performance Report',
  'Audit and Inspection Reports', 'Budget Allocation',
] as const;
const MOE_DOCUMENT_AUDIENCES = ['All', 'Regional', 'Woredas', 'Schools'] as const;

apiRouter.get(
  '/moe-documents',
  requireAuth,
  requirePermission('documents.view'),
  asyncHandler(async (req, res) => {
    const category = req.query.category as string | undefined;
    const audience = req.query.audience as string | undefined;
    const search = req.query.search as string | undefined;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (category && category !== 'All') {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }
    if (audience && audience !== 'All') {
      params.push(audience);
      conditions.push(`audience = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`title ILIKE $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await query(`SELECT * FROM moe_documents ${where} ORDER BY created_at DESC`, params);
    res.json(rows.map(mapMoeDocument));
  })
);

apiRouter.post(
  '/moe-documents',
  requireAuth,
  requirePermission('documents.upload'),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      title?: string; category?: string; audience?: string;
      fileUrl?: string; fileName?: string; fileSize?: number;
    };
    if (!body.title || !body.category || !body.fileUrl || !body.fileName) {
      res.status(400).json({ error: 'title, category, fileUrl, and fileName are required' });
      return;
    }
    if (!MOE_DOCUMENT_CATEGORIES.includes(body.category as (typeof MOE_DOCUMENT_CATEGORIES)[number])) {
      res.status(400).json({ error: 'Unknown document category' });
      return;
    }
    const audience = MOE_DOCUMENT_AUDIENCES.includes(body.audience as (typeof MOE_DOCUMENT_AUDIENCES)[number])
      ? body.audience
      : 'All';
    const id = newId('doc');
    await query(
      `INSERT INTO moe_documents (id, title, category, audience, file_url, file_name, file_size, uploaded_by, uploaded_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, body.title, body.category, audience, body.fileUrl, body.fileName, body.fileSize ?? null, req.user!.id, req.user!.displayName]
    );
    const { rows } = await query('SELECT * FROM moe_documents WHERE id = $1', [id]);
    await writeAudit({
      actorUserId: req.user!.id,
      action: 'moe_document.uploaded',
      entityType: 'moe_document',
      entityId: id,
      metadata: { title: body.title, category: body.category },
    });
    res.status(201).json(mapMoeDocument(rows[0]));
  })
);

apiRouter.delete(
  '/moe-documents/:id',
  requireAuth,
  requirePermission('documents.upload'),
  asyncHandler(async (req, res) => {
    const { rows } = await query('DELETE FROM moe_documents WHERE id = $1 RETURNING id, title', [req.params.id]);
    if (!rows.length) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    await writeAudit({
      actorUserId: req.user!.id,
      action: 'moe_document.deleted',
      entityType: 'moe_document',
      entityId: String(req.params.id),
      metadata: { title: rows[0].title },
    });
    res.json({ ok: true });
  })
);

// Leadership Actions ΓÇö backs the School Head dashboard's exception queue
// (category='exception') and improvement-initiative tracker
// (category='improvement_initiative'). Scoped strictly to the caller's own
// school (moe may pass schoolId to inspect a specific school).
const LEADERSHIP_ACTION_SEVERITIES = ['Low', 'Medium', 'High', 'Critical'] as const;
const LEADERSHIP_ACTION_STATUSES = ['open', 'in_progress', 'resolved'] as const;

apiRouter.get(
  '/leadership-actions',
  requireAuth,
  requirePermission('leadership.manage_actions'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const schoolId = (req.query.schoolId as string | undefined) ?? req.user!.schoolId;
    if (!schoolId) {
      res.status(400).json({ error: 'schoolId is required' });
      return;
    }
    const category = req.query.category as string | undefined;
    const params: unknown[] = [schoolId];
    let sql = 'SELECT * FROM leadership_actions WHERE school_id = $1';
    if (category) {
      params.push(category);
      sql += ` AND category = $${params.length}`;
    }
    sql += ' ORDER BY CASE severity WHEN \'Critical\' THEN 0 WHEN \'High\' THEN 1 WHEN \'Medium\' THEN 2 ELSE 3 END, due_date NULLS LAST, created_at DESC';
    const { rows } = await query(sql, params);
    res.json(rows.map(mapLeadershipAction));
  })
);

apiRouter.post(
  '/leadership-actions',
  requireAuth,
  requirePermission('leadership.manage_actions'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const body = req.body as {
      schoolId?: string; category?: string; issue?: string; evidence?: string; source?: string;
      severity?: string; owner?: string; decisionRequired?: string; recommendedAction?: string;
      dueDate?: string; progressPercent?: number;
    };
    const schoolId = body.schoolId ?? req.user!.schoolId;
    if (!schoolId || !body.issue) {
      res.status(400).json({ error: 'schoolId and issue are required' });
      return;
    }
    const category = body.category === 'improvement_initiative' ? 'improvement_initiative' : 'exception';
    const severity = LEADERSHIP_ACTION_SEVERITIES.includes(body.severity as (typeof LEADERSHIP_ACTION_SEVERITIES)[number])
      ? body.severity
      : 'Medium';
    const id = newId('lact');
    await query(
      `INSERT INTO leadership_actions
        (id, school_id, category, issue, evidence, source, severity, owner, decision_required, recommended_action, due_date, progress_percent, created_by, created_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        id, schoolId, category, body.issue, body.evidence ?? null, body.source ?? null, severity,
        body.owner ?? null, body.decisionRequired ?? null, body.recommendedAction ?? null,
        body.dueDate ?? null, body.progressPercent ?? null, req.user!.id, req.user!.displayName,
      ]
    );
    const { rows } = await query('SELECT * FROM leadership_actions WHERE id = $1', [id]);
    await writeAudit({
      schoolId,
      actorUserId: req.user!.id,
      action: 'leadership_action.created',
      entityType: 'leadership_action',
      entityId: id,
      metadata: { category, issue: body.issue, severity },
    });
    res.status(201).json(mapLeadershipAction(rows[0]));
  })
);

apiRouter.patch(
  '/leadership-actions/:id',
  requireAuth,
  requirePermission('leadership.manage_actions'),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      status?: string; progressPercent?: number; owner?: string; dueDate?: string;
      decisionRequired?: string; recommendedAction?: string; evidence?: string;
    };
    const status = LEADERSHIP_ACTION_STATUSES.includes(body.status as (typeof LEADERSHIP_ACTION_STATUSES)[number])
      ? body.status
      : null;
    await query(
      `UPDATE leadership_actions SET
         status = COALESCE($1, status),
         progress_percent = COALESCE($2, progress_percent),
         owner = COALESCE($3, owner),
         due_date = COALESCE($4, due_date),
         decision_required = COALESCE($5, decision_required),
         recommended_action = COALESCE($6, recommended_action),
         evidence = COALESCE($7, evidence),
         resolved_at = CASE WHEN $1 = 'resolved' THEN NOW() ELSE resolved_at END
       WHERE id = $8`,
      [
        status, body.progressPercent ?? null, body.owner ?? null, body.dueDate ?? null,
        body.decisionRequired ?? null, body.recommendedAction ?? null, body.evidence ?? null,
        req.params.id,
      ]
    );
    const { rows } = await query('SELECT * FROM leadership_actions WHERE id = $1', [req.params.id]);
    if (!rows.length) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(mapLeadershipAction(rows[0]));
  })
);

// School Resource Library ΓÇö the "External Approved Resource" source in the
// school head's 5-source resource classification view. The other 4 sources
// (MOE Official, Department Resource, School Approved, PRIME Programme) are
// read directly from moe_documents, training_materials, teacher_resources,
// and the platform's built-in module libraries ΓÇö none of them needed a new
// table. This one is for resources that live outside the platform entirely.
apiRouter.get(
  '/school-resources',
  requireAuth,
  requirePermission('resources.manage'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const schoolId = (req.query.schoolId as string | undefined) ?? req.user!.schoolId;
    if (!schoolId) {
      res.status(400).json({ error: 'schoolId is required' });
      return;
    }
    const { rows } = await query(
      'SELECT * FROM school_resources WHERE school_id = $1 ORDER BY created_at DESC',
      [schoolId]
    );
    res.json(rows.map(mapSchoolResource));
  })
);

apiRouter.post(
  '/school-resources',
  requireAuth,
  requirePermission('resources.manage'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const body = req.body as {
      schoolId?: string; title?: string; description?: string; url?: string; grade?: string; subject?: string;
    };
    const schoolId = body.schoolId ?? req.user!.schoolId;
    if (!schoolId || !body.title || !body.url) {
      res.status(400).json({ error: 'schoolId, title, and url are required' });
      return;
    }
    const id = newId('sres');
    await query(
      `INSERT INTO school_resources (id, school_id, title, description, url, grade, subject, added_by, added_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, schoolId, body.title, body.description ?? null, body.url, body.grade ?? null, body.subject ?? null, req.user!.id, req.user!.displayName]
    );
    const { rows } = await query('SELECT * FROM school_resources WHERE id = $1', [id]);
    await writeAudit({
      schoolId,
      actorUserId: req.user!.id,
      action: 'school_resource.created',
      entityType: 'school_resource',
      entityId: id,
      metadata: { title: body.title },
    });
    res.status(201).json(mapSchoolResource(rows[0]));
  })
);

apiRouter.delete(
  '/school-resources/:id',
  requireAuth,
  requirePermission('resources.manage'),
  asyncHandler(async (req, res) => {
    const { rows } = await query('DELETE FROM school_resources WHERE id = $1 RETURNING id, school_id, title', [req.params.id]);
    if (!rows.length) {
      res.status(404).json({ error: 'Resource not found' });
      return;
    }
    await writeAudit({
      schoolId: rows[0].school_id as string,
      actorUserId: req.user!.id,
      action: 'school_resource.deleted',
      entityType: 'school_resource',
      entityId: String(req.params.id),
      metadata: { title: rows[0].title },
    });
    res.json({ success: true });
  })
);

// Regulatory Engine: MOE issues compliance requirements; each school tracks
// its own status/evidence against them; MOE verifies.
apiRouter.get(
  '/compliance-requirements',
  requireAuth,
  requirePermission('compliance.view'),
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT * FROM compliance_requirements ORDER BY due_date NULLS LAST, created_at DESC');
    res.json(rows.map(mapComplianceRequirement));
  })
);

apiRouter.post(
  '/compliance-requirements',
  requireAuth,
  requirePermission('compliance.manage'),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      title?: string; description?: string; authority?: string; dueDate?: string;
      evidenceRequired?: string; audience?: string;
    };
    if (!body.title || !body.authority) {
      res.status(400).json({ error: 'title and authority are required' });
      return;
    }
    const audience = ['All', 'Regional', 'Woredas', 'Schools'].includes(body.audience ?? '')
      ? body.audience
      : 'Schools';
    const id = newId('creq');
    await query(
      `INSERT INTO compliance_requirements (id, title, description, authority, due_date, evidence_required, audience, created_by, created_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, body.title, body.description ?? null, body.authority, body.dueDate ?? null, body.evidenceRequired ?? null, audience, req.user!.id, req.user!.displayName]
    );
    const { rows } = await query('SELECT * FROM compliance_requirements WHERE id = $1', [id]);
    await writeAudit({
      actorUserId: req.user!.id,
      action: 'compliance_requirement.created',
      entityType: 'compliance_requirement',
      entityId: id,
      metadata: { title: body.title },
    });
    res.status(201).json(mapComplianceRequirement(rows[0]));
  })
);

apiRouter.delete(
  '/compliance-requirements/:id',
  requireAuth,
  requirePermission('compliance.manage'),
  asyncHandler(async (req, res) => {
    const { rows } = await query('DELETE FROM compliance_requirements WHERE id = $1 RETURNING id, title', [req.params.id]);
    if (!rows.length) {
      res.status(404).json({ error: 'Requirement not found' });
      return;
    }
    await writeAudit({
      actorUserId: req.user!.id,
      action: 'compliance_requirement.deleted',
      entityType: 'compliance_requirement',
      entityId: String(req.params.id),
      metadata: { title: rows[0].title },
    });
    res.json({ success: true });
  })
);

// Per-school tracking rows against every requirement. School heads see/edit only
// their own school's row (enforceSchoolScope); moe can pass schoolId to inspect one.
apiRouter.get(
  '/compliance-status',
  requireAuth,
  requirePermission('compliance.view'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const schoolId = (req.query.schoolId as string | undefined) ?? req.user!.schoolId;
    if (!schoolId) {
      // moe with no schoolId filter: raw requirement catalog only, no per-school join target
      const { rows } = await query('SELECT * FROM compliance_requirements ORDER BY due_date NULLS LAST');
      res.json(rows.map(mapComplianceRequirement));
      return;
    }
    // One row per requirement, always ΓÇö schools with no tracking row yet still need to
    // see the requirement (as "Not Started"), not just the ones they've already touched.
    const { rows } = await query(
      `SELECT r.id AS req_id, r.title AS requirement_title, r.authority AS requirement_authority,
              r.due_date AS requirement_due_date, r.evidence_required AS requirement_evidence_required,
              s.*
       FROM compliance_requirements r
       LEFT JOIN school_compliance_status s ON s.requirement_id = r.id AND s.school_id = $1
       ORDER BY r.due_date NULLS LAST, r.created_at DESC`,
      [schoolId]
    );
    res.json(
      rows.map((row) =>
        row.id
          ? mapSchoolComplianceStatus(row)
          : mapSchoolComplianceStatus({ ...row, id: null, requirement_id: row.req_id, school_id: schoolId, status: 'Not Started' })
      )
    );
  })
);

apiRouter.post(
  '/compliance-status',
  requireAuth,
  requirePermission('compliance.track'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const body = req.body as {
      requirementId?: string; schoolId?: string; status?: string; responsiblePerson?: string;
      evidenceSubmittedUrl?: string; outstandingIssue?: string;
    };
    const schoolId = body.schoolId ?? req.user!.schoolId;
    if (!schoolId || !body.requirementId) {
      res.status(400).json({ error: 'schoolId and requirementId are required' });
      return;
    }
    const statusValues = ['Not Started', 'In Progress', 'Submitted', 'Verified', 'Rejected'];
    const status = statusValues.includes(body.status ?? '') ? body.status : undefined;
    const id = newId('cstat');
    await query(
      `INSERT INTO school_compliance_status
         (id, requirement_id, school_id, status, responsible_person, evidence_submitted_url, evidence_submitted_at, outstanding_issue, updated_at)
       VALUES ($1,$2,$3,COALESCE($4::text,'In Progress'),$5::text,$6::text,CASE WHEN $6::text IS NOT NULL THEN NOW() ELSE NULL END,$7::text,NOW())
       ON CONFLICT (requirement_id, school_id) DO UPDATE SET
         status = COALESCE($4::text, school_compliance_status.status),
         responsible_person = COALESCE($5::text, school_compliance_status.responsible_person),
         evidence_submitted_url = COALESCE($6::text, school_compliance_status.evidence_submitted_url),
         evidence_submitted_at = CASE WHEN $6::text IS NOT NULL THEN NOW() ELSE school_compliance_status.evidence_submitted_at END,
         outstanding_issue = COALESCE($7::text, school_compliance_status.outstanding_issue),
         updated_at = NOW()`,
      [id, body.requirementId, schoolId, status ?? null, body.responsiblePerson ?? null, body.evidenceSubmittedUrl ?? null, body.outstandingIssue ?? null]
    );
    const { rows } = await query(
      'SELECT * FROM school_compliance_status WHERE requirement_id = $1 AND school_id = $2',
      [body.requirementId, schoolId]
    );
    await writeAudit({
      schoolId,
      actorUserId: req.user!.id,
      action: 'compliance_status.updated',
      entityType: 'school_compliance_status',
      entityId: rows[0].id as string,
      metadata: { requirementId: body.requirementId, status: rows[0].status },
    });
    res.status(201).json(mapSchoolComplianceStatus(rows[0]));
  })
);

apiRouter.patch(
  '/compliance-status/:id/verify',
  requireAuth,
  requirePermission('compliance.manage'),
  asyncHandler(async (req, res) => {
    const body = req.body as { status?: string; verificationNote?: string };
    const status = body.status === 'Rejected' ? 'Rejected' : 'Verified';
    await query(
      `UPDATE school_compliance_status SET
         status = $1, verified_by = $2, verified_by_name = $3, verified_at = NOW(),
         verification_note = $4, updated_at = NOW()
       WHERE id = $5`,
      [status, req.user!.id, req.user!.displayName, body.verificationNote ?? null, req.params.id]
    );
    const { rows } = await query('SELECT * FROM school_compliance_status WHERE id = $1', [req.params.id]);
    if (!rows.length) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    await writeAudit({
      schoolId: rows[0].school_id as string,
      actorUserId: req.user!.id,
      action: 'compliance_status.verified',
      entityType: 'school_compliance_status',
      entityId: String(req.params.id),
      metadata: { status },
    });
    res.json(mapSchoolComplianceStatus(rows[0]));
  })
);

// Message MOE: case-numbered threads, one per school-raised topic.
apiRouter.get(
  '/moe-message-threads',
  requireAuth,
  requirePermission('messages.school_moe'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const schoolId = (req.query.schoolId as string | undefined) ?? req.user!.schoolId;
    const params: unknown[] = [];
    let sql = 'SELECT * FROM moe_message_threads';
    if (schoolId) {
      params.push(schoolId);
      sql += ' WHERE school_id = $1';
    }
    sql += ' ORDER BY last_message_at DESC';
    const { rows } = await query(sql, params);
    res.json(rows.map(mapMoeMessageThread));
  })
);

apiRouter.post(
  '/moe-message-threads',
  requireAuth,
  requirePermission('messages.school_moe'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const body = req.body as { schoolId?: string; subject?: string; body?: string };
    const schoolId = body.schoolId ?? req.user!.schoolId;
    if (!schoolId || !body.subject || !body.body) {
      res.status(400).json({ error: 'schoolId, subject, and body are required' });
      return;
    }
    const id = newId('mthr');
    const reference = referenceCode('MOE');
    await query(
      `INSERT INTO moe_message_threads (id, reference_number, school_id, subject, created_by, created_by_name)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, reference, schoolId, body.subject, req.user!.id, req.user!.displayName]
    );
    const msgId = newId('mmsg');
    await query(
      `INSERT INTO moe_thread_messages (id, thread_id, sender_user_id, sender_role, sender_name, body)
       VALUES ($1,$2,$3,'school-head',$4,$5)`,
      [msgId, id, req.user!.id, req.user!.displayName, body.body]
    );
    const { rows } = await query('SELECT * FROM moe_message_threads WHERE id = $1', [id]);
    await writeAudit({
      schoolId,
      actorUserId: req.user!.id,
      action: 'moe_message_thread.created',
      entityType: 'moe_message_thread',
      entityId: id,
      metadata: { subject: body.subject, referenceNumber: reference },
    });
    res.status(201).json(mapMoeMessageThread(rows[0]));
  })
);

apiRouter.get(
  '/moe-message-threads/:id/messages',
  requireAuth,
  requirePermission('messages.school_moe'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      'SELECT * FROM moe_thread_messages WHERE thread_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json(rows.map(mapMoeThreadMessage));
  })
);

apiRouter.post(
  '/moe-message-threads/:id/messages',
  requireAuth,
  requirePermission('messages.school_moe'),
  asyncHandler(async (req, res) => {
    const body = req.body as { body?: string };
    if (!body.body || !body.body.trim()) {
      res.status(400).json({ error: 'body is required' });
      return;
    }
    const { rows: threadRows } = await query('SELECT * FROM moe_message_threads WHERE id = $1', [req.params.id]);
    if (!threadRows.length) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    const thread = threadRows[0];
    if (req.user!.role !== 'moe' && thread.school_id !== req.user!.schoolId) {
      res.status(403).json({ error: 'Cross-school access denied' });
      return;
    }
    const senderRole = req.user!.role === 'moe' ? 'moe' : 'school-head';
    const msgId = newId('mmsg');
    await query(
      `INSERT INTO moe_thread_messages (id, thread_id, sender_user_id, sender_role, sender_name, body)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [msgId, req.params.id, req.user!.id, senderRole, req.user!.displayName, body.body.trim()]
    );
    const nextStatus = senderRole === 'moe' ? 'awaiting_school' : 'awaiting_moe';
    const readColumn = senderRole === 'moe' ? 'moe_last_read_at' : 'school_last_read_at';
    await query(
      `UPDATE moe_message_threads SET last_message_at = NOW(), status = $1, ${readColumn} = NOW() WHERE id = $2`,
      [thread.status === 'resolved' || thread.status === 'closed' ? thread.status : nextStatus, req.params.id]
    );
    const { rows } = await query('SELECT * FROM moe_thread_messages WHERE id = $1', [msgId]);
    await writeAudit({
      schoolId: thread.school_id as string,
      actorUserId: req.user!.id,
      action: 'moe_message.sent',
      entityType: 'moe_message_thread',
      entityId: String(req.params.id),
      metadata: { senderRole },
    });
    res.status(201).json(mapMoeThreadMessage(rows[0]));
  })
);

apiRouter.patch(
  '/moe-message-threads/:id',
  requireAuth,
  requirePermission('messages.school_moe'),
  asyncHandler(async (req, res) => {
    const body = req.body as { status?: string; markRead?: boolean };
    const { rows: threadRows } = await query('SELECT * FROM moe_message_threads WHERE id = $1', [req.params.id]);
    if (!threadRows.length) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    const thread = threadRows[0];
    if (req.user!.role !== 'moe' && thread.school_id !== req.user!.schoolId) {
      res.status(403).json({ error: 'Cross-school access denied' });
      return;
    }
    const statusValues = ['open', 'awaiting_moe', 'awaiting_school', 'resolved', 'closed'];
    const status = statusValues.includes(body.status ?? '') ? body.status : null;
    const readColumn = req.user!.role === 'moe' ? 'moe_last_read_at' : 'school_last_read_at';
    await query(
      `UPDATE moe_message_threads SET
         status = COALESCE($1, status),
         ${readColumn} = CASE WHEN $2 THEN NOW() ELSE ${readColumn} END
       WHERE id = $3`,
      [status, Boolean(body.markRead), req.params.id]
    );
    const { rows } = await query('SELECT * FROM moe_message_threads WHERE id = $1', [req.params.id]);
    res.json(mapMoeMessageThread(rows[0]));
  })
);

// MOE Academic Calendar (┬º6): a real, shared source of truth replacing what
// used to be written only to the publishing browser's localStorage. MOE sees
// its own latest draft so it can resume editing; every other role only ever
// sees the latest Published one ΓÇö enforced here, not just hidden in the UI.
apiRouter.get(
  '/moe-calendar',
  requireAuth,
  asyncHandler(async (req, res) => {
    const sql = req.user!.role === 'moe'
      ? 'SELECT * FROM moe_calendar_drafts ORDER BY created_at DESC LIMIT 1'
      : "SELECT * FROM moe_calendar_drafts WHERE status = 'Published' ORDER BY created_at DESC LIMIT 1";
    const { rows } = await query(sql);
    res.json(rows.length ? mapMoeCalendarDraft(rows[0]) : null);
  })
);

apiRouter.post(
  '/moe-calendar',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user!.role !== 'moe') {
      res.status(403).json({ error: 'Only MOE can edit the national calendar' });
      return;
    }
    const body = req.body as { id?: string; academicYear?: string; title?: string; events?: unknown[] };
    if (!body.academicYear || !body.title) {
      res.status(400).json({ error: 'academicYear and title are required' });
      return;
    }
    const existing = body.id ? await query('SELECT id FROM moe_calendar_drafts WHERE id = $1', [body.id]) : { rows: [] };
    const id = existing.rows.length ? body.id! : newId('mcal');
    if (existing.rows.length) {
      await query(
        `UPDATE moe_calendar_drafts SET academic_year = $1, title = $2, events = $3 WHERE id = $4`,
        [body.academicYear, body.title, JSON.stringify(body.events ?? []), id]
      );
    } else {
      await query(
        `INSERT INTO moe_calendar_drafts (id, academic_year, title, events, created_by, created_by_name)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, body.academicYear, body.title, JSON.stringify(body.events ?? []), req.user!.id, req.user!.displayName]
      );
    }
    const { rows } = await query('SELECT * FROM moe_calendar_drafts WHERE id = $1', [id]);
    await writeAudit({
      actorUserId: req.user!.id,
      action: 'moe_calendar.saved',
      entityType: 'moe_calendar_draft',
      entityId: id,
      metadata: { academicYear: body.academicYear, title: body.title },
    });
    res.status(201).json(mapMoeCalendarDraft(rows[0]));
  })
);

apiRouter.patch(
  '/moe-calendar/:id/publish',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user!.role !== 'moe') {
      res.status(403).json({ error: 'Only MOE can publish the national calendar' });
      return;
    }
    await query(
      `UPDATE moe_calendar_drafts SET status = 'Published', published_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    const { rows } = await query('SELECT * FROM moe_calendar_drafts WHERE id = $1', [req.params.id]);
    if (!rows.length) {
      res.status(404).json({ error: 'Calendar not found' });
      return;
    }
    await writeAudit({
      actorUserId: req.user!.id,
      action: 'moe_calendar.published',
      entityType: 'moe_calendar_draft',
      entityId: String(req.params.id),
      metadata: {},
    });
    res.json(mapMoeCalendarDraft(rows[0]));
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

// Notifications. `scope` lets a caller broadcast to their whole school (e.g. an
// announcement) instead of just themselves ΓÇö 'self' (the default) covers the
// overwhelming majority of calls, which are self-confirmation toasts ("Wellness
// Survey Created", etc.) that were never meant to reach anyone else.
apiRouter.post(
  '/notifications',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { title, description, type, linkPath, scope } = req.body as {
      title: string; description: string; type: string; linkPath?: string; scope?: 'self' | 'school';
    };
    const target = scope === 'school' && req.user!.schoolId
      ? { schoolId: req.user!.schoolId }
      : { userId: req.user!.id };
    const notif = await insertNotification(title, description, type, linkPath, target);
    res.status(201).json(notif);
  })
);

apiRouter.patch(
  '/notifications/:id/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows: existing } = await query('SELECT * FROM notifications WHERE id = $1', [req.params.id]);
    if (!existing.length) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }
    const n = existing[0];
    const visible =
      n.user_id === req.user!.id ||
      (n.user_id === null && n.school_id === null) ||
      (n.user_id === null && n.school_id === req.user!.schoolId);
    if (!visible) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
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
      // Soft path: classroom delivery implies the note was taught ΓÇö promote to Approved
      // so HoD exam topics and delivery lists stay consistent.
      // Teaching notes no longer need HOD approval to be marked as delivered
      // Auto-approve if not already approved
      if (noteStatus !== 'Approved') {
        await query(
          `UPDATE teaching_notes
           SET status = 'Approved',
               dept_comments = COALESCE(NULLIF(TRIM(dept_comments), ''), 'Auto-approved ΓÇö classroom delivery recorded.'),
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
          ? `_${[note.grade, note.subject].filter(Boolean).join(' ┬╖ ')}_`
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
        '/dashboard/department-head/communication',
        { schoolId: requestUser!.schoolId }
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

// Teacher Γåö HoD staff messages (polled for near-real-time)
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
        { schoolId: req.user!.schoolId }
      );
    } else {
      const { rows: recipientUser } = await query(
        `SELECT pu.id FROM portal_users pu JOIN teachers t ON LOWER(t.email) = LOWER(pu.email) WHERE t.id = $1`,
        [teacherId]
      );
      await insertNotification(
        'Message from HoD',
        `${req.user!.displayName}: ${String(b.body).trim().slice(0, 120)}`,
        'info',
        '/dashboard/teacher/communication',
        { userId: recipientUser[0]?.id ?? null, schoolId: recipientUser[0]?.id ? null : req.user!.schoolId }
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
