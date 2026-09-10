import { query } from '../db/pool.js';
import { newId } from './ids.js';
import type { AuthUser } from '../middleware/auth.js';

export type CommunityMemberRole = 'owner' | 'admin' | 'member';

export async function getMembership(
  communityId: string,
  userId: string
): Promise<{ role: CommunityMemberRole } | null> {
  const { rows } = await query(
    `SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2`,
    [communityId, userId]
  );
  if (!rows[0]) return null;
  return { role: rows[0].role as CommunityMemberRole };
}

export function isCommunityAdmin(role: CommunityMemberRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

/** Resolve community id for a channel; null if missing. */
export async function communityIdForChannel(channelId: string): Promise<string | null> {
  const { rows } = await query(
    `SELECT community_id FROM community_channels WHERE id = $1`,
    [channelId]
  );
  return rows[0]?.community_id ?? null;
}

export async function communityIdForThread(threadId: string): Promise<string | null> {
  const { rows } = await query(
    `SELECT c.community_id
     FROM community_threads t
     JOIN community_channels c ON c.id = t.channel_id
     WHERE t.id = $1`,
    [threadId]
  );
  return rows[0]?.community_id ?? null;
}

export async function communityIdForMessage(messageId: string): Promise<string | null> {
  const { rows } = await query(
    `SELECT COALESCE(ch.community_id, ch2.community_id) AS community_id
     FROM community_messages m
     LEFT JOIN community_channels ch ON ch.id = m.channel_id
     LEFT JOIN community_threads t ON t.id = m.thread_id
     LEFT JOIN community_channels ch2 ON ch2.id = t.channel_id
     WHERE m.id = $1`,
    [messageId]
  );
  return rows[0]?.community_id ?? null;
}

export async function requireCommunityMember(
  communityId: string,
  userId: string
): Promise<CommunityMemberRole> {
  const mem = await getMembership(communityId, userId);
  if (!mem) {
    const err = new Error('Not a member of this community') as Error & { status: number };
    err.status = 403;
    throw err;
  }
  return mem.role;
}

export async function requireCommunityAdmin(
  communityId: string,
  userId: string
): Promise<CommunityMemberRole> {
  const role = await requireCommunityMember(communityId, userId);
  if (!isCommunityAdmin(role)) {
    const err = new Error('Admin or owner role required') as Error & { status: number };
    err.status = 403;
    throw err;
  }
  return role;
}

/** Portal roles allowed to create communities (school-level admins). */
export function canCreateCommunity(user: AuthUser): boolean {
  return (
    user.role === 'school-head' ||
    user.role === 'moe' ||
    user.role === 'head-of-academics' ||
    user.role === 'department-head'
  );
}

/** Extract @Display Name or @email tokens from message content. */
export function extractMentionTokens(content: string): string[] {
  const matches = content.match(/@([^\s@][^@]*?)(?=\s|$|[.,!?;:])/g) ?? [];
  return [...new Set(matches.map((m) => m.slice(1).trim()).filter(Boolean))];
}

export async function resolveMentionedUserIds(
  communityId: string,
  tokens: string[]
): Promise<string[]> {
  if (tokens.length === 0) return [];
  const { rows } = await query<{ id: string }>(
    `SELECT DISTINCT u.id
     FROM community_members m
     JOIN portal_users u ON u.id = m.user_id
     WHERE m.community_id = $1
       AND (
         lower(u.display_name) = ANY($2::text[])
         OR lower(u.email) = ANY($2::text[])
         OR lower(split_part(u.email, '@', 1)) = ANY($2::text[])
       )`,
    [communityId, tokens.map((t) => t.toLowerCase())]
  );
  return rows.map((r) => r.id);
}

export async function createMentionNotifications(
  userIds: string[],
  messageId: string,
  excludeUserId: string
) {
  const created: string[] = [];
  for (const userId of userIds) {
    if (userId === excludeUserId) continue;
    const id = newId('cment');
    await query(
      `INSERT INTO community_mention_notifications (id, user_id, message_id, is_read)
       VALUES ($1,$2,$3,FALSE)`,
      [id, userId, messageId]
    );
    created.push(userId);
  }
  return created;
}

export async function loadReactionsForMessages(
  messageIds: string[],
  currentUserId: string
): Promise<Map<string, { emoji: string; count: number; me: boolean }[]>> {
  const map = new Map<string, { emoji: string; count: number; me: boolean }[]>();
  if (messageIds.length === 0) return map;

  const { rows } = await query(
    `SELECT message_id, emoji,
            COUNT(*)::int AS count,
            BOOL_OR(user_id = $2) AS me
     FROM community_reactions
     WHERE message_id = ANY($1::text[])
     GROUP BY message_id, emoji
     ORDER BY emoji`,
    [messageIds, currentUserId]
  );

  for (const row of rows) {
    const mid = String(row.message_id);
    const list = map.get(mid) ?? [];
    list.push({
      emoji: String(row.emoji),
      count: Number(row.count),
      me: Boolean(row.me),
    });
    map.set(mid, list);
  }
  return map;
}

export async function autoJoinDepartmentCommunities(user: AuthUser) {
  // Bug fix: this guard used to wrap the ENTIRE function, so school-head and
  // head-of-academics — who never have a departmentId, since they oversee the whole
  // school rather than one subject — silently never reached the "general" or "hod"
  // auto-join blocks below at login. It now only skips this one own-department join.
  if (user.departmentId) {
    const { rows } = await query(
      `SELECT id FROM communities
       WHERE type = 'department' AND department_id = $1
         AND ($2::text IS NULL OR school_id = $2 OR school_id IS NULL)`,
      [user.departmentId, user.schoolId]
    );
    for (const row of rows) {
      await query(
        `INSERT INTO community_members (id, community_id, user_id, role)
         VALUES ($1,$2,$3,'member')
         ON CONFLICT (community_id, user_id) DO NOTHING`,
        [newId('cmem'), row.id, user.id]
      );
    }
  }

  // CO-001: the Curriculum Head (head-of-academics) isn't scoped to one department but
  // oversees curriculum across all of them — so they join every subject department
  // community at their school, not just a school-wide general one.
  if (user.schoolId && user.role === 'head-of-academics') {
    const { rows: allDeptCommunities } = await query(
      `SELECT id FROM communities WHERE type = 'department' AND school_id = $1`,
      [user.schoolId]
    );
    for (const row of allDeptCommunities) {
      await query(
        `INSERT INTO community_members (id, community_id, user_id, role)
         VALUES ($1,$2,$3,'member')
         ON CONFLICT (community_id, user_id) DO NOTHING`,
        [newId('cmem'), row.id, user.id]
      );
    }
  }

  // Always ensure general communities for school staff
  if (user.schoolId && ['teacher', 'department-head', 'school-head', 'head-of-academics'].includes(user.role)) {
    const { rows: generals } = await query(
      `SELECT id FROM communities WHERE type = 'general' AND school_id = $1`,
      [user.schoolId]
    );
    for (const row of generals) {
      await query(
        `INSERT INTO community_members (id, community_id, user_id, role)
         VALUES ($1,$2,$3,'member')
         ON CONFLICT (community_id, user_id) DO NOTHING`,
        [newId('cmem'), row.id, user.id]
      );
    }
  }

  // CO-002: department heads, the school head, and the curriculum head (head-of-academics)
  // are automatically members of their school's system-generated "Department Heads"
  // community — a cross-department space separate from each subject's own community.
  if (user.schoolId && ['department-head', 'school-head', 'head-of-academics'].includes(user.role)) {
    const { rows: hodCommunities } = await query(
      `SELECT id FROM communities WHERE type = 'hod' AND school_id = $1`,
      [user.schoolId]
    );
    for (const row of hodCommunities) {
      await query(
        `INSERT INTO community_members (id, community_id, user_id, role)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (community_id, user_id) DO NOTHING`,
        [newId('cmem'), row.id, user.id, user.role === 'school-head' ? 'admin' : 'member']
      );
    }
  }
}
