import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { newId } from './ids.js';
import { query } from '../db/pool.js';

export type EmailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

export async function queueEmail(opts: {
  schoolId?: string | null;
  toEmail: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  templateKey?: string;
  relatedType?: string;
  relatedId?: string;
  /** When true with templateKey+relatedId, skip if already queued/sent */
  idempotent?: boolean;
  attachments?: EmailAttachment[];
}) {
  if (opts.idempotent && opts.templateKey && opts.relatedId) {
    const existing = await query(
      `SELECT id FROM email_outbox
       WHERE template_key = $1 AND related_id = $2 AND status IN ('pending','sent')
       LIMIT 1`,
      [opts.templateKey, opts.relatedId]
    );
    if (existing.rows[0]) return existing.rows[0].id as string;
  }

  const id = newId('email');
  await query(
    `INSERT INTO email_outbox
      (id, school_id, to_email, subject, body_text, body_html, template_key, status, related_type, related_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9)`,
    [
      id,
      opts.schoolId ?? null,
      opts.toEmail,
      opts.subject,
      opts.bodyText,
      opts.bodyHtml ?? null,
      opts.templateKey ?? null,
      opts.relatedType ?? null,
      opts.relatedId ?? null,
    ]
  );

  try {
    await deliverEmail({
      toEmail: opts.toEmail,
      subject: opts.subject,
      bodyText: opts.bodyText,
      bodyHtml: opts.bodyHtml,
      attachments: opts.attachments,
      outboxId: id,
    });
    await query(
      `UPDATE email_outbox SET status = 'sent', sent_at = NOW(), error = NULL WHERE id = $1`,
      [id]
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[email] delivery failed for ${opts.toEmail}:`, message);
    await query(`UPDATE email_outbox SET status = 'failed', error = $2 WHERE id = $1`, [
      id,
      message.slice(0, 2000),
    ]);
  }
  return id;
}

async function deliverEmail(opts: {
  toEmail: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  attachments?: EmailAttachment[];
  outboxId: string;
}) {
  const from = process.env.EMAIL_FROM || process.env.SMTP_FROM || 'noreply@prime.local';
  const smtpHost = process.env.SMTP_HOST;
  const resendKey = process.env.RESEND_API_KEY;

  if (smtpHost) {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth:
        process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' }
          : undefined,
    });
    await transporter.sendMail({
      from,
      to: opts.toEmail,
      subject: opts.subject,
      text: opts.bodyText,
      html: opts.bodyHtml || undefined,
      attachments: opts.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType || 'application/pdf',
      })),
    });
    console.log(`[email:smtp] Sent to ${opts.toEmail} | ${opts.subject}`);
    return;
  }

  if (resendKey) {
    const payload: Record<string, unknown> = {
      from,
      to: [opts.toEmail],
      subject: opts.subject,
      text: opts.bodyText,
      html: opts.bodyHtml || undefined,
    };
    if (opts.attachments?.length) {
      payload.attachments = opts.attachments.map((a) => ({
        filename: a.filename,
        content: a.content.toString('base64'),
      }));
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend ${res.status}: ${body}`);
    }
    console.log(`[email:resend] Sent to ${opts.toEmail} | ${opts.subject}`);
    return;
  }

  // Dev fallback: log + optionally write PDF attachments under uploads/emails
  console.log(`[email:dev] To: ${opts.toEmail} | ${opts.subject}`);
  console.log(opts.bodyText);
  if (opts.attachments?.length) {
    const dir = path.resolve(process.cwd(), 'uploads', 'emails', opts.outboxId);
    fs.mkdirSync(dir, { recursive: true });
    for (const a of opts.attachments) {
      const filePath = path.join(dir, a.filename);
      fs.writeFileSync(filePath, a.content);
      console.log(`[email:dev] Attachment saved: ${filePath}`);
    }
  }
}

export function admissionAcceptedEmail(opts: {
  parentName: string;
  studentName: string;
  schoolName: string;
  classLabel: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  dueDate: string;
  referenceCode: string;
  invoiceSummaryHtml?: string;
}) {
  const bodyText = [
    `Dear ${opts.parentName},`,
    '',
    `Congratulations! ${opts.studentName} has been admitted to ${opts.schoolName}.`,
    `Application reference: ${opts.referenceCode}`,
    `Temporary class assignment: ${opts.classLabel}`,
    '',
    `Invoice ${opts.invoiceNumber}: ${opts.amount} ${opts.currency} due ${opts.dueDate}`,
    `(Registration fee + first month tuition)`,
    '',
    'A PDF copy of the invoice is attached. Pay in the parent portal before the deadline to confirm the seat.',
    '',
    '— ' + (opts.schoolName || 'Prime Teaching System'),
  ].join('\n');

  const bodyHtml = `
    <p>Dear ${opts.parentName},</p>
    <p>Congratulations! <strong>${opts.studentName}</strong> has been admitted to <strong>${opts.schoolName}</strong>.</p>
    <ul>
      <li>Reference: ${opts.referenceCode}</li>
      <li>Provisional class: ${opts.classLabel}</li>
      <li>Invoice: ${opts.invoiceNumber}</li>
      <li>Amount due: ${opts.amount} ${opts.currency}</li>
      <li>Deadline: ${opts.dueDate}</li>
    </ul>
    ${opts.invoiceSummaryHtml || ''}
    <p>A PDF copy of the invoice is attached. Pay in the parent portal before the deadline to confirm the seat.</p>
  `;

  return {
    subject: `Admission offer — ${opts.studentName} (${opts.schoolName})`,
    bodyText,
    bodyHtml,
  };
}

export function admissionRejectedEmail(opts: {
  parentName: string;
  studentName: string;
  schoolName: string;
  reason: string;
}) {
  return {
    subject: `Admission decision — ${opts.studentName}`,
    bodyText: [
      `Dear ${opts.parentName},`,
      '',
      `We regret to inform you that the application for ${opts.studentName} at ${opts.schoolName} was not successful.`,
      `Reason: ${opts.reason}`,
      '',
      'You may re-apply in a future intake window.',
      '',
      '— ' + (opts.schoolName || 'Prime Teaching System'),
    ].join('\n'),
  };
}

export function paymentDelayRejectionEmail(opts: {
  parentName: string;
  studentName: string;
  schoolName: string;
  referenceCode?: string;
  dueDate?: string;
}) {
  return {
    subject: `Admission offer expired — ${opts.studentName}`,
    bodyText: [
      `Dear ${opts.parentName},`,
      '',
      `The admission offer for ${opts.studentName}${opts.referenceCode ? ` (${opts.referenceCode})` : ''} at ${opts.schoolName} has expired due to unpaid fees${opts.dueDate ? ` (deadline ${opts.dueDate})` : ''}.`,
      'The reserved seat has been released.',
      '',
      '— ' + (opts.schoolName || 'Prime Teaching System'),
    ].join('\n'),
  };
}

export function invoiceReminderEmail(opts: {
  parentName: string;
  studentName?: string;
  invoiceNumber: string;
  balanceDue?: number;
  amount?: number;
  currency: string;
  dueDate: string;
  schoolName: string;
  overdue?: boolean;
}) {
  const amt = opts.balanceDue ?? opts.amount ?? 0;
  return {
    subject: opts.overdue
      ? `Overdue invoice — ${opts.invoiceNumber}`
      : `Payment reminder — Invoice ${opts.invoiceNumber}`,
    bodyText: [
      `Dear ${opts.parentName},`,
      '',
      opts.overdue
        ? `Invoice ${opts.invoiceNumber}${opts.studentName ? ` for ${opts.studentName}` : ''} — ${amt} ${opts.currency} — was due on ${opts.dueDate} and remains unpaid (${opts.schoolName}).`
        : `This is a reminder that invoice ${opts.invoiceNumber}${opts.studentName ? ` for ${opts.studentName}` : ''} — ${amt} ${opts.currency} — is due on ${opts.dueDate} (${opts.schoolName}).`,
      'A PDF copy is attached. Partial payments are accepted in the parent portal.',
      '',
      '— ' + (opts.schoolName || 'Prime Teaching System'),
    ].join('\n'),
    bodyHtml: `
      <p>Dear ${opts.parentName},</p>
      <p>${
        opts.overdue
          ? `Invoice <strong>${opts.invoiceNumber}</strong>${opts.studentName ? ` for <strong>${opts.studentName}</strong>` : ''} — <strong>${amt} ${opts.currency}</strong> — was due on <strong>${opts.dueDate}</strong> and remains unpaid.`
          : `Reminder: invoice <strong>${opts.invoiceNumber}</strong>${opts.studentName ? ` for <strong>${opts.studentName}</strong>` : ''} — <strong>${amt} ${opts.currency}</strong> — is due on <strong>${opts.dueDate}</strong>.`
      }</p>
      <p>A PDF copy is attached. Partial payments are accepted in the parent portal.</p>
      <p>— ${opts.schoolName || 'Prime Teaching System'}</p>
    `,
  };
}

export function invoiceIssuedEmail(opts: {
  parentName: string;
  studentName?: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  dueDate: string;
  schoolName: string;
  billingPeriod?: string;
}) {
  return {
    subject: `New invoice — ${opts.invoiceNumber}`,
    bodyText: [
      `Dear ${opts.parentName},`,
      '',
      `A new invoice ${opts.invoiceNumber}${opts.studentName ? ` for ${opts.studentName}` : ''}${opts.billingPeriod ? ` (${opts.billingPeriod})` : ''} has been issued by ${opts.schoolName}.`,
      `Amount due: ${opts.amount} ${opts.currency}`,
      `Due date: ${opts.dueDate}`,
      '',
      'A PDF copy is attached. Pay in the parent portal (partial payments accepted).',
      '',
      '— ' + (opts.schoolName || 'Prime Teaching System'),
    ].join('\n'),
    bodyHtml: `
      <p>Dear ${opts.parentName},</p>
      <p>A new invoice <strong>${opts.invoiceNumber}</strong>${opts.studentName ? ` for <strong>${opts.studentName}</strong>` : ''} has been issued by <strong>${opts.schoolName}</strong>.</p>
      <ul>
        <li>Amount due: ${opts.amount} ${opts.currency}</li>
        <li>Due date: ${opts.dueDate}</li>
        ${opts.billingPeriod ? `<li>Period: ${opts.billingPeriod}</li>` : ''}
      </ul>
      <p>A PDF copy is attached. Pay in the parent portal (partial payments accepted).</p>
    `,
  };
}

export function infoRequestedEmail(opts: {
  parentName: string;
  studentName: string;
  schoolName: string;
  notes: string;
  referenceCode: string;
}) {
  return {
    subject: `Additional information needed — ${opts.referenceCode}`,
    bodyText: [
      `Dear ${opts.parentName},`,
      '',
      `Regarding ${opts.studentName}'s application (${opts.referenceCode}) at ${opts.schoolName}:`,
      opts.notes,
      '',
      'Please update the application in the parent portal.',
      '',
      '— ' + (opts.schoolName || 'Prime Teaching System'),
    ].join('\n'),
  };
}

export function paymentReceiptEmail(opts: {
  parentName: string;
  studentName?: string;
  invoiceNumber: string;
  amountPaid: number;
  balanceDue: number;
  currency: string;
  schoolName: string;
}) {
  return {
    subject: `Payment received — ${opts.invoiceNumber}`,
    bodyText: [
      `Dear ${opts.parentName},`,
      '',
      `We received a payment of ${opts.amountPaid} ${opts.currency} for invoice ${opts.invoiceNumber}${opts.studentName ? ` (${opts.studentName})` : ''}.`,
      opts.balanceDue > 0
        ? `Remaining balance: ${opts.balanceDue} ${opts.currency}.`
        : 'This invoice is now fully paid. Thank you.',
      '',
      '— ' + (opts.schoolName || 'Prime Teaching System'),
    ].join('\n'),
  };
}
