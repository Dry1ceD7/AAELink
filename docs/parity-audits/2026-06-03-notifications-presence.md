# Parity Audit — Notifications & Presence
Date: 2026-06-03
Auditor: Claude

## Summary
- Coverage: 26 / 28 behaviors have *some* implementation; only 11 are full parity.
- Full (✅): 11 | Partial (🟡): 9 | Stub/dead (🟠): 4 | Missing (🔴): 4
- Headline: the **storage layer is broad** (per-channel prefs, mute, DND schedule+snooze, keywords x2, custom status, presence, push tokens, FCM delivery), but the **dispatch/enforcement layer is thin**. Several prefs are persisted yet never consulted at send time, and two parallel implementations exist for both keywords and read-state, only one of which is wired.

Trust-code notes vs README/matrix: the reference matrix marks per-channel mute, DND, keywords, push, email all "Shipped". Code shows: keyword *delivery* is dead code; channel-pref `level` is stored but ignored; notification schedule is client-only; APNS cannot deliver; there are two divergent read-state tables.

## Behavior Matrix

| # | Behavior | Slack | Mattermost | AAELink Route / lib | Test | Level | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Per-channel notification level (all/mentions/nothing) | yes | yes (notify_props.mark_unread/desktop) | `app/api/channel-prefs/route.ts:7,26,60` (`channel_notification_prefs.level`) | none for level | 🟠 | `level` column persisted but **never read in dispatch**. `pushTargeting.ts:41` only checks `muted`. `level='all'`/`'nothing'` have no effect on what notifications fire. |
| 2 | Per-channel mute | yes | yes | `app/api/channels/mute/route.ts` (`channel_mutes`) + `channel_notification_prefs.muted` | `tests/channelMute.test.ts` | ✅ | Two storage sources both honored at push time via UNION in `pushTargeting.ts:40-47`. Suppresses **push only**; in-app mention notification still inserted. |
| 3 | Mute suppresses in-app (not just push) | yes | yes | — | — | 🟡 | `notifyChannelMentions` (`notificationsServer.ts:92-114`) inserts in-app rows before computing push targets; mute does not gate the in-app notification, only the push. |
| 4 | DND schedule (daily window) | yes (dnd) | yes | `app/api/dnd/route.ts` (`dnd_settings`) + `lib/notifications/dndWindow.ts` | `tests/dndSchedule.test.ts`, `tests/dndWindow.test.ts` | ✅ | TZ-aware via `Intl` in `dndWindow.ts`; honored for push in `pushTargeting.ts:50-72`. Note route's own `isDndActiveNow` (`dnd/route.ts:176`) ignores timezone — divergent from the shared helper. |
| 5 | DND snooze (set N minutes) | yes (dnd.setSnooze) | yes | `app/api/dnd/route.ts:127` POST `snooze_until` | covered indirectly | ✅ | Cap 1–1440 min. Honored at push time (`pushTargeting.ts:65`). |
| 6 | DND end snooze | yes (dnd.endSnooze) | yes | `app/api/dnd/route.ts:141` action=`end_snooze` | — | ✅ | Resets `snooze_until=0`. |
| 7 | DND info / is_active | yes (dnd.info) | yes | `app/api/dnd/route.ts:24` GET (`is_active`,`is_snoozed`) | — | 🟡 | GET works, but the route's local-time `isDndActiveNow` (no TZ) disagrees with the TZ-aware `dndWindow.ts` used by push — same user can read `is_active:false` while push is suppressed (or vice versa). |
| 8 | DND suppresses push delivery | yes | yes | `lib/notifications/pushTargeting.ts:50-74` | — | ✅ | |
| 9 | DND suppresses in-app notification | yes | yes | — | — | 🟡 | DND only filters push targets; in-app `notifications` rows still written during DND. |
| 10 | Keyword / highlight words (store) | yes | yes (Words That Trigger Mentions) | TWO impls: `app/api/keywords/route.ts` (`user_keywords` JSON blob) **and** `app/api/notifications/keywords/route.ts` → `lib/notifications/keywords.ts` (`notification_keywords` table, D11, migration 017) | `__tests__/api/notification-keywords.test.ts` | 🟡 | Two parallel keyword systems with separate tables. CRUD works on both; CSRF only on the D11 route. |
| 11 | Keyword highlight **fires a notification** | yes | yes | `matchKeywords()` defined `lib/notifications/keywords.ts:79` | unit-tested in isolation | 🟠 | `matchKeywords` is **never called** in the message dispatch path (`grep` shows only the def + its own test). No keyword notification is ever produced. Dead delivery. |
| 12 | @user mentions notify | yes | yes | `notifyChannelMentions` + `lib/messaging/mentionParse.ts` | `__tests__/api/notifications.test.ts`, `notificationsServer.test.ts` | ✅ | Resolves @username → workspace members, RBAC-checked via `userCanReadChannel`, mention-pref gated. |
| 13 | @here / @channel / @everyone | yes | yes (@here/@channel/@all) | — | — | 🔴 | `mentionParse.ts:2` treats `here`/`channel`/`everyone` as literal usernames. No broadcast-mention fan-out exists. |
| 14 | Mention notification pref toggle | yes | yes | `app/api/auth/notification-prefs/route.ts` + `notificationPrefs.ts` (`mentions_enabled`) | `tests/notificationPrefs.test.ts` | ✅ | Server-enforced in `filterUsersForNotification` (`notificationsServer.ts:92`). |
| 15 | DM notifications (notify all recipients) | yes | yes | `notifyDirectMessage` (`notificationsServer.ts:133`), wired `app/api/messages/route.ts:494` | `notificationsServer.test.ts` | ✅ | In-app + high-priority push to all DM members; push respects mute/DND. |
| 16 | Custom status (emoji + text) | yes (users.profile.set) | yes | `app/api/user-status/route.ts:70` PUT (`status_text`,`status_emoji`) | — | ✅ | Writes `users.status_text/emoji` + `user_status` row. |
| 17 | Status auto-clear / expiry | yes (status_expiration) | partial | `app/api/user-status/route.ts:86` (`expires_at`) + `app/api/user-status/expire/route.ts` | `tests/useStatusExpiry.test.ts` | 🟡 | Expiry stored and an expire route exists; no scheduled job confirmed to purge — relies on client/expire endpoint being hit. |
| 18 | Presence status (online/away/dnd/offline) | yes (users.setPresence) | yes | `app/api/user-status/route.ts` PATCH (`user_status.status`) | — | 🟡 | Manual status stored, but the away/online *derivation* is client-side (`usePresenceListener`); server presence stream only emits `last_seen_at`. |
| 19 | Presence heartbeat + online derivation | yes | yes | `app/api/collab/presence/route.ts` POST heartbeat → `users.last_seen_at` + Redis emit | `tests/collabPresenceEmit.test.ts`, `usePresenceHeartbeat.test.ts` | ✅ | Heartbeat always emits `online`; away/idle/DND applied on consumer (`emitPresence` comment, `presence/route.ts:31`). |
| 20 | Presence fan-out stream | yes (WS) | yes (WS) | `app/api/collab/presence/stream/route.ts` SSE (10s poll) + `redisPubSub` presence topic | — | 🟡 | SSE works but `presence/stream` re-queries **all** workspace users every 10s (no diffing/scale path); status (dnd/away) not included, only `last_seen_at` map. |
| 21 | `user_status='dnd'` suppresses server notifications | yes | yes | — | — | 🟠 | The manual `dnd` status (`user_status`) is **not** consulted server-side; only the separate `dnd_settings` schedule/snooze gates push. A user setting status=dnd still receives push. |
| 22 | Push token registration (APNS/FCM/Web) | yes | yes (push proxy) | `app/api/notifications/push/route.ts:119` (`push_tokens`) | `__tests__/api/push-enqueue.test.ts` | ✅ | Per-device upsert by token; unregister sets inactive. |
| 23 | Push delivery (real) | yes | yes (HPNS) | `lib/notifications/pushDelivery.ts` (FCM HTTP v1) + `fcmAuth.ts` | `tests/pushDelivery.test.ts` | 🟡 | FCM delivery real (web rides FCM). **APNS cannot deliver** — `pushDelivery.ts:163` skips APNS tokens (`skipped_apns`, no HTTP/2 client/dep). iOS push is non-functional. |
| 24 | Auto-push on mention/DM | yes | yes | `notificationsServer.ts:117,164` → `selectPushTargets`+`enqueuePush` | `__tests__/api/auto-push.test.ts`, `push-enqueue.test.ts` | ✅ | Added this session (846c86cd). High-priority, mute+DND filtered. |
| 25 | Admin push policy / quiet hours | yes (org) | yes | `app/api/notifications/push/route.ts:62,180` (`system_config.push_policy`) | — | 🟠 | Policy CRUD persists `quiet_hours_*` + `max_rate_per_user_per_hour`, but `enqueuePush`/`deliverPush` **never read `push_policy`** — quiet hours and rate cap are not enforced. Stub config. |
| 26 | Email notifications (per-event) | yes | yes (SMTP) | `app/api/notifications/email/route.ts` (`email_queue`) + `notifications/email/templates` | — | 🟡 | Queues, checks `users.notification_prefs.email`. Worker consumes queue; no per-type granularity beyond on/off. |
| 27 | Email digest (hourly/daily/weekly) | yes | yes | — | — | 🔴 | No digest aggregation/scheduling. `grep digest` finds nothing in notification path. BLUEPRINT §2.1.5 mandates configurable realtime/hourly/daily/weekly. |
| 28 | Notification schedule (active hours / weekday-only) | yes (Slack DND schedule) | yes | `lib/notifications/notificationSchedule.ts` `evaluateNotification` | `tests/notificationSchedule.test.ts` | 🟠 | **Client-side only** (reads `localStorage` prefs via `notificationClient.ts:47`). Server dispatch never calls it, so schedule/weekday/mute-sound do not gate server-generated notifications or push. |
| 29 | Mark channel/thread/ticket as read | yes (conversations.mark) | yes | `app/api/notifications/route.ts:61` PATCH (mark_channel/thread/ticket/read_all) + `collab/read-state` | `tests/useReadState.test.ts` | ✅ | Granular notification mark-read is solid. |
| 30 | Mark message as unread | yes | yes | `app/api/collab/mark-unread/route.ts` | — | 🟠 | Writes to `aaelink.read_state`; but `collab/read-state` (advance) and `threads`/`channels` routes write/read `aaelink.channel_read_state`. **Two divergent tables** — marking unread in one table does not affect the cursor the sidebar/threads use. Likely broken mark-unread. See Critical Gaps. |

(28 distinct "behaviors" counted for the summary; rows 1–28 map to the brief's enumerated set, rows 29–30 fold read-state into behavior #"mark-as-read".)

## Critical Gaps (severity-ordered)

1. **Keyword highlights never fire (🟠 dead delivery).** `matchKeywords` (`lib/notifications/keywords.ts:79`) is fully implemented and unit-tested but is **not invoked anywhere** in `app/api/messages/route.ts` or `notificationsServer.ts`. Users can add keywords (two different UIs/tables, `user_keywords` and `notification_keywords`) and nothing ever notifies them. Matrix claims "Shipped". Real state: store-only.

2. **Two read-state tables → mark-as-unread is effectively broken.** `collab/mark-unread/route.ts:34` and `conversations/mark`, `channels/dm`, `channels/unread`, `workspaces/switcher` use `aaelink.read_state`; while `collab/read-state/route.ts:33`, `threads/route.ts:89`, `channels/route.ts:53`, `bootstrap` use `aaelink.channel_read_state`. Both tables are created in `lib/migrate.ts` (lines 140 and 777/2193). Read-cursor advances and unread badges are split across two stores; "mark unread" writes a cursor that several consumers ignore. High correctness risk; needs consolidation onto one table.

3. **Per-channel notification `level` is ignored (🟠).** `channel_notification_prefs.level` (all/mentions/nothing) is persisted by `channel-prefs/route.ts` but no dispatch path reads it. `level='nothing'` does not suppress in-app mention notifications; `level='all'` does not promote ordinary channel messages to notifications. Only the boolean `muted` is honored, and only for push.

4. **Server-side schedule, manual-DND status, and admin quiet-hours/rate-limit are all unenforced (🟠 x3).** (a) `notificationSchedule.evaluateNotification` is client-only — server never gates by active-hours/weekday. (b) `user_status='dnd'` is not consulted server-side (only `dnd_settings`). (c) `push_policy.quiet_hours_*` and `max_rate_per_user_per_hour` are stored but `enqueuePush`/`deliverPush` never read them. All three are config/UI without teeth.

5. **APNS / iOS push cannot deliver (🟡 known).** `pushDelivery.ts:163` skips APNS tokens (no HTTP/2 client, deliberate no-fake). FCM + Web Push are real. iOS native push is non-functional until an APNS client dep + ADR is added.

6. **No email digests (🔴).** Only per-event queued emails exist; BLUEPRINT §2.1.5 requires realtime/hourly/daily/weekly digest. No aggregation job.

7. **No @here / @channel / @everyone (🔴).** `mentionParse.ts` only extracts `@username`; broadcast mentions silently match nothing. BLUEPRINT §2.1.1 lists `@here`/`@channel`/`@group`/`@role`/`@team`.

## Recommended Next Steps
1. Wire `matchKeywords` into `notifyChannelMentions` (load each candidate recipient's `notification_keywords`, emit a `keyword` notification + push when matched). Then **delete one of the two keyword systems** (`user_keywords` JSON vs `notification_keywords`) and migrate.
2. **Consolidate read-state onto a single table** (`channel_read_state`), repoint `mark-unread`, `conversations/mark`, `channels/dm`, `channels/unread`, `workspaces/switcher`; add a migration to backfill, then drop `read_state`.
3. Make `channel_notification_prefs.level` authoritative in `notifyChannelMentions`/`notifyDirectMessage`: `nothing`→drop in-app+push, `mentions`→current behavior, `all`→notify on every channel message.
4. Move schedule/DND-status enforcement server-side: add a single `shouldNotify(userId, channelId)` gate used by both in-app insert and push enqueue, consulting `dnd_settings`, `user_status`, the active-hours schedule, and `push_policy` quiet-hours + rate cap.
5. Unify the two `isDndActiveNow` helpers (drop the TZ-less one in `dnd/route.ts`, reuse `dndWindow.ts`).
6. Add @here/@channel fan-out (membership-scoped, with a per-channel allow toggle) and broadcast-mention pref.
7. Add tests: channel-pref `level` dispatch, keyword-fires-notification, mark-unread end-to-end against the unified table, quiet-hours suppression.

## Out of Scope
- Calendar-aware DND / "in-meeting" presence + calendar sync (BLUEPRINT §2.1.5) — needs calendar integration; AI/ML smart-focus is explicitly out of program scope.
- Cognitive-load indicators, focus sessions, region quiet-hours policy (BLUEPRINT §2.2.2) — enhancement tier, not Slack-parity.
- Native iOS/Android client shells (push proxy ready; native is v1.0.0).
- WebSocket presence hub at Grid scale (current SSE poll is parity-adequate for alpha).
