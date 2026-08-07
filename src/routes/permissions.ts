import { Router, type Request, type Response } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requirePermission, attachPermissions } from '../middleware/auth.js';
import {
  PERMISSIONS,
  ROLE_DEFAULT_PERMISSIONS,
  getEffectivePermissions,
} from '../lib/permissions.js';
import { newId } from '../lib/ids.js';

export const permissionsRouter = Router();

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: (err?: unknown) => void) => {
    fn(req, res).catch(next);
  };
}

permissionsRouter.get(
  '/catalog',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json(PERMISSIONS);
  })
);

permissionsRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await attachPermissions(req.user!);
    res.json({ permissions: user.permissions ?? [] });
  })
);

permissionsRouter.get(
  '/roles/:role',
  requireAuth,
  requirePermission('roles.manage'),
  asyncHandler(async (req, res) => {
    const schoolId = (req.query.schoolId as string) || req.user!.schoolId;
    if (!schoolId) {
      res.json(ROLE_DEFAULT_PERMISSIONS[String(Array.isArray(req.params.role) ? req.params.role[0] : req.params.role)] ?? []);
      return;
    }
    const { rows } = await query(
      `SELECT permission_code FROM role_permissions WHERE role = $1 AND school_id = $2`,
      [String(Array.isArray(req.params.role) ? req.params.role[0] : req.params.role), schoolId]
    );
    if (!rows.length) {
      res.json(ROLE_DEFAULT_PERMISSIONS[String(Array.isArray(req.params.role) ? req.params.role[0] : req.params.role)] ?? []);
      return;
    }
    res.json(rows.map((r) => r.permission_code));
  })
);

permissionsRouter.put(
  '/roles/:role',
  requireAuth,
  requirePermission('roles.manage'),
  asyncHandler(async (req, res) => {
    const schoolId = (req.body.schoolId as string) || req.user!.schoolId;
    if (!schoolId) {
      res.status(400).json({ error: 'schoolId required' });
      return;
    }
    const codes: string[] = req.body.permissions ?? [];
    await query(`DELETE FROM role_permissions WHERE role = $1 AND school_id = $2`, [
      String(Array.isArray(req.params.role) ? req.params.role[0] : req.params.role),
      schoolId,
    ]);
    for (const code of codes) {
      await query(
        `INSERT INTO role_permissions (role, permission_code, school_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [String(Array.isArray(req.params.role) ? req.params.role[0] : req.params.role), code, schoolId]
      );
    }
    res.json({ role: String(Array.isArray(req.params.role) ? req.params.role[0] : req.params.role), permissions: codes });
  })
);

permissionsRouter.get(
  '/users',
  requireAuth,
  requirePermission('permissions.grant'),
  asyncHandler(async (req, res) => {
    const schoolId = (req.query.schoolId as string) || req.user!.schoolId;
    const params: unknown[] = [];
    let sql = `SELECT id, email, role, display_name, school_id FROM portal_users WHERE is_active IS DISTINCT FROM FALSE`;
    if (schoolId) {
      params.push(schoolId);
      sql += ` AND (school_id = $1 OR school_id IS NULL)`;
    }
    sql += ' ORDER BY role, display_name';
    const { rows } = await query(sql, params);
    res.json(
      rows.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        displayName: u.display_name,
        schoolId: u.school_id,
      }))
    );
  })
);

permissionsRouter.get(
  '/users/:userId',
  requireAuth,
  requirePermission('permissions.grant'),
  asyncHandler(async (req, res) => {
    const schoolId = (req.query.schoolId as string) || req.user!.schoolId;
    const user = (await query('SELECT * FROM portal_users WHERE id = $1', [String(Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId)]))
      .rows[0];
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const effective = await getEffectivePermissions(
      user.id,
      user.role,
      schoolId || user.school_id
    );
    const { rows: overrides } = await query(
      `SELECT * FROM user_permissions WHERE user_id = $1 AND ($2::text IS NULL OR school_id = $2)`,
      [user.id, schoolId]
    );
    res.json({
      effective: [...effective],
      overrides: overrides.map((o) => ({
        id: o.id,
        permissionCode: o.permission_code,
        effect: o.effect,
        schoolId: o.school_id,
      })),
    });
  })
);

permissionsRouter.post(
  '/users/:userId',
  requireAuth,
  requirePermission('permissions.grant'),
  asyncHandler(async (req, res) => {
    const schoolId = (req.body.schoolId as string) || req.user!.schoolId;
    if (!schoolId) {
      res.status(400).json({ error: 'schoolId required' });
      return;
    }
    const { permissionCode, effect } = req.body as {
      permissionCode: string;
      effect: 'allow' | 'deny';
    };
    const id = newId('uperm');
    await query(
      `INSERT INTO user_permissions (id, user_id, permission_code, effect, school_id, granted_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id, permission_code, school_id)
       DO UPDATE SET effect = EXCLUDED.effect, granted_by = EXCLUDED.granted_by`,
      [id, String(Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId), permissionCode, effect, schoolId, req.user!.id]
    );
    res.status(201).json({ ok: true });
  })
);

permissionsRouter.delete(
  '/users/:userId/:permissionCode',
  requireAuth,
  requirePermission('permissions.grant'),
  asyncHandler(async (req, res) => {
    const schoolId = (req.query.schoolId as string) || req.user!.schoolId;
    await query(
      `DELETE FROM user_permissions WHERE user_id = $1 AND permission_code = $2 AND school_id = $3`,
      [String(Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId), String(Array.isArray(req.params.permissionCode) ? req.params.permissionCode[0] : req.params.permissionCode), schoolId]
    );
    res.status(204).end();
  })
);
