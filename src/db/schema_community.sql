-- Discord-style teacher communities (separate from parent/staff message_threads)

CREATE TABLE IF NOT EXISTS communities (
  id TEXT PRIMARY KEY,
  school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon_url TEXT,
  type TEXT NOT NULL CHECK (type IN ('department', 'general', 'custom')),
  department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES portal_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_members (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')) DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (community_id, user_id)
);

CREATE TABLE IF NOT EXISTS community_channels (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL CHECK (type IN ('text', 'announcement')) DEFAULT 'text',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (community_id, name)
);

CREATE TABLE IF NOT EXISTS community_threads (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES community_channels(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES portal_users(id) ON DELETE SET NULL,
  root_message_id TEXT,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT REFERENCES community_channels(id) ON DELETE CASCADE,
  thread_id TEXT REFERENCES community_threads(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  parent_message_id TEXT REFERENCES community_messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ,
  CONSTRAINT community_messages_location_chk CHECK (
    (channel_id IS NOT NULL AND thread_id IS NULL)
    OR (channel_id IS NULL AND thread_id IS NOT NULL)
  )
);

-- Deferred FK: root_message_id → community_messages (table created above)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'community_threads_root_message_id_fkey'
  ) THEN
    ALTER TABLE community_threads
      ADD CONSTRAINT community_threads_root_message_id_fkey
      FOREIGN KEY (root_message_id) REFERENCES community_messages(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS community_reactions (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES community_messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS community_mention_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES community_messages(id) ON DELETE CASCADE,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_channel_reads (
  user_id TEXT NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES community_channels(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, channel_id)
);

CREATE TABLE IF NOT EXISTS community_thread_reads (
  user_id TEXT NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES community_threads(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, thread_id)
);

CREATE INDEX IF NOT EXISTS idx_community_members_user ON community_members(user_id);
CREATE INDEX IF NOT EXISTS idx_community_members_community ON community_members(community_id);
CREATE INDEX IF NOT EXISTS idx_community_channels_community ON community_channels(community_id);
CREATE INDEX IF NOT EXISTS idx_community_threads_channel ON community_threads(channel_id);
CREATE INDEX IF NOT EXISTS idx_community_messages_channel_created
  ON community_messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_messages_thread_created
  ON community_messages(thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_reactions_message ON community_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_community_mentions_user_unread
  ON community_mention_notifications(user_id, is_read)
  WHERE is_read = FALSE;
