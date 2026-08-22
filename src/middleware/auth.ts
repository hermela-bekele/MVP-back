import type { Request, Response, NextFunction } from 'express';
import { query } from '../db/pool.js';
import { userHasPermission, getEffectivePermissions } from '../lib/permissions.js';
import { verifyAccessToken } from '../lib/tokens.js';

export type AuthUser = {
  id: string;
  email: string;
  role: string;
  displayName: string;
  schoolId: string | null;
  linkedStudentId: string | null;
  linkedParentId: string | null;
  subject?: string;
  departmentId?: string;
  permissions?: string[];
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

async function loadUserById(userId: string): Promise<AuthUser | null> {
  const { rows } = await query(
    `SELECT id, email, role, display_name, school_id, linked_student_id, linked_parent_id, subject, department_id, is_active
     FROM portal_users WHERE id = $1`,
    [userId]
  );
  if (!rows[0] || rows[0].is_active === false) return null;
  const u = rows[0];
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    displayName: u.display_name,
    schoolId: u.school_id ?? null,
    linkedStudentId: u.linked_student_id ?? null,
    linkedParentId: u.linked_parent_id ?? null,
    subject: u.subject ?? undefined,
    departmentId: u.department_id ?? undefined,
  };
}

export async function resolveUserFromHeader(req: Request): Promise<AuthUser | null> {
  const auth = req.header('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    const payload = verifyAccessToken(token);
    if (payload?.sub) return loadUserById(payload.sub);
  }

  // Legacy fallback during migration
  const userId = req.header('x-user-id');
  if (!userId) return null;
  return loadUserById(userId);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  resolveUserFromHeader(req)
    .then((user) => {
      if (!user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      req.user = user;
      next();
    })
    .catch(next);
}

/** Attaches req.user if a valid session is present, but never rejects. For routes that
 * predate the auth middleware convention and can't yet require a session on every caller. */
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  resolveUserFromHeader(req)
    .then((user) => {
      if (user) req.user = user;
      next();
    })
    .catch(() => next());
}

export function requirePermission(...codes: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const run = async () => {
      const user = req.user ?? (await resolveUserFromHeader(req));
      if (!user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      req.user = user;
      for (const code of codes) {
        const ok = await userHasPermission(user.id, user.role, user.schoolId, code);
        if (!ok) {
          res.status(403).json({ error: `Missing permission: ${code}` });
          return;
        }
      }
      next();
    };
    run().catch(next);
  };
}

/** Force schoolId query/body to the caller's school (moe may pass schoolId). */
export function enforceSchoolScope(req: Request, res: Response, next: NextFunction) {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (user.role === 'moe') {
    next();
    return;
  }
  const requested =
    (req.query.schoolId as string | undefined) ||
    (req.body?.schoolId as string | undefined) ||
    undefined;
  if (requested && user.schoolId && requested !== user.schoolId) {
    res.status(403).json({ error: 'Cross-school access denied' });
    return;
  }
  if (!requested && user.schoolId) {
    if (req.method === 'GET' || req.method === 'DELETE') {
      req.query.schoolId = user.schoolId;
    } else if (req.body && typeof req.body === 'object') {
      req.body.schoolId = user.schoolId;
    }
  }
  next();
}

export async function attachPermissions(user: AuthUser): Promise<AuthUser> {
  const set = await getEffectivePermissions(user.id, user.role, user.schoolId);
  return { ...user, permissions: [...set] };
}
