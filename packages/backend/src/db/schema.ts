/**
 * AAELink Database Schema
 * PostgreSQL with Drizzle ORM
 * BMAD Method: Data model implementation
 */

import { sql } from 'drizzle-orm';
import {
    boolean,
    decimal,
    index,
    integer,
    jsonb,
    pgEnum,
    pgTable,
    primaryKey,
    text,
    timestamp,
    uniqueIndex,
    uuid,
    varchar
} from 'drizzle-orm/pg-core';

// Enums
export const userRoleEnum = pgEnum('user_role', [
  'sysadmin',
  'org_admin',
  'dept_admin',
  'moderator',
  'member',
  'guest'
]);

export const channelRoleEnum = pgEnum('channel_role', [
  'admin',
  'moderator',
  'member',
  'guest'
]);

export const taskStatusEnum = pgEnum('task_status', [
  'pending',
  'in_progress',
  'completed',
  'cancelled'
]);

export const auditEventEnum = pgEnum('audit_event', [
  'auth_attempt',
  'auth_success',
  'auth_failure',
  'data_create',
  'data_update',
  'data_delete',
  'admin_action',
  'policy_change'
]);

// Users table
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  externalId: text('external_id'),
  displayName: text('display_name').notNull(),
  email: text('email').notNull(),
  locale: varchar('locale', { length: 10 }).default('en'),
  timeZone: text('time_zone').default('UTC'),
  avatarUrl: text('avatar_url'),
  department: text('department'),
  role: userRoleEnum('role').default('member'),
  bio: text('bio'),
  contactInfo: jsonb('contact_info'),
  seniorMode: boolean('senior_mode').default(false),
  theme: text('theme').default('light'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => {
  return {
    emailIdx: uniqueIndex('users_email_idx').on(table.email),
    externalIdIdx: index('users_external_id_idx').on(table.externalId),
  };
});

// WebAuthn passkeys
export const passkeys = pgTable('passkeys', {
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  credId: text('cred_id').primaryKey(),
  publicKey: text('public_key').notNull(),
  signCount: integer('sign_count').default(0),
  transports: jsonb('transports'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => {
  return {
    userIdIdx: index('passkeys_user_id_idx').on(table.userId),
  };
});

// Organizations
export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  settings: jsonb('settings'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Teams/Departments
export const teams = pgTable('teams', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  settings: jsonb('settings'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
  return {
    orgIdIdx: index('teams_org_id_idx').on(table.orgId),
  };
});

// Channels
export const channels = pgTable('channels', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id').references(() => teams.id).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  isPrivate: boolean('is_private').default(false),
  settings: jsonb('settings'),
  retentionDays: integer('retention_days'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  archivedAt: timestamp('archived_at'),
}, (table) => {
  return {
    teamIdIdx: index('channels_team_id_idx').on(table.teamId),
    nameIdx: index('channels_name_idx').on(table.name),
  };
});

// Channel members
export const channelMembers = pgTable('channel_members', {
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'cascade' }).notNull(),
  role: channelRoleEnum('role').default('member'),
  joinedAt: timestamp('joined_at').defaultNow().notNull(),
  mutedUntil: timestamp('muted_until'),
  settings: jsonb('settings'),
}, (table) => {
  return {
    pk: primaryKey({ columns: [table.userId, table.channelId] }),
    channelIdIdx: index('channel_members_channel_id_idx').on(table.channelId),
  };
});

// Conversations
export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  channelId: uuid('channel_id').references(() => channels.id),
  type: text('type').notNull(), // 'channel', 'direct', 'group'
  participants: jsonb('participants'), // For direct/group messages
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
  return {
    channelIdIdx: index('conversations_channel_id_idx').on(table.channelId),
  };
});

// Messages with FTS
export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id').references(() => conversations.id).notNull(),
  senderId: uuid('sender_id').references(() => users.id).notNull(),
  body: text('body'),
  bodyTsVector: sql`tsvector`.generatedAlwaysAs(
    sql`to_tsvector('english', coalesce(body, ''))`
  ),
  replyToMessageId: uuid('reply_to_message_id').references(() => messages.id),
  metadata: jsonb('metadata'), // reactions, edits history, etc.
  createdAt: timestamp('created_at').defaultNow().notNull(),
  editedAt: timestamp('edited_at'),
  deletedAt: timestamp('deleted_at'),
}, (table) => {
  return {
    conversationIdIdx: index('messages_conversation_id_idx').on(table.conversationId),
    senderIdIdx: index('messages_sender_id_idx').on(table.senderId),
    createdAtIdx: index('messages_created_at_idx').on(table.createdAt),
    bodyFtsIdx: index('messages_body_fts_idx').using('gin', table.bodyTsVector),
  };
});

// Message reads tracking
export const messageReads = pgTable('message_reads', {
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  messageId: uuid('message_id').references(() => messages.id, { onDelete: 'cascade' }).notNull(),
  readAt: timestamp('read_at').defaultNow().notNull(),
}, (table) => {
  return {
    pk: primaryKey({ columns: [table.userId, table.messageId] }),
    userIdIdx: index('message_reads_user_id_idx').on(table.userId),
  };
});

// Read cursors (per device)
export const readCursors = pgTable('read_cursors', {
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  deviceId: text('device_id').notNull(),
  conversationId: uuid('conversation_id').references(() => conversations.id).notNull(),
  lastReadMessageId: uuid('last_read_message_id').references(() => messages.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
  return {
    pk: primaryKey({ columns: [table.userId, table.deviceId, table.conversationId] }),
    conversationIdIdx: index('read_cursors_conversation_id_idx').on(table.conversationId),
  };
});

// Files
export const files = pgTable('files', {
  id: uuid('id').defaultRandom().primaryKey(),
  objectName: text('object_name').notNull(),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  checksum: text('checksum'),
  uploaderId: uuid('uploader_id').references(() => users.id).notNull(),
  channelId: uuid('channel_id').references(() => channels.id),
  metadata: jsonb('metadata'),
  virusScanStatus: text('virus_scan_status'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => {
  return {
    uploaderIdIdx: index('files_uploader_id_idx').on(table.uploaderId),
    channelIdIdx: index('files_channel_id_idx').on(table.channelId),
    objectNameIdx: uniqueIndex('files_object_name_idx').on(table.objectName),
  };
});

// Calendar events
export const events = pgTable('events', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time').notNull(),
  location: text('location'),
  room: text('room'),
  organizerId: uuid('organizer_id').references(() => users.id).notNull(),
  attendees: jsonb('attendees'), // Array of {userId, status: 'pending'|'accepted'|'declined'}
  channelId: uuid('channel_id').references(() => channels.id),
  recurrence: jsonb('recurrence'),
  reminders: jsonb('reminders'),
  notes: text('notes'),
  icsBlob: text('ics_blob'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  cancelledAt: timestamp('cancelled_at'),
}, (table) => {
  return {
    organizerIdIdx: index('events_organizer_id_idx').on(table.organizerId),
    startTimeIdx: index('events_start_time_idx').on(table.startTime),
    channelIdIdx: index('events_channel_id_idx').on(table.channelId),
  };
});

// Tasks
export const tasks = pgTable('tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  status: taskStatusEnum('status').default('pending'),
  assigneeId: uuid('assignee_id').references(() => users.id),
  creatorId: uuid('creator_id').references(() => users.id).notNull(),
  channelId: uuid('channel_id').references(() => channels.id),
  dueDate: timestamp('due_date'),
  priority: integer('priority').default(0),
  tags: jsonb('tags'),
  crdtBlob: text('crdt_blob'), // For offline conflict resolution
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
}, (table) => {
  return {
    assigneeIdIdx: index('tasks_assignee_id_idx').on(table.assigneeId),
    creatorIdIdx: index('tasks_creator_id_idx').on(table.creatorId),
    statusIdx: index('tasks_status_idx').on(table.status),
    dueDateIdx: index('tasks_due_date_idx').on(table.dueDate),
  };
});

// ERP cache
export const erpCache = pgTable('erp_cache', {
  id: uuid('id').defaultRandom().primaryKey(),
  kind: text('kind').notNull(), // 'inventory', 'orders', 'timesheets', etc.
  key: text('key').notNull(),
  payload: jsonb('payload').notNull(),
  expiresAt: timestamp('expires_at'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
  return {
    kindKeyIdx: uniqueIndex('erp_cache_kind_key_idx').on(table.kind, table.key),
    expiresAtIdx: index('erp_cache_expires_at_idx').on(table.expiresAt),
  };
});

// Audit logs
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventType: auditEventEnum('event_type').notNull(),
  userId: uuid('user_id').references(() => users.id),
  targetType: text('target_type'),
  targetId: text('target_id'),
  details: jsonb('details'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  traceId: text('trace_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => {
  return {
    userIdIdx: index('audit_logs_user_id_idx').on(table.userId),
    eventTypeIdx: index('audit_logs_event_type_idx').on(table.eventType),
    createdAtIdx: index('audit_logs_created_at_idx').on(table.createdAt),
    traceIdIdx: index('audit_logs_trace_id_idx').on(table.traceId),
  };
});

// Sessions (for WebAuthn)
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  deviceId: text('device_id'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastActivityAt: timestamp('last_activity_at').defaultNow().notNull(),
}, (table) => {
  return {
    userIdIdx: index('sessions_user_id_idx').on(table.userId),
    expiresAtIdx: index('sessions_expires_at_idx').on(table.expiresAt),
  };
});

// Knowledge base pages
export const kbPages = pgTable('kb_pages', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  content: text('content'),
  contentTsVector: sql`tsvector`.generatedAlwaysAs(
    sql`to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''))`
  ),
  authorId: uuid('author_id').references(() => users.id).notNull(),
  channelId: uuid('channel_id').references(() => channels.id),
  tags: jsonb('tags'),
  attachments: jsonb('attachments'),
  version: integer('version').default(1),
  parentId: uuid('parent_id').references(() => kbPages.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  publishedAt: timestamp('published_at'),
}, (table) => {
  return {
    authorIdIdx: index('kb_pages_author_id_idx').on(table.authorId),
    channelIdIdx: index('kb_pages_channel_id_idx').on(table.channelId),
    contentFtsIdx: index('kb_pages_content_fts_idx').using('gin', table.contentTsVector),
    parentIdIdx: index('kb_pages_parent_id_idx').on(table.parentId),
  };
});

// Marketplace listings
export const marketplaceListings = pgTable('marketplace_listings', {
  id: uuid('id').defaultRandom().primaryKey(),
  type: text('type').notNull(), // 'theme', 'sticker', 'item', 'service'
  title: text('title').notNull(),
  description: text('description'),
  images: jsonb('images'),
  price: decimal('price', { precision: 10, scale: 2 }),
  currency: varchar('currency', { length: 3 }).default('THB'),
  publisherId: uuid('publisher_id').references(() => users.id).notNull(),
  status: text('status').default('pending'), // 'pending', 'approved', 'rejected', 'published', 'archived'
  moderatorId: uuid('moderator_id').references(() => users.id),
  moderationNotes: text('moderation_notes'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  publishedAt: timestamp('published_at'),
  archivedAt: timestamp('archived_at'),
}, (table) => {
  return {
    publisherIdIdx: index('marketplace_publisher_id_idx').on(table.publisherId),
    statusIdx: index('marketplace_status_idx').on(table.status),
    typeIdx: index('marketplace_type_idx').on(table.type),
  };
});

// Type exports for TypeScript
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Channel = typeof channels.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
