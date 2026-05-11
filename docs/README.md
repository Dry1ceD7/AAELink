# AAELink — Documentation

Internal documentation for the AAELink enterprise application.

> **v0.0.7-alpha** — 176 API routes · 109 shipped features · 100% Slack/Mattermost parity

## Guides

| Document | Description |
|---|---|
| [LAN-DESKTOP-CLIENTS.md](./LAN-DESKTOP-CLIENTS.md) | Setting up desktop clients over LAN/WiFi |
| [parity-slack-mattermost-aaelink-full-map.md](./parity-slack-mattermost-aaelink-full-map.md) | Feature-by-feature parity matrix (Slack × Mattermost × AAELink) |

## API Reference — Full Surface Area (176 routes)

### Identity & Authentication

| Endpoint | Method | Description |
|---|---|---|
| `/api/auth/login` | POST | User login with session creation |
| `/api/auth/logout` | POST | Session termination |
| `/api/auth/me` | GET | Current user profile |
| `/api/auth/sessions` | GET/DELETE | List active sessions / revoke sessions |
| `/api/auth/sso` | GET/POST/PUT | SSO provider management (SAML/OIDC/OAuth2) |
| `/api/auth/mfa` | GET/POST/PUT | MFA enrollment (TOTP/backup codes) + admin policy |
| `/api/admin/scim` | GET/POST | SCIM 2.0 provisioning (user/group sync) |
| `/api/admin/ldap` | GET/POST/PUT | LDAP/AD directory configuration + sync |
| `/api/admin/session-policy` | GET/PUT | Session TTL, idle timeout, max sessions |
| `/api/admin/devices` | GET/POST/PATCH/DELETE | Device trust, registration, remote wipe |

### Messaging & Channels

| Endpoint | Method | Description |
|---|---|---|
| `/api/channels` | GET/POST | Channel CRUD |
| `/api/channels/[id]` | GET/PUT/DELETE | Channel details, rename, delete |
| `/api/channels/dm` | GET/POST | Unified DM list with group DM support |
| `/api/channels/shared` | GET/POST/PUT | Cross-org federation (shared channels) |
| `/api/channels/mute` | GET/POST | Channel mute preferences |
| `/api/channels/stars` | GET/POST | Channel star preferences |
| `/api/messages` | GET/POST | Message CRUD with thread support |
| `/api/messages/scheduled` | GET/POST/DELETE | Scheduled message management |
| `/api/messages/forward` | POST | Message forwarding (channel/DM) |
| `/api/messages/clips` | GET/POST | Video/audio clips with transcription |
| `/api/messages/permalink` | GET | Permanent message links |

### Search

| Endpoint | Method | Description |
|---|---|---|
| `/api/messages/search` | GET | Full-text message search with filters |
| `/api/search/users` | GET | User search with workspace scoping |
| `/api/search/files` | GET | File content search (tsvector) |

### Voice, Video & Collaboration

| Endpoint | Method | Description |
|---|---|---|
| `/api/calls/rooms` | GET/POST/PUT | Call signaling — voice/video/huddle/screen share |
| `/api/docs/canvas` | GET/POST/PUT | Collaborative Canvas documents |

### Notifications

| Endpoint | Method | Description |
|---|---|---|
| `/api/notifications` | GET/POST | In-app notification list |
| `/api/notifications/stream` | GET | SSE realtime event stream |
| `/api/notifications/email` | GET/POST | Email notification queue + admin monitor |
| `/api/notifications/push` | GET/POST/PUT | Push notification tokens (APNS/FCM/Web Push) |
| `/api/dnd` | GET/PUT/POST | Do Not Disturb schedule + snooze |
| `/api/keywords` | GET/PUT | Custom keyword highlights |

### Compliance & Security

| Endpoint | Method | Description |
|---|---|---|
| `/api/compliance/legal-holds` | GET/POST/PATCH/DELETE | Legal hold management |
| `/api/compliance/ediscovery` | GET/POST | eDiscovery export jobs |
| `/api/compliance/dlp` | GET/POST/PUT/DELETE | DLP rules (regex, keyword, PII, domain) |
| `/api/compliance/barriers` | GET/POST/PUT/DELETE | Information barriers |
| `/api/admin/audit-log` | GET | Paginated audit log with filters |
| `/api/admin/retention` | GET/POST/PUT | Data retention policies |
| `/api/admin/data-residency` | GET/POST/PUT | Region pinning, jurisdiction, classification |
| `/api/admin/encryption` | GET/PUT | Encryption key management (EKM) |

### Integrations

| Endpoint | Method | Description |
|---|---|---|
| `/api/webhooks` | GET/POST | Webhook management |
| `/api/webhooks/test` | POST | Test webhook delivery |
| `/api/webhooks/deliveries` | GET | Delivery history |
| `/api/integrations/bots` | GET/POST/PUT | Bot user management |
| `/api/integrations/oauth-apps` | GET/POST/PUT | OAuth2 app registration |
| `/api/integrations/events` | GET/POST/PUT/DELETE | Event subscriptions |
| `/api/integrations/email-ingestion` | GET/POST | Email-to-channel ingestion |
| `/api/integrations/plugins` | GET/POST/PATCH | Plugin lifecycle management |

### Administration

| Endpoint | Method | Description |
|---|---|---|
| `/api/admin/users` | GET/POST/PUT | User management |
| `/api/admin/roles` | GET/POST/PUT | Role + permission management |
| `/api/admin/departments` | GET/POST/PUT | Department management |
| `/api/admin/analytics` | GET | Platform analytics (messages, users, channels) |
| `/api/admin/jobs` | GET/POST | Background job queue (11 job types) |
| `/api/admin/backups` | GET/POST/PUT/DELETE | Backup management + scheduling |
| `/api/admin/cluster` | GET/PUT | Cluster node management + horizontal scaling |
| `/api/admin/media-policy` | GET/PUT | Media playback + file policies |
| `/api/admin/moderation` | GET/POST | Content moderation queue |
| `/api/admin/guest-accounts` | GET/POST | Guest user management |
| `/api/admin/app-approval` | GET/POST | Integration approval workflows |

### Files & Documents

| Endpoint | Method | Description |
|---|---|---|
| `/api/files` | GET/POST | File upload + listing |
| `/api/files/preview` | GET | File preview generation |
| `/api/files/scan` | GET/POST | Virus/malware scanning |
| `/api/documents` | GET/POST | PDF operations via Stirling-PDF |

## Desktop Client Architecture

| Component | File | Description |
|---|---|---|
| Main process | `desktop/src/main.js` | Window lifecycle, tray, deep links, idle detection, power events |
| Preload bridge | `desktop/src/preload.js` | Secure IPC bridge (`window.aaelinkDesktop`) |
| IPC handlers | `desktop/src/main/ipcHandlers.js` | Notifications, file picker, system info, zoom |
| Auto-updater | `desktop/src/main/autoUpdater.js` | GitHub Releases-based update flow |
| Native menu | `desktop/src/main/nativeMenu.js` | Application and context menus |
| Offline page | `desktop/src/offline.html` | Connection screen with auto-reconnect |

## Database Schema

All tables live under the `aaelink` schema in PostgreSQL (~1,898 lines of DDL). Major table groups:

| Group | Tables |
|---|---|
| **Core** | `users`, `workspaces`, `departments`, `channels`, `messages`, `sessions`, `presence` |
| **Messaging** | `reactions`, `pins`, `bookmarks`, `drafts`, `scheduled_messages`, `thread_follows`, `message_attachments` |
| **Identity** | `sso_providers`, `scim_connections`, `ldap_connections`, `ldap_sync_log`, `mfa_enrollments` |
| **Compliance** | `legal_holds`, `dlp_rules`, `information_barriers`, `audit_log`, `retention_policies` |
| **Integrations** | `webhooks`, `webhook_deliveries`, `bot_users`, `oauth_apps`, `event_subscriptions`, `plugins` |
| **Collaboration** | `canvases`, `clips`, `call_rooms`, `call_participants` |
| **Notifications** | `notifications`, `push_tokens`, `push_log`, `keyword_highlights` |
| **Admin** | `devices`, `jobs`, `feature_flags`, `system_config`, `encryption_keys`, `cluster_nodes` |
| **Files** | `files`, `file_scans` |

## Release Notes

| Version | Link | Highlights |
|---|---|---|
| v0.0.7-alpha | [Release notes](./release-notes/v0.0.7-alpha.md) | **100% parity** — 109 features, 176 routes, 9 batches |
| v0.0.6-alpha | [Release notes](./release-notes/v0.0.6-alpha.md) | Search, DND, emoji, slash commands, drafts |
| v0.0.5-alpha | [Release notes](./release-notes/v0.0.5-alpha.md) | Rate limits, feature flags, activity feed |
| v0.0.4-alpha | [Release notes](./release-notes/v0.0.4-alpha.md) | Pins, bookmarks, link preview, webhooks |
| v0.0.3-alpha | [Release notes](./release-notes/v0.0.3-alpha.md) | Channels, messages, threads, presence |
| v0.0.2-alpha | [Release notes](./release-notes/v0.0.2-alpha.md) | Auth, users, roles, tickets, desktop |
