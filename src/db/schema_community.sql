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

-- CO-002: a cross-department "Department Heads" community — system-generated, never
-- manually created — bringing together every department head, the school head, and the
-- curriculum head (head-of-academics) at a school, separate from each subject's own
-- department community. Re-adding the constraint by its standard auto-generated name is
-- idempotent (safe to re-run on every deploy).
ALTER TABLE communities DROP CONSTRAINT IF EXISTS communities_type_check;
ALTER TABLE communities ADD CONSTRAINT communities_type_check
  CHECK (type IN ('department', 'general', 'custom', 'hod'));

-- One system-generated HOD community per school that doesn't already have one.
INSERT INTO communities (id, school_id, name, description, type, created_by)
SELECT 'hod-' || s.id, s.id, 'Department Heads', 'Department heads, the school head, and the curriculum head', 'hod', NULL
FROM schools s
WHERE NOT EXISTS (
  SELECT 1 FROM communities c WHERE c.school_id = s.id AND c.type = 'hod'
);

-- Default channels for any HOD community that doesn't have one yet.
INSERT INTO community_channels (id, community_id, name, description, type, position)
SELECT c.id || '-ch-gen', c.id, 'general', 'General discussion', 'text', 0
FROM communities c
WHERE c.type = 'hod'
  AND NOT EXISTS (SELECT 1 FROM community_channels ch WHERE ch.community_id = c.id);

-- Backfill: every existing department-head, school-head, and head-of-academics account
-- joins their school's HOD community. New accounts going forward are auto-joined at login
-- (see autoJoinDepartmentCommunities in src/lib/communityAccess.ts) — this only covers
-- accounts that already existed before this community type was introduced.
INSERT INTO community_members (id, community_id, user_id, role)
SELECT 'hod-mem-' || pu.id, c.id, pu.id,
  CASE WHEN pu.role = 'school-head' THEN 'admin' ELSE 'member' END
FROM portal_users pu
JOIN communities c ON c.school_id = pu.school_id AND c.type = 'hod'
WHERE pu.role IN ('department-head', 'school-head', 'head-of-academics')
ON CONFLICT (community_id, user_id) DO NOTHING;

-- Bug fix backfill: autoJoinDepartmentCommunities used to bail out entirely for any user
-- without a departmentId, so school-head and head-of-academics accounts (who never have
-- one) silently never got auto-joined to their school's general or department
-- communities at login. This repairs any account already affected; the live function is
-- now fixed so it won't recur for future logins.
INSERT INTO community_members (id, community_id, user_id, role)
SELECT 'gen-mem-' || pu.id, c.id, pu.id,
  CASE WHEN pu.role = 'school-head' THEN 'admin' ELSE 'member' END
FROM portal_users pu
JOIN communities c ON c.school_id = pu.school_id AND c.type = 'general'
WHERE pu.role IN ('school-head', 'head-of-academics')
ON CONFLICT (community_id, user_id) DO NOTHING;

-- CO-001: the Curriculum Head (head-of-academics) isn't scoped to one department but
-- oversees curriculum across all of them — backfill every existing head-of-academics
-- account into every subject department community at their school.
INSERT INTO community_members (id, community_id, user_id, role)
SELECT 'dept-mem-' || c.id || '-' || pu.id, c.id, pu.id, 'member'
FROM portal_users pu
JOIN communities c ON c.school_id = pu.school_id AND c.type = 'department'
WHERE pu.role = 'head-of-academics'
ON CONFLICT (community_id, user_id) DO NOTHING;
