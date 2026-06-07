# Slack-class parity — full map to AAELink

> **Regenerated 2026-06-06 from code verification; see [`docs/parity-audits/`](./parity-audits/) for evidence.**
> Every status below was set by trusting the code over the docs: response shape,
> RBAC, CSRF, audit-logging, realtime wiring, and whether the path is actually
> *called end-to-end* were all checked against the verified data.
> Rows marked ⛔ were excluded from tallies with the reason given.

This document is the **exhaustive** planning map from a **Slack-class** product (user-visible capabilities) to **AAELink** (this repository's **Next.js** app under `app/`, APIs under `app/api/**`, schema `aaelink` in PostgreSQL). Where Slack's internals are not public, it uses **Mattermost Team Edition** as the engineering reference (data model, jobs, search, push, plugins).

**Shorter matrix:** [`parity-reference-matrix.md`](./parity-reference-matrix.md)  
**Runtime and scale:** [`architecture-technical.md`](./architecture-technical.md)  
**Optional Mattermost engine** (Docker / `vendor/upstream`, not required for the Next app): [`WHERE-IS-THE-ENGINE.md`](./WHERE-IS-THE-ENGINE.md), [`ARCHITECTURE-AAELINK-STACK.md`](./ARCHITECTURE-AAELINK-STACK.md)

---

## 1. Method and status legend

| Status | Meaning |
|--------|---------|
| ✅ **Full** | Behavior works end-to-end: correct shape, RBAC, CSRF, audit log, realtime wiring all verified in code |
| 🟡 **Partial** | Core path works; documented gaps in security, parity depth, or wiring remain |
| 🟠 **Stub** | Surface (route/DDL) exists but does nothing end-to-end; behavior missing |
| 🔴 **Missing** | No implementation found in `app/` or `lib/` |
| ⛔ **Excluded** | Out of scope (external infra / AI-ML / BLUEPRINT-aspirational); reason stated in note |

**"Mirror Slack"** does not require identical UX; it means **comparable organizational outcomes**: secure multi-user workspace, channels and DMs, searchable history, files, realtime collaboration, notifications, admin and compliance hooks, and an extensibility story.

### 1.1 `Target (semver)` column

Planning targets are **semver bands**, not promises. Re-baseline when the root [`README.md`](../README.md) roadmap changes.

| Value | Meaning |
|-------|---------|
| `v0.0.2-alpha` | Current ship line |
| `v0.1.0-alpha` | Next alpha milestone (deeper chat/DM/sidebar/collab) |
| `v0.2.0-alpha` | Following alpha (workflows, richer messaging, search/index UX) |
| `v0.3.0-beta` | Beta band (scale-out, ops hardening, more enterprise controls) |
| `v1.0.0` | GA-class target (mobile, calls, heavy compliance, full extensibility) |
| `TBD` | No semver locked; product charter required |

---

## 2. Runtimes, frameworks, and engines (project scope)

| Layer | Slack (reference) | Mattermost (reference) | AAELink — **this repo** | Target (semver) |
|-------|-------------------|------------------------|-------------------------|-----------------|
| Primary web app | Proprietary web + desktop | React `webapp/` in server bundle | **Next.js 16** App Router (`app/`), React 19, Tailwind v4, `lucide-react` | `v0.0.2-alpha` |
| HTTP APIs | Proprietary | REST + WebSocket (`/api/v4/...`) | **`app/api/**`** Route Handlers | `v0.0.2-alpha` |
| Realtime transport | WebSocket (assumed) | WebSocket hub | **SSE** [`/api/collab/events`](../app/api/collab/events/route.ts); typing/presence/read routes under `app/api/collab/` | `v0.1.0-alpha` (SSE parity depth) |
| Application database | Proprietary | PostgreSQL (MM schema) | **PostgreSQL** schema `aaelink` via [`lib/migrate.ts`](../lib/migrate.ts) | `v0.0.2-alpha` |
| Full-text search | Proprietary | Elasticsearch / OpenSearch | ✅ **Full** SQL FTS engine (`body_tsv` GIN, `websearch_to_tsquery`, `ts_rank`/`ts_headline`); full `from:/in:/has:/before:/after:/is:/on:/during:` grammar; file-content + people + channel search. OpenSearch/BM25 tier out of scope until v0.3.0-beta | `v0.0.x` (SQL FTS); `v0.3.0-beta` (index tier) |
| Object storage | Proprietary cloud | S3-compatible file backend | **S3 SDK** + MinIO in dev; `lib/files/storage.ts` unifies chat path on `lib/infra/s3`; `storage_backend` recorded per-row | `v0.0.2-alpha` |
| PDF / document services | Slack Canvas, lists, file tools | Integrations / plugins | **Stirling-PDF** URL + [`app/api/documents`](../app/api/documents/route.ts), OCR route | `v0.2.0-alpha` |
| Desktop shell | Electron | Desktop apps | **Electron** [`desktop/`](../desktop/) loading web URL | `v0.0.2-alpha` |
| Mobile | Native apps | Native apps | Push infrastructure complete (`api/notifications/push`); native binary `v1.0.0` scope | `v0.0.7-alpha` (API); `v1.0.0` (native) |
| Identity (enterprise) | SAML, SCIM, OIDC | SAML, OAuth, AD/LDAP | SAML SP + OIDC RP (PKCE) + SCIM v2 Users/deprovision + MFA (TOTP/WebAuthn) ✅ Full; LDAP/AD sync 🚧 env-blocked (stub) | `v0.0.x` (SSO); `v1.0.0` (LDAP) |
| Job / queue workers | Opaque | `mattermost-jobs` / workers | `api/admin/jobs` — 11 job types, priority ordering, retry config, admin monitoring | `v0.0.7-alpha` |
| Observability | Opaque | Metrics, logs, audit DB | `api/admin/metrics` — DAU/WAU/MAU, message volume, SLA compliance, db pool stats | `v0.0.7-alpha` |

---

## 3. Clients, session, and device trust

| Capability | Mattermost hint | Status | AAELink surface | Target (semver) |
|------------|-----------------|--------|-----------------|-----------------|
| Web client | Bundled `webapp` | ✅ Full | `app/**` pages and layouts | `v0.0.2-alpha` |
| Desktop client | Electron/Cross-platform | ✅ Full | `desktop/` + `npm run desktop:*` | `v0.0.2-alpha` |
| iOS / Android | Native + push proxy | 🟡 Partial | Push API complete; native binary is `v1.0.0` scope | `v0.0.7-alpha` (API) |
| Session cookies, logout | Session + `POST /users/logout` | ✅ Full | `app/api/auth/login`, `logout`, `me` | `v0.0.2-alpha` |
| MFA at login | LDAP/SAML MFA; TOTP plugins | ✅ Full | `api/auth/mfa` — TOTP enrollment, backup codes, verification, admin policy, device trust, grace periods | `v0.0.7-alpha` |
| Device list / remote wipe | Enterprise mobility | 🟡 Partial | `api/admin/devices` — registration, trust management, remote wipe (flag only, no MDM push); buggy `platform_admin` check | `v0.0.7-alpha` |
| "Remember me" / secure storage | Session length policies | 🟡 Partial | `api/admin/session-policy` TTL/idle/device-list/revoke enforced; max_sessions/single_session/force_reauth/revoke_on_password_change defined-only (zero enforcement reads outside route) | `v0.0.7-alpha` |

---

## 4. Organization, workspaces, and directory

| Capability | Mattermost hint | Status | AAELink surface | Target (semver) |
|------------|-----------------|--------|-----------------|-----------------|
| Multi-workspace / org | Teams = MM "teams" | ✅ Full | `api/workspaces` GET/POST + `workspaces/[id]` + `workspaces/switcher` with unread/mention counts | `v0.0.7-alpha` |
| Workspace switcher | Team sidebar switcher | ✅ Full | `api/workspaces/switcher` — enriched workspace list with per-workspace unread/mention badge counts | `v0.0.7-alpha` |
| Domains / URL | `MM_SERVICESETTINGS_SITEURL` | ✅ Full | Real DNS TXT verification: `domains/route.ts` calls `verifyDomain` with real `node:dns` resolver | `v0.0.2-alpha` |
| Member invites | Team invite flows | ✅ Full | `api/auth/account-request` + `api/workspaces/invite` + `api/workspaces/invite-link` shareable links with expiry/domain/max-uses | `v0.0.7-alpha` |
| Guests / external collab | Guest accounts, channel constraints | 🟡 Partial | `api/admin/guests` create/list/revoke + `expires_at` stored; worker has NO `guest_expire` handler — only referenced in `jobs/route.ts:37` comment; no scheduled expiry enforcement | `v0.0.7-alpha` |
| User groups / IDP groups | AD group sync | ✅ Full | `api/admin/user-groups` full CRUD + member management | `v0.0.5-alpha` |

---

## 5. Sidebar, navigation, and information architecture

| Capability | Mattermost hint | Status | AAELink surface | Target (semver) |
|------------|-----------------|--------|-----------------|-----------------|
| Home / activity feed | Global threads / activity | ✅ Full | Home page + ActivityPanel; Activity tab with mentions/reactions/threads | `v0.0.5-alpha` |
| Unread markers / sections | Sidebar categories | ✅ Full | `api/sidebar/sections` CRUD + `api/channels/unread` badge counts | `v0.0.7-alpha` |
| Starred / favorites | Sidebar preferences | ✅ Full | `api/starred` GET/POST/DELETE/PUT (with drag-reorder) | `v0.0.7-alpha` |
| DMs list | Direct message list | ✅ Full | `api/channels/dm` GET (list with previews, unread, participants) + POST (create/find DM) | `v0.0.7-alpha` |
| Channels list | LHS channels | ✅ Full | `api/channels` GET — full channel list with unread, typing, last message, member counts; type-filtered (O/P/D/G) | `v0.0.3-alpha` |
| Apps in sidebar | Integrations | 🟡 Partial | `api/integrations/apps` GET/POST — workspace apps listing; plugins + bot_users provide sidebar surface; plugin runtime is stub-grade | `v0.0.7-alpha` |

---

## 6. Channels and membership

| Capability | Mattermost hint | Status | AAELink surface | Target (semver) |
|------------|-----------------|--------|-----------------|-----------------|
| Public channel | Open team channels | ✅ Full | `api/channels` POST (type=O) + join/leave + rename + topic/purpose + archive/delete | `v0.0.3-alpha` |
| Private channel | Private channels | ✅ Full | `api/channels` POST (type=P) + ACL-enforced membership + `channel-members/roles` admin/member management | `v0.0.7-alpha` |
| Archive / delete channel | Soft-delete patterns | ✅ Full | PATCH archive + DELETE hard-delete with default-channel protection | `v0.0.7-alpha` |
| Join / leave | Channel membership APIs | ✅ Full | `api/channels/join` + `api/channels/leave` with system messages and default-channel protection | `v0.0.7-alpha` |
| Shared channels (cross-org) | Shared channels (EE) | 🟡 Partial | `connectAllowlist.ts` stores `connect_allowlist` rows; still no external-org handshake / federation transport | `v0.0.7-alpha` |
| Default channels | Town-square analogue | ✅ Full | #general auto-created and auto-joined; `is_default` flag | `v0.0.5-alpha` |

---

## 7. Messaging core

Slack API methods: `chat.postMessage`, `chat.update`, `chat.delete`, `conversations.history`, `reactions.add`, `reactions.remove`, `pins.add`, `pins.remove`, `pins.list`, `chat.scheduleMessage`, `chat.deleteScheduledMessage`, `chat.getPermalink`, `chat.postEphemeral`, `chat.meMessage`

| Behavior | Slack/MM method | Status | Note | Target (semver) |
|----------|-----------------|--------|------|-----------------|
| Send message to channel | `chat.postMessage` | ✅ Full | `messages/route.ts:448` — `userCanReadChannel` + archived + `userCanPostToChannel` + DLP + CSRF (non-bearer) + notify fan-out | `v0.0.3-alpha` |
| Send to DM | `chat.postMessage` (type=D) | ✅ Full | `messages/route.ts:532` isDm branch → `notifyDirectMessage` to all recipients | `v0.0.3-alpha` |
| Send to group DM | `chat.postMessage` (type=G) | 🟡 Partial | type 'G' uses same path (`collab-access.ts:107` G bypasses `posting_mode`); still no dedicated group-DM fan-out test | `v0.0.3-alpha` |
| Get channel history (paginated) | `conversations.history` | ✅ Full | Primary path `messages/route.ts:125` GET uses `m.body` + since/before/around/`older_available`; NOTE sibling `conversations/history/route.ts:50` selects nonexistent `m.content` (broken alias) | `v0.0.3-alpha` |
| Thread replies (one level) | `conversations.replies` | ✅ Full | `messages/route.ts:495` enforces `thread_one_level_only` on `root_id` | `v0.0.3-alpha` |
| Thread broadcast (reply also to channel) | `chat.postMessage` broadcast | 🟡 Partial | `messages/route.ts:602` still INSERTs a second independent top-level row (id `broadcastId`), not a flagged single post; edits/deletes won't sync | `v0.1.0-alpha` |
| Edit message | `chat.update` | ✅ Full | `messages/[id]/route.ts:99` — `verifyCsrf` + owner-only + DLP + `recordMessageEdit` + `writeAuditLog` 'message.edit' (167) | `v0.0.3-alpha` |
| Edit history | — | ✅ Full | `messages/[id]/edits` + `lib/messaging/messageEdits.recordMessageEdit`, called at `[id]/route.ts:158` | `v0.0.3-alpha` |
| Delete message | `chat.delete` | 🟡 Partial | `[id]/route.ts:195` — `verifyCsrf` + tombstone + `writeAuditLog` 'message.delete' (261); still owner-only, no admin/mod override delete | `v0.0.3-alpha` |
| Add/remove reaction (toggle) | `reactions.add` / `reactions.remove` | ✅ Full | `reactions/route.ts:39` — `verifyCsrf` + `userCanReadChannel(60)` + atomic BEGIN toggle(69) + webhook emit | `v0.0.3-alpha` |
| List who reacted | `reactions.get` | 🟡 Partial | `reactions/users/route.ts:47` still LIMIT 20, no pagination | `v0.0.3-alpha` |
| Reactions on a message (summary) | `reactions.list` | ✅ Full | `lib/messaging/chat-post` `reactionSummariesForMessages` returns `{key,count,me}` inline | `v0.0.3-alpha` |
| Pin message | `pins.add` | ✅ Full | `pins/route.ts:62` — `userCanReadChannel` gate added on POST + GET + DELETE; `verifyCsrf` + `writeAuditLog` 'message.pin' (:88) | `v0.0.4-alpha` |
| Unpin message | `pins.remove` | ✅ Full | `pins/route.ts:110` — `userCanReadChannel` gate added on DELETE; `verifyCsrf` + `writeAuditLog` 'message.unpin' (:124) | `v0.0.4-alpha` |
| List pins | `pins.list` | ✅ Full | `pins/route.ts:9` GET joins author/pinner, LIMIT 50 | `v0.0.4-alpha` |
| Save / bookmark item (personal) | `bookmarks.add` (saved) | ✅ Full | `saved/route.ts:78` `verifyCsrf` added; per-user, search+paging on list | `v0.0.4-alpha` |
| Channel bookmarks bar | `bookmarks.add` (channel) | 🟡 Partial | `bookmarks/route.ts:44` — `verifyCsrf` + URL validation added; still NO RBAC (DELETE removes any id, no membership/ownership), no audit, no reorder/folders | `v0.0.4-alpha` |
| Drafts (server-side, cross-device) | — | ✅ Full | `drafts/route.ts` upsert per (user,channel,root), 40K cap (line 72); test `tests/messageDrafts.test.ts` | `v0.0.6-alpha` |
| Scheduled message create | `chat.scheduleMessage` | ✅ Full | `scheduled-messages/route.ts:19` — `verifyCsrf` + `isChannelArchived` + `userCanPostToChannel` all gated at create (app/api/scheduled-messages/route.ts:19,52,55) | `v0.0.7-alpha` |
| Scheduled messages list | `chat.scheduledMessages.list` | ✅ Full | `scheduled-messages/route.ts:60` GET lists caller's pending | `v0.0.7-alpha` |
| Scheduled message delete/cancel | `chat.deleteScheduledMessage` | ✅ Full | `scheduled-messages/route.ts:87` DELETE owner-scoped cancel | `v0.0.7-alpha` |
| Scheduled dispatch (delivery) | — (internal) | ✅ Full | `dispatch/route.ts` authenticated via `DISPATCH_SECRET` header or platform_admin/super_admin session (:26-42); delivery unified in `lib/messaging/deliverScheduledMessage.ts` with full notify fan-out (mentions/broadcast/keywords/thread followers), realtime `emitMessageEvent`, `emitMessageCreated`, `last_post_at`; used by both HTTP dispatch route and `lib/infra/scheduledMessageProcessor.ts` | `v0.1.0-alpha` |
| Message permalink | `chat.getPermalink` | ✅ Full | `permalink/route.ts:51` — `userCanReadChannel` gate added; non-members receive 403 forbidden (app/api/messages/permalink/route.ts:51-52) | `v0.0.7-alpha` |
| Forward / share message | — | ✅ Full | `forward/route.ts:60` — `userCanReadChannel` on `original.channel_id` guards source (IDOR denied as 404); `verifyCsrf`:23 + target archived(81)+`userCanPostToChannel`(84)+DLP(:106)+audit `'message.forward'`(:128) | `v0.1.0-alpha` |
| In-channel / workspace message search | `search.messages` | ✅ Full | `search/route.ts:41` uses shared FTS `searchEngine` (`body_tsv`/`websearch_to_tsquery`/`ts_rank`/`ts_headline`) + membership(35); replaces ILIKE | `v0.0.6-alpha` |
| Search operators (`from:/in:/has:/before:/after:`) | `search.messages` modifiers | ✅ Full | `lib/messaging/searchEngine.ts` parses `from:/in:/has:/before:/after:/on:/during:` + channelId filter (47,234-291) | `v0.0.6-alpha` |
| Typing indicator (channel) | — (`users.setPresence`) | ✅ Full | `collab/typing/route.ts:77` POST 8s TTL, Redis emit + DB poll fallback | `v0.0.3-alpha` |
| Typing indicator (thread) | — | 🟡 Partial | `collab/typing` thread branch (`root_id`) still DB-only thread_typing poll, no realtime emit | `v0.1.0-alpha` |
| Read state / mark read | `conversations.mark` | ✅ Full | `collab/read-state`, `conversations/mark`, `collab/mark-unread`, `channels/unread`, `channels/dm` ALL write/read `channel_read_state`; legacy `read_state` migrated+DROPPED (`migrate.ts:3108-3120`). Note: `read-state POST` lacks `verifyCsrf` | `v0.0.3-alpha` |
| Mark unread (rewind cursor) | — | ✅ Full | `collab/mark-unread/route.ts:42` writes `channel_read_state` (same table as read math); split-brain resolved | `v0.0.3-alpha` |
| Unread badge counts | — | ✅ Full | `channels/unread/route.ts:63` + `channels/dm/route.ts:62` + threads all read `channel_read_state` — single consistent source | `v0.0.3-alpha` |
| Follow / unfollow thread | — | ✅ Full | `threads/route.ts:37` `is_following` now reads `thread_followers` (EXISTS subquery); `notifyThreadFollowers` with access filter + mention dedup wired at `messages/route.ts:625`; auto-follow on reply (`messages/route.ts:529`); pref `thread_replies_enabled` honored (`notificationsServer.ts:627`); migration 047 | `v0.1.0-alpha` |
| Threads list ("Threads" view) | — | ✅ Full | `threads/route.ts:22` GET + mark-read POST with `verifyCsrf(77)`; unread from `channel_read_state(48)` | `v0.0.3-alpha` |
| Live delivery (new msg/edit/react push to clients) | RTM / Events API | 🟡 Partial | messages POST now calls `emitMessageEvent` → `getPubSub().publish(channelTopic)` for main + broadcast inserts (`app/api/messages/route.ts:659,682`); pub/sub emit wired. `collab/events` SSE consumer is still watermark/since DB-poll (`events/route.ts:65,110`) — push requires a subscribing SSE client; poll fallback remains | `v0.1.0-alpha` |
| Announcement / read-only channel enforcement | — | ✅ Full | `collab-access.ts:82` `userCanPostToChannel` enforces `posting_mode` (`everyone`/`admins_only`/`approved` + `channel_approved_posters`); called at `messages/route.ts:476` | `v0.0.7-alpha` |
| Post to archived channel blocked | — | ✅ Full | `collab-access.ts:54` `isChannelArchived` (`archived_at!=0` OR `is_archived`) called at `messages/route.ts:473` → 403 `channel_archived`; also in forward + dispatch | `v0.0.3-alpha` |
| CSRF on message mutations | — | ✅ Full | `verifyCsrf` on send(459, bearer-exempt), edit(99), delete(195), react(39), pin/unpin(43/88), save(78), forward(22), bookmarks(44/94); residual gaps: scheduled-create, dispatch, read-state POST | `v0.0.x` |
| Ephemeral / me-message / `postEphemeral` | `chat.postEphemeral` / `chat.meMessage` | 🔴 Missing | `chat/route.ts` and `conversations/history/route.ts` phantom-column bugs fixed (`body`/`root_id`/`reaction_key` corrected, `type` field removed from INSERT); `postEphemeral` still not persisted (`chat/route.ts:76`) — ephemeral messages remain in-memory only | `v0.2.0-alpha` |

**Messaging Core tally:** 38 behaviors — Full 29 · Partial 8 · Stub 0 · Missing 1 · Excluded 0

---

## 8. Search & Discovery

Slack API methods: `search.messages`, `search.files`, `search.all`, `users.list` (people search)

| Behavior | Slack/MM method | Status | Note | Target (semver) |
|----------|-----------------|--------|------|-----------------|
| Full-text message search | `search.messages` | ✅ Full | `app/api/search/messages/route.ts` wraps unified FTS engine `lib/messaging/searchEngine.ts` (`body_tsv` GIN, `websearch_to_tsquery`, `ts_rank`); ACL in-query; `tests/searchMessages.test.ts` + `__tests__/api/search-messages.test.ts` | `v0.0.6-alpha` |
| File content search | `search.files` | 🟡 Partial | `app/api/search/files/route.ts` FTS+`ts_headline`; tested and reachable via `/search/all` fan-out; still no dedicated file-search UI surface | `v0.0.6-alpha` |
| Combined search | `search.all` | ✅ Full | `app/api/search/all/route.ts` fans out messages(FTS)+files+people with workspace-member check & barrier filtering; tested `__tests__/api/search-all.test.ts` | `v0.0.6-alpha` |
| People search | `users.list` (search) | ✅ Full | `app/api/search/users/route.ts` — `user_status` join fixed (was phantom presence), barrier `block_search` filter via `filterSearchBlocked`; tested `__tests__/api/search-users.test.ts` | `v0.0.6-alpha` |
| Channel search/discovery | `conversations.list` (search) | ✅ Full | `app/api/search/channels/route.ts` + `lib/messaging/searchChannels.ts` (public+org-wide, archived excluded, prefix-rank); consumed by `components/channels/ChannelBrowseModal.tsx:53`; tested | `v0.0.6-alpha` |
| `from:<user>` modifier | `search.messages` | ✅ Full | `searchEngine.ts:285` `u.username = $idx`; exact-username only (no `@me`/display-name) | `v0.0.6-alpha` |
| `in:<#channel>` modifier | `search.messages` | ✅ Full | `GlobalSearchModal.tsx:96` now sends `channel_name` (was broken `channel_id`); engine resolves against readable channels only (no private-channel leak); tested | `v0.0.6-alpha` |
| `before:<date>` modifier | `search.messages` | ✅ Full | `searchEngine.ts:308` `created_at < dayWindow.end` (inclusive of day, UTC); `tests/searchDateWindows.test.ts` 9/9 pass | `v0.0.6-alpha` |
| `after:<date>` modifier | `search.messages` | ✅ Full | `searchEngine.ts:317` `created_at >= dayWindow.start` (UTC); tested | `v0.0.6-alpha` |
| `on:<date>` modifier | `search.messages` | ✅ Full | `searchEngine.ts:292` `dayWindow()` whole-day window; parsed in `searchFilters.ts:51` + advanced route:60 + `GlobalSearchModal:99`; tested | `v0.0.6-alpha` |
| `during:<month/year>` modifier | `search.messages` | ✅ Full | `searchEngine.ts:300` `duringWindow()` handles YYYY and YYYY-MM; parsed `searchFilters.ts:51` + advanced:61 + `GlobalSearchModal:100`; tested | `v0.0.6-alpha` |
| `has:link` modifier | `search.messages` | ✅ Full | `searchEngine.ts:344` `m.body ~ 'https?://'` across all routes | `v0.0.6-alpha` |
| `has:<file/attachment>` modifier | `search.messages` | 🟡 Partial | `searchEngine.ts:334` EXISTS `file_attachments` WHERE `deleted_at=0`; still only generic file/attachment, no `has:image`/`video`/`star`/emoji granularity | `v0.0.6-alpha` |
| `has:pin` / `has:reaction` | `search.messages` | 🟡 Partial | Phantom-table bug FIXED: `searchEngine.ts:342` now `message_reactions`; pin via `pinned_messages:339`; still any-reaction not emoji-specific `has::thumbsup:` | `v0.0.6-alpha` |
| `is:thread` modifier | `search.messages` | ✅ Full | `searchFilters.ts:53` IS_RE parses `is:thread`; `GlobalSearchModal:102` appends; `searchEngine.ts:349` `root_id<>''`; advanced route:62 too | `v0.0.6-alpha` |
| `is:saved` / `is:pinned` / `is:dm` modifiers | `search.messages` | 🟡 Partial | `is:saved` (`engine:355` `saved_messages`) + `is:pinned` (`engine:353`) now parsed+implemented+reachable; `is:dm` still missing | `v0.2.0-alpha` |
| Saved searches (persist query) | — | ✅ Full | `app/api/saved-searches/route.ts` full CRUD owner-scoped+audited; PATCH adds `alerts_enabled`; tested; UI `components/search/SavedSearches.tsx` | `v0.0.6-alpha` |
| Saved-search alerts on new matches | — | ✅ Full | `lib/messaging/savedSearchAlerts.ts` re-runs AS OWNER with ms-watermark backlog drain; `worker.ts:468` self-rescheduling `saved_search_alerts` job; migration 035; bell toggle `SavedSearches.tsx:183`; tested | `v0.0.6-alpha` |
| Smart suggestions / autocomplete / typeahead | — | 🟡 Partial | `GlobalSearchModal` FILTER_SUGGESTIONS (modal:26) still static chips (`from/in/before/after/has` only, no `is:/on:/during:` chips); no recent-search history, no people/channel typeahead | `v0.2.0-alpha` |
| Result highlighting | `search.messages` | ✅ Full | Server-side `ts_headline` (`searchEngine.ts:377` HEADLINE_OPTS); rendered escaped via `<mark>` parsing in `GlobalSearchModal:154` + `SearchPanel:29` | `v0.0.6-alpha` |
| Sort by relevance | `search.messages` | ✅ Full | `searchEngine.ts:363` relevance\|recent\|oldest; `GlobalSearchModal:332` user-selectable sort toggle | `v0.0.6-alpha` |
| Sort by recency / pagination | `search.messages` | ✅ Full | `searchEngine.ts` `limit` clamp `MAX_LIMIT=50`, offset, `COUNT(*) total` returned; channels route also `limit+offset+total` | `v0.0.6-alpha` |

**Search & Discovery tally:** 22 behaviors — Full 17 · Partial 5 · Stub 0 · Missing 0 · Excluded 0

---

## 9. Files & Previews

Slack API methods: `files.upload`, `files.getUploadURLExternal`, `files.completeUploadExternal`, `files.list`, `files.info`, `files.delete`, `files.sharedPublicURL`, `files.revokePublicURL`, `files.remote.add`, `files.remote.update`, `files.remote.remove`, `files.remote.share`

| Behavior | Slack/MM method | Status | Note | Target (semver) |
|----------|-----------------|--------|------|-----------------|
| `files.upload` (legacy single-shot) | `files.upload` | ✅ Full | `app/api/files/upload/route.ts:73` — `storeFileBytes` (S3 or local), always inserts canonical `file_attachments` row (:87, migration 033 relaxed NOT NULLs), enforces scan policy cap (:43-52), fire-and-forget scan+index+thumbnail pipeline (:109). 50MB default cap (`uploadPolicy.ts:23`). Orphan-on-no-message issue gone | `v0.0.7-alpha` |
| `getUploadURLExternal` (new flow, pre-signed) | `files.getUploadURLExternal` | ✅ Full | `app/api/files/upload-sessions/route.ts:32` — `createUploadSession` returns `part_size` + session id + expiry; `lib/files/uploadSessions.ts:215` begins S3 multipart / local partial up front; audited (:57) | `v0.0.7-alpha` |
| `completeUploadExternal` (finalize + attach) | `files.completeUploadExternal` | ✅ Full | `app/api/files/upload-sessions/[id]/route.ts:88` `action=complete` → `completeUploadSession` (`uploadSessions.ts:477`): active-guarded claim, S3 `CompleteMultipartUpload`/local rename, INSERT `file_attachments` (:558), enqueue pipeline (:572), audit (:586) | `v0.0.7-alpha` |
| Resumable / multipart / chunked upload | — | ✅ Full | `uploadSessions.ts`: 8MB fixed parts (`PART_SIZE:72`), positional/out-of-order `appendPart` with optimistic-version concurrency (:346), 5GB ceiling (`MULTIPART_MAX_BYTES uploadPolicy.ts:26`), resume via GET status, 24h TTL sweep (`worker upload_session_sweep:534`). Tests in `tests/uploadSessions.test.ts` | `v0.0.7-alpha` |
| `files.list` (paginated, filtered) | `files.list` | ✅ Full | `app/api/files/route.ts:78` queries canonical `aaelink.file_attachments` (was phantom `files`); channel/user/type/date/search filters + paging; excludes `deleted_at<>0`; bearer `files:read` scope (:37). Test `__tests__/api/files.test.ts` | `v0.0.7-alpha` |
| `files.info` (single file) | `files.info` | ✅ Full | `app/api/files/route.ts:47-64` single-file branch reads `file_attachments` incl `width/height/duration_ms/thumbnail_key`; `serializeFile` maps Slack shape (:163). Phantom-table issue resolved | `v0.0.7-alpha` |
| `files.delete` | `files.delete` | ✅ Full | `app/api/files/route.ts:184` owner/admin RBAC (:219-223), soft-delete `file_attachments` (:229), revokes public links (:238), `removeFileObject` physical cleanup S3/disk (:247), `writeAuditLog` (:249). Bearer `files:write`+CSRF. Prior phantom-table + no-cleanup + no-audit gaps all closed | `v0.0.7-alpha` |
| Download / `url_private` serving | — | ✅ Full | `app/api/files/[id]/download/route.ts:55` — reads via storage abstraction (S3/local), D12 scan gate (:50), channel-membership check via `userCanReadChannel` (:41-46) — uploader/channel-read only. Active-content neutralized by `buildServeHeaders` (:64). Prior any-authed-user-fetch-any-id hole closed | `v0.0.7-alpha` |
| Thumbnails (server-generated) | — | ✅ Full | `lib/files/thumbnailJob.ts:139` `runFileThumbnail` sniffs dims (`imageMeta.ts` pure-JS) + generates WebP via `sharp` dynamic import (:91), stores derived bytes (`storage.ts storeDerivedBytes`), records `thumbnail_key`; served at GET `/api/files/preview?thumb=1` with ACL+scan gate. Enqueued on upload for `image/*` (`fileJobs.ts:92`) | `v0.0.7-alpha` |
| Image preview / lightbox | — | ✅ Full | `components/chat/ImageLightbox.tsx`, `components/media/AvatarLightbox.tsx`, `FilePreviewModal.tsx` wired; preview `render_hints` `can_lightbox` emitted (`preview/route.ts:139`) | `v0.0.7-alpha` |
| PDF preview | — | ✅ Full | `FilePreviewModal.tsx:92` renders PDF in iframe at file URL; download route now serves `file_attachments` bytes; wrong-table blocker gone | `v0.0.7-alpha` |
| Office (docx/xlsx/pptx) preview | — | 🟡 Partial | Office→PDF conversion only in documents subsystem (`app/api/documents/[id]/convert/route.ts`); no wiring from chat `file_attachments` to Stirling convert. Chat office files fall back to download | `v0.2.0-alpha` |
| Code / text preview w/ highlight | — | 🟡 Partial | `app/api/files/preview/route.ts` queries canonical `file_attachments`; emits `can_code_highlight` hint (:141) for code/text MIME. `file_index` extracts text; no client syntax-highlight renderer (hljs/prism) confirmed in `FilePreviewModal` | `v0.1.0-alpha` |
| Video preview / inline player | — | 🟡 Partial | `preview/route.ts:140` `can_player` hint against canonical table; `app/api/messages/clips` handles video w/ thumbnail+transcription. Generic chat-video inline player still hint-only (no dedicated player wired for `file_attachments` video) | `v0.1.0-alpha` |
| Audio preview / player | — | 🟡 Partial | Same as video: `can_player` hint over canonical `file_attachments`; clips subsystem covers audio. No dedicated chat-audio player wired to `file_attachments` beyond the hint | `v0.1.0-alpha` |
| 3D (gltf) / CAD (DWG) preview | — | ⛔ | BLUEPRINT-aspirational interactive viewers; no renderer or MIME mapping present. **Out of scope (deferred)** | TBD |
| File metadata (dims, duration, EXIF) | — | ✅ Full | `lib/files/imageMeta.ts` extracts width/height + EXIF orientation (PNG/JPEG/GIF/WebP/BMP, pure-JS); `thumbnailJob.ts:169` persists dims; `sharp .rotate()` strips EXIF on derived thumbnail (:119). `duration_ms` column exists but no audio/video extractor (chat path) | `v0.0.7-alpha` |
| File comments — list | — | ✅ Full | `app/api/files/comments/route.ts:53` `canReadFile` gate (uploader always; channel-attached requires `userCanReadChannel`; unattached private) — existence oracle closed; lists from `file_comments`, joins users | `v0.1.0-alpha` |
| File comments — add/edit/delete | — | ✅ Full | `app/api/files/comments/route.ts`: `verifyCsrf`:71 on POST; `canReadFile` gate on mutations:89; `writeAuditLog` `'file.comment.create'`(:105) / `'file.comment.edit'`(:117) / `'file.comment.delete'`(:130); edit/delete author-or-admin scoped | `v0.1.0-alpha` |
| `files.sharedPublicURL` (make public) | `files.sharedPublicURL` | ✅ Full | `app/api/files/[id]/public-link/route.ts:20` + `lib/files/publicLinks.ts:56`. Uploader-only, reuses active token, CSRF + audit. Test `__tests__/api/file-public-links.test.ts` | `v0.0.7-alpha` |
| `files.revokePublicURL` | `files.revokePublicURL` | ✅ Full | `app/api/files/[id]/public-link/route.ts:40` + `revokePublicLinks`. Uploader-only revoke-all, audited. Tested | `v0.0.7-alpha` |
| Public link resolution (no session) | — | ✅ Full | `app/api/files/public/[token]/route.ts:43` SERVES the actual bytes via `readFileBytes` (`resolvePublicLink` returns `storage_backend`, `publicLinks.ts:86`) with neutralized active-content headers; `?meta=1` for metadata-only. Scan gate + org toggle enforced. Test `file-public-bytes.test.ts`. Prior 'metadata only' gap closed | `v0.0.7-alpha` |
| Org-level public-sharing toggle | — | ✅ Full | `app/api/admin/file-sharing-policy/route.ts` + `getFileSharingPolicy`, default enabled, persisted in `system_config`. Tested | `v0.0.7-alpha` |
| Virus / malware scan (real engine) | — | 🟡 Partial | `lib/files/fileScanJob.ts` real clamd INSTREAM; clamd-down→pending (never silent clean). AUTO-enqueued on every upload (`fileJobs.ts:49` gated by `scan_on_upload`, default ON). **clamd daemon still NOT in `docker-compose.yml`** (no clamav service in grep). Auto-enqueue gap closed; bundled-daemon gap remains | `v0.0.7-alpha` |
| Scan access gate (block infected) | — | ✅ Full | `lib/files/scanGate.ts:193` `isFileAccessAllowed`; `block_infected` pinned non-configurable (:153); used by download (:50), thumbnail serve, public link. Tested `file-scan-gate.test.ts` | `v0.0.7-alpha` |
| Scan policy admin / queue view | — | ✅ Full | `app/api/files/scan/route.ts:32` admin summary + policy CRUD via `setScanPolicy` + manual enqueue; CSRF+audit on update (:109,:135). Two-policy-shape divergence resolved | `v0.0.7-alpha` |
| Retention / auto-delete of files | — | 🟡 Partial | `lib/enterprise/retentionEnforcer.ts` `buildFileHoldExclusion` + `retentionJob deleteFiles` now irreversibly purges `file_attachments` bytes past window, legal-hold-aware, scheduled. BUT `scan-policy auto_delete_infected_after_days` still only stored, not enforced (`scanGate.ts:81` 'future pass') | `v0.1.0-alpha` |
| File content search (search-inside) | `search.files` | ✅ Full | `app/api/search/files/route.ts:54` pg_tsvector over `file_index`, now POPULATED by `file_index` worker job auto-enqueued on every upload (`fileJobs.ts:82`, `fileIndexJob.ts:45` extracts text-like content). `ts_headline` highlights. Index no longer permanently empty | `v0.0.7-alpha` |
| External file refs (`files.remote.*`) | `files.remote.add` / `update` / `remove` / `share` | 🟡 Partial | `app/api/files/remote/route.ts:19,66` add/update/remove/share over `files_remote`. Schema drift FIXED — table now owned by `migrate.ts` (043, `workspace_id` added :4326). Still no workspace scoping in queries and no audit log on writes | `v0.1.0-alpha` |
| External storage (S3 / MinIO) | — | ✅ Full | `lib/files/storage.ts` unifies chat path on `lib/infra/s3` when `S3_ENDPOINT` set (`storeFileBytes`/`readFileBytes`/`removeFileObject`), backend recorded per-row (`storage_backend`, migration 034); falls back to local disk without S3 env. Multipart sessions use S3 multipart APIs | `v0.0.7-alpha` |

**Files & Previews tally:** 30 behaviors — Full 20 · Partial 9 · Stub 0 · Missing 0 · Excluded 1 (3D/CAD preview)

---

## 10. Calls & Huddles

Slack API methods: `calls.add`, `calls.end`, `calls.participants.add`, `calls.participants.remove`, `calls.update`

| Behavior | Slack/MM method | Status | Note | Target (semver) |
|----------|-----------------|--------|------|-----------------|
| Create call room (voice) | `calls.add` | ✅ Full | Real INSERT, auto-joins creator as host; `app/api/calls/rooms/route.ts:136-156`, `type=voice` default :117 | `v0.0.7-alpha` |
| Create video call | `calls.add` (video) | ✅ Full | `VALID_TYPES` incl. video (`rooms/route.ts:116`); `type=video` sets `video_on` default true :149 | `v0.0.7-alpha` |
| Start/join huddle (persistent ad-hoc) | — | ✅ Full | One active huddle per channel, returns existing with `already_exists`; `rooms/route.ts:120-131` | `v0.0.7-alpha` |
| Join call | `calls.participants.add` | ✅ Full | Capacity check + `room_full` 409 + ON CONFLICT DO NOTHING; `rooms/route.ts:202-226`; tested `calls-rooms.test.ts:86` | `v0.0.7-alpha` |
| Leave call | `calls.participants.remove` | ✅ Full | Sets `left_at`; `rooms/route.ts:228-234`; tested `calls-rooms.test.ts:100` | `v0.0.7-alpha` |
| End call | `calls.end` | ✅ Full | Host/`super_admin`-only (`rooms/route.ts:242-249`) + audit log :264 + idempotent :252; tested `calls-rooms.test.ts:189` | `v0.0.7-alpha` |
| List active/recent rooms | — | ✅ Full | `active_participants` subquery, LIMIT 50; `rooms/route.ts:77-99` | `v0.0.7-alpha` |
| Participant roster / peer discovery | — | ✅ Full | `listRoomParticipants` returns active participants w/ mute/video/screen flags; `lib/calls/signaling.ts:135` | `v0.0.7-alpha` |
| Mute / unmute toggle | — | ✅ Full | Gates real audio track: `useHuddleRtc.ts:218` `audioTracks.enabled=!next` + DB flag `rooms/route.ts:278`; media plane live | `v0.0.7-alpha` |
| Video on/off toggle | — | ✅ Full | Gates real video track: `useHuddleRtc.ts:231` `videoTracks.enabled=next` + DB flag `rooms/route.ts:286` | `v0.0.7-alpha` |
| Screen share toggle | — | ✅ Full | Real `getDisplayMedia` + `client.replaceVideoTrack` with renegotiation; `useHuddleRtc.ts:248-273` + DB flag `rooms/route.ts:294` | `v0.0.7-alpha` |
| WebRTC signaling relay (SDP offer/answer/ICE) | — | ✅ Full | Directed+broadcast routing, monotonic seq cursor, participant-gated, CSRF on POST; `lib/calls/signaling.ts:42,88` + `app/api/calls/[roomId]/signals/route.ts`. Still poll-based (no push) | `v0.0.7-alpha` |
| TURN/STUN/ICE credentials | — | ✅ Full | Ephemeral coturn HMAC creds, STUN-only graceful no-op when unconfigured; `lib/calls/turnCredentials.ts:54,68` + `app/api/calls/ice/route.ts:23` | `v0.0.7-alpha` |
| Client peer connection (media plane) | — | ✅ Full | Fully wired: `HuddleRtcClient` (`lib/calls/rtcClient.ts`) + `useHuddleRtc.ts` does `getUserMedia` :150, `RTCPeerConnection` :166, `fetchIce` :169, signal poll/send :174-185; `HuddlePanel` rendered `ModuleRenderer.tsx:178`; 29 unit tests | `v0.0.7-alpha` |
| SFU (mediasoup / LiveKit) for group calls | — | ⛔ | env-blocked: still mesh-only (`rtcMesh.ts`), no mediasoup/livekit dep in `package.json`; **external media infra, out-of-scope** | `v1.0.0` |
| Call recording | — | 🟠 Stub | `recording` column + admin `recording_enabled` config + UI REC badge (`HuddlePanel.tsx:122`) only; no recorder/`MediaRecorder`, no storage pipeline in `lib/` | `v1.0.0` |
| Transcription | — | ⛔ | AI/ML: worker handler still `await sleep(2000)` stub, comment 'send to Whisper'; `lib/infra/worker.ts:167-172`; **STT is standing AI/ML out-of-scope** | `v1.0.0` |
| Clips: create (video/audio/screen) | — | ✅ Full | Real INSERT + type validation; enqueues transcription job only when no transcript supplied; `app/api/messages/clips/route.ts:76-130` | `v0.0.7-alpha` |
| Clips: list / view tracking | — | 🟡 Partial | List w/ channel/mine/type filters works (`clips/route.ts:27-74`); `views` column read but still no increment endpoint | `v0.1.0-alpha` |
| Clip auto-transcription | — | ⛔ | AI/ML: job enqueued correctly (`clips/route.ts:120`) but `worker.ts:167` handler is `sleep(2000)` stub; **STT out-of-scope** | `v1.0.0` |
| Clip thumbnail generation | — | 🟡 Partial | Client-supplied `thumbnail_url` only (`clips/route.ts:88,113`); `file_thumbnail` job is for file uploads, not clips; no server clip thumbnail pipeline | `v0.1.0-alpha` |
| Admin calls config (TURN/STUN, max participants, recording) | — | ✅ Full | `view=config` (`rooms/route.ts:45`) + `update_config` `super_admin`-gated :178-198, persisted to `system_config`; reports `turn_configured` w/o leaking secret | `v0.0.7-alpha` |
| In-call reactions / live captions / raise hand | — | 🔴 Missing | Reactions still client-only local state (`HuddlePanel.tsx:68` `fireReaction`/`floatingReactions`, no `redisPubSub`/signaling broadcast); no live captions, no raise-hand | `v1.0.0` |

**Calls & Huddles tally:** 23 behaviors — Full 16 · Partial 2 · Stub 1 · Missing 1 · Excluded 3 (SFU, transcription, clip-transcription)

---

## 11. Knowledge (Canvas, Lists, Wiki)

Slack API methods: `canvases.create`, `canvases.edit`, `canvases.delete`, `canvases.access.set`, `canvases.access.delete`, `conversations.canvases`, `canvases.sections.lookup`

| Behavior | Slack/MM method | Status | Note | Target (semver) |
|----------|-----------------|--------|------|-----------------|
| Create canvas (standalone / personal) | `canvases.create` | ✅ Full | POST `app/api/docs/canvas/route.ts:133` — `verifyCsrf:134` + `writeAuditLog` 'canvas.create':218; block/word counts computed; `parseBlocks` stamps ids | `v0.0.7-alpha` |
| Edit canvas content (block model) | `canvases.edit` | 🟡 Partial | PUT `route.ts:238` enforces `canWrite` + CSRF:239 + audit:309; main PUT is still whole-doc replace with no optimistic-concurrency guard (granular concurrency only via sections route) | `v0.1.0-alpha` |
| Delete canvas | `canvases.delete` | ✅ Full | DELETE handler added `app/api/docs/canvas/route.ts:322`; creator-or-platform-admin gate:345-347, soft-delete tombstone, CSRF+audit 'canvas.delete':356 | `v0.0.7-alpha` |
| Channel canvas (canvas embedded in channel) | `conversations.canvases` | ✅ Full | reads now gated by `userCanReadChannel` (`canvasAccess.ts:121-123`; `route.ts:88`), list predicate enforces channel membership (`canvasAccess.ts:219-235`) — private-channel leak closed | `v0.0.7-alpha` |
| `conversations.canvases` (canvas linked to a conversation) | `conversations.canvases` | ✅ Full | consolidated onto `aaelink.canvases` as `channel_canvas` (`route.ts:49-58`); migration036 retired `conversation_canvases`; `userCanReadChannel` gate:45,95; CSRF+audit | `v0.0.7-alpha` |
| `canvases.access` — set/grant access | `canvases.access.set` | ✅ Full | `access/route.ts:66` set is now ENFORCED — `canvasAccess.resolveCanvasAccess:134-159` reads `canvas_access` grants; admin-gated via `canAdministerCanvas:50`; CSRF+audit | `v0.0.7-alpha` |
| `canvases.access` — revoke access | `canvases.access.delete` | ✅ Full | `access/route.ts:94` delete is type-scoped (`grantee_type` matched:103,109) and effective since the table is read by the access engine; CSRF+audit | `v0.0.7-alpha` |
| `canvases.access` — lookup access list | — | ✅ Full | `access/route.ts:54` lookup now admin-gated (`canAdministerCanvas:50`) and reflects the now-enforced grant table | `v0.0.7-alpha` |
| Canvas sections — create/update/delete/reorder | `canvases.sections.lookup` | ✅ Full | sections now operate ON `content_blocks` (`canvasSections.ts`); canvas GET and sections agree; access via `resolveCanvasAccess` (`sections/route.ts:116-120`); optimistic concurrency `expected_updated_at`; CSRF+audit | `v0.0.7-alpha` |
| Canvas templates | — | ✅ Full | instantiate-from-template: POST `from_template_id` → `resolveTemplateBlocks` copies blocks server-side (`route.ts:168-175`; `canvasAccess.ts:294`); templates now workspace-scoped not global | `v0.0.7-alpha` |
| Canvas sharing via `shared_with` | — | ✅ Full | `shared_with` jsonb still the read-share path (`canvasAccess.ts:126`; `canvasListReadPredicate:214`); widening `shared_with` now requires `canAdministerCanvas` (`route.ts:276`) | `v0.0.7-alpha` |
| Canvas pin | — | 🟡 Partial | `is_pinned` stored/updatable (`docs/canvas/route.ts:269`); still no dedicated pinned-canvas listing or channel-tab surfacing | `v0.1.0-alpha` |
| Canvas realtime collaboration | — | 🟡 Partial | `emitKnowledgeEvent` fires on canvas create/update/delete (`route.ts:227,314,361`) via `channel_update` pub/sub; refetch signal only — no live cursors/presence/co-edit; channel-less canvases no-op (`knowledgeRealtime.ts:63`) | `v0.2.0-alpha` |
| Canvas version history | — | 🔴 Missing | No version/revision columns on `aaelink.canvases` (`migrate.ts:1446`; no `canvas_revision`/version table); only `updated_at`/`last_edited_by` | `v0.2.0-alpha` |
| Create list (custom columns) | — | ✅ Full | POST `action=create_list` `lists/route.ts:146` default+custom columns, `view_type` stored; CSRF:124 + audit 'list.create':164 | `v0.0.7-alpha` |
| List field/column types | — | 🟡 Partial | Column type still free-string, not validated server-side; values opaque JSON (`lists/route.ts:135`; `listAccess.addColumn:81`) — no select-option validation | `v0.1.0-alpha` |
| Add/update/delete list item (row) | — | ✅ Full | add/update/`delete_item` `lists/route.ts:169-249` with `resolveItemWriteAccess`; CSRF + realtime `emitKnowledgeEvent` on each mutation | `v0.0.7-alpha` |
| Add column | — | ✅ Full | `action=add_column` `lists/route.ts:251` → `listAccess.addColumn:81`; write-access gated (`resolveListWriteAccess:203`) + audit 'list.column_add':256 + realtime | `v0.0.7-alpha` |
| Update / delete column | — | ✅ Full | `update_column`/`delete_column` now implemented (`lists/route.ts:261,274` → `listAccess.updateColumn:94`/`deleteColumn:133`); rename carries item values, delete strips key; audit+realtime | `v0.0.7-alpha` |
| List item comments / threads | — | ✅ Full | `app/api/lists/items/[itemId]/comments/route.ts` + `lib/lists/itemThreads.ts`; CSRF:38,55, `resolveItemAccess` channel-aware:21, author/list-creator delete:123; still no audit/realtime on comments | `v0.0.7-alpha` |
| List access control / per-list permissions | — | ✅ Full | GET `/api/lists` enforces access: single-list creator-or-channel-reader gate (`lists/route.ts:70-72`), list-all scoped to channel-reader or own lists (94-107) — unauthenticated-read gap closed | `v0.0.7-alpha` |
| List realtime updates | — | 🟡 Partial | `emitKnowledgeEvent` wired on list/item create/update/delete (`lists/route.ts:177,194,219,244`) via `channel_update`; channel-less lists have no consumer so no emit (`knowledgeRealtime.ts:63`); refetch signal not live patching | `v0.1.0-alpha` |
| Wiki / Knowledge Base CRUD | — | 🟡 Partial | Full RBAC: author/admin gate (`articles/[id]/route.ts:81` `canManageArticle`), workspace-membership gate, audit + CSRF on all writes, category DELETE added; still no versioning and no full-text search | `v0.0.6-alpha` |

**Knowledge tally:** 23 behaviors — Full 16 · Partial 6 · Stub 0 · Missing 1 · Excluded 0

---

## 12. Notifications & Presence

Slack API methods: `users.setPresence`, `users.getPresence`, `dnd.setSnooze`, `dnd.endSnooze`, `dnd.info`, `dnd.teamInfo`, `users.profile.set` (status)

| Behavior | Slack/MM method | Status | Note | Target (semver) |
|----------|-----------------|--------|------|-----------------|
| Per-channel notification level (all/mentions/nothing) | — | ✅ Full | level now authoritative on send path: `notifyChannelLevelAll` (`level='all'` every-message alert) + `dropLevelNothing` (`level='nothing'` drops in-app+push) wired in `messages/route.ts:584`; `pushTargeting.ts:44` also suppresses push on `level='nothing'` | `v0.0.5-alpha` |
| Per-channel mute | — | ✅ Full | Both stores honored via UNION in `pushTargeting.ts:42-49` (`channel_notification_prefs.muted` + `channel_mutes`). Suppresses push | `v0.0.5-alpha` |
| Mute suppresses in-app (not just push) | — | 🟡 Partial | `notifyChannelMentions` (`notificationsServer.ts:102`) only calls `dropLevelNothing`, not `dropMuted`; muted member still gets in-app mention row. `dropMuted` is only applied to `level='all'` path (line 232) | `v0.1.0-alpha` |
| DND schedule (daily window) | `dnd.info` | ✅ Full | TZ-aware `dndWindow.ts` honored for push at `pushTargeting.ts:71`. `dnd/route.ts:176` still has its own TZ-less `isDndActiveNow` (`_timezone` ignored) — divergence persists | `v0.0.6-alpha` |
| DND snooze (set N minutes) | `dnd.setSnooze` | ✅ Full | `dnd/route.ts:127` POST `snooze_until`; honored at push time `pushTargeting.ts:67` (`snooze_until > now`) | `v0.0.6-alpha` |
| DND end snooze | `dnd.endSnooze` | ✅ Full | `dnd/route.ts` `action=end_snooze` resets `snooze_until=0` | `v0.0.6-alpha` |
| DND info / is_active | `dnd.info` | 🟡 Partial | GET at `dnd/route.ts:70` computes `isActive` via route-local TZ-less `isDndActiveNow` (line 176, `_timezone` unused) — still disagrees with TZ-aware `dndWindow` used by push | `v0.0.6-alpha` |
| DND suppresses push delivery | `dnd.info` | ✅ Full | `pushTargeting.ts:50-74` drops snooze + enabled-schedule users at enqueue | `v0.0.6-alpha` |
| DND suppresses in-app notification | — | 🟡 Partial | DND only filters push targets (`selectPushTargets`); in-app notification rows still inserted unconditionally in `notificationsServer.ts insertNotifications` | `v0.1.0-alpha` |
| Keyword / highlight words (store) | — | ✅ Full | Consolidated to single system: old `app/api/keywords` route removed (`user_keywords` DEPRECATED table `migrate.ts:895`); `notification_keywords` route is sole CRUD with CSRF (`notifications/keywords/route.ts:32,47`) | `v0.0.7-alpha` |
| Keyword highlight fires a notification | — | ✅ Full | `matchKeywords` invoked via `notifyKeywordMatches` (`notificationsServer.ts:172`) wired on production send path at `messages/route.ts:571`; inserts 'keyword' notification + push | `v0.0.7-alpha` |
| @user mentions notify | — | ✅ Full | `notifyChannelMentions` (`messages/route.ts:546`) resolves `@username`→members, RBAC via `userCanReadChannel`, mention-pref gated (`notificationsServer.ts:90-118`) | `v0.0.5-alpha` |
| @here / @channel / @everyone | — | ✅ Full | `parseBroadcastMentions` (`mentionParse.ts:14`) + `notifyBroadcastMentions` (`notificationsServer.ts:483`) wired at `messages/route.ts:558`; `@here`=online-only, `@channel`/`@everyone`=all members, channel `allow_broadcast_mentions` + user `broadcast_mentions_enabled` gates (migration 045) | `v0.0.5-alpha` |
| Mention notification pref toggle | — | ✅ Full | `filterUsersForNotification(...,'mentions')` applied in `notificationsServer.ts:94`; `mentions_enabled` server-enforced | `v0.0.5-alpha` |
| DM notifications (notify all recipients) | — | ✅ Full | `notifyDirectMessage` wired at `messages/route.ts:534` (D/G channels); in-app dm rows + high-priority push gated by `selectPushTargets` (mute/DND) | `v0.0.3-alpha` |
| Custom status (emoji + text) | `users.profile.set` | ✅ Full | user-status route PUT writes `status_text`/`emoji` + `user_status` row | `v0.0.5-alpha` |
| Status auto-clear / expiry | — | 🟡 Partial | `expires_at` stored + `user-status/expire` route resets it; still client-driven (`useStatusExpiry.ts` polls every 60s) — no server scheduled job for status expiry | `v0.1.0-alpha` |
| Presence status (online/away/dnd/offline) | `users.setPresence` / `users.getPresence` | 🟡 Partial | Manual status stored via `user-status` PATCH; away/online derivation still client-side; presence stream emits only `last_seen_at` | `v0.1.0-alpha` |
| Presence heartbeat + online derivation | — | ✅ Full | `collab/presence/route.ts:17-18` updates `last_seen_at` + `emitPresence` always `status='online'` (line 35); away/idle/DND on consumer | `v0.0.3-alpha` |
| Presence fan-out stream | — | 🟡 Partial | `collab/presence/stream/route.ts` still re-queries all workspace users, 10s poll, emits `last_seen_at` map only — no status/dnd/away, no diffing | `v0.1.0-alpha` |
| `user_status='dnd'` suppresses server notifications | — | 🟡 Partial | Manual `status='dnd'` now suppresses PUSH (`pushTargeting.ts:78-84`, respects `expires_at`); in-app notifications still inserted; push-only suppression | `v0.1.0-alpha` |
| Push token registration (APNS/FCM/Web) | — | ✅ Full | `notifications/push/route.ts:129` upsert by token; unregister sets `is_active=false` (line 133) | `v0.0.7-alpha` |
| Push delivery (real) | — | ⛔ | env-blocked (APNS): `pushDelivery.ts:163-165` skips APNS tokens (`skipped_apns`), no HTTP/2 client without new dep; FCM + Web Push real. **APNS requires external dep** | `v1.0.0` |
| Auto-push on mention/DM | — | ✅ Full | `selectPushTargets`+`enqueuePush` invoked in every `notify*` fn (`notificationsServer.ts:121,199,251,298,572`); high-priority, mute+DND filtered | `v0.0.7-alpha` |
| Admin push policy / quiet hours | — | 🟠 Stub | `push_policy` CRUD persists `quiet_hours_*`/`max_rate` (`push/route.ts:62-70,200`), but `push_policy` is read nowhere at enqueue/deliver (grep: only `push/route.ts` references it) — `pushTargeting.ts`/`pushDelivery.ts` never consult it. Unenforced | `v0.1.0-alpha` |
| Email notifications (per-event) | — | 🟡 Partial | `notifications/email/route.ts` queues to `email_queue` keyed by type, gated only on `prefs.email` on/off (line 72) — no per-type granularity; worker consumes queue | `v0.0.7-alpha` |
| Email digest (hourly/daily/weekly) | — | 🟡 Partial | Digest now real: `lib/notifications/emailDigest.ts runEmailDigests`, scheduled as self-rescheduling worker job (`worker.ts:503-526`, seeded migration 039) with watermark (migration 042). Frequency is off/daily/weekly only — no hourly/realtime per BLUEPRINT §2.1.5 | `v0.1.0-alpha` |
| Notification schedule (active hours / weekday-only) | — | 🟠 Stub | `notificationSchedule.evaluateNotification` still client-only (reads `localStorage`); server dispatch (`notificationsServer.ts`) never consults active-hours/weekday | `v0.2.0-alpha` |
| Mark channel/thread/ticket as read | — | ✅ Full | `notifications/route.ts:61` PATCH `mark_channel`/`thread`/`ticket`/`read_all`; `collab` read-state on unified `channel_read_state` | `v0.0.3-alpha` |
| Mark message as unread | — | ✅ Full | `collab/mark-unread/route.ts:42` writes `channel_read_state` (was `read_state`); migration 028 backfills then DROPs `aaelink.read_state`; all consumers use `channel_read_state` | `v0.0.3-alpha` |

**Notifications & Presence tally:** 30 behaviors — Full 18 · Partial 9 · Stub 2 · Missing 0 · Excluded 1 (APNS push)

---

## 13. Admin & Compliance

Slack API methods: `admin.users.list`, `admin.users.invite`, `admin.conversations.*`, `admin.teams.*`, `admin.roles.*`, `admin.barriers.*`

| Behavior | Slack/MM method | Status | Note | Target (semver) |
|----------|-----------------|--------|------|-----------------|
| List users | `admin.users.list` | ✅ Full | `app/api/admin/users/route.ts:22-23` LIMIT 500, no cursor/pagination; role-gated GET | `v0.0.2-alpha` |
| Create user | `admin.users.invite` | ✅ Full | `app/api/admin/users/route.ts:30-95` — role-gated, password policy, audited, auto-join default channels | `v0.0.2-alpha` |
| Update user / set role | `admin.users.setAdmin` | ✅ Full | `app/api/admin/users/route.ts:103-184` — role escalation guarded, cannot_demote_self, audited | `v0.0.2-alpha` |
| Deactivate / suspend user | `admin.users.setInactive` | 🟡 Partial | Still SCIM-only soft-delete (`app/api/scim/v2/Users/route.ts` `scim_active`); no admin-UI deactivate/reactivate endpoint | `v0.0.7-alpha` |
| Custom roles / RBAC | `admin.roles.*` | 🟡 Partial | `app/api/admin/roles/route.ts` + `lib/auth/customRoles.ts` CRUD present; still not enforced as ReBAC — runtime gates key off `platform_role`/`isPlatformAdmin` | `v0.2.0-alpha` |
| Role assignments | `admin.roles.*` | 🟡 Partial | `app/api/admin/roles/assignments/route.ts:7,28` `assignRole`/`listAssignments` present; authz not keyed off custom roles | `v0.2.0-alpha` |
| List orgs / teams | `admin.teams.list` | ✅ Full | `app/api/admin/org/route.ts` + `org/[orgId]/*` (workspaces/domains/identity/shared-channels/profile-fields) all present | `v0.0.7-alpha` |
| Org workspaces management | `admin.teams.*` | ✅ Full | `app/api/admin/org/[orgId]/workspaces/route.ts` present (listing/attach under org) | `v0.0.7-alpha` |
| Org domains / claiming | — | ✅ Full | Real DNS TXT verification: `domains/route.ts:2` imports `node:dns` `resolveTxt`, PATCH calls `verifyDomain(pool,orgId,domain,realResolver)` (line ~113); `domainClaiming.ts` `verificationRecord`/`claimDomain`/`verifyDomain` | `v0.0.7-alpha` |
| Org identity / SSO binding | — | 🟡 Partial | `identity/route.ts` stores config; inbound engine real — `app/api/auth/sso/saml/{start,acs,refresh}` + `oidc/{start,callback}` + `lib/auth/samlMetadata` | `v0.0.x` |
| Shared / connected channels | `admin.conversations.setTeams` | 🟡 Partial | `connectAllowlist.ts` only stores `connect_allowlist` rows (insert/delete/status); still no external-org handshake/federation transport | TBD |
| Custom profile fields | — | ✅ Full | `app/api/admin/org/[orgId]/profile-fields/route.ts` + `lib/enterprise/customProfileFields.ts` real | `v0.0.7-alpha` |
| Channel management (admin) | `admin.conversations.*` | 🟡 Partial | `channel-archival/route.ts` (inactivity preview/execute) real; channels/rename + `channels/[id]/convert` + `search/channels` exist; no `admin.conversations setTeams`/bulk-move parity | `v0.1.0-alpha` |
| Set channel retention | `admin.conversations.setConversationRetention` | 🟠 Stub | `admin/retention/route.ts:64` scope-only ('workspace','channel','dm','file'); no `channel_id` / `setCustomRetention` / `getCustomRetention` per-individual-channel | `v0.2.0-alpha` |
| Retention policy CRUD | — | ✅ Full | `admin/retention/route.ts` GET/PUT, 4 scopes, enabled, delete_files, `isPlatformAdmin`-gated, audited | `v0.0.7-alpha` |
| Retention enforcement (delete) | — | ✅ Full | worker `retention_enforce` (`worker.ts:119-126`) delegates to `runRetentionEnforcement`→`buildHoldExclusion` (hold-aware); route `admin/retention/enforce/route.ts:41-42` also delegates to `runRetentionEnforcement` (hold-aware) with `verifyCsrf`:23 + `isPlatformAdmin` gate:36 + audit `'retention.enforce'`:61 | `v0.0.7-alpha` |
| Legal hold create/list/release | — | ✅ Full | `compliance/legal-holds/route.ts` GET/POST/PATCH/DELETE, `isPlatformAdmin`-gated (lines 33,76,135), `super_admin` for delete; hold overrides retention engine-side | `v0.0.7-alpha` |
| DLP rules CRUD | `admin.barriers.*` | ✅ Full | `compliance/dlp/route.ts` GET/POST/PUT; `isPlatformAdmin`-gated (line 39). Rule types pattern/keyword/file/domain/pii | `v0.0.7-alpha` |
| DLP enforcement on send | — | ✅ Full | `applyDlpToMessage` called synchronously pre-persist in `messages/route.ts:482-484` (`dlp_blocked` 403), `messages/[id]/route.ts:129`, `messages/forward/route.ts:97`; block/quarantine reject, redact masks. Was post-hoc only | `v0.0.x` |
| Information barriers / ethical walls | `admin.barriers.*` | ✅ Full | `barrierGuard` enforced on production paths: `conversations/open/route.ts:52` + `members:115`, `channels/join:49`, `search/users+all+directory` via `filterSearchBlocked` (`block_search`), `messages/attachments:97` (`block_file_share`). Was config-only | `v0.0.x` |
| eDiscovery export create/list | — | ✅ Full | `compliance/ediscovery/route.ts` `isPlatformAdmin`-gated + worker `compliance_export`→`runComplianceExport` builds JSON/CSV artifact to S3 | `v0.0.7-alpha` |
| eDiscovery MBOX / native format | — | 🟡 Partial | `complianceExport.ts:62-66` only json/csv branch; mbox request silently degrades to JSON. No EML/MBOX, no file bundling | `v0.2.0-alpha` |
| eDiscovery scoped by custodian/keyword | — | 🟡 Partial | `complianceExportJob.ts:47-51` applies only date(`from`/`to`)+`channel_ids`; custodian/keyword/legal_hold/include_files in scope JSON still not applied to artifact | `v0.2.0-alpha` |
| Audit log read/search | — | ✅ Full | `admin/audit-log/route.ts` `isPlatformAdmin`-gated (line 31), filters action/actor/from/to, paginated; `tracedRoute` chokepoint | `v0.0.7-alpha` |
| Audit log streaming/export | — | 🟡 Partial | `audit-log/export` + `audit-log/stream` (SSE) + `audit-streams` (SIEM config) + worker `audit_stream` present; no per-event schema/guaranteed-delivery replay | `v0.2.0-alpha` |
| Data residency / region pinning | — | 🟠 Stub | `admin/data-residency/route.ts` GET/PUT `isPlatformAdmin`-gated (it_admin admitted); still pure metadata, no storage routing — region config stored in `system_config` but no write routing to actual storage backends | `v1.0.0` |
| Encryption at rest config | — | 🟠 Stub | `admin/encryption/route.ts` still fake keys `sha256:${randomUUID().slice}` (lines 115,137); rotate/create write rows only, no KMS. `super_admin`-only | `v1.0.0` |
| Field-level / message encryption | — | 🔴 Missing | `encryption/route.ts:53` `field_level_encryption=['messages.content','files.content']` declared in config only; no crypto applied to content | `v1.0.0` |
| Guest / external user accounts | — | 🟡 Partial | `admin/guests/route.ts` create/list/revoke + `expires_at` stored; worker has NO `guest_expire` handler (grep count 0) — only referenced in `jobs/route.ts:37` comment. No scheduled expiry enforcement | `v0.0.7-alpha` |
| SCIM v2 provisioning | — | ✅ Full | `scim/v2/Users` + Groups routes + `lib/auth/scim.ts`; create/update/deactivate(`scim_active`), org-scoped via `bearer_token_hash` | `v0.0.x` |
| IP allowlist / access control | — | 🟡 Partial | `admin/ip-access/route.ts` stores config; `lib/auth/ipAccess.ts` only has parsing helpers (`ipMatchesCidr`/`extractClientIp`), no allowlist gate. `middleware.ts:80-86` uses ip for rate-limit, not allowlist enforcement. Buggy `platform_admin` check too | `v0.2.0-alpha` |
| Session policy / forced logout | — | 🟡 Partial | `admin/session-policy/route.ts` (buggy `['super_admin','platform_admin']` line 35) + `admin/sessions` list/revoke present | `v0.0.7-alpha` |
| Device management / remote wipe | — | 🟡 Partial | `admin/devices/route.ts` + `devices/[id]/wipe` + `emm-policy` present; wipe is a flag, no MDM push. Buggy `platform_admin` check (lines 38,137,173) | `v0.0.7-alpha` |
| HIPAA / FINRA compliance mode | — | 🔴 Missing | No `compliance_mode`/`hipaa_mode`/`finra_mode`/WORM toggle in `lib/` or `app/`; HIPAA/FINRA still only computed display booleans in `encryption/route.ts`. `audit_log` rows mutable, retention hard-DELETEs | `v1.0.0` |
| IDP group → role mapping | — | 🔴 Missing | `scim/v2/Groups/route.ts` manages `user_groups` membership only; no group→platform/custom-role grant mapping | `v1.0.0` |

**Admin & Compliance tally:** 35 behaviors — Full 16 · Partial 13 · Stub 3 · Missing 3 · Excluded 0

---

## 14. Integrations & Extensibility

Slack API methods: `chat.postMessage` (incoming webhook), `webhooks.create`, `oauth.v2.access`, `apps.connections.open`, `views.open`, `views.push`, `views.update`, `views.publish`, `workflows.stepCompleted`, `workflows.stepFailed`, `functions.completeSuccess`, `functions.completeError`

| Behavior | Slack/MM method | Status | Note | Target (semver) |
|----------|-----------------|--------|------|-----------------|
| Incoming webhook — create/manage | — | ✅ Full | `webhooks/route.ts`: POST `verifyCsrf`:75 + owner/admin workspace RBAC:103 + audit `'incoming_webhook.create'`:122; GET workspace-membership gate:52; `[id]/route.ts` DELETE `verifyCsrf`:11 + owner/admin/platform_admin gate:40-52 + audit `'incoming_webhook.delete'`:63 | `v0.0.4-alpha` |
| Incoming webhook — public receiver (post to channel) | — | 🟡 Partial | `app/api/webhooks/[token]/route.ts:66-78` still emits realtime via raw notifications INSERT (not `lib/realtime/redisPubSub`, Hard Rule #6); reads `incoming_webhooks` only; no inbound signature verification | `v0.0.4-alpha` |
| Incoming webhook — Slack-compatible payload (`text`/`attachments`/`username`/`icon`) | — | 🟡 Partial | `app/api/webhooks/[token]/route.ts:32` accepts `text`/`username`/`icon_url` only; `attachments`/`blocks` still ignored; bot identity in message metadata not a real bot user | `v0.1.0-alpha` |
| Outgoing webhook — subscription CRUD | — | 🟡 Partial | `app/api/webhooks/v2/route.ts` full CRUD + secret-once + event filter; RBAC creator-or-platform-admin (`route:114-115`), not workspace-scoped | `v0.0.4-alpha` |
| Outgoing webhook — fire on real events | — | 🟡 Partial | `emitWebhookEvent` now WIRED on production paths: `messages/route.ts:510,613` (create/broadcast), `messages/[id]:270` (delete), `reactions:95` (add/remove), `interactivity:117`; but channel.created/archived, file.uploaded, user.*, compliance.dlp_violation, call.* write paths still emit nothing | `v0.1.0-alpha` |
| Outgoing webhook — HMAC-SHA256 signing | — | ✅ Full | `webhookEmitter.ts:45-47` signs `sha256=…`; worker sets `X-AAELink-Signature-256` (`worker.ts event_deliver`/`webhook_deliver`); verify route present | `v0.0.4-alpha` |
| Outgoing webhook — retry w/ backoff + timeout | — | ✅ Full | `worker.ts webhook_deliver:217` + `webhook_retry:93` with 10s `AbortController` timeout, throws to retry; now exercised by real message/reaction events via emitter wiring | `v0.0.4-alpha` |
| Outgoing webhook — dead letter queue | — | ✅ Full | `app/api/admin/webhook-dlq/route.ts` + `lib/webhooks/webhookDlq.ts` + tests present and coherent | `v0.0.4-alpha` |
| Outgoing webhook — delivery log / debug | — | ✅ Full | `webhookEmitter.ts:127` logs `webhook_deliveries_v2` row per delivery (request_body/status/latency); `app/api/webhooks/deliveries/route.ts` present | `v0.0.4-alpha` |
| Outgoing webhook — test/ping | — | ✅ Full | `app/api/webhooks/v2` `action:'test'` + `app/api/webhooks/test/route.ts` send signed test event | `v0.0.4-alpha` |
| Slash command — registry (custom commands) | — | 🟡 Partial | `app/api/slash-commands/route.ts` `action:'register'` (route:106) admin-only into `slash_commands` w/ `callback_url`+`signing_secret`+SSRF guard at register (route:134); built-in conflict list route:34-40 | `v0.0.6-alpha` |
| Slash command — built-in commands | — | ✅ Full | `app/api/slash-commands/route.ts` switch executes `/shrug` `/dnd` `/status` `/topic` etc server-side; `lib/comms/slashCommands.ts`; well tested | `v0.0.6-alpha` |
| Slash command — dispatch to external `callback_url` | — | ✅ Full | `slash-commands/route.ts` default case:288 → `dispatchCustomCommand:331` POSTs Slack-shaped HMAC-signed payload to `callback_url` with SSRF+DNS-rebind guards (347-360), 10s timeout, audit | `v0.0.6-alpha` |
| Slash command — `response_url` / delayed responses | — | 🔴 Missing | `dispatchCustomCommand` payload still sets `response_url:null` (route:371); responses remain synchronous JSON only | `v0.2.0-alpha` |
| Bot users — manage / tokens | — | ✅ Full | `app/api/integrations/bots/route.ts` platform-admin CRUD of `bot_users`; bot tokens (`xbot-*`) now authenticate inbound API calls via `lib/api/oauthScopes.ts` `resolveBotToken:139` invoked by `enforceScope:204` — gap closed | `v0.0.7-alpha` |
| Bots — `bots.info` parity | `bots.info` | 🟡 Partial | `app/api/bots/info/route.ts:27,49` still reads `users WHERE platform_role='bot'` — disconnected from `bot_users` model; two bot notions unbridged | `v0.1.0-alpha` |
| OAuth — app registration | `oauth.v2.access` | 🟡 Partial | OAuth apps in `oauth_apps` via `integrations/bots` + `apps/manifest`; authorize/access read `oauth_apps` with `client_id`/`redirect_uris`/`scopes`; still no dedicated app console | `v0.0.7-alpha` |
| OAuth — authorization code → token exchange | `oauth.v2.access` | ✅ Full | `app/api/oauth/authorize/route.ts` issues single-use 10min code bound to user/client/redirect_uri/scope (CSRF+audit); `access/route.ts:87-185` verifies hashed `client_secret` (constant-time), atomic code consume w/ full binding, no dev backdoor | `v0.0.7-alpha` |
| OAuth — token introspection / info | — | ✅ Full | `app/api/oauth/introspect/route.ts` resolves grant via `oauthScopes`, returns `active`/`scope`/`exp`/`token_type`; expiry enforced | `v0.0.7-alpha` |
| OAuth — token revoke / rotate | `auth.revoke` | ✅ Full | `oauth/access` `action:'revoke'` DELETEs token; `app/api/oauth/rotate/route.ts:37` `rotateToken` (owner-or-admin) mints new token from real grant lifecycle | `v0.0.7-alpha` |
| OAuth scopes — defined catalog + enforcement | — | 🟡 Partial | `lib/api/oauthScopes.ts` `enforceScope:189` genuinely gates bearer routes (messages `chat:read`/`write:63,453`; files; channels; users/directory) resolving bot+oauth tokens; enforcement real but only a subset of privileged routes wired | `v0.1.0-alpha` |
| Events API — subscription management | — | 🟡 Partial | `app/api/integrations/events/route.ts` platform-admin CRUD (`route:129/170/273`) of `event_subscriptions` w/ HTTPS endpoint+`signing_secret`+filter; registry real | `v0.0.7-alpha` |
| Events API — actually deliver events on activity | — | 🟡 Partial | `webhookEmitter.ts` `fanOutEventSubscriptions:193` fans real message/reaction/interaction emits to active+verified subs → 'event_deliver' jobs; `worker.ts:257` delivers signed w/ retry; `url_verification` handshake present; BUT channel/file/user/DLP/call paths still never emit | `v0.1.0-alpha` |
| Socket mode — open connection (ticket + WSS URL) | `apps.connections.open` | 🟡 Partial | `app/api/apps/connections/open/route.ts:32` `openSocketConnection` mints ticket+WSS URL from `bot_users` token into `socket_connections`; clean open step | `v0.2.0-alpha` |
| Socket mode — gateway validates ticket + streams events | — | 🟠 Stub | `resolveSocketTicket`/`closeSocketConnection` in `lib/apps/socketMode.ts` still have ZERO callers in `app/` or `lib/` — WS gateway never validates a ticket or streams app events | `v0.2.0-alpha` |
| App manifest — create app/bot from manifest | — | ✅ Full | `app/api/apps/manifest/route.ts` CSRF+owner/admin+audit, validates + atomically creates apps + optional `bot_users`; end-to-end provisioning | `v0.0.7-alpha` |
| Interactive components — Block Kit validation | — | ✅ Full | `app/api/blockkit/validate/route.ts` + `lib/blockkit/validate.ts` validate block arrays; dev tool, no side effects | `v0.0.7-alpha` |
| Interactive components — views/modals (`open`/`push`/`update`/`publish`) | `views.open` / `views.push` / `views.update` / `views.publish` | 🟠 Stub | `app/api/views/route.ts` still echo-only — fabricates view object, no persistence, no `trigger_id` validation, no realtime push (comment route:55 'in production this would be pushed via SSE/WebSocket') | `v0.2.0-alpha` |
| Interactive components — `block_actions` / `view_submission` ingress + message shortcuts | — | ✅ Full | `app/api/integrations/interactivity/route.ts:43` — HMAC-verified ingress (sig over `ts.rawBody`), anti-replay nonce, rate-limit, SSRF/channel-forgery guard; dispatches 'interaction' event through `event_subscriptions` pipeline (`emitWebhookEvent:117`) | `v0.0.7-alpha` |
| Workflow Builder — define multi-step workflows (triggers/steps/functions) | `workflows.stepCompleted` / `workflows.stepFailed` | 🟠 Stub | `workflows`/`functions`/`workflow_executions` tables now in `migrate.ts:506/2059/2027` (Hard Rule #3 resolved); `app/api/workflows/route.ts` execute:173 still only inserts status 'running'; `step_completed`/`step_failed` require an external caller — no engine runs steps/triggers | `v0.2.0-alpha` |
| Workflow — approval flows | — | ✅ Full | `app/api/approvals/requests/route.ts` + `workflows`/`workflow_steps`/`approval_requests`/`approval_reviews` in `migrate.ts`; review transitions tested; the one working workflow surface | `v0.0.6-alpha` |
| App/plugin marketplace — publish + install | — | 🟡 Partial | `app/api/marketplace/plugins` + `install`/`installed` + `integrations/plugins` registry CRUD against `marketplace_plugins`/`installed_plugins`/`plugins`; install bumps download count | `v0.0.7-alpha` |
| Plugin runtime — sandboxed execution / extension points | — | 🟠 Stub | `app/api/integrations/plugins/route.ts` only stores `capabilities[]` JSON + status (route:108-127); plugins are never loaded/executed — no runtime | `v0.2.0-alpha` |
| Email-to-channel ingestion | — | 🟡 Partial | `app/api/integrations/email-ingestion/route.ts` `email_routes` registry present; not verified end-to-end (no inbound mail-to-message pipeline confirmed) | `v0.2.0-alpha` |

**Integrations & Extensibility tally:** 34 behaviors — Full 15 · Partial 14 · Stub 4 · Missing 1 · Excluded 0

---

## 15. Identity (SSO / SCIM / MFA / Session / Password / LDAP)

Slack API methods: N/A (identity plane, no Slack API parity); references Mattermost SAML/SCIM/MFA endpoints

| Behavior | Mattermost hint | Status | Note | Target (semver) |
|----------|-----------------|--------|------|-----------------|
| SAML 2.0 SP — SP-initiated AuthnRequest | `saml.login` | ✅ Full | `app/api/auth/sso/saml/start/route.ts:48` traced; `RelayState` single-use in `sso_auth_requests`; `ssoSamlClient` builds redirect-binding request | `v0.0.x` |
| SAML 2.0 SP — ACS assertion validation | `saml.complete` | ✅ Full | `app/api/auth/sso/saml/acs/route.ts:46-63` redeems `RelayState` single-use + `InResponseTo` match; `node-saml` `wantAssertionsSigned:true` (`ssoSamlClient.ts:45`) | `v0.0.x` |
| SAML — IdP metadata discovery (auto-config) | — | ✅ Full | `lib/auth/samlMetadata.ts` parses `EntityDescriptor`; sso route consumes `entryPoint`+certs | `v0.0.x` |
| SAML — signing-cert rotation | — | ✅ Full | `saml_idp_certs` JSONB (`migrate.ts:3093`, mig 026); `ssoSamlClient.ts:43` `idpCert` accepts cert array; `super_admin` refresh route | `v0.0.x` |
| SAML — SP metadata publication (XML endpoint) | — | ✅ Full | `app/api/auth/sso/saml/metadata/route.ts:48` serves `application/samlmetadata+xml` via `generateSamlSpMetadata` (`ssoSamlClient.ts:24`); provider-existence gated | `v0.0.x` |
| SAML — IdP-initiated / SLO (single logout) | — | 🔴 Missing | grep finds zero `LogoutRequest`/`LogoutResponse`/`SingleLogout` in `app\|lib`; logout still local session delete only | `v1.0.0` |
| OIDC RP — authz code + PKCE start | — | ✅ Full | `app/api/auth/sso/oidc/start/route.ts:57` traced; PKCE+state+nonce persisted single-use | `v0.0.x` |
| OIDC RP — callback / token + id_token verify | — | ✅ Full | `app/api/auth/sso/oidc/callback/route.ts:17-19` consumes state single-use; lib verifies `id_token` via JWKS (`iss`/`aud`/`exp`/`nonce`) | `v0.0.x` |
| OIDC — IdP discovery + JWKS rotation | — | ✅ Full | `ssoOidcClient` `oidc.discovery()` cached; `openid-client` v6 JWKS rotation tolerated | `v0.0.x` |
| Legacy Entra/Azure OAuth login | — | ✅ Full | `app/api/auth/entra/route.ts` now a 49-line shim: hand-rolled OAuth/JIT/session-mint GONE, 302s into hardened `/sso/oidc/start` (mig 031 seeds provider); critical-gap #3 resolved | `v0.0.x` |
| JIT provisioning on first SSO login | — | ✅ Full | `lib/auth/ssoProvision.ts` provider-gated; new user `platform_role='employee'`, clamped workspace role | `v0.0.x` |
| Account linking (SSO ↔ existing user) | — | ✅ Full | `ssoProvision.ts` resolution identity-link→email→JIT; `sso_identity_links` upsert | `v0.0.x` |
| Group → role mapping from IdP claims | — | 🟡 Partial | `lib/auth/ssoClaims.ts` maps to workspace member/guest clamped, no platform roles, no team/channel auto-join | `v0.2.0-alpha` |
| SCIM v2 — Users CRUD | — | ✅ Full | `app/api/scim/v2/Users/route.ts` org-scoped via `scim_connections.org_id` (:151,:296); `application/scim+json`; bearer-hash auth | `v0.0.x` |
| SCIM v2 — deprovision (deactivate + session revoke) | — | ✅ Full | `Users/route.ts:471-490` DELETE=soft deactivate, removes `org_members` (:480), logs `scim_sync_log` | `v0.0.x` |
| SCIM v2 — Groups CRUD + membership patch | — | ✅ Full | `app/api/scim/v2/Groups/route.ts`: `resolveScimConnection` returns `org_id` from `scim_connections`; `orgScope`(:81) predicates all queries; `scopedGroupId`(:233) guards PUT/PATCH/DELETE (cross-org → 404); `audit()` calls `writeAuditLog` on create/replace/patch/delete(:223,276,337,359) | `v0.1.0-alpha` |
| SCIM — `ServiceProviderConfig` / Schemas / ResourceTypes | — | ✅ Full | `app/api/scim/v2/{ServiceProviderConfig,Schemas,ResourceTypes}/route.ts` static discovery docs present | `v0.0.x` |
| SCIM — bearer-token lifecycle (issue/rotate/revoke) | — | 🟡 Partial | `app/api/admin/scim/route.ts:233` traced, stores `bearer_token_hash`; rotation/expiry semantics still shallow | `v0.1.0-alpha` |
| MFA — TOTP enrollment + verify (RFC 6238) | — | ✅ Full | `lib/auth/totp.ts` `verifyTotp` (RFC 6238); `mfa/route.ts` verifies code before activation | `v0.0.x` |
| MFA — backup / recovery codes | — | 🟡 Partial | `mfa/route.ts:156-172` only GENERATES + HMAC-hashes 10 codes; grep shows no consume/burn in login or stepup (stepup verifies totp only) | `v0.1.0-alpha` |
| MFA — admin enforcement policy | — | 🟡 Partial | `login/route.ts:126-131` `mfaEnrollmentRequired` gates ENROLLMENT past grace only; no per-login code for password users | `v0.1.0-alpha` |
| MFA — step-up after SSO (`enforce_mfa` providers) | — | ✅ Full | `ssoProvision.ts:117-121` sets `mfa_pending`; `mfa/stepup/route.ts` `verifyTotp` clears it; `readSessionUserId` withholds | `v0.0.x` |
| WebAuthn — passkey registration | — | ✅ Full | `app/api/auth/webauthn/register/route.ts:78` traced; `@simplewebauthn` challenge+credential storage (mig 027) | `v0.0.x` |
| WebAuthn — passkey step-up (MFA) | — | ✅ Full | `app/api/auth/webauthn/authenticate/route.ts:11-16` assertion clears `mfa_pending` parallel to TOTP | `v0.0.x` |
| WebAuthn — passwordless (discoverable) login | — | ✅ Full | `app/api/auth/webauthn/login/route.ts:79` traced; usernameless resident-key login establishes session | `v0.0.x` |
| Session policy — TTL / idle / max-sessions / device list / revoke | — | 🟡 Partial | TTL+idle+device-list+revoke enforced; `max_sessions_per_user`/`single_session_mode`/`force_reauth_hours`/`revoke_on_password_change`/`require_mfa_for_admin` still defined-only — zero enforcement reads outside `sessionPolicy.ts`/admin route | `v0.1.0-alpha` |
| Password policy (complexity / history / rotation / breach) | — | ✅ Full | `lib/auth/passwordPolicy.ts` (complexity/history/expiry) + `admin/password-policy/route.ts` (CSRF+audited) enforced in `change-password/route.ts:49-70` (`validate`+`isPasswordReused`+`recordHistory`) and register; login surfaces `password_expired`. No HIBP breach check (AI/ML n/a) | `v0.0.x` |
| LDAP / Active Directory sync | — | 🟠 Stub | `app/api/admin/ldap/route.ts:88` still `test_result:'simulated_success'`, :167 enqueues type 'compliance_export' w/ `ldap_sync` payload, :119 stores `'sha256:***'` literal; no `ldapjs`; header :1 'not yet wired' | `v1.0.0` |

**Identity tally:** 28 behaviors — Full 20 · Partial 6 · Stub 1 · Missing 1 · Excluded 0

---

## 16. Tickets and work management (AAELink differentiator)

Slack: Workflows + ticketing via apps. Mattermost: Playbooks. AAELink: first-class tickets in schema.

| Capability | Mattermost hint | Status | AAELink surface | Target (semver) |
|------------|-----------------|--------|-----------------|-----------------|
| Ticket create / list | Playbooks / Jira plugin | ✅ Full | [`app/api/tickets`](../app/api/tickets/route.ts) | `v0.0.2-alpha` |
| Ticket detail / state | Checklists, runs | ✅ Full | [`tickets/[id]`](../app/api/tickets/[id]/route.ts) | `v0.0.2-alpha` |
| Task assignment / SLAs | Playbook timers | ✅ Full | `lib/slaEngine.ts` — priority-based SLA targets (1h-72h), `calculateSlaDue`, assignment notifications, `notifyTicketAssignment` | `v0.0.2-alpha` |
| Approvals (sequential / parallel) | Custom flows | ✅ Full | `api/approvals/workflows` CRUD + `approvals/requests` lifecycle + `requests/[id]/review` approve/reject | `v0.0.6-alpha` |

---

## 17. Operations, reliability, and scale

| Area | Mattermost hint | Status | AAELink surface | Target (semver) |
|------|-----------------|--------|-----------------|-----------------|
| Horizontal scale of app | Clustering docs | ✅ Full | `api/admin/cluster` — node registration/heartbeat, auto-scaling rules, session affinity, fan-out strategy (Redis/NATS/Postgres NOTIFY), rolling deploy coordination | `v0.0.7-alpha` |
| Rate limits / abuse | `Rate` settings | ✅ Full | Next.js middleware with tiered rate limits per route | `v0.0.5-alpha` |
| Backup / restore | DB + files | ✅ Full | `api/admin/backups` GET/POST/PUT/DELETE — list, trigger, schedule, manage; db size reporting + audit logging | `v0.0.7-alpha` |
| Feature flags | N/A | ✅ Full | `lib/featureFlags.ts` + admin API + DB table | `v0.0.5-alpha` |
| Health checks | Cluster status | ✅ Full | `api/health` — DB probe, memory stats, uptime, latency; K8s/LB compatible | `v0.0.5-alpha` |

---

## 18. How to use this map in delivery

1. **Pick a Slack pillar** (e.g. "DMs + group DMs") and copy rows into a PRD or epic with acceptance tests; carry **`Target (semver)`** into the epic title or milestone field.
2. **Decide engine dependency:** pure Next + Postgres + S3, vs optional Mattermost for WebSocket/plugin ecosystem.
3. **Update** [`parity-reference-matrix.md`](./parity-reference-matrix.md) **section 5** when status changes (keep that table small; use this doc for detail).
4. **Update** root [`README.md`](../README.md) **roadmap** when "Gap" becomes "Planned" for communicable commitments, then **reconcile `Target (semver)` here** so planning bands stay consistent.

---

## Related docs

| Doc | Role |
|-----|------|
| [`parity-reference-matrix.md`](./parity-reference-matrix.md) | Condensed parity table |
| [`architecture-technical.md`](./architecture-technical.md) | Fortress UI, APIs, scale topology |
| [`NORTH-STAR-A.md`](./NORTH-STAR-A.md) | SSE + registration |
| [`ROADMAP-PHASES-AND-LAYERS.md`](./ROADMAP-PHASES-AND-LAYERS.md) | Phases vs stack slices |
| [`phase-1/mattermost-api-map.md`](./phase-1/mattermost-api-map.md) | Historical REST map to MM routes |
