import { randomUUID } from 'crypto'
import { getPool } from './db'
import { AAELINK_GLOBAL_WORKSPACE_ID } from '@/lib/constants'
import { ensureMigrations, type Migration, type RunnerPool } from './migrationRunner'

let migrateOnce: Promise<void> | null = null

export function ensureSchema(): Promise<void> {
  if (!migrateOnce) {
    migrateOnce = run().catch((err) => {
      // Bust the cache on failure so the next request can retry instead of
      // forever serving the same poisoned rejection. Without this, a single
      // partial migration failure makes every API request 500 until restart.
      migrateOnce = null
      throw err
    })
  }
  return migrateOnce
}

async function run() {
  const pool = getPool()
  if (!pool) return

  // The `aaelink` schema must exist before the migration runner can
  // create its bookkeeping table inside it.
  await pool.query(`CREATE SCHEMA IF NOT EXISTS aaelink;`)

  await ensureMigrations(pool as unknown as RunnerPool, MIGRATIONS)
}

/**
 * The full pre-runner schema, captured verbatim as `001_initial_schema`.
 *
 * Forward-only contract: do NOT edit this migration. To add or alter
 * tables, append a new migration to `MIGRATIONS` below with a stable
 * `NNN_short_snake_case` id.
 *
 * Existing populated databases are recorded as already-applied via the
 * synthetic-baseline path in `ensureMigrations`, so this body never
 * runs against legacy production databases.
 */
async function migration001InitialSchema(pool: RunnerPool) {
  // ── Body of the legacy `run()` follows. The `await pool.query(...)`
  //    calls below were the original `migrate.ts` content; they remain
  //    unchanged so the captured baseline is bit-for-bit equivalent.

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT '',
      avatar_url TEXT,
      job_title TEXT,
      phone TEXT,
      timezone TEXT,
      status_text TEXT,
      status_emoji TEXT,
      created_at BIGINT NOT NULL,
      last_seen_at BIGINT NOT NULL DEFAULT 0,
      platform_role TEXT NOT NULL DEFAULT ''
    );
    
    -- Add columns if they do not exist
    ALTER TABLE aaelink.users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
    ALTER TABLE aaelink.users ADD COLUMN IF NOT EXISTS job_title TEXT;
    ALTER TABLE aaelink.users ADD COLUMN IF NOT EXISTS phone TEXT;
    ALTER TABLE aaelink.users ADD COLUMN IF NOT EXISTS timezone TEXT;
    ALTER TABLE aaelink.users ADD COLUMN IF NOT EXISTS status_text TEXT;
    ALTER TABLE aaelink.users ADD COLUMN IF NOT EXISTS status_emoji TEXT;

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

  // Saved / bookmarked messages — users can bookmark any message.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.saved_messages (
      user_id    TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL REFERENCES aaelink.messages(id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL REFERENCES aaelink.channels(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_saved_messages_user_created ON aaelink.saved_messages(user_id, created_at DESC);
  `)

  // User presence status (online, away, dnd, offline) + custom text.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.user_status (
      user_id     TEXT PRIMARY KEY REFERENCES aaelink.users(id) ON DELETE CASCADE,
      status      TEXT NOT NULL DEFAULT 'online',
      custom_text TEXT NOT NULL DEFAULT '',
      updated_at  BIGINT NOT NULL DEFAULT 0
    );
  `)

  // Channel purpose + header (shown in channel info panel).
  await pool.query(
    `ALTER TABLE aaelink.channels ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT ''`
  )
  await pool.query(
    `ALTER TABLE aaelink.channels ADD COLUMN IF NOT EXISTS header TEXT NOT NULL DEFAULT ''`
  )

  // Pinned messages per channel.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.pinned_messages (
      channel_id TEXT NOT NULL REFERENCES aaelink.channels(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL REFERENCES aaelink.messages(id) ON DELETE CASCADE,
      pinned_by  TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      pinned_at  BIGINT NOT NULL,
      PRIMARY KEY (channel_id, message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_pinned_messages_channel ON aaelink.pinned_messages(channel_id, pinned_at DESC);
  `)

  // Channel bookmarks (Slack-style bookmark bar above messages).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.channel_bookmarks (
      id         TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES aaelink.channels(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      link_url   TEXT NOT NULL,
      emoji      TEXT NOT NULL DEFAULT '🔗',
      sort_order INT NOT NULL DEFAULT 0,
      added_by   TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_channel_bookmarks ON aaelink.channel_bookmarks(channel_id, sort_order);
  `)

  // Ticket extensions
  await pool.query(
    `ALTER TABLE aaelink.tickets ADD COLUMN IF NOT EXISTS assignee_id TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL`
  )
  await pool.query(
    `ALTER TABLE aaelink.tickets ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb`
  )

  // Channel archive (soft-delete)
  await pool.query(
    `ALTER TABLE aaelink.channels ADD COLUMN IF NOT EXISTS archived_at BIGINT NOT NULL DEFAULT 0`
  )

  // File attachments on messages
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.file_attachments (
      id          TEXT PRIMARY KEY,
      message_id  TEXT NOT NULL REFERENCES aaelink.messages(id) ON DELETE CASCADE,
      channel_id  TEXT NOT NULL REFERENCES aaelink.channels(id) ON DELETE CASCADE,
      user_id     TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      filename    TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size        BIGINT NOT NULL DEFAULT 0,
      storage_key TEXT NOT NULL,
      created_at  BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_file_attachments_message ON aaelink.file_attachments(message_id);
    CREATE INDEX IF NOT EXISTS idx_file_attachments_channel ON aaelink.file_attachments(channel_id);
  `)

  // Workspace invitation links (token-based)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.workspace_invites (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      created_by   TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      token        TEXT NOT NULL UNIQUE,
      expires_at   BIGINT NOT NULL,
      created_at   BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_invites_token   ON aaelink.workspace_invites(token);
    CREATE INDEX IF NOT EXISTS idx_workspace_invites_ws      ON aaelink.workspace_invites(workspace_id);
  `)

  // Session metadata columns for device management
  await pool.query(`ALTER TABLE aaelink.sessions ADD COLUMN IF NOT EXISTS user_agent TEXT NOT NULL DEFAULT ''`)
  await pool.query(`ALTER TABLE aaelink.sessions ADD COLUMN IF NOT EXISTS ip_address TEXT NOT NULL DEFAULT ''`)
  await pool.query(`ALTER TABLE aaelink.sessions ADD COLUMN IF NOT EXISTS created_at BIGINT NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE aaelink.sessions ADD COLUMN IF NOT EXISTS last_active_at BIGINT NOT NULL DEFAULT 0`)

  // Message body trigram index for global search (pg_trgm if available)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_body_search ON aaelink.messages USING btree (channel_id, created_at DESC)`)

  // Real full-text search lives in numbered migration 023_messages_fts so it
  // applies to already-initialized DBs (inline base DDL is skipped on those).

  // ── Channel notification preferences (per-user, per-channel overrides) ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.channel_notification_prefs (
      user_id       TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      channel_id    TEXT NOT NULL REFERENCES aaelink.channels(id) ON DELETE CASCADE,
      level         TEXT NOT NULL DEFAULT 'default',
      muted         BOOLEAN NOT NULL DEFAULT false,
      updated_at    BIGINT NOT NULL,
      PRIMARY KEY (user_id, channel_id)
    );
  `)

  // ── Scheduled Messages (Slack "Send Later") ────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.scheduled_messages (
      id           TEXT PRIMARY KEY,
      channel_id   TEXT NOT NULL REFERENCES aaelink.channels(id) ON DELETE CASCADE,
      user_id      TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      body         TEXT NOT NULL,
      root_id      TEXT NOT NULL DEFAULT '',
      send_at      BIGINT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      created_at   BIGINT NOT NULL,
      sent_at      BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_messages_pending
      ON aaelink.scheduled_messages(status, send_at)
      WHERE status = 'pending';
    CREATE INDEX IF NOT EXISTS idx_scheduled_messages_user
      ON aaelink.scheduled_messages(user_id, status);
  `)

  // ── Approvals & Workflows ───────────────────────────────────────────────

  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.workflows (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL REFERENCES aaelink.users(id),
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_workflows_workspace ON aaelink.workflows(workspace_id);
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.workflow_steps (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES aaelink.workflows(id) ON DELETE CASCADE,
      step_order INTEGER NOT NULL,
      approver_user_id TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
      approver_role TEXT NOT NULL DEFAULT '', 
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_steps_order ON aaelink.workflow_steps(workflow_id, step_order);
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.approval_requests (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      workflow_id TEXT REFERENCES aaelink.workflows(id) ON DELETE SET NULL,
      requester_id TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      current_step_order INTEGER NOT NULL DEFAULT 1,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_approval_reqs_workspace ON aaelink.approval_requests(workspace_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_approval_reqs_requester ON aaelink.approval_requests(requester_id, created_at DESC);
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.approval_reviews (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL REFERENCES aaelink.approval_requests(id) ON DELETE CASCADE,
      step_order INTEGER NOT NULL,
      reviewer_id TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      decision TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_approval_reviews_req ON aaelink.approval_reviews(request_id);
  `)
  // ── Knowledge Base / Wiki ───────────────────────────────────────────────
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.kb_categories (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL REFERENCES aaelink.users(id),
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kb_categories_workspace ON aaelink.kb_categories(workspace_id);
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.kb_articles (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      category_id TEXT REFERENCES aaelink.kb_categories(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      author_id TEXT NOT NULL REFERENCES aaelink.users(id),
      is_published BOOLEAN NOT NULL DEFAULT true,
      view_count BIGINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kb_articles_workspace ON aaelink.kb_articles(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_kb_articles_category ON aaelink.kb_articles(category_id);
  `)

  // ── Calendar, Leave & Attendance ──────────────────────────────────────

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.calendar_events (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      start_time BIGINT NOT NULL,
      end_time BIGINT NOT NULL,
      location TEXT NOT NULL DEFAULT '',
      is_all_day BOOLEAN NOT NULL DEFAULT false,
      created_by TEXT NOT NULL REFERENCES aaelink.users(id),
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_events_workspace ON aaelink.calendar_events(workspace_id);
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.calendar_attendees (
      event_id TEXT NOT NULL REFERENCES aaelink.calendar_events(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      PRIMARY KEY (event_id, user_id)
    );
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.leave_requests (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES aaelink.users(id),
      leave_type TEXT NOT NULL,
      start_date BIGINT NOT NULL,
      end_date BIGINT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      approved_by TEXT REFERENCES aaelink.users(id),
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_leave_requests_workspace ON aaelink.leave_requests(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_leave_requests_user ON aaelink.leave_requests(user_id);
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.attendance_logs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES aaelink.users(id),
      clock_in_time BIGINT NOT NULL,
      clock_out_time BIGINT,
      date_str TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_attendance_logs_workspace ON aaelink.attendance_logs(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_logs_user ON aaelink.attendance_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_logs_date ON aaelink.attendance_logs(date_str);
  `)

  // ── Integrations (HR, Finance, Procurement) ───────────────────────────

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.apps (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      icon_url TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL REFERENCES aaelink.users(id),
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_apps_workspace ON aaelink.apps(workspace_id);
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.incoming_webhooks (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      app_id TEXT REFERENCES aaelink.apps(id) ON DELETE SET NULL,
      channel_id TEXT NOT NULL REFERENCES aaelink.channels(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      secret_token TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES aaelink.users(id),
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_incoming_webhooks_workspace ON aaelink.incoming_webhooks(workspace_id);
  `)

  // ── SSO Settings (Entra ID) ───────────────────────────────────────────

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.sso_configs (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL UNIQUE,
      tenant_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      client_secret TEXT NOT NULL,
      is_enabled BOOLEAN NOT NULL DEFAULT false,
      updated_at BIGINT NOT NULL
    );
  `)

  // ── Plugin Marketplace ─────────────────────────────────────────────────

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.marketplace_plugins (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      version TEXT NOT NULL DEFAULT '1.0.0',
      icon_emoji TEXT NOT NULL DEFAULT '🧩',
      icon_bg TEXT NOT NULL DEFAULT '#5865f2',
      category TEXT NOT NULL DEFAULT 'other',
      downloads BIGINT NOT NULL DEFAULT 0,
      rating REAL NOT NULL DEFAULT 5.0,
      is_published BOOLEAN NOT NULL DEFAULT true,
      created_by TEXT NOT NULL REFERENCES aaelink.users(id),
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      UNIQUE (workspace_id, slug)
    );
    CREATE INDEX IF NOT EXISTS idx_marketplace_plugins_workspace ON aaelink.marketplace_plugins(workspace_id);
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.installed_plugins (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      plugin_id TEXT NOT NULL REFERENCES aaelink.marketplace_plugins(id) ON DELETE CASCADE,
      enabled BOOLEAN NOT NULL DEFAULT true,
      installed_at BIGINT NOT NULL,
      UNIQUE (user_id, workspace_id, plugin_id)
    );
    CREATE INDEX IF NOT EXISTS idx_installed_plugins_user ON aaelink.installed_plugins(user_id, workspace_id);
  `)

  // ── v0.0.3-alpha additions ──────────────────────────────────────────

  // Pronouns and department on user profile
  await pool.query(
    `ALTER TABLE aaelink.users ADD COLUMN IF NOT EXISTS pronouns TEXT`
  )
  await pool.query(
    `ALTER TABLE aaelink.users ADD COLUMN IF NOT EXISTS department TEXT`
  )

  // User status expiry (Slack-style "Clear after…")
  await pool.query(
    `ALTER TABLE aaelink.user_status ADD COLUMN IF NOT EXISTS expires_at BIGINT NOT NULL DEFAULT 0`
  )

  // Reminders table (message reminders + /remind slash command)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.reminders (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      body        TEXT NOT NULL DEFAULT '',
      message_id  TEXT NOT NULL DEFAULT '',
      channel_id  TEXT NOT NULL DEFAULT '',
      fire_at     BIGINT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      fired_at    BIGINT,
      created_at  BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reminders_pending ON aaelink.reminders(status, fire_at)
      WHERE status = 'pending';
    CREATE INDEX IF NOT EXISTS idx_reminders_user ON aaelink.reminders(user_id, status);
  `)

  // Channel categories (sidebar grouping — Favorites, custom sections)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.channel_categories (
      user_id    TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL,
      category   TEXT NOT NULL DEFAULT 'channels',
      sort_order INT  NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, channel_id)
    );
    CREATE INDEX IF NOT EXISTS idx_channel_categories_user ON aaelink.channel_categories(user_id);
  `)

  // ── v0.0.5-alpha additions ──────────────────────────────────────────

  // Default channel flag (channels that every new member auto-joins)
  await pool.query(
    `ALTER TABLE aaelink.channels ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false`
  )

  // Feature flags table (admin-managed runtime toggles)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.feature_flags (
      id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      flag_name   TEXT UNIQUE NOT NULL,
      enabled     BOOLEAN NOT NULL DEFAULT true,
      description TEXT DEFAULT '',
      updated_by  TEXT DEFAULT '',
      updated_at  BIGINT DEFAULT 0,
      deleted_at  BIGINT DEFAULT NULL
    );
  `)

  // Webhook delivery log (track each outgoing/incoming webhook delivery)
  // NOTE: kept as separate pool.query() calls — combining CREATE TABLE +
  // CREATE INDEX in one query made Postgres validate the index against the
  // catalog before the table was committed, so it failed with
  // "column delivered_at does not exist" on every fresh DB.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.webhook_deliveries (
      id          TEXT PRIMARY KEY,
      webhook_id  TEXT NOT NULL REFERENCES aaelink.webhooks(id) ON DELETE CASCADE,
      status_code INT NOT NULL DEFAULT 0,
      request_body TEXT NOT NULL DEFAULT '',
      response_body TEXT NOT NULL DEFAULT '',
      delivered_at BIGINT NOT NULL,
      duration_ms  INT NOT NULL DEFAULT 0,
      error_message TEXT NOT NULL DEFAULT ''
    );
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook
       ON aaelink.webhook_deliveries(webhook_id, delivered_at DESC);`
  )

  // ── v0.0.6-alpha additions ──────────────────────────────────────────

  // DND (Do Not Disturb) schedule settings per user
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.dnd_settings (
      user_id       TEXT PRIMARY KEY REFERENCES aaelink.users(id) ON DELETE CASCADE,
      enabled       BOOLEAN NOT NULL DEFAULT false,
      start_time    TEXT NOT NULL DEFAULT '22:00',
      end_time      TEXT NOT NULL DEFAULT '08:00',
      timezone      TEXT NOT NULL DEFAULT 'UTC',
      snooze_until  BIGINT NOT NULL DEFAULT 0,
      updated_at    BIGINT NOT NULL DEFAULT 0
    );
  `)

  // Custom emoji (workspace-level, Slack parity)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.custom_emoji (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      image_url     TEXT NOT NULL DEFAULT '',
      alias_for     TEXT NOT NULL DEFAULT '',
      created_by    TEXT NOT NULL REFERENCES aaelink.users(id),
      created_at    BIGINT NOT NULL,
      UNIQUE (workspace_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_custom_emoji_workspace ON aaelink.custom_emoji(workspace_id);
  `)

  // Slash commands registry (custom commands with webhook callbacks)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.slash_commands (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      usage_hint    TEXT NOT NULL DEFAULT '',
      callback_url  TEXT NOT NULL DEFAULT '',
      is_active     BOOLEAN NOT NULL DEFAULT true,
      created_by    TEXT NOT NULL REFERENCES aaelink.users(id),
      created_at    BIGINT NOT NULL,
      UNIQUE (workspace_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_slash_commands_workspace ON aaelink.slash_commands(workspace_id);
  `)

  // Message drafts (server-side persistence across devices)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.message_drafts (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      channel_id  TEXT NOT NULL REFERENCES aaelink.channels(id) ON DELETE CASCADE,
      root_id     TEXT NOT NULL DEFAULT '',
      body        TEXT NOT NULL DEFAULT '',
      updated_at  BIGINT NOT NULL,
      UNIQUE (user_id, channel_id, root_id)
    );
    CREATE INDEX IF NOT EXISTS idx_message_drafts_user ON aaelink.message_drafts(user_id, updated_at DESC);
  `)

  // ── v0.0.7-alpha additions ──────────────────────────────────────────

  // Starred / favorite channels (sidebar section)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.starred_channels (
      user_id     TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      channel_id  TEXT NOT NULL REFERENCES aaelink.channels(id) ON DELETE CASCADE,
      sort_order  INT NOT NULL DEFAULT 0,
      starred_at  BIGINT NOT NULL,
      PRIMARY KEY (user_id, channel_id)
    );
  `)

  // User notification keywords (custom highlight words)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.user_keywords (
      user_id     TEXT PRIMARY KEY REFERENCES aaelink.users(id) ON DELETE CASCADE,
      keywords    TEXT NOT NULL DEFAULT '[]',
      updated_at  BIGINT NOT NULL DEFAULT 0
    );
  `)

  // Message forwarding tracking
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.message_forwards (
      id                    TEXT PRIMARY KEY,
      original_message_id   TEXT NOT NULL,
      forwarded_message_id  TEXT NOT NULL,
      source_channel_id     TEXT NOT NULL,
      target_channel_id     TEXT NOT NULL,
      forwarded_by          TEXT NOT NULL REFERENCES aaelink.users(id),
      forwarded_at          BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_message_forwards_original ON aaelink.message_forwards(original_message_id);
  `)

  // Scheduled messages (future delivery queue)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.scheduled_messages (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      channel_id  TEXT NOT NULL REFERENCES aaelink.channels(id) ON DELETE CASCADE,
      root_id     TEXT NOT NULL DEFAULT '',
      body        TEXT NOT NULL,
      send_at     BIGINT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','cancelled','failed')),
      sent_at     BIGINT,
      created_at  BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_messages_pending ON aaelink.scheduled_messages(status, send_at) WHERE status = 'pending';
    CREATE INDEX IF NOT EXISTS idx_scheduled_messages_user ON aaelink.scheduled_messages(user_id, status);
  `)

  // Sidebar sections / channel categories (user-defined)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.sidebar_sections (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      workspace_id  TEXT NOT NULL,
      name          TEXT NOT NULL,
      emoji         TEXT NOT NULL DEFAULT '',
      sort_order    INT NOT NULL DEFAULT 0,
      is_collapsed  BOOLEAN NOT NULL DEFAULT false
    );
    CREATE INDEX IF NOT EXISTS idx_sidebar_sections_user ON aaelink.sidebar_sections(user_id, workspace_id);
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.sidebar_section_channels (
      section_id  TEXT NOT NULL REFERENCES aaelink.sidebar_sections(id) ON DELETE CASCADE,
      channel_id  TEXT NOT NULL REFERENCES aaelink.channels(id) ON DELETE CASCADE,
      sort_order  INT NOT NULL DEFAULT 0,
      PRIMARY KEY (section_id, channel_id)
    );
  `)

  // Guest accounts (external collaborators)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.guest_accounts (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT NOT NULL,
      user_id       TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      invited_by    TEXT REFERENCES aaelink.users(id),
      expires_at    BIGINT NOT NULL DEFAULT 0,
      created_at    BIGINT NOT NULL,
      UNIQUE (workspace_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_guest_accounts_ws ON aaelink.guest_accounts(workspace_id);
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.guest_channel_access (
      guest_id    TEXT NOT NULL REFERENCES aaelink.guest_accounts(id) ON DELETE CASCADE,
      channel_id  TEXT NOT NULL REFERENCES aaelink.channels(id) ON DELETE CASCADE,
      granted_at  BIGINT NOT NULL,
      PRIMARY KEY (guest_id, channel_id)
    );
  `)

  // Channel posting permissions (announcement / broadcast channels)
  await pool.query(`
    ALTER TABLE aaelink.channels ADD COLUMN IF NOT EXISTS posting_mode TEXT NOT NULL DEFAULT 'everyone';
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.channel_approved_posters (
      channel_id  TEXT NOT NULL REFERENCES aaelink.channels(id) ON DELETE CASCADE,
      user_id     TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      granted_at  BIGINT NOT NULL,
      PRIMARY KEY (channel_id, user_id)
    );
  `)

  // Content moderation / message flagging
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.moderation_reports (
      id                TEXT PRIMARY KEY,
      reporter_id       TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      message_id        TEXT,
      reported_user_id  TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
      channel_id        TEXT,
      reason            TEXT NOT NULL,
      details           TEXT NOT NULL DEFAULT '',
      status            TEXT NOT NULL DEFAULT 'pending',
      action_taken      TEXT,
      resolution_notes  TEXT,
      resolved_by       TEXT REFERENCES aaelink.users(id),
      resolved_at       BIGINT,
      created_at        BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_moderation_reports_status ON aaelink.moderation_reports(status, created_at DESC);
  `)

  // Message attachments (file bindings)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.message_attachments (
      id          TEXT PRIMARY KEY,
      message_id  TEXT NOT NULL,
      file_id     TEXT NOT NULL,
      sort_order  INT NOT NULL DEFAULT 0,
      created_at  BIGINT NOT NULL,
      UNIQUE (message_id, file_id)
    );
    CREATE INDEX IF NOT EXISTS idx_message_attachments_msg ON aaelink.message_attachments(message_id);
  `)

  // Channel topic / purpose columns
  await pool.query(`
    ALTER TABLE aaelink.channels ADD COLUMN IF NOT EXISTS topic TEXT NOT NULL DEFAULT '';
    ALTER TABLE aaelink.channels ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT '';
    ALTER TABLE aaelink.channels ADD COLUMN IF NOT EXISTS topic_set_by TEXT DEFAULT NULL;
    ALTER TABLE aaelink.channels ADD COLUMN IF NOT EXISTS topic_set_at BIGINT DEFAULT 0;
    ALTER TABLE aaelink.channels ADD COLUMN IF NOT EXISTS purpose_set_by TEXT DEFAULT NULL;
    ALTER TABLE aaelink.channels ADD COLUMN IF NOT EXISTS purpose_set_at BIGINT DEFAULT 0;
  `)

  // Email notification queue
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.email_queue (
      id               TEXT PRIMARY KEY,
      recipient_id     TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      recipient_email  TEXT NOT NULL,
      type             TEXT NOT NULL,
      subject          TEXT NOT NULL,
      body_text        TEXT NOT NULL DEFAULT '',
      body_html        TEXT NOT NULL DEFAULT '',
      metadata         JSONB NOT NULL DEFAULT '{}',
      status           TEXT NOT NULL DEFAULT 'pending',
      error            TEXT,
      sent_at          BIGINT,
      created_at       BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_email_queue_status ON aaelink.email_queue(status, created_at DESC);
  `)

  // Workspace invite links
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.workspace_invite_links (
      id               TEXT PRIMARY KEY,
      workspace_id     TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      token            TEXT NOT NULL UNIQUE,
      created_by       TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      max_uses         INT NOT NULL DEFAULT 0,
      use_count        INT NOT NULL DEFAULT 0,
      expires_at       BIGINT NOT NULL DEFAULT 0,
      allowed_domains  JSONB NOT NULL DEFAULT '[]',
      active           BOOLEAN NOT NULL DEFAULT true,
      created_at       BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_invite_links_token ON aaelink.workspace_invite_links(token) WHERE active = true;
  `)

  // Backups management table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.backups (
      id               TEXT PRIMARY KEY,
      type             TEXT NOT NULL DEFAULT 'full',
      status           TEXT NOT NULL DEFAULT 'pending',
      storage_dest     TEXT NOT NULL DEFAULT 'local',
      size_bytes       BIGINT NOT NULL DEFAULT 0,
      started_at       BIGINT NOT NULL,
      completed_at     BIGINT DEFAULT 0,
      error            TEXT,
      created_by       TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
      metadata         JSONB NOT NULL DEFAULT '{}'
    );
  `)

  // System config key-value store (for session policy, markdown config, media policy, backup schedule)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.system_config (
      key              TEXT PRIMARY KEY,
      value            TEXT NOT NULL DEFAULT '{}',
      updated_at       BIGINT NOT NULL DEFAULT 0
    );
  `)

  // User accessibility preferences column
  await pool.query(`
    ALTER TABLE aaelink.users ADD COLUMN IF NOT EXISTS accessibility_prefs TEXT DEFAULT '{}';
  `)

  // ── Batch 6: Jobs, Compliance, Integrations, i18n ────────────────────

  // Background job queue
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.jobs (
      id               TEXT PRIMARY KEY,
      type             TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'pending',
      priority         INTEGER NOT NULL DEFAULT 5,
      payload          TEXT NOT NULL DEFAULT '{}',
      run_after        BIGINT NOT NULL DEFAULT 0,
      max_retries      INTEGER NOT NULL DEFAULT 3,
      attempts         INTEGER NOT NULL DEFAULT 0,
      last_error       TEXT,
      started_at       BIGINT DEFAULT 0,
      completed_at     BIGINT DEFAULT 0,
      created_by       TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
      created_at       BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status_priority ON aaelink.jobs(status, priority DESC, created_at ASC);
  `)

  // Legal holds (compliance)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.legal_holds (
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      description      TEXT NOT NULL DEFAULT '',
      matter_id        TEXT NOT NULL DEFAULT '',
      status           TEXT NOT NULL DEFAULT 'active',
      custodian_ids    JSONB NOT NULL DEFAULT '[]',
      channel_ids      JSONB NOT NULL DEFAULT '[]',
      scope_from       BIGINT NOT NULL DEFAULT 0,
      scope_to         BIGINT NOT NULL DEFAULT 0,
      released_at      BIGINT DEFAULT 0,
      created_by       TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
      created_at       BIGINT NOT NULL
    );
  `)

  // eDiscovery exports
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.ediscovery_exports (
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'pending',
      format           TEXT NOT NULL DEFAULT 'json',
      scope            JSONB NOT NULL DEFAULT '{}',
      scope_from       BIGINT NOT NULL DEFAULT 0,
      scope_to         BIGINT NOT NULL DEFAULT 0,
      message_count    INTEGER NOT NULL DEFAULT 0,
      file_count       INTEGER NOT NULL DEFAULT 0,
      size_bytes       BIGINT NOT NULL DEFAULT 0,
      download_key     TEXT,
      completed_at     BIGINT DEFAULT 0,
      created_by       TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
      created_at       BIGINT NOT NULL
    );
  `)

  // Bot users and OAuth apps
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.bot_users (
      id               TEXT PRIMARY KEY,
      kind             TEXT NOT NULL DEFAULT 'bot',
      name             TEXT NOT NULL,
      description      TEXT NOT NULL DEFAULT '',
      avatar_url       TEXT NOT NULL DEFAULT '',
      scopes           JSONB NOT NULL DEFAULT '[]',
      status           TEXT NOT NULL DEFAULT 'active',
      client_id        TEXT UNIQUE,
      client_secret    TEXT,
      api_token        TEXT,
      redirect_uris    JSONB NOT NULL DEFAULT '[]',
      workspace_id     TEXT,
      created_by       TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
      created_at       BIGINT NOT NULL
    );
  `)

  // Event subscriptions (webhook delivery)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.event_subscriptions (
      id               TEXT PRIMARY KEY,
      bot_id           TEXT REFERENCES aaelink.bot_users(id) ON DELETE CASCADE,
      endpoint_url     TEXT NOT NULL,
      events           JSONB NOT NULL DEFAULT '[]',
      signing_secret   TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'active',
      workspace_id     TEXT,
      description      TEXT NOT NULL DEFAULT '',
      delivery_count   INTEGER NOT NULL DEFAULT 0,
      failure_count    INTEGER NOT NULL DEFAULT 0,
      last_delivery_at BIGINT DEFAULT 0,
      created_by       TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
      created_at       BIGINT NOT NULL
    );
  `)

  // Email ingestion routes
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.email_routes (
      id               TEXT PRIMARY KEY,
      workspace_id     TEXT NOT NULL,
      channel_id       TEXT NOT NULL,
      inbound_address  TEXT UNIQUE NOT NULL,
      label            TEXT NOT NULL DEFAULT '',
      status           TEXT NOT NULL DEFAULT 'active',
      allowed_senders  JSONB NOT NULL DEFAULT '[]',
      strip_signatures BOOLEAN NOT NULL DEFAULT true,
      create_threads   BOOLEAN NOT NULL DEFAULT true,
      messages_received INTEGER NOT NULL DEFAULT 0,
      last_received_at BIGINT DEFAULT 0,
      created_by       TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
      created_at       BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_email_routes_address ON aaelink.email_routes(inbound_address) WHERE status = 'active';
  `)

  // User locale column
  await pool.query(`
    ALTER TABLE aaelink.users ADD COLUMN IF NOT EXISTS locale TEXT DEFAULT 'en';
  `)

  // ── Batch 7: Devices, DLP, File Scanning, Plugins, Barriers ─────────

  // Device management
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.devices (
      id               TEXT PRIMARY KEY,
      user_id          TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      device_type      TEXT NOT NULL DEFAULT 'web',
      device_name      TEXT NOT NULL DEFAULT '',
      os               TEXT NOT NULL DEFAULT '',
      browser          TEXT NOT NULL DEFAULT '',
      ip_address       TEXT NOT NULL DEFAULT '',
      push_token       TEXT NOT NULL DEFAULT '',
      trust_status     TEXT NOT NULL DEFAULT 'untrusted',
      registered_at    BIGINT NOT NULL,
      last_active_at   BIGINT NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_devices_user ON aaelink.devices(user_id);
  `)

  // DLP rules
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.dlp_rules (
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      description      TEXT NOT NULL DEFAULT '',
      type             TEXT NOT NULL DEFAULT 'pattern_match',
      pattern          TEXT NOT NULL DEFAULT '',
      action           TEXT NOT NULL DEFAULT 'warn',
      severity         TEXT NOT NULL DEFAULT 'medium',
      priority         INTEGER NOT NULL DEFAULT 5,
      scope_channels   JSONB NOT NULL DEFAULT '[]',
      is_active        BOOLEAN NOT NULL DEFAULT true,
      created_by       TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
      created_at       BIGINT NOT NULL
    );
  `)

  // DLP violations log
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.dlp_violations (
      id               TEXT PRIMARY KEY,
      rule_id          TEXT REFERENCES aaelink.dlp_rules(id) ON DELETE SET NULL,
      user_id          TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
      channel_id       TEXT,
      content_snippet  TEXT NOT NULL DEFAULT '',
      action_taken     TEXT NOT NULL DEFAULT '',
      created_at       BIGINT NOT NULL
    );
  `)

  // File scans (virus/malware)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.file_scans (
      id               TEXT PRIMARY KEY,
      file_id          TEXT NOT NULL,
      filename         TEXT NOT NULL DEFAULT '',
      file_size        BIGINT NOT NULL DEFAULT 0,
      mime_type        TEXT NOT NULL DEFAULT '',
      result           TEXT NOT NULL DEFAULT 'pending',
      scan_engine      TEXT NOT NULL DEFAULT 'clamav',
      threat_name      TEXT NOT NULL DEFAULT '',
      uploaded_by      TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
      created_at       BIGINT NOT NULL,
      scanned_at       BIGINT NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_file_scans_result ON aaelink.file_scans(result);
  `)

  // File content index (full-text search inside files)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.file_index (
      id               TEXT PRIMARY KEY,
      file_id          TEXT UNIQUE NOT NULL,
      filename         TEXT NOT NULL DEFAULT '',
      file_type        TEXT NOT NULL DEFAULT '',
      channel_id       TEXT,
      content_preview  TEXT NOT NULL DEFAULT '',
      content_length   INTEGER NOT NULL DEFAULT 0,
      search_vector    TSVECTOR,
      uploaded_by      TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
      indexed_at       BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_file_index_search ON aaelink.file_index USING GIN(search_vector);
  `)

  // Plugins
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.plugins (
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      version          TEXT NOT NULL DEFAULT '1.0.0',
      description      TEXT NOT NULL DEFAULT '',
      author           TEXT NOT NULL DEFAULT '',
      homepage_url     TEXT NOT NULL DEFAULT '',
      icon_url         TEXT NOT NULL DEFAULT '',
      workspace_id     TEXT,
      manifest_url     TEXT NOT NULL DEFAULT '',
      capabilities     JSONB NOT NULL DEFAULT '[]',
      settings_schema  JSONB NOT NULL DEFAULT '{}',
      status           TEXT NOT NULL DEFAULT 'installed',
      installed_by     TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
      installed_at     BIGINT NOT NULL,
      updated_at       BIGINT NOT NULL DEFAULT 0
    );
  `)

  // Information barriers
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.information_barriers (
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      type             TEXT NOT NULL DEFAULT 'custom',
      description      TEXT NOT NULL DEFAULT '',
      group_a_ids      JSONB NOT NULL DEFAULT '[]',
      group_b_ids      JSONB NOT NULL DEFAULT '[]',
      block_dm         BOOLEAN NOT NULL DEFAULT true,
      block_channels   BOOLEAN NOT NULL DEFAULT true,
      block_search     BOOLEAN NOT NULL DEFAULT true,
      block_file_share BOOLEAN NOT NULL DEFAULT true,
      is_active        BOOLEAN NOT NULL DEFAULT true,
      created_by       TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
      created_at       BIGINT NOT NULL
    );
  `)

  // ── Batch 8: SSO, SCIM, Federation, Canvas, Clips ──────────────────

  // SSO providers
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.sso_providers (
      id                     TEXT PRIMARY KEY,
      name                   TEXT NOT NULL,
      type                   TEXT NOT NULL DEFAULT 'oidc',
      issuer                 TEXT NOT NULL DEFAULT '',
      metadata_url           TEXT NOT NULL DEFAULT '',
      discovery_url          TEXT NOT NULL DEFAULT '',
      client_id              TEXT NOT NULL DEFAULT '',
      client_secret_hash     TEXT NOT NULL DEFAULT '',
      callback_url           TEXT NOT NULL DEFAULT '',
      jit_provisioning       BOOLEAN NOT NULL DEFAULT true,
      default_role           TEXT NOT NULL DEFAULT 'member',
      attribute_mapping      JSONB NOT NULL DEFAULT '{}',
      group_role_mapping     JSONB NOT NULL DEFAULT '{}',
      session_lifetime_hours INTEGER NOT NULL DEFAULT 24,
      enforce_mfa            BOOLEAN NOT NULL DEFAULT false,
      is_active              BOOLEAN NOT NULL DEFAULT true,
      login_count            BIGINT NOT NULL DEFAULT 0,
      last_login_at          BIGINT NOT NULL DEFAULT 0,
      created_by             TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
      created_at             BIGINT NOT NULL,
      updated_at             BIGINT NOT NULL DEFAULT 0
    );
  `)

  // SCIM connections
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.scim_connections (
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      provider          TEXT NOT NULL DEFAULT 'azure_ad',
      tenant_id         TEXT NOT NULL DEFAULT '',
      bearer_token_hash TEXT NOT NULL DEFAULT '',
      attribute_mapping JSONB NOT NULL DEFAULT '{}',
      is_active         BOOLEAN NOT NULL DEFAULT true,
      created_by        TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
      created_at        BIGINT NOT NULL
    );
  `)

  // SCIM sync log
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.scim_sync_log (
      id           TEXT PRIMARY KEY,
      action       TEXT NOT NULL DEFAULT '',
      external_id  TEXT NOT NULL DEFAULT '',
      user_id      TEXT NOT NULL DEFAULT '',
      status       TEXT NOT NULL DEFAULT 'success',
      created_at   BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scim_sync_log_created ON aaelink.scim_sync_log(created_at DESC);
  `)

  // SCIM columns on users
  await pool.query(`
    ALTER TABLE aaelink.users ADD COLUMN IF NOT EXISTS scim_external_id TEXT;
    ALTER TABLE aaelink.users ADD COLUMN IF NOT EXISTS scim_active BOOLEAN DEFAULT true;
    ALTER TABLE aaelink.users ADD COLUMN IF NOT EXISTS scim_last_sync BIGINT DEFAULT 0;
  `)

  // Shared channels (cross-org federation)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.shared_channels (
      id              TEXT PRIMARY KEY,
      channel_id      TEXT,
      workspace_id    TEXT,
      direction       TEXT NOT NULL DEFAULT 'outbound',
      remote_org_name TEXT NOT NULL DEFAULT '',
      remote_org_url  TEXT NOT NULL DEFAULT '',
      invite_token    TEXT NOT NULL DEFAULT '',
      sync_mode       TEXT NOT NULL DEFAULT 'bidirectional',
      share_history   BOOLEAN NOT NULL DEFAULT true,
      status          TEXT NOT NULL DEFAULT 'pending',
      created_by      TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
      created_at      BIGINT NOT NULL,
      accepted_at     BIGINT NOT NULL DEFAULT 0
    );
  `)

  // Canvases (collaborative documents)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.canvases (
      id              TEXT PRIMARY KEY,
      title           TEXT NOT NULL DEFAULT 'Untitled',
      type            TEXT NOT NULL DEFAULT 'personal_note',
      channel_id      TEXT,
      icon            TEXT NOT NULL DEFAULT '',
      cover_image     TEXT NOT NULL DEFAULT '',
      content_blocks  JSONB NOT NULL DEFAULT '[]',
      word_count      INTEGER NOT NULL DEFAULT 0,
      block_count     INTEGER NOT NULL DEFAULT 0,
      shared_with     JSONB NOT NULL DEFAULT '[]',
      is_pinned       BOOLEAN NOT NULL DEFAULT false,
      is_template     BOOLEAN NOT NULL DEFAULT false,
      created_by      TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
      last_edited_by  TEXT,
      created_at      BIGINT NOT NULL,
      updated_at      BIGINT NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_canvases_channel ON aaelink.canvases(channel_id);
    CREATE INDEX IF NOT EXISTS idx_canvases_creator ON aaelink.canvases(created_by);
  `)

  // Clips (short video/audio)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.clips (
      id                TEXT PRIMARY KEY,
      channel_id        TEXT,
      thread_id         TEXT,
      clip_type         TEXT NOT NULL DEFAULT 'video',
      title             TEXT NOT NULL DEFAULT '',
      file_id           TEXT NOT NULL,
      file_url          TEXT NOT NULL DEFAULT '',
      duration_seconds  INTEGER NOT NULL DEFAULT 0,
      file_size         BIGINT NOT NULL DEFAULT 0,
      thumbnail_url     TEXT NOT NULL DEFAULT '',
      mime_type         TEXT NOT NULL DEFAULT '',
      transcript        TEXT NOT NULL DEFAULT '',
      transcript_status TEXT NOT NULL DEFAULT 'pending',
      views             INTEGER NOT NULL DEFAULT 0,
      created_by        TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
      created_at        BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_clips_channel ON aaelink.clips(channel_id);
  `)

  // ── Batch 9: MFA, Push, Calls, LDAP, EKM, Clustering ─────────────

  // MFA enrollments
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.mfa_enrollments (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      method       TEXT NOT NULL DEFAULT 'totp',
      secret_hash  TEXT NOT NULL DEFAULT '',
      is_active    BOOLEAN NOT NULL DEFAULT false,
      is_verified  BOOLEAN NOT NULL DEFAULT false,
      created_at   BIGINT NOT NULL,
      last_used_at BIGINT NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_mfa_user ON aaelink.mfa_enrollments(user_id);
  `)

  // Push notification tokens
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.push_tokens (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      token         TEXT NOT NULL UNIQUE,
      provider      TEXT NOT NULL DEFAULT 'fcm',
      device_name   TEXT NOT NULL DEFAULT '',
      platform      TEXT NOT NULL DEFAULT 'unknown',
      is_active     BOOLEAN NOT NULL DEFAULT true,
      registered_at BIGINT NOT NULL,
      last_push_at  BIGINT NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON aaelink.push_tokens(user_id);
  `)

  // Push delivery log
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.push_log (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL DEFAULT '',
      title       TEXT NOT NULL DEFAULT '',
      body        TEXT NOT NULL DEFAULT '',
      channel_id  TEXT NOT NULL DEFAULT '',
      priority    TEXT NOT NULL DEFAULT 'normal',
      silent      BOOLEAN NOT NULL DEFAULT false,
      badge_count INTEGER NOT NULL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'queued',
      created_at  BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_push_log_created ON aaelink.push_log(created_at DESC);
  `)

  // Call rooms
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.call_rooms (
      id                  TEXT PRIMARY KEY,
      channel_id          TEXT,
      call_type           TEXT NOT NULL DEFAULT 'voice',
      title               TEXT NOT NULL DEFAULT '',
      status              TEXT NOT NULL DEFAULT 'active',
      recording           BOOLEAN NOT NULL DEFAULT false,
      screen_share_user_id TEXT NOT NULL DEFAULT '',
      max_participants    INTEGER NOT NULL DEFAULT 50,
      created_by          TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
      created_at          BIGINT NOT NULL,
      ended_at            BIGINT NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_call_rooms_channel ON aaelink.call_rooms(channel_id);
  `)

  // Call participants
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.call_participants (
      id              TEXT PRIMARY KEY,
      room_id         TEXT NOT NULL REFERENCES aaelink.call_rooms(id) ON DELETE CASCADE,
      user_id         TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      role            TEXT NOT NULL DEFAULT 'participant',
      muted           BOOLEAN NOT NULL DEFAULT false,
      video_on        BOOLEAN NOT NULL DEFAULT false,
      screen_sharing  BOOLEAN NOT NULL DEFAULT false,
      joined_at       BIGINT NOT NULL,
      left_at         BIGINT NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_call_participants_room ON aaelink.call_participants(room_id);
  `)

  // LDAP connections
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.ldap_connections (
      id                      TEXT PRIMARY KEY,
      name                    TEXT NOT NULL,
      host                    TEXT NOT NULL DEFAULT '',
      port                    INTEGER NOT NULL DEFAULT 389,
      use_tls                 BOOLEAN NOT NULL DEFAULT true,
      bind_dn                 TEXT NOT NULL DEFAULT '',
      bind_password_hash      TEXT NOT NULL DEFAULT '',
      base_dn                 TEXT NOT NULL DEFAULT '',
      user_filter             TEXT NOT NULL DEFAULT '',
      group_filter            TEXT NOT NULL DEFAULT '',
      attribute_mapping       JSONB NOT NULL DEFAULT '{}',
      group_role_mapping      JSONB NOT NULL DEFAULT '{}',
      sync_interval_minutes   INTEGER NOT NULL DEFAULT 60,
      is_active               BOOLEAN NOT NULL DEFAULT true,
      last_sync_at            BIGINT NOT NULL DEFAULT 0,
      last_sync_status        TEXT NOT NULL DEFAULT 'never',
      last_sync_users_synced  INTEGER NOT NULL DEFAULT 0,
      last_sync_errors        INTEGER NOT NULL DEFAULT 0,
      created_by              TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
      created_at              BIGINT NOT NULL
    );
  `)

  // LDAP sync log
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.ldap_sync_log (
      id            TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'running',
      users_synced  INTEGER NOT NULL DEFAULT 0,
      errors        INTEGER NOT NULL DEFAULT 0,
      created_at    BIGINT NOT NULL
    );
  `)

  // Encryption keys
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.encryption_keys (
      id                 TEXT PRIMARY KEY,
      key_alias          TEXT NOT NULL DEFAULT '',
      provider           TEXT NOT NULL DEFAULT 'local',
      algorithm          TEXT NOT NULL DEFAULT 'AES-256-GCM',
      key_material_hash  TEXT NOT NULL DEFAULT '',
      status             TEXT NOT NULL DEFAULT 'active',
      created_at         BIGINT NOT NULL,
      rotated_at         BIGINT NOT NULL DEFAULT 0,
      expires_at         BIGINT NOT NULL DEFAULT 0
    );
  `)

  // Cluster nodes
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.cluster_nodes (
      id                  TEXT PRIMARY KEY,
      node_id             TEXT NOT NULL UNIQUE,
      node_url            TEXT NOT NULL DEFAULT '',
      cpu_percent         REAL NOT NULL DEFAULT 0,
      memory_percent      REAL NOT NULL DEFAULT 0,
      active_connections  INTEGER NOT NULL DEFAULT 0,
      version             TEXT NOT NULL DEFAULT '',
      registered_at       BIGINT NOT NULL,
      last_heartbeat      BIGINT NOT NULL DEFAULT 0
    );
  `)

  // ── Batch 10: Webhook v2 (v0.0.8 hardening) ──────────────────────

  // Webhook v2 subscriptions
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.webhooks_v2 (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL DEFAULT '',
      url                 TEXT NOT NULL DEFAULT '',
      secret              TEXT NOT NULL DEFAULT '',
      events              JSONB NOT NULL DEFAULT '[]',
      channel_id          TEXT NOT NULL DEFAULT '',
      is_active           BOOLEAN NOT NULL DEFAULT true,
      max_retries         INTEGER NOT NULL DEFAULT 6,
      timeout_ms          INTEGER NOT NULL DEFAULT 10000,
      rate_limit_per_min  INTEGER NOT NULL DEFAULT 60,
      created_by          TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
      created_at          BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_webhooks_v2_active ON aaelink.webhooks_v2(is_active);
  `)

  // Webhook v2 delivery log
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.webhook_deliveries_v2 (
      id              TEXT PRIMARY KEY,
      webhook_id      TEXT NOT NULL DEFAULT '',
      event_type      TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL DEFAULT 'pending',
      status_code     INTEGER NOT NULL DEFAULT 0,
      attempts        INTEGER NOT NULL DEFAULT 0,
      next_retry_at   BIGINT NOT NULL DEFAULT 0,
      request_body    TEXT NOT NULL DEFAULT '',
      response_body   TEXT NOT NULL DEFAULT '',
      latency_ms      INTEGER NOT NULL DEFAULT 0,
      error_message   TEXT NOT NULL DEFAULT '',
      created_at      BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_v2_deliveries_webhook ON aaelink.webhook_deliveries_v2(webhook_id, created_at DESC);
  `)

  // ── Add missing created_by column (referenced by ensureGlobalWorkspaceAndDepartments) ──
  await pool.query(`ALTER TABLE aaelink.channels ADD COLUMN IF NOT EXISTS created_by TEXT`)

  await ensureGlobalWorkspaceAndDepartments(pool)
}

async function ensureGlobalWorkspaceAndDepartments(pool: RunnerPool) {
  // D1 schema-integrity fix (deep-audit-2026-06-02): the seed below needs an
  // owner user, but the extensive DDL further down does NOT. Previously a single
  // `if (!users[0]) return` gated BOTH, so on a fresh database (no users yet)
  // ~115 CREATE TABLE statements never ran — a clean deploy got 30 of 145 tables.
  // Gate only the seed; let all schema DDL run unconditionally.
  const { rows: users } = await pool.query(`SELECT id FROM aaelink.users ORDER BY created_at ASC LIMIT 1`)
  if (users[0]) {
  const ownerId = (users[0] as { id: string }).id
  const now = Date.now()
  let globalWsId = AAELINK_GLOBAL_WORKSPACE_ID
  try {
    await pool.query(
      `INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at, is_system)
       VALUES ($1, 'aaelink', 'AAELink', $2, $3, true)
       ON CONFLICT (id) DO NOTHING`,
      [globalWsId, ownerId, now]
    )
  } catch (e: unknown) {
    const c = (e as { code?: string })?.code
    if (c !== '23505') throw e
  }
  
  const { rows: wsRows } = await pool.query(`SELECT id FROM aaelink.workspaces WHERE name = 'aaelink' LIMIT 1`)
  if (wsRows.length > 0) {
    globalWsId = (wsRows[0] as { id: string }).id
  }

  await pool.query(
    `UPDATE aaelink.workspaces SET is_system = true, display_name = 'AAELink' WHERE id = $1`,
    [globalWsId]
  )
  await pool.query(
    `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT (workspace_id, user_id) DO NOTHING`,
    [globalWsId, ownerId]
  )
  await pool.query(
    `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
     SELECT $1, u.id, 'member' FROM aaelink.users u
     WHERE NOT EXISTS (SELECT 1 FROM aaelink.workspace_members m WHERE m.workspace_id = $1 AND m.user_id = u.id)`,
    [globalWsId]
  )
  const { rows: ch } = await pool.query(
    `SELECT id FROM aaelink.channels WHERE workspace_id = $1 AND type = 'O'`,
    [globalWsId]
  )
  if (!ch[0]) {
    const cid = randomUUID()
    await pool.query(
      `INSERT INTO aaelink.channels (id, workspace_id, name, display_name, type, created_by, created_at)
       VALUES ($1, $2, 'all-aaelink', 'All AAELink', 'O', $3, $4)
       ON CONFLICT (workspace_id, name) DO NOTHING`,
      [cid, globalWsId, ownerId, now]
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
    const extraDepts = [
      { code: 'hr', name: 'Human Resources' },
      { code: 'finance', name: 'Finance' },
      { code: 'engineering', name: 'Engineering' },
      { code: 'sales', name: 'Sales' },
      { code: 'operations', name: 'Operations' },
      { code: 'management', name: 'Management' },
    ]
    for (const d of extraDepts) {
      await pool.query(
        `INSERT INTO aaelink.departments (id, workspace_id, code, name, created_at)
         SELECT $1, $2, $3, $4, $5
         WHERE NOT EXISTS (SELECT 1 FROM aaelink.departments WHERE workspace_id = $2 AND code = $3)`,
        [randomUUID(), wid, d.code, d.name, now]
      )
    }
  }
  } // end seed guard (if users[0]) — DDL below runs unconditionally

  // ── Webhook delivery log ──
  // Note: the first migration already creates webhook_deliveries with `delivered_at`.
  // This CREATE TABLE IF NOT EXISTS is a no-op if the table exists, but we keep
  // the index compatible with the original column name.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.webhook_deliveries (
      id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL,
      event TEXT NOT NULL DEFAULT 'message',
      status_code INT NOT NULL DEFAULT 0,
      response_body TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      duration_ms INT NOT NULL DEFAULT 0,
      delivered_at BIGINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL DEFAULT 0
    )
  `)
  await pool.query(`ALTER TABLE aaelink.webhook_deliveries ADD COLUMN IF NOT EXISTS created_at BIGINT NOT NULL DEFAULT 0`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wh_deliveries_webhook ON aaelink.webhook_deliveries(webhook_id, delivered_at DESC)`)

  // ── Channel mutes (server-side) ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.channel_mutes (
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, channel_id)
    )
  `)

  // ── Channel stars (server-side) ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.channel_stars (
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, channel_id)
    )
  `)

  // ── Login activity tracking ──
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE aaelink.users ADD COLUMN IF NOT EXISTS login_count INT NOT NULL DEFAULT 0;
      ALTER TABLE aaelink.users ADD COLUMN IF NOT EXISTS last_login_at BIGINT NOT NULL DEFAULT 0;
    EXCEPTION WHEN OTHERS THEN NULL; END $$
  `)

  // ── Ticketing v2: expanded ticket columns ──
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE aaelink.tickets ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general';
      ALTER TABLE aaelink.tickets ADD COLUMN IF NOT EXISTS sla_due_at BIGINT NOT NULL DEFAULT 0;
      ALTER TABLE aaelink.tickets ADD COLUMN IF NOT EXISTS closed_at BIGINT NOT NULL DEFAULT 0;
      ALTER TABLE aaelink.tickets ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'ui';
      ALTER TABLE aaelink.tickets ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}';
      ALTER TABLE aaelink.tickets ADD COLUMN IF NOT EXISTS source_message_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE aaelink.tickets ADD COLUMN IF NOT EXISTS source_channel_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE aaelink.tickets ADD COLUMN IF NOT EXISTS viewer_ids TEXT[] NOT NULL DEFAULT '{}';
    EXCEPTION WHEN OTHERS THEN NULL; END $$
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON aaelink.tickets(assignee_id)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tickets_status ON aaelink.tickets(workspace_id, status)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tickets_sla ON aaelink.tickets(sla_due_at) WHERE sla_due_at > 0`)

  // ── Ticket comments (internal notes + external replies) ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.ticket_comments (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      is_internal BOOLEAN NOT NULL DEFAULT false,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL DEFAULT 0
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket ON aaelink.ticket_comments(ticket_id, created_at)`)

  // ── Ticket activity log (immutable audit trail) ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.ticket_activity_log (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      field_name TEXT NOT NULL DEFAULT '',
      old_value TEXT NOT NULL DEFAULT '',
      new_value TEXT NOT NULL DEFAULT '',
      meta JSONB NOT NULL DEFAULT '{}',
      created_at BIGINT NOT NULL
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ticket_activity_ticket ON aaelink.ticket_activity_log(ticket_id, created_at)`)

  // ── Client profiles (CRM-linked entities for template swapping) ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.client_profiles (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT NOT NULL DEFAULT '',
      logo_url TEXT NOT NULL DEFAULT '',
      logo_key TEXT NOT NULL DEFAULT '',
      address_line1 TEXT NOT NULL DEFAULT '',
      address_line2 TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT '',
      postal_code TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      legal_boilerplate TEXT NOT NULL DEFAULT '',
      tax_id TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}',
      created_by TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL DEFAULT 0
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_client_profiles_ws ON aaelink.client_profiles(workspace_id)`)

  // ── Document templates (master templates for document assembly) ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.document_templates (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'general',
      file_key TEXT NOT NULL,
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'application/pdf',
      placeholders JSONB NOT NULL DEFAULT '[]',
      created_by TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL DEFAULT 0
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_doc_templates_ws ON aaelink.document_templates(workspace_id)`)

  // ── Document versions (version history for generated / edited documents) ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.document_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      version_number INT NOT NULL DEFAULT 1,
      file_key TEXT NOT NULL,
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'application/pdf',
      size_bytes BIGINT NOT NULL DEFAULT 0,
      change_summary TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      client_profile_id TEXT NOT NULL DEFAULT '',
      ticket_id TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_doc_versions_doc ON aaelink.document_versions(document_id, version_number DESC)`)

  // ── Document annotations (collaborative markup) ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.document_annotations (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      page_number INT NOT NULL DEFAULT 1,
      type TEXT NOT NULL DEFAULT 'highlight',
      content TEXT NOT NULL DEFAULT '',
      coordinates JSONB NOT NULL DEFAULT '{}',
      style JSONB NOT NULL DEFAULT '{}',
      author_id TEXT NOT NULL,
      resolved BOOLEAN NOT NULL DEFAULT false,
      parent_id TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL DEFAULT 0
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_doc_annotations_doc ON aaelink.document_annotations(document_id, page_number)`)

  // ── Document signatures ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.document_signatures (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      signer_id TEXT NOT NULL,
      signing_order INT NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending',
      signature_image_key TEXT NOT NULL DEFAULT '',
      ip_address TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      signed_at BIGINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_doc_signatures_doc ON aaelink.document_signatures(document_id, signing_order)`)

  // ── Batch 33 additive columns (client_profiles & document_templates) ──
  await pool.query(`ALTER TABLE aaelink.document_templates ADD COLUMN IF NOT EXISTS size_bytes BIGINT NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE aaelink.document_templates ADD COLUMN IF NOT EXISTS variables JSONB NOT NULL DEFAULT '{}'`)
  await pool.query(`ALTER TABLE aaelink.document_templates ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_doc_templates_ws_cat ON aaelink.document_templates(workspace_id, category)`)

  // ── Thread followers (follow/unfollow thread notifications) ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.thread_followers (
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (thread_id, user_id)
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_thread_followers_user ON aaelink.thread_followers(user_id)`)

  // ══════════════════════════════════════════════════════════════════════
  // ██  Batch 34 — v0.0.8-alpha: Full Slack API Parity DDL            ██
  // ══════════════════════════════════════════════════════════════════════

  // ── Lists (Slack Lists — structured data tables in channels) ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.lists (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT '',
      channel_id   TEXT NOT NULL DEFAULT '',
      name         TEXT NOT NULL DEFAULT '',
      description  TEXT NOT NULL DEFAULT '',
      columns      JSONB NOT NULL DEFAULT '[]',
      view_type    TEXT NOT NULL DEFAULT 'table',
      created_by   TEXT NOT NULL DEFAULT '',
      created_at   BIGINT NOT NULL DEFAULT 0,
      updated_at   BIGINT NOT NULL DEFAULT 0
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_lists_ws ON aaelink.lists(workspace_id)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_lists_ch ON aaelink.lists(channel_id)`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.list_items (
      id         TEXT PRIMARY KEY,
      list_id    TEXT NOT NULL,
      values     JSONB NOT NULL DEFAULT '{}',
      position   INT NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL DEFAULT 0
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_list_items_list ON aaelink.list_items(list_id, position)`)

  // ── Functions Registry (Slack functions.* — custom automation) ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.functions_registry (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT NOT NULL DEFAULT '',
      name          TEXT NOT NULL DEFAULT '',
      description   TEXT NOT NULL DEFAULT '',
      input_schema  JSONB NOT NULL DEFAULT '{}',
      output_schema JSONB NOT NULL DEFAULT '{}',
      app_id        TEXT NOT NULL DEFAULT '',
      is_active     BOOLEAN NOT NULL DEFAULT true,
      created_by    TEXT NOT NULL DEFAULT '',
      created_at    BIGINT NOT NULL DEFAULT 0
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_funcs_ws ON aaelink.functions_registry(workspace_id)`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.function_executions (
      id           TEXT PRIMARY KEY,
      function_id  TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      inputs       JSONB NOT NULL DEFAULT '{}',
      outputs      JSONB NOT NULL DEFAULT '{}',
      error        TEXT NOT NULL DEFAULT '',
      triggered_by TEXT NOT NULL DEFAULT '',
      created_at   BIGINT NOT NULL DEFAULT 0,
      completed_at BIGINT NOT NULL DEFAULT 0
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_func_execs_fn ON aaelink.function_executions(function_id, created_at DESC)`)

  // ── Workflows (Slack workflows.* — multi-step automation) ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.workflows (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      icon        TEXT NOT NULL DEFAULT '⚡',
      status      TEXT NOT NULL DEFAULT 'active',
      is_featured BOOLEAN NOT NULL DEFAULT false,
      created_by  TEXT NOT NULL DEFAULT '',
      created_at  BIGINT NOT NULL DEFAULT 0
    )
  `)
  await pool.query(`ALTER TABLE aaelink.workflows ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'`)
  await pool.query(`ALTER TABLE aaelink.workflows ADD COLUMN IF NOT EXISTS icon TEXT NOT NULL DEFAULT '⚡'`)
  await pool.query(`ALTER TABLE aaelink.workflows ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_workflows_status ON aaelink.workflows(status)`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.workflow_steps (
      id          TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      position    INT NOT NULL DEFAULT 0,
      type        TEXT NOT NULL DEFAULT 'function',
      function_id TEXT NOT NULL DEFAULT '',
      config      JSONB NOT NULL DEFAULT '{}',
      created_at  BIGINT NOT NULL DEFAULT 0
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wf_steps_wf ON aaelink.workflow_steps(workflow_id)`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.workflow_triggers (
      id          TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      type        TEXT NOT NULL DEFAULT 'webhook',
      config      JSONB NOT NULL DEFAULT '{}',
      created_at  BIGINT NOT NULL DEFAULT 0
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wf_triggers_wf ON aaelink.workflow_triggers(workflow_id)`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.workflow_executions (
      id           TEXT PRIMARY KEY,
      workflow_id  TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      triggered_by TEXT NOT NULL DEFAULT '',
      error        TEXT NOT NULL DEFAULT '',
      created_at   BIGINT NOT NULL DEFAULT 0,
      completed_at BIGINT NOT NULL DEFAULT 0
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wf_execs_wf ON aaelink.workflow_executions(workflow_id, created_at DESC)`)

  // ── Remote Files (Slack files.remote.* — external file references) ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.files_remote (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT NOT NULL DEFAULT '',
      external_id   TEXT NOT NULL DEFAULT '',
      external_url  TEXT NOT NULL DEFAULT '',
      title         TEXT NOT NULL DEFAULT '',
      filetype      TEXT NOT NULL DEFAULT '',
      provider      TEXT NOT NULL DEFAULT '',
      preview_image TEXT NOT NULL DEFAULT '',
      shared_channels TEXT[] NOT NULL DEFAULT '{}',
      created_by    TEXT NOT NULL DEFAULT '',
      created_at    BIGINT NOT NULL DEFAULT 0,
      updated_at    BIGINT NOT NULL DEFAULT 0
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_files_remote_ws ON aaelink.files_remote(workspace_id)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_files_remote_ext ON aaelink.files_remote(external_id)`)

  // ── OAuth Tokens & Apps (Slack oauth.v2.* / auth.*) ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.oauth_apps (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL DEFAULT '',
      client_id     TEXT UNIQUE NOT NULL,
      client_secret TEXT NOT NULL DEFAULT '',
      redirect_uris TEXT[] NOT NULL DEFAULT '{}',
      scopes        TEXT NOT NULL DEFAULT '',
      description   TEXT NOT NULL DEFAULT '',
      icon_url      TEXT NOT NULL DEFAULT '',
      is_active     BOOLEAN NOT NULL DEFAULT true,
      created_by    TEXT NOT NULL DEFAULT '',
      created_at    BIGINT NOT NULL DEFAULT 0
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_oauth_apps_client ON aaelink.oauth_apps(client_id)`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.oauth_tokens (
      id           TEXT PRIMARY KEY,
      token        TEXT UNIQUE NOT NULL,
      token_type   TEXT NOT NULL DEFAULT 'bot',
      app_id       TEXT NOT NULL DEFAULT '',
      user_id      TEXT NOT NULL DEFAULT '',
      workspace_id TEXT NOT NULL DEFAULT '',
      scope        TEXT NOT NULL DEFAULT '',
      expires_at   BIGINT NOT NULL DEFAULT 0,
      created_at   BIGINT NOT NULL DEFAULT 0
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user ON aaelink.oauth_tokens(user_id)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_oauth_tokens_app ON aaelink.oauth_tokens(app_id)`)

  // ── User Groups (Slack usergroups.* — @-mentionable groups) ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.user_groups (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL DEFAULT '',
      handle      TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      is_active   BOOLEAN NOT NULL DEFAULT true,
      created_by  TEXT NOT NULL DEFAULT '',
      created_at  BIGINT NOT NULL DEFAULT 0
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_groups_handle ON aaelink.user_groups(handle)`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.user_group_members (
      group_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      added_at BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (group_id, user_id)
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ugm_user ON aaelink.user_group_members(user_id)`)

  // ── Additive columns for v0.0.8 ──
  await pool.query(`ALTER TABLE aaelink.channels ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false`)
  await pool.query(`ALTER TABLE aaelink.channels ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''`)
  await pool.query(`ALTER TABLE aaelink.users ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'`)
  await pool.query(`ALTER TABLE aaelink.users ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT ''`)
  await pool.query(`ALTER TABLE aaelink.users ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT ''`)
  await pool.query(`ALTER TABLE aaelink.users ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT ''`)
  await pool.query(`ALTER TABLE aaelink.users ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT ''`)

  // ── Audit Stream Configs (v0.0.11) ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.audit_stream_configs (
      id               TEXT PRIMARY KEY,
      destination      TEXT NOT NULL DEFAULT 'webhook',
      endpoint         TEXT NOT NULL DEFAULT '',
      auth_token       TEXT NOT NULL DEFAULT '',
      headers          JSONB NOT NULL DEFAULT '{}',
      event_filter     JSONB NOT NULL DEFAULT '[]',
      batch_size       INT NOT NULL DEFAULT 100,
      poll_interval_ms INT NOT NULL DEFAULT 10000,
      index_name       TEXT NOT NULL DEFAULT 'aaelink-audit',
      bucket           TEXT NOT NULL DEFAULT '',
      prefix           TEXT NOT NULL DEFAULT '',
      is_active        BOOLEAN NOT NULL DEFAULT true,
      created_by       TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
      created_at       BIGINT NOT NULL DEFAULT 0
    )
  `)

  // ── API Keys (v0.0.12) ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.api_keys (
      id                 TEXT PRIMARY KEY,
      name               TEXT NOT NULL DEFAULT '',
      key_prefix         TEXT NOT NULL DEFAULT '',
      key_hash           TEXT NOT NULL UNIQUE,
      scopes             JSONB NOT NULL DEFAULT '["read"]',
      user_id            TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      created_at         BIGINT NOT NULL DEFAULT 0,
      expires_at         BIGINT,
      last_used_at       BIGINT NOT NULL DEFAULT 0,
      request_count      BIGINT NOT NULL DEFAULT 0,
      rate_limit_per_min INT NOT NULL DEFAULT 60,
      is_active          BOOLEAN NOT NULL DEFAULT true
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_user ON aaelink.api_keys(user_id)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON aaelink.api_keys(key_hash) WHERE is_active = true`)

  // ── v0.0.18-alpha: System message types (Slack parity §3.7) ──────────
  await pool.query(
    `ALTER TABLE aaelink.messages ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT ''`
  )

  // ── v0.1.0: Ticket state machine + SLA v2 (gated transitions, dual clocks) ──
  await pool.query(`ALTER TABLE aaelink.tickets ADD COLUMN IF NOT EXISTS resolution_note TEXT NOT NULL DEFAULT ''`)
  await pool.query(`ALTER TABLE aaelink.tickets ADD COLUMN IF NOT EXISTS resolution_category TEXT NOT NULL DEFAULT ''`)
  await pool.query(`ALTER TABLE aaelink.tickets ADD COLUMN IF NOT EXISTS resolved_by TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL`)
  await pool.query(`ALTER TABLE aaelink.tickets ADD COLUMN IF NOT EXISTS resolved_at BIGINT NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE aaelink.tickets ADD COLUMN IF NOT EXISTS first_response_at BIGINT NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE aaelink.tickets ADD COLUMN IF NOT EXISTS first_response_due_at BIGINT NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE aaelink.tickets ADD COLUMN IF NOT EXISTS sla_paused_at BIGINT NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE aaelink.tickets ADD COLUMN IF NOT EXISTS sla_paused_total_ms BIGINT NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE aaelink.tickets ADD COLUMN IF NOT EXISTS sla_policy_id TEXT`)
  await pool.query(`ALTER TABLE aaelink.tickets ADD COLUMN IF NOT EXISTS force_closed BOOLEAN NOT NULL DEFAULT false`)
  await pool.query(`ALTER TABLE aaelink.tickets ADD COLUMN IF NOT EXISTS kanban_order DOUBLE PRECISION NOT NULL DEFAULT 0`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.business_hours (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      timezone     TEXT NOT NULL DEFAULT 'UTC',
      schedule     JSONB NOT NULL DEFAULT '[]'::jsonb,
      holidays     JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at   BIGINT NOT NULL DEFAULT 0
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_business_hours_ws ON aaelink.business_hours(workspace_id)`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.sla_policies (
      id                TEXT PRIMARY KEY,
      workspace_id      TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      name              TEXT NOT NULL,
      priority          TEXT NOT NULL,
      first_response_ms BIGINT NOT NULL,
      resolution_ms     BIGINT NOT NULL,
      pause_on_status   JSONB NOT NULL DEFAULT '["pending"]'::jsonb,
      business_hours_id TEXT REFERENCES aaelink.business_hours(id) ON DELETE SET NULL,
      created_at        BIGINT NOT NULL DEFAULT 0
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sla_policies_ws ON aaelink.sla_policies(workspace_id, priority)`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.ticket_transitions (
      id          TEXT PRIMARY KEY,
      ticket_id   TEXT NOT NULL REFERENCES aaelink.tickets(id) ON DELETE CASCADE,
      actor_id    TEXT NOT NULL REFERENCES aaelink.users(id),
      from_status TEXT NOT NULL,
      to_status   TEXT NOT NULL,
      reason      TEXT NOT NULL DEFAULT '',
      metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at  BIGINT NOT NULL DEFAULT 0
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ticket_transitions_ticket ON aaelink.ticket_transitions(ticket_id, created_at)`)

  // ── v0.1.0: Puzzle Box document automation ──────────────────────────────
  //
  // Schema consolidation note (v0.0.19-alpha):
  //
  // `client_profiles` and `document_templates` were created earlier in this
  // file (around line ~1842). The Puzzle Box pipeline expects additional
  // columns on top of those, so instead of re-declaring the tables (which
  // is a silent no-op under `CREATE TABLE IF NOT EXISTS`), we add the
  // missing columns + the unique indices required by the pipeline. This is
  // safe to run on both fresh installs and any v1 deployment.

  // client_profiles — add Puzzle Box columns
  await pool.query(`ALTER TABLE aaelink.client_profiles ADD COLUMN IF NOT EXISTS logo_bucket_key TEXT NOT NULL DEFAULT ''`)
  await pool.query(`ALTER TABLE aaelink.client_profiles ADD COLUMN IF NOT EXISTS brand            JSONB NOT NULL DEFAULT '{}'::jsonb`)
  await pool.query(`ALTER TABLE aaelink.client_profiles ADD COLUMN IF NOT EXISTS address          JSONB NOT NULL DEFAULT '{}'::jsonb`)
  // Backfill 'address' from the legacy address_line1/2/city/state/postal_code/country columns
  // when the JSONB blob is still empty. Idempotent; cheap.
  await pool.query(`
    UPDATE aaelink.client_profiles
       SET address = jsonb_strip_nulls(jsonb_build_object(
         'line1', NULLIF(address_line1, ''),
         'line2', NULLIF(address_line2, ''),
         'city', NULLIF(city, ''),
         'state', NULLIF(state, ''),
         'postal_code', NULLIF(postal_code, ''),
         'country', NULLIF(country, '')
       ))
     WHERE address::text = '{}'
       AND (address_line1 <> '' OR address_line2 <> '' OR city <> '' OR state <> ''
            OR postal_code <> '' OR country <> '')
  `)
  // Unique (workspace_id, code) — only when code is non-empty (legacy rows may have '')
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_client_profiles_ws_code ON aaelink.client_profiles(workspace_id, code) WHERE code <> ''`)

  // document_templates — add Puzzle Box columns
  await pool.query(`ALTER TABLE aaelink.document_templates ADD COLUMN IF NOT EXISTS kind            TEXT NOT NULL DEFAULT 'binary'`)
  await pool.query(`ALTER TABLE aaelink.document_templates ADD COLUMN IF NOT EXISTS version         INT NOT NULL DEFAULT 1`)
  await pool.query(`ALTER TABLE aaelink.document_templates ADD COLUMN IF NOT EXISTS html_source     TEXT NOT NULL DEFAULT ''`)
  await pool.query(`ALTER TABLE aaelink.document_templates ADD COLUMN IF NOT EXISTS css_source      TEXT NOT NULL DEFAULT ''`)
  await pool.query(`ALTER TABLE aaelink.document_templates ADD COLUMN IF NOT EXISTS required_fields JSONB NOT NULL DEFAULT '[]'::jsonb`)
  await pool.query(`ALTER TABLE aaelink.document_templates ADD COLUMN IF NOT EXISTS page_size       TEXT NOT NULL DEFAULT 'A4'`)
  // 'is_active' was already added in batch 33 — this line is the safety net
  await pool.query(`ALTER TABLE aaelink.document_templates ADD COLUMN IF NOT EXISTS is_active       BOOLEAN NOT NULL DEFAULT true`)
  // ── v0.0.20-alpha: block-tree templates (schema_version=2) ──
  await pool.query(`ALTER TABLE aaelink.document_templates ADD COLUMN IF NOT EXISTS schema_version  TEXT NOT NULL DEFAULT '1'`)
  await pool.query(`ALTER TABLE aaelink.document_templates ADD COLUMN IF NOT EXISTS block_tree      JSONB NOT NULL DEFAULT 'null'::jsonb`)
  await pool.query(`ALTER TABLE aaelink.document_templates ADD COLUMN IF NOT EXISTS style_tokens    JSONB NOT NULL DEFAULT '{}'::jsonb`)
  await pool.query(`ALTER TABLE aaelink.document_templates ADD COLUMN IF NOT EXISTS recogniser_seed JSONB NOT NULL DEFAULT '{}'::jsonb`)
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_doc_templates_ws_kind_ver ON aaelink.document_templates(workspace_id, kind, version)`)

  // document_assemblies — pipeline state for Puzzle Box runs
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.document_assemblies (
      id                   TEXT PRIMARY KEY,
      workspace_id         TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      template_id          TEXT REFERENCES aaelink.document_templates(id) ON DELETE SET NULL,
      client_profile_id    TEXT REFERENCES aaelink.client_profiles(id) ON DELETE SET NULL,
      piece                JSONB NOT NULL DEFAULT '{}'::jsonb,
      stage                TEXT NOT NULL DEFAULT 'ingested',
      rendered_html        TEXT NOT NULL DEFAULT '',
      output_bucket_key    TEXT NOT NULL DEFAULT '',
      delivery_channel_id  TEXT REFERENCES aaelink.channels(id) ON DELETE SET NULL,
      delivery_message_id  TEXT NOT NULL DEFAULT '',
      error                TEXT NOT NULL DEFAULT '',
      created_by           TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
      created_at           BIGINT NOT NULL DEFAULT 0,
      updated_at           BIGINT NOT NULL DEFAULT 0
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_doc_assemblies_ws_stage ON aaelink.document_assemblies(workspace_id, stage)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_doc_assemblies_created ON aaelink.document_assemblies(created_at DESC)`)
  // Ticket linkage so an assembly can be tied back to the originating ticket
  await pool.query(`ALTER TABLE aaelink.document_assemblies ADD COLUMN IF NOT EXISTS ticket_id TEXT`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_doc_assemblies_ticket ON aaelink.document_assemblies(ticket_id) WHERE ticket_id IS NOT NULL`)
  // Per-assembly slot overrides (block-tree path) — see lib/puzzleBox/blocks.ts
  await pool.query(`ALTER TABLE aaelink.document_assemblies ADD COLUMN IF NOT EXISTS overrides JSONB NOT NULL DEFAULT '{}'::jsonb`)

  // document_pipeline_log — append-only stage log for observability
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.document_pipeline_log (
      id           TEXT PRIMARY KEY,
      assembly_id  TEXT NOT NULL REFERENCES aaelink.document_assemblies(id) ON DELETE CASCADE,
      stage        TEXT NOT NULL,
      status       TEXT NOT NULL,
      duration_ms  INT NOT NULL DEFAULT 0,
      detail       JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at   BIGINT NOT NULL DEFAULT 0
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_doc_pipeline_log_assembly ON aaelink.document_pipeline_log(assembly_id, created_at)`)

  // Workspace brand / settings — read by the Puzzle Box assemble stage to
  // populate `workspace.*` slot bindings (sender header, default footer).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.workspace_settings (
      workspace_id TEXT PRIMARY KEY REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      settings     JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at   BIGINT NOT NULL DEFAULT 0
    )
  `)

  // ── v0.0.44 — Enterprise Grid (Organizations, Org Policies, DLP, Audit Streams) ──

  // Organizations (Enterprise Grid)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.organizations (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name          TEXT NOT NULL,
      domain        TEXT NOT NULL UNIQUE,
      plan          TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','business_plus','enterprise_grid')),
      settings      JSONB NOT NULL DEFAULT '{}',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.org_members (
      org_id   UUID NOT NULL REFERENCES aaelink.organizations(id) ON DELETE CASCADE,
      user_id  TEXT NOT NULL,
      role     TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('org_owner','org_admin','member')),
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (org_id, user_id)
    )
  `)

  await pool.query(
    `ALTER TABLE aaelink.workspaces ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES aaelink.organizations(id) ON DELETE SET NULL`
  )

  // Audit stream configs
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.audit_stream_configs (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id    TEXT NOT NULL,
      destination     TEXT NOT NULL CHECK (destination IN ('splunk','elasticsearch','s3','webhook','syslog')),
      endpoint_url    TEXT NOT NULL,
      auth_token      TEXT,
      format          TEXT NOT NULL DEFAULT 'json' CHECK (format IN ('json','cef','leef')),
      enabled         BOOLEAN NOT NULL DEFAULT true,
      watermark       TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  // DLP scan queue
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.dlp_scan_queue (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id  TEXT NOT NULL,
      channel_id  TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      content     TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','scanning','clean','violation','error')),
      rule_id     TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      scanned_at  TIMESTAMPTZ
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.org_policies (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id        UUID NOT NULL REFERENCES aaelink.organizations(id) ON DELETE CASCADE,
      policy_type   TEXT NOT NULL CHECK (policy_type IN ('retention','dlp','sso','session','ip_access','data_residency')),
      config        JSONB NOT NULL DEFAULT '{}',
      enforced      BOOLEAN NOT NULL DEFAULT false,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(org_id, policy_type)
    )
  `)

  // ── v0.1.0: Custom Roles & Invite Requests (Admin RBAC) ──────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.custom_roles (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id  TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      permissions   TEXT[] NOT NULL DEFAULT '{}',
      is_system     BOOLEAN NOT NULL DEFAULT false,
      created_at    BIGINT NOT NULL DEFAULT 0,
      UNIQUE(workspace_id, name)
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.role_assignments (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      role_id       UUID NOT NULL REFERENCES aaelink.custom_roles(id) ON DELETE CASCADE,
      user_id       TEXT NOT NULL,
      workspace_id  TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      scope         TEXT NOT NULL DEFAULT 'workspace' CHECK (scope IN ('workspace','org','channel')),
      scope_id      TEXT,
      assigned_by   TEXT NOT NULL,
      assigned_at   BIGINT NOT NULL DEFAULT 0,
      UNIQUE(role_id, user_id, workspace_id, scope, scope_id)
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.invite_requests (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id  TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      email         TEXT NOT NULL,
      requester_id  TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','expired')),
      reviewer_id   TEXT,
      reviewed_at   BIGINT,
      created_at    BIGINT NOT NULL DEFAULT 0
    )
  `)

  // ── v0.0.43 — Drop indexes that are redundantly covered by primary keys
  //    or unique constraints. Audit found 16; each is fully covered by the
  //    table's PK / unique compound. Idempotent — `DROP INDEX IF EXISTS`.
  //    Net write-amplification reduction: every INSERT/UPDATE on these
  //    tables now skips an index update.
  await pool.query(`DROP INDEX IF EXISTS aaelink.idx_channel_categories_user`)
  await pool.query(`DROP INDEX IF EXISTS aaelink.idx_client_profiles_ws`)
  await pool.query(`DROP INDEX IF EXISTS aaelink.idx_custom_emoji_workspace`)
  await pool.query(`DROP INDEX IF EXISTS aaelink.idx_doc_templates_ws`)
  await pool.query(`DROP INDEX IF EXISTS aaelink.idx_func_execs_fn`)
  await pool.query(`DROP INDEX IF EXISTS aaelink.idx_guest_accounts_ws`)
  await pool.query(`DROP INDEX IF EXISTS aaelink.idx_installed_plugins_user`)
  await pool.query(`DROP INDEX IF EXISTS aaelink.idx_marketplace_plugins_workspace`)
  await pool.query(`DROP INDEX IF EXISTS aaelink.idx_message_attachments_msg`)
  await pool.query(`DROP INDEX IF EXISTS aaelink.idx_oauth_apps_client`)
  await pool.query(`DROP INDEX IF EXISTS aaelink.idx_slash_commands_workspace`)
  await pool.query(`DROP INDEX IF EXISTS aaelink.idx_ugm_group`)
  await pool.query(`DROP INDEX IF EXISTS aaelink.idx_wh_deliveries_webhook`)
  await pool.query(`DROP INDEX IF EXISTS aaelink.idx_webhooks_token`)
  await pool.query(`DROP INDEX IF EXISTS aaelink.idx_wf_steps_wf`)
  await pool.query(`DROP INDEX IF EXISTS aaelink.idx_workspace_invites_token`)
}

/**
 * 003 — D1 Enterprise Grid: workspace access levels + discovery.
 *
 * Adds `access_level` to workspaces so an org can mark a workspace
 * `open` (any member of a sibling workspace in the same org may discover
 * and join), `invite_only` (default — needs an invite), or `managed`
 * (admin-provisioned only). Backs GET/POST /api/workspaces/discover.
 *
 * Runs after 002 backfill so `org_id` exists for the composite index.
 * Forward-only: additive column with a safe default; existing workspaces
 * become `invite_only` (no behavior change). Idempotent guards so a
 * re-run on a partially-migrated DB is a no-op.
 */
async function migration003WorkspaceAccessLevels(pool: RunnerPool) {
  await pool.query(
    `ALTER TABLE aaelink.workspaces
       ADD COLUMN IF NOT EXISTS access_level TEXT NOT NULL DEFAULT 'invite_only'`
  )
  await pool.query(
    `DO $$ BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_access_level_chk'
       ) THEN
         ALTER TABLE aaelink.workspaces
           ADD CONSTRAINT workspaces_access_level_chk
           CHECK (access_level IN ('open','invite_only','managed'));
       END IF;
     END $$;`
  )
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_workspaces_org_access
       ON aaelink.workspaces(org_id, access_level)`
  )
}

/**
 * 002 — Backfill the "extended schema" that was unreachable on fresh DBs.
 *
 * The ~115 CREATE TABLE/INDEX/ALTER statements inside
 * `ensureGlobalWorkspaceAndDepartments` used to sit behind a
 * `if (!users[0]) return` guard, so a clean install never created the
 * organizations/compliance/document/list/etc. tables (deep-audit-2026-06-02
 * critical finding). The guard is now seed-only; re-running the function as a
 * registered migration backfills any database whose 001 ran before the fix.
 * Every statement is idempotent (IF NOT EXISTS), so this is a no-op on
 * databases that already have the tables.
 */
async function migration002BackfillExtendedSchema(pool: RunnerPool) {
  await ensureGlobalWorkspaceAndDepartments(pool)
}

/**
 * 004 — D1 Enterprise Grid: workspace archive + move lifecycle.
 *
 * Adds `archived_at` (BIGINT epoch-ms, 0 = active — same convention as
 * `channels.archived_at`) and `archived_by` (the actor who archived it) to
 * workspaces. An owner can archive/unarchive a workspace and move it between
 * organizations; archived workspaces are excluded from discovery and flagged
 * in the switcher. See lib/workspace/workspaceLifecycle.ts.
 *
 * Forward-only: additive columns with safe defaults (existing workspaces stay
 * active, archived_at = 0). Idempotent (ADD COLUMN IF NOT EXISTS). The index
 * supports the active/archived split used by discovery and the switcher.
 */
async function migration004WorkspaceLifecycle(pool: RunnerPool) {
  await pool.query(
    `ALTER TABLE aaelink.workspaces
       ADD COLUMN IF NOT EXISTS archived_at BIGINT NOT NULL DEFAULT 0`
  )
  await pool.query(
    `ALTER TABLE aaelink.workspaces
       ADD COLUMN IF NOT EXISTS archived_by TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL`
  )
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_workspaces_archived
       ON aaelink.workspaces(archived_at)`
  )
}

/**
 * 005 — D1 Enterprise Grid: org-wide channels.
 *
 * Adds `org_id` (the organization the channel is shared across) and
 * `is_org_wide` to channels. A channel keeps its home `workspace_id`, but when
 * `is_org_wide` is set any member of any workspace in `org_id` can discover and
 * join it (Slack Grid org-wide channels). See lib/channels/orgWideChannels.ts.
 *
 * Forward-only: additive columns with safe defaults (existing channels stay
 * workspace-scoped, is_org_wide = false, org_id NULL). Idempotent. The index
 * supports discovery of org-wide channels by org.
 */
async function migration005OrgWideChannels(pool: RunnerPool) {
  await pool.query(
    `ALTER TABLE aaelink.channels
       ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES aaelink.organizations(id) ON DELETE SET NULL`
  )
  await pool.query(
    `ALTER TABLE aaelink.channels
       ADD COLUMN IF NOT EXISTS is_org_wide BOOLEAN NOT NULL DEFAULT false`
  )
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_channels_org_wide
       ON aaelink.channels(org_id, is_org_wide)`
  )
}

/**
 * 006 — D1 Enterprise Grid: multi-workspace shared channels.
 *
 * A single channel can be shared into a selected SUBSET of sibling workspaces in
 * the same org (Slack Grid multi-workspace channels), distinct from org-wide
 * (whole-org) sharing in 005. The channel keeps its home `workspace_id`; each
 * row here adds one more workspace the channel appears in and is joinable from.
 * See lib/channels/sharedWorkspaceChannels.ts.
 *
 * Forward-only: a new join table, no changes to existing rows. Idempotent. The
 * by-workspace index supports discovery of channels shared into a workspace.
 */
async function migration006SharedWorkspaceChannels(pool: RunnerPool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS aaelink.channel_workspaces (
       channel_id   TEXT NOT NULL REFERENCES aaelink.channels(id) ON DELETE CASCADE,
       workspace_id TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
       added_by     TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
       added_at     BIGINT NOT NULL,
       PRIMARY KEY (channel_id, workspace_id)
     )`
  )
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_channel_workspaces_ws
       ON aaelink.channel_workspaces(workspace_id)`
  )
}

/**
 * 007 — D2 Identity: domain claiming + domain-based account capture.
 *
 * An org claims a DNS domain and proves ownership via a TXT record carrying a
 * per-claim verification token. Once verified, accounts whose email is under
 * that domain are captured into the claiming org (Slack domain claiming). A
 * domain may be verified by at most one org; the partial unique index enforces
 * that while still allowing multiple orgs to hold competing pending claims.
 * See lib/enterprise/domainClaiming.ts.
 *
 * Forward-only: a new table, no changes to existing rows. Idempotent.
 */
async function migration007DomainClaiming(pool: RunnerPool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS aaelink.org_domains (
       org_id             UUID NOT NULL REFERENCES aaelink.organizations(id) ON DELETE CASCADE,
       domain             TEXT NOT NULL,
       verification_token TEXT NOT NULL,
       verified           BOOLEAN NOT NULL DEFAULT false,
       verified_at        BIGINT NOT NULL DEFAULT 0,
       created_by         TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
       created_at         BIGINT NOT NULL,
       PRIMARY KEY (org_id, domain)
     )`
  )
  // At most one org may hold a verified claim on a given domain.
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_org_domains_verified_unique
       ON aaelink.org_domains(domain) WHERE verified = true`
  )
}

/**
 * 008 — D2 Identity: EMM device controls + remote-wipe signaling.
 *
 * The devices table tracked devices but remote wipe was broken — the delete
 * path filtered sessions by a `device_id` column that did not exist. This adds
 * that link and a wipe signal a client polls: wipe_requested_at marks a pending
 * wipe, wiped_at records the client's acknowledgement. See
 * lib/enterprise/deviceManagement.ts.
 *
 * Forward-only: additive nullable/defaulted columns. Idempotent.
 */
async function migration008DeviceEmm(pool: RunnerPool) {
  await pool.query(
    `ALTER TABLE aaelink.sessions ADD COLUMN IF NOT EXISTS device_id TEXT`
  )
  await pool.query(
    `ALTER TABLE aaelink.devices ADD COLUMN IF NOT EXISTS wipe_requested_at BIGINT NOT NULL DEFAULT 0`
  )
  await pool.query(
    `ALTER TABLE aaelink.devices ADD COLUMN IF NOT EXISTS wiped_at BIGINT NOT NULL DEFAULT 0`
  )
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_sessions_device ON aaelink.sessions(device_id)`
  )
}

/**
 * 009 — D2 Identity: org-scoped SCIM provisioning.
 *
 * A SCIM connection now belongs to an organization, so provisioning enrolls the
 * created user into that org (org_members) and deprovisioning removes them
 * (Slack org-scope SCIM). Existing connections keep org_id NULL and behave as
 * before (global, no org enrollment). See app/api/scim/v2/Users/route.ts.
 *
 * Forward-only: one additive nullable column. Idempotent.
 */
async function migration009ScimOrgScope(pool: RunnerPool) {
  await pool.query(
    `ALTER TABLE aaelink.scim_connections
       ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES aaelink.organizations(id) ON DELETE CASCADE`
  )
}

/**
 * 010 — D3 Messaging: saved / "Later" items per user.
 *
 * Slack lets a user save any message to a personal list and move it through
 * states (saved -> in_progress -> completed -> archived). One row per
 * (user, message); re-saving refreshes saved_at. See lib/messaging/savedItems.ts.
 *
 * Forward-only: a new table. Idempotent. Indexed for per-user listing by state.
 */
async function migration010SavedItems(pool: RunnerPool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS aaelink.saved_items (
       user_id    TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
       message_id TEXT NOT NULL REFERENCES aaelink.messages(id) ON DELETE CASCADE,
       state      TEXT NOT NULL DEFAULT 'saved'
                  CHECK (state IN ('saved','in_progress','completed','archived')),
       note       TEXT NOT NULL DEFAULT '',
       saved_at   BIGINT NOT NULL,
       PRIMARY KEY (user_id, message_id)
     )`
  )
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_saved_items_user_state
       ON aaelink.saved_items(user_id, state, saved_at DESC)`
  )
}

/**
 * 011 — D3 Messaging: message edit history.
 *
 * Captures the prior body each time a message is edited, so the UI can show an
 * "edited" indicator and an edit history. One row per edit, holding the body as
 * it was BEFORE that edit. See lib/messaging/messageEdits.ts.
 *
 * Forward-only: a new table. Idempotent. Indexed for per-message history.
 */
async function migration011MessageEdits(pool: RunnerPool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS aaelink.message_edits (
       id            TEXT PRIMARY KEY,
       message_id    TEXT NOT NULL REFERENCES aaelink.messages(id) ON DELETE CASCADE,
       channel_id    TEXT NOT NULL,
       editor_id     TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
       previous_body TEXT NOT NULL,
       edited_at     BIGINT NOT NULL
     )`
  )
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_message_edits_message
       ON aaelink.message_edits(message_id, edited_at DESC)`
  )
}

/**
 * 012 — D5 Calls: WebRTC signaling relay.
 *
 * The call control plane (rooms/participants) existed, but peers had no server
 * channel to exchange SDP offers/answers and ICE candidates. This is that relay:
 * a monotonic `seq` lets a client poll for signals addressed to it (or broadcast)
 * since its last cursor. Ephemeral control-plane data. See lib/calls/signaling.ts.
 *
 * Forward-only: a new table. Idempotent. Indexed for per-room cursor scans.
 */
async function migration012CallSignals(pool: RunnerPool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS aaelink.call_signals (
       seq        BIGSERIAL PRIMARY KEY,
       id         TEXT NOT NULL,
       room_id    TEXT NOT NULL REFERENCES aaelink.call_rooms(id) ON DELETE CASCADE,
       from_user  TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
       to_user    TEXT NOT NULL DEFAULT '',
       kind       TEXT NOT NULL,
       payload    JSONB NOT NULL DEFAULT '{}',
       created_at BIGINT NOT NULL
     )`
  )
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_call_signals_room_seq
       ON aaelink.call_signals(room_id, seq)`
  )
}

/**
 * 013 — D6 Lists: per-item discussion threads.
 *
 * Slack Lists let each item carry its own comment thread. One row per comment,
 * ordered by time, scoped to a list item. See lib/lists/itemThreads.ts.
 *
 * Forward-only: a new table. Idempotent. Indexed for per-item ordered reads.
 */
async function migration013ListItemComments(pool: RunnerPool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS aaelink.list_item_comments (
       id         TEXT PRIMARY KEY,
       item_id    TEXT NOT NULL REFERENCES aaelink.list_items(id) ON DELETE CASCADE,
       list_id    TEXT NOT NULL,
       user_id    TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
       body       TEXT NOT NULL,
       created_at BIGINT NOT NULL
     )`
  )
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_list_item_comments_item
       ON aaelink.list_item_comments(item_id, created_at ASC)`
  )
}

/**
 * 014 — D7 Events API: delivery dedup ledger.
 *
 * Grid hazard: a message in a multi-workspace shared channel (D1) can emit the
 * same logical event once per sharing workspace. A subscriber must receive it
 * once. This ledger collapses re-emits: a unique dedup_key per (subscription,
 * event_type, channel, event_ts) is claimed atomically before delivery; a second
 * claim is a no-op. See lib/events/eventDedup.ts.
 *
 * Forward-only: a new table. Idempotent.
 */
async function migration014EventDeliveries(pool: RunnerPool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS aaelink.event_deliveries (
       dedup_key       TEXT PRIMARY KEY,
       subscription_id TEXT NOT NULL,
       event_type      TEXT NOT NULL,
       channel_key     TEXT NOT NULL DEFAULT '',
       event_ts        BIGINT NOT NULL DEFAULT 0,
       created_at      BIGINT NOT NULL
     )`
  )
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_event_deliveries_sub
       ON aaelink.event_deliveries(subscription_id, created_at DESC)`
  )
}

/**
 * 015 — D7 Developer platform: socket-mode connections.
 *
 * Socket mode lets an app receive events over a WebSocket instead of a public
 * request URL. The app authenticates with its bot token to open a connection
 * and gets a short-lived ticket + WSS URL; the gateway validates the ticket on
 * connect. Tickets are ephemeral (a few minutes). See lib/apps/socketMode.ts.
 *
 * Forward-only: a new table. Idempotent.
 */
async function migration015SocketConnections(pool: RunnerPool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS aaelink.socket_connections (
       id          TEXT PRIMARY KEY,
       bot_id      TEXT NOT NULL REFERENCES aaelink.bot_users(id) ON DELETE CASCADE,
       ticket      TEXT NOT NULL UNIQUE,
       status      TEXT NOT NULL DEFAULT 'open',
       expires_at  BIGINT NOT NULL,
       created_at  BIGINT NOT NULL
     )`
  )
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_socket_connections_bot
       ON aaelink.socket_connections(bot_id, created_at DESC)`
  )
}

/**
 * 016 — D8 Connect: external partner allowlist.
 *
 * Cross-org Connect is governed: an org admin allowlists the partner domains it
 * will federate with (or blocks one), and the share-invite path checks it before
 * a channel can be shared externally. Default-deny — a domain not on the list is
 * not an approved partner. See lib/enterprise/connectAllowlist.ts.
 *
 * Forward-only: a new table. Idempotent.
 */
async function migration016ConnectAllowlist(pool: RunnerPool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS aaelink.connect_allowlist (
       org_id         UUID NOT NULL REFERENCES aaelink.organizations(id) ON DELETE CASCADE,
       partner_domain TEXT NOT NULL,
       status         TEXT NOT NULL DEFAULT 'allowed' CHECK (status IN ('allowed','blocked')),
       added_by       TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
       added_at       BIGINT NOT NULL,
       PRIMARY KEY (org_id, partner_domain)
     )`
  )
}

/**
 * 017 — D11 Notifications: keyword highlights.
 *
 * A user registers words/phrases that should notify them when they appear in a
 * message, even outside a direct mention (Slack keyword notifications). One row
 * per (user, normalized keyword). See lib/notifications/keywords.ts.
 *
 * Forward-only: a new table. Idempotent.
 */
async function migration017NotificationKeywords(pool: RunnerPool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS aaelink.notification_keywords (
       user_id    TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
       keyword    TEXT NOT NULL,
       created_at BIGINT NOT NULL,
       PRIMARY KEY (user_id, keyword)
     )`
  )
}

/**
 * 018 — D12 Files: public share links.
 *
 * A file's uploader can mint a tokenized public link for external sharing, and
 * revoke it. Whether public links are allowed at all is an org control (stored
 * in system_config), so an admin can disable external file sharing entirely.
 * See lib/files/publicLinks.ts.
 *
 * Forward-only: a new table. Idempotent.
 */
async function migration018FilePublicLinks(pool: RunnerPool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS aaelink.file_public_links (
       id         TEXT PRIMARY KEY,
       file_id    TEXT NOT NULL REFERENCES aaelink.file_attachments(id) ON DELETE CASCADE,
       token      TEXT NOT NULL UNIQUE,
       enabled    BOOLEAN NOT NULL DEFAULT true,
       created_by TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL,
       created_at BIGINT NOT NULL,
       revoked_at BIGINT NOT NULL DEFAULT 0
     )`
  )
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_file_public_links_file ON aaelink.file_public_links(file_id)`
  )
}

/**
 * 019 — D11 Profiles: org-level custom profile fields.
 *
 * An org admin defines custom profile fields (text/select/etc.); members fill
 * in values. org_profile_fields holds the definitions per org; user_profile_values
 * holds each user's value per field. See lib/enterprise/customProfileFields.ts.
 *
 * Forward-only: two new tables. Idempotent.
 */
async function migration019OrgProfileFields(pool: RunnerPool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS aaelink.org_profile_fields (
       id         TEXT PRIMARY KEY,
       org_id     UUID NOT NULL REFERENCES aaelink.organizations(id) ON DELETE CASCADE,
       field_key  TEXT NOT NULL,
       label      TEXT NOT NULL,
       field_type TEXT NOT NULL DEFAULT 'text'
                  CHECK (field_type IN ('text','textarea','select','link','date')),
       options    JSONB NOT NULL DEFAULT '[]',
       position   INTEGER NOT NULL DEFAULT 0,
       created_at BIGINT NOT NULL,
       UNIQUE (org_id, field_key)
     )`
  )
  await pool.query(
    `CREATE TABLE IF NOT EXISTS aaelink.user_profile_values (
       field_id   TEXT NOT NULL REFERENCES aaelink.org_profile_fields(id) ON DELETE CASCADE,
       user_id    TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
       value      TEXT NOT NULL DEFAULT '',
       updated_at BIGINT NOT NULL,
       PRIMARY KEY (field_id, user_id)
     )`
  )
}

// Retention policies — canonical DDL. Previously created lazily by
// app/api/admin/retention/route.ts (ensureRetention), which meant the
// `retention_enforce` worker job threw if it fired before that admin route
// was ever hit. Moving the DDL here guarantees the table exists after schema
// init. The route's ensureRetention call remains (idempotent, harmless).
async function migration020RetentionPolicies(pool: RunnerPool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.retention_policies (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      scope           TEXT NOT NULL UNIQUE CHECK (scope IN ('workspace','channel','dm','file')),
      retention_days  INT NOT NULL DEFAULT 0,
      enabled         BOOLEAN NOT NULL DEFAULT false,
      delete_files    BOOLEAN NOT NULL DEFAULT false,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by      TEXT REFERENCES aaelink.users(id) ON DELETE SET NULL
    );
  `)
  // Seed default policies if empty (matches ensureRetention in the route).
  await pool.query(`
    INSERT INTO aaelink.retention_policies (scope, retention_days, enabled)
    VALUES
      ('workspace', 0, false),
      ('channel', 0, false),
      ('dm', 0, false),
      ('file', 0, false)
    ON CONFLICT (scope) DO NOTHING;
  `)
}

// Saved searches — Slack-parity persisted search queries (name + query string
// + optional filters), owned by a user within a workspace.
async function migration023MessagesFts(pool: RunnerPool) {
  // Stored tsvector generated from body + GIN index. Generated column backfills
  // existing rows and stays in sync automatically (to_tsvector(regconfig,text) is immutable).
  await pool.query(`
    ALTER TABLE aaelink.messages
      ADD COLUMN IF NOT EXISTS body_tsv tsvector
      GENERATED ALWAYS AS (to_tsvector('english', coalesce(body, ''))) STORED
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_body_tsv ON aaelink.messages USING gin (body_tsv)`)
}

async function migration024JobsPayloadText(pool: RunnerPool) {
  // The job queue stores its payload as a serialized JSON STRING: the worker
  // (lib/infra/worker.ts) and all readers do JSON.parse(String(payload)). When
  // the column was JSONB, node-postgres returned an already-parsed object, so
  // JSON.parse(String(obj)) === JSON.parse('[object Object]') threw and every
  // job silently ran with an empty {} payload. Convert to TEXT to match the
  // read-side contract. The USING clause re-serializes any existing JSONB rows.
  // Inline base DDL is skipped on already-initialized DBs, so this migration is
  // required to fix them (the base DDL is also updated to TEXT for fresh DBs).
  await pool.query(`
    ALTER TABLE aaelink.jobs
      ALTER COLUMN payload TYPE TEXT USING payload::text,
      ALTER COLUMN payload SET DEFAULT '{}'
  `)
}

async function migration025SessionMfaPending(pool: RunnerPool) {
  // SSO providers with enforce_mfa=true create a session that is authenticated
  // to the user but withheld from normal routes until the user clears an MFA
  // step-up challenge. readSessionUserId treats an mfa_pending session as
  // unauthenticated; POST /api/auth/mfa/stepup flips this to false after a valid
  // TOTP code. Defaulting false means existing/password sessions are unaffected.
  await pool.query(`
    ALTER TABLE aaelink.sessions
      ADD COLUMN IF NOT EXISTS mfa_pending BOOLEAN NOT NULL DEFAULT false
  `)
}

async function migration026SamlIdpCerts(pool: RunnerPool) {
  // SAML IdPs publish MULTIPLE signing certs during a key rollover. The legacy
  // single saml_idp_cert can't represent that, so a rotation breaks every login.
  // saml_idp_certs holds the full signing-cert set discovered from IdP metadata;
  // node-saml's idpCert accepts an array so a token signed by ANY current key
  // validates. saml_idp_cert is kept (first cert) for back-compat + display.
  await pool.query(`
    ALTER TABLE aaelink.sso_providers
      ADD COLUMN IF NOT EXISTS saml_idp_certs JSONB NOT NULL DEFAULT '[]'
  `)
}

async function migration028UnifyReadState(pool: RunnerPool) {
  // Two identical read-cursor tables drifted apart: writers split between
  // `read_state` (mark-unread, conversations.mark) and `channel_read_state`
  // (read-state advance, threads, channels) — marking a channel read in one
  // path left it unread in the other. Unify on `channel_read_state`: merge any
  // surviving `read_state` rows (keep the furthest-read cursor), then drop the
  // orphan table. Guarded by to_regclass so fresh DBs (whose base schema no
  // longer creates read_state) are a clean no-op.
  await pool.query(`
    DO $$
    BEGIN
      IF to_regclass('aaelink.read_state') IS NOT NULL THEN
        INSERT INTO aaelink.channel_read_state (user_id, channel_id, last_read_at)
        SELECT rs.user_id, rs.channel_id, rs.last_read_at
          FROM aaelink.read_state rs
         WHERE rs.channel_id IN (SELECT id FROM aaelink.channels)
           AND rs.user_id   IN (SELECT id FROM aaelink.users)
        -- Seed only cursors absent from channel_read_state. Do NOT overwrite an
        -- existing (actively-maintained) cursor: GREATEST would silently drop a
        -- deliberate mark-as-unread rewind, and EXCLUDED-wins could resurrect a
        -- stale read_state cursor over a newer read. Missing-only is the safe
        -- one-time merge.
        ON CONFLICT (user_id, channel_id) DO NOTHING;
        DROP TABLE aaelink.read_state;
      END IF;
    END $$;
  `)
}

async function migration027WebauthnPasskeys(pool: RunnerPool) {
  // Passkeys (WebAuthn/FIDO2) as an MFA factor (ADR 0016). One row per
  // registered credential; counter + backed_up are kept for replay defense and
  // device-type display. Challenges are short-lived, bound to (user_id, kind),
  // issued on `begin` and consumed on `finish`.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.webauthn_credentials (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      credential_id TEXT NOT NULL UNIQUE,
      public_key    TEXT NOT NULL,
      counter       BIGINT NOT NULL DEFAULT 0,
      transports    TEXT NOT NULL DEFAULT '',
      device_type   TEXT NOT NULL DEFAULT '',
      backed_up     BOOLEAN NOT NULL DEFAULT false,
      name          TEXT NOT NULL DEFAULT '',
      created_at    BIGINT NOT NULL,
      last_used_at  BIGINT NOT NULL DEFAULT 0
    );
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user
       ON aaelink.webauthn_credentials(user_id);`
  )
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.webauthn_challenges (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      challenge   TEXT NOT NULL,
      kind        TEXT NOT NULL,
      expires_at  BIGINT NOT NULL,
      created_at  BIGINT NOT NULL
    );
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_user_kind
       ON aaelink.webauthn_challenges(user_id, kind);`
  )
}

async function migration021SavedSearches(pool: RunnerPool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.saved_searches (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id  TEXT NOT NULL REFERENCES aaelink.workspaces(id) ON DELETE CASCADE,
      user_id       TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      query         TEXT NOT NULL,
      filters       JSONB NOT NULL DEFAULT '{}',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_saved_searches_user_ws
       ON aaelink.saved_searches(user_id, workspace_id);`
  )
}

// Inbound SSO (Relying Party) — #2 enterprise parity gap.
//
// The pre-existing sso_providers table stored only a truncated, NON-recoverable
// client_secret_hash, which cannot be used to perform the OIDC code exchange.
// We add a recoverable, AES-256-GCM-encrypted secret column plus the discovery
// fields the RP flow needs, an explicit default_workspace_id for JIT→workspace
// mapping, and SAML idp_cert/entry_point. Two new tables back the flow:
//   - sso_auth_requests: short-lived in-flight state/nonce/PKCE/RelayState rows,
//     single-use, consumed on callback (replay protection).
//   - sso_identity_links: stable IdP subject (sub / NameID) → AAELink user id,
//     so re-logins resolve the same account even if the email later changes.
async function migration022InboundSso(pool: RunnerPool) {
  await pool.query(`
    ALTER TABLE aaelink.sso_providers
      ADD COLUMN IF NOT EXISTS client_secret_enc   TEXT NOT NULL DEFAULT '';
    ALTER TABLE aaelink.sso_providers
      ADD COLUMN IF NOT EXISTS default_workspace_id TEXT;
    ALTER TABLE aaelink.sso_providers
      ADD COLUMN IF NOT EXISTS scopes              TEXT NOT NULL DEFAULT 'openid profile email';
    ALTER TABLE aaelink.sso_providers
      ADD COLUMN IF NOT EXISTS saml_entry_point    TEXT NOT NULL DEFAULT '';
    ALTER TABLE aaelink.sso_providers
      ADD COLUMN IF NOT EXISTS saml_idp_cert       TEXT NOT NULL DEFAULT '';
    ALTER TABLE aaelink.sso_providers
      ADD COLUMN IF NOT EXISTS saml_audience       TEXT NOT NULL DEFAULT '';
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.sso_auth_requests (
      id             TEXT PRIMARY KEY,
      provider_id    TEXT NOT NULL REFERENCES aaelink.sso_providers(id) ON DELETE CASCADE,
      protocol       TEXT NOT NULL,
      state          TEXT NOT NULL,
      nonce          TEXT NOT NULL DEFAULT '',
      code_verifier  TEXT NOT NULL DEFAULT '',
      relay_state    TEXT NOT NULL DEFAULT '',
      redirect_uri   TEXT NOT NULL DEFAULT '',
      consumed_at    BIGINT NOT NULL DEFAULT 0,
      expires_at     BIGINT NOT NULL,
      created_at     BIGINT NOT NULL
    );
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_sso_auth_requests_state
       ON aaelink.sso_auth_requests(state);`
  )
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_sso_auth_requests_expires
       ON aaelink.sso_auth_requests(expires_at);`
  )

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.sso_identity_links (
      provider_id  TEXT NOT NULL REFERENCES aaelink.sso_providers(id) ON DELETE CASCADE,
      subject      TEXT NOT NULL,
      user_id      TEXT NOT NULL REFERENCES aaelink.users(id) ON DELETE CASCADE,
      created_at   BIGINT NOT NULL,
      last_login_at BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (provider_id, subject)
    );
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_sso_identity_links_user
       ON aaelink.sso_identity_links(user_id);`
  )
}

async function migration029OauthCodes(pool: RunnerPool) {
  // Real OAuth2 authorization-code flow (Slack oauth.v2 parity). The base DDL
  // for oauth_apps / oauth_tokens lives in migration001 and is SKIPPED on
  // already-initialized DBs, so this migration re-declares both with IF NOT
  // EXISTS (no-op where they exist, creates them on a fresh runner DB) before
  // adding the authorization-code store the exchange flow consumes.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.oauth_apps (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL DEFAULT '',
      client_id     TEXT UNIQUE NOT NULL,
      client_secret TEXT NOT NULL DEFAULT '',
      redirect_uris TEXT[] NOT NULL DEFAULT '{}',
      scopes        TEXT NOT NULL DEFAULT '',
      description   TEXT NOT NULL DEFAULT '',
      icon_url      TEXT NOT NULL DEFAULT '',
      is_active     BOOLEAN NOT NULL DEFAULT true,
      created_by    TEXT NOT NULL DEFAULT '',
      created_at    BIGINT NOT NULL DEFAULT 0
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_oauth_apps_client ON aaelink.oauth_apps(client_id)`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.oauth_tokens (
      id           TEXT PRIMARY KEY,
      token        TEXT UNIQUE NOT NULL,
      token_type   TEXT NOT NULL DEFAULT 'bot',
      app_id       TEXT NOT NULL DEFAULT '',
      user_id      TEXT NOT NULL DEFAULT '',
      workspace_id TEXT NOT NULL DEFAULT '',
      scope        TEXT NOT NULL DEFAULT '',
      expires_at   BIGINT NOT NULL DEFAULT 0,
      created_at   BIGINT NOT NULL DEFAULT 0
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user ON aaelink.oauth_tokens(user_id)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_oauth_tokens_app ON aaelink.oauth_tokens(app_id)`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.oauth_codes (
      id           TEXT PRIMARY KEY,
      code         TEXT UNIQUE NOT NULL,
      app_id       TEXT NOT NULL,
      client_id    TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT '',
      redirect_uri TEXT NOT NULL,
      scope        TEXT NOT NULL DEFAULT '',
      expires_at   BIGINT NOT NULL,
      used_at      BIGINT,
      created_at   BIGINT NOT NULL
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_oauth_codes_code ON aaelink.oauth_codes(code)`)
}

const MIGRATIONS: Migration[] = [
  { id: '001_initial_schema', up: migration001InitialSchema },
  { id: '002_backfill_extended_schema', up: migration002BackfillExtendedSchema },
  { id: '003_workspace_access_levels', up: migration003WorkspaceAccessLevels },
  { id: '004_workspace_lifecycle', up: migration004WorkspaceLifecycle },
  { id: '005_org_wide_channels', up: migration005OrgWideChannels },
  { id: '006_shared_workspace_channels', up: migration006SharedWorkspaceChannels },
  { id: '007_domain_claiming', up: migration007DomainClaiming },
  { id: '008_device_emm', up: migration008DeviceEmm },
  { id: '009_scim_org_scope', up: migration009ScimOrgScope },
  { id: '010_saved_items', up: migration010SavedItems },
  { id: '011_message_edits', up: migration011MessageEdits },
  { id: '012_call_signals', up: migration012CallSignals },
  { id: '013_list_item_comments', up: migration013ListItemComments },
  { id: '014_event_deliveries', up: migration014EventDeliveries },
  { id: '015_socket_connections', up: migration015SocketConnections },
  { id: '016_connect_allowlist', up: migration016ConnectAllowlist },
  { id: '017_notification_keywords', up: migration017NotificationKeywords },
  { id: '018_file_public_links', up: migration018FilePublicLinks },
  { id: '019_org_profile_fields', up: migration019OrgProfileFields },
  { id: '020_retention_policies', up: migration020RetentionPolicies },
  { id: '021_saved_searches', up: migration021SavedSearches },
  { id: '022_inbound_sso', up: migration022InboundSso },
  { id: '023_messages_fts', up: migration023MessagesFts },
  { id: '024_jobs_payload_text', up: migration024JobsPayloadText },
  { id: '025_session_mfa_pending', up: migration025SessionMfaPending },
  { id: '026_saml_idp_certs', up: migration026SamlIdpCerts },
  { id: '027_webauthn_passkeys', up: migration027WebauthnPasskeys },
  { id: '028_unify_read_state', up: migration028UnifyReadState },
  { id: '029_oauth_codes', up: migration029OauthCodes },
]
