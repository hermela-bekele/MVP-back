import { query, withTransaction } from '../db/pool.js';
import { newId, referenceCode, addDays, toDateOnly, invoiceNumber } from '../lib/ids.js';
import {
  queueEmail,
  admissionAcceptedEmail,
  admissionRejectedEmail,
  paymentDelayRejectionEmail,
  infoRequestedEmail,
} from '../lib/email.js';
import { createAdmissionInvoice } from './billing.js';
import { writeAudit } from '../lib/audit.js';
import type { PoolClient } from 'pg';

export type ApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'info_requested'
  | 'waitlisted'
  | 'accepted_pending_payment'
  | 'rejected'
  | 'withdrawn'
  | 'expired_unpaid'
  | 'enrolled';

const EDITABLE = new Set(['draft', 'submitted', 'info_requested', 'under_review']);

// §31: the academic year an application belongs to. Not user-selectable on the
// form — it's the current intake cycle, same "current year" assumption the
// rest of the app already makes (see MOE_ACADEMIC_YEAR_EC on the frontend).
export const DEFAULT_ACADEMIC_YEAR = '2018/2019 E.C.';

export function mapApplication(row: Record<string, unknown>) {
  return {
    id: row.id,
    schoolId: row.school_id,
    referenceCode: row.reference_code,
    parentUserId: row.parent_user_id,
    parentId: row.parent_id,
    applicantName: row.applicant_name,
    dateOfBirth: row.date_of_birth,
    gradeApplied: row.grade_applied,
    sectionRequested: row.section_requested,
    parentName: row.parent_name,
    parentPhone: row.parent_phone,
    parentEmail: row.parent_email,
    emergencyContact: row.emergency_contact,
    medicalInfo: row.medical_info,
    previousSchool: row.previous_school,
    sourceChannel: row.source_channel,
    formData: row.form_data,
    priorityScore: Number(row.priority_score ?? 0),
    status: row.status,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    reviewerNotes: row.reviewer_notes,
    rejectionReason: row.rejection_reason,
    provisionalClassId: row.provisional_class_id,
    enrolledStudentId: row.enrolled_student_id,
    enrollmentId: row.enrollment_id,
    invoiceId: row.invoice_id,
    editLocked: row.edit_locked,
    reapplyOf: row.reapply_of,
    formTemplateId: row.form_template_id ?? undefined,
    academicYear: row.academic_year ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    waitlistRank: row.waitlist_rank != null ? Number(row.waitlist_rank) : null,
    waitlistStatus: row.waitlist_status != null ? String(row.waitlist_status) : null,
  };
}

export async function resolveGradeFees(schoolId: string, grade: string) {
  const settings = await getSchoolSettings(schoolId);
  const plan = (
    await query(
      `SELECT registration_fee, monthly_tuition FROM grade_fee_plans WHERE school_id = $1 AND grade = $2`,
      [schoolId, grade]
    )
  ).rows[0];
  return {
    registrationFee: Number(plan?.registration_fee ?? settings.registration_fee ?? 0),
    monthlyTuition: Number(plan?.monthly_tuition ?? settings.monthly_tuition ?? 0),
    currency: String(settings.currency ?? 'ETB'),
    siblingDiscountPercent: Number(settings.sibling_discount_percent ?? 0),
    requiredDocuments: (settings.required_documents as string[]) ?? [],
  };
}

export async function recomputeWaitlistRanks(schoolId: string, grade: string) {
  await query(
    `WITH ranked AS (
       SELECT id,
         ROW_NUMBER() OVER (
           ORDER BY force_back ASC, priority_score DESC, created_at ASC
         ) AS rn
       FROM waitlist_entries
       WHERE school_id = $1 AND grade = $2 AND status = 'waiting'
     )
     UPDATE waitlist_entries w
     SET position_hint = ranked.rn
     FROM ranked
     WHERE w.id = ranked.id`,
    [schoolId, grade]
  );
}

export async function getSchoolSettings(schoolId: string) {
  const { rows } = await query('SELECT * FROM school_settings WHERE school_id = $1', [schoolId]);
  if (!rows[0]) {
    await query(
      `INSERT INTO school_settings (school_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [schoolId]
    );
    const again = await query('SELECT * FROM school_settings WHERE school_id = $1', [schoolId]);
    return again.rows[0];
  }
  return rows[0];
}

export async function ensureParent(opts: {
  schoolId: string;
  userId?: string | null;
  fullName: string;
  email: string;
  phone: string;
}) {
  if (opts.userId) {
    const existing = await query('SELECT * FROM parents WHERE user_id = $1', [opts.userId]);
    if (existing.rows[0]) return existing.rows[0];
  }
  const byEmail = await query(
    'SELECT * FROM parents WHERE school_id = $1 AND LOWER(email) = LOWER($2)',
    [opts.schoolId, opts.email]
  );
  if (byEmail.rows[0]) {
    if (opts.userId && !byEmail.rows[0].user_id) {
      await query('UPDATE parents SET user_id = $1 WHERE id = $2', [opts.userId, byEmail.rows[0].id]);
    }
    return (await query('SELECT * FROM parents WHERE id = $1', [byEmail.rows[0].id])).rows[0];
  }
  const id = newId('par');
  await query(
    `INSERT INTO parents (id, school_id, user_id, full_name, email, phone) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, opts.schoolId, opts.userId ?? null, opts.fullName, opts.email.toLowerCase(), opts.phone]
  );
  return (await query('SELECT * FROM parents WHERE id = $1', [id])).rows[0];
}

export async function createApplication(input: {
  schoolId: string;
  parentUserId?: string | null;
  applicantName: string;
  dateOfBirth?: string;
  gradeApplied: string;
  sectionRequested?: string;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
  emergencyContact?: string;
  medicalInfo?: string;
  previousSchool?: string;
  sourceChannel?: string;
  formData?: Record<string, unknown>;
  submit?: boolean;
  reapplyOf?: string | null;
  forceBackWaitlist?: boolean;
  consentAccepted?: boolean;
  formTemplateId?: string | null;
  academicYear?: string;
}) {
  if (input.submit && input.consentAccepted === false) {
    throw Object.assign(new Error('You must accept the privacy consent to apply'), { status: 400 });
  }

  if (input.dateOfBirth && !input.reapplyOf) {
    const dup = await query(
      `SELECT reference_code FROM admission_applications
       WHERE school_id = $1 AND LOWER(applicant_name) = LOWER($2) AND date_of_birth = $3
         AND status NOT IN ('rejected','withdrawn','expired_unpaid','enrolled') LIMIT 1`,
      [input.schoolId, input.applicantName.trim(), input.dateOfBirth]
    );
    if (dup.rows[0]) {
      throw Object.assign(
        new Error(`A similar application already exists (${dup.rows[0].reference_code}).`),
        { status: 409 }
      );
    }
  }
  if (!input.reapplyOf) {
    const parentDup = await query(
      `SELECT reference_code FROM admission_applications
       WHERE school_id = $1
         AND status NOT IN ('rejected','withdrawn','expired_unpaid','enrolled')
         AND LOWER(applicant_name) = LOWER($2)
         AND (LOWER(parent_email) = LOWER($3)
           OR regexp_replace(parent_phone, '[^0-9]', '', 'g') = regexp_replace($4, '[^0-9]', '', 'g'))
       LIMIT 1`,
      [input.schoolId, input.applicantName.trim(), input.parentEmail, input.parentPhone]
    );
    if (parentDup.rows[0]) {
      throw Object.assign(
        new Error(`Duplicate application detected (${parentDup.rows[0].reference_code}).`),
        { status: 409 }
      );
    }
  }

  const parent = await ensureParent({
    schoolId: input.schoolId,
    userId: input.parentUserId,
    fullName: input.parentName,
    email: input.parentEmail,
    phone: input.parentPhone,
  });

  if (input.parentUserId) {
    await query(
      `UPDATE portal_users SET linked_parent_id = $1, school_id = COALESCE(school_id, $2) WHERE id = $3`,
      [parent.id, input.schoolId, input.parentUserId]
    );
  }

  const id = newId('app');
  const ref = referenceCode('APP');
  const status: ApplicationStatus = input.submit ? 'submitted' : 'draft';
  await query(
    `INSERT INTO admission_applications (
      id, school_id, reference_code, parent_user_id, parent_id, applicant_name, date_of_birth,
      grade_applied, section_requested, parent_name, parent_phone, parent_email, emergency_contact,
      medical_info, previous_school, source_channel, form_data, status, submitted_at, reapply_of, form_template_id, academic_year
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
    [
      id,
      input.schoolId,
      ref,
      input.parentUserId ?? null,
      parent.id,
      input.applicantName,
      input.dateOfBirth || null,
      input.gradeApplied,
      input.sectionRequested ?? null,
      input.parentName,
      input.parentPhone,
      input.parentEmail.toLowerCase(),
      input.emergencyContact ?? '',
      input.medicalInfo ?? null,
      input.previousSchool ?? null,
      input.sourceChannel ?? 'website',
      JSON.stringify(input.formData ?? {}),
      status,
      input.submit ? new Date().toISOString() : null,
      input.reapplyOf ?? null,
      input.formTemplateId ?? null,
      input.academicYear ?? DEFAULT_ACADEMIC_YEAR,
    ]
  );

  if (input.forceBackWaitlist) {
    // marker stored in form_data for waitlist placement later
    await query(
      `UPDATE admission_applications SET form_data = form_data || '{"forceBackWaitlist":true}'::jsonb WHERE id = $1`,
      [id]
    );
  }

  await queueEmail({
    schoolId: input.schoolId,
    toEmail: input.parentEmail,
    subject: `Application received — ${ref}`,
    bodyText: `Dear ${input.parentName},\n\nWe received the application for ${input.applicantName}. Reference: ${ref}.\nYou can track and edit it (while allowed) in the parent portal.\n`,
    templateKey: 'application_received',
    relatedType: 'admission_application',
    relatedId: id,
    idempotent: true,
  });

  await writeAudit({
    schoolId: input.schoolId,
    actorUserId: input.parentUserId,
    action: 'admissions.create',
    entityType: 'admission_application',
    entityId: id,
    metadata: { referenceCode: ref },
  });

  const { rows } = await query('SELECT * FROM admission_applications WHERE id = $1', [id]);
  return mapApplication(rows[0]);
}

export async function updateApplication(
  applicationId: string,
  parentUserId: string | null,
  updates: Record<string, unknown>,
  asStaff = false
) {
  const { rows } = await query('SELECT * FROM admission_applications WHERE id = $1', [applicationId]);
  const app = rows[0];
  if (!app) throw Object.assign(new Error('Application not found'), { status: 404 });
  if (!asStaff) {
    if (app.edit_locked || !EDITABLE.has(app.status)) {
      throw Object.assign(new Error('Application can no longer be edited'), { status: 400 });
    }
    if (parentUserId && app.parent_user_id && app.parent_user_id !== parentUserId) {
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    }
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  const map: Record<string, string> = {
    applicantName: 'applicant_name',
    dateOfBirth: 'date_of_birth',
    gradeApplied: 'grade_applied',
    sectionRequested: 'section_requested',
    parentName: 'parent_name',
    parentPhone: 'parent_phone',
    parentEmail: 'parent_email',
    emergencyContact: 'emergency_contact',
    medicalInfo: 'medical_info',
    previousSchool: 'previous_school',
    sourceChannel: 'source_channel',
    formData: 'form_data',
    priorityScore: 'priority_score',
  };

  for (const [k, col] of Object.entries(map)) {
    if (updates[k] !== undefined) {
      // date_of_birth is a DATE column — an empty string from a cleared date
      // input must become NULL, not '' (Postgres rejects '' for type date).
      const value = k === 'formData' ? JSON.stringify(updates[k]) : k === 'dateOfBirth' ? (updates[k] || null) : updates[k];
      values.push(value);
      fields.push(`${col} = $${values.length}`);
    }
  }
  if (updates.submit === true && EDITABLE.has(app.status)) {
    values.push('submitted');
    fields.push(`status = $${values.length}`);
    values.push(new Date().toISOString());
    fields.push(`submitted_at = $${values.length}`);
  }
  values.push(applicationId);
  if (fields.length) {
    await query(
      `UPDATE admission_applications SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${values.length}`,
      values
    );
  }
  const again = await query('SELECT * FROM admission_applications WHERE id = $1', [applicationId]);
  return mapApplication(again.rows[0]);
}

async function ensureCapacity(schoolId: string, grade: string, section: string, classId?: string | null) {
  const { rows } = await query(
    `SELECT * FROM grade_section_capacity WHERE school_id = $1 AND grade = $2 AND section = $3`,
    [schoolId, grade, section]
  );
  if (rows[0]) return rows[0];
  const id = newId('cap');
  await query(
    `INSERT INTO grade_section_capacity (id, school_id, grade, section, class_id, capacity, reserved_count, enrolled_count)
     VALUES ($1,$2,$3,$4,$5,40,0,0)`,
    [id, schoolId, grade, section, classId ?? null]
  );
  return (await query('SELECT * FROM grade_section_capacity WHERE id = $1', [id])).rows[0];
}

async function reserveSeat(
  schoolId: string,
  grade: string,
  section: string,
  classId?: string | null,
  client?: PoolClient
) {
  const q = client ? client.query.bind(client) : query;
  const { rows } = await q(
    `SELECT * FROM grade_section_capacity WHERE school_id = $1 AND grade = $2 AND section = $3 FOR UPDATE`,
    [schoolId, grade, section]
  );
  let cap = rows[0];
  if (!cap) {
    const id = newId('cap');
    await q(
      `INSERT INTO grade_section_capacity (id, school_id, grade, section, class_id, capacity, reserved_count, enrolled_count)
       VALUES ($1,$2,$3,$4,$5,40,0,0)`,
      [id, schoolId, grade, section, classId ?? null]
    );
    cap = (await q(`SELECT * FROM grade_section_capacity WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  }
  if (Number(cap.reserved_count) + Number(cap.enrolled_count) >= Number(cap.capacity)) {
    throw Object.assign(new Error('No seat capacity available for this grade/section'), { status: 409 });
  }
  await q(`UPDATE grade_section_capacity SET reserved_count = reserved_count + 1 WHERE id = $1`, [
    cap.id,
  ]);
  if (classId) {
    await q(
      `UPDATE school_classes SET reserved_count = COALESCE(reserved_count,0) + 1 WHERE id = $1`,
      [classId]
    );
  }
  return cap;
}

async function releaseSeat(schoolId: string, grade: string, section: string, classId?: string | null) {
  await query(
    `UPDATE grade_section_capacity
     SET reserved_count = GREATEST(reserved_count - 1, 0)
     WHERE school_id = $1 AND grade = $2 AND section = $3`,
    [schoolId, grade, section]
  );
  if (classId) {
    await query(
      `UPDATE school_classes SET reserved_count = GREATEST(COALESCE(reserved_count,0) - 1, 0) WHERE id = $1`,
      [classId]
    );
  }
}

export async function scoreApplication(applicationId: string, score: number, notes?: string) {
  await query(
    `UPDATE admission_applications SET priority_score = $1, reviewer_notes = COALESCE($2, reviewer_notes), status = CASE WHEN status = 'submitted' THEN 'under_review' ELSE status END, updated_at = NOW() WHERE id = $3`,
    [score, notes ?? null, applicationId]
  );
  const { rows } = await query('SELECT * FROM admission_applications WHERE id = $1', [applicationId]);
  return mapApplication(rows[0]);
}

export async function waitlistApplication(applicationId: string, notes?: string) {
  const { rows } = await query('SELECT * FROM admission_applications WHERE id = $1', [applicationId]);
  const app = rows[0];
  if (!app) throw Object.assign(new Error('Not found'), { status: 404 });

  const forceBack = Boolean((app.form_data as { forceBackWaitlist?: boolean })?.forceBackWaitlist);
  await query(
    `UPDATE admission_applications SET status = 'waitlisted', reviewed_at = NOW(), reviewer_notes = COALESCE($1, reviewer_notes), updated_at = NOW() WHERE id = $2`,
    [notes ?? null, applicationId]
  );
  const wid = newId('wl');
  await query(
    `INSERT INTO waitlist_entries (id, school_id, application_id, grade, priority_score, force_back, status)
     VALUES ($1,$2,$3,$4,$5,$6,'waiting')
     ON CONFLICT (application_id) DO UPDATE SET priority_score = EXCLUDED.priority_score, force_back = EXCLUDED.force_back, status = 'waiting'`,
    [wid, app.school_id, applicationId, app.grade_applied, app.priority_score, forceBack]
  );
  await recomputeWaitlistRanks(app.school_id, app.grade_applied);
  const again = await query('SELECT * FROM admission_applications WHERE id = $1', [applicationId]);
  return mapApplication(again.rows[0]);
}

export async function rejectApplication(applicationId: string, reason: string) {
  const { rows } = await query('SELECT * FROM admission_applications WHERE id = $1', [applicationId]);
  const app = rows[0];
  if (!app) throw Object.assign(new Error('Not found'), { status: 404 });

  await query(
    `UPDATE admission_applications SET status = 'rejected', rejection_reason = $1, reviewed_at = NOW(), edit_locked = TRUE, updated_at = NOW() WHERE id = $2`,
    [reason, applicationId]
  );
  await query(`UPDATE waitlist_entries SET status = 'removed' WHERE application_id = $1`, [applicationId]);

  const school = (await query('SELECT name FROM schools WHERE id = $1', [app.school_id])).rows[0];
  const mail = admissionRejectedEmail({
    parentName: app.parent_name,
    studentName: app.applicant_name,
    schoolName: school?.name ?? 'School',
    reason,
  });
  await queueEmail({
    schoolId: app.school_id,
    toEmail: app.parent_email,
    ...mail,
    templateKey: 'admission_rejected',
    relatedType: 'admission_application',
    relatedId: applicationId,
  });

  return mapApplication((await query('SELECT * FROM admission_applications WHERE id = $1', [applicationId])).rows[0]);
}

export async function acceptApplication(applicationId: string, opts: {
  classId?: string;
  section?: string;
  notes?: string;
  actorUserId?: string;
}) {
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM admission_applications WHERE id = $1 FOR UPDATE',
      [applicationId]
    );
    const app = rows[0];
    if (!app) throw Object.assign(new Error('Not found'), { status: 404 });
    if (!['submitted', 'under_review', 'waitlisted', 'info_requested'].includes(app.status)) {
      throw Object.assign(new Error(`Cannot accept from status ${app.status}`), { status: 400 });
    }

    const settings = (
      await client.query('SELECT * FROM school_settings WHERE school_id = $1', [app.school_id])
    ).rows[0];

    let requiredDocs: string[] = Array.isArray(settings?.required_documents)
      ? settings.required_documents
      : [];
    if (app.form_template_id) {
      const tmpl = (
        await client.query('SELECT required_documents FROM registration_form_templates WHERE id = $1', [
          app.form_template_id,
        ])
      ).rows[0];
      if (tmpl && Array.isArray(tmpl.required_documents)) {
        requiredDocs = tmpl.required_documents;
      }
    }
    if (requiredDocs.length) {
      const docs = await client.query(
        `SELECT doc_type, verified FROM admission_documents WHERE application_id = $1`,
        [applicationId]
      );
      const have = new Set(docs.rows.map((d: { doc_type: string }) => d.doc_type));
      const missing = requiredDocs.filter((d) => !have.has(d));
      if (missing.length) {
        throw Object.assign(
          new Error(`Missing required documents: ${missing.join(', ')}`),
          { status: 400 }
        );
      }
    }

    const feePlan = (
      await client.query(
        `SELECT registration_fee, monthly_tuition FROM grade_fee_plans WHERE school_id = $1 AND grade = $2`,
        [app.school_id, app.grade_applied]
      )
    ).rows[0];
    const registrationFee = Number(
      feePlan?.registration_fee ?? settings?.registration_fee ?? 0
    );
    const monthlyTuition = Number(feePlan?.monthly_tuition ?? settings?.monthly_tuition ?? 0);

    const section = opts.section || app.section_requested || 'A';
    let classId = opts.classId ?? null;
    if (!classId) {
      const cls = await client.query(
        `SELECT id FROM school_classes WHERE grade = $1 AND section = $2 AND (school_id = $3 OR school_id IS NULL) LIMIT 1`,
        [app.grade_applied, section, app.school_id]
      );
      classId = cls.rows[0]?.id ?? null;
    }

    await reserveSeat(app.school_id, app.grade_applied, section, classId, client);

    const enrollmentId = newId('enr');
    await client.query(
      `INSERT INTO enrollments (id, school_id, application_id, grade, section, class_id, status, reserved_at)
       VALUES ($1,$2,$3,$4,$5,$6,'provisional',NOW())`,
      [enrollmentId, app.school_id, applicationId, app.grade_applied, section, classId]
    );

    const school = (await client.query('SELECT * FROM schools WHERE id = $1', [app.school_id])).rows[0];

    // Sibling discount if parent already has an enrolled/active child
    let siblingDiscountPercent = 0;
    if (settings?.sibling_discount_percent && app.parent_id) {
      const sib = await client.query(
        `SELECT COUNT(*)::int AS c FROM parent_student_links psl
         JOIN students s ON s.id = psl.student_id
         WHERE psl.parent_id = $1 AND s.school_id = $2`,
        [app.parent_id, app.school_id]
      );
      if (Number(sib.rows[0]?.c || 0) > 0) {
        siblingDiscountPercent = Number(settings.sibling_discount_percent);
      }
    }

    const invoice = await createAdmissionInvoice({
      schoolId: app.school_id,
      applicationId,
      enrollmentId,
      parentId: app.parent_id,
      registrationFee,
      monthlyTuition,
      dueDays: Number(settings?.admission_invoice_due_days ?? 14),
      currency: settings?.currency ?? 'ETB',
      schoolCode: school.code,
      siblingDiscountPercent,
      client,
    });

    await client.query(
      `UPDATE admission_applications SET
        status = 'accepted_pending_payment',
        provisional_class_id = $1,
        enrollment_id = $2,
        invoice_id = $3,
        reviewed_at = NOW(),
        reviewer_notes = COALESCE($4, reviewer_notes),
        edit_locked = TRUE,
        section_requested = $5,
        updated_at = NOW()
       WHERE id = $6`,
      [classId, enrollmentId, invoice.id, opts.notes ?? null, section, applicationId]
    );
    await client.query(`UPDATE waitlist_entries SET status = 'promoted' WHERE application_id = $1`, [
      applicationId,
    ]);

    return { app, school, classId, section, enrollmentId, invoice, settings };
  });

  const { app, school, classId, section, enrollmentId, invoice } = result;
  const classLabel = classId
    ? (await query('SELECT name, grade, section FROM school_classes WHERE id = $1', [classId])).rows[0]
    : null;
  const classText = classLabel
    ? `${classLabel.name || `${classLabel.grade}-${classLabel.section}`}`
    : `${app.grade_applied} ${section}`;

  const mail = admissionAcceptedEmail({
    parentName: String(app.parent_name),
    studentName: String(app.applicant_name),
    schoolName: String(school.name),
    classLabel: classText,
    invoiceNumber: String(invoice.invoiceNumber),
    amount: Number(invoice.balanceDue ?? invoice.subtotal),
    currency: String(invoice.currency),
    dueDate: String(invoice.dueDate),
    referenceCode: String(app.reference_code),
    invoiceSummaryHtml: `<pre style="font-family:monospace;background:#f6f6f6;padding:12px;border-radius:8px">INVOICE ${invoice.invoiceNumber}
Amount: ${invoice.balanceDue ?? invoice.subtotal} ${invoice.currency}
Due: ${invoice.dueDate}
Class: ${classText}</pre>`,
  });
  const { buildInvoicePdfAttachment } = await import('./billing.js');
  const pdfBundle = await buildInvoicePdfAttachment(String(invoice.id));
  await queueEmail({
    schoolId: String(app.school_id),
    toEmail: String(app.parent_email),
    ...mail,
    templateKey: 'admission_accepted',
    relatedType: 'invoice',
    relatedId: String(invoice.id),
    idempotent: true,
    attachments: pdfBundle ? [pdfBundle.attachment] : undefined,
  });

  await writeAudit({
    schoolId: String(app.school_id),
    actorUserId: opts.actorUserId,
    action: 'admissions.accept',
    entityType: 'admission_application',
    entityId: applicationId,
    metadata: { invoiceId: invoice.id, enrollmentId },
  });

  return {
    application: mapApplication(
      (await query('SELECT * FROM admission_applications WHERE id = $1', [applicationId])).rows[0]
    ),
    invoice,
    enrollmentId,
  };
}

export async function activateEnrollmentAfterPayment(invoiceId: string) {
  const { rows: invRows } = await query('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
  const inv = invRows[0];
  if (!inv || inv.invoice_type !== 'admission') return null;
  if (Number(inv.balance_due) > 0) return null;

  const { rows: appRows } = await query(
    'SELECT * FROM admission_applications WHERE invoice_id = $1',
    [invoiceId]
  );
  const app = appRows[0];
  if (!app || app.status === 'enrolled') return app;

  const studentId = newId('std');
  const studentCode = `STU-${Date.now().toString().slice(-6)}`;
  await query(
    `INSERT INTO students (
      id, student_id, name, email, grade, section, school_id, parent_name, parent_phone, parent_email,
      status, gpa, attendance_rate, medical_info, emergency_contact
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Active',0,100,$11,$12)`,
    [
      studentId,
      studentCode,
      app.applicant_name,
      null,
      app.grade_applied,
      app.section_requested || 'A',
      app.school_id,
      app.parent_name,
      app.parent_phone,
      app.parent_email,
      app.medical_info,
      app.emergency_contact,
    ]
  );

  if (app.parent_id) {
    await query(
      `INSERT INTO parent_student_links (id, parent_id, student_id, relationship, access_level)
       VALUES ($1,$2,$3,'guardian','full') ON CONFLICT DO NOTHING`,
      [newId('psl'), app.parent_id, studentId]
    );
  }

  await query(
    `UPDATE enrollments SET student_id = $1, status = 'active', activated_at = NOW() WHERE id = $2`,
    [studentId, app.enrollment_id]
  );
  await query(
    `UPDATE admission_applications SET status = 'enrolled', enrolled_student_id = $1, updated_at = NOW() WHERE id = $2`,
    [studentId, app.id]
  );
  await query(
    `UPDATE grade_section_capacity
     SET reserved_count = GREATEST(reserved_count - 1, 0), enrolled_count = enrolled_count + 1
     WHERE school_id = $1 AND grade = $2 AND section = $3`,
    [app.school_id, app.grade_applied, app.section_requested || 'A']
  );
  await query(
    `UPDATE invoices SET student_id = $1 WHERE id = $2`,
    [studentId, invoiceId]
  );

  return studentId;
}

export async function expireUnpaidAdmission(invoiceId: string) {
  const { rows: invRows } = await query('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
  const inv = invRows[0];
  if (!inv || inv.invoice_type !== 'admission') return;
  if (Number(inv.balance_due) <= 0) return;

  const { rows: appRows } = await query(
    'SELECT * FROM admission_applications WHERE invoice_id = $1',
    [invoiceId]
  );
  const app = appRows[0];
  if (!app || app.status !== 'accepted_pending_payment') return;

  await releaseSeat(
    app.school_id,
    app.grade_applied,
    app.section_requested || 'A',
    app.provisional_class_id
  );
  await query(
    `UPDATE enrollments SET status = 'withdrawn', withdrawn_at = NOW() WHERE id = $1`,
    [app.enrollment_id]
  );
  await query(
    `UPDATE admission_applications SET status = 'expired_unpaid', rejection_reason = 'Payment deadline missed', updated_at = NOW() WHERE id = $1`,
    [app.id]
  );
  await query(
    `UPDATE invoices SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
    [invoiceId]
  );

  const school = (await query('SELECT name FROM schools WHERE id = $1', [app.school_id])).rows[0];
  const mail = paymentDelayRejectionEmail({
    parentName: app.parent_name,
    studentName: app.applicant_name,
    schoolName: school?.name ?? 'School',
    referenceCode: app.reference_code,
    dueDate: String(inv.due_date).slice(0, 10),
  });
  await queueEmail({
    schoolId: app.school_id,
    toEmail: app.parent_email,
    ...mail,
    templateKey: 'payment_delay_rejection',
    relatedType: 'admission_application',
    relatedId: app.id,
    idempotent: true,
  });

  await promoteNextWaitlisted(app.school_id, app.grade_applied);
}

export async function promoteNextWaitlisted(schoolId: string, grade: string) {
  const { rows } = await query(
    `SELECT w.*, a.id AS app_id FROM waitlist_entries w
     JOIN admission_applications a ON a.id = w.application_id
     WHERE w.school_id = $1 AND w.grade = $2 AND w.status = 'waiting' AND a.status = 'waitlisted'
     ORDER BY w.force_back ASC, w.priority_score DESC, w.created_at ASC
     LIMIT 1`,
    [schoolId, grade]
  );
  if (!rows[0]) return null;
  return acceptApplication(rows[0].app_id, {
    notes: 'Auto-promoted from waitlist after seat became available',
  });
}

export async function listApplications(schoolId: string, status?: string) {
  const params: unknown[] = [schoolId];
  let sql = 'SELECT * FROM admission_applications WHERE school_id = $1';
  if (status) {
    params.push(status);
    sql += ` AND status = $${params.length}`;
  }
  sql += ' ORDER BY submitted_at DESC NULLS LAST, created_at DESC';
  const { rows } = await query(sql, params);
  return rows.map((r) => mapApplication(r));
}

export async function requestInfoApplication(
  applicationId: string,
  notes: string,
  actorUserId?: string
) {
  const { rows } = await query('SELECT * FROM admission_applications WHERE id = $1', [applicationId]);
  const app = rows[0];
  if (!app) throw Object.assign(new Error('Not found'), { status: 404 });
  if (!['submitted', 'under_review', 'info_requested'].includes(app.status)) {
    throw Object.assign(new Error(`Cannot request info from status ${app.status}`), { status: 400 });
  }
  await query(
    `UPDATE admission_applications
     SET status = 'info_requested', reviewer_notes = $1, edit_locked = FALSE, reviewed_at = NOW(), updated_at = NOW()
     WHERE id = $2`,
    [notes, applicationId]
  );
  const school = (await query('SELECT name FROM schools WHERE id = $1', [app.school_id])).rows[0];
  const mail = infoRequestedEmail({
    parentName: app.parent_name,
    studentName: app.applicant_name,
    schoolName: school?.name ?? 'School',
    notes,
    referenceCode: app.reference_code,
  });
  await queueEmail({
    schoolId: app.school_id,
    toEmail: app.parent_email,
    ...mail,
    templateKey: 'info_requested',
    relatedType: 'admission_application',
    relatedId: applicationId,
  });
  await writeAudit({
    schoolId: app.school_id,
    actorUserId,
    action: 'admissions.request_info',
    entityType: 'admission_application',
    entityId: applicationId,
    metadata: { notes },
  });
  return mapApplication((await query('SELECT * FROM admission_applications WHERE id = $1', [applicationId])).rows[0]);
}

export async function withdrawApplication(
  applicationId: string,
  reason: string,
  actorUserId?: string
) {
  const { rows } = await query('SELECT * FROM admission_applications WHERE id = $1', [applicationId]);
  const app = rows[0];
  if (!app) throw Object.assign(new Error('Not found'), { status: 404 });
  if (['enrolled', 'withdrawn'].includes(app.status)) {
    throw Object.assign(new Error(`Cannot withdraw from status ${app.status}`), { status: 400 });
  }
  if (app.status === 'accepted_pending_payment' && app.enrollment_id) {
    const enr = (await query('SELECT * FROM enrollments WHERE id = $1', [app.enrollment_id])).rows[0];
    if (enr) {
      await releaseSeat(app.school_id, enr.grade, enr.section, enr.class_id);
      await query(`UPDATE enrollments SET status = 'withdrawn', withdrawn_at = NOW() WHERE id = $1`, [
        enr.id,
      ]);
    }
    if (app.invoice_id) {
      await query(
        `UPDATE invoices SET status = 'cancelled', notes = COALESCE(notes,'') || $1, balance_due = 0, updated_at = NOW() WHERE id = $2 AND amount_paid = 0`,
        [`\nWithdrawn: ${reason}`, app.invoice_id]
      );
    }
  }
  await query(
    `UPDATE admission_applications SET status = 'withdrawn', rejection_reason = $1, edit_locked = TRUE, updated_at = NOW() WHERE id = $2`,
    [reason, applicationId]
  );
  await query(`UPDATE waitlist_entries SET status = 'removed' WHERE application_id = $1`, [applicationId]);
  await writeAudit({
    schoolId: app.school_id,
    actorUserId,
    action: 'admissions.withdraw',
    entityType: 'admission_application',
    entityId: applicationId,
    metadata: { reason },
  });
  return mapApplication((await query('SELECT * FROM admission_applications WHERE id = $1', [applicationId])).rows[0]);
}

export async function forcePromoteWaitlist(
  waitlistEntryId: string,
  actorUserId?: string
) {
  const { rows } = await query(`SELECT * FROM waitlist_entries WHERE id = $1`, [waitlistEntryId]);
  const w = rows[0];
  if (!w || w.status !== 'waiting') {
    throw Object.assign(new Error('Waitlist entry not available'), { status: 400 });
  }
  await writeAudit({
    schoolId: w.school_id,
    actorUserId,
    action: 'admissions.force_promote',
    entityType: 'waitlist_entry',
    entityId: waitlistEntryId,
  });
  return acceptApplication(w.application_id, {
    notes: 'Force-promoted from waitlist by registrar',
    actorUserId,
  });
}
