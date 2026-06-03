# Parity Audit — Messaging Core
Date: 2026-06-03
Auditor: Claude

Scope: channels, DMs, group DMs, threads, replies, reactions, edits, deletes,
pins, bookmarks, drafts, scheduled messages, in-channel/workspace search,
broadcast, permalinks, typing/read state. Source of truth: code over the
`parity-reference-matrix.md` / `parity-slack-mattermost-aaelink-full-map.md`
"Shipped" claims (those docs were written aspirationally and do not check
response shape, RBAC, or CSRF). Slack behaviors are taken from the public
`api.slack.com/methods` surface (chat.*, reactions.*, pins.*, bookmarks.*,
conversations.*) plus documented composer/UX behavior.

## Summary
- Coverage: 33 / 38 behaviors have some implementation
- Full: 14 | Partial: 16 | Stub: 3 | Missing: 5

Headline: the route surface is broad and most happy-paths work, but "Shipped"
in the parity docs overstates depth. The biggest real problems are (1) a hard
split-brain between two read-cursor tables that desyncs unread counts, (2) no
CSRF on any message mutation route despite project Hard Rule #4, and (3)
announcement / read-only channel posting is advertised but never enforced on
send. Edits and deletes are not audit-logged (Hard Rule #5).

## Behavior Matrix
| # | Behavior | Slack | Mattermost | AAELink Route | Test | Level | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Send message to channel | chat.postMessage | POST /posts | `app/api/messages/route.ts:438` `_POST` | `__tests__/api/messages.test.ts`, `tests/chatPost.test.ts` | ✅ Full | RBAC via `userCanReadChannel`; notifies mentions/DM recipients. |
| 2 | Send to DM | chat.postMessage (im) | POST /posts | `app/api/messages/route.ts:490` (`isDm` branch) | `tests/chatPost.test.ts` | ✅ Full | Notifies all DM recipients (not just @mentions). Good Slack parity. |
| 3 | Send to group DM | chat.postMessage (mpim) | POST /posts | `app/api/messages/route.ts` (type `G`) | — (no dedicated test) | 🟡 Partial | Works via same path; no test asserting group-DM fan-out. |
| 4 | Get channel history (paginated) | conversations.history | GET /posts | `app/api/messages/route.ts:54` `_GET`; `conversations/history/route.ts` | `__tests__/api/messages.test.ts` | ✅ Full | Incremental `since`, `before_*` paging, `around_id`, `older_available`. Solid. |
| 5 | Thread replies (one level) | chat.postMessage + thread_ts | POST /posts root_id | `app/api/messages/route.ts:166`/`:453` | `__tests__/api/threads.test.ts` | ✅ Full | Enforces one-level (`thread_one_level_only`). Matches Slack/MM. |
| 6 | Thread broadcast (reply also to channel) | reply_broadcast=true | N/A | `app/api/messages/route.ts:521` (`body.broadcast`) | — | 🟡 Partial | Inserts a *duplicate* top-level row instead of a flagged "also sent to channel" post. Slack keeps one post flagged; this creates two independent messages — edits/deletes won't stay in sync. |
| 7 | Edit message | chat.update | PUT /posts/{id} | `app/api/messages/[id]/route.ts:94` `_PATCH` | `__tests__/api/message-edits.test.ts`, `tests/...` | 🟡 Partial | Owner-only; records edit history (`recordMessageEdit`). **No audit log** (Hard Rule #5). No "(edited)" flag returned distinctly — client infers from `updated_at`. |
| 8 | Edit history | (not public) | post edit history | `app/api/messages/[id]/edits/route.ts` + `lib/messaging/messageEdits.ts` | `__tests__/api/message-edits.test.ts` | ✅ Full | Beyond Slack; good. |
| 9 | Delete message | chat.delete | DELETE /posts/{id} | `app/api/messages/[id]/route.ts:174` `_DELETE` | covered in messages tests | 🟡 Partial | Owner-only; cascades thread; writes tombstone to `message_deletions` for incremental sync. **No audit log** (Hard Rule #5). No admin/mod override delete. |
| 10 | Add/remove reaction (toggle) | reactions.add / reactions.remove | POST /reactions | `app/api/messages/reactions/route.ts:36` `_POST` | `tests/reactions.test.ts` | ✅ Full | Atomic toggle in a txn. RBAC checked. |
| 11 | List who reacted | reactions.get | GET reactions | `app/api/messages/reactions/users/route.ts` | `tests/reactions.test.ts` | 🟡 Partial | Capped at 20 users, no pagination; fine for small teams, not Grid-scale. |
| 12 | Reactions on a message (summary) | reactions.get | — | `lib/messaging/chat-post.ts` `reactionSummariesForMessages` | `tests/reactions.test.ts` | ✅ Full | Returns `{key,count,me}` per message inline with posts. |
| 13 | Pin message | pins.add | POST /pinned | `app/api/pins/route.ts:41` `_POST` | — (no `__tests__/api/pins`) | 🟡 Partial | Writes system message + **audit log** (good). No RBAC/membership check before pin; no untested. |
| 14 | Unpin message | pins.remove | DELETE | `app/api/pins/route.ts:84` `_DELETE` | — | 🟡 Partial | Audit-logged. No membership/permission gate; anyone authenticated can unpin if they know ids. |
| 15 | List pins | pins.list | GET /pinned | `app/api/pins/route.ts:9` `_GET` | — | ✅ Full | Joins author/pinner; limit 50. |
| 16 | Save / bookmark item (personal) | stars.add / "Saved" | flagged posts | `app/api/saved/route.ts:76` `_POST` | `__tests__/api/saved-items.test.ts` | ✅ Full | Per-user; search + paging on list. |
| 17 | Channel bookmarks bar | bookmarks.add | channel bookmarks | `app/api/bookmarks/route.ts` | — | 🟡 Partial | URL bookmarks only; **no RBAC** (any member adds/deletes any bookmark by id), no audit, no edit/reorder endpoint, no folders. |
| 18 | Drafts (server-side, cross-device) | drafts.* (internal) | client drafts | `app/api/drafts/route.ts` | `tests/messageDrafts.test.ts` | ✅ Full | Upsert per (user,channel,root); 40K cap; thread-scoped. Good. |
| 19 | Scheduled message create | chat.scheduleMessage | (plugin) | `app/api/scheduled-messages/route.ts:16` `_POST` | `tests/scheduledMessageProcessor.test.ts` | 🟡 Partial | Persists pending; validates future ts. **No CSRF**, no RBAC channel check at create time. |
| 20 | Scheduled messages list | chat.scheduledMessages.list | — | `app/api/scheduled-messages/route.ts:60` `_GET` | `tests/scheduledMessageProcessor.test.ts` | ✅ Full | Lists caller's pending. |
| 21 | Scheduled message delete/cancel | chat.deleteScheduledMessage | — | `app/api/scheduled-messages/route.ts:87` `_DELETE` | `tests/scheduledMessageProcessor.test.ts` | ✅ Full | Owner-scoped cancel. |
| 22 | Scheduled dispatch (delivery) | (internal scheduler) | jobs | `app/api/scheduled-messages/dispatch/route.ts` | `tests/scheduledMessageProcessor.test.ts` | 🟡 Partial | Unauthenticated endpoint (no session/secret) — anyone can POST to trigger dispatch. Inserts raw message bypassing mentions/notify path of `/api/messages`; recipients get no notification/push for delivered scheduled messages. |
| 23 | Message permalink | chat.getPermalink | post link | `app/api/messages/permalink/route.ts` | — | 🟡 Partial | Builds `/collab/{ws}/channel/{id}?focus=` URL. **No RBAC** — leaks workspace/channel/thread ids for any message id to any authenticated user. |
| 24 | Forward / share message | (UI "Forward") | — | `app/api/messages/forward/route.ts` | — | 🟡 Partial | Quote-block re-post. Only gates `P` channels; `O`/`G`/`D` targets not membership-checked. No CSRF. No source-read check (can forward a message from a channel you can't read). |
| 25 | In-channel / workspace message search | search.messages | search posts | `app/api/messages/search/route.ts`; `search/messages/route.ts` | `__tests__/api/search-messages.test.ts`, `tests/searchMessages.test.ts` | 🟡 Partial | `ILIKE` substring only (no tsvector ranking, no relevance). Workspace-scoped, asserts membership. No in-channel `channel_id` filter param; no `from:`/`in:` operators here (those live in `search/advanced`). |
| 26 | Search operators (from:/in:/has:/before:/after:) | search modifiers | — | `lib/searchFilters.ts` + `search/advanced` (out of this route set) | — | 🟡 Partial | Exists per matrix but not in the messaging-core search route; not re-verified here. |
| 27 | Typing indicator (channel) | (RTM/socket) | typing WS event | `app/api/collab/typing/route.ts:77` `_POST` | `tests/collabTypingEmit.test.ts` | ✅ Full | 8s TTL, Redis pub/sub emit + DB poll fallback. |
| 28 | Typing indicator (thread) | thread typing | — | `app/api/collab/typing/route.ts` (thread branch) | `tests/collabTypingEmit.test.ts` | 🟡 Partial | DB only — intentionally does NOT emit realtime (`emitTyping` skipped for threads); thread typing relies on GET poll, so it lags vs channel typing. |
| 29 | Read state / mark read | conversations.mark | view channel | `app/api/collab/read-state/route.ts`; `conversations/mark/route.ts` | `tests/useReadState.test.ts` | 🟠 Stub-quality | **Split-brain bug:** `collab/read-state` writes `channel_read_state`; `conversations/mark` + `collab/mark-unread` + DM unread read/write `read_state`. Two tables, never synced → marking read in one path does not clear unread computed from the other. |
| 30 | Mark unread (rewind cursor) | (UI "Mark unread") | — | `app/api/collab/mark-unread/route.ts` | — | 🟠 Stub-quality | Writes `read_state` (the *other* table from `collab/read-state`), so a rewind here is invisible to the channel-history unread math that reads `channel_read_state`. |
| 31 | Unread badge counts | (client derived) | unread API | `app/api/channels/unread/route.ts`; `channels/dm` unread | — | 🟡 Partial | DM list unread uses `read_state`; thread/channel unread uses `channel_read_state` — inconsistent source tables (see #29). |
| 32 | Follow / unfollow thread | (subscribe) | thread follow | `app/api/collab/thread-follow/route.ts` | — | 🟡 Partial | Writes `thread_followers`, but `/api/threads` computes `is_following` from authorship/participation and does NOT read `thread_followers` — explicit follow has no effect on the threads list or unread math. |
| 33 | Threads list ("Threads" view) | (Threads pane) | thread list | `app/api/threads/route.ts:10` `_GET` + mark-all-read POST | `__tests__/api/threads.test.ts` | ✅ Full | Has CSRF on mark-all-read POST + audit log (the only messaging route that does). |
| 34 | Live delivery (new msg/edit/react push to clients) | RTM/socket | WS hub | `app/api/collab/events/route.ts` (SSE) + `lib/realtime/redisPubSub.ts` | `tests/collabPresenceEmit.test.ts` | 🟡 Partial | `/api/messages` POST does NOT publish a `message` event to the pub/sub topic (only typing/presence emit). New messages reach clients via incremental `since` polling, not push — typing is realtime but messages are not. |
| 35 | Announcement / read-only channel enforcement | (posting perms) | channel perms | `app/api/channels/posting-perms/route.ts` (config); `lib/enterprise/collab-access.ts:52` `userCanPostToChannel` | — | 🟠 Stub | `userCanPostToChannel` is literally `return userCanReadChannel(...)`. `messages` POST calls `userCanReadChannel`, never checks `posting_mode`. Read-only/announcement mode is advisory (`can_post` flag) and NOT enforced server-side — a member can POST to an admins_only channel directly. |
| 36 | Post to archived channel blocked | (archived → no post) | archived guard | (none in `messages/route.ts`) | — | 🔴 Missing | `messages` POST does not check `channels.archived_at`; you can post into an archived channel. Only org-search filters archived. |
| 37 | CSRF on message mutations | (token) | CSRF | none of send/edit/delete/react/pin/save/forward/schedule call `verifyCsrf` | — | 🔴 Missing | Violates Hard Rule #4. Only `/api/threads` POST calls `verifyCsrf`. CSRF is per-handler (not middleware), so these routes are unprotected against cross-site mutation. |
| 38 | Ephemeral / me-message / postEphemeral | chat.postEphemeral / meMessage | ephemeral | `app/api/chat/route.ts` (unified surface, claimed) | — | 🔴 Missing (verify) | Matrix claims `api/chat` covers all 8 chat.* methods; ephemeral messages have no persistence model (no per-recipient visibility column) — not real parity. Not exercised by tests. |

## Critical Gaps (severity-ordered)

1. **Read-state split-brain (data-correctness, HIGH).** Two cursor tables —
   `aaelink.channel_read_state` (used by `messages` GET unread math, `threads`,
   `collab/read-state`) and `aaelink.read_state` (used by `collab/mark-unread`,
   `conversations/mark`, `channels/dm` unread). They are never synchronized.
   Marking a channel read via one path leaves unread counts stale in the other.
   `migrate.ts:140` vs `migrate.ts:777`/`:2193`. This makes read/unread state
   effectively unreliable — a core Slack behavior. Pick one table and migrate.

2. **No CSRF on message mutations (security, HIGH; Hard Rule #4).** Send, edit,
   delete, react, pin, unpin, save, forward, schedule, read-state, posting-perms
   — none call `verifyCsrf`. Only `/api/threads` POST does. Every state-changing
   messaging endpoint is open to CSRF.

3. **Announcement/read-only posting not enforced + archived channels writable
   (correctness/RBAC, HIGH).** `userCanPostToChannel` is an alias of read access;
   `messages` POST never consults `posting_mode` or `archived_at`. The
   `posting-perms` endpoint and its `can_post` flag are decorative — a non-admin
   can POST to an `admins_only` channel and to archived channels via the API.

Secondary (MEDIUM): edits/deletes are not audit-logged (Hard Rule #5);
`scheduled-messages/dispatch` is unauthenticated and bypasses notifications;
`permalink` and `forward` lack source-read RBAC (info leak / cross-channel
forward); explicit `thread-follow` rows are written but never read by the
threads/unread logic; new messages are not pushed over SSE (poll-only).

## Recommended Next Steps
1. Consolidate read cursors onto a single table (`channel_read_state`),
   migrate `read_state` rows, and repoint `collab/mark-unread`,
   `conversations/mark`, and `channels/dm` unread to it. Add a test asserting
   read in one path clears unread in all paths.
2. Add `verifyCsrf(req)` to every messaging mutation handler (lift the pattern
   already used in `/api/threads`); add an `__tests__/api/` CSRF case.
3. Make `userCanPostToChannel` actually enforce `posting_mode` (admins_only /
   approved) and reject `archived_at <> 0`; call it from `messages` POST,
   `forward`, and `scheduled-messages` create. Add tests.
4. Audit-log edits and deletes (`lib/enterprise/auditLog.ts`) like pins do.
5. Add channel-read RBAC to `permalink` and source-read RBAC to `forward`.
6. Make `thread-follow` authoritative: have `/api/threads` `is_following` read
   `thread_followers`, and route scheduled-dispatch through the same notify path
   as `/api/messages`. Authenticate the dispatch endpoint (cron secret/session).
7. Emit a realtime `message` event on `/api/messages` POST so new messages push
   instead of relying on `since` polling.
8. Backfill tests for pins, bookmarks, permalink, forward, mark-unread,
   thread-follow (currently untested).

## Out of Scope
- AI/ML features (assistant threads, suggested prompts) — per standing directive.
- OpenSearch/Elasticsearch index tier for search scale (tracked separately as
  BLUEPRINT §4.5 drift; in-channel search here is SQL `ILIKE`).
- WebRTC media / huddles, clips transcription (calls area).
- Block Kit `views`/`dialog` interactive surfaces (platform area).
- Cross-org shared/federated channels (separate enterprise audit).
- Custom emoji, link unfurl rendering (formatting area, separate audit).
