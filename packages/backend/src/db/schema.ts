import { sqliteTable, text, integer, blob, real } from 'drizzle-orm/sqlite-core';

// Users table
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  password: text('password'),
  role: text('role', { enum: ['user', 'org_admin', 'sysadmin'] }).default('user'),
  locale: text('locale').default('en'),
  theme: text('theme', { enum: ['light', 'dark', 'high-contrast'] }).default('light'),
  seniorMode: integer('senior_mode', { mode: 'boolean' }).default(false),
  department: text('department'),
  avatar: text('avatar'),
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
  updatedAt: text('updated_at').notNull().default('CURRENT_TIMESTAMP'),
});

// Organizations table
export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  settings: text('settings', { mode: 'json' }),
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
  updatedAt: text('updated_at').notNull().default('CURRENT_TIMESTAMP'),
});

// Channels table
export const channels = sqliteTable('channels', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  description: text('description'),
  type: text('type', { enum: ['text', 'voice', 'announcement'] }).default('text'),
  isPrivate: integer('is_private', { mode: 'boolean' }).default(false),
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
  updatedAt: text('updated_at').notNull().default('CURRENT_TIMESTAMP'),
});

// Messages table
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull().references(() => channels.id),
  userId: text('user_id').notNull().references(() => users.id),
  content: text('content').notNull(),
  type: text('type', { enum: ['text', 'file', 'image', 'system'] }).default('text'),
  replyTo: text('reply_to').references(() => messages.id),
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
  updatedAt: text('updated_at').notNull().default('CURRENT_TIMESTAMP'),
});

// Files table
export const files = sqliteTable('files', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  channelId: text('channel_id').references(() => channels.id),
  name: text('name').notNull(),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  path: text('path').notNull(),
  hash: text('hash').notNull(),
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
});

// Passkeys table for WebAuthn
export const passkeys = sqliteTable('passkeys', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  credId: text('cred_id').notNull().unique(),
  publicKey: text('public_key').notNull(),
  signCount: integer('sign_count').notNull().default(0),
  transports: text('transports', { mode: 'json' }),
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
});

// Audit logs table
export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey(),
  eventType: text('event_type').notNull(),
  userId: text('user_id').references(() => users.id),
  targetType: text('target_type'),
  targetId: text('target_id'),
  details: text('details', { mode: 'json' }),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  traceId: text('trace_id'),
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
});

// Sessions table
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  data: text('data', { mode: 'json' }),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
});