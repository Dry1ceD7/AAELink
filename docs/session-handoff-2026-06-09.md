# Session handoff — 2026-06-09 (realtime live-merge: presence + read receipts)

Branch: `feat/slack-parity-execution-engine`. **Nothing pushed.** Continues the
2026-06-08 handoff follow-up #1 (realtime live-merge).

## State at pause

- **2 commits made this session** (on top of `2ea23aa8`):
  - `95ef4f6f` feat(realtime): live read receipts on the WS and SSE paths
  - `46636b2e` fix(realtime): scope presence fan-out to the workspace
- **Uncommitted in the working tree** (this session's hardening pass — 5 files, intentionally NOT committed yet):
  - `lib/messaging/chat-post.ts`, `app/api/collab/events/route.ts`,
    `lib/realtime/realtime.ts`, `__tests__/api/read-receipt-delta.test.ts` —
    the SSE read-watermark hardening (see below).
  - `tests/presenceFanout.test.ts` — a one-line type fix (typed `vi.fn` args)
    that **logically belongs to committed `46636b2e`**: that commit shipped a
    latent `tsc` error (TS2493, empty-tuple `calls[0][1]`) masked by an
    incremental tsc cache. When committing the working tree, either fold this
    hunk into `46636b2e` (amend/fixup) or land it as its own `fix(test):` commit.
- `.mcp.json` still modified + unstaged — pre-existing, by design (removes the
  context7 MCP server); decide commit-as-chore vs restore. Not ours.

## What this session built

Goal: presence dots AND read-receipt reader stacks update **live**, on both
transport paths. Root cause of the original gap: `dev:localhost` runs no WS
gateway, so `NEXT_PUBLIC_WS_GATEWAY_URL` is unset → `realtimeBus` is `undefined`
→ the **SSE/poll fallback** path runs, not the WS path. Both paths needed wiring.

### Read receipts (commit `95ef4f6f`)
- **WS path:** `POST /api/messages/:id/read` fans a `message_read` out wrapped in
  a `channel_update` envelope. The home shell dropped the inner payload (only
  debounce-refetched the channel list). Added pure `routeChannelUpdate(inner)`
  reducer (classify read-receipt-merge vs. channel-refetch) + `applyReadReceiptEvent`
  (merge reader: newest-first, cap 5, earliest `read_at` per reader, same-ref
  no-op). Mirrors server `readReceiptsForMessages` order/cap.
- **SSE path:** `GET /api/collab/events` now streams a `read_receipts` delta via
  `readReceiptDeltaSince` (new in `chat-post.ts`); `connectCollab` gained an
  `onReadReceipts` callback → `applyReadReceiptMap` (authoritative replace).
- **Migration 062**: composite index `message_reads(channel_id, read_at)`.

### Presence (commit `46636b2e`)
- WS client was never subscribed to the presence topic → `case 'presence'` was
  dead. Now subscribes — but **workspace-scoped** to avoid the cross-tenant leak
  + O(users×clients) fan-out a global topic would cause:
  - `presenceTopic(workspaceId)` → `presence:<workspaceId>` (no-arg still
    `global:presence`, kept only for a future opt-in platform-admin view).
  - Shared `lib/realtime/presenceFanout.ts` `publishPresenceToUserWorkspaces`
    (resolves the user's workspaces, publishes to each, best-effort allSettled);
    used by the heartbeat (`/api/collab/presence`) and the status-expiry sweep.
  - Client subscribes to `presence:<activeTeamId>` only. Gateway allowlist gains
    `/^presence:[A-Za-z0-9_-]+$/`.

### Hardening (UNCOMMITTED — this session's last pass)
From an 18-agent adversarial review (4 lenses → refute-verify → synth) of the
above. Review confirmed 7 findings; the merge-blocker (presence scoping) and the
LIMIT-boundary guard were folded into the commits above. The two LOW SSE-fallback
liveness findings were then fixed in this uncommitted pass:
- **Same-ms straddle:** `readReceiptDeltaSince` gained a `nowMs` ceiling — the
  cursor never advances up to the current ms (a read at `now` may still be
  committing after the snapshot). No idle re-delivery (quiet channel: `maxMr <
  now`). Deterministic test added.
- **Reconnect-gap:** read cursor now survives reconnect. Server echoes
  `read_cursor` per delta + emits a **baseline cursor frame at stream start**;
  client (`connectCollab`) resends it as `read_since`; `initialReadWatermark`
  seeds from it (MAX only on true first connect). Closes the disconnect-window
  read-loss.

## Gates (with the uncommitted hardening applied)
`type-check` 0 · `lint` 0 errors (145 pre-existing warnings) · `test` (unit)
**2004 pass** (4 skip) · `test:integration` **1079 pass**.

## Known limitations / not covered
- **Route SSE-stream plumbing not suite-tested.** `read_since` seed + the
  initial-cursor emit are type-checked + reasoned but have no integration test:
  a stream test leaks the route's `setInterval` because `asRequest` exposes no
  abortable signal. The delta logic itself (`readReceiptDeltaSince`) is fully
  helper-tested in `__tests__/api/read-receipt-delta.test.ts`. To test the route:
  add abortable-request support to `asRequest` (inject an `AbortController`
  signal), then read the first SSE frame and abort.
- **Connect-time micro-gap:** a read landing between the `GET /api/messages`
  snapshot and the `initialReadWatermark` query (two sequential queries, ms
  apart) on a *first* connect. Tiny, self-healing on the next read. Left as-is.
- WS-path read receipts merge live but only the active channel's posts are in
  state; receipts for non-loaded messages are ignored (correct).

## Resume path (next session)
1. Read this file. The work is functionally complete + verified; the open
   decision is **how to commit the uncommitted hardening** (see "State" — fold
   `presenceFanout.test.ts` into `46636b2e`).
2. Optional: add abortable-request infra to `asRequest` + a route-stream test for
   the `read_cursor`/`read_since` resume.
3. **Push the branch / open the PR** — now ~48 commits once the hardening lands.
4. Still-open original-handoff follow-ups: read-receipt feed render confirmation
   (#2), guest extend-expiry PATCH (#3), `GuestManagementPanel` split (#4),
   `oauth-scope-enforcement` directory test env (#5).

## Env
- Docker `postgres` (port 25432) still up (integration tests use it). `redis` +
  `minio` may still be up from the prior session. No dev server was started this
  session (only test runs). Nothing to stop.
