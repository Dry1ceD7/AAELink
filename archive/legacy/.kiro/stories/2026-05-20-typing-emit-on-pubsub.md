# Story: `/api/collab/typing` POST emits a `typing` PubSubEvent

- **Status:** Done
- **Created:** 2026-05-20
- **Owner:** kiro
- **Parent plan:** `_bmad-output/planning-artifacts/2026-05-20-typing-presence-ws-prd.md`
- **Roadmap milestone:** 0.0.43-alpha
- **Size:** S
- **Related:** audit §2.1, predecessor stories `ws-protocol-topic-field` + `ws-router-topic-passthrough` + `ws-client-subscribe-topic`

## User story

As a **member typing in a channel**, I want **the gateway-connected viewers to see my typing state in real time** so that **typing indicators no longer rely on HTTP polling**.

## Context

`/api/collab/typing` POST persists the typing record in `aaelink.channel_typing` / `aaelink.thread_typing`. It does not emit on the pub/sub bus. The GET endpoint reads the table — that's the polling consumer. With the WS gateway in place, the POST should also emit a `typing` event on the channel topic so connected clients see it without polling.

The legacy `/api/typing` (in-memory module variable) stays unchanged in this story; it will be retired in a separate v0.0.44 cleanup.

## Scope

- **In scope:** `app/api/collab/typing/route.ts` POST emits `{ type: 'typing', channel_id, user_id, active }` on the channel topic via `getPubSub().publish(channelTopic(channelId), event)`. DELETE-equivalent (active=false) on stop typing also emits.
- **Out of scope:** thread typing emit (next milestone — thread typing topic shape is debatable); legacy `/api/typing` cleanup; `<TypingIndicator>` UI consumer wiring (separate story `home-shell-typing-presence-ws`); the existing GET poll path stays as fallback.

## Acceptance criteria

1. A successful POST to `/api/collab/typing` with `active: true` (the default) emits exactly one `typing` PubSubEvent on the matching channel topic with `active: true`.
2. A successful POST to `/api/collab/typing` with `active: false` (or `clear: true`, matching the route's existing convention) emits exactly one `typing` PubSubEvent with `active: false`.
3. The existing DB persistence side effect is unchanged — `aaelink.channel_typing` row is upserted on `active: true`, deleted on `active: false`.
4. If the user is not authenticated, no emit occurs and the route returns 401 as today.
5. If `getPubSub()` returns `MemoryPubSub` (Redis not configured), the emit still fires; existing test patterns for memory pub/sub apply.
6. Thread-typing POSTs (with `root_id` set) do not emit — out of scope.

## Definition of Done (story-level)

### Code

- [ ] `tracedRoute` wrapping unchanged (already present)
- [ ] `readSessionUserId()` unchanged (already present)
- [ ] CSRF unchanged (POST already covered by `tracedRoute` chokepoint per v0.0.27)
- [ ] No new audit row (typing is too high-frequency to audit)
- [ ] Emit goes through `lib/redisPubSub.ts` `publish` — never raw `res.write`
- [ ] No `pg` import change; `getPool()` only

### Tests

- [ ] 4 new integration tests in `__tests__/api/collab-typing.test.ts` (TDD: failing first, watched fail) — cover criteria 1, 2, 3 (regression against existing DB persistence), 5 (memory pubsub path)
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
- [ ] Audit §2.1 is one step closer to closed

### Accessibility

- [ ] ~~Backend-only emit~~

## Implementation notes

`PubSubEvent` for `typing` is already declared in `lib/redisPubSub.ts`:

```ts
| { type: 'typing'; channel_id: string; user_id: string; active: boolean }
```

Use it verbatim. The emit goes inside the same try/catch as the DB upsert so a Redis outage does not break the typing route — log via `lib/log.ts` and continue.

Replay-on-reconnect for typing is undesired (8s TTL). The replay store should not record `typing` events — handled by a separate concern in `lib/wsGateway/replay.ts` (typing topic prefix or event-type filter). Document that decision in this story but leave the replay store filter to a follow-up story `replay-skip-ephemeral` if it is not already in place.

## Test plan

| Acceptance criterion | Test file | Test name |
|----------------------|-----------|-----------|
| 1 | `__tests__/api/collab-typing.test.ts` | `POST emits typing event with active=true` |
| 2 | `__tests__/api/collab-typing.test.ts` | `POST with active=false emits typing event with active=false` |
| 3 | `__tests__/api/collab-typing.test.ts` | `POST upserts channel_typing row` (regression) |
| 4 | n/a | covered by existing 401 baseline |
| 5 | `__tests__/api/collab-typing.test.ts` | `emit fires on memory pubsub when REDIS_URL is unset` |
| 6 | `__tests__/api/collab-typing.test.ts` | `thread typing POST does not emit` (regression guard) |

## Risks

1. **Replay store records typing events with stale TTL semantics.** Mitigation: confirm the replay store either skips typing topics or trims them aggressively before this story merges. If the replay store does not yet skip, file a blocker follow-up.
2. **Two paths for typing during the transition** — HTTP poll consumers (existing) plus WS event consumers (new). Mitigation: both paths read from the same source of truth (the DB row plus the emit); the WS path is additive and the GET poll continues to satisfy clients without WS.
