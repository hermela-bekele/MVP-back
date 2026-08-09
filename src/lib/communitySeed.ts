import { query } from '../db/pool.js';

const HOD_COMMUNITY_ID = 'community-hods';
const STUDENT_COMMUNITY_ID = 'community-students';

/**
 * School heads sit above every community in the chain (dept teacher rooms, the
 * HoDs room, and the student room), so they're added as an owner everywhere —
 * giving them oversight/announcement reach without cluttering member lists for
 * anyone else.
 */
async function addSchoolHeadsToCommunity(communityId: string): Promise<void> {
  await query(
    `INSERT INTO community_members (id, community_id, user_id, role)
     SELECT $1 || '-' || pu.id, $1, pu.id, 'owner'
     FROM portal_users pu
     WHERE pu.role = 'school-head'
     ON CONFLICT (community_id, user_id) DO NOTHING`,
    [communityId]
  );
}

/** "Mathematics Department" -> "Mathematics Teachers"; "Languages & English" -> "Languages & English Teachers". */
function teacherCommunityName(departmentName: string): string {
  const trimmed = departmentName.trim();
  if (/department$/i.test(trimmed)) {
    return trimmed.replace(/department$/i, 'Teachers').trim();
  }
  return `${trimmed} Teachers`;
}

export async function ensureDefaultChannels(communityId: string): Promise<void> {
  await query(
    `INSERT INTO community_channels (id, community_id, name, description, type, position)
     VALUES ($1, $2, 'announcements', 'Pinned updates for this community.', 'announcement', 0)
     ON CONFLICT (id) DO NOTHING`,
    [`${communityId}-announcements`, communityId]
  );
  await query(
    `INSERT INTO community_channels (id, community_id, name, description, type, position)
     VALUES ($1, $2, 'general', 'General discussion.', 'text', 1)
     ON CONFLICT (id) DO NOTHING`,
    [`${communityId}-general`, communityId]
  );
}

/**
 * Ensures every department has a "{Department} Teachers" community (teachers + their HoD),
 * that a single school-wide "Heads of Department" community exists for HoDs to align
 * across departments, and that a single school-wide "Student Community" exists for
 * students. Teachers only ever see their own department's community; HoDs see both
 * their department's teacher community and the HoDs community; school heads sit on top
 * of every room so announcements and oversight reach the whole hierarchy (school head →
 * HoDs → teachers → students). Idempotent — safe to call on every request since new
 * departments/teachers/HoDs/students are picked up automatically.
 */
export async function ensureCommunitiesSeeded(): Promise<void> {
  const { rows: departments } = await query('SELECT id, name FROM departments');

  for (const dept of departments as { id: string; name: string }[]) {
    const communityId = `community-dept-${dept.id}`;
    await query(
      `INSERT INTO communities (id, name, description, type, department_id, created_by)
       VALUES ($1, $2, $3, 'department', $4, NULL)
       ON CONFLICT (id) DO NOTHING`,
      [
        communityId,
        teacherCommunityName(dept.name),
        `Discussion space for ${dept.name} teachers and their department head.`,
        dept.id,
      ]
    );
    await ensureDefaultChannels(communityId);

    await query(
      `INSERT INTO community_members (id, community_id, user_id, role)
       SELECT $1 || '-' || pu.id, $1, pu.id, 'admin'
       FROM portal_users pu
       WHERE pu.department_id = $2 AND pu.role = 'department-head'
       ON CONFLICT (community_id, user_id) DO NOTHING`,
      [communityId, dept.id]
    );
    await query(
      `INSERT INTO community_members (id, community_id, user_id, role)
       SELECT $1 || '-' || pu.id, $1, pu.id, 'member'
       FROM teachers t
       JOIN portal_users pu ON LOWER(pu.email) = LOWER(t.email) AND pu.role = 'teacher'
       WHERE t.department_id = $2
       ON CONFLICT (community_id, user_id) DO NOTHING`,
      [communityId, dept.id]
    );
    await addSchoolHeadsToCommunity(communityId);
  }

  await query(
    `INSERT INTO communities (id, name, description, type, department_id, created_by)
     VALUES ($1, 'Heads of Department', 'Cross-department space for HoDs to align on school-wide priorities.', 'general', NULL, NULL)
     ON CONFLICT (id) DO NOTHING`,
    [HOD_COMMUNITY_ID]
  );
  await ensureDefaultChannels(HOD_COMMUNITY_ID);
  await query(
    `INSERT INTO community_members (id, community_id, user_id, role)
     SELECT $1 || '-' || pu.id, $1, pu.id, 'admin'
     FROM portal_users pu
     WHERE pu.role = 'department-head'
     ON CONFLICT (community_id, user_id) DO NOTHING`,
    [HOD_COMMUNITY_ID]
  );
  await addSchoolHeadsToCommunity(HOD_COMMUNITY_ID);

  await query(
    `INSERT INTO communities (id, name, description, type, department_id, created_by)
     VALUES ($1, 'Student Community', 'School-wide space for students to connect and see announcements.', 'general', NULL, NULL)
     ON CONFLICT (id) DO NOTHING`,
    [STUDENT_COMMUNITY_ID]
  );
  await ensureDefaultChannels(STUDENT_COMMUNITY_ID);
  await query(
    `INSERT INTO community_members (id, community_id, user_id, role)
     SELECT $1 || '-' || pu.id, $1, pu.id, 'member'
     FROM portal_users pu
     WHERE pu.role = 'student'
     ON CONFLICT (community_id, user_id) DO NOTHING`,
    [STUDENT_COMMUNITY_ID]
  );
  await addSchoolHeadsToCommunity(STUDENT_COMMUNITY_ID);
}
