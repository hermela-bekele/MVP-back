import { query } from '../db/pool.js';
import { newId } from '../lib/ids.js';
import { writeAudit } from '../lib/audit.js';

export async function createReenrollmentCampaign(opts: {
  schoolId: string;
  title: string;
  targetGrade?: string;
  dueDate?: string;
  createdBy?: string;
}) {
  const id = newId('rec');
  await query(
    `INSERT INTO reenrollment_campaigns (id, school_id, title, target_grade, due_date, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, opts.schoolId, opts.title, opts.targetGrade ?? null, opts.dueDate ?? null, opts.createdBy ?? null]
  );

  const params: unknown[] = [opts.schoolId];
  let sql = `SELECT s.id, psl.parent_id FROM students s
    LEFT JOIN parent_student_links psl ON psl.student_id = s.id
    WHERE s.school_id = $1 AND s.status = 'Active'`;
  if (opts.targetGrade) {
    params.push(opts.targetGrade);
    sql += ` AND s.grade = $${params.length}`;
  }
  const { rows: students } = await query(sql, params);
  for (const s of students) {
    await query(
      `INSERT INTO reenrollment_invites (id, campaign_id, school_id, student_id, parent_id, status)
       VALUES ($1,$2,$3,$4,$5,'pending')
       ON CONFLICT (campaign_id, student_id) DO NOTHING`,
      [newId('rei'), id, opts.schoolId, s.id, s.parent_id ?? null]
    );
  }

  await writeAudit({
    schoolId: opts.schoolId,
    actorUserId: opts.createdBy,
    action: 'reenroll.campaign_create',
    entityType: 'reenrollment_campaign',
    entityId: id,
    metadata: { invites: students.length },
  });

  return { id, inviteCount: students.length };
}

export async function listReenrollmentCampaigns(schoolId: string) {
  const { rows } = await query(
    `SELECT c.*,
       (SELECT COUNT(*)::int FROM reenrollment_invites i WHERE i.campaign_id = c.id) AS invite_count,
       (SELECT COUNT(*)::int FROM reenrollment_invites i WHERE i.campaign_id = c.id AND i.status = 'confirmed') AS confirmed_count
     FROM reenrollment_campaigns c
     WHERE c.school_id = $1
     ORDER BY c.created_at DESC`,
    [schoolId]
  );
  return rows.map((r) => ({
    id: r.id,
    schoolId: r.school_id,
    title: r.title,
    targetGrade: r.target_grade,
    dueDate: r.due_date,
    status: r.status,
    inviteCount: r.invite_count,
    confirmedCount: r.confirmed_count,
    createdAt: r.created_at,
  }));
}

export async function listParentReenrollmentInvites(parentUserId: string, parentEmail: string) {
  const { rows } = await query(
    `SELECT i.*, c.title, c.due_date, c.status AS campaign_status, s.name AS student_name, s.grade
     FROM reenrollment_invites i
     JOIN reenrollment_campaigns c ON c.id = i.campaign_id
     JOIN students s ON s.id = i.student_id
     LEFT JOIN parents p ON p.id = i.parent_id
     WHERE c.status = 'open'
       AND (p.user_id = $1 OR LOWER(s.parent_email) = LOWER($2))
     ORDER BY c.created_at DESC`,
    [parentUserId, parentEmail]
  );
  return rows.map((r) => ({
    id: r.id,
    campaignId: r.campaign_id,
    title: r.title,
    dueDate: r.due_date,
    status: r.status,
    studentId: r.student_id,
    studentName: r.student_name,
    grade: r.grade,
  }));
}

export async function respondReenrollmentInvite(
  inviteId: string,
  status: 'confirmed' | 'declined',
  actorUserId?: string
) {
  const { rows } = await query('SELECT * FROM reenrollment_invites WHERE id = $1', [inviteId]);
  const invite = rows[0];
  if (!invite) throw Object.assign(new Error('Invite not found'), { status: 404 });
  await query(
    `UPDATE reenrollment_invites SET status = $1, responded_at = NOW() WHERE id = $2`,
    [status, inviteId]
  );
  await writeAudit({
    schoolId: invite.school_id,
    actorUserId,
    action: 'reenroll.respond',
    entityType: 'reenrollment_invite',
    entityId: inviteId,
    metadata: { status },
  });
  return { id: inviteId, status };
}
