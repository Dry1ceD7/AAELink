# Story: WS router — topic passthrough to pub/sub

- **Status:** Done
- **Created:** 2026-05-20
- **Owner:** kiro
- **Parent plan:** `_bmad-output/planning-artifacts/2026-05-20-typing-presence-ws-prd.md`
- **Roadmap milestone:** 0.0.43-alpha
- **Size:** S
- **Related:** ADR-0002, predecessor story `2026-05-20-ws-protocol-topic-field`

## User story

As a **browser client**, I want **the gateway router to subscribe me to the exact topic I asked for** so that **presence (`global:presence`) and any future non-channel stream reaches me through the same connection**.

## Context

With ADR-0002's protocol change in place, the router still needs to act on the new `topic` field. Today the router calls `channelTopic(frame.channel_id)` unconditionally; this story makes it forward `frame.topic` verbatim when set.

## Scope

- **In scope:** `lib/wsGateway/router.ts` `subscribeChannel`/`unsubscribeChannel` rename + topic-aware overload, two new router tests, no changes to the replay store interface.
- **Out of scope:** ACL enforcement on `topic` subscribes (separate hardening pass — captured below as a follow-up risk; topic strings are server-emitted today, so the immediate exposure is low).

## Acceptance criteria

1. A `subscribe` frame with `topic: 'global:presence'` causes the router to call `pubsub.subscribe('global:presence', handler)` once.
2. A `subscribe` frame with `topic: 'global:presence'` followed by `unsubscribe` with the same topic detaches the handler.
3. A second `subscribe` frame with the same `topic` is idempotent — the router does not double-subscribe.
4. Channel subscribes (`channel_id`) continue to work exactly as today; the existing 8 router tests pass unchanged.
5. A `subscribe` frame with `topic` and `since` triggers the replay store's `since(topic, since)` query, with replayed events flushed before live events.

## Definition of Done (story-level)

### Code

- [ ] `lib/wsGateway/router.ts` exposes a unified subscribe path that accepts either a topic or a channel_id
- [ ] No code path subscribes to a topic that was not in the inbound frame
- [ ] `subscribedChannels()` diagnostic continues to return the topic strings (it already does — sanity-check, do not regress)

### Tests

- [ ] 2 new test cases in `tests/wsGatewayRouter.test.ts` (TDD: failing first, watched fail)
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

- [ ] ~~Backend-only~~

## Implementation notes

Refactor `subscribeChannel(channelId, since?)` to a private `subscribeTopic(topic, since?)` that accepts a pre-computed topic string. Add a thin `subscribeChannel` wrapper that calls `subscribeTopic(channelTopic(channelId), since)`. The `handleMessage` switch then picks the right wrapper based on whether the frame has `topic` or `channel_id`.

Keep `subscriptions: Map<string, () => void>` keyed on the topic string regardless of source — that's already how it works for channel subscribes (the key is `channelTopic(channelId)`, not `channelId`).

## Test plan

| Acceptance criterion | Test file | Test name |
|----------------------|-----------|-----------|
| 1 | `tests/wsGatewayRouter.test.ts` | `subscribe with topic forwards to pubsub verbatim` |
| 2 | `tests/wsGatewayRouter.test.ts` | `unsubscribe with topic detaches the handler` |
| 3 | `tests/wsGatewayRouter.test.ts` | `repeated topic subscribe is idempotent` (covered by existing channel idempotency test pattern; promote to topic) |
| 4 | n/a | `existing 8 router tests still pass` |
| 5 | `tests/wsGatewayRouter.test.ts` | `topic subscribe with since flushes replay before live` (covered by existing replay test pattern; promote to topic) |

## Risks

1. **No ACL on arbitrary topics.** Mitigation: today only the server emits topic names that callers subscribe to; the topic surface is server-controlled. A follow-up story (v0.0.44) should add an allowlist to bound which topics a connection can subscribe to (e.g. `^global:presence$`, `^channel:[A-Za-z0-9_-]+$`, `^workspace:[A-Za-z0-9_-]+$`). Tracked as a follow-up risk in `docs/ROADMAP.yaml` under the WS rate-limit item.
2. **Replay store does not understand non-channel topics.** Mitigation: Redis Streams replay store is topic-agnostic — it `XADD`s any topic. Memory replay store is also topic-agnostic. Verified by inspection of `lib/wsGateway/replay.ts`.
