# Story: Browser WS client — `subscribeTopic` / `unsubscribeTopic`

- **Status:** Done
- **Created:** 2026-05-20
- **Owner:** kiro
- **Parent plan:** `_bmad-output/planning-artifacts/2026-05-20-typing-presence-ws-prd.md`
- **Roadmap milestone:** 0.0.43-alpha
- **Size:** S
- **Related:** ADR-0002, predecessor stories `ws-protocol-topic-field` + `ws-router-topic-passthrough`

## User story

As a **browser-side hook (`usePresenceListener`, etc.)**, I want **`connectWsCollab` to expose `subscribeTopic` / `unsubscribeTopic`** so that **non-channel streams can ride the existing socket without me opening a second one**.

## Context

`lib/wsClient.ts` `WsCollabHandle` exposes `subscribe(channelId, since?)` and `unsubscribe(channelId)` today. Cursors are tracked under `channel:<channelId>` keys. With ADR-0002, the client must be able to send topic-keyed subscribe frames and track topic-keyed cursors for replay-on-resume.

## Scope

- **In scope:** add `subscribeTopic` / `unsubscribeTopic` to `WsCollabHandle`; track topic-keyed cursors in the same map (key on the actual topic string the server will echo back); echo topic subscribes on every reconnect.
- **Out of scope:** any change to `connectCollab` (HTTP/SSE path); any UI-side wiring (separate story `home-shell-presence-ws`).

## Acceptance criteria

1. `connectWsCollab(...).subscribeTopic('global:presence')` sends `{ type: 'subscribe', topic: 'global:presence' }` over the socket.
2. After receiving an `event` frame with `topic: 'global:presence'` and `id: 'evt-1'`, calling `subscribeTopic('global:presence')` again sends `{ type: 'subscribe', topic: 'global:presence', since: 'evt-1' }`.
3. On socket reconnect, the client re-sends a subscribe for every topic plus every channel currently in its tracking set, each with their last-seen cursor.
4. `unsubscribeTopic('global:presence')` sends `{ type: 'unsubscribe', topic: 'global:presence' }` and the topic is removed from the reconnect set.
5. Channel subscribes continue to work; the existing 14 parser/serializer tests in `tests/wsClient*.test.ts` pass unchanged.
6. Cursors stored in the handle's `cursors()` accessor expose both `channel:<id>` and the bare topic string (e.g. `global:presence`); two existing channel cursors plus one topic cursor produce a 3-key record.

## Definition of Done (story-level)

### Code

- [ ] `WsCollabHandle` extended with `subscribeTopic` / `unsubscribeTopic`
- [ ] Cursor map indexed by the topic string the server echoes (no transformation)
- [ ] Reconnect re-emits both channel and topic subscribes
- [ ] No raw `pg` import; no realtime emit change

### Tests

- [ ] 4 new tests in `tests/wsClient*.test.ts` for the four acceptance criteria above (TDD: failing first, watched fail)
- [ ] All previously passing tests still pass

### Verification gates

- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] `npm run build` passes

### Alignment

- [ ] `/aae-blueprint-align` reports no new blockers
- [ ] No new top-level dependencies
- [ ] Roadmap milestone matches `docs/ROADMAP.yaml`

### Accessibility

- [ ] ~~Backend-only client logic~~

## Implementation notes

The current code uses `cursors.set(`channel:${channelId}`, ...)` and `cursors.set(frame.topic, frame.id)` — note that on the receive path, cursors are already indexed by `frame.topic` (the server-echoed topic). The discrepancy is on the send path: `subscribeChannel` writes `cursors.set('channel:'+channelId, ...)` but reads `cursors.get('channel:'+channelId)`.

Pick the unified key: store under `channel:<id>` for channel subscribes (existing) and under the raw topic string for topic subscribes. Update the receive path to compute the channel-style key when the topic matches `channel:<id>` so a single cursor record per topic survives.

Or, simpler: on the send path, always look up the cursor under the topic string the gateway will produce (`channelTopic(channelId)` for channels, `topic` for topics). That collapses both keys into one. Pick whichever produces the smaller diff.

## Test plan

| Acceptance criterion | Test file | Test name |
|----------------------|-----------|-----------|
| 1 | `tests/wsClient.test.ts` | `subscribeTopic sends topic subscribe frame` |
| 2 | `tests/wsClient.test.ts` | `subscribeTopic uses last cursor on resubscribe` |
| 3 | `tests/wsClient.test.ts` | `reconnect re-sends both channel and topic subscribes` |
| 4 | `tests/wsClient.test.ts` | `unsubscribeTopic removes topic from reconnect set` |
| 5 | n/a | `existing 14 parser/serializer tests pass` |
| 6 | `tests/wsClient.test.ts` | `cursors() exposes channel and topic keys` |

## Risks

1. **Cursor key drift between send and receive paths.** Mitigation: the implementation note above forces the test plan to pin the cursor key shape explicitly. The `cursors()` accessor test (acceptance criterion 6) catches drift.
