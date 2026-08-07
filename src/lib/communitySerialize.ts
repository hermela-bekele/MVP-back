/** CamelCase mappers for Discord-style teacher communities */

export function mapCommunity(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    schoolId: (row.school_id as string | null) ?? null,
    name: String(row.name),
    description: String(row.description ?? ''),
    iconUrl: (row.icon_url as string | null) ?? null,
    type: row.type as 'department' | 'general' | 'custom',
    departmentId: (row.department_id as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: row.created_at
      ? new Date(row.created_at as string | Date).toISOString()
      : new Date().toISOString(),
    memberRole: row.member_role
      ? (row.member_role as 'owner' | 'admin' | 'member')
      : undefined,
    unreadCount: row.unread_count != null ? Number(row.unread_count) : undefined,
  };
}

export function mapCommunityMember(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    communityId: String(row.community_id),
    userId: String(row.user_id),
    role: row.role as 'owner' | 'admin' | 'member',
    joinedAt: row.joined_at
      ? new Date(row.joined_at as string | Date).toISOString()
      : new Date().toISOString(),
    displayName: row.display_name != null ? String(row.display_name) : undefined,
    email: row.email != null ? String(row.email) : undefined,
    userRole: row.user_role != null ? String(row.user_role) : undefined,
  };
}

export function mapChannel(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    communityId: String(row.community_id),
    name: String(row.name),
    description: String(row.description ?? ''),
    type: row.type as 'text' | 'announcement',
    position: Number(row.position ?? 0),
    createdAt: row.created_at
      ? new Date(row.created_at as string | Date).toISOString()
      : new Date().toISOString(),
    unreadCount: row.unread_count != null ? Number(row.unread_count) : undefined,
  };
}

export function mapThread(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    channelId: String(row.channel_id),
    title: String(row.title ?? ''),
    createdBy: (row.created_by as string | null) ?? null,
    rootMessageId: (row.root_message_id as string | null) ?? null,
    isPinned: Boolean(row.is_pinned),
    isArchived: Boolean(row.is_archived),
    createdAt: row.created_at
      ? new Date(row.created_at as string | Date).toISOString()
      : new Date().toISOString(),
    replyCount: row.reply_count != null ? Number(row.reply_count) : undefined,
  };
}

export type ReactionSummary = { emoji: string; count: number; me: boolean };

export function mapMessage(
  row: Record<string, unknown>,
  opts?: { reactions?: ReactionSummary[]; threadReplyCount?: number }
) {
  return {
    id: String(row.id),
    channelId: (row.channel_id as string | null) ?? null,
    threadId: (row.thread_id as string | null) ?? null,
    authorId: String(row.author_id),
    authorName: row.author_name != null ? String(row.author_name) : 'Unknown',
    authorRole: row.author_role != null ? String(row.author_role) : undefined,
    content: String(row.content),
    parentMessageId: (row.parent_message_id as string | null) ?? null,
    createdAt: row.created_at
      ? new Date(row.created_at as string | Date).toISOString()
      : new Date().toISOString(),
    editedAt: row.edited_at
      ? new Date(row.edited_at as string | Date).toISOString()
      : null,
    reactions: opts?.reactions ?? [],
    threadIdForRoot: (row.thread_id_for_root as string | null) ?? null,
    threadReplyCount: opts?.threadReplyCount ?? (row.thread_reply_count != null ? Number(row.thread_reply_count) : 0),
  };
}

export function mapMentionNotification(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    messageId: String(row.message_id),
    isRead: Boolean(row.is_read),
    createdAt: row.created_at
      ? new Date(row.created_at as string | Date).toISOString()
      : new Date().toISOString(),
    contentPreview: row.content != null ? String(row.content).slice(0, 120) : undefined,
    authorName: row.author_name != null ? String(row.author_name) : undefined,
    channelId: (row.channel_id as string | null) ?? null,
    threadId: (row.thread_id as string | null) ?? null,
    communityId: (row.community_id as string | null) ?? null,
  };
}
