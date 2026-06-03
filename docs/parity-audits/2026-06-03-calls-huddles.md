# Parity Audit — Calls & Huddles

Date: 2026-06-03
Auditor: Claude

## Summary

- Coverage: 21 / 23 behaviors have some implementation
- Full: 9 | Partial: 7 | Stub: 4 | Missing: 3

Scope: audio calls, video, huddles, screen share, WebRTC signaling, TURN/STUN/ICE,
recording, transcription, clips, participants, call controls.

Key finding: AAELink has a **complete control plane** (room lifecycle, participant
tracking, call controls, signaling relay, ephemeral TURN/ICE credentials) backed by
real SQL and tested. What it does **not** have is a **media plane**: there is no
client-side WebRTC peer connection, no SFU, and recording/transcription are stubs.
The huddle UI is cosmetic — it calls the room control API but never establishes a
peer connection, mints ICE servers, or exchanges signals. So a user can "join" a
huddle (a DB row) but no audio/video actually flows. README/full-map mark voice/video,
huddles, screen share, and clips as "Shipped"; that is accurate **only for the control
plane**. Real end-to-end media is `v1.0.0`-class and env/infra-blocked.

## Behavior Matrix

| # | Behavior | Slack | Mattermost | AAELink Route | Test | Level | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Create call room (voice) | calls.add | Calls plugin start | `app/api/calls/rooms/route.ts:100` POST type=voice | `__tests__/api/calls-rooms.test.ts:58` | ✅ | Real INSERT, auto-joins creator as host |
| 2 | Create video call | calls.add (video) | Calls plugin | `rooms/route.ts:112` VALID_TYPES incl. video | `calls-rooms.test.ts:58` | ✅ | Same room machinery; type=video sets video_on default true |
| 3 | Start/join huddle (persistent ad-hoc) | Huddles | (no direct equiv) | `rooms/route.ts:116` type=huddle, dedupes per channel | partial (create path) | ✅ | One active huddle per channel; returns existing w/ `already_exists` |
| 4 | Join call | calls.participants.add | Calls join | `rooms/route.ts:196` PUT action=join | `calls-rooms.test.ts:74` | ✅ | Capacity check, ON CONFLICT DO NOTHING |
| 5 | Leave call | calls.participants.remove | Calls leave | `rooms/route.ts:222` action=leave | `calls-rooms.test.ts:88` | ✅ | Sets left_at |
| 6 | End call | calls.end | Calls end | `rooms/route.ts:230` action=end | none | ✅ | Marks room ended + all participants left. No host-only RBAC check (any participant can end) |
| 7 | List active/recent rooms | (client) | Calls list | `rooms/route.ts:31` GET | `calls-rooms.test.ts:44` | ✅ | active_participants subquery; LIMIT 50 |
| 8 | Participant roster / peer discovery | calls.info | Calls state | `lib/calls/signaling.ts:135` listRoomParticipants | `call-signaling.test.ts:122` | ✅ | Returns active participants w/ mute/video/screen flags |
| 9 | Mute / unmute toggle | call control | Calls mute | `rooms/route.ts:236` toggle_mute | none | 🟡 | DB flag flips; no media gating (no real audio track to mute) |
| 10 | Video on/off toggle | call control | Calls video | `rooms/route.ts:244` toggle_video | none | 🟡 | DB flag only |
| 11 | Screen share toggle | screen share | Calls screen share | `rooms/route.ts:252` toggle_screen_share | none | 🟡 | Per-participant `screen_sharing` flag; no `getDisplayMedia`, no track |
| 12 | WebRTC signaling relay (SDP offer/answer/ICE) | (client/Slack infra) | Calls plugin signaling | `lib/calls/signaling.ts:42` postSignal / `:88` fetchSignals; `app/api/calls/[roomId]/signals/route.ts` | `call-signaling.test.ts:60-133` | ✅ | Real relay: directed+broadcast routing, monotonic seq cursor, participant-gated, CSRF on POST. Polling-based (no push) |
| 13 | TURN/STUN/ICE credentials | (infra) | TURN config | `lib/calls/turnCredentials.ts:54` / `app/api/calls/ice/route.ts` | `calls-ice.test.ts` + `tests/turnCredentials.test.ts` | ✅ | Ephemeral coturn HMAC creds (use-auth-secret model); STUN-only graceful no-op when unconfigured |
| 14 | Client peer connection (media plane) | yes | yes | none (HuddlePanel never uses signals/ice/RTCPeerConnection) | none | 🔴 | `components/workspace/HuddlePanel.tsx` is UI-only: no `RTCPeerConnection`, `getUserMedia`, or `/api/calls/ice` call. No audio/video flows |
| 15 | SFU (mediasoup / LiveKit) for group calls | server fanout | LiveKit/RTC service | none | none | 🔴 | Mesh signaling only; no SFU. Blueprint §2 names mediasoup/LiveKit + `calls-svc`. External media infra (env-blocked) |
| 16 | Call recording | recording | Calls recording | `rooms/route.ts` `recording` column + UI REC badge | none | 🟠 | Schema/flag + admin `recording_enabled` config exist; no recorder, no storage pipeline. HuddlePanel REC button is local state only |
| 17 | Transcription | transcription | (plugin) | `lib/infra/worker.ts:145` clip_transcription | none | 🟠 | Worker handler is `sleep(2000)` stub; comment says "In production: send to Whisper". No real STT |
| 18 | Clips: create (video/audio/screen) | clips | (no equiv) | `app/api/messages/clips/route.ts:76` POST | none | ✅ | Real INSERT; type validation; enqueues transcription job |
| 19 | Clips: list / view tracking | clips | — | `messages/clips/route.ts:27` GET | none | 🟡 | List w/ channel/mine/type filters; `views` column exists but no increment endpoint seen |
| 20 | Clip auto-transcription | clips captions | — | `messages/clips/route.ts:120` enqueue → `worker.ts:145` | none | 🟠 | Job enqueued correctly but handler is a stub (see #17) |
| 21 | Clip thumbnail generation | clips | — | `messages/clips/route.ts` accepts `thumbnail_url` | none | 🟡 | Client-supplied only; no server thumbnail generation pipeline |
| 22 | Admin calls config (TURN/STUN, max participants, recording) | org settings | system console | `rooms/route.ts:43` view=config / `:172` update_config (super_admin) | none | ✅ | Persisted to `system_config`; reports turn_configured w/o leaking secret |
| 23 | In-call reactions / live captions / raise hand | reactions, captions | reactions | HuddlePanel local-only floating reactions | none | 🔴 | Reactions are client-only (not broadcast via signaling/realtime); no live captions; no raise-hand |

Legend: ✅ Full · 🟡 Partial · 🟠 Stub · 🔴 Missing

## Critical Gaps (severity-ordered)

1. **No media plane — calls produce no audio/video (🔴, highest).**
   The entire stack is control-plane. `components/workspace/HuddlePanel.tsx` joins a
   room (DB row) and runs an elapsed timer + cosmetic tiles, but never calls
   `getUserMedia`, never constructs an `RTCPeerConnection`, never fetches
   `/api/calls/ice`, and never posts/polls `/api/calls/:roomId/signals`. The
   well-built signaling relay (`lib/calls/signaling.ts`) and ICE endpoint
   (`app/api/calls/ice/route.ts`) have **no client consumer**. Net effect: "Shipped"
   in README is true for plumbing, false for a working call. Requires browser WebRTC
   client wiring; testable in CI only with a headless media mock.

2. **No SFU for group calls (🔴).** Blueprint §2.1.2 (`docs/BLUEPRINT.md:63`) targets
   "up to 50 participants; SFU (mediasoup or LiveKit)" and §calls-svc
   (`BLUEPRINT.md:273`). Current signaling is mesh (every peer to every peer), which
   does not scale past a handful even once #1 is wired. SFU is external media infra —
   env/infra-blocked, `v1.0.0`-class.

3. **Recording & transcription are stubs (🟠).** `recording` column + admin
   `recording_enabled` config + UI REC badge exist, but there is no recorder, no media
   capture, and no storage pipeline. Clip transcription enqueues a job
   (`messages/clips/route.ts:120`) whose worker handler is `await sleep(2000)`
   (`lib/infra/worker.ts:145`). Real STT (Whisper/etc.) and recording both need
   external media services — env-blocked. Compliance note: recording/transcription
   retention is in scope for D11/D12 but cannot be satisfied without the media plane.

4. **Call controls are flags without media effect (🟡).** mute/video/screen-share
   toggles flip DB booleans (`rooms/route.ts:236-258`) with no test coverage and no
   media track to act on. Once #1 lands these must gate real tracks. Also `action=end`
   has **no host-only RBAC check** — any active participant can end a room
   (`rooms/route.ts:230`); Slack restricts this. Minor authz gap worth noting.

5. **No realtime push for signaling or in-call events (🟡).** Signal delivery is
   client-polling on a seq cursor (`fetchSignals`), and in-call reactions are local-only
   (`HuddlePanel.tsx:148`). Per project rule #6, in-call presence/reactions should emit
   via `lib/realtime.ts`/`redisPubSub.ts`. Polling adds latency to call setup; reactions
   never reach other participants.

## Recommended Next Steps

(Do NOT implement here — audit only. Severity-ordered.)

1. Wire `HuddlePanel` to the existing control plane: fetch `/api/calls/ice`, build
   `RTCPeerConnection` per peer from `listRoomParticipants`, exchange SDP/ICE through
   `/api/calls/:roomId/signals`, attach `getUserMedia` / `getDisplayMedia` tracks. This
   alone converts the "Shipped" claim from control-plane to a real 1:1 / small-mesh call
   and exercises the already-tested relay + TURN code.
2. Add a realtime push channel (SSE/WS via `lib/realtime.ts`) for new-signal and
   participant-change events so call setup isn't poll-bound; route in-call reactions
   through `redisPubSub.ts` so they reach peers.
3. Add host-only RBAC to `action=end` (and consider `kick`/`mute-other` host actions) +
   tests for toggle_mute/video/screen and end.
4. Plan SFU integration (mediasoup or LiveKit per Blueprint §2/`calls-svc`) behind env
   flags for >~4-participant calls; keep mesh path for 1:1. Track as
   `0.1.0-beta.webrtc-media` / `1.0.0.webrtc-full` per parity-reference-matrix §3.7.
5. Replace the `clip_transcription` worker stub with a real STT call (env-gated;
   graceful no-op when unconfigured, mirroring the TURN pattern) and add a server
   thumbnail/recording pipeline. Add `views` increment endpoint for clips.
6. Add API tests for `action=end`, `toggle_*`, room capacity (`room_full` 409), huddle
   dedupe, and `view=config` / `update_config` RBAC.

## Out of Scope

- **AI/ML** transcription quality, summarization, smart captions — excluded by the
  standing Slack-parity directive (AI/ML out of scope).
- **External media infrastructure** (coturn/TURN server deployment, mediasoup/LiveKit
  SFU, recording storage, Whisper/STT service) — env/infra-blocked; cannot be verified
  in this repo without those services provisioned. The credential-issuing and config
  code is present and tested; the servers themselves are deployment concerns
  (`infra/`).
- Mobile/native call UX (Electron desktop + mobile) beyond the web client.
