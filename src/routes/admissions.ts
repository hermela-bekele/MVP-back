import { Router, type Request, type Response } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, requirePermission, attachPermissions, resolveUserFromHeader } from '../middleware/auth.js';
import {
  createApplication,
  updateApplication,
  listApplications,
  mapApplication,
  scoreApplication,
  waitlistApplication,
  rejectApplication,
  acceptApplication,
  getSchoolSettings,
  resolveGradeFees,
  requestInfoApplication,
  withdrawApplication,
  forcePromoteWaitlist,
} from '../services/admissions.js';
import {
  listRegistrationFormTemplates,
  getRegistrationFormTemplateById,
  getRegistrationFormTemplateByCode,
  createRegistrationFormTemplate,
  updateRegistrationFormTemplate,
} from '../services/registrationForms.js';
import { newId } from '../lib/ids.js';
import { rateLimit } from '../lib/rateLimit.js';
import { enforceSchoolScope } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';

export const admissionsRouter = Router();

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: (err?: unknown) => void) => {
    fn(req, res).catch(next);
  };
}

function paramId(req: Request, key = 'id'): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : String(v);
}

function httpError(err: unknown, res: Response) {
  const e = err as { status?: number; message?: string };
  res.status(e.status ?? 500).json({ error: e.message ?? 'Error' });
}

// Public: school apply meta
admissionsRouter.get(
  '/public/schools/:slug',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT id, name, code, slug, region, type, email, phone FROM schools WHERE slug = $1 AND status = 'Active'`,
      [paramId(req, 'slug')]
    );
    if (!rows[0]) {
      res.status(404).json({ error: 'School not found' });
      return;
    }
    const settings = await getSchoolSettings(rows[0].id);
    const grade = (req.query.grade as string) || undefined;
    let fees = {
      registrationFee: Number(settings.registration_fee),
      monthlyTuition: Number(settings.monthly_tuition),
      currency: settings.currency as string,
    };
    if (grade) {
      const resolved = await resolveGradeFees(rows[0].id, grade);
      fees = {
        registrationFee: resolved.registrationFee,
        monthlyTuition: resolved.monthlyTuition,
        currency: resolved.currency,
      };
    }
    const { rows: gradePlans } = await query(
      `SELECT grade, registration_fee, monthly_tuition FROM grade_fee_plans WHERE school_id = $1 ORDER BY grade`,
      [rows[0].id]
    );
    res.json({
      school: rows[0],
      formSchema: settings.application_form_schema ?? [],
      branding: settings.branding ?? {},
      requiredDocuments: settings.required_documents ?? [],
      fees,
      gradeFeePlans: gradePlans.map((p) => ({
        grade: p.grade,
        registrationFee: Number(p.registration_fee),
        monthlyTuition: Number(p.monthly_tuition),
      })),
    });
  })
);

// Public / parent: submit application
admissionsRouter.post(
  '/public/schools/:slug/applications',
  rateLimit({ windowMs: 60_000, max: 8 }),
  asyncHandler(async (req, res) => {
    // Honeypot CAPTCHA
    if (req.body.website || req.body.companyUrl) {
      res.status(201).json({ referenceCode: 'APP-OK', id: 'ignored' });
      return;
    }
    const { rows } = await query(`SELECT id FROM schools WHERE slug = $1 AND status = 'Active'`, [
      paramId(req, 'slug'),
    ]);
    if (!rows[0]) {
      res.status(404).json({ error: 'School not found' });
      return;
    }
    const user = await resolveUserFromHeader(req);
    try {
      const app = await createApplication({
        schoolId: rows[0].id,
        parentUserId: user?.id,
        applicantName: req.body.applicantName,
        dateOfBirth: req.body.dateOfBirth,
        gradeApplied: req.body.gradeApplied,
        sectionRequested: req.body.sectionRequested,
        parentName: req.body.parentName,
        parentPhone: req.body.parentPhone,
        parentEmail: req.body.parentEmail,
        emergencyContact: req.body.emergencyContact,
        medicalInfo: req.body.medicalInfo,
        previousSchool: req.body.previousSchool,
        sourceChannel: req.body.sourceChannel,
        formData: req.body.formData,
        submit: req.body.submit !== false,
        reapplyOf: req.body.reapplyOf,
        forceBackWaitlist: Boolean(req.body.forceBackWaitlist || req.body.reapplyOf),
        consentAccepted: req.body.consentAccepted !== false,
      });
      res.status(201).json(app);
    } catch (err) {
      httpError(err, res);
    }
  })
);

// Public: registrar-configured registration form meta (by short code)
admissionsRouter.get(
  '/public/forms/:code',
  asyncHandler(async (req, res) => {
    const template = await getRegistrationFormTemplateByCode(paramId(req, 'code'));
    if (!template) {
      res.status(404).json({ error: 'Registration form not found or no longer active' });
      return;
    }
    const { rows } = await query(
      `SELECT id, name, code, slug, region, type, email, phone FROM schools WHERE id = $1 AND status = 'Active'`,
      [template.schoolId]
    );
    if (!rows[0]) {
      res.status(404).json({ error: 'School not found' });
      return;
    }
    const settings = await getSchoolSettings(template.schoolId);
    res.json({
      school: rows[0],
      formName: template.name,
      formDescription: template.description,
      formSchema: template.fields,
      requiredDocuments: template.requiredDocuments,
      branding: settings.branding ?? {},
    });
  })
);

// Public / parent: submit application via a registrar-configured registration form
admissionsRouter.post(
  '/public/forms/:code/applications',
  rateLimit({ windowMs: 60_000, max: 8 }),
  asyncHandler(async (req, res) => {
    if (req.body.website || req.body.companyUrl) {
      res.status(201).json({ referenceCode: 'APP-OK', id: 'ignored' });
      return;
    }
    const template = await getRegistrationFormTemplateByCode(paramId(req, 'code'));
    if (!template) {
      res.status(404).json({ error: 'Registration form not found or no longer active' });
      return;
    }
    const user = await resolveUserFromHeader(req);
    try {
      const app = await createApplication({
        schoolId: template.schoolId,
        parentUserId: user?.id,
        applicantName: req.body.applicantName,
        dateOfBirth: req.body.dateOfBirth,
        gradeApplied: req.body.gradeApplied,
        sectionRequested: req.body.sectionRequested,
        parentName: req.body.parentName,
        parentPhone: req.body.parentPhone,
        parentEmail: req.body.parentEmail,
        emergencyContact: req.body.emergencyContact,
        medicalInfo: req.body.medicalInfo,
        previousSchool: req.body.previousSchool,
        sourceChannel: req.body.sourceChannel || 'registration_form',
        formData: req.body.formData,
        submit: req.body.submit !== false,
        consentAccepted: req.body.consentAccepted !== false,
        formTemplateId: template.id,
      });
      res.status(201).json(app);
    } catch (err) {
      httpError(err, res);
    }
  })
);

// Registrar: manage registration form templates (configurable fields + required documents per form)
admissionsRouter.get(
  '/registration-forms',
  requireAuth,
  requirePermission('admissions.configure_form'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const schoolId = (req.query.schoolId as string) || req.user!.schoolId;
    if (!schoolId) {
      res.status(400).json({ error: 'schoolId required' });
      return;
    }
    res.json(await listRegistrationFormTemplates(schoolId));
  })
);

admissionsRouter.post(
  '/registration-forms',
  requireAuth,
  requirePermission('admissions.configure_form'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const schoolId = (req.body.schoolId as string) || req.user!.schoolId;
    if (!schoolId) {
      res.status(400).json({ error: 'schoolId required' });
      return;
    }
    try {
      const template = await createRegistrationFormTemplate({
        schoolId,
        name: req.body.name,
        description: req.body.description,
        fields: Array.isArray(req.body.fields) ? req.body.fields : [],
        requiredDocuments: Array.isArray(req.body.requiredDocuments) ? req.body.requiredDocuments : [],
        createdBy: req.user!.id,
      });
      await writeAudit({
        schoolId,
        actorUserId: req.user!.id,
        action: 'registration_form.create',
        entityType: 'registration_form_template',
        entityId: template!.id,
        metadata: { name: template!.name },
      });
      res.status(201).json(template);
    } catch (err) {
      httpError(err, res);
    }
  })
);

admissionsRouter.patch(
  '/registration-forms/:id',
  requireAuth,
  requirePermission('admissions.configure_form'),
  asyncHandler(async (req, res) => {
    const existing = await getRegistrationFormTemplateById(paramId(req));
    if (!existing) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    if (existing.schoolId !== req.user!.schoolId && req.user!.role !== 'moe') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const template = await updateRegistrationFormTemplate(paramId(req), {
      name: req.body.name,
      description: req.body.description,
      fields: Array.isArray(req.body.fields) ? req.body.fields : undefined,
      requiredDocuments: Array.isArray(req.body.requiredDocuments) ? req.body.requiredDocuments : undefined,
      active: typeof req.body.active === 'boolean' ? req.body.active : undefined,
    });
    await writeAudit({
      schoolId: existing.schoolId,
      actorUserId: req.user!.id,
      action: 'registration_form.update',
      entityType: 'registration_form_template',
      entityId: paramId(req),
      metadata: { name: template!.name },
    });
    res.json(template);
  })
);

admissionsRouter.get(
  '/applications',
  requireAuth,
  requirePermission('admissions.view'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const schoolId = (req.query.schoolId as string) || req.user!.schoolId;
    if (!schoolId) {
      res.status(400).json({ error: 'schoolId required' });
      return;
    }
    res.json(await listApplications(schoolId, req.query.status as string | undefined));
  })
);

admissionsRouter.get(
  '/applications/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT a.*,
         w.position_hint AS waitlist_rank,
         w.status AS waitlist_status
       FROM admission_applications a
       LEFT JOIN waitlist_entries w ON w.application_id = a.id AND w.status = 'waiting'
       WHERE a.parent_user_id = $1 OR a.parent_email = $2
       ORDER BY a.created_at DESC`,
      [req.user!.id, req.user!.email]
    );
    res.json(rows.map((r) => mapApplication(r)));
  })
);

admissionsRouter.get(
  '/applications/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT * FROM admission_applications WHERE id = $1', [
      paramId(req),
    ]);
    if (!rows[0]) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const app = rows[0];
    const isOwner =
      app.parent_user_id === req.user!.id ||
      app.parent_email?.toLowerCase() === req.user!.email.toLowerCase();
    if (!isOwner && req.user!.role === 'parent') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const docs = await query('SELECT * FROM admission_documents WHERE application_id = $1', [
      paramId(req),
    ]);
    res.json({
      ...mapApplication(app),
      documents: docs.rows.map((d) => ({
        id: d.id,
        docType: d.doc_type,
        fileName: d.file_name,
        fileUrl: d.file_url,
        verified: d.verified,
        scanStatus: d.scan_status || 'pending',
        uploadedAt: d.uploaded_at,
      })),
    });
  })
);

admissionsRouter.patch(
  '/applications/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const asStaff = ['registrar', 'school-head', 'moe'].includes(req.user!.role);
      const app = await updateApplication(paramId(req), req.user!.id, req.body, asStaff);
      res.json(app);
    } catch (err) {
      httpError(err, res);
    }
  })
);

admissionsRouter.post(
  '/applications/:id/documents',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT * FROM admission_applications WHERE id = $1', [
      paramId(req),
    ]);
    if (!rows[0]) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const id = newId('adoc');
    const scanStatus = 'clean';
    await query(
      `INSERT INTO admission_documents (id, application_id, school_id, doc_type, file_name, file_url, scan_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        paramId(req),
        rows[0].school_id,
        req.body.docType || 'other',
        req.body.fileName || 'document',
        req.body.fileUrl,
        scanStatus,
      ]
    );
    res.status(201).json({ id, fileUrl: req.body.fileUrl, scanStatus: 'clean' });
  })
);

admissionsRouter.post(
  '/applications/:id/documents/:docId/verify',
  requireAuth,
  requirePermission('admissions.review'),
  asyncHandler(async (req, res) => {
    await query(`UPDATE admission_documents SET verified = $1 WHERE id = $2 AND application_id = $3`, [
      req.body.verified !== false,
      paramId(req, 'docId'),
      paramId(req),
    ]);
    res.json({ ok: true });
  })
);

admissionsRouter.post(
  '/applications/:id/score',
  requireAuth,
  requirePermission('admissions.score'),
  asyncHandler(async (req, res) => {
    res.json(await scoreApplication(paramId(req), Number(req.body.score), req.body.notes));
  })
);

admissionsRouter.post(
  '/applications/:id/waitlist',
  requireAuth,
  requirePermission('admissions.waitlist'),
  asyncHandler(async (req, res) => {
    res.json(await waitlistApplication(paramId(req), req.body.notes));
  })
);

admissionsRouter.post(
  '/applications/:id/reject',
  requireAuth,
  requirePermission('admissions.reject'),
  asyncHandler(async (req, res) => {
    res.json(await rejectApplication(paramId(req), req.body.reason || 'Not selected'));
  })
);

admissionsRouter.post(
  '/applications/:id/accept',
  requireAuth,
  requirePermission('admissions.accept'),
  asyncHandler(async (req, res) => {
    try {
      res.json(
        await acceptApplication(paramId(req), {
          classId: req.body.classId,
          section: req.body.section,
          notes: req.body.notes,
          actorUserId: req.user!.id,
        })
      );
    } catch (err) {
      httpError(err, res);
    }
  })
);

admissionsRouter.post(
  '/applications/:id/request-info',
  requireAuth,
  requirePermission('admissions.review'),
  asyncHandler(async (req, res) => {
    try {
      res.json(
        await requestInfoApplication(paramId(req), req.body.notes || 'Please provide additional documents', req.user!.id)
      );
    } catch (err) {
      httpError(err, res);
    }
  })
);

admissionsRouter.post(
  '/applications/:id/withdraw',
  requireAuth,
  requirePermission('admissions.review'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await withdrawApplication(paramId(req), req.body.reason || 'Withdrawn', req.user!.id));
    } catch (err) {
      httpError(err, res);
    }
  })
);

admissionsRouter.post(
  '/waitlist/:id/force-promote',
  requireAuth,
  requirePermission('admissions.waitlist'),
  asyncHandler(async (req, res) => {
    try {
      res.json(await forcePromoteWaitlist(paramId(req), req.user!.id));
    } catch (err) {
      httpError(err, res);
    }
  })
);

admissionsRouter.get(
  '/waitlist',
  requireAuth,
  requirePermission('admissions.waitlist'),
  enforceSchoolScope,
  asyncHandler(async (req, res) => {
    const schoolId = (req.query.schoolId as string) || req.user!.schoolId;
    const { rows } = await query(
      `SELECT w.*, a.applicant_name, a.parent_name, a.reference_code, a.status AS app_status
       FROM waitlist_entries w
       JOIN admission_applications a ON a.id = w.application_id
       WHERE w.school_id = $1 AND w.status = 'waiting'
       ORDER BY w.force_back ASC, w.priority_score DESC, w.created_at ASC`,
      [schoolId]
    );
    res.json(rows);
  })
);

admissionsRouter.get(
  '/capacity',
  requireAuth,
  requirePermission('admissions.view'),
  asyncHandler(async (req, res) => {
    const schoolId = (req.query.schoolId as string) || req.user!.schoolId;
    const { rows } = await query(
      `SELECT id, school_id, grade, section, capacity, reserved_count, enrolled_count
       FROM grade_section_capacity WHERE school_id = $1
       ORDER BY grade, section`,
      [schoolId]
    );
    res.json(rows);
  })
);

admissionsRouter.patch(
  '/capacity/:id',
  requireAuth,
  requirePermission('admissions.waitlist'),
  asyncHandler(async (req, res) => {
    const capacity = Number(req.body.capacity);
    if (!Number.isFinite(capacity) || capacity < 1) {
      res.status(400).json({ error: 'capacity must be a positive number' });
      return;
    }
    await query(`UPDATE grade_section_capacity SET capacity = $1 WHERE id = $2`, [
      capacity,
      paramId(req),
    ]);
    const { rows } = await query(`SELECT * FROM grade_section_capacity WHERE id = $1`, [paramId(req)]);
    res.json(rows[0] ?? { ok: true });
  })
);

admissionsRouter.get(
  '/settings/:schoolId',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await getSchoolSettings(paramId(req, 'schoolId')));
  })
);

admissionsRouter.patch(
  '/settings/:schoolId',
  requireAuth,
  requirePermission('school.settings'),
  asyncHandler(async (req, res) => {
    const allowed = [
      'registration_fee',
      'monthly_tuition',
      'admission_invoice_due_days',
      'reminder_days_before',
      'monthly_due_day',
      'late_fee_type',
      'late_fee_amount',
      'sibling_discount_percent',
      'yellow_deadline_days',
      'application_form_schema',
      'payment_providers',
      'branding',
      'required_documents',
      'report_card_template',
    ] as const;
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        vals.push(
          key === 'application_form_schema' ||
            key === 'payment_providers' ||
            key === 'branding' ||
            key === 'required_documents' ||
            key === 'report_card_template'
            ? JSON.stringify(req.body[key])
            : req.body[key]
        );
        sets.push(`${key} = $${vals.length}`);
      }
    }
    if (!sets.length) {
      res.status(400).json({ error: 'No settings provided' });
      return;
    }
    vals.push(paramId(req, 'schoolId'));
    await query(
      `UPDATE school_settings SET ${sets.join(', ')}, updated_at = NOW() WHERE school_id = $${vals.length}`,
      vals
    );
    res.json(await getSchoolSettings(paramId(req, 'schoolId')));
  })
);

admissionsRouter.get(
  '/fee-plans/:schoolId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT id, grade, registration_fee, monthly_tuition FROM grade_fee_plans WHERE school_id = $1 ORDER BY grade`,
      [paramId(req, 'schoolId')]
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        grade: r.grade,
        registrationFee: Number(r.registration_fee),
        monthlyTuition: Number(r.monthly_tuition),
      }))
    );
  })
);

admissionsRouter.put(
  '/fee-plans/:schoolId',
  requireAuth,
  requirePermission('school.settings'),
  asyncHandler(async (req, res) => {
    const schoolId = paramId(req, 'schoolId');
    const plans = Array.isArray(req.body.plans) ? req.body.plans : [];
    for (const p of plans) {
      const id = p.id || newId('gfp');
      await query(
        `INSERT INTO grade_fee_plans (id, school_id, grade, registration_fee, monthly_tuition)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (school_id, grade) DO UPDATE SET
           registration_fee = EXCLUDED.registration_fee,
           monthly_tuition = EXCLUDED.monthly_tuition`,
        [id, schoolId, p.grade, Number(p.registrationFee), Number(p.monthlyTuition)]
      );
    }
    const { rows } = await query(
      `SELECT id, grade, registration_fee, monthly_tuition FROM grade_fee_plans WHERE school_id = $1 ORDER BY grade`,
      [schoolId]
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        grade: r.grade,
        registrationFee: Number(r.registration_fee),
        monthlyTuition: Number(r.monthly_tuition),
      }))
    );
  })
);

// silence unused import warning if attachPermissions unused here
void attachPermissions;
void resolveUserFromHeader;
void enforceSchoolScope;
