import { Router, type Request, type Response } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requirePermission, enforceSchoolScope } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';
import { mapStudent } from '../lib/serialize.js';
import { currentAcademicYear, nextAcademicYear } from '../lib/academicYear.js';

export const registrarRouter = Router();

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: (err?: unknown) => void) => {
    fn(req, res).catch(next);
  };
}

// GET /registrar/audit-logs?entityType=&entityId=&limit=
registrarRouter.get(
  '/audit-logs',
  requireAuth,
  requirePermission('audit.view'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const schoolId = req.query.schoolId as string | undefined;
    const entityType = req.query.entityType as string | undefined;
    const entityId = req.query.entityId as string | undefined;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 20));

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (schoolId) {
      params.push(schoolId);
      conditions.push(`al.school_id = $${params.length}`);
    }
    if (entityType) {
      params.push(entityType);
      conditions.push(`al.entity_type = $${params.length}`);
    }
    if (entityId) {
      params.push(entityId);
      conditions.push(`al.entity_id = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit);

    const { rows } = await query(
      `SELECT al.id, al.action, al.entity_type, al.entity_id, al.details, al.created_at,
              pu.display_name AS actor_name, pu.email AS actor_email
       FROM audit_logs al
       LEFT JOIN portal_users pu ON pu.id = al.actor_user_id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT $${params.length}`,
      params
    );

    res.json(
      rows.map((r) => ({
        id: r.id,
        actorName: r.actor_name ?? undefined,
        actorEmail: r.actor_email ?? undefined,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id ?? undefined,
        details: r.details ?? {},
        createdAt: r.created_at,
      }))
    );
  })
);

// POST /registrar/students/bulk  { schoolId, rows: [...] }
registrarRouter.post(
  '/students/bulk',
  requireAuth,
  requirePermission('enrollment.bulk_import'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const schoolId = req.body.schoolId as string;
    const inputRows: Record<string, unknown>[] = Array.isArray(req.body.rows) ? req.body.rows : [];
    const academicYear = currentAcademicYear();
    const created: unknown[] = [];
    const errors: { row: number; message: string }[] = [];

    for (let i = 0; i < inputRows.length; i++) {
      const b = inputRows[i];
      try {
        if (!b.name || !b.grade || !b.section || !b.parentName || !b.parentPhone) {
          throw new Error('Missing required field (name, grade, section, parentName, parentPhone)');
        }
        const { rows: cnt } = await query('SELECT COUNT(*)::int AS c FROM students');
        const id = `std-${Number(cnt[0].c) + 1}`;
        const studentId = `PTS/${Math.floor(1000 + Math.random() * 9000)}/18`;
        await query(
          `INSERT INTO students (id, student_id, name, email, grade, section, school_id, parent_name, parent_phone, parent_email, status, gpa, attendance_rate, medical_info, emergency_contact, date_of_birth, academic_year)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Active',0,100,$11,$12,$13,$14)`,
          [
            id,
            studentId,
            b.name,
            b.email ?? null,
            b.grade,
            b.section,
            schoolId,
            b.parentName,
            b.parentPhone,
            b.parentEmail ?? '',
            b.medicalInfo ?? null,
            b.emergencyContact ?? '',
            b.dateOfBirth ?? null,
            academicYear,
          ]
        );
        const { rows: inserted } = await query('SELECT * FROM students WHERE id = $1', [id]);
        created.push(mapStudent(inserted[0]));
      } catch (err) {
        errors.push({ row: i, message: err instanceof Error ? err.message : 'Insert failed' });
      }
    }

    await writeAudit({
      schoolId,
      actorUserId: req.user?.id ?? null,
      action: 'student.bulk_import',
      entityType: 'school',
      entityId: schoolId,
      metadata: { imported: created.length, failed: errors.length },
    });

    res.status(201).json({ created, errors });
  })
);

// POST /registrar/students/promote  { schoolId, fromGrade, toGrade, studentIds? }
registrarRouter.post(
  '/students/promote',
  requireAuth,
  requirePermission('enrollment.promote'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const schoolId = req.body.schoolId as string;
    const fromGrade = req.body.fromGrade as string;
    const toGrade = req.body.toGrade as string;
    const studentIds: string[] | undefined = Array.isArray(req.body.studentIds)
      ? req.body.studentIds
      : undefined;

    if (!schoolId || !fromGrade || !toGrade) {
      res.status(400).json({ error: 'schoolId, fromGrade and toGrade are required' });
      return;
    }

    const params: unknown[] = [toGrade, schoolId, fromGrade];
    params.push(nextAcademicYear(currentAcademicYear()));
    let sql = `UPDATE students
       SET grade = $1, section = '', promoted_at = NOW(), academic_year = $${params.length}
       WHERE school_id = $2 AND grade = $3 AND status = 'Active'`;
    if (studentIds?.length) {
      params.push(studentIds);
      sql += ` AND id = ANY($${params.length})`;
    }
    sql += ' RETURNING *';

    const { rows } = await query(sql, params);

    await writeAudit({
      schoolId,
      actorUserId: req.user?.id ?? null,
      action: 'enrollment.promote',
      entityType: 'school',
      entityId: schoolId,
      metadata: { fromGrade, toGrade, count: rows.length, studentIds: rows.map((r) => r.id) },
    });

    res.json({ promoted: rows.length, students: rows.map(mapStudent) });
  })
);
