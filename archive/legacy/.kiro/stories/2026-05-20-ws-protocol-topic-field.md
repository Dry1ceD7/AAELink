# Story: WS protocol — explicit `topic` field on subscribe/unsubscribe

- **Status:** Done
- **Created:** 2026-05-20
- **Owner:** kiro
- **Parent plan:** `_bmad-output/planning-artifacts/2026-05-20-typing-presence-ws-prd.md`
- **Roadmap milestone:** 0.0.43-alpha
- **Size:** S
- **Related:** ADR-0002, audit §2.1

## User story

As a **browser client developer**, I want to **subscribe to non-channel topics on the WS gateway** so that **presence and any future workspace-scoped stream rides the same gateway as channel events**.

## Context

ADR-0002 chose to extend the protocol with an optional `topic` field rather than overload `channel_id`. This story does the protocol-layer change only — router and client changes are separate stories so each ships testable in isolation.

## Scope

- **In scope:** `lib/wsGateway/protocol.ts` `ClientFrame` type extension, `parseClientFrame` "exactly one of" enforcement, six new protocol tests.
- **Out of scope:** router changes (separate story), `lib/wsClient.ts` changes (separate story), any server-frame change (none required), any payload format change.

## Acceptance criteria

1. `ClientFrame.subscribe` accepts `{ type: 'subscribe'; topic: 'global:presence' }` and `parseClientFrame` returns the parsed frame verbatim.
2. `ClientFrame.subscribe` rejects `{ type: 'subscribe', channel_id: 'C1', topic: 'global:presence' }` with `null`.
3. `ClientFrame.subscribe` rejects `{ type: 'subscribe' }` (neither `channel_id` nor `topic`) with `null`.
4. `ClientFrame.subscribe` accepts `{ type: 'subscribe', topic: 'global:presence', since: 'cursor-1' }` and returns the `since` field intact.
5. `ClientFrame.unsubscribe` accepts `{ type: 'unsubscribe', topic: 'global:presence' }` and returns the parsed frame.
6. `ClientFrame.unsubscribe` rejects `{ type: 'unsubscribe' }` and `{ type: 'unsubscribe', channel_id: 'C1', topic: 'global:presence' }` with `null` in both cases.
7. The existing 13 tests in `tests/wsGatewayProtocol.test.ts` continue to pass unchanged.

## Definition of Done (story-level)

### Code

- [ ] `ClientFrame` updated with optional `topic` field and exactly-one-of constraint encoded in the discriminated union
- [ ] `parseClientFrame` rejects both-set and neither-set
- [ ] No raw `import 'pg'` (none needed — protocol change only)
- [ ] No realtime emit change (none needed)
- [ ] No DB schema change (none needed)

### Tests

- [ ] 6 new test cases in `tests/wsGatewayProtocol.test.ts` (TDD: failing first, watched fail)
- [ ] All previously passing tests still pass

### Verification gates

- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes (1422 → ≥1428)
- [ ] `npm run build` passes

### Alignment

- [ ] `/aae-blueprint-align` reports no new blockers
- [ ] No new top-level dependencies
- [ ] Roadmap milestone (0.0.43-alpha) matches `docs/ROADMAP.yaml`
- [ ] ADR-0002 status remains `Accepted`

### Accessibility

- [ ] ~~Keyboard reachable~~ (backend-only)
- [ ] ~~Visible focus ring~~ (backend-only)
- [ ] ~~ARIA labels~~ (backend-only)
- [ ] ~~`prefers-reduced-motion`~~ (backend-only)

## Implementation notes

The discriminated union should encode the exactly-one-of as two variants rather than a single variant with two optionals:

```ts
export type ClientFrame =
  | { type: 'subscribe'; channel_id: string; since?: string }
  | { type: 'subscribe'; topic: string; since?: string }
  | { type: 'unsubscribe'; channel_id: string }
  | { type: 'unsubscribe'; topic: string }
  | { type: 'ping' }
```

This way callers cannot construct an ambiguous frame at the type level; only `parseClientFrame` deals with the wire-level both-set ambiguity.

## Test plan

| Acceptance criterion | Test file | Test name |
|----------------------|-----------|-----------|
| 1 | `tests/wsGatewayProtocol.test.ts` | `parseClientFrame accepts topic-only subscribe` |
| 2 | `tests/wsGatewayProtocol.test.ts` | `parseClientFrame rejects subscribe with both channel_id and topic` |
| 3 | `tests/wsGatewayProtocol.test.ts` | `parseClientFrame rejects subscribe with neither channel_id nor topic` |
| 4 | `tests/wsGatewayProtocol.test.ts` | `parseClientFrame preserves since on topic subscribe` |
| 5 | `tests/wsGatewayProtocol.test.ts` | `parseClientFrame accepts topic-only unsubscribe` |
| 6 | `tests/wsGatewayProtocol.test.ts` | `parseClientFrame rejects unsubscribe with neither and rejects with both` |

## Risks

1. **Type discrimination breaks downstream callers.** Mitigation: search the codebase for `ClientFrame` consumers before opening the PR. The router and the wsClient are the only known consumers and they get their own stories.
2. **Future contributor picks `channel_id` for presence by mistake.** Mitigation: the discriminated union prevents this at compile time; the protocol comment block flags the rule.
