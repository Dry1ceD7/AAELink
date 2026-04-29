import { randomUUID } from 'crypto'
import { getPool } from './db'
import { AAELINK_GLOBAL_WORKSPACE_ID } from './constants'

let migrateOnce: Promise<void> | null = null

export function ensureSchema(): Promise<void> {
  if (!migrateOnce) {
    migrateOnce = run()
  }
  return migrateOnce
}

async function run() {
  const pool = getPool()
  if (!pool) return

  await pool.query(`CREATE SCHEMA IF NOT EXISTS aaelink;`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL,
      last_seen_at BIGINT NOT NULL DEFAULT 0,
      platform_role TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS aaelink.sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON aaelink.sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON aaelink.sessions(expires_at);
    CREATE TABLE IF NOT EXISTS aaelink.workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES aaelink.users(id),
      created_at BIGINT NOT NULL,
      is_system BOOLEAN NOT NULL DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS aaelink.departments (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      UNIQUE (workspace_id, code)
    );
    CREATE TABLE IF NOT EXISTS aaelink.workspace_members (
      workspace_id TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      department_id TEXT REFERENCES aaelink.departments(id) ON DELETE SET NULL,
      PRIMARY KEY (workspace_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS aaelink.channels (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'O',
      created_at BIGINT NOT NULL,
      UNIQUE(workspace_id, name)
    );
    CREATE TABLE IF NOT EXISTS aaelink.messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES aaelink.channels(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES aaelink.users(id),
      body TEXT NOT NULL,
      root_id TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_channel_time ON aaelink.messages(channel_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_thread ON aaelink.messages(channel_id, root_id, created_at);
    CREATE TABLE IF NOT EXISTS aaelink.message_deletions (
      message_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      deleted_at BIGINT NOT NULL,
      thread_root_id TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_message_deletions_channel ON aaelink.message_deletions(channel_id, deleted_at);
    CREATE TABLE IF NOT EXISTS aaelink.message_reactions (
      message_id TEXT NOT NULL REFERENCES aaelink.messages(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      reaction_key TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (message_id, user_id, reaction_key)
    );
    CREATE TABLE IF NOT EXISTS aaelink.channel_read_state (
      user_id TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL REFERENCES aaelink.channels(id) ON DELETE CASCADE,
      last_read_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, channel_id)
    );
    CREATE TABLE IF NOT EXISTS aaelink.channel_typing (
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (channel_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS aaelink.thread_typing (
      channel_id TEXT NOT NULL,
      root_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (channel_id, root_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS aaelink.tickets (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      created_by TEXT REFERENCES aaelink.users(id),
      department_id TEXT REFERENCES aaelink.departments(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS aaelink.ticket_messages (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES aaelink.tickets(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES aaelink.users(id),
      body TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_time ON aaelink.ticket_messages(ticket_id, created_at);
    CREATE TABLE IF NOT EXISTS aaelink.documents (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size BIGINT NOT NULL,
      bucket_key TEXT NOT NULL UNIQUE,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS aaelink.notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'mention',
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      workspace_id TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      channel_id TEXT REFERENCES aaelink.channels(id) ON DELETE SET NULL,
      message_id TEXT,
      ticket_id TEXT REFERENCES aaelink.tickets(id) ON DELETE SET NULL,
      read_at BIGINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON aaelink.notifications(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON aaelink.notifications(user_id) WHERE read_at = 0;
    CREATE TABLE IF NOT EXISTS aaelink.user_notification_prefs (
      user_id TEXT PRIMARY KEY REFERENCES aaelink.users(id) ON DELETE CASCADE,
      mentions_enabled BOOLEAN NOT NULL DEFAULT true,
      ticket_activity_enabled BOOLEAN NOT NULL DEFAULT true,
      system_notifications_enabled BOOLEAN NOT NULL DEFAULT true,
      updated_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS aaelink.account_requests (
      id TEXT PRIMARY KEY,
      created_at BIGINT NOT NULL,
      full_name TEXT NOT NULL,
      work_email TEXT NOT NULL,
      work_phone TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      otp_hash TEXT NOT NULL DEFAULT '',
      otp_expires_at BIGINT NOT NULL DEFAULT 0,
      verified_at BIGINT NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_account_requests_created ON aaelink.account_requests(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_account_requests_status ON aaelink.account_requests(status);
  `)

  await pool.query(
    `ALTER TABLE aaelink.users ADD COLUMN IF NOT EXISTS last_seen_at BIGINT NOT NULL DEFAULT 0`
  )
  await pool.query(
    `ALTER TABLE aaelink.users ADD COLUMN IF NOT EXISTS platform_role TEXT NOT NULL DEFAULT ''`
  )
  await pool.query(
    `ALTER TABLE aaelink.workspaces ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false`
  )
  await pool.query(
    `ALTER TABLE aaelink.workspace_members ADD COLUMN IF NOT EXISTS department_id TEXT REFERENCES aaelink.departments(id) ON DELETE SET NULL`
  )
  await pool.query(
    `ALTER TABLE aaelink.user_notification_prefs ADD COLUMN IF NOT EXISTS system_notifications_enabled BOOLEAN NOT NULL DEFAULT true`
  )
  await pool.query(
    `ALTER TABLE aaelink.account_requests ADD COLUMN IF NOT EXISTS verified_at BIGINT NOT NULL DEFAULT 0`
  )
  await pool.query(
    `ALTER TABLE aaelink.channels ADD COLUMN IF NOT EXISTS dm_user_a TEXT REFERENCES aaelink.users(id) ON DELETE CASCADE`
  )
  await pool.query(
    `ALTER TABLE aaelink.channels ADD COLUMN IF NOT EXISTS dm_user_b TEXT REFERENCES aaelink.users(id) ON DELETE CASCADE`
  )
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_workspace_dm_pair ON aaelink.channels (workspace_id, dm_user_a, dm_user_b) WHERE type = 'D'`
  )

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.support_it_presence (
      id TEXT PRIMARY KEY,
      is_online BOOLEAN NOT NULL DEFAULT false,
      updated_at BIGINT NOT NULL DEFAULT 0,
      updated_by TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL
    );
    INSERT INTO aaelink.support_it_presence (id, is_online, updated_at)
    VALUES ('singleton', false, 0)
    ON CONFLICT (id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS aaelink.support_otp_challenges (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      channel TEXT NOT NULL,
      destination TEXT NOT NULL,
      otp_hash TEXT NOT NULL,
      otp_expires_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_support_otp_user_created ON aaelink.support_otp_challenges(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS aaelink.support_contact_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_support_contact_sess_user ON aaelink.support_contact_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_support_contact_sess_expires ON aaelink.support_contact_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS aaelink.support_emergency_messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open'
    );
    CREATE INDEX IF NOT EXISTS idx_support_emergency_created ON aaelink.support_emergency_messages(created_at DESC);
  `)

  // ── V2 migrations (idempotent) ──────────────────────────────────────────────

  // Private-channel and group-DM membership list.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.channel_members (
      channel_id TEXT NOT NULL REFERENCES aaelink.channels(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL REFERENCES aaelink.users(id)    ON DELETE CASCADE,
      role       TEXT NOT NULL DEFAULT 'member',
      joined_at  BIGINT NOT NULL,
      PRIMARY KEY (channel_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_channel_members_user ON aaelink.channel_members(user_id);
  `)

  // Webhooks — incoming (post to channel) and outgoing (callback on event).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.webhooks (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      channel_id   TEXT REFERENCES aaelink.channels(id) ON DELETE SET NULL,
      created_by   TEXT NOT NULL REFERENCES aaelink.users(id),
      kind         TEXT NOT NULL DEFAULT 'incoming',
      display_name TEXT NOT NULL DEFAULT '',
      token        TEXT NOT NULL UNIQUE,
      callback_url TEXT NOT NULL DEFAULT '',
      description  TEXT NOT NULL DEFAULT '',
      is_active    BOOLEAN NOT NULL DEFAULT true,
      created_at   BIGINT NOT NULL,
      updated_at   BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_webhooks_workspace ON aaelink.webhooks(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_webhooks_token     ON aaelink.webhooks(token);
  `)

  // Audit log — append-only compliance trail for all write operations.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.audit_log (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT,
      actor_id      TEXT,
      actor_role    TEXT NOT NULL DEFAULT '',
      action        TEXT NOT NULL,
      resource_kind TEXT NOT NULL DEFAULT '',
      resource_id   TEXT NOT NULL DEFAULT '',
      ip_address    TEXT NOT NULL DEFAULT '',
      user_agent    TEXT NOT NULL DEFAULT '',
      metadata      JSONB NOT NULL DEFAULT '{}',
      created_at    BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_workspace_time ON aaelink.audit_log(workspace_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_log_actor_time     ON aaelink.audit_log(actor_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_log_action         ON aaelink.audit_log(action, created_at DESC);
  `)

  // Unique constraint on message_deletions (prevents duplicate tombstones).
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_message_deletions_msgid ON aaelink.message_deletions(message_id)`
  )

  // Channel purpose + header (shown in channel info panel).
  await pool.query(
    `ALTER TABLE aaelink.channels ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT ''`
  )
  await pool.query(
    `ALTER TABLE aaelink.channels ADD COLUMN IF NOT EXISTS header TEXT NOT NULL DEFAULT ''`
  )

  // Ticket extensions
  await pool.query(
    `ALTER TABLE aaelink.tickets ADD COLUMN IF NOT EXISTS assignee_id TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL`
  )
  await pool.query(
    `ALTER TABLE aaelink.tickets ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb`
  )

  await ensureGlobalWorkspaceAndDepartments(pool)
}

async function ensureGlobalWorkspaceAndDepartments(pool: import('pg').Pool) {
  const { rows: users } = await pool.query(`SELECT id FROM aaelink.users ORDER BY created_at ASC LIMIT 1`)
  if (!users[0]) return
  const ownerId = (users[0] as { id: string }).id
  const now = Date.now()
  try {
    await pool.query(
      `INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at, is_system)
       VALUES ($1, 'aaelink', 'AAELink', $2, $3, true)`,
      [AAELINK_GLOBAL_WORKSPACE_ID, ownerId, now]
    )
  } catch (e: unknown) {
    const c = (e as { code?: string })?.code
    if (c !== '23505') throw e
  }
  await pool.query(
    `UPDATE aaelink.workspaces SET is_system = true, display_name = 'AAELink' WHERE id = $1`,
    [AAELINK_GLOBAL_WORKSPACE_ID]
  )
  await pool.query(
    `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT (workspace_id, user_id) DO NOTHING`,
    [AAELINK_GLOBAL_WORKSPACE_ID, ownerId]
  )
  await pool.query(
    `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
     SELECT $1, u.id, 'member' FROM aaelink.users u
     WHERE NOT EXISTS (SELECT 1 FROM aaelink.workspace_members m WHERE m.workspace_id = $1 AND m.user_id = u.id)`,
    [AAELINK_GLOBAL_WORKSPACE_ID]
  )
  const { rows: ch } = await pool.query(
    `SELECT 1 FROM aaelink.channels WHERE workspace_id = $1 AND name = 'all-aaelink' LIMIT 1`,
    [AAELINK_GLOBAL_WORKSPACE_ID]
  )
  if (!ch[0]) {
    const cid = randomUUID()
    await pool.query(
      `INSERT INTO aaelink.channels (id, workspace_id, name, display_name, type, created_at)
       VALUES ($1, $2, 'all-aaelink', 'All AAELink', 'O', $3)`,
      [cid, AAELINK_GLOBAL_WORKSPACE_ID, now]
    )
  }
  const { rows: wsp } = await pool.query(`SELECT id FROM aaelink.workspaces`)
  for (const row of wsp) {
    const wid = (row as { id: string }).id
    await pool.query(
      `INSERT INTO aaelink.departments (id, workspace_id, code, name, created_at)
       SELECT $1, $2, 'it', 'IT', $3
       WHERE NOT EXISTS (SELECT 1 FROM aaelink.departments WHERE workspace_id = $2 AND code = 'it')`,
      [randomUUID(), wid, now]
    )
    await pool.query(
      `INSERT INTO aaelink.departments (id, workspace_id, code, name, created_at)
       SELECT $1, $2, 'general', 'General', $3
       WHERE NOT EXISTS (SELECT 1 FROM aaelink.departments WHERE workspace_id = $2 AND code = 'general')`,
      [randomUUID(), wid, now]
    )
  }
}
