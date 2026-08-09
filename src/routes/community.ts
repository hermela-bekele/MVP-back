import { Router, type Request, type Response } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { newId } from '../lib/ids.js';
import {
  autoJoinDepartmentCommunities,
  canCreateCommunity,
  communityIdForChannel,
  communityIdForMessage,
  communityIdForThread,
  createMentionNotifications,
  extractMentionTokens,
  isCommunityAdmin,
  loadReactionsForMessages,
  requireCommunityAdmin,
  requireCommunityMember,
  resolveMentionedUserIds,
} from '../lib/communityAccess.js';
import {
  mapChannel,
  mapCommunity,
  mapCommunityMember,
  mapMentionNotification,
  mapMessage,
  mapThread,
} from '../lib/communitySerialize.js';
import {
  emitChannelMessage,
  emitMention,
  emitReaction,
  emitThreadMessage,
} from '../lib/communityRealtime.js';

export const communityRouter = Router();

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: (err?: unknown) => void) => {
    fn(req, res).catch((err: unknown) => {
      const e = err as Error & { status?: number };
      if (e.status && e.status >= 400 && e.status < 600) {
        res.status(e.status).json({ error: e.message });
        return;
      }
      next(err);
    });
  };
}

function paramId(req: Request, key: string): string {
  const v = req.params[key];
  return String(Array.isArray(v) ? v[0] : v);
}

const MESSAGE_SELECT = `
  SELECT m.*,
         u.display_name AS author_name,
         u.role AS author_role,
         (
           SELECT t.id FROM community_threads t
           WHERE t.root_message_id = m.id
           LIMIT 1
         ) AS thread_id_for_root,
         (
           SELECT COUNT(*)::int FROM community_messages tm
           WHERE tm.thread_id = (
             SELECT t2.id FROM community_threads t2 WHERE t2.root_message_id = m.id LIMIT 1
           )
         ) AS thread_reply_count
  FROM community_messages m
  JOIN portal_users u ON u.id = m.author_id
`;

async function hydrateMessages(rows: Record<string, unknown>[], userId: string) {
  const ids = rows.map((r) => String(r.id));
  const reactions = await loadReactionsForMessages(ids, userId);
  return rows.map((r) =>
    mapMessage(r, {
      reactions: reactions.get(String(r.id)) ?? [],
      threadReplyCount: Number(r.thread_reply_count ?? 0),
    })
  );
}

// ── Communities ─────────────────────────────────────────────────────────────

communityRouter.get(
  '/communities',
  requireAuth,
  asyncHandler(async (req, res) => {
    await autoJoinDepartmentCommunities(req.user!);

    const { rows } = await query(
      `SELECT c.*,
              m.role AS member_role,
              (
                SELECT COUNT(*)::int
                FROM community_channels ch
                LEFT JOIN community_channel_reads r
                  ON r.channel_id = ch.id AND r.user_id = $1
                WHERE ch.community_id = c.id
                  AND EXISTS (
                    SELECT 1 FROM community_messages msg
                    WHERE msg.channel_id = ch.id
                      AND msg.created_at > COALESCE(r.last_read_at, '1970-01-01'::timestamptz)
                  )
              ) AS unread_count
       FROM communities c
       JOIN community_members m ON m.community_id = c.id AND m.user_id = $1
       WHERE ($2::text IS NULL OR c.school_id = $2 OR c.school_id IS NULL OR $3 = 'moe')
       ORDER BY c.name ASC`,
      [req.user!.id, req.user!.schoolId, req.user!.role]
    );

    res.json(rows.map((r) => mapCommunity(r)));
  })
);

communityRouter.post(
  '/communities',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!canCreateCommunity(req.user!)) {
      res.status(403).json({ error: 'Only school admins or department heads can create communities' });
      return;
    }

    const name = String(req.body?.name ?? '').trim();
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const type = (req.body?.type as string) || 'custom';
    if (!['department', 'general', 'custom'].includes(type)) {
      res.status(400).json({ error: 'Invalid community type' });
      return;
    }

    const id = newId('comm');
    const schoolId = req.body?.schoolId || req.user!.schoolId;
    const departmentId = req.body?.departmentId || null;
    const description = String(req.body?.description ?? '');
    const iconUrl = req.body?.iconUrl ?? null;

    await query(
      `INSERT INTO communities (id, school_id, name, description, icon_url, type, department_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, schoolId, name, description, iconUrl, type, departmentId, req.user!.id]
    );

    await query(
      `INSERT INTO community_members (id, community_id, user_id, role)
       VALUES ($1,$2,$3,'owner')`,
      [newId('cmem'), id, req.user!.id]
    );

    // Default channels
    const defaults = [
      { name: 'announcements', type: 'announcement', position: 0 },
      { name: 'general', type: 'text', position: 1 },
    ];
    for (const ch of defaults) {
      await query(
        `INSERT INTO community_channels (id, community_id, name, description, type, position)
         VALUES ($1,$2,$3,'',$4,$5)`,
        [newId('cchan'), id, ch.name, ch.type, ch.position]
      );
    }

    // Auto-add department members
    if (type === 'department' && departmentId) {
      const { rows: deptUsers } = await query(
        `SELECT id, role FROM portal_users
         WHERE department_id = $1 AND role IN ('teacher', 'department-head') AND id <> $2`,
        [departmentId, req.user!.id]
      );
      for (const u of deptUsers) {
        await query(
          `INSERT INTO community_members (id, community_id, user_id, role)
           VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [
            newId('cmem'),
            id,
            u.id,
            u.role === 'department-head' ? 'admin' : 'member',
          ]
        );
      }
    }

    const { rows } = await query(`SELECT *, 'owner' AS member_role FROM communities WHERE id = $1`, [
      id,
    ]);
    res.status(201).json(mapCommunity(rows[0]));
  })
);

communityRouter.get(
  '/communities/:id/members',
  requireAuth,
  asyncHandler(async (req, res) => {
    const communityId = paramId(req, 'id');
    await requireCommunityMember(communityId, req.user!.id);

    const { rows } = await query(
      `SELECT m.*, u.display_name, u.email, u.role AS user_role
       FROM community_members m
       JOIN portal_users u ON u.id = m.user_id
       WHERE m.community_id = $1
       ORDER BY
         CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
         u.display_name ASC`,
      [communityId]
    );
    res.json(rows.map((r) => mapCommunityMember(r)));
  })
);

communityRouter.post(
  '/communities/:id/members',
  requireAuth,
  asyncHandler(async (req, res) => {
    const communityId = paramId(req, 'id');
    await requireCommunityAdmin(communityId, req.user!.id);

    const userId = String(req.body?.userId ?? '');
    const role = (req.body?.role as string) || 'member';
    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }
    if (!['owner', 'admin', 'member'].includes(role)) {
      res.status(400).json({ error: 'Invalid member role' });
      return;
    }

    const id = newId('cmem');
    await query(
      `INSERT INTO community_members (id, community_id, user_id, role)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (community_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [id, communityId, userId, role]
    );

    const { rows } = await query(
      `SELECT m.*, u.display_name, u.email, u.role AS user_role
       FROM community_members m
       JOIN portal_users u ON u.id = m.user_id
       WHERE m.community_id = $1 AND m.user_id = $2`,
      [communityId, userId]
    );
    res.status(201).json(mapCommunityMember(rows[0]));
  })
);

communityRouter.get(
  '/communities/:id/channels',
  requireAuth,
  asyncHandler(async (req, res) => {
    const communityId = paramId(req, 'id');
    await requireCommunityMember(communityId, req.user!.id);

    const { rows } = await query(
      `SELECT ch.*,
              (
                SELECT COUNT(*)::int FROM community_messages msg
                WHERE msg.channel_id = ch.id
                  AND msg.created_at > COALESCE(
                    (SELECT r.last_read_at FROM community_channel_reads r
                     WHERE r.channel_id = ch.id AND r.user_id = $2),
                    '1970-01-01'::timestamptz
                  )
              ) AS unread_count
       FROM community_channels ch
       WHERE ch.community_id = $1
       ORDER BY ch.position ASC, ch.name ASC`,
      [communityId, req.user!.id]
    );
    res.json(rows.map((r) => mapChannel(r)));
  })
);

communityRouter.post(
  '/communities/:id/channels',
  requireAuth,
  asyncHandler(async (req, res) => {
    const communityId = paramId(req, 'id');
    await requireCommunityAdmin(communityId, req.user!.id);

    const name = String(req.body?.name ?? '')
      .trim()
      .replace(/^#/, '')
      .toLowerCase()
      .replace(/\s+/g, '-');
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const type = (req.body?.type as string) || 'text';
    if (!['text', 'announcement'].includes(type)) {
      res.status(400).json({ error: 'Invalid channel type' });
      return;
    }

    const { rows: posRows } = await query(
      `SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM community_channels WHERE community_id = $1`,
      [communityId]
    );
    const position =
      req.body?.position != null ? Number(req.body.position) : Number(posRows[0]?.next_pos ?? 0);

    const id = newId('cchan');
    try {
      await query(
        `INSERT INTO community_channels (id, community_id, name, description, type, position)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, communityId, name, String(req.body?.description ?? ''), type, position]
      );
    } catch (err) {
      const e = err as { code?: string };
      if (e.code === '23505') {
        res.status(409).json({ error: 'A channel with that name already exists' });
        return;
      }
      throw err;
    }

    const { rows } = await query(`SELECT * FROM community_channels WHERE id = $1`, [id]);
    res.status(201).json(mapChannel(rows[0]));
  })
);

// ── Channels / messages ─────────────────────────────────────────────────────

communityRouter.get(
  '/channels/:id/messages',
  requireAuth,
  asyncHandler(async (req, res) => {
    const channelId = paramId(req, 'id');
    const communityId = await communityIdForChannel(channelId);
    if (!communityId) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }
    await requireCommunityMember(communityId, req.user!.id);

    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const before = req.query.before ? String(req.query.before) : null;

    let rows: Record<string, unknown>[];
    if (before) {
      const beforeRes = await query(`SELECT created_at FROM community_messages WHERE id = $1`, [
        before,
      ]);
      const beforeAt = beforeRes.rows[0]?.created_at;
      if (!beforeAt) {
        res.status(400).json({ error: 'Invalid before cursor' });
        return;
      }
      const result = await query(
        `${MESSAGE_SELECT}
         WHERE m.channel_id = $1 AND m.created_at < $2
         ORDER BY m.created_at DESC
         LIMIT $3`,
        [channelId, beforeAt, limit]
      );
      rows = result.rows;
    } else {
      const result = await query(
        `${MESSAGE_SELECT}
         WHERE m.channel_id = $1
         ORDER BY m.created_at DESC
         LIMIT $2`,
        [channelId, limit]
      );
      rows = result.rows;
    }

    // Return chronological (oldest → newest) for UI
    rows.reverse();
    const messages = await hydrateMessages(rows, req.user!.id);
    res.json({
      messages,
      hasMore: rows.length === limit,
    });
  })
);

communityRouter.post(
  '/channels/:id/messages',
  requireAuth,
  asyncHandler(async (req, res) => {
    const channelId = paramId(req, 'id');
    const communityId = await communityIdForChannel(channelId);
    if (!communityId) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }
    const memberRole = await requireCommunityMember(communityId, req.user!.id);

    const { rows: chRows } = await query(`SELECT type FROM community_channels WHERE id = $1`, [
      channelId,
    ]);
    if (chRows[0]?.type === 'announcement' && !isCommunityAdmin(memberRole)) {
      res.status(403).json({ error: 'Only admins can post in announcement channels' });
      return;
    }

    const content = String(req.body?.content ?? '').trim();
    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    const id = newId('cmsg');
    const parentMessageId = req.body?.parentMessageId ?? null;

    await query(
      `INSERT INTO community_messages (id, channel_id, thread_id, author_id, content, parent_message_id)
       VALUES ($1,$2,NULL,$3,$4,$5)`,
      [id, channelId, req.user!.id, content, parentMessageId]
    );

    const tokens = extractMentionTokens(content);
    const mentioned = await resolveMentionedUserIds(communityId, tokens);
    const mentionedUsers = await createMentionNotifications(mentioned, id, req.user!.id);

    const { rows } = await query(`${MESSAGE_SELECT} WHERE m.id = $1`, [id]);
    const [message] = await hydrateMessages(rows, req.user!.id);
    emitChannelMessage(channelId, message);
    for (const uid of mentionedUsers) {
      emitMention(uid, { message, communityId, channelId });
    }
    res.status(201).json(message);
  })
);

communityRouter.post(
  '/channels/:id/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    const channelId = paramId(req, 'id');
    const communityId = await communityIdForChannel(channelId);
    if (!communityId) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }
    await requireCommunityMember(communityId, req.user!.id);

    await query(
      `INSERT INTO community_channel_reads (user_id, channel_id, last_read_at)
       VALUES ($1,$2,NOW())
       ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_at = NOW()`,
      [req.user!.id, channelId]
    );
    res.json({ ok: true });
  })
);

// ── Threads ─────────────────────────────────────────────────────────────────

communityRouter.post(
  '/messages/:id/thread',
  requireAuth,
  asyncHandler(async (req, res) => {
    const messageId = paramId(req, 'id');
    const communityId = await communityIdForMessage(messageId);
    if (!communityId) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    await requireCommunityMember(communityId, req.user!.id);

    const { rows: msgRows } = await query(
      `SELECT * FROM community_messages WHERE id = $1`,
      [messageId]
    );
    const msg = msgRows[0];
    if (!msg) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    if (!msg.channel_id) {
      res.status(400).json({ error: 'Can only start a thread from a channel message' });
      return;
    }

    const existing = await query(
      `SELECT * FROM community_threads WHERE root_message_id = $1`,
      [messageId]
    );
    if (existing.rows[0]) {
      res.json(mapThread(existing.rows[0]));
      return;
    }

    const title =
      String(req.body?.title ?? '').trim() ||
      String(msg.content).slice(0, 80) ||
      'Thread';
    const id = newId('cthread');

    await query(
      `INSERT INTO community_threads (id, channel_id, title, created_by, root_message_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, msg.channel_id, title, req.user!.id, messageId]
    );

    const { rows } = await query(`SELECT * FROM community_threads WHERE id = $1`, [id]);
    res.status(201).json(mapThread(rows[0]));
  })
);

communityRouter.get(
  '/threads/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const threadId = paramId(req, 'id');
    const communityId = await communityIdForThread(threadId);
    if (!communityId) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    await requireCommunityMember(communityId, req.user!.id);

    const { rows } = await query(
      `SELECT t.*,
              (SELECT COUNT(*)::int FROM community_messages m WHERE m.thread_id = t.id) AS reply_count
       FROM community_threads t WHERE t.id = $1`,
      [threadId]
    );
    if (!rows[0]) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    res.json(mapThread(rows[0]));
  })
);

communityRouter.get(
  '/threads/:id/messages',
  requireAuth,
  asyncHandler(async (req, res) => {
    const threadId = paramId(req, 'id');
    const communityId = await communityIdForThread(threadId);
    if (!communityId) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    await requireCommunityMember(communityId, req.user!.id);

    const { rows: threadRows } = await query(`SELECT * FROM community_threads WHERE id = $1`, [
      threadId,
    ]);
    const thread = threadRows[0];
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }

    let rootMessage: ReturnType<typeof mapMessage> | null = null;
    if (thread.root_message_id) {
      const rootRes = await query(`${MESSAGE_SELECT} WHERE m.id = $1`, [thread.root_message_id]);
      if (rootRes.rows[0]) {
        const [mapped] = await hydrateMessages(rootRes.rows, req.user!.id);
        rootMessage = mapped;
      }
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const before = req.query.before ? String(req.query.before) : null;

    let rows: Record<string, unknown>[];
    if (before) {
      const beforeRes = await query(`SELECT created_at FROM community_messages WHERE id = $1`, [
        before,
      ]);
      const beforeAt = beforeRes.rows[0]?.created_at;
      if (!beforeAt) {
        res.status(400).json({ error: 'Invalid before cursor' });
        return;
      }
      const result = await query(
        `${MESSAGE_SELECT}
         WHERE m.thread_id = $1 AND m.created_at < $2
         ORDER BY m.created_at DESC
         LIMIT $3`,
        [threadId, beforeAt, limit]
      );
      rows = result.rows;
    } else {
      const result = await query(
        `${MESSAGE_SELECT}
         WHERE m.thread_id = $1
         ORDER BY m.created_at DESC
         LIMIT $2`,
        [threadId, limit]
      );
      rows = result.rows;
    }
    rows.reverse();

    res.json({
      thread: mapThread(thread),
      rootMessage,
      messages: await hydrateMessages(rows, req.user!.id),
      hasMore: rows.length === limit,
    });
  })
);

communityRouter.post(
  '/threads/:id/messages',
  requireAuth,
  asyncHandler(async (req, res) => {
    const threadId = paramId(req, 'id');
    const communityId = await communityIdForThread(threadId);
    if (!communityId) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    await requireCommunityMember(communityId, req.user!.id);

    const { rows: tRows } = await query(`SELECT is_archived FROM community_threads WHERE id = $1`, [
      threadId,
    ]);
    if (tRows[0]?.is_archived) {
      res.status(400).json({ error: 'Thread is archived' });
      return;
    }

    const content = String(req.body?.content ?? '').trim();
    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    const id = newId('cmsg');
    const parentMessageId = req.body?.parentMessageId ?? null;

    await query(
      `INSERT INTO community_messages (id, channel_id, thread_id, author_id, content, parent_message_id)
       VALUES ($1,NULL,$2,$3,$4,$5)`,
      [id, threadId, req.user!.id, content, parentMessageId]
    );

    const tokens = extractMentionTokens(content);
    const mentioned = await resolveMentionedUserIds(communityId, tokens);
    const mentionedUsers = await createMentionNotifications(mentioned, id, req.user!.id);

    const { rows } = await query(`${MESSAGE_SELECT} WHERE m.id = $1`, [id]);
    const [message] = await hydrateMessages(rows, req.user!.id);
    emitThreadMessage(threadId, message);
    for (const uid of mentionedUsers) {
      emitMention(uid, { message, communityId, threadId });
    }
    res.status(201).json(message);
  })
);

communityRouter.post(
  '/threads/:id/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    const threadId = paramId(req, 'id');
    const communityId = await communityIdForThread(threadId);
    if (!communityId) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    await requireCommunityMember(communityId, req.user!.id);

    await query(
      `INSERT INTO community_thread_reads (user_id, thread_id, last_read_at)
       VALUES ($1,$2,NOW())
       ON CONFLICT (user_id, thread_id) DO UPDATE SET last_read_at = NOW()`,
      [req.user!.id, threadId]
    );
    res.json({ ok: true });
  })
);

// ── Reactions / message delete ──────────────────────────────────────────────

communityRouter.post(
  '/messages/:id/reactions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const messageId = paramId(req, 'id');
    const communityId = await communityIdForMessage(messageId);
    if (!communityId) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    await requireCommunityMember(communityId, req.user!.id);

    const emoji = String(req.body?.emoji ?? '').trim();
    if (!emoji || emoji.length > 32) {
      res.status(400).json({ error: 'emoji is required' });
      return;
    }

    const existing = await query(
      `SELECT id FROM community_reactions
       WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
      [messageId, req.user!.id, emoji]
    );

    if (existing.rows[0]) {
      await query(`DELETE FROM community_reactions WHERE id = $1`, [existing.rows[0].id]);
      const { rows: loc } = await query(
        `SELECT channel_id, thread_id FROM community_messages WHERE id = $1`,
        [messageId]
      );
      emitReaction({
        messageId,
        channelId: loc[0]?.channel_id,
        threadId: loc[0]?.thread_id,
      });
      res.json({ toggled: 'removed', emoji });
      return;
    }

    await query(
      `INSERT INTO community_reactions (id, message_id, user_id, emoji)
       VALUES ($1,$2,$3,$4)`,
      [newId('creact'), messageId, req.user!.id, emoji]
    );
    const { rows: loc } = await query(
      `SELECT channel_id, thread_id FROM community_messages WHERE id = $1`,
      [messageId]
    );
    emitReaction({
      messageId,
      channelId: loc[0]?.channel_id,
      threadId: loc[0]?.thread_id,
    });
    res.status(201).json({ toggled: 'added', emoji });
  })
);

communityRouter.delete(
  '/messages/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const messageId = paramId(req, 'id');
    const communityId = await communityIdForMessage(messageId);
    if (!communityId) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    const role = await requireCommunityMember(communityId, req.user!.id);

    const { rows } = await query(`SELECT author_id FROM community_messages WHERE id = $1`, [
      messageId,
    ]);
    if (!rows[0]) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    const isAuthor = rows[0].author_id === req.user!.id;
    if (!isAuthor && !isCommunityAdmin(role)) {
      res.status(403).json({ error: 'You can only delete your own messages' });
      return;
    }

    await query(`DELETE FROM community_messages WHERE id = $1`, [messageId]);
    res.status(204).end();
  })
);

communityRouter.patch(
  '/messages/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const messageId = paramId(req, 'id');
    const communityId = await communityIdForMessage(messageId);
    if (!communityId) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    await requireCommunityMember(communityId, req.user!.id);

    const { rows: existing } = await query(
      `SELECT author_id FROM community_messages WHERE id = $1`,
      [messageId]
    );
    if (!existing[0]) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    if (existing[0].author_id !== req.user!.id) {
      res.status(403).json({ error: 'You can only edit your own messages' });
      return;
    }

    const content = String(req.body?.content ?? '').trim();
    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    await query(
      `UPDATE community_messages SET content = $1, edited_at = NOW() WHERE id = $2`,
      [content, messageId]
    );

    const { rows } = await query(`${MESSAGE_SELECT} WHERE m.id = $1`, [messageId]);
    const [message] = await hydrateMessages(rows, req.user!.id);
    res.json(message);
  })
);

// ── Mention notifications ───────────────────────────────────────────────────

communityRouter.get(
  '/community/notifications',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT n.*,
              m.content,
              m.channel_id,
              m.thread_id,
              u.display_name AS author_name,
              COALESCE(ch.community_id, ch2.community_id) AS community_id
       FROM community_mention_notifications n
       JOIN community_messages m ON m.id = n.message_id
       JOIN portal_users u ON u.id = m.author_id
       LEFT JOIN community_channels ch ON ch.id = m.channel_id
       LEFT JOIN community_threads t ON t.id = m.thread_id
       LEFT JOIN community_channels ch2 ON ch2.id = t.channel_id
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC
       LIMIT 50`,
      [req.user!.id]
    );
    res.json(rows.map((r) => mapMentionNotification(r)));
  })
);

communityRouter.post(
  '/community/notifications/:id/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    await query(
      `UPDATE community_mention_notifications SET is_read = TRUE
       WHERE id = $1 AND user_id = $2`,
      [paramId(req, 'id'), req.user!.id]
    );
    res.json({ ok: true });
  })
);

communityRouter.post(
  '/community/notifications/read-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    await query(
      `UPDATE community_mention_notifications SET is_read = TRUE WHERE user_id = $1`,
      [req.user!.id]
    );
    res.json({ ok: true });
  })
);

/** Member autocomplete for @mentions */
communityRouter.get(
  '/communities/:id/mention-suggestions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const communityId = paramId(req, 'id');
    await requireCommunityMember(communityId, req.user!.id);
    const q = String(req.query.q ?? '').trim().toLowerCase();

    const { rows } = await query(
      `SELECT u.id, u.display_name, u.email, u.role
       FROM community_members m
       JOIN portal_users u ON u.id = m.user_id
       WHERE m.community_id = $1
         AND ($2 = '' OR lower(u.display_name) LIKE $2 OR lower(u.email) LIKE $2)
       ORDER BY u.display_name ASC
       LIMIT 12`,
      [communityId, q ? `%${q}%` : '']
    );

    res.json(
      rows.map((r) => ({
        id: r.id,
        displayName: r.display_name,
        email: r.email,
        role: r.role,
      }))
    );
  })
);
