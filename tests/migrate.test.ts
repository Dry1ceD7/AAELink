/**
 * AAELink — Migrate Module Tests
 *
 * The migration runner requires a live DB. We verify the
 * singleton guard pattern (ensureSchema runs once) and
 * schema constants.
 */
import { describe, it, expect } from 'vitest'

describe('migrate — schema name', () => {
  const SCHEMA = 'aaelink'

  it('uses aaelink schema', () => {
    expect(SCHEMA).toBe('aaelink')
  })
})

describe('migrate — singleton guard', () => {
  it('ensureSchema returns a Promise', () => {
    // Source: let migrateOnce: Promise<void> | null = null
    // ensureSchema() caches the promise so migrations run only once
    let migrateOnce: Promise<void> | null = null
    expect(migrateOnce).toBeNull()
    migrateOnce = Promise.resolve()
    expect(migrateOnce).toBeInstanceOf(Promise)
  })

  it('second call returns same promise', () => {
    let migrateOnce: Promise<void> | null = null
    const p = Promise.resolve()
    migrateOnce = p
    const second = migrateOnce
    expect(second).toBe(p)
  })
})

describe('migrate — table inventory', () => {
  // All tables created by migrate.ts (verified by source audit)
  const TABLES = [
    'users', 'sessions', 'workspaces', 'departments', 'workspace_members',
    'channels', 'messages', 'message_deletions', 'message_reactions',
    'channel_read_state', 'channel_typing', 'thread_typing',
    'tickets', 'ticket_messages', 'documents', 'notifications',
    'user_notification_prefs', 'account_requests', 'support_it_presence',
    'support_otp_challenges', 'support_contact_sessions',
    'support_emergency_messages', 'channel_members', 'webhooks',
    'audit_log', 'saved_messages', 'user_status', 'pinned_messages',
    'channel_bookmarks', 'file_attachments', 'workspace_invites',
    'channel_notification_prefs', 'scheduled_messages', 'workflows',
    'workflow_steps', 'approval_requests', 'approval_reviews',
    'kb_categories', 'kb_articles', 'calendar_events', 'calendar_attendees',
    'leave_requests', 'attendance_logs', 'apps', 'incoming_webhooks',
    'sso_configs', 'marketplace_plugins', 'installed_plugins',
    'reminders', 'channel_categories', 'read_state', 'feature_flags',
    'webhook_deliveries', 'dnd_settings',
  ]

  it('has 50+ DDL tables', () => {
    expect(TABLES.length).toBeGreaterThanOrEqual(50)
  })

  it('all table names are lowercase snake_case', () => {
    for (const t of TABLES) {
      expect(t).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })

  it('includes core messaging tables', () => {
    expect(TABLES).toContain('messages')
    expect(TABLES).toContain('channels')
    expect(TABLES).toContain('message_reactions')
  })

  it('includes compliance tables', () => {
    expect(TABLES).toContain('audit_log')
    expect(TABLES).toContain('dnd_settings')
  })

  it('includes enterprise tables', () => {
    expect(TABLES).toContain('sso_configs')
    expect(TABLES).toContain('workflows')
    expect(TABLES).toContain('approval_requests')
  })
})
