# ADR-0002: Extend the WS gateway protocol with explicit `topic` on subscribe/unsubscribe

- **Status:** Accepted
- **Date:** 2026-05-20
- **Deciders:** AAELink core team
- **Related:**
  - `docs/ADR/0001-bmad-method-adoption.md`
  - `_bmad-output/planning-artifacts/2026-05-20-typing-presence-ws-prd.md`
  - `lib/wsGateway/protocol.ts`
  - `lib/wsClient.ts`
  - `lib/redisPubSub.ts`
  - v0.0.43-alpha roadmap item `typing-presence-ws` in `docs/ROADMAP.yaml`

## Context

The gateway protocol shipped in v0.0.35 only carries channel topics. `ClientFrame` has shape `{ type: 'subscribe'; channel_id: string; since?: string }`, and the router translates `channel_id` into a Redis topic via `channelTopic(channelId)` from `lib/redisPubSub.ts`.

Presence is workspace-global. `lib/redisPubSub.ts` already exports `presenceTopic()` returning `'global:presence'` — a topic that has no `channel_id` analogue. Migrating presence onto the gateway therefore needs the protocol to carry topics that are not channel-scoped.

Two paths were on the table:

1. Reuse `channel_id` with a sentinel value (e.g. `'__presence__'`), translated server-side to `presenceTopic()`.
2. Extend the protocol with an explicit `topic` field that the server uses verbatim against `pubsub.subscribe`.

The first path overloads `channel_id` with a meaning that channels do not have, which means every later non-channel topic (workspace events, admin events, system messages) needs another sentinel. The second path is a one-time protocol bump that admits any future topic without further surgery.

## Decision

Extend `lib/wsGateway/protocol.ts` `ClientFrame` with an optional `topic` field on `subscribe` and `unsubscribe`. When present, it overrides `channel_id` and is forwarded verbatim to `pubsub.subscribe`. When absent, behavior is unchanged — `channel_id` is translated through `channelTopic(channelId)` exactly as today.

The new shape:

```ts
export type ClientFrame =
  | { type: 'subscribe'; channel_id?: string; topic?: string; since?: string }
  | { type: 'unsubscribe'; channel_id?: string; topic?: string }
  | { type: 'ping' }
```

`parseClientFrame` enforces "exactly one of `channel_id` or `topic` must be a non-empty string". Both missing or both present returns `null`.

The server frame `event` already carries `topic: string` (since v0.0.35); no server-frame change is needed.

`lib/wsClient.ts` `WsCollabHandle.subscribe` gets a sibling `subscribeTopic(topic, since?)` for callers that want to subscribe by topic name. Channel callers continue using `subscribe(channelId)`.

## Alternatives considered

1. **Sentinel `channel_id: '__presence__'`** — Smaller diff today, but leaks the workaround into every future non-channel topic. Each new topic shape (workspace events, admin firehose, system messages) would either need its own sentinel or a separate frame type. Rejected because it pushes the cost forward.

2. **Separate `subscribe_topic` / `unsubscribe_topic` frame types** — Cleanly separates channel-scoped from topic-scoped, but doubles the frame surface area and forces every client / test fixture to learn four frame shapes instead of two. Rejected as overkill for one new topic.

3. **Drop `channel_id` entirely; convert all subscribe frames to use `topic`** — Cleanest semantically. Rejected because every browser client in the wild (v0.0.38+) speaks `channel_id` today; a protocol-bump migration with the desktop app already at v0.0.57+ is more disruptive than the dual-mode approach.

## Consequences

### Positive

- The protocol admits any topic the pub/sub bus emits; future workspace-scoped or admin-scoped streams need no further protocol changes.
- `parseClientFrame`'s "exactly one of" enforcement keeps the wire format unambiguous.
- `lib/wsClient.ts` callers that already speak channel-id continue to work unchanged.

### Negative

- The protocol now has two ways to spell a subscribe. The `parseClientFrame` enforcement and the protocol comments must make this explicit, or future contributors will wonder which to use.
- `ClientFrame.subscribe.channel_id` becomes optional, so call sites that previously assumed presence must guard against undefined. Mitigated by tightening the type union: when `channel_id` is set, `topic` is forbidden and vice versa.
- Tests that asserted the old shape need updating. Counted: `tests/wsGatewayProtocol.test.ts` (currently 13 tests) gains 6 new cases for the topic path.

### Neutral

- The `subscribe` `since` field works identically for both spellings; replay store keys are topic strings either way.
- `lib/redisPubSub.ts`'s `channelTopic(channelId)` and `presenceTopic()` helpers stay unchanged.

## Implementation notes

Files touched in v0.0.43-alpha:

- `lib/wsGateway/protocol.ts` — extend `ClientFrame`, tighten `parseClientFrame` with the exactly-one-of check.
- `lib/wsGateway/router.ts` — when `frame.topic` is set, call `pubsub.subscribe(frame.topic, ...)` directly; bypass `channelTopic()`.
- `lib/wsClient.ts` — add `subscribeTopic(topic, since?)` and `unsubscribeTopic(topic)`. Track topic-keyed cursors alongside channel-keyed.
- `tests/wsGatewayProtocol.test.ts` — 6 new cases (topic-only, topic+since, both-set rejected, both-empty rejected, unsubscribe-by-topic, unsubscribe-rejected-when-both-set).
- `tests/wsGatewayRouter.test.ts` — 2 new cases (topic subscribe forwards to pubsub verbatim; topic unsubscribe stops events).

Follow-up:

- `lib/wsClient.ts` callers that want presence updates use `subscribeTopic('global:presence')` after the home-shell migration in v0.0.43.
- The `since` cursor for `'global:presence'` works the same as channel cursors; the replay store decides whether to replay (presence: only the latest per user; typing: nothing).

## References

- `lib/wsGateway/protocol.ts` (current `ClientFrame` shape)
- `lib/redisPubSub.ts` (`channelTopic`, `presenceTopic`)
- v0.0.35 release notes (gateway service)
- v0.0.36 release notes (replay-on-reconnect)
- v0.0.38 release notes (browser WS client)
