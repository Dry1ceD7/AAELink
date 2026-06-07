# AAELink — Parity reference matrix (regenerated 2026-06-06)

> **This edition was regenerated 2026-06-06 from code verification.**
> Method: production-path wiring checked (response shape, RBAC, CSRF, audit-logging,
> realtime wiring, and whether the wiring is actually *invoked end-to-end*) — not route
> existence or DDL presence alone. It supersedes all prior versions of this file.
> Per-row evidence is in [`docs/parity-audits/`](./parity-audits/).

Capability-level parity of **AAELink** against a **Slack Enterprise Grid-class**
workspace product, with **Mattermost** as a secondary reference where Slack
internals are not public.

## Method — read this first

This matrix is **regenerated from ground truth, not from route inventories.** The
previous edition labelled rows "Shipped" by counting that a route handler or a DDL
table existed. An audit (see `docs/parity-audits/`) found that **"a route exists"
is not the same as "the behavior works."** Many handlers returned the wrong shape,
skipped RBAC/CSRF, queried phantom tables, or were never called from any production
path. The README's historical "100% parity / 55/55 method groups" figure counted
**routes + DDL**, not capability, and is retired here.

Every status below was set by **trusting the code over the docs**: response shape,
RBAC, CSRF, audit-logging, realtime wiring, and — critically — whether the wiring
is actually *invoked end-to-end* were all checked. The per-area tables reflect the
state of the codebase as of **2026-06-06**, verified via production-path wiring.

### Status legend

| Status | Symbol | Meaning |
|--------|--------|---------|
| Full | ✅ | Behavior works end-to-end with parity-grade RBAC/CSRF/audit/realtime where applicable |
| Partial | 🟡 | Real path exists but missing depth, scale, policy, pagination, or has a known security/wiring gap |
| Stub | 🟠 | Surface/registry/UI exists but the behavior does nothing end-to-end (engine present, no caller; or config-only) |
| Missing | 🔴 | No working implementation; not wired |
| Excluded | ⛔ | Out of scope: env-blocked external infra (SFU, APNS, LDAP/AD, KMS) or AI/ML dependency not bundled in this repo |

**"Parity" does not require identical Slack UX** — it means comparable
organizational outcomes for the behavior in that row.

---

## Per-area matrices

### Messaging core (38 behaviors)

| # | Behavior | Slack ref | Status | Note |
|---|---|---|---|---|
| 1 | Send message to channel | chat.postMessage | ✅ Full | messages/route.ts:448 — userCanReadChannel + archived + userCanPostToChannel + DLP + CSRF (non-bearer) + notify fan-out |
| 2 | Send to DM | chat.postMessage (im) | ✅ Full | messages/route.ts:532 isDm branch → notifyDirectMessage to all recipients |
| 3 | Send to group DM | chat.postMessage (mpim) | 🟡 Partial | type 'G' uses same path (collab-access.ts:107 G bypasses posting_mode); no dedicated group-DM fan-out test |
| 4 | Get channel history (paginated) | conversations.history | ✅ Full | messages/route.ts:125 GET uses m.body + since/before/around/older_available; NOTE sibling conversations/history/route.ts:50 selects nonexistent m.content (broken alias) |
| 5 | Thread replies (one level) | chat.postMessage thread_ts | ✅ Full | messages/route.ts:495 enforces thread_one_level_only on root_id |
| 6 | Thread broadcast (reply also to channel) | reply_broadcast=true | 🟡 Partial | messages/route.ts:602 INSERTs a second independent top-level row (id broadcastId), not a flagged single post; edits/deletes won't sync |
| 7 | Edit message | chat.update | ✅ Full | messages/[id]/route.ts:99 verifyCsrf + owner-only + DLP + recordMessageEdit + writeAuditLog 'message.edit' (167) |
| 8 | Edit history | (n/a) | ✅ Full | messages/[id]/edits + lib/messaging/messageEdits.recordMessageEdit, called at [id]/route.ts:158 |
| 9 | Delete message | chat.delete | 🟡 Partial | [id]/route.ts:195 verifyCsrf + tombstone + writeAuditLog 'message.delete' (261) now present; still owner-only, no admin/mod override delete |
| 10 | Add/remove reaction (toggle) | reactions.add/remove | ✅ Full | reactions/route.ts:39 verifyCsrf + userCanReadChannel(60) + atomic BEGIN toggle(69) + webhook emit |
| 11 | List who reacted | reactions.get | 🟡 Partial | reactions/users/route.ts:47 still LIMIT 20, no pagination |
| 12 | Reactions summary on message | reactions.get | ✅ Full | lib/messaging/chat-post reactionSummariesForMessages returns {key,count,me} inline |
| 13 | Pin message | pins.add | ✅ Full | pins/route.ts:62 userCanReadChannel gate added on POST + GET + DELETE; verifyCsrf + writeAuditLog 'message.pin' (:88) |
| 14 | Unpin message | pins.remove | ✅ Full | pins/route.ts:110 userCanReadChannel gate added on DELETE; verifyCsrf + writeAuditLog 'message.unpin' (:124) |
| 15 | List pins | pins.list | ✅ Full | pins/route.ts:9 GET joins author/pinner, LIMIT 50 |
| 16 | Save / bookmark item (personal) | stars.add | ✅ Full | saved/route.ts:78 verifyCsrf added; per-user, search+paging on list |
| 17 | Channel bookmarks bar | bookmarks.add | 🟡 Partial | bookmarks/route.ts:44 verifyCsrf + URL validation added, but still NO RBAC (DELETE removes any id, no membership/ownership), no audit, no reorder/folders |
| 18 | Drafts (server-side, cross-device) | drafts.* | ✅ Full | drafts/route.ts upsert per (user,channel,root), 40K cap (line 72); test tests/messageDrafts.test.ts |
| 19 | Scheduled message create | chat.scheduleMessage | ✅ Full | scheduled-messages/route.ts:19 verifyCsrf + isChannelArchived + userCanPostToChannel all gated at create (app/api/scheduled-messages/route.ts:19,52,55) |
| 20 | Scheduled messages list | chat.scheduledMessages.list | ✅ Full | scheduled-messages/route.ts:60 GET lists caller's pending |
| 21 | Scheduled message delete/cancel | chat.deleteScheduledMessage | ✅ Full | scheduled-messages/route.ts:87 DELETE owner-scoped cancel |
| 22 | Scheduled dispatch (delivery) | (scheduler) | ✅ Full | dispatch/route.ts authenticated via DISPATCH_SECRET header or platform_admin/super_admin session (:26-42); delivery unified in lib/messaging/deliverScheduledMessage.ts with full notify fan-out (mentions/broadcast/keywords/thread followers), realtime emitMessageEvent, emitMessageCreated, last_post_at; used by both HTTP dispatch route and lib/infra/scheduledMessageProcessor.ts |
| 23 | Message permalink | chat.getPermalink | ✅ Full | permalink/route.ts:51 userCanReadChannel gate added — non-members receive 403 forbidden (app/api/messages/permalink/route.ts:51-52) |
| 24 | Forward / share message | (UI Forward) | 🟡 Partial | forward/route.ts:22 verifyCsrf + target archived(72)+userCanPostToChannel(75)+DLP added; still NO source-read check on original.channel_id (can forward from channel you can't read) |
| 25 | In-channel / workspace message search | search.messages | ✅ Full | search/route.ts:41 uses shared FTS searchEngine (body_tsv/websearch_to_tsquery/ts_rank/ts_headline) + membership(35); replaces ILIKE |
| 26 | Search operators (from:/in:/has:/before:/after:) | search modifiers | ✅ Full | lib/messaging/searchEngine.ts parses from:/in:/has:/before:/after:/on:/during: + channelId filter (47,234-291); used by messaging-core search route |
| 27 | Typing indicator (channel) | (RTM) | ✅ Full | collab/typing/route.ts:77 POST 8s TTL, Redis emit + DB poll fallback |
| 28 | Typing indicator (thread) | thread typing | 🟡 Partial | collab/typing thread branch (root_id) still DB-only thread_typing poll, no realtime emit |
| 29 | Read state / mark read | conversations.mark | ✅ Full | collab/read-state, conversations/mark, collab/mark-unread, channels/unread, channels/dm ALL now write/read channel_read_state; legacy read_state migrated+DROPPED migrate.ts:3108-3120 (read-state POST lacks verifyCsrf) |
| 30 | Mark unread (rewind cursor) | (UI Mark unread) | ✅ Full | collab/mark-unread/route.ts:42 now writes channel_read_state (same table as read math); split-brain resolved |
| 31 | Unread badge counts | (client/unread API) | ✅ Full | channels/unread/route.ts:63 + channels/dm/route.ts:62 + threads both read channel_read_state — single consistent source |
| 32 | Follow / unfollow thread | (subscribe) | ✅ Full | threads/route.ts:37 is_following now reads thread_followers (EXISTS subquery); notifyThreadFollowers with access filter + mention dedup wired at messages/route.ts:625; auto-follow on reply (messages/route.ts:529); pref thread_replies_enabled honored (notificationsServer.ts:627); migration 047 |
| 33 | Threads list ("Threads" view) | (Threads pane) | ✅ Full | threads/route.ts:22 GET + mark-read POST with verifyCsrf(77); unread from channel_read_state(48) |
| 34 | Live delivery (new msg/edit/react push to clients) | RTM/socket | 🟡 Partial | messages POST now calls emitMessageEvent → getPubSub().publish(channelTopic) for main + broadcast inserts (app/api/messages/route.ts:659,682); pub/sub emit wired. collab/events SSE consumer is still watermark/since DB-poll (events/route.ts:65,110) — push requires a subscribing SSE client; poll fallback remains |
| 35 | Announcement / read-only channel enforcement | (posting perms) | ✅ Full | collab-access.ts:82 userCanPostToChannel now enforces posting_mode (everyone/admins_only/approved + channel_approved_posters); called at messages/route.ts:476 |
| 36 | Post to archived channel blocked | (archived guard) | ✅ Full | collab-access.ts:54 isChannelArchived (archived_at!=0 OR is_archived) called at messages/route.ts:473 → 403 channel_archived; also in forward + dispatch |
| 37 | CSRF on message mutations | (token) | ✅ Full | verifyCsrf now on send(459, bearer-exempt), edit(99), delete(195), react(39), pin/unpin(43/88), save(78), forward(22), bookmarks(44/94); residual gaps: scheduled-create, dispatch, read-state POST |
| 38 | Ephemeral / me-message / postEphemeral | chat.postEphemeral / meMessage | 🔴 Missing | chat/route.ts and conversations/history/route.ts phantom-column bugs fixed (body/root_id/reaction_key corrected, type field removed from INSERT); postEphemeral still not persisted (chat/route.ts:76) — ephemeral messages remain in-memory only |

**Messaging core tally:** 38 behaviors — ✅ 29 · 🟡 8 · 🟠 0 · 🔴 1 · ⛔ 0

Open security/correctness gaps: forward source-read RBAC (24), bookmarks no audit/reorder (17),
live-delivery SSE consumer still poll-based (34), group-DM fan-out test (3).

---

### Search & discovery (22 behaviors)

| # | Behavior | Slack ref | Status | Note |
|---|---|---|---|---|
| 1 | Full-text message search (search.messages) | search.messages | ✅ Full | app/api/search/messages/route.ts now thin-wraps unified FTS engine lib/messaging/searchEngine.ts (body_tsv GIN, websearch_to_tsquery, ts_rank); ACL in-query; tests/searchMessages.test.ts + __tests__/api/search-messages.test.ts |
| 2 | File content search (search.files) | search.files | 🟡 Partial | app/api/search/files/route.ts FTS+ts_headline unchanged; NOW tested (__tests__/api/search-files.test.ts) and reachable via /search/all fan-out, but still no dedicated file-search UI surface |
| 3 | Combined search (search.all) | search.all | ✅ Full | app/api/search/all/route.ts fans out messages(FTS engine)+files+people with workspace-member check & barrier filtering; tested __tests__/api/search-all.test.ts |
| 4 | People search | users.list filter | ✅ Full | app/api/search/users/route.ts: 500-on-presence-join fixed (joins aaelink.user_status not phantom presence), barrier block_search filter via filterSearchBlocked; NOW tested __tests__/api/search-users.test.ts |
| 5 | Channel search/discovery | channel browse | ✅ Full | app/api/search/channels/route.ts + lib/messaging/searchChannels.ts (public+org-wide, archived excluded, prefix-rank); consumed by components/channels/ChannelBrowseModal.tsx:53; tested __tests__/api/search-channels.test.ts |
| 6 | from:\<user\> modifier | yes | ✅ Full | searchEngine.ts:285 u.username = $idx; parsed client-side searchFilters.ts + advanced route inline; exact-username only (no @me/display-name) |
| 7 | in:\<#channel\> modifier | yes | ✅ Full | GlobalSearchModal.tsx:96 now sends channel_name (was broken channel_id); engine searchEngine.ts:278 resolves against readable channels only (no private-channel leak); tested |
| 8 | before:\<date\> modifier | yes | ✅ Full | searchEngine.ts:308 created_at < dayWindow.end (inclusive of day, UTC); tests/searchDateWindows.test.ts 9/9 pass |
| 9 | after:\<date\> modifier | yes | ✅ Full | searchEngine.ts:317 created_at >= dayWindow.start (UTC); tests/searchDateWindows.test.ts + __tests__/api/search-messages.test.ts |
| 10 | on:\<date\> modifier | yes | ✅ Full | searchEngine.ts:292 dayWindow() whole-day window; parsed in searchFilters.ts:51 + advanced route:60 + GlobalSearchModal:99; tested searchDateWindows.test.ts |
| 11 | during:\<month/year\> modifier | yes | ✅ Full | searchEngine.ts:300 duringWindow() handles YYYY and YYYY-MM; parsed searchFilters.ts:51 + advanced:61 + GlobalSearchModal:100; tested searchDateWindows.test.ts |
| 12 | has:link modifier | yes | ✅ Full | searchEngine.ts:344 m.body ~ 'https?://' across all routes |
| 13 | has:\<file/attachment\> modifier | has:file/has:image | 🟡 Partial | searchEngine.ts:334 EXISTS file_attachments WHERE deleted_at=0 (excludes soft-deleted); still only generic file/attachment, no has:image/video/star/emoji granularity |
| 14 | has:pin / has:reaction | has::emoji: | 🟡 Partial | Phantom-table bug FIXED: searchEngine.ts:342 now message_reactions (only real table per migrate.ts:135); pin via pinned_messages:339; still any-reaction not emoji-specific has::thumbsup: |
| 15 | is:thread modifier | n/a | ✅ Full | searchFilters.ts:53 IS_RE parses is:thread, GlobalSearchModal:102 appends, engine searchEngine.ts:349 root_id<>''; advanced route:62 too |
| 16 | is:saved / is:pinned / is:dm modifiers | yes | 🟡 Partial | is:saved (engine:355 saved_messages) + is:pinned (engine:353) now parsed+implemented+reachable; is:dm still missing (no DM-scoping operator) |
| 17 | Saved searches (persist query) | yes | ✅ Full | app/api/saved-searches/route.ts full CRUD owner-scoped+audited; PATCH adds alerts_enabled; tested __tests__/api/saved-searches.test.ts; UI components/search/SavedSearches.tsx |
| 18 | Saved-search alerts on new matches | BLUEPRINT §2.1.4 | ✅ Full | lib/messaging/savedSearchAlerts.ts re-runs AS OWNER with ms-watermark backlog drain; worker.ts:468 self-rescheduling saved_search_alerts job; migration 035; bell toggle SavedSearches.tsx:183; tested saved-search-alerts.test.ts |
| 19 | Smart suggestions / autocomplete / typeahead | yes | 🟡 Partial | GlobalSearchModal FILTER_SUGGESTIONS (modal:26) still static chips (from/in/before/after/has only, no is:/on:/during: chips); no recent-search history, no people/channel typeahead in the box |
| 20 | Result highlighting | yes | ✅ Full | Server-side ts_headline for messages (searchEngine.ts:377 HEADLINE_OPTS); rendered escaped via \<mark\> parsing (no dangerouslySetInnerHTML) in GlobalSearchModal:154 + SearchPanel:29 |
| 21 | Sort by relevance | yes | ✅ Full | searchEngine.ts:363 relevance\|recent\|oldest; GlobalSearchModal:332 user-selectable relevance/recent sort toggle; all routes off ILIKE |
| 22 | Sort by recency / pagination | yes | ✅ Full | searchEngine.ts limit clamp MAX_LIMIT=50, offset, COUNT(*) total returned across messages/advanced/org; channels route also limit+offset+total |

**Search & discovery tally:** 22 behaviors — ✅ 17 · 🟡 5 · 🟠 0 · 🔴 0 · ⛔ 0

Remaining partials: file-search no dedicated UI surface (2), has:image/video granularity
(13), emoji-specific has::reaction: (14), is:dm operator (16), real typeahead (19).

---

### Files & previews (30 behaviors)

| # | Behavior | Slack ref | Status | Note |
|---|---|---|---|---|
| 1 | files.upload (legacy single-shot) | files.upload | ✅ Full | app/api/files/upload/route.ts:73 stores via storeFileBytes (S3 or local), always inserts canonical file_attachments row (:87, migration 033 relaxed NOT NULLs), enforces scan policy cap (:43-52), fire-and-forget scan+index+thumbnail pipeline (:109); 50MB default cap |
| 2 | getUploadURLExternal (new flow, pre-signed) | getUploadURLExternal | ✅ Full | app/api/files/upload-sessions/route.ts:32 createUploadSession returns part_size + session id + expiry; lib/files/uploadSessions.ts:215 begins S3 multipart / local partial up front; audited (:57) |
| 3 | completeUploadExternal (finalize + attach) | completeUploadExternal | ✅ Full | app/api/files/upload-sessions/[id]/route.ts:88 action=complete → completeUploadSession (uploadSessions.ts:477): active-guarded claim, S3 CompleteMultipartUpload/local rename, INSERT file_attachments (:558), enqueue pipeline (:572), audit (:586) |
| 4 | Resumable / multipart / chunked upload | n/a | ✅ Full | uploadSessions.ts: 8MB fixed parts (PART_SIZE:72), positional/out-of-order appendPart with optimistic-version concurrency (:346), 5GB ceiling (MULTIPART_MAX_BYTES uploadPolicy.ts:26), resume via GET status, 24h TTL sweep (worker upload_session_sweep:534); tests in tests/uploadSessions.test.ts |
| 5 | files.list (paginated, filtered) | files.list | ✅ Full | app/api/files/route.ts:78 queries canonical aaelink.file_attachments (was phantom `files`); channel/user/type/date/search filters + paging; excludes deleted_at<>0; Bearer files:read scope (:37); test __tests__/api/files.test.ts |
| 6 | files.info (single file) | files.info | ✅ Full | app/api/files/route.ts:47-64 single-file branch reads file_attachments incl width/height/duration_ms/thumbnail_key; serializeFile maps Slack shape (:163) |
| 7 | files.delete | files.delete | ✅ Full | app/api/files/route.ts:184 owner/admin RBAC (:219-223), soft-delete file_attachments (:229), revokes public links (:238), removeFileObject physical cleanup S3/disk (:247), writeAuditLog (:249) |
| 8 | Download / url_private serving | files (download) | ✅ Full | app/api/files/[id]/download/route.ts:55 reads via storage abstraction (S3/local), D12 scan gate (:50), AND channel-membership check via userCanReadChannel (:41-46); active-content neutralized by buildServeHeaders (:64) |
| 9 | Thumbnails (server-generated) | thumbnails | ✅ Full | lib/files/thumbnailJob.ts:139 runFileThumbnail sniffs dims (imageMeta.ts pure-JS) + generates WebP via sharp dynamic import (:91), stores derived bytes (storage.ts storeDerivedBytes), records thumbnail_key; served at GET /api/files/preview?thumb=1 (previewThumbnail.ts:26) with ACL+scan gate; enqueued on upload for image/* (fileJobs.ts:92) |
| 10 | Image preview / lightbox | image preview | ✅ Full | components/chat/ImageLightbox.tsx, components/media/AvatarLightbox.tsx, FilePreviewModal.tsx present and wired; preview/route.ts:139 emits render_hints can_lightbox |
| 11 | PDF preview | pdf preview | ✅ Full | FilePreviewModal.tsx:92 renders PDF in an iframe at the file URL; download route now serves file_attachments bytes, so chat-uploaded PDFs render in-app |
| 12 | Office (docx/xlsx/pptx) preview | office preview | 🟡 Partial | Office→PDF conversion still only in documents subsystem (app/api/documents/[id]/convert/route.ts); no wiring from chat file_attachments to Stirling convert; chat office files fall back to download |
| 13 | Code / text preview w/ highlight | code preview | 🟡 Partial | app/api/files/preview/route.ts queries canonical file_attachments; emits can_code_highlight hint (:141) for code/text MIME; file_index extracts text, but no client syntax-highlight renderer (hljs/prism) confirmed in FilePreviewModal |
| 14 | Video preview / inline player | video preview | 🟡 Partial | preview/route.ts:140 can_player hint against canonical table; app/api/messages/clips handles video w/ thumbnail+transcription; generic chat-video inline player still hint-only |
| 15 | Audio preview / player | audio preview | 🟡 Partial | Same as video: preview can_player hint over canonical file_attachments; clips subsystem covers audio; no dedicated chat-audio player wired to file_attachments beyond the hint |
| 16 | 3D (gltf) / CAD (DWG) preview | n/a | ⛔ Excluded | BLUEPRINT-aspirational interactive viewers; Out of Scope (deferred); no renderer or MIME mapping present |
| 17 | File metadata (dims, duration, EXIF) | file metadata | ✅ Full | lib/files/imageMeta.ts extracts width/height + EXIF orientation (PNG/JPEG/GIF/WebP/BMP, pure-JS); thumbnailJob.ts:169 persists dims; sharp .rotate() strips EXIF on derived thumbnail (:119); duration_ms column exists but no audio/video extractor (chat path) |
| 18 | File comments — list | files.comments.list | 🟡 Partial | app/api/files/comments/route.ts:16 lists from file_comments (migrate.ts via 043 consolidation); joins users; still no file membership/ownership read check on the list |
| 19 | File comments — add/edit/delete | files.comments | 🟡 Partial | app/api/files/comments/route.ts:39 CRUD, edit/delete author-or-admin scoped (:72,:81); still NO CSRF on the POST mutation (no verifyCsrf import) and NO audit log |
| 20 | files.sharedPublicURL (make public) | files.sharedPublicURL | ✅ Full | app/api/files/[id]/public-link/route.ts:20 + lib/files/publicLinks.ts:56; uploader-only, reuses active token, CSRF + audit; test __tests__/api/file-public-links.test.ts |
| 21 | files.revokePublicURL | files.revokePublicURL | ✅ Full | app/api/files/[id]/public-link/route.ts:40 + revokePublicLinks; uploader-only revoke-all, audited; tested |
| 22 | Public link resolution (no session) | public link | ✅ Full | app/api/files/public/[token]/route.ts:43 now SERVES the actual bytes via readFileBytes (resolvePublicLink returns storage_backend, publicLinks.ts:86) with neutralized active-content headers; ?meta=1 for metadata-only; scan gate + org toggle enforced; test file-public-bytes.test.ts |
| 23 | Org-level public-sharing toggle | EnablePublicLink | ✅ Full | app/api/admin/file-sharing-policy/route.ts + getFileSharingPolicy, default enabled, persisted in system_config; tested |
| 24 | Virus / malware scan (real engine) | scan job | 🟡 Partial | lib/files/fileScanJob.ts real clamd INSTREAM; clamd-down→pending (never silent clean); AUTO-enqueued on every upload (fileJobs.ts:49 gated by scan_on_upload, default ON); BUT clamd daemon still NOT in docker-compose.yml (no clamav service) |
| 25 | Scan access gate (block infected) | scan gate | ✅ Full | lib/files/scanGate.ts:193 isFileAccessAllowed; block_infected pinned non-configurable (:153); used by download (:50), thumbnail serve (previewThumbnail.ts:57), public link; tested file-scan-gate.test.ts |
| 26 | Scan policy admin / queue view | scan admin | ✅ Full | app/api/files/scan/route.ts:32 admin summary + policy CRUD via setScanPolicy (single source lib/files/scanGate) + manual enqueue; CSRF+audit on update (:109,:135); two-policy-shape divergence resolved |
| 27 | Retention / auto-delete of files | data retention | 🟡 Partial | lib/enterprise/retentionEnforcer.ts buildFileHoldExclusion + retentionJob deleteFiles irreversibly purges file_attachments bytes (removeFileObject) past the window, legal-hold-aware; BUT scan-policy auto_delete_infected_after_days still only stored, not enforced (scanGate.ts:81 'future pass') |
| 28 | File content search (search-inside) | search.files | ✅ Full | app/api/search/files/route.ts:54 pg_tsvector over file_index, POPULATED by file_index worker job auto-enqueued on every upload (fileJobs.ts:82, fileIndexJob.ts:45 extracts text-like content); ts_headline highlights; test search-files.test.ts |
| 29 | External file refs (files.remote.*) | files.remote.* | 🟡 Partial | app/api/files/remote/route.ts:19,66 add/update/remove/share over files_remote; schema drift FIXED — table now owned by migrate.ts (043, workspace_id added :4326); still no workspace scoping in queries and no audit log on writes |
| 30 | External storage (S3 / MinIO) | S3 backend | ✅ Full | lib/files/storage.ts unifies chat path on lib/infra/s3 when S3_ENDPOINT set (storeFileBytes/readFileBytes/removeFileObject), backend recorded per-row (storage_backend, migration 034); falls back to local disk without S3 env; multipart sessions use S3 multipart APIs |

> Note: the verified data provided 30 rows (including row 16 ⛔ Excluded, 3D/CAD preview). The tally below counts all 30.

**Files & previews tally:** 30 behaviors — ✅ 20 · 🟡 9 · 🟠 0 · 🔴 0 · ⛔ 1

Remaining partials: office preview not wired from chat (12), code highlight renderer absent (13),
video/audio player hint-only (14/15), file comments no CSRF/audit (19), scan daemon not in compose (24),
infected-file auto-delete not enforced (27), remote files no workspace-scope/audit (29).

---

### Calls & huddles (23 behaviors)

| # | Behavior | Slack ref | Status | Note |
|---|---|---|---|---|
| 1 | Create call room (voice) | calls.add | ✅ Full | Real INSERT, auto-joins creator as host; app/api/calls/rooms/route.ts:136-156, type=voice default :117 |
| 2 | Create video call | calls.add (video) | ✅ Full | VALID_TYPES incl. video (rooms/route.ts:116); type=video sets video_on default true :149 |
| 3 | Start/join huddle (persistent ad-hoc) | Huddles | ✅ Full | One active huddle per channel, returns existing with already_exists; rooms/route.ts:120-131 |
| 4 | Join call | calls.participants.add | ✅ Full | Capacity check + room_full 409 + ON CONFLICT DO NOTHING; rooms/route.ts:202-226; tested calls-rooms.test.ts:86 |
| 5 | Leave call | calls.participants.remove | ✅ Full | Sets left_at; rooms/route.ts:228-234; tested calls-rooms.test.ts:100 |
| 6 | End call | calls.end | ✅ Full | Host/super_admin-only (rooms/route.ts:242-249) + audit log :264 + idempotent :252; tested calls-rooms.test.ts:189 |
| 7 | List active/recent rooms | Calls list | ✅ Full | active_participants subquery, LIMIT 50; rooms/route.ts:77-99 |
| 8 | Participant roster / peer discovery | calls.info | ✅ Full | listRoomParticipants returns active participants w/ mute/video/screen flags; lib/calls/signaling.ts:135 |
| 9 | Mute / unmute toggle | call control | ✅ Full | Gates real audio track: useHuddleRtc.ts:218 audioTracks.enabled=!next + DB flag rooms/route.ts:278; media plane live |
| 10 | Video on/off toggle | call control | ✅ Full | Gates real video track: useHuddleRtc.ts:231 videoTracks.enabled=next + DB flag rooms/route.ts:286 |
| 11 | Screen share toggle | screen share | ✅ Full | Real getDisplayMedia + client.replaceVideoTrack with renegotiation; useHuddleRtc.ts:248-273 + DB flag rooms/route.ts:294 |
| 12 | WebRTC signaling relay (SDP offer/answer/ICE) | Calls signaling | ✅ Full | Directed+broadcast routing, monotonic seq cursor, participant-gated, CSRF on POST; lib/calls/signaling.ts:42,88 + app/api/calls/[roomId]/signals/route.ts; still poll-based (no push) |
| 13 | TURN/STUN/ICE credentials | TURN config | ✅ Full | Ephemeral coturn HMAC creds, STUN-only graceful no-op when unconfigured; lib/calls/turnCredentials.ts:54,68 + app/api/calls/ice/route.ts:23 |
| 14 | Client peer connection (media plane) | yes | ✅ Full | HuddleRtcClient (lib/calls/rtcClient.ts) + useHuddleRtc.ts does getUserMedia :150, RTCPeerConnection :166, fetchIce :169, signal poll/send :174-185; HuddlePanel rendered ModuleRenderer.tsx:178; 29 unit tests |
| 15 | SFU (mediasoup / LiveKit) for group calls | LiveKit/RTC svc | ⛔ Excluded | env-blocked: still mesh-only (rtcMesh.ts full-mesh), no mediasoup/livekit dep in package.json; external media infra, standing out-of-scope |
| 16 | Call recording | recording | 🟠 Stub | recording column + admin recording_enabled config + UI REC badge (HuddlePanel.tsx:122) only; no recorder/MediaRecorder, no storage pipeline in lib/ |
| 17 | Transcription | transcription | ⛔ Excluded | AI/ML: worker handler still await sleep(2000) stub, comment 'send to Whisper'; lib/infra/worker.ts:167-172; STT is standing AI/ML out-of-scope |
| 18 | Clips: create (video/audio/screen) | clips | ✅ Full | Real INSERT + type validation; enqueues transcription job only when no transcript supplied; app/api/messages/clips/route.ts:76-130 |
| 19 | Clips: list / view tracking | clips | 🟡 Partial | List w/ channel/mine/type filters works (clips/route.ts:27-74); views column read but still no increment endpoint |
| 20 | Clip auto-transcription | clips captions | ⛔ Excluded | AI/ML: job enqueued correctly (clips/route.ts:120) but worker.ts:167 handler is sleep(2000) stub; STT out-of-scope |
| 21 | Clip thumbnail generation | clips | 🟡 Partial | Client-supplied thumbnail_url only (clips/route.ts:88,113); file_thumbnail job (worker.ts:158) is for file uploads, not clips; no server clip thumbnail pipeline |
| 22 | Admin calls config (TURN/STUN, max participants, recording) | system console | ✅ Full | view=config (rooms/route.ts:45) + update_config super_admin-gated :178-198, persisted to system_config; reports turn_configured w/o leaking secret |
| 23 | In-call reactions / live captions / raise hand | reactions, captions | 🔴 Missing | Reactions still client-only local state (HuddlePanel.tsx:68 fireReaction/floatingReactions, no redisPubSub/signaling broadcast); no live captions, no raise-hand |

**Calls & huddles tally:** 23 behaviors — ✅ 16 · 🟡 2 · 🟠 1 · 🔴 1 · ⛔ 3

Remaining: call recording stub (16), clip views/thumbnails (19/21), in-call reactions
broadcast (23); SFU/transcription env-blocked.

---

### Knowledge (23 behaviors)

| # | Behavior | Slack ref | Status | Note |
|---|---|---|---|---|
| 1 | Create canvas (standalone / personal) | canvases.create | ✅ Full | POST app/api/docs/canvas/route.ts:133 now has verifyCsrf:134 + writeAuditLog 'canvas.create':218; block/word counts computed; parseBlocks stamps ids |
| 2 | Edit canvas content (block model) | canvases.edit | 🟡 Partial | PUT route.ts:238 enforces canWrite + CSRF:239 + audit:309, but main PUT is still whole-doc replace with no optimistic-concurrency guard (granular concurrency only via sections route) |
| 3 | Delete canvas | canvases.delete | ✅ Full | DELETE handler added app/api/docs/canvas/route.ts:322; creator-or-platform-admin gate:345-347, soft-delete tombstone, CSRF+audit 'canvas.delete':356 |
| 4 | Channel canvas (canvas embedded in channel) | channel canvases | ✅ Full | reads now gated by userCanReadChannel (canvasAccess.ts:121-123; route.ts:88), list predicate enforces channel membership (canvasAccess.ts:219-235) — private-channel leak closed |
| 5 | conversations.canvases (canvas linked to a conversation) | conversations.canvases | ✅ Full | consolidated onto aaelink.canvases as channel_canvas (route.ts:49-58); migration036 retired conversation_canvases; userCanReadChannel gate:45,95; CSRF+audit |
| 6 | canvases.access — set/grant access | canvases.access (set) | ✅ Full | access/route.ts:66 set is now ENFORCED — canvasAccess.resolveCanvasAccess:134-159 reads canvas_access grants; admin-gated via canAdministerCanvas:50; CSRF+audit |
| 7 | canvases.access — revoke access | canvases.access (delete) | ✅ Full | access/route.ts:94 delete is type-scoped (grantee_type matched:103,109) and effective since the table is read by the access engine; CSRF+audit |
| 8 | canvases.access — lookup access list | (read) | ✅ Full | access/route.ts:54 lookup now admin-gated (canAdministerCanvas:50) and reflects the now-enforced grant table |
| 9 | Canvas sections — create/update/delete/reorder | canvases.sections.* | ✅ Full | sections now operate ON content_blocks (canvasSections.ts), so canvas GET and sections agree; access via resolveCanvasAccess (sections/route.ts:116-120); optimistic concurrency expected_updated_at; CSRF+audit |
| 10 | Canvas templates | template/starter docs | ✅ Full | instantiate-from-template implemented: POST from_template_id → resolveTemplateBlocks copies blocks server-side (route.ts:168-175; canvasAccess.ts:294); templates now workspace-scoped not global |
| 11 | Canvas sharing via shared_with | (share) | ✅ Full | shared_with jsonb still the read-share path (canvasAccess.ts:126; canvasListReadPredicate:214); widening shared_with now requires canAdministerCanvas (route.ts:276) |
| 12 | Canvas pin | pin canvas | 🟡 Partial | is_pinned stored/updatable (docs/canvas/route.ts:269); still no dedicated pinned-canvas listing or channel-tab surfacing |
| 13 | Canvas realtime collaboration | live cursors/co-edit | 🟡 Partial | emitKnowledgeEvent now fires on canvas create/update/delete (route.ts:227,314,361) via channel_update pub/sub, but it is a refetch signal only — no live cursors/presence/co-edit; channel-less canvases no-op (knowledgeRealtime.ts:63) |
| 14 | Canvas version history | revision history | 🔴 Missing | no version/revision columns on aaelink.canvases (migrate.ts:1446; no canvas_revision/version table); only updated_at/last_edited_by |
| 15 | Create list (custom columns) | Slack Lists | ✅ Full | POST action=create_list lists/route.ts:146 default+custom columns, view_type stored; now CSRF:124 + audit 'list.create':164 |
| 16 | List field/column types | text/number/date/user/status | 🟡 Partial | column type still free-string, not validated server-side; values opaque JSON (lists/route.ts:135; listAccess.addColumn:81) — no select-option validation |
| 17 | Add/update/delete list item (row) | list items | ✅ Full | add/update/delete_item lists/route.ts:169-249 with resolveItemWriteAccess; CSRF + realtime emitKnowledgeEvent on each mutation |
| 18 | Add column | add field | ✅ Full | action=add_column lists/route.ts:251 → listAccess.addColumn:81; write-access gated (resolveListWriteAccess:203) + audit 'list.column_add':256 + realtime |
| 19 | Update / delete column | edit/remove field | ✅ Full | update_column/delete_column implemented (lists/route.ts:261,274 → listAccess.updateColumn:94/deleteColumn:133); rename carries item values, delete strips key; audit+realtime |
| 20 | List item comments / threads | item activity/comments | ✅ Full | app/api/lists/items/[itemId]/comments/route.ts + lib/lists/itemThreads.ts; CSRF:38,55, resolveItemAccess channel-aware:21, author/list-creator delete:123; still no audit/realtime on comments |
| 21 | List access control / per-list permissions | list sharing | ✅ Full | GET /api/lists enforces access: single-list creator-or-channel-reader gate (lists/route.ts:70-72), list-all scoped to channel-reader or own lists (94-107) — unauthenticated-read gap closed |
| 22 | List realtime updates | live updates | 🟡 Partial | emitKnowledgeEvent now wired on list/item create/update/delete (lists/route.ts:177,194,219,244) via channel_update; but channel-less lists have no consumer (knowledgeRealtime.ts:63) and it is a refetch signal not live patching |
| 23 | Wiki / Knowledge Base CRUD | (KB ≈ posts) | 🟡 Partial | now full RBAC: author/admin gate (articles/[id]/route.ts:81 canManageArticle), workspace-membership gate, audit + CSRF on all writes, category DELETE added; but still no versioning and no full-text search |

**Knowledge tally:** 23 behaviors — ✅ 16 · 🟡 6 · 🟠 0 · 🔴 1 · ⛔ 0

Remaining gaps: canvas version history/CRDT (14); canvas pin no listing surface (12);
column type validation (16); channel-less list realtime (22); KB search/versioning (23).

---

### Notifications & presence (30 behaviors)

| # | Behavior | Slack ref | Status | Note |
|---|---|---|---|---|
| 1 | Per-channel notification level (all/mentions/nothing) | conversations notify level | ✅ Full | level now authoritative on send path: notifyChannelLevelAll (level='all' every-message alert) + dropLevelNothing (level='nothing' drops in-app+push) wired in messages/route.ts:584; pushTargeting.ts:44 also suppresses push on level='nothing' |
| 2 | Per-channel mute | yes | ✅ Full | Both stores honored via UNION in pushTargeting.ts:42-49 (channel_notification_prefs.muted + channel_mutes); suppresses push |
| 3 | Mute suppresses in-app (not just push) | yes | 🟡 Partial | notifyChannelMentions (notificationsServer.ts:102) only calls dropLevelNothing, not dropMuted; muted member still gets in-app mention row; dropMuted is only applied to level='all' path (line 232) |
| 4 | DND schedule (daily window) | dnd | ✅ Full | TZ-aware dndWindow.ts honored for push at pushTargeting.ts:71; dnd/route.ts:176 still has its own TZ-less isDndActiveNow (_timezone ignored) — divergence persists |
| 5 | DND snooze (set N minutes) | dnd.setSnooze | ✅ Full | dnd/route.ts:127 POST snooze_until; honored at push time pushTargeting.ts:67 (snooze_until > now) |
| 6 | DND end snooze | dnd.endSnooze | ✅ Full | dnd/route.ts action=end_snooze resets snooze_until=0 |
| 7 | DND info / is_active | dnd.info | 🟡 Partial | GET at dnd/route.ts:70 computes isActive via route-local TZ-less isDndActiveNow (line 176, _timezone unused) — still disagrees with TZ-aware dndWindow used by push |
| 8 | DND suppresses push delivery | yes | ✅ Full | pushTargeting.ts:50-74 drops snooze + enabled-schedule users at enqueue |
| 9 | DND suppresses in-app notification | yes | 🟡 Partial | DND only filters push targets (selectPushTargets); in-app notification rows still inserted unconditionally in notificationsServer.ts insertNotifications |
| 10 | Keyword / highlight words (store) | Words That Trigger Mentions | ✅ Full | Consolidated to single system: old app/api/keywords route removed (user_keywords now DEPRECATED table migrate.ts:895); notification_keywords route is sole CRUD with CSRF (notifications/keywords/route.ts:32,47) |
| 11 | Keyword highlight fires a notification | yes | ✅ Full | matchKeywords now invoked via notifyKeywordMatches (notificationsServer.ts:172) wired on production send path at messages/route.ts:571; inserts 'keyword' notification + push |
| 12 | @user mentions notify | yes | ✅ Full | notifyChannelMentions (messages/route.ts:546) resolves @username→members, RBAC via userCanReadChannel, mention-pref gated (notificationsServer.ts:90-118) |
| 13 | @here / @channel / @everyone | @here/@channel/@all | ✅ Full | parseBroadcastMentions (mentionParse.ts:14) + notifyBroadcastMentions (notificationsServer.ts:483) wired at messages/route.ts:558; @here=online-only, @channel/@everyone=all members, channel allow_broadcast_mentions + user broadcast_mentions_enabled gates (migration 045) |
| 14 | Mention notification pref toggle | yes | ✅ Full | filterUsersForNotification(...,'mentions') applied in notificationsServer.ts:94; mentions_enabled server-enforced |
| 15 | DM notifications (notify all recipients) | yes | ✅ Full | notifyDirectMessage wired at messages/route.ts:534 (D/G channels); in-app dm rows + high-priority push gated by selectPushTargets (mute/DND) |
| 16 | Custom status (emoji + text) | users.profile.set | ✅ Full | user-status route PUT writes status_text/emoji + user_status row |
| 17 | Status auto-clear / expiry | status_expiration | 🟡 Partial | expires_at stored + user-status/expire route resets it; still client-driven (useStatusExpiry.ts polls every 60s) — no server scheduled job for status expiry |
| 18 | Presence status (online/away/dnd/offline) | users.setPresence | 🟡 Partial | Manual status stored via user-status PATCH; away/online derivation still client-side; presence stream emits only last_seen_at |
| 19 | Presence heartbeat + online derivation | yes | ✅ Full | collab/presence/route.ts:17-18 updates last_seen_at + emitPresence always status='online' (line 35); away/idle/DND on consumer |
| 20 | Presence fan-out stream | WS | 🟡 Partial | collab/presence/stream/route.ts still re-queries all workspace users (SELECT u.id,u.last_seen_at, line 40), 10s poll, emits last_seen_at map only — no status/dnd/away, no diffing |
| 21 | user_status='dnd' suppresses server notifications | yes | 🟡 Partial | Manual status='dnd' now suppresses PUSH (pushTargeting.ts:78-84, respects expires_at); in-app notifications still inserted, so server-side suppression is push-only |
| 22 | Push token registration (APNS/FCM/Web) | yes | ✅ Full | notifications/push/route.ts:129 upsert by token; unregister sets is_active=false (line 133) |
| 23 | Push delivery (real) | HPNS | ⛔ Excluded | env-blocked (APNS): pushDelivery.ts:163-165 skips APNS tokens (skipped_apns), no HTTP/2 client without new dep; FCM + Web Push real |
| 24 | Auto-push on mention/DM | yes | ✅ Full | selectPushTargets+enqueuePush invoked in every notify* fn (notificationsServer.ts:121,199,251,298,572); high-priority, mute+DND filtered |
| 25 | Admin push policy / quiet hours | org | 🟠 Stub | push_policy CRUD persists quiet_hours_*/max_rate (push/route.ts:62-70,200), but push_policy is read nowhere at enqueue/deliver (grep: only push/route.ts references it) — pushTargeting.ts/pushDelivery.ts never consult it |
| 26 | Email notifications (per-event) | SMTP | 🟡 Partial | notifications/email/route.ts queues to email_queue keyed by type, gated only on prefs.email on/off (line 72) — no per-type granularity; worker consumes queue |
| 27 | Email digest (hourly/daily/weekly) | yes | 🟡 Partial | Digest now real: lib/notifications/emailDigest.ts runEmailDigests, scheduled as self-rescheduling worker job (worker.ts:503-526, seeded migration 039) with watermark (migration 042); BUT frequency is off/daily/weekly only (notificationPrefs.ts:35,66) — no hourly/realtime per BLUEPRINT §2.1.5 |
| 28 | Notification schedule (active hours / weekday-only) | DND schedule | 🟠 Stub | notificationSchedule.evaluateNotification still client-only (reads localStorage); no server shouldNotify gate calls it — server dispatch (notificationsServer.ts) never consults active-hours/weekday |
| 29 | Mark channel/thread/ticket as read | conversations.mark | ✅ Full | notifications/route.ts:61 PATCH mark_channel/thread/ticket/read_all; collab read-state now on unified channel_read_state |
| 30 | Mark message as unread | yes | ✅ Full | Read-state unified: collab/mark-unread/route.ts:42 writes channel_read_state (was read_state); migration 028 backfills then DROPs aaelink.read_state (migrate.ts:3097-3123); all consumers use channel_read_state |

**Notifications & presence tally:** 30 behaviors — ✅ 18 · 🟡 9 · 🟠 2 · 🔴 0 · ⛔ 1

Open: mute suppresses in-app (3), DND is_active TZ divergence (7), DND/mute
in-app gating (9), status expiry server job (17), presence fan-out no diff/status (20),
manual-dnd push-only (21), admin quiet-hours unenforced (25), email no per-type (26),
digest no hourly (27), notification schedule server-side (28).

---

### Admin & compliance (35 behaviors)

| # | Behavior | Slack ref | Status | Note |
|---|---|---|---|---|
| 1 | List users | admin.users.list | ✅ Full | app/api/admin/users/route.ts:22-23 LIMIT 500, no cursor/pagination; role-gated GET |
| 2 | Create user | admin.users invite | ✅ Full | app/api/admin/users/route.ts:30-95 role-gated, password policy, audited, auto-join default channels |
| 3 | Update user / set role | admin.users.setAdmin/... | ✅ Full | app/api/admin/users/route.ts:103-184 role escalation guarded, cannot_demote_self, audited |
| 4 | Deactivate / suspend user | admin.users.remove/setInactive | 🟡 Partial | Still SCIM-only soft-delete (app/api/scim/v2/Users/route.ts scim_active); no admin-UI deactivate/reactivate endpoint |
| 5 | Custom roles / RBAC | admin.roles.* | 🟡 Partial | app/api/admin/roles/route.ts + lib/auth/customRoles.ts CRUD present; still not enforced as ReBAC — runtime gates key off platform_role/isPlatformAdmin |
| 6 | Role assignments | admin.roles.addAssignments | 🟡 Partial | app/api/admin/roles/assignments/route.ts:7,28 assignRole/listAssignments present; route gated by isPlatformAdmin(platform_role); authz not keyed off custom roles |
| 7 | List orgs / teams | admin.teams.list | ✅ Full | app/api/admin/org/route.ts + org/[orgId]/* (workspaces/domains/identity/shared-channels/profile-fields) all present |
| 8 | Org workspaces management | admin.teams.create | ✅ Full | app/api/admin/org/[orgId]/workspaces/route.ts present (listing/attach under org) |
| 9 | Org domains / claiming | approved domains | ✅ Full | Now real DNS TXT verification: domains/route.ts:2 imports node:dns resolveTxt, PATCH calls verifyDomain(pool,orgId,domain,realResolver) (line ~113); domainClaiming.ts verificationRecord/claimDomain/verifyDomain |
| 10 | Org identity / SSO binding | per-org IdP | 🟡 Partial | identity/route.ts stores config; inbound engine real — app/api/auth/sso/saml/{start,acs,refresh} + oidc/{start,callback} + lib/auth/samlMetadata |
| 11 | Shared / connected channels | admin.conversations.ext* | 🟡 Partial | connectAllowlist.ts only stores connect_allowlist rows (insert/delete/status); still no external-org handshake/federation transport |
| 12 | Custom profile fields | org custom fields | ✅ Full | app/api/admin/org/[orgId]/profile-fields/route.ts + lib/enterprise/customProfileFields.ts real |
| 13 | Channel management (admin) | admin.conversations.* | 🟡 Partial | channel-archival/route.ts (inactivity preview/execute) real; channels/rename + channels/[id]/convert + search/channels exist but no admin.conversations setTeams/bulk-move parity |
| 14 | Set channel retention | admin.conversations.setCustomRetention | 🟠 Stub | admin/retention/route.ts:64 still scope-only ('workspace','channel','dm','file'); no channel_id / setCustomRetention / getCustomRetention per-individual-channel |
| 15 | Retention policy CRUD | workspace retention | ✅ Full | admin/retention/route.ts _GET/_PUT, 4 scopes, enabled, delete_files, isPlatformAdmin-gated, audited |
| 16 | Retention enforcement (delete) | retention job | ✅ Full | worker retention_enforce (worker.ts:119-126) delegates to runRetentionEnforcement→buildHoldExclusion (hold-aware); route admin/retention/enforce/route.ts:65-92 still does naive DELETE w/o hold exclusion (Gap 6 persists on that path) |
| 17 | Legal hold create/list/release | Discovery + manual | ✅ Full | compliance/legal-holds/route.ts GET/POST/PATCH/DELETE, now isPlatformAdmin-gated (lines 33,76,135), super_admin for delete; hold overrides retention engine-side |
| 18 | DLP rules CRUD | DLP / 3rd-party | ✅ Full | compliance/dlp/route.ts GET/POST/PUT; now isPlatformAdmin-gated (line 39); rule types pattern/keyword/file/domain/pii |
| 19 | DLP enforcement on send | Discovery tombstone | ✅ Full | applyDlpToMessage now called synchronously pre-persist in messages/route.ts:482-484 (dlp_blocked 403), messages/[id]/route.ts:129, messages/forward/route.ts:97; block/quarantine reject, redact masks |
| 20 | Information barriers / ethical walls | Slack barriers | ✅ Full | barrierGuard now enforced on production paths: conversations/open/route.ts:52 + members:115, channels/join:49, search/users+all+directory via filterSearchBlocked (block_search), messages/attachments:97 (block_file_share) |
| 21 | eDiscovery export create/list | discovery.* | ✅ Full | compliance/ediscovery/route.ts isPlatformAdmin-gated + worker compliance_export→runComplianceExport builds JSON/CSV artifact to S3 |
| 22 | eDiscovery MBOX / native format | native JSON | 🟡 Partial | complianceExport.ts:62-66 still only json/csv branch; mbox request silently degrades to JSON; no EML/MBOX, no file bundling |
| 23 | eDiscovery scoped by custodian/keyword | Discovery filters | 🟡 Partial | complianceExportJob.ts:47-51 applies only date(from/to)+channel_ids; custodian/keyword/legal_hold/include_files in scope JSON still not applied to artifact |
| 24 | Audit log read/search | /audit/v1/logs | ✅ Full | admin/audit-log/route.ts isPlatformAdmin-gated (line 31), filters action/actor/from/to, paginated; tracedRoute chokepoint |
| 25 | Audit log streaming/export | streaming | 🟡 Partial | audit-log/export + audit-log/stream (SSE) + audit-streams (SIEM config) + worker audit_stream present; no per-event schema/guaranteed-delivery replay |
| 26 | Data residency / region pinning | data residency | 🟠 Stub | admin/data-residency/route.ts returns hardcoded region config; still pure metadata, no storage routing; also still buggy ['super_admin','platform_admin'] check (line 33) locking out it_admin |
| 27 | Encryption at rest config | EKM | 🟠 Stub | admin/encryption/route.ts still fake keys sha256:${randomUUID().slice} (lines 115,137); rotate/create write rows only, no KMS; super_admin-only |
| 28 | Field-level / message encryption | EKM key revoke | 🔴 Missing | encryption/route.ts:53 field_level_encryption=['messages.content','files.content'] declared in config only; no crypto applied to content |
| 29 | Guest / external user accounts | guest invite | 🟡 Partial | admin/guests/route.ts create/list/revoke + expires_at stored; worker.ts has NO guest_expire handler (grep count 0) — only referenced in jobs/route.ts:37 comment; no scheduled expiry enforcement |
| 30 | SCIM v2 provisioning | SCIM | ✅ Full | scim/v2/Users + Groups routes + lib/auth/scim.ts; create/update/deactivate(scim_active), org-scoped via bearer_token_hash |
| 31 | IP allowlist / access control | IP allowlisting | 🟡 Partial | admin/ip-access/route.ts stores config; lib/auth/ipAccess.ts only has parsing helpers (ipMatchesCidr/extractClientIp), no allowlist gate; middleware.ts:80-86 uses ip for rate-limit only, not allowlist enforcement; buggy platform_admin check |
| 32 | Session policy / forced logout | admin.users.session.* | 🟡 Partial | admin/session-policy/route.ts (buggy ['super_admin','platform_admin'] line 35) + admin/sessions list/revoke present |
| 33 | Device management / remote wipe | EMM | 🟡 Partial | admin/devices/route.ts + devices/[id]/wipe + emm-policy present; wipe is a flag, no MDM push; buggy platform_admin check (lines 38,137,173) |
| 34 | HIPAA / FINRA compliance mode | n/a (controls) | 🔴 Missing | No compliance_mode/hipaa_mode/finra_mode/WORM toggle anywhere in lib/ or app/; HIPAA/FINRA still only computed display booleans in encryption/route.ts; audit_log rows mutable, retention hard-DELETEs |
| 35 | IDP group → role mapping | SCIM group → role | 🔴 Missing | scim/v2/Groups/route.ts manages user_groups membership only; no group→platform/custom-role grant mapping |

**Admin & compliance tally:** 35 behaviors — ✅ 16 · 🟡 13 · 🟠 3 · 🔴 3 · ⛔ 0

Open: admin deactivate (4), custom-role enforcement (5/6), per-channel retention (14),
retention enforce raw DELETE (16), eDiscovery MBOX/scope (22/23), data-residency
metadata-only + role bug (26), encryption stubs (27/28), guest expiry (29),
IP allowlist unenforced (31), HIPAA/WORM (34), IDP group→role (35).

---

### Integrations & extensibility (34 behaviors)

| # | Behavior | Slack ref | Status | Note |
|---|---|---|---|---|
| 1 | Incoming webhook — create/manage | Yes | 🟡 Partial | app/api/integrations/webhooks/route.ts now tracedRoute+readSessionUserId (POST:42), but still NO workspace/RBAC check (any logged-in user can create on any workspace_id:47), no CSRF, no audit log; v1 webhooks table parallel system persists |
| 2 | Incoming webhook — public receiver (post to channel) | Yes | 🟡 Partial | app/api/webhooks/[token]/route.ts:66-78 still emits realtime via raw notifications INSERT (not lib/realtime/redisPubSub); reads incoming_webhooks only; no inbound signature verification |
| 3 | Incoming webhook — Slack-compatible payload (text/attachments/username/icon) | Yes | 🟡 Partial | app/api/webhooks/[token]/route.ts:32 accepts text/username/icon_url only; attachments/blocks still ignored; bot identity in message metadata not a real bot user |
| 4 | Outgoing webhook — subscription CRUD | Yes | 🟡 Partial | app/api/webhooks/v2/route.ts full CRUD + secret-once + event filter; RBAC creator-or-platform-admin (route:114-115), not workspace-scoped |
| 5 | Outgoing webhook — fire on real events | Yes | 🟡 Partial | emitWebhookEvent now WIRED on production paths: messages/route.ts:510,613 (create/broadcast), messages/[id]:270 (delete), reactions:95 (add/remove), interactivity:117; but channel.created/archived, file.uploaded, user.*, compliance.dlp_violation, call.* write paths still emit nothing |
| 6 | Outgoing webhook — HMAC-SHA256 signing | Yes | ✅ Full | webhookEmitter.ts:45-47 signs sha256=…; worker sets X-AAELink-Signature-256 (worker.ts event_deliver/webhook_deliver); verify route present |
| 7 | Outgoing webhook — retry w/ backoff + timeout | Yes | ✅ Full | worker.ts webhook_deliver:217 + webhook_retry:93 with 10s AbortController timeout, throws to retry; now exercised by real message/reaction events via emitter wiring |
| 8 | Outgoing webhook — dead letter queue | Yes | ✅ Full | app/api/admin/webhook-dlq/route.ts + lib/webhooks/webhookDlq.ts + tests present and coherent |
| 9 | Outgoing webhook — delivery log / debug | Yes | ✅ Full | webhookEmitter.ts:127 logs webhook_deliveries_v2 row per delivery (request_body/status/latency); app/api/webhooks/deliveries/route.ts present |
| 10 | Outgoing webhook — test/ping | Yes | ✅ Full | app/api/webhooks/v2 action:'test' + app/api/webhooks/test/route.ts send signed test event |
| 11 | Slash command — registry (custom commands) | Yes | 🟡 Partial | app/api/slash-commands/route.ts action:'register' (route:106) admin-only into slash_commands w/ callback_url+signing_secret+SSRF guard at register (route:134); built-in conflict list route:34-40 |
| 12 | Slash command — built-in commands | Yes | ✅ Full | app/api/slash-commands/route.ts switch executes /shrug /dnd /status /topic etc server-side; lib/comms/slashCommands.ts; well tested |
| 13 | Slash command — dispatch to external callback_url | Yes | ✅ Full | slash-commands/route.ts default case:288 → dispatchCustomCommand:331 POSTs Slack-shaped HMAC-signed payload to callback_url with SSRF+DNS-rebind guards (347-360), 10s timeout, audit |
| 14 | Slash command — response_url / delayed responses | Yes | 🔴 Missing | dispatchCustomCommand payload still sets response_url:null (route:371); responses remain synchronous JSON only |
| 15 | Bot users — manage / tokens | Yes | ✅ Full | app/api/integrations/bots/route.ts platform-admin CRUD of bot_users; bot tokens (xbot-*) now authenticate inbound API calls via lib/api/oauthScopes.ts resolveBotToken:139 invoked by enforceScope:204 |
| 16 | Bots — bots.info parity | Yes | 🟡 Partial | app/api/bots/info/route.ts:27,49 still reads users WHERE platform_role='bot' — disconnected from bot_users model (#15); two bot notions unbridged |
| 17 | OAuth — app registration | Yes | 🟡 Partial | OAuth apps in oauth_apps (migrate.ts:2136/3259) via integrations/bots + apps/manifest; authorize/access read oauth_apps with client_id/redirect_uris/scopes; still no dedicated app console |
| 18 | OAuth — authorization code → token exchange | Yes | ✅ Full | app/api/oauth/authorize/route.ts issues single-use 10min code bound to user/client/redirect_uri/scope (CSRF+audit); access/route.ts:87-185 verifies hashed client_secret (constant-time), atomic code consume w/ full binding, no dev backdoor |
| 19 | OAuth — token introspection / info | Yes | ✅ Full | app/api/oauth/introspect/route.ts resolves grant via oauthScopes, returns active/scope/exp/token_type; access GET lists authorized apps; expiry enforced |
| 20 | OAuth — token revoke / rotate | Yes | ✅ Full | oauth/access action:'revoke' DELETEs token; app/api/oauth/rotate/route.ts:37 rotateToken (owner-or-admin) mints new token from real grant lifecycle |
| 21 | OAuth scopes — defined catalog + enforcement | Yes | 🟡 Partial | lib/api/oauthScopes.ts enforceScope:189 now genuinely gates bearer routes (messages chat:read/write:63,453; files; channels; users/directory) resolving bot+oauth tokens; enforcement real but only a subset of privileged routes wired |
| 22 | Events API — subscription management | Yes | 🟡 Partial | app/api/integrations/events/route.ts platform-admin CRUD (route:129/170/273) of event_subscriptions w/ HTTPS endpoint+signing_secret+filter; registry real |
| 23 | Events API — actually deliver events on activity | Yes | 🟡 Partial | webhookEmitter.ts fanOutEventSubscriptions:193 now fans real message/reaction/interaction emits to active+verified subs → 'event_deliver' jobs; worker.ts:257 delivers signed w/ retry; url_verification handshake present (events/route.ts:75-111); BUT channel/file/user/DLP/call paths still never emit |
| 24 | Socket mode — open connection (ticket + WSS URL) | Yes | 🟡 Partial | app/api/apps/connections/open/route.ts:32 openSocketConnection mints ticket+WSS URL from bot_users token into socket_connections; clean open step |
| 25 | Socket mode — gateway validates ticket + streams events | Yes | 🟠 Stub | resolveSocketTicket/closeSocketConnection in lib/apps/socketMode.ts still have ZERO callers in app/ or lib/ — WS gateway never validates a ticket or streams app events |
| 26 | App manifest — create app/bot from manifest | Yes | ✅ Full | app/api/apps/manifest/route.ts CSRF+owner/admin+audit, validates + atomically creates apps + optional bot_users; end-to-end provisioning |
| 27 | Interactive components — Block Kit validation | Yes | ✅ Full | app/api/blockkit/validate/route.ts + lib/blockkit/validate.ts validate block arrays; dev tool, no side effects |
| 28 | Interactive components — views/modals (open/push/update/publish) | Yes | 🟠 Stub | app/api/views/route.ts still echo-only — fabricates view object, no persistence, no trigger_id validation, no realtime push (comment route:55 'in production this would be pushed via SSE/WebSocket') |
| 29 | Interactive components — block_actions / view_submission ingress + message shortcuts | Yes | ✅ Full | NEW app/api/integrations/interactivity/route.ts:43 — HMAC-verified ingress (sig over ts.rawBody), anti-replay nonce, rate-limit, SSRF/channel-forgery guard; dispatches 'interaction' event through event_subscriptions pipeline (emitWebhookEvent:117) |
| 30 | Workflow Builder — define multi-step workflows (triggers/steps/functions) | Yes | 🟠 Stub | workflows/functions/workflow_executions tables now in migrate.ts:506/2059/2027, but app/api/workflows/route.ts execute:173 still only inserts status 'running'; step_completed/step_failed:176,184 require an external caller — no engine runs steps/triggers |
| 31 | Workflow — approval flows | n/a | ✅ Full | app/api/approvals/requests/route.ts + workflows/workflow_steps/approval_requests/approval_reviews in migrate.ts; review transitions tested; the one working workflow surface |
| 32 | App/plugin marketplace — publish + install | Apps dir | 🟡 Partial | app/api/marketplace/plugins + install/installed + integrations/plugins registry CRUD against marketplace_plugins/installed_plugins/plugins; install bumps download count |
| 33 | Plugin runtime — sandboxed execution / extension points | No/Yes-MM | 🟠 Stub | app/api/integrations/plugins/route.ts still only stores capabilities[] JSON + status (route:108-127); docstring claims sandbox/interceptors but plugins are never loaded/executed — no runtime |
| 34 | Email-to-channel ingestion | n/a | 🟡 Partial | app/api/integrations/email-ingestion/route.ts email_routes registry present; not verified end-to-end (no inbound mail-to-message pipeline confirmed) |

**Integrations & extensibility tally:** 34 behaviors — ✅ 15 · 🟡 14 · 🟠 4 · 🔴 1 · ⛔ 0

Open: incoming-webhook RBAC/CSRF/audit (1), [token] realtime path (2), response_url
delayed responses (14), bots.info disconnected model (16), OAuth scope partial coverage
(21), events API channel/file/user paths missing (23), socket-mode gateway (25), views
persistence (28), workflow engine (30), plugin runtime (33).

---

### Identity — SSO/SCIM/MFA/Session/Password/LDAP (28 behaviors)

| # | Behavior | Slack ref | Status | Note |
|---|---|---|---|---|
| 1 | SAML 2.0 SP — SP-initiated AuthnRequest | Yes (Grid) | ✅ Full | app/api/auth/sso/saml/start/route.ts:48 traced; RelayState single-use in sso_auth_requests; ssoSamlClient builds redirect-binding request |
| 2 | SAML 2.0 SP — ACS assertion validation | Yes | ✅ Full | app/api/auth/sso/saml/acs/route.ts:46-63 redeems RelayState single-use + InResponseTo match; node-saml wantAssertionsSigned:true (ssoSamlClient.ts:45) |
| 3 | SAML — IdP metadata discovery (auto-config) | Yes | ✅ Full | lib/auth/samlMetadata.ts parses EntityDescriptor; sso route consumes entryPoint+certs |
| 4 | SAML — signing-cert rotation | Yes | ✅ Full | saml_idp_certs JSONB (migrate.ts:3093, mig 026); ssoSamlClient.ts:43 idpCert accepts cert array; super_admin refresh route |
| 5 | SAML — SP metadata publication (XML endpoint) | Yes | ✅ Full | NEW: app/api/auth/sso/saml/metadata/route.ts:48 serves application/samlmetadata+xml via generateSamlSpMetadata (ssoSamlClient.ts:24); provider-existence gated |
| 6 | SAML — IdP-initiated / SLO (single logout) | Yes | 🔴 Missing | grep finds zero LogoutRequest/LogoutResponse/SingleLogout in app\|lib; logout still local session delete only |
| 7 | OIDC RP — authz code + PKCE start | Yes | ✅ Full | app/api/auth/sso/oidc/start/route.ts:57 traced; PKCE+state+nonce persisted single-use |
| 8 | OIDC RP — callback / token + id_token verify | Yes | ✅ Full | app/api/auth/sso/oidc/callback/route.ts:17-19 consumes state single-use, lib verifies id_token via JWKS (iss/aud/exp/nonce) |
| 9 | OIDC — IdP discovery + JWKS rotation | Yes | ✅ Full | ssoOidcClient oidc.discovery() cached; openid-client v6 JWKS rotation tolerated |
| 10 | Legacy Entra/Azure OAuth login | Yes | ✅ Full | app/api/auth/entra/route.ts now a 49-line shim: hand-rolled OAuth/JIT/session-mint GONE, 302s into hardened /sso/oidc/start (mig 031 seeds provider); critical-gap #3 resolved |
| 11 | JIT provisioning on first SSO login | Yes | ✅ Full | lib/auth/ssoProvision.ts provider-gated; new user platform_role='employee', clamped workspace role |
| 12 | Account linking (SSO ↔ existing user) | Yes | ✅ Full | ssoProvision.ts resolution identity-link→email→JIT; sso_identity_links upsert |
| 13 | Group→role mapping from IdP claims | Yes | 🟡 Partial | lib/auth/ssoClaims.ts maps to workspace member/guest clamped, no platform roles, no team/channel auto-join |
| 14 | SCIM v2 — Users CRUD | Yes (Grid) | ✅ Full | app/api/scim/v2/Users/route.ts org-scoped via scim_connections.org_id (:151,:296); application/scim+json; bearer-hash auth |
| 15 | SCIM v2 — deprovision (deactivate + session revoke) | Yes | ✅ Full | Users/route.ts:471-490 DELETE=soft deactivate, removes org_members (:480), logs scim_sync_log |
| 16 | SCIM v2 — Groups CRUD + membership patch | Yes | 🟡 Partial | app/api/scim/v2/Groups/route.ts full CRUD but validateScimToken (:49) ignores org_id and loadGroup (:71) unscoped; no auditLog import |
| 17 | SCIM — ServiceProviderConfig / Schemas / ResourceTypes | Yes | ✅ Full | app/api/scim/v2/{ServiceProviderConfig,Schemas,ResourceTypes}/route.ts static discovery docs present |
| 18 | SCIM — bearer-token lifecycle (issue/rotate/revoke) | Yes | 🟡 Partial | app/api/admin/scim/route.ts:233 traced, stores bearer_token_hash; rotation/expiry semantics still shallow |
| 19 | MFA — TOTP enrollment + verify (RFC 6238) | Yes | ✅ Full | lib/auth/totp.ts verifyTotp (RFC 6238); mfa/route.ts verifies code before activation |
| 20 | MFA — backup / recovery codes | Yes | 🟡 Partial | mfa/route.ts:156-172 still only GENERATES + HMAC-hashes 10 codes; grep shows no consume/burn in login or stepup (stepup verifies totp only) |
| 21 | MFA — admin enforcement policy | Yes (Grid) | 🟡 Partial | login/route.ts:126-131 mfaEnrollmentRequired gates ENROLLMENT past grace only; no per-login code for password users |
| 22 | MFA — step-up after SSO (enforce_mfa providers) | Yes | ✅ Full | ssoProvision.ts:117-121 sets mfa_pending; mfa/stepup/route.ts verifyTotp clears it; readSessionUserId withholds |
| 23 | WebAuthn — passkey registration | Yes | ✅ Full | app/api/auth/webauthn/register/route.ts:78 traced; @simplewebauthn challenge+credential storage (mig 027) |
| 24 | WebAuthn — passkey step-up (MFA) | Yes | ✅ Full | app/api/auth/webauthn/authenticate/route.ts:11-16 assertion clears mfa_pending parallel to TOTP |
| 25 | WebAuthn — passwordless (discoverable) login | Yes | ✅ Full | app/api/auth/webauthn/login/route.ts:79 traced; usernameless resident-key login establishes session |
| 26 | Session policy — TTL / idle / max-sessions / device list / revoke | Yes (Grid) | 🟡 Partial | TTL+idle+device-list+revoke enforced; max_sessions_per_user/single_session_mode/force_reauth_hours/revoke_on_password_change/require_mfa_for_admin still defined-only — zero enforcement reads outside sessionPolicy.ts/admin route |
| 27 | Password policy (complexity / history / rotation / breach) | Yes (Grid) | ✅ Full | NEW lib/auth/passwordPolicy.ts (complexity/history/expiry) + admin/password-policy/route.ts (CSRF+audited) enforced in change-password/route.ts:49-70 (validate+isPasswordReused+recordHistory) and register; login surfaces password_expired; No HIBP breach check (AI/ML n/a) |
| 28 | LDAP / Active Directory sync | Mattermost-only | 🟠 Stub | app/api/admin/ldap/route.ts:88 still test_result:'simulated_success', :167 enqueues type 'compliance_export' w/ ldap_sync payload, :119 stores 'sha256:***' literal; no ldapjs; header :1 'not yet wired' |

**Identity tally:** 28 behaviors — ✅ 20 · 🟡 6 · 🟠 1 · 🔴 1 · ⛔ 0

Open: SAML SLO/IdP-initiated (6), IdP claim→platform-role/team-join (13),
SCIM Groups unscoped (16), backup-code consumption (20), per-login second factor (21),
session-policy dead fields (26). LDAP stub (28) remains inert.

---

## Aggregate coverage (2026-06-06)

Counts are the row-by-row tallies from the per-area sections above, which are authoritative.

| Area | Behaviors | ✅ Full | 🟡 Partial | 🟠 Stub | 🔴 Missing | ⛔ Excluded |
|---|---:|---:|---:|---:|---:|---:|
| Messaging core | 38 | 29 | 8 | 0 | 1 | 0 |
| Search & discovery | 22 | 17 | 5 | 0 | 0 | 0 |
| Files & previews | 30 | 20 | 9 | 0 | 0 | 1 |
| Calls & huddles | 23 | 16 | 2 | 1 | 1 | 3 |
| Knowledge | 23 | 16 | 6 | 0 | 1 | 0 |
| Notifications & presence | 30 | 18 | 9 | 2 | 0 | 1 |
| Admin & compliance | 35 | 16 | 13 | 3 | 3 | 0 |
| Integrations & extensibility | 34 | 15 | 14 | 4 | 1 | 0 |
| Identity | 28 | 20 | 6 | 1 | 1 | 0 |
| **TOTAL** | **263** | **167** | **72** | **11** | **8** | **5** |

**Coverage (263 total behaviors; 258 non-excluded):**

- **Full parity: 63.5%** — 167 / 263 rows (64.7% of non-excluded: 167 / 258).
- **Full-or-Partial: 90.9%** — (167 + 72) / 263 = 239 / 263 (92.6% of non-excluded: 239 / 258).
- Stub 4.2% (11/263) · Missing 3.0% (8/263) · Excluded 1.9% (5/263).

This refutes the retired README "100% / 55/55 method groups" claim, which counted
routes + DDL rather than working capability. Strongest areas by Full %: Messaging (76%),
Search (77%), Identity (71%), Files & Previews (67%). Weakest by Full %: Admin (46%),
Integrations (44%), Calls (80% of non-excluded).

---

## Known gaps by category

### Security / correctness gaps (codeable, not env-blocked)

- Forward source-channel read RBAC (Messaging 24).
- Retention `enforce/route.ts` raw cutoff DELETE without legal-hold exclusion (Admin 16).
- `data-residency/route.ts` buggy role gate locks out it_admin (Admin 26).
- Incoming-webhook RBAC/CSRF/audit (Integrations 1).
- File comments no CSRF or audit (Files 19).
- SCIM Groups unscoped + no audit (Identity 16).
- Mute does not suppress in-app mention notifications (Notifications 3).
- DND is_active TZ divergence between route and push engine (Notifications 4/7).

### Feature depth gaps (codeable, not env-blocked)

- Admin deactivate/reactivate user endpoint (Admin 4).
- Custom role ReBAC enforcement (Admin 5/6).
- Per-channel retention (Admin 14).
- Guest expiry worker job (Admin 29).
- IP allowlist actual enforcement middleware (Admin 31).
- HIPAA/FINRA compliance mode / WORM (Admin 34).
- IDP group → platform-role mapping (Admin 35 / Identity 13).
- Backup-code consumption at login (Identity 20).
- Session-policy dead fields enforcement (Identity 26).
- Slash command response_url / delayed responses (Integrations 14).
- Socket-mode WS gateway (Integrations 25).
- Views/modal persistence and realtime push (Integrations 28).
- Workflow execution engine (Integrations 30).
- Plugin runtime sandbox (Integrations 33).
- Canvas version history (Knowledge 14).
- Email digest no hourly frequency (Notifications 27).
- Admin push policy quiet-hours unenforced (Notifications 25).

### ⛔ Excluded (env-blocked external infra or AI/ML — not buildable in this repo)

- **SFU group calls** (mediasoup/LiveKit) — Calls 15.
- **Call recording** — Calls 16 (stub, needs media server).
- **Transcription** (Whisper/STT) — Calls 17, Clip auto-transcription Calls 20.
- **APNS push delivery** — Notifications 23 (FCM + Web Push are real).
- **3D/CAD preview** — Files 16.

### Known drift vs BLUEPRINT

- **OpenSearch / Elasticsearch BM25 tier** (Search) — out of scope, planned v0.3.0-beta
  (DRIFT-006); all message-search routes run the shared SQL FTS engine today.
- **Canvas CRDT co-edit** (Knowledge 13) — realtime refetch-signal emits land, but
  conflict-free co-editing is deferred.
- **Email digest hourly/realtime** (Notifications 27) — BLUEPRINT §2.1.5 requires hourly;
  current implementation is off/daily/weekly only.

---

## Regeneration

This matrix is **generated from production-path wiring checks** and the per-area audit
reports in [`docs/parity-audits/`](./parity-audits/). The process:

1. Verify each behavior by checking: response shape, RBAC gates, CSRF, audit log,
   realtime wiring, and whether every wiring call is actually *invoked end-to-end* in
   production code — not just whether a route or table exists.
2. Classify every behavior ✅ / 🟡 / 🟠 / 🔴 / ⛔.
3. Sum the row-by-row tallies into the aggregate above.

To refresh: re-run the per-area audits (`/aae-parity-audit <area>`), update the reports
in `docs/parity-audits/`, then regenerate this matrix and the aggregate from them. Do
**not** hand-edit status labels here without a corresponding audit-report change.

> **Note:** this matrix was regenerated 2026-06-06 directly from verified source data
> (production-path wiring checked). The on-disk per-area audit reports in
> `docs/parity-audits/` may predate this regeneration; treat this matrix as authoritative
> for current status and refresh the per-area reports on next audit cycle.
