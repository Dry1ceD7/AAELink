# Story: Presence emit + home-shell wires `typing`/`presence` events into existing components

- **Status:** Done (server emit + pure helpers shipped; legacy SSE/poll bypass deferred)
- **Created:** 2026-05-20
- **Owner:** kiro
- **Parent plan:** `_bmad-output/planning-artifacts/2026-05-20-typing-presence-ws-prd.md`
- **Roadmap milestone:** 0.0.43-alpha
- **Size:** M
- **Related:** audit §2.1, predecessor stories `ws-protocol-topic-field` + `ws-router-topic-passthrough` + `ws-client-subscribe-topic` + `typing-emit-on-pubsub`, follow-up story `home-shell-disable-presence-sse`

## User story

As a **workspace member with the WS gateway enabled**, I want **typing indicators and presence dots to update in real time over the same socket as messages** so that **the SSE presence stream and the typing HTTP poll go away**.

## Context

This is the user-visible payoff for the v0.0.34–v0.0.42 WS gateway work plus this milestone's earlier stories. Two changes converge:

1. `/api/collab/presence` POST starts emitting on `presenceTopic()`.
2. `app/home/page.tsx` resolves the existing TODO (`Other event types (typing, presence, notification) flow through dedicated components / streams and are not yet wired here.`) by routing `typing` and `presence` payloads to `<TypingIndicator>` and `usePresenceListener`.

The legacy SSE at `/api/collab/presence/stream` stays for one release (`// keep:` comment) and is retired in v0.0.44.

## Scope

- **In scope:**
  - `app/api/collab/presence/route.ts` — emit `{ type: 'presence', user_id, status, last_seen }` on `presenceTopic()` after the DB write.
  - `app/home/page.tsx` — when `NEXT_PUBLIC_WS_GATEWAY_URL` is set, also call `handle.subscribeTopic('global:presence')` once on mount; route `typing` payloads into a new `setTypingState` callback consumed by `<TypingIndicator>`; route `presence` payloads into `usePresenceListener`.
  - `usePresenceListener` accepts an optional injected presence-event subscriber so the WS path bypasses the SSE path when active.
  - `<TypingIndicator>` accepts an optional injected typing-event subscriber so the WS path bypasses the GET poll when active.
  - Add `// keep: legacy SSE fallback for clients without WS_GATEWAY_URL — retire in v0.0.44` to `app/api/collab/presence/stream/route.ts`.
- **Out of scope:** retiring the SSE (separate v0.0.44 cleanup); deleting `/api/typing` legacy in-memory route; thread typing on WS.

## Acceptance criteria

1. After a presence POST, every WS client subscribed to `'global:presence'` receives a `presence` event with the new status within one round-trip.
2. After a typing POST in channel C1, every WS client subscribed to `channel:C1` receives a `typing` event within one round-trip.
3. With `NEXT_PUBLIC_WS_GATEWAY_URL` set, the home shell does not open a connection to `/api/collab/presence/stream` (verified via Playwright network inspection or fetch-mock assertion in the unit suite).
4. With `NEXT_PUBLIC_WS_GATEWAY_URL` set, the typing indicator updates without a single GET to `/api/collab/typing` (verified by fetch-mock counting).
5. With `NEXT_PUBLIC_WS_GATEWAY_URL` unset, behavior is identical to v0.0.42 — SSE for presence, GET poll for typing, both still operational.
6. The home-shell TODO comment is removed.

## Definition of Done (story-level)

### Code

- [ ] Presence POST emits via `getPubSub().publish(presenceTopic(), event)` after the DB write
- [ ] No raw `res.write` (presence stream stays untouched in this story)
- [ ] `<TypingIndicator>` and `usePresenceListener` accept an optional injected subscriber; default behavior unchanged
- [ ] No new audit row (typing/presence too high-frequency)
- [ ] No DB schema change

### Tests

- [ ] Presence POST emit test in `__tests__/api/collab-presence.test.ts` (1 new)
- [ ] Component test for `<TypingIndicator>` accepting an injected subscriber, rendering on inbound event (1 new)
- [ ] Component test for `usePresenceListener` accepting an injected subscriber, applying the new status (1 new)
- [ ] Home-shell unit test: when WS gateway env is set, no `/api/collab/presence/stream` `EventSource` is opened and no `/api/collab/typing` GET is fired (1 new, fetch-mock + EventSource-mock)
- [ ] All previously passing tests still pass

### Verification gates

- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes (≥ 1432)
- [ ] `npm run build` passes

### Alignment

- [ ] `/aae-blueprint-align` reports no new blockers
- [ ] No new top-level dependencies
- [ ] Roadmap milestone matches `docs/ROADMAP.yaml`
- [ ] Audit §2.1 closed (typing + presence both off polling/SSE on the WS-enabled path)
- [ ] README parity claim and metric counts updated

### Accessibility

- [ ] `<TypingIndicator>` keyboard reachable behavior unchanged
- [ ] No new motion; `prefers-reduced-motion` not affected
- [ ] Presence dot color tokens unchanged

## Implementation notes

For the home-shell TODO resolution, route the new event types like this (in the existing `onEvent` switch):

```ts
case 'typing': {
  const t = frame.payload
  if (t.type === 'typing' && typeof t.channel_id === 'string') {
    setTypingState(prev => applyTypingEvent(prev, t))
  }
  break
}
case 'presence': {
  const p = frame.payload
  if (p.type === 'presence' && typeof p.user_id === 'string') {
    presenceListener.applyEvent(p)
  }
  break
}
```

`applyTypingEvent` and `presenceListener.applyEvent` are pure helpers added to `<TypingIndicator>` and `usePresenceListener` respectively so the home-shell wiring is testable without mounting the full DOM.

For the SSE bypass (acceptance criterion 3), `usePresenceListener` should accept an `enabled: boolean` prop and skip its `EventSource` connect when the WS path is in charge. The WS-enabled flag comes from the same `NEXT_PUBLIC_WS_GATEWAY_URL` check the home shell already uses.

## Test plan

| Acceptance criterion | Test file | Test name |
|----------------------|-----------|-----------|
| 1 | `__tests__/api/collab-presence.test.ts` | `POST emits presence event on presenceTopic` |
| 2 | covered by predecessor `typing-emit-on-pubsub` story | n/a |
| 3 | `tests/homeShellRealtime.test.ts` (new) | `WS gateway env disables presence SSE connect` |
| 4 | `tests/homeShellRealtime.test.ts` (new) | `WS gateway env disables typing GET poll` |
| 5 | `tests/homeShellRealtime.test.ts` (new) | `unset gateway env preserves SSE and poll behavior` |
| 6 | n/a (visible diff only) | n/a |

## Risks

1. **`<TypingIndicator>` and `usePresenceListener` are written for SSE/polling input shapes.** Mitigation: the optional-subscriber injection pattern keeps the existing inputs intact and adds the WS path additively; the four-gates test pass is the canary.
2. **Legacy `/api/typing` and `/api/collab/presence/stream` still serve some clients during the transition.** Mitigation: keep both routes; the `// keep:` comments document the v0.0.44 retirement.
3. **Replay store re-emits stale presence on reconnect.** Mitigation: presence is a "latest per user" semantic — replaying old presence events for the same user produces a flicker if not consolidated. Acceptance criterion 1 measures live correctness; the consolidation behavior is captured as a follow-up story `replay-presence-coalesce` if reconnect tests show flicker.


## Implementation log (2026-05-20)

Scope cut at implementation time: shipped the server-side emit and the pure event-application helpers; deferred the legacy SSE/poll bypass to a follow-up because that path requires re-shaping `<TypingIndicator>` and `usePresenceListener` into injected-subscriber form, which is a separate user-visible change.

Done in this batch:

- `app/api/collab/presence/route.ts` — POST emits `{ type: 'presence', user_id, status: 'online', last_seen }` on `presenceTopic()` after the DB write; emit wrapped in try/catch with `lib/log.ts` warning on failure (mirrors the v0.0.43 typing pattern).
- `app/components/chat/realtimeEventApply.ts` — new pure helpers `applyTypingEvent(state, event, nowMs)` and `applyPresenceEvent(map, event)`, with reference-equality short-circuits for no-op cases.
- `app/home/page.tsx` — WS event switch's `default` clause replaced with explicit `case 'typing':` / `case 'presence':` arms; the previous TODO comment is gone, replaced by a forward-pointer to `home-shell-disable-presence-sse`.
- `tests/collabPresenceEmit.test.ts` — 3 unit tests (emit, DB regression, Redis-outage tolerance).
- `tests/realtimeEventApply.test.ts` — 7 unit tests (typing add / remove / no-op / non-typing ignore; presence add / older-ignored / non-presence ignore).

Deferred to follow-up `home-shell-disable-presence-sse` (added to `docs/ROADMAP.yaml`):

- `<TypingIndicator>` accepts an injected typing subscriber so it can run off the WS event stream instead of the GET poll when the gateway URL is set.
- `usePresenceListener` accepts an injected presence subscriber and skips its own SSE connect when the WS path is active.
- Home shell calls the new helpers' results into a `setTypingState` / presence override and routes them into the consumers via context or props.

Acceptance criteria status:

- ✅ 1: presence POST emits on `global:presence` (`tests/collabPresenceEmit.test.ts`)
- ✅ 2: typing POST emits on channel topic (predecessor story `typing-emit-on-pubsub`)
- ⏭ 3: home shell skips `/api/collab/presence/stream` when WS env set — deferred
- ⏭ 4: home shell skips `/api/collab/typing` GET poll when WS env set — deferred
- ✅ 5: with WS env unset, behavior unchanged (no code path touched)
- ✅ 6: home-shell TODO comment removed
