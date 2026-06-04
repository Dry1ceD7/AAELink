# AAELink — Parity reference matrix (audit-derived, regenerated 2026-06-04)

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
is actually *invoked end-to-end* were all checked. The per-area tables are the
**post-delta reconciliation** as of **2026-06-04** (HEAD on
`feat/slack-parity-execution-engine`, after the messaging/search/files/knowledge/
calls/admin/integrations/identity execution-engine deltas landed).

### Status legend

| Status | Meaning |
|--------|---------|
| ✅ **Full** | Behavior works end-to-end with parity-grade RBAC/CSRF/audit/realtime where applicable |
| 🟡 **Partial** | Real path exists but missing depth, scale, policy, pagination, or has a known security/wiring gap |
| 🟠 **Stub** | Surface/registry/UI exists but the behavior does nothing end-to-end (engine present, no caller; or config-only) |
| 🔴 **Missing** | No working implementation; not wired |
| 🚧 **Env-blocked** | Code path real or scaffolded but blocked on external infra/creds not provisionable in this repo (SFU, APNS, LDAP/AD, KMS) |

**"Parity" does not require identical Slack UX** — it means comparable
organizational outcomes for the behavior in that row.

---

## Per-area matrices

### Messaging core (38 behaviors)

| # | behavior | slack-ref | status | note |
|---|---|---|---|---|
| 1 | Send message to channel | chat.postMessage | ✅ Full | +CSRF, +realtime emit now |
| 2 | Send to DM | chat.postMessage (im) | ✅ Full | solid |
| 3 | Send to group DM | chat.postMessage (mpim) | 🟡 Partial | no dedicated group-DM fan-out test |
| 4 | Get channel history (paginated) | conversations.history | ✅ Full | |
| 5 | Thread replies (one level) | chat.postMessage thread_ts | ✅ Full | |
| 6 | Thread broadcast | reply_broadcast=true | 🟡 Partial | inserts duplicate top-level row (now also emits); edits/deletes desync |
| 7 | Edit message | chat.update | 🟡 Partial | NO audit log (Hard Rule #5); only recordMessageEdit. CSRF added |
| 8 | Edit history | (n/a) | ✅ Full | |
| 9 | Delete message | chat.delete | 🟡 Partial | NO audit log; CSRF added; no admin/mod override |
| 10 | Add/remove reaction (toggle) | reactions.add/remove | ✅ Full | +CSRF |
| 11 | List who reacted | reactions.get | 🟡 Partial | LIMIT 20, no pagination |
| 12 | Reactions summary on message | reactions.get | ✅ Full | |
| 13 | Pin message | pins.add | 🟡 Partial | RBAC hole closed by sweep, +CSRF; verify-level, no test |
| 14 | Unpin message | pins.remove | 🟡 Partial | RBAC gate added in sweep, +CSRF; untested |
| 15 | List pins | pins.list | ✅ Full | |
| 16 | Save / bookmark item (personal) | stars.add | ✅ Full | +CSRF |
| 17 | Channel bookmarks bar | bookmarks.add | 🟡 Partial | +CSRF; URL-only, no reorder/folders, RBAC partial |
| 18 | Drafts (server-side) | drafts.* | ✅ Full | |
| 19 | Scheduled message create | chat.scheduleMessage | 🟡 Partial | no CSRF/RBAC channel-check at create |
| 20 | Scheduled messages list | chat.scheduledMessages.list | ✅ Full | |
| 21 | Scheduled message delete/cancel | chat.deleteScheduledMessage | ✅ Full | |
| 22 | Scheduled dispatch (delivery) | (scheduler) | 🟡 Partial | UNAUTHENTICATED endpoint; bypasses notify/push path |
| 23 | Message permalink | chat.getPermalink | 🟡 Partial | has session but NO channel-read RBAC (info leak) |
| 24 | Forward / share message | (UI Forward) | 🟡 Partial | +CSRF +DLP; NO source-read check; only target P gated |
| 25 | In-channel / workspace search | search.messages | ✅ Full | unified FTS engine (ts_rank/ts_headline), ILIKE gone, channel_id filter |
| 26 | Search operators (from:/in:/has:/before:/after:/is:/on:/during:) | search modifiers | ✅ Full | full operator grammar in shared searchEngine.ts |
| 27 | Typing indicator (channel) | (RTM) | ✅ Full | |
| 28 | Typing indicator (thread) | thread typing | 🟡 Partial | DB-poll only, no realtime emit |
| 29 | Read state / mark read | conversations.mark | ✅ Full | unified on channel_read_state (mig 028), split-brain fixed |
| 30 | Mark unread (rewind cursor) | (UI Mark unread) | ✅ Full | repointed to channel_read_state |
| 31 | Unread badge counts | (client/unread API) | ✅ Full | single source table now |
| 32 | Follow / unfollow thread | (subscribe) | 🟡 Partial | is_following from authorship/participation, NOT thread_followers |
| 33 | Threads list view | (Threads pane) | ✅ Full | |
| 34 | Live delivery (push) | RTM/socket | ✅ Full | messages POST now emitMessageCreated (+broadcast emit); not poll-only |
| 35 | Announcement / read-only enforcement | (posting perms) | 🟠 Stub | userCanPostToChannel STILL alias of read; messages POST never checks posting_mode |
| 36 | Post to archived channel blocked | (archived guard) | 🔴 Missing | messages POST does not check channels.archived_at |
| 37 | CSRF on message mutations | (token) | ✅ Full | verifyCsrf swept across send/edit/delete/react/pin/save/forward/bookmarks (fail-closed) |
| 38 | Ephemeral / me-message / postEphemeral | chat.postEphemeral / meMessage | 🔴 Missing | api/chat has no per-recipient persistence model; untested |

**Messaging core:** 38 → ✅ 21 · 🟡 14 · 🟠 1 · 🔴 2 · 🚧 0. Still-open P-grade gaps:
posting-mode/announcement enforcement (35), archived-post guard (36), edit/delete audit
(7/9), unauthenticated scheduled-dispatch (22), permalink channel-read RBAC (23), forward
source-read RBAC (24), thread-follow authority (32).

### Search & discovery (22 behaviors)

| # | behavior | slack-ref | status | note |
|---|---|---|---|---|
| 1 | Full-text message search | search.messages | ✅ Full | single FTS engine behind every message route |
| 2 | File content search | search.files | ✅ Full | real FTS+ts_headline; tests + SearchPanel/highlight consumers added |
| 3 | Combined search (messages+files+people) | search.all | 🔴 Missing | no single endpoint |
| 4 | People search | users.list filter | ✅ Full | fixed 500 (phantom presence→user_status) + 6 tests |
| 5 | Channel search/discovery | channel browse | 🔴 Missing | no search/channels route |
| 6 | from:<user> modifier | yes | ✅ Full | exact username match |
| 7 | in:<#channel> modifier | yes | ✅ Full | modal sends channel_name, engine resolves against readable channels (no-leak) |
| 8 | before:<date> | yes | ✅ Full | |
| 9 | after:<date> | yes | ✅ Full | |
| 10 | on:<date> | yes | ✅ Full | whole-day window; was Missing |
| 11 | during:<month/year> | yes | ✅ Full | during:YYYY / YYYY-MM window; was Missing |
| 12 | has:link | yes | ✅ Full | |
| 13 | has:<file/attachment> | has:file/has:image | 🟡 Partial | generic file/attachment only; no image/video/star/emoji granularity |
| 14 | has:pin / has:reaction | has::emoji: | 🟡 Partial | table bug fixed (message_reactions); still any-reaction, no emoji-specific |
| 15 | is:thread | n/a | ✅ Full | client parser + engine + advanced route |
| 16 | is:saved / is:pinned / is:dm | yes | 🟡 Partial | is:saved + is:pinned parsed+enforced; is:dm still missing |
| 17 | Saved searches (persist) | yes | ✅ Full | |
| 18 | Saved-search alerts on new matches | BLUEPRINT §2.1.4 | ✅ Full | mig 035, savedSearchAlerts.ts watermark drain, worker heartbeat, UI bell |
| 19 | Smart suggestions / autocomplete / typeahead | yes | 🟡 Partial | static chips + saved searches; no recent-history/result/people typeahead |
| 20 | Result highlighting | yes | ✅ Full | server ts_headline, escaped render |
| 21 | Sort by relevance | yes | ✅ Full | relevance/recent/oldest + UI toggle |
| 22 | Sort by recency / pagination | yes | ✅ Full | limit/offset/total |

**Search & discovery:** 22 → ✅ 16 · 🟡 4 · 🟠 0 · 🔴 2 · 🚧 0. Remaining gaps: combined
search.all (3), channel search/discovery (5), has:image granularity (13), emoji-specific
has::reaction: (14), is:dm (16), real typeahead (19). OpenSearch BM25 tier out-of-scope
(DRIFT-006, planned v0.3.0-beta).

### Files & previews (30 behaviors)

| # | behavior | slack-ref | status | note |
|---|---|---|---|---|
| 1 | files.upload (single-shot) | files.upload | 🟡 Partial | persists row always, S3-or-disk via storage abstraction, enqueues scan+index; single 50MB read |
| 2 | getUploadURLExternal (presign) | getUploadURLExternal | 🔴 Missing | no presigned upload endpoint (P3) |
| 3 | completeUploadExternal | completeUploadExternal | 🟡 Partial | attachments bind to canonical file_attachments; no two-phase finalize |
| 4 | resumable/multipart upload | n/a | 🔴 Missing | single formData read, 50MB cap; no chunk/offset/session (P3) |
| 5 | files.list | files.list | ✅ Full | repointed to file_attachments; filters+paging correct |
| 6 | files.info | files.info | ✅ Full | repointed; 404 only on true miss/soft-delete |
| 7 | files.delete | files.delete | ✅ Full | owner-or-platform-admin, CSRF, audit, S3/disk removal, public-link revoke |
| 8 | download / url_private | files (download) | ✅ Full | access ACL, scan gate, backend-resolved bytes, safe headers |
| 9 | thumbnails (server-gen) | thumbnails | 🔴 Missing | column exists + has_thumbnail surfaced, but no generation pipeline (P3) |
| 10 | image preview / lightbox | image preview | ✅ Full | client lightbox wired |
| 11 | PDF preview | pdf preview | 🟡 Partial | canonical table → can_pdf_viewer hint resolves; no rendered inline preview |
| 12 | Office preview | office preview | 🟡 Partial | Office→PDF only in documents subsystem; not auto-wired from chat |
| 13 | code/text preview w/ highlight | code preview | 🟡 Partial | route fixed; can_code_highlight hint resolves; no server highlight renderer |
| 14 | video preview / player | video preview | 🟡 Partial | preview hint resolves; clips subsystem unchanged |
| 15 | audio preview / player | audio preview | 🟡 Partial | same as video |
| 16 | 3D/CAD preview | n/a | 🔴 Missing | no renderer/MIME mapping (out of scope, deferred) |
| 17 | file metadata (dims/dur/EXIF) | file metadata | 🟠 Stub | columns real + surfaced, but no extraction; no EXIF strip |
| 18 | file comments — list | files.comments.list | 🟡 Partial | self-created file_comments, no canonical join, no read check |
| 19 | file comments — add/edit/delete | files.comments | 🟡 Partial | CRUD + author/admin scope; no audit, ad-hoc table |
| 20 | files.sharedPublicURL | files.sharedPublicURL | ✅ Full | uploader-only, CSRF+audit |
| 21 | files.revokePublicURL | files.revokePublicURL | ✅ Full | |
| 22 | public link resolution (no session) | public link | ✅ Full | serves real bytes via storage backend, XSS-safe headers |
| 23 | org public-sharing toggle | EnablePublicLink | ✅ Full | admin policy gate |
| 24 | virus scan (real engine) | scan job | 🟡 Partial | auto-enqueued on upload; clamd not bundled in compose (env) |
| 25 | scan access gate | scan gate | ✅ Full | tested |
| 26 | scan policy admin/queue | scan admin | 🟡 Partial | two policy shapes coexist |
| 27 | retention / auto-delete of files | data retention | 🟠 Stub | field stored, no job enforces it (P3) |
| 28 | file content search (search-inside) | search.files | 🟡 Partial | indexer real (file_index job) auto-enqueued; text-like only — binary/PDF/office extraction deferred |
| 29 | external file refs | files.remote.* | 🟡 Partial | self-creates files_remote, schema drift, no workspace scoping/audit |
| 30 | external storage (S3/MinIO) | S3 backend | ✅ Full | chat bytes route through s3.ts; storage_backend recorded; local fallback for dev |

**Files & previews:** 30 → ✅ 11 · 🟡 13 · 🟠 2 · 🔴 4 · 🚧 0. Remaining gaps are P3-in-flight
(presign 2, resumable 4, thumbnails 9, metadata-extract 17, retention-job 27),
untouched-by-delta (comments 18/19, remote 29, scan-policy 26), or out-of-scope (16).

### Calls & huddles (23 behaviors)

| # | behavior | slack-ref | status | note |
|---|---|---|---|---|
| 1 | Create call room (voice) | calls.add | ✅ Full | INSERT, auto-joins creator as host |
| 2 | Create video call | calls.add (video) | ✅ Full | type=video sets video_on default true |
| 3 | Start/join huddle | Huddles | ✅ Full | one active huddle per channel; dedupes |
| 4 | Join call | calls.participants.add | ✅ Full | capacity check, ON CONFLICT DO NOTHING |
| 5 | Leave call | calls.participants.remove | ✅ Full | sets left_at |
| 6 | End call | calls.end | ✅ Full | RBAC closed: host_or_admin_only 403 |
| 7 | List active/recent rooms | Calls list | ✅ Full | active_participants subquery |
| 8 | Participant roster / peer discovery | calls.info | ✅ Full | listRoomParticipants w/ flags |
| 9 | Mute / unmute toggle | call control | ✅ Full | gates real audio track via rtcClient |
| 10 | Video on/off toggle | call control | ✅ Full | gates real video track |
| 11 | Screen share toggle | screen share | ✅ Full | real getDisplayMedia + replaceVideoTrack |
| 12 | WebRTC signaling relay (SDP/ICE) | Calls signaling | ✅ Full | real relay; live client consumer; still poll-based |
| 13 | TURN/STUN/ICE credentials | TURN config | ✅ Full | ephemeral coturn HMAC creds; consumed by client |
| 14 | Client peer connection (media plane) | yes | ✅ Full | real RTCPeerConnection mesh + getUserMedia + ICE |
| 15 | SFU (mediasoup/LiveKit) group calls | LiveKit/RTC svc | 🚧 Env-blocked | mesh-only client shipped; no SFU; external media infra, v1.0.0-class |
| 16 | Call recording | recording | 🟠 Stub | flag/config/UI only; no recorder/storage pipeline |
| 17 | Transcription | transcription | 🟠 Stub | worker still sleep(2000); "send to Whisper" comment |
| 18 | Clips: create | clips | ✅ Full | INSERT; enqueues transcription job |
| 19 | Clips: list / view tracking | clips | 🟡 Partial | views column read, no increment endpoint |
| 20 | Clip auto-transcription | clips captions | 🟠 Stub | job enqueued; handler stub |
| 21 | Clip thumbnail generation | clips | 🟡 Partial | client-supplied thumbnail_url only; no server pipeline |
| 22 | Admin calls config | system console | ✅ Full | persisted to system_config; super_admin gated |
| 23 | In-call reactions / captions / raise hand | reactions, captions | 🔴 Missing | reactions local-only overlay; no broadcast/captions/raise-hand |

**Calls & huddles:** 23 → ✅ 16 · 🟡 2 · 🟠 3 · 🔴 1 · 🚧 1. Delta closed the entire
1:1/small-mesh media plane (9,10,11,12,13,14) + host-end RBAC (6). Remaining: SFU
(env-blocked), recording/transcription stubs (env-blocked media services), clip
views/thumbnails (P3), in-call reactions broadcast.

### Knowledge (23 behaviors)

| # | behavior | slack-ref | status | note |
|---|---|---|---|---|
| 1 | Create canvas (standalone/personal) | canvases.create | ✅ Full | CSRF+audit+realtime; block model, stable block ids, 413 caps |
| 2 | Edit canvas content (block model) | canvases.edit | ✅ Full | write-access gated; optimistic concurrency; CSRF+audit+realtime |
| 3 | Delete canvas | canvases.delete | ✅ Full | creator/platform-admin soft-delete, audit+emit |
| 4 | Channel canvas | channel canvases | ✅ Full | gated on userCanReadChannel; private-channel leak closed |
| 5 | conversations.canvases | conversations.canvases | ✅ Full | second store retired (mig 036); thin compat over canonical canvases, membership-gated |
| 6 | canvases.access — set/grant | canvases.access (set) | ✅ Full | grant enforced by access engine (was inert); admin-gated, audited |
| 7 | canvases.access — revoke | canvases.access (delete) | ✅ Full | type-scoped revoke, enforced + audited |
| 8 | canvases.access — lookup | (read) | ✅ Full | admin-gated read of the live grant table |
| 9 | Canvas sections CRUD/reorder | canvases.sections.* | ✅ Full | content_blocks; access-gated, optimistic concurrency 409, audit+emit |
| 10 | Canvas templates | template/starter docs | ✅ Full | from_template_id server-side instantiate; workspace-scoped |
| 11 | Canvas sharing via shared_with | (share) | ✅ Full | view-only; only admin may widen audience |
| 12 | Canvas pin | pin canvas | 🟡 Partial | is_pinned updatable; no pinned-canvas listing / channel-tab surface |
| 13 | Canvas realtime collaboration | live cursors/co-edit | 🟡 Partial | realtime emits fire on writes; no presence/cursors/CRDT co-edit |
| 14 | Canvas version history | revision history | 🔴 Missing | no version columns; only updated_at/last_edited_by |
| 15 | Create list (custom columns) | Slack Lists | ✅ Full | create + default/custom columns + view_type |
| 16 | List field/column types | text/number/date/user/status | 🟡 Partial | type/options stored/renamed but NOT validated/enforced server-side |
| 17 | Add/update/delete list item | list items | ✅ Full | row CRUD CSRF+audit+realtime; item-level write access enforced |
| 18 | Add column | add field | ✅ Full | add_column + audit + emit |
| 19 | Update/delete column | edit/remove field | ✅ Full | rename carries values, 409 column_exists, delete strips values; audit+emit |
| 20 | List item comments/threads | item activity/comments | ✅ Full | CSRF + resolveItemAccess; realtime via knowledge emits |
| 21 | List access control | list sharing | ✅ Full | GET access-gated via userCanReadChannel/creator; gap closed |
| 22 | List realtime updates | live updates | ✅ Full | list/item mutations emit channel-scoped events |
| 23 | Wiki/KB CRUD | (KB ≈ posts) | 🟡 Partial | RBAC/workspace/CSRF/audit/categories DELETE added; no versioning, no full-text search |

**Knowledge:** 23 → ✅ 18 · 🟡 4 · 🟠 0 · 🔴 1 · 🚧 0. All audit-critical gaps closed except
canvas version-history/CRDT (14) and knowledge-content search (no canvas/list/KB search
endpoint — search indexes messages only).

### Notifications & presence (30 behaviors)

| # | behavior | slack-ref | status | note |
|---|---|---|---|---|
| 1 | Per-channel notification level (all/mentions/nothing) | conversations notify level | ✅ Full | dropLevelNothing+channelMembersLevelAll+selectPushTargets read level; wired in messages route |
| 2 | Per-channel mute | yes | ✅ Full | mute honored at push via UNION |
| 3 | Mute suppresses in-app (not just push) | yes | 🟡 Partial | dropMuted only for level='all'; plain @mention in-app ungated by mute |
| 4 | DND schedule (daily window) | dnd | ✅ Full | dnd/route reuses TZ-aware isDndActiveNow; divergence resolved |
| 5 | DND snooze | dnd.setSnooze | ✅ Full | |
| 6 | DND end snooze | dnd.endSnooze | ✅ Full | |
| 7 | DND info / is_active | dnd.info | ✅ Full | consistent with push (shared helper) |
| 8 | DND suppresses push delivery | yes | ✅ Full | |
| 9 | DND suppresses in-app notification | yes | 🟡 Partial | push-only; in-app rows written during DND |
| 10 | Keyword / highlight words (store) | Words That Trigger Mentions | 🟡 Partial | user_keywords + notification_keywords coexist; dedupe not done |
| 11 | Keyword highlight fires a notification | yes | ✅ Full | notifyKeywordMatches→matchKeywords wired in messages route; was dead |
| 12 | @user mentions notify | yes | ✅ Full | |
| 13 | @here / @channel / @everyone | @here/@channel/@all | 🔴 Missing | mentionParse @username-only; route broadcast flag is thread-reply, not fan-out |
| 14 | Mention notification pref toggle | yes | ✅ Full | |
| 15 | DM notifications | yes | ✅ Full | |
| 16 | Custom status (emoji + text) | users.profile.set | ✅ Full | |
| 17 | Status auto-clear / expiry | status_expiration | 🟡 Partial | no scheduled purge job confirmed |
| 18 | Presence status (online/away/dnd/offline) | users.setPresence | 🟡 Partial | derivation still client-side |
| 19 | Presence heartbeat + online derivation | yes | ✅ Full | |
| 20 | Presence fan-out stream | WS | 🟡 Partial | 10s full re-query, no status/diff |
| 21 | user_status='dnd' suppresses server notifications | yes | 🟠 Stub | manual dnd status not read server-side; only dnd_settings gates |
| 22 | Push token registration | yes | ✅ Full | |
| 23 | Push delivery (real) | HPNS | 🚧 Env-blocked | FCM+Web real; APNS skipped (skipped_apns), env-blocked |
| 24 | Auto-push on mention/DM | yes | ✅ Full | |
| 25 | Admin push policy / quiet hours | org | 🟠 Stub | push_policy quiet-hours/rate-cap unread by enqueue/deliver |
| 26 | Email notifications (per-event) | SMTP | 🟡 Partial | on/off only |
| 27 | Email digest (hourly/daily/weekly) | yes | 🔴 Missing | no digest aggregation; P3 in flight |
| 28 | Notification schedule (active hours/weekday) | DND schedule | 🟠 Stub | notificationSchedule client-only; not in server dispatch |
| 29 | Mark channel/thread/ticket as read | conversations.mark | ✅ Full | |
| 30 | Mark message as unread | yes | ✅ Full | unified onto channel_read_state; both mark routes write it |

**Notifications & presence:** 30 → ✅ 17 · 🟡 7 · 🟠 3 · 🔴 2 · 🚧 1. Open: broadcast mentions
(13), manual-dnd server suppression (21), admin quiet-hours (25), server schedule (28),
in-app DND/mute gating (3/9), keyword-table dedupe (10), digests (27).

### Admin & compliance (35 behaviors)

| # | behavior | slack-ref | status | note |
|---|---|---|---|---|
| 1 | List users | admin.users.list | ✅ Full | LIMIT 500, no cursor |
| 2 | Create user | admin.users invite | ✅ Full | audited, role-gated |
| 3 | Update user / set role | admin.users.setAdmin/... | ✅ Full | escalation guarded |
| 4 | Deactivate / suspend user | admin.users.remove/setInactive | 🟡 Partial | SCIM-only soft-delete, no admin deactivate/reactivate route |
| 5 | Custom roles / RBAC | admin.roles.* | 🟡 Partial | CRUD exists, not ReBAC-enforced |
| 6 | Role assignments | admin.roles.addAssignments | 🟡 Partial | authz still keyed off platform_role |
| 7 | List orgs / teams | admin.teams.list | ✅ Full | |
| 8 | Org workspaces mgmt | admin.teams.create | ✅ Full | |
| 9 | Org domains / claiming | approved domains | 🟡 Partial | no DNS/TXT verify |
| 10 | Org identity / SSO binding | per-org IdP | 🟡 Partial | entra→sso_providers (mig 031); inbound OIDC/SAML real, per-org binding still config-store |
| 11 | Shared / connected channels | admin.conversations.ext* | 🟡 Partial | no federation transport |
| 12 | Custom profile fields | org custom fields | ✅ Full | |
| 13 | Channel management (admin) | admin.conversations.* | 🟡 Partial | archival real, no rename/convert/setTeams parity |
| 14 | Set channel retention | admin.conversations.setCustomRetention | 🟠 Stub | per-scope not per-channel |
| 15 | Retention policy CRUD | workspace retention | ✅ Full | |
| 16 | Retention enforcement (delete) | retention job | ✅ Full | worker/job path hold-aware; role bug fixed. Gap: enforce/route.ts still raw cutoff DELETE, no hold exclusion |
| 17 | Legal hold create/list/release | Discovery + manual | ✅ Full | reachable by it_admin (role bug fixed) |
| 18 | DLP rules CRUD | DLP / 3rd-party | ✅ Full | reachable by it_admin |
| 19 | DLP enforcement on send | Discovery tombstone | ✅ Full | applyDlpToMessage wired into messages POST, edit, forward, scheduled-dispatch; synchronous block/redact real |
| 20 | Information barriers / ethical walls | Slack barriers | ✅ Full | isBlocked/isDmBlocked enforced in members/open/join/dm → 403 blocked_by_information_barrier |
| 21 | eDiscovery export create/list | discovery.* | ✅ Full | reachable by it_admin |
| 22 | eDiscovery MBOX / native | native JSON | 🟡 Partial | buildArtifact json/csv only, mbox degrades to JSON |
| 23 | eDiscovery scoped by custodian/keyword | Discovery filters | 🟡 Partial | exports by date+channel_ids only; custodian/keyword/legal_hold/include_files not applied |
| 24 | Audit log read/search | /audit/v1/logs | ✅ Full | |
| 25 | Audit log streaming/export | streaming | 🟡 Partial | |
| 26 | Data residency / region pinning | data residency | 🟠 Stub | metadata only; data-residency/route.ts:33 still buggy role gate |
| 27 | Encryption at rest config | EKM | 🚧 Env-blocked | KMS at-rest env-blocked; no real crypto |
| 28 | Field-level / message encryption | EKM key revoke | 🚧 Env-blocked | config-only, no crypto applied |
| 29 | Guest / external user accounts | guest invite | 🟡 Partial | guest_expire worker job not implemented (P3) |
| 30 | SCIM v2 provisioning | SCIM | ✅ Full | |
| 31 | IP allowlist / access control | IP allowlisting | 🟡 Partial | |
| 32 | Session policy / forced logout | admin.users.session.* | 🟡 Partial | |
| 33 | Device management / remote wipe | EMM | 🟡 Partial | wipe is a flag, no MDM push |
| 34 | HIPAA / FINRA compliance mode | n/a (controls) | 🔴 Missing | no compliance_mode, no WORM/17a-4 |
| 35 | IDP group → role mapping | SCIM group → role | 🔴 Missing | no mapping |

**Admin & compliance:** 35 → ✅ 15 · 🟡 14 · 🟠 2 · 🔴 2 · 🚧 2. #19 DLP-send and #20 barriers
landed as real synchronous enforcement (was Stub). Still open: retention enforce raw
un-hold-aware DELETEs (16), eDiscovery scope/MBOX (22/23), admin deactivate (4),
guest_expire (29), compliance-mode/WORM (34), data-residency role-gate bug (26).

### Integrations & extensibility (34 behaviors)

| # | behavior | slack-ref | status | note |
|---|---|---|---|---|
| 1 | Incoming webhook — create/manage | Yes | 🟡 Partial | POST has no RBAC/audit/CSRF (only readSessionUserId); two parallel tables |
| 2 | Incoming webhook — public receiver | Yes | 🟡 Partial | [token] emits via raw notifications INSERT, not lib/realtime (Rule #6) |
| 3 | Incoming webhook — Slack-compatible payload | Yes | 🟡 Partial | text/username/icon only; attachments/blocks ignored |
| 4 | Outgoing webhook — subscription CRUD | Yes | 🟡 Partial | registry; RBAC creator-or-platform-admin, not workspace-scoped |
| 5 | Outgoing webhook — fire on real events | Yes | 🟡 Partial | emitWebhookEvent/emitMessageCreated/Deleted/reaction wired into message+reaction paths; channels/files/users/DLP emitters still callerless |
| 6 | Outgoing webhook — HMAC-SHA256 signing | Yes | ✅ Full | |
| 7 | Outgoing webhook — retry w/ backoff + timeout | Yes | 🟡 Partial | worker exercised by real events; gated by #5 breadth |
| 8 | Outgoing webhook — DLQ | Partial | ✅ Full | |
| 9 | Outgoing webhook — delivery log/debug | Yes | ✅ Full | |
| 10 | Outgoing webhook — test/ping | Yes | ✅ Full | |
| 11 | Slash command — registry | Yes | 🟡 Partial | admin-only register, conflict detection |
| 12 | Slash command — built-ins | Yes | ✅ Full | |
| 13 | Slash command — dispatch to callback_url | Yes | 🟠 Stub | "actual webhook dispatch in future"; never POSTs callback |
| 14 | Slash command — response_url/delayed | Yes | 🔴 Missing | |
| 15 | Bot users — manage/tokens | Yes | 🟡 Partial | no bot-token auth middleware on inbound API |
| 16 | Bots — bots.info parity | Yes | 🟡 Partial | two disconnected bot models |
| 17 | OAuth — app registration | Yes | 🟡 Partial | apps via bot_users/manifest; backs real authorize flow (oauth_apps); no console |
| 18 | OAuth — code→token exchange | Yes | ✅ Full | real flow: oauth/authorize issues single-use 10-min codes (mig 029), oauth/access atomically consumes, binds client_id+redirect_uri, finite TTL, audited. No PKCE |
| 19 | OAuth — introspection/info | Yes | 🟡 Partial | introspect reads grant + expiry; scopes not enforced on calls |
| 20 | OAuth — revoke/rotate | Yes | 🟡 Partial | ties to real grant lifecycle; rotate/revoke wiring unchanged |
| 21 | OAuth scopes — catalog + enforcement | Yes | 🟠 Stub | catalog tested; no route enforces an oauth_token/bot scope |
| 22 | Events API — subscription management | Yes | 🟡 Partial | real registry |
| 23 | Events API — deliver on activity | Yes | 🟡 Partial | fanOutEventSubscriptions dispatches from emit pipeline (mig 030) + worker delivers; URL-verification challenge handshake absent |
| 24 | Socket mode — open connection | Yes | 🟡 Partial | |
| 25 | Socket mode — gateway validates ticket + streams | Yes | 🟠 Stub | resolveSocketTicket/closeSocketConnection zero callers |
| 26 | App manifest — create app/bot | Yes | ✅ Full | |
| 27 | Interactive — Block Kit validation | Yes | ✅ Full | |
| 28 | Interactive — views/modals (open/push/update) | Yes | 🟠 Stub | views/dialog echo-only, no persist/realtime push |
| 29 | Interactive — block_actions/view_submission ingress + shortcuts | Yes | 🔴 Missing | no /api/interactions; grep empty (P3) |
| 30 | Workflow Builder — multi-step | Yes | 🟠 Stub | CRUD-only, tables in-handler, no engine |
| 31 | Workflow — approval flows | n/a | ✅ Full | |
| 32 | App/plugin marketplace — publish+install | Apps dir | 🟡 Partial | registry CRUD |
| 33 | Plugin runtime — sandboxed execution | No/Yes-MM | 🟠 Stub | stored, never executed |
| 34 | Email-to-channel ingestion | n/a | 🟡 Partial | registry present, not verified e2e |

**Integrations & extensibility:** 34 → ✅ 9 · 🟡 17 · 🟠 6 · 🔴 2 · 🚧 0. Delta closed OAuth
code-exchange (18); outgoing-webhook fire (5) and Events API dispatch (23) lifted
Stub→Partial. Not closed: incoming-webhook RBAC/audit/CSRF (1), [token] realtime (2),
slash callback dispatch (13), socket-mode gateway (25), views persistence (28),
interactivity ingress (29, P3), scope enforcement (21), workflow/plugin engines (30/33).

### Identity (28 behaviors)

| # | behavior | slack-ref | status | note |
|---|---|---|---|---|
| 1 | SAML SP — SP-initiated AuthnRequest | Yes (Grid) | ✅ Full | redirect-binding AuthnRequest, single-use RelayState |
| 2 | SAML SP — ACS assertion validation | Yes | ✅ Full | node-saml sig/audience/timing + InResponseTo replay check |
| 3 | SAML — IdP metadata discovery | Yes | ✅ Full | EntityDescriptor → entryPoint + signing certs |
| 4 | SAML — signing-cert rotation | Yes | ✅ Full | saml_idp_certs[], super_admin-gated + audited |
| 5 | SAML — SP metadata publication (XML) | Yes | 🔴 Missing | no SP-metadata XML endpoint |
| 6 | SAML — IdP-initiated / SLO | Yes | 🔴 Missing | SP-initiated only, local logout |
| 7 | OIDC RP — authz code + PKCE start | Yes | ✅ Full | openid-client v6, PKCE S256 + state + nonce |
| 8 | OIDC RP — callback / id_token verify | Yes | ✅ Full | JWKS sig + iss/aud/exp/nonce, state single-use |
| 9 | OIDC — discovery + JWKS rotation | Yes | ✅ Full | discovery cached 1h, JWKS rotation tolerated |
| 10 | Legacy Entra/Azure OAuth login | Yes | ✅ Full | hand-rolled flow GONE; route 302s into hardened OIDC RP; sso_configs seeded into sso_providers (mig 031) |
| 11 | JIT provisioning on first SSO login | Yes | ✅ Full | platform_role='employee', clamped workspace role |
| 12 | Account linking (SSO ↔ user) | Yes | ✅ Full | link → email-adopt → JIT |
| 13 | Group→role mapping from IdP claims | Yes | 🟡 Partial | workspace member/guest only, no team/channel auto-join |
| 14 | SCIM v2 — Users CRUD | Yes (Grid) | ✅ Full | RFC-7644, org-scoped, bearer-hash auth |
| 15 | SCIM v2 — deprovision | Yes | ✅ Full | soft deactivate + session revoke + sync log |
| 16 | SCIM v2 — Groups CRUD + membership | Yes | 🟡 Partial | not org-scoped, not auditLog'd |
| 17 | SCIM — ServiceProviderConfig/Schemas/ResourceTypes | Yes | ✅ Full | static discovery docs |
| 18 | SCIM — bearer-token lifecycle | Yes | 🟡 Partial | token-hash + org binding; rotation/expiry depth unverified |
| 19 | MFA — TOTP enroll + verify | Yes | ✅ Full | RFC 6238, code verified before activation |
| 20 | MFA — backup / recovery codes | Yes | 🟡 Partial | generate-only, no verify/burn path |
| 21 | MFA — admin enforcement policy | Yes (Grid) | 🟡 Partial | gates enrollment, not per-login second factor for password users |
| 22 | MFA — step-up after SSO | Yes | ✅ Full | mfa_pending (mig 025) gated by readSessionUserId |
| 23 | WebAuthn — passkey registration | Yes | ✅ Full | @simplewebauthn, challenge + credential store |
| 24 | WebAuthn — passkey step-up | Yes | ✅ Full | assertion clears mfa_pending |
| 25 | WebAuthn — passwordless login | Yes | ✅ Full | resident-key usernameless login |
| 26 | Session policy — TTL/idle/max/device/revoke | Yes (Grid) | 🟡 Partial | require_mfa_for_admin/max_sessions/single_session/force_reauth/revoke_on_password_change still dead |
| 27 | Password policy | Yes (Grid) | 🔴 Missing | no passwordPolicy.ts, no complexity/history/HIBP (P3 in-flight) |
| 28 | LDAP / AD sync | Mattermost-only | 🚧 Env-blocked | code stub (simulated_success); no ldapjs; needs LDAP client + directory |

**Identity:** 28 → ✅ 18 · 🟡 6 · 🟠 0 · 🔴 3 · 🚧 1. #10 Entra retired into hardened OIDC RP;
#28 LDAP reclassified env-blocked (0 stubs remain). Missing: SP-metadata XML (5),
IdP-initiated/SLO (6), password policy (27). Open partials: backup-code consumption (20),
session-policy dead fields (26), per-login second factor (21).

---

## Aggregate coverage (2026-06-04)

Counts are the sum of per-row statuses in the tables above (not area-summary prose,
which had minor internal miscounts; the row-by-row tally is authoritative).

| Area | Behaviors | ✅ Full | 🟡 Partial | 🟠 Stub | 🔴 Missing | 🚧 Env-blocked |
|---|---:|---:|---:|---:|---:|---:|
| Messaging core | 38 | 21 | 14 | 1 | 2 | 0 |
| Search & discovery | 22 | 16 | 4 | 0 | 2 | 0 |
| Files & previews | 30 | 11 | 13 | 2 | 4 | 0 |
| Calls & huddles | 23 | 16 | 2 | 3 | 1 | 1 |
| Knowledge | 23 | 18 | 4 | 0 | 1 | 0 |
| Notifications & presence | 30 | 17 | 7 | 3 | 2 | 1 |
| Admin & compliance | 35 | 15 | 14 | 2 | 2 | 2 |
| Integrations & extensibility | 34 | 9 | 17 | 6 | 2 | 0 |
| Identity | 28 | 18 | 6 | 0 | 3 | 1 |
| **TOTAL** | **263** | **141** | **81** | **17** | **19** | **5** |

**Coverage:**

- **Full parity: 53.6%** — 141 / 263.
- **Full-or-Partial: 84.4%** — (141 + 81) / 263 = 222 / 263.
- Stub 6.5% (17/263) · Missing 7.2% (19/263) · Env-blocked 1.9% (5/263).

This refutes the retired README "100% / 55/55 method groups" claim, which counted
routes + DDL rather than working capability. Strongest areas: Knowledge, Identity,
Notifications, Calls. Weakest by Full %: Integrations (26% full), Files (37%), Admin (43%).

---

## Known gaps

### P3 — features in flight (codeable, scoped, not yet landed)
- **Password policy** object + enforcement (Identity 27).
- **Email digests** hourly/daily/weekly aggregation (Notifications 27).
- **Interactivity ingress** — `/api/interactions` for block_actions/view_submission/shortcuts (Integrations 29).
- **File presign / resumable upload / thumbnail pipeline / metadata extraction / file-retention job** (Files 2/4/9/17/27).
- **Clip view-increment + server thumbnail** (Calls 19/21).
- Backup-code consumption (Identity 20); session-policy enforcement of dead fields (Identity 26).

### 🚧 Env-blocked (need external infra/creds, not buildable in this repo)
- **SFU group calls** (mediasoup/LiveKit) + **call recording** + **transcription** (Calls 15/16/17/20) — media server.
- **APNS push delivery** (Notifications 23) — Apple HTTP/2 + creds; FCM + Web Push are real.
- **LDAP / AD sync** (Identity 28) — LDAP client + directory.
- **KMS encryption-at-rest** + field-level encryption (Admin 27/28) — external key service.

### Known drift vs BLUEPRINT
- **OpenSearch / Elasticsearch BM25 tier** (Search) — out of scope, planned **v0.3.0-beta** (DRIFT-006). The four message-search routes run the shared SQL FTS engine today.
- **Canvas version history / CRDT co-edit** (Knowledge 14, 13) — realtime emits land, but revision history and conflict-free co-editing are deferred.

### Still-open security/correctness (not env-blocked, not yet fixed)
- Edit/delete message audit logging (Messaging 7/9).
- Unauthenticated scheduled-dispatch endpoint (Messaging 22).
- Permalink + forward source-channel read RBAC (Messaging 23/24).
- Posting-mode/announcement + archived-channel post guards (Messaging 35/36).
- Retention `enforce/route.ts` raw cutoff DELETE without legal-hold exclusion (Admin 16).
- `data-residency/route.ts` buggy role gate (Admin 26).
- Incoming-webhook RBAC/audit/CSRF (Integrations 1).

---

## Regeneration

This matrix is **generated from the per-area audit reports in
[`docs/parity-audits/`](./parity-audits/)** — one report per Slack/Mattermost parity
area, plus a master `SUMMARY.md`. The process:

1. Audit each area trusting code over docs: verify response shape, RBAC, CSRF, audit,
   realtime, and whether the wiring is actually *called* end-to-end.
2. Classify every behavior ✅ / 🟡 / 🟠 / 🔴 / 🚧.
3. Reconcile against the latest execution-engine delta (post-delta status).
4. Sum the row-by-row tallies into the aggregate above.

To refresh: re-run the per-area audits (`/aae-parity-audit <area>`), update the reports
in `docs/parity-audits/`, then regenerate this matrix and the aggregate from them. Do
**not** hand-edit status labels here without a corresponding audit-report change.

> **Drift note (2026-06-04):** the on-disk audit reports are dated 2026-06-03 and
> tally 260 behaviors at ~32% Full — they predate the P0/P1/P2 closing commits. This
> matrix applies that delta on top (3 behaviors were added during reconciliation:
> Notifications 28→30, Identity 27→28), which is why it reads 263 / 53.6%. Literally
> re-running step 1 from the stale reports reproduces the old numbers; refresh the
> per-area reports first.

The exhaustive pillar-by-pillar map (with `Target (semver)` planning bands) lives at
[`parity-slack-mattermost-aaelink-full-map.md`](./parity-slack-mattermost-aaelink-full-map.md);
its status column is regenerated from the same audits.
