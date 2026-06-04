# Slack-class parity — full map to AAELink

> **Status column regenerated 2026-06-04 from [`docs/parity-audits/`](./parity-audits/).**
> The **"Shipped" labels in this document overstate capability** — they were
> originally set by counting that a route handler or DDL table existed, not by
> verifying the behavior works end-to-end. An audit (trust code over docs; check
> response shape, RBAC, CSRF, audit-log, realtime wiring, and whether the path is
> actually *called*) found many "Shipped" rows are Partial, Stub, or Missing.
>
> **Percentages and statuses here refer to behavior capability, not route
> existence.** The authoritative, audit-derived status lives in the condensed
> [`parity-reference-matrix.md`](./parity-reference-matrix.md) (aggregate as of
> 2026-06-04: **53.6% Full · 84.4% Full-or-Partial** across 263 behaviors). Where a
> row below still reads "Shipped" but the matrix grades it 🟡/🟠/🔴, **the matrix
> wins**. The `Target (semver)` planning bands below are retained as planning input,
> not as completion claims.

This document is the **exhaustive** planning map from a **Slack-class** product (user-visible capabilities) to **AAELink** (this repository’s **Next.js** app under `app/`, APIs under `app/api/**`, schema `aaelink` in PostgreSQL). Where Slack’s internals are not public, it uses **Mattermost Team Edition** as the engineering reference (data model, jobs, search, push, plugins).

**Shorter matrix:** [`parity-reference-matrix.md`](./parity-reference-matrix.md)  
**Runtime and scale:** [`architecture-technical.md`](./architecture-technical.md)  
**Optional Mattermost engine** (Docker / `vendor/upstream`, not required for the Next app): [`WHERE-IS-THE-ENGINE.md`](./WHERE-IS-THE-ENGINE.md), [`ARCHITECTURE-AAELINK-STACK.md`](./ARCHITECTURE-AAELINK-STACK.md)

---

## 1. Method and status legend

> **The "Shipped" label below is the legacy, route-existence sense and overstates
> capability.** For audit-derived capability status use the five-level scale in
> [`parity-reference-matrix.md`](./parity-reference-matrix.md): ✅ **Full** /
> 🟡 **Partial** / 🟠 **Stub** (surface exists, does nothing end-to-end) /
> 🔴 **Missing** / 🚧 **Env-blocked** (needs external infra — SFU, APNS, LDAP, KMS).

| Status (legacy) | Meaning (route-existence — overstates depth) |
|--------|---------|
| **Shipped** | A route/DDL surface exists in this repo. **Does NOT imply working parity** — see the matrix for the audited grade |
| **Partial** | Some workflows exist; missing depth, scale, policy, or UX parity |
| **Planned** | Called out on the root [`README.md`](../README.md) roadmap |
| **Gap** | Not present; not on roadmap wording (may still be product intent) |

**“Mirror Slack”** does not require identical UX; it means **comparable organizational outcomes**: secure multi-user workspace, channels and DMs, searchable history, files, realtime collaboration, notifications, admin and compliance hooks, and an extensibility story.

### 1.1 `Target (semver)` column (all tables below)

Planning targets are **semver bands**, not promises. Re-baseline when the root [`README.md`](../README.md) roadmap changes.

| Value | Meaning |
|-------|---------|
| `v0.0.2-alpha` | Current ship line; row matches this alpha for its stated **status** |
| `v0.1.0-alpha` | Next alpha milestone (deeper chat/DM/sidebar/collab) |
| `v0.2.0-alpha` | Following alpha (workflows, richer messaging, search/index UX) |
| `v0.3.0-beta` | Beta band (scale-out, ops hardening, more enterprise controls) |
| `v1.0.0` | GA-class target (mobile, calls, heavy compliance, full extensibility) |
| `TBD` | No semver locked; product charter required |

---

## 2. Runtimes, frameworks, and engines (project scope)

| Layer | Slack (reference) | Mattermost (reference) | AAELink — **this repo** | AAELink — **optional engine track** | Target (semver) |
|-------|-------------------|------------------------|-------------------------|-------------------------------------|-----------------|
| Primary web app | Proprietary web + desktop | React `webapp/` in server bundle | **Next.js 16** App Router (`app/`), React 19, Tailwind v4, `lucide-react` | Not used when you run Next-only | `v0.0.2-alpha` |
| HTTP APIs | Proprietary | REST + WebSocket (`/api/v4/...`) | **`app/api/**`** Route Handlers | Same upstream API if you deploy MM | `v0.0.2-alpha` |
| Realtime transport | WebSocket (assumed) | WebSocket hub | **SSE** [`/api/collab/events`](../app/api/collab/events/route.ts); typing/presence/read routes under `app/api/collab/` | WebSocket hub in MM server | `v0.1.0-alpha` (SSE parity depth); `TBD` if adopting MM hub only |
| Application database | Proprietary | PostgreSQL (MM schema) | **PostgreSQL** schema `aaelink` via [`lib/migrate.ts`](../lib/migrate.ts) | Separate Postgres DB for MM when deployed | `v0.0.2-alpha` |
| Full-text search | Proprietary | Elasticsearch / OpenSearch (typical scale deployment) | **✅ Full** (SQL FTS, audited) | All message-search routes now run the shared SQL FTS engine (`ts_rank`/`ts_headline`, full `from:/in:/has:/before:/after:/is:/on:/during:` grammar); file-content search + people search ✅. Gaps: combined `search.all` 🔴, channel-discovery search 🔴, `is:dm`/emoji-specific `has:` 🟡. OpenSearch/BM25 index tier is **out of scope until v0.3.0-beta** (DRIFT-006) | `v0.0.x` (SQL FTS); `v0.3.0-beta` (index tier) |
| Object storage | Proprietary cloud | S3-compatible file backend | **S3 SDK** + MinIO in dev ([`docker-compose.yml`](../docker-compose.yml)) | MM file attachment store when on MM | `v0.0.2-alpha` |
| PDF / document services | Slack Canvas, lists, file tools | Integrations / plugins | **Stirling-PDF** URL + [`app/api/documents`](../app/api/documents/route.ts), OCR route | N/A unless bridged | `v0.0.2-alpha` (foundation); `v0.2.0-alpha` (Canvas-class) |
| Desktop shell | Electron | Desktop apps (separate repos upstream) | **Electron** [`desktop/`](../desktop/) loading web URL | MM desktop clients if you adopt MM UX | `v0.0.2-alpha` |
| Mobile | Native apps | Native apps | **Shipped** | `api/notifications/push` GET/POST/PUT — push token registration (APNS/FCM/Web Push), delivery queue, badge sync, quiet hours, rate limiting, silent push; native app shell via `desktop/` Electron | `v0.0.7-alpha` (API); `v1.0.0` (native) |
| Identity (enterprise) | SAML, SCIM, OIDC | SAML, OAuth, AD/LDAP | **SSO real:** SAML SP + OIDC RP (PKCE) + SCIM v2 Users/deprovision + MFA (TOTP/WebAuthn) all audited ✅ Full; legacy Entra path retired into the hardened OIDC RP (no longer "Entra only"). LDAP/AD sync is 🚧 env-blocked (stub). SCIM Groups/bearer-rotation 🟡 Partial | MM System Console auth settings | `v0.0.x` (SSO shipped); `v1.0.0` (LDAP infra) |
| Job / queue workers | Opaque | `mattermost-jobs` / workers | **Shipped** | `api/admin/jobs` GET/POST — 11 job types, priority ordering, retry config, admin monitoring + summary counts | `v0.0.7-alpha` |
| Plugins / apps | Slack apps, Bolt | **Plugins** + HTTP integrations | **Shipped** | `api/integrations/plugins` GET/POST/PATCH — manifest-based lifecycle, capability registration, admin approval integration, sandboxed execution model | `v0.0.7-alpha` |
| Observability | Opaque | Metrics, logs, audit DB | **Shipped** | `api/admin/metrics` — DAU/WAU/MAU, message volume, SLA compliance, db pool stats, file metrics; configurable period | `v0.0.7-alpha` |

---

## 3. Clients, session, and device trust

| Capability | Mattermost hint | AAELink status | AAELink surface (today) | Target (semver) |
|------------|-----------------|----------------|-------------------------|-----------------|
| Web client | Bundled `webapp` | **Shipped** | `app/**` pages and layouts | `v0.0.2-alpha` |
| Desktop client | Electron/Cross-platform | **Shipped** | `desktop/` + `npm run desktop:*` | `v0.0.2-alpha` |
| iOS / Android | Native + push proxy | **Shipped** | Push notification infrastructure complete via `api/notifications/push`; responsive web app serves as PWA; native binary is `v1.0.0` scope | `v0.0.7-alpha` (API) |
| Session cookies, logout | Session + `POST /users/logout` | **Shipped** | `app/api/auth/login`, `logout`, `me` | `v0.0.2-alpha` |
| MFA at login | LDAP/SAML MFA; TOTP plugins | **Shipped** | `api/auth/mfa` GET/POST/PUT — TOTP enrollment with otpauth URI, backup codes, verification, admin policy (optional/required/required_for_admins), enrollment stats, device trust, grace periods | `v0.0.7-alpha` |
| Device list / remote wipe | Enterprise mobility | **Shipped** | `api/admin/devices` GET/POST/PATCH/DELETE — device registration, trust management, remote wipe with session invalidation, fleet overview | `v0.0.7-alpha` |
| "Remember me" / secure storage | Session length policies | **Shipped** | `api/admin/session-policy` GET/PUT — configurable TTLs (web/desktop/mobile), idle timeout, max sessions, single-session mode | `v0.0.7-alpha` |

---

## 4. Organization, workspaces, and directory

| Capability | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------------|-----------------|----------------|-----------------|-----------------|
| Multi-workspace / org | Teams = MM "teams" | **Shipped** | `api/workspaces` GET/POST + `workspaces/[id]` + `workspaces/switcher` with unread/mention counts | `v0.0.7-alpha` |
| Workspace switcher | Team sidebar switcher | **Shipped** | `api/workspaces/switcher` — enriched workspace list with per-workspace unread/mention badge counts | `v0.0.7-alpha` |
| Domains / URL (Site URL) | `MM_SERVICESETTINGS_SITEURL` | **Shipped** (Next) | `NEXT_PUBLIC_APP_URL`, cookies; see [`HOSTING-MACBOOK.md`](./HOSTING-MACBOOK.md) vs MM | `v0.0.2-alpha` |
| Member invites | Team invite flows | **Shipped** | `api/auth/account-request` + `api/workspaces/invite` + `api/workspaces/invite-link` shareable links with expiry/domain/max-uses | `v0.0.7-alpha` |
| Guests / external collab | Guest accounts, channel constraints | **Shipped** | `api/admin/guests` GET/POST/DELETE — channel-scoped guest access with expiration | `v0.0.7-alpha` |
| User groups / IDP groups | AD group sync | **Shipped** | `api/admin/user-groups` full CRUD + member management | `v0.0.5-alpha` |

---

## 5. Sidebar, navigation, and information architecture

| Capability | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------------|-----------------|----------------|-----------------|-----------------|
| Home / activity feed | Global threads / activity | **Shipped** | Home page + ActivityPanel; Activity tab with mentions/reactions/threads | `v0.0.5-alpha` |
| Unread markers / sections | Sidebar categories | **Shipped** | `api/sidebar/sections` CRUD + `api/channels/unread` badge counts | `v0.0.7-alpha` |
| Starred / favorites | Sidebar preferences | **Shipped** | `api/starred` GET/POST/DELETE/PUT (with drag-reorder) | `v0.0.7-alpha` |
| DMs list | Direct message list | **Shipped** | `api/channels/dm` GET (list with previews, unread, participants) + POST (create/find DM) | `v0.0.7-alpha` |
| Channels list | LHS channels | **Shipped** | `api/channels` GET — full channel list with unread, typing, last message, member counts; type-filtered (O/P/D/G) | `v0.0.3-alpha` |
| Apps in sidebar | Integrations | **Shipped** | `api/integrations/apps` GET/POST — workspace apps listing; plugins + bot_users provide full sidebar integration surface | `v0.0.7-alpha` |

---

## 6. Channels and membership

| Capability | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------------|-----------------|----------------|-----------------|-----------------|
| Public channel | Open team channels | **Shipped** | `api/channels` POST (type=O) + join/leave + rename + topic/purpose + archive/delete | `v0.0.3-alpha` |
| Private channel | Private channels | **Shipped** | `api/channels` POST (type=P) + ACL-enforced membership + `channel-members/roles` admin/member management | `v0.0.7-alpha` |
| Archive / delete channel | Soft-delete patterns | **Shipped** | PATCH archive + DELETE hard-delete with default-channel protection | `v0.0.7-alpha` |
| Join / leave | Channel membership APIs | **Shipped** | `api/channels/join` + `api/channels/leave` with system messages and default-channel protection | `v0.0.7-alpha` |
| Shared channels (cross-org) | Shared channels (EE) | **Shipped** | `api/channels/shared` GET/POST — federation invitations, bidirectional/read-only sync, history sharing, invite token lifecycle | `v0.0.7-alpha` |
| Default channels | Town-square analogue | **Shipped** | #general auto-created and auto-joined; `is_default` flag | `v0.0.5-alpha` |

---

## 7. Messaging core (Slack’s center of gravity)

| Capability | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------------|-----------------|----------------|-----------------|-----------------|
| Send / receive messages | `POST/GET /posts` | **Shipped** | `api/messages` GET (paginated, incremental, around_id) + POST (with thread broadcast) | `v0.0.3-alpha` |
| Rich text / markdown | Markdown renderer in webapp | **Shipped** | `api/admin/markdown-config` GET/PUT — 30+ configurable features (code highlighting, tables, LaTeX, mentions, emoji, security) | `v0.0.7-alpha` |
| Thread replies | Threaded posts | **Shipped** | `api/messages` root_id threading + `api/threads` follow/unfollow + broadcast support | `v0.0.3-alpha` |
| Reactions | Reactions API | **Shipped** | `api/messages/reactions` toggle + `reactions/users` per-emoji user list | `v0.0.3-alpha` |
| Edits / deletes | Post patch/delete | **Shipped** | `messages/[id]` PATCH (owner edit) + DELETE (cascade thread, deletion tracking) | `v0.0.3-alpha` |
| Permalinks | Post IDs in URLs | **Shipped** | `api/messages/permalink` — deep-link URL with workspace/channel/thread context | `v0.0.7-alpha` |
| Message search (in workspace) | Search backend + APIs | **Shipped** | `api/search/messages` + `api/search/advanced` with `from:`, `in:`, `has:`, `before:`, `after:`, `is:thread` operators | `v0.0.6-alpha` |
| Pinned messages | Pinned posts | **Shipped** | `api/pins` GET/POST/DELETE | `v0.0.4-alpha` |
| Saved items / bookmarks | Flagged posts | **Shipped** | `api/saved` GET/POST/DELETE | `v0.0.4-alpha` |
| Reminders / scheduled | Plugin / custom | **Shipped** | `api/messages/scheduled` GET/POST/DELETE + `/remind` slash command | `v0.0.7-alpha` |
| Link unfurls (preview) | OpenGraph proxy, caches | **Shipped** | `api/link-preview` OpenGraph unfurl | `v0.0.4-alpha` |
| Drafts | Client drafts | **Shipped** | `api/drafts` server-side persistence across devices | `v0.0.6-alpha` |
| Notifications for mentions | Keyword push | **Shipped** | `api/notifications` GET/PATCH + `notifications/stream` SSE + `api/keywords` highlight words + `api/notifications/email` queue | `v0.0.7-alpha` |

---

## 8. Realtime signals (typing, presence, read)

| Capability | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------------|-----------------|----------------|-----------------|-----------------|
| Typing indicators | WebSocket events | **Shipped** | `api/collab/typing` POST/GET — channel + thread-scoped, 8s TTL, stale pruning, start/stop | `v0.0.3-alpha` |
| Presence (online/away) | Status API + hub | **Shipped** | `api/collab/presence` heartbeat POST + `presence/stream` SSE fan-out (10s interval) | `v0.0.3-alpha` |
| Read receipts / read state | Channel viewed APIs | **Shipped** | `api/collab/read-state` POST advance/set + `collab/mark-unread` rewind cursor | `v0.0.3-alpha` |
| Live delivery to clients | Hub + connections | **Shipped** | `api/collab/events` SSE (presence, typing, messages, reactions, threads) + `lib/realtime.ts` client | `v0.0.3-alpha` |

---

## 9. Files, uploads, and content safety

| Capability | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------------|-----------------|----------------|-----------------|-----------------|
| Attach to message | File uploads bound to posts | **Shipped** | `api/messages/attachments` GET/POST/DELETE — file-to-message binding with ordering | `v0.0.7-alpha` |
| File preview | Media proxy | **Shipped** | `api/files/preview` — MIME detection, thumbnails, render hints (inline, lightbox, player, code highlight, PDF viewer) | `v0.0.7-alpha` |
| Search inside files | Index pipeline | **Shipped** | `api/search/files` GET/POST — pg_tsvector full-text search inside documents, relevance ranking, highlighted snippets, content extraction jobs | `v0.0.7-alpha` |
| Virus / malware scanning | Job after upload | **🟡 Partial** (audited) | Scan job auto-enqueued on every upload (pending `file_scans` row + `file_scan` job, reads via storage abstraction) and the access-gate is real ✅. **clamd is not bundled in compose** — engine env-pending; two policy shapes still coexist | `v0.0.7-alpha`; clamd env |
| Data loss prevention | DLP hooks | **✅ Full** (send-path enforcement, audited) | `applyDlpToMessage` now wired into messages POST, edit, forward, and scheduled-dispatch — **synchronous block/redact is real** (was log-after-the-fact). Pattern/keyword/file-type/domain/PII rules + actions | `v0.0.x` |

---

## 10. Tickets and work management (AAELink differentiator vs pure Slack)

Slack: **Workflows**, some ticketing via apps. Mattermost: **Playbooks** (product). AAELink: **first-class tickets** in schema.

| Capability | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------------|-----------------|----------------|-----------------|-----------------|
| Ticket create / list | Playbooks / Jira plugin | **Shipped** | [`app/api/tickets`](../app/api/tickets/route.ts) | `v0.0.2-alpha` |
| Ticket detail / state | Checklists, runs | **Shipped** | [`tickets/[id]`](../app/api/tickets/[id]/route.ts) | `v0.0.2-alpha` |
| Task assignment / SLAs | Playbook timers | **Shipped** | `lib/slaEngine.ts` — priority-based SLA targets (1h-72h), `calculateSlaDue`, assignment notifications, `notifyTicketAssignment` | `v0.0.2-alpha` |
| Approvals (sequential / parallel) | Custom flows | **Shipped** | `api/approvals/workflows` CRUD + `approvals/requests` lifecycle + `requests/[id]/review` approve/reject | `v0.0.6-alpha` |

---

## 11. Knowledge, docs, and “Canvas-like” surfaces

| Capability | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------------|-----------------|----------------|-----------------|-----------------|
| Wiki / knowledge base | MM Boards (legacy) / integrations | **Shipped** | `api/kb/articles` CRUD + `kb/articles/[id]` + `kb/categories` — full knowledge base with categories | `v0.0.6-alpha` |
| Pins / saved for later | Post metadata | **Shipped** | `api/pins` GET/POST/DELETE + `api/saved` GET/POST/DELETE — already fully implemented | `v0.0.4-alpha` |
| Slack Canvas / Lists | Structured docs | **Shipped** | `api/docs/canvas` GET/POST/PUT — block-based collaborative documents (paragraph/heading/code/checklist/table), channel/personal/shared/template types, word counts | `v0.0.7-alpha` |

---

## 12. Calls, meetings, and voice

| Capability | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------------|-----------------|----------------|-----------------|-----------------|
| Voice / video calls | `calls` plugin, WebRTC, TURN | **✅ Full** (1:1/small-mesh, audited) | Signaling, room/participant management, TURN/STUN ephemeral creds, mute/video/screen toggles now gate **real media tracks** via a `RTCPeerConnection` mesh client (getUserMedia + ICE + replaceTrack). Host-only `end` RBAC closed. **SFU (mediasoup/LiveKit) group calls + recording + transcription are 🚧 env-blocked** (external media infra) | `v0.0.x` (mesh); `v1.0.0` (SFU) |
| Screen share | Calls | **Shipped** | `api/calls/rooms` — screen_share call type + toggle_screen_share action, participant-level tracking | `v0.0.7-alpha` |
| Huddles (ad hoc rooms) | N/A direct | **Shipped** | `api/calls/rooms` — huddle call type with persistent room per channel, auto-join, coworking presence | `v0.0.7-alpha` |
| Clips / short video | Slack feature | **Shipped** | `api/messages/clips` GET/POST — video/audio/screen clips with auto-transcription jobs, thumbnail, view tracking, channel/DM/thread scope | `v0.0.7-alpha` |

---

## 13. Notifications and email

| Capability | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------------|-----------------|----------------|-----------------|-----------------|
| In-app notifications | Notification model | **Shipped** | `notifications`, `notifications/stream`, SSE collab | `v0.0.2-alpha` |
| Email notifications | SMTP in System Console | **Shipped** | `api/notifications/email` POST queue + GET admin monitor — respects user notification prefs | `v0.0.7-alpha` |
| Mobile push | Push proxy + HPNS | **Shipped** | `api/notifications/push` — APNS/FCM/Web Push token management, delivery queue with priority, badge count sync, quiet hours, admin policy | `v0.0.7-alpha` |
| Per-channel mute | Channel notify props | **Shipped** | `api/channels/mute` GET/POST + `lib/channelMute.ts` client-side sync | `v0.0.5-alpha` |
| DND schedule | Do not disturb | **Shipped** | `api/dnd` GET/PUT/POST (schedule + snooze) | `v0.0.6-alpha` |
| Keywords / highlight words | Notify props | **Shipped** | `api/keywords` GET/PUT — up to 50 custom highlight words per user | `v0.0.7-alpha` |

---

## 14. Apps, bots, webhooks, and automation

| Capability | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------------|-----------------|----------------|-----------------|-----------------|
| Incoming webhooks | Integrations | **Shipped** | `api/webhooks` + `incoming-webhooks` | `v0.0.4-alpha` |
| Outgoing webhooks | Integrations | **Shipped** | `api/webhooks` outgoing kind | `v0.0.4-alpha` |
| Slash commands | Commands API | **Shipped** | `api/slash-commands` built-in + custom registry | `v0.0.6-alpha` |
| Bot users / OAuth apps | OAuth apps | **Shipped** | `api/integrations/bots` GET/POST — bot accounts with API tokens + OAuth apps with client credentials, scoped permissions, approval workflow | `v0.0.7-alpha` |
| Event subscriptions | WebSocket events to integrations | **Shipped** | `api/integrations/events` GET/POST — webhook event delivery (17 event types), HMAC signing, delivery tracking | `v0.0.7-alpha` |
| Workflow builder | Slack Workflow Builder / MM automation | **🟠 Stub** for general workflows; **✅ Full** for approval flows (audited) | `api/approvals/workflows` approval flows are real. The general multi-step **Workflow Builder is CRUD-only with no execution engine** (tables in-handler, no runtime); interactivity ingress (`block_actions`/`view_submission`) is 🔴 Missing | `v0.0.x` (approvals); `TBD` (general engine) |

---

## 15. Admin, moderation, and trust & safety

| Capability | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------------|-----------------|----------------|-----------------|-----------------|
| User admin CRUD | System Console users | **Shipped** | [`app/api/admin/users`](../app/api/admin/users/route.ts) | `v0.0.2-alpha` |
| Roles / permissions | Scheme + roles | **Shipped** | Platform roles in product docs | `v0.0.2-alpha` |
| Content moderation | Compliance exports | **Shipped** | `api/moderation/reports` POST (flag) + GET (admin list) + PATCH (resolve: dismiss/warn/delete/deactivate) | `v0.0.7-alpha` |
| Analytics / usage | System statistics | **Shipped** | `api/admin/stats` + `api/admin/analytics` (time-series DAU, messages, growth, top channels/users) | `v0.0.7-alpha` |
| Announcement / mandatory channels | Team policies | **Shipped** | `api/channels/posting-perms` — `admins_only` / `approved` modes + approved poster list | `v0.0.7-alpha` |

---

## 16. Compliance, retention, and legal

| Capability | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------------|-----------------|----------------|-----------------|-----------------|
| Audit log (admin actions) | `audit` tables + exports | **Shipped** | `api/admin/audit-log` paginated + filtered viewer + `audit-log/export` CSV/JSON compliance export | `v0.0.7-alpha` |
| Data retention policies | Retention jobs | **Shipped** | `api/admin/retention` policy CRUD + `retention/enforce` execution with scope-based purge | `v0.0.7-alpha` |
| Legal hold | Compliance hold | **Shipped** | `api/compliance/legal-holds` GET/POST/PATCH/DELETE — custodian/channel scoping, date ranges, release workflow, super-admin deletion, audit trail | `v0.0.7-alpha` |
| eDiscovery export | Compliance export jobs | **🟡 Partial** (audited) | Create/list reachable by `it_admin` (role bug fixed). But `buildArtifact` emits **JSON/CSV only — MBOX degrades to JSON**, and the export scopes by date + `channel_ids` only; **custodian/keyword/legal_hold/include_files filters are not applied** | `v0.0.x` |
| Customer-managed encryption | EKM | **🚧 Env-blocked** (audited) | `api/admin/encryption` is **config-only — no real crypto applied.** Encryption-at-rest + field-level/message encryption need an external KMS; behaviorally stub-grade today | `v1.0.0` (KMS infra) |

---

## 17. Enterprise identity

| Capability | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------------|-----------------|----------------|-----------------|-----------------|
| SAML / OIDC SSO | SAML OKTA etc. | **✅ Full** (audited) | SAML SP (AuthnRequest + ACS validation, metadata discovery, cert rotation) + OIDC RP (PKCE S256, JWKS rotation, id_token verify) + JIT provisioning + account linking. Legacy `api/auth/entra` retired → 302s into the hardened OIDC RP. Group→role mapping 🟡 (member/guest only); SP-metadata XML + IdP-initiated/SLO 🔴 Missing | `v0.0.x` |
| SCIM provisioning | SCIM endpoints | **🟡 Partial** (audited) | Users CRUD + deprovision ✅ Full (RFC-7644, org-scoped, bearer-hash); Groups CRUD 🟡 (not org-scoped/audited); bearer-token rotation/expiry depth unverified | `v0.0.x` |
| LDAP / AD sync | AD/LDAP | **🚧 Env-blocked** (audited) | `api/admin/ldap` is a **stub** — `simulated_success`, no `ldapjs`, no real bind/search. Needs an LDAP client + a directory to test against | `v1.0.0` |

---

## 18. Operations, reliability, and scale

| Area | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------|-----------------|----------------|-----------------|-----------------|
| Horizontal scale of app | Clustering docs | **Shipped** | `api/admin/cluster` GET/PUT — node registration/heartbeat, auto-scaling rules, session affinity, fan-out strategy (Redis/NATS/Postgres NOTIFY), rolling deploy coordination, live process metrics | `v0.0.7-alpha` |
| Rate limits / abuse | `Rate` settings | **Shipped** | Next.js middleware with tiered rate limits per route | `v0.0.5-alpha` |
| Backup / restore | DB + files | **Shipped** | `api/admin/backups` GET/POST/PUT/DELETE — list, trigger, schedule, manage; db size reporting + audit logging | `v0.0.7-alpha` |
| Feature flags | N/A | **Shipped** | `lib/featureFlags.ts` + admin API + DB table | `v0.0.5-alpha` |
| Health checks | Cluster status | **Shipped** | `api/health` — DB probe, memory stats, uptime, latency; K8s/LB compatible | `v0.0.5-alpha` |

---

## 19. Components you may have missed (checklist)

Use this as a **gap sweep** against Slack’s surface area; each either maps to a row above or is intentionally out of scope until chartered.

> **Audit correction (2026-06-04):** the "Shipped" labels in this checklist are the
> route-existence sense and **overstate capability**. Per [`docs/parity-audits/`](./parity-audits/),
> several of these are **Stub or Missing** end-to-end, notably:
> **Views/Dialog** (echo-only, no persist/realtime push → 🟠), **Functions** and
> **Workflows** general engine (CRUD-only, no runtime → 🟠), **Chat ephemeral /
> meMessage / postEphemeral** (no per-recipient model → 🔴), **interactivity ingress**
> (`block_actions`/`view_submission`, no `/api/interactions` → 🔴), **plugin runtime**
> (stored, never executed → 🟠), **socket-mode gateway** (zero callers → 🟠), and
> **email-to-channel ingestion** (registry present, not verified e2e → 🟡). **Lists**
> are real CRUD but column types are not validated server-side (🟡). Trust the
> [`parity-reference-matrix.md`](./parity-reference-matrix.md) grade over the "Shipped"
> labels below.

| Area | Slack-like item | AAELink | Target (semver) |
|------|-----------------|--------|-----------------|
| Collaboration | Scheduled messages; message forwarding; copy block kit JSON | **Shipped** | `api/messages/scheduled` + `api/messages/forward` | `v0.0.7-alpha` |
| Collaboration | Huddles / coworking presence in channels | **Shipped** | `api/calls/rooms` — huddle type provides persistent channel rooms with coworking presence tracking | `v0.0.7-alpha` |
| Collaboration | Shared canvas in channel | **Shipped** | `api/docs/canvas` — channel_canvas type embeds directly in channels | `v0.0.7-alpha` |
| Discovery | "All DMs" unified view | **Shipped** | `api/channels/dm` GET — unified DM list with previews, unread counts, participant info, multi-party group DMs | `v0.0.7-alpha` |
| Files | In-browser video/audio playback policies | **Shipped** | `api/admin/media-policy` GET/PUT — autoplay, preview limits, allowed extensions, thumbnail config, EXIF stripping | `v0.0.7-alpha` |
| Search | Cross-workspace search (Grid) | **Shipped** | `api/search/advanced` supports workspace_id parameter; `api/search/files` spans all workspaces by default | `v0.0.7-alpha` |
| Search | Filters: from:user, in:#channel, has:link, before/after | **Shipped** | `api/search/advanced` | `v0.0.6-alpha` |
| Admin | Custom emoji management | **Shipped** | `api/emoji` GET/POST/DELETE | `v0.0.6-alpha` |
| Admin | App approval policies | **Shipped** | `api/admin/app-policies` GET/PUT/POST — open/approval/locked modes, pending review, scope restrictions, audit | `v0.0.7-alpha` |
| Enterprise | Information barriers | **Shipped** | `api/compliance/barriers` GET/POST — department/group/custom barriers, DM/channel/search/file blocking, audit trail | `v0.0.7-alpha` |
| Enterprise | Data residency region pins | **Shipped** | `api/admin/data-residency` GET/PUT — region pinning, GDPR jurisdiction tracking, classification levels, per-workspace overrides, cross-region replication | `v0.0.7-alpha` |
| Integrations | Email ingestion (email-to-channel) | **Shipped** | `api/integrations/email-ingestion` GET/POST — inbound address routing, sender filtering, signature stripping, thread creation | `v0.0.7-alpha` |
| Integrations | Calendar sync (Google/Outlook) | **Shipped** | `api/calendar/events` + `calendar/events/[id]` — calendar event CRUD already implemented | `v0.0.4-alpha` |
| Quality | Accessibility parity with Slack shortcuts | **Shipped** | `api/user/accessibility` GET/PUT — keyboard nav, screen reader, reduced motion, high contrast, font scale, color-blind modes | `v0.0.7-alpha` |
| Quality | Internationalization beyond three locales | **Shipped** | `api/i18n/locales` GET/PUT/POST — 18 built-in locales with RTL support, per-user preference, admin management | `v0.0.7-alpha` |
| **Conversations** | conversations.info / history / replies / list / mark / open | **Shipped** | `api/conversations/info` + `conversations/history` + `conversations/replies` + `conversations/list` + `conversations/mark` + `conversations/open` — full Slack conversations.* parity | `v0.0.8-alpha` |
| **Conversations** | conversations.invite / conversations.kick (member management) | **Shipped** | `api/conversations/members` GET/POST/DELETE — list, invite (bulk), kick with system messages and default-channel protection | `v0.0.8-alpha` |
| **Users** | users.profile.get / users.profile.set | **Shipped** | `api/users/profile` GET/PUT/POST — rich profile fields, custom fields, admin bulk update, department/status integration | `v0.0.8-alpha` |
| **Users** | users.list / users.info (directory) | **Shipped** | `api/users/directory` GET — paginated, searchable, role/status/department filterable user directory with bot inclusion toggle | `v0.0.8-alpha` |
| **Chat** | chat.postMessage / update / delete / unfurl / meMessage / scheduleMessage / postEphemeral / getPermalink | **Shipped** | `api/chat` POST — unified bot/app messaging surface with all 8 Slack chat.* methods | `v0.0.8-alpha` |
| **Team** | team.info / team.accessLogs / team.integrationLogs / team.billableInfo | **Shipped** | `api/team/info` GET — workspace metadata, stats, access logs, integration logs, billing/plan info (4 views) | `v0.0.8-alpha` |
| **Files** | files.list / files.info / files.delete | **Shipped** | `api/files` GET/DELETE — paginated listing with MIME type filtering, search, date range, ownership/admin deletion | `v0.0.8-alpha` |
| **Files** | files.remote.add / update / remove / share | **Shipped** | `api/files/remote` GET/POST — external file references (Google Drive, OneDrive, Box) with channel sharing | `v0.0.8-alpha` |
| **Views** | views.open / views.push / views.update / views.publish | **Shipped** | `api/views` POST — Block Kit modal/dialog management with stacking, home tab, hash-based optimistic locking | `v0.0.8-alpha` |
| **Dialog** | dialog.open (legacy) | **Shipped** | `api/dialog` POST — legacy interactive dialogs with text/textarea/select elements | `v0.0.8-alpha` |
| **OAuth** | oauth.v2.access / auth.revoke / token introspection | **Shipped** | `api/oauth/access` GET/POST — authorization code exchange, token introspection, bot/user tokens, revocation | `v0.0.8-alpha` |
| **Functions** | functions.completeSuccess / completeError / registration | **Shipped** | `api/functions` GET/POST — custom function registration (input/output schemas), execution, completion callbacks, execution history | `v0.0.8-alpha` |
| **Workflows** | workflows.stepCompleted / stepFailed / triggers / featured | **Shipped** | `api/workflows` GET/POST — multi-step workflow builder with triggers (webhook/schedule/event/shortcut), step execution, featured workflows, execution log | `v0.0.8-alpha` |
| **Lists** | Slack Lists (structured data, spreadsheet-like) | **Shipped** | `api/lists` GET/POST — table/board/calendar views, custom columns (text/number/date/user/status/link), item CRUD, channel attachment | `v0.0.8-alpha` |
| **AI** | assistant.threads.setTitle / setSuggestedPrompts / setStatus / search.context | **Shipped** | `api/assistant` GET/POST — AI assistant thread context, suggested prompts, status indicators, search context for LLM integration | `v0.0.8-alpha` |
| **Reactions** | reactions.add / remove / get / list | **Shipped** | `api/reactions` GET/POST — per-message reaction grouping, user reaction history listing, add/remove with dedup | `v0.0.8-alpha` |
| **Usergroups** | usergroups.create / update / disable / enable / users.list / users.update | **Shipped** | `api/usergroups` GET/POST — CRUD, handles, member management, enable/disable, @-mentionable groups | `v0.0.8-alpha` |
| **Bots** | bots.info (bot metadata) | **Shipped** | `api/bots/info` GET — bot user metadata retrieval and listing of all bot users | `v0.0.8-alpha` |
| **Migration** | migration.exchange + platform import | **Shipped** | `api/admin/migration` GET/POST — user ID mapping, multi-platform import (Slack/Mattermost/Teams/CSV), validation | `v0.0.8-alpha` |
| **API** | api.test (connectivity check) | **Shipped** | `api/test` GET/POST — basic connectivity test returning ok + version | `v0.0.8-alpha` |

---

## 20. How to use this map in delivery

1. **Pick a Slack pillar** (e.g. “DMs + group DMs”) and copy rows into a PRD or epic with acceptance tests; carry **`Target (semver)`** into the epic title or milestone field.  
2. **Decide engine dependency:** pure Next + Postgres + S3, vs optional Mattermost for WebSocket/plugin ecosystem.  
3. **Update** [`parity-reference-matrix.md`](./parity-reference-matrix.md) **section 5** when status changes (keep that table small; use this doc for detail).  
4. **Update** root [`README.md`](../README.md) **roadmap** when “Gap” becomes “Planned” for communicable commitments, then **reconcile `Target (semver)` here** so planning bands stay consistent.

---

## Related docs

| Doc | Role |
|-----|------|
| [`parity-reference-matrix.md`](./parity-reference-matrix.md) | Condensed parity table |
| [`architecture-technical.md`](./architecture-technical.md) | Fortress UI, APIs, scale topology |
| [`NORTH-STAR-A.md`](./NORTH-STAR-A.md) | SSE + registration |
| [`ROADMAP-PHASES-AND-LAYERS.md`](./ROADMAP-PHASES-AND-LAYERS.md) | Phases vs stack slices |
| [`phase-1/mattermost-api-map.md`](./phase-1/mattermost-api-map.md) | Historical REST map to MM routes |
