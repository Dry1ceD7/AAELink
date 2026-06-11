# Blueprint Alignment — Typing & Presence on the WebSocket gateway

- **Date:** 2026-05-20
- **Scope:** v0.0.43-alpha roadmap item `typing-presence-ws`
- **Source artifacts:** `_bmad-output/planning-artifacts/2026-05-20-typing-presence-ws-prd.md`, `docs/ADR/0002-ws-gateway-topic-on-subscribe.md`, 5 stories under `.kiro/stories/2026-05-20-*.md`
- **Files reviewed:** 0 production files (this is a planning audit, not a code review). All findings target the artifacts.

## Verdict

- **Aligned:** 9
- **Warnings:** 2
- **Blockers:** 0

## Per-concern findings

### A. Information Architecture (BLUEPRINT § 3.2)

✅ Typing and presence sit at the right tier — typing is channel-scoped, presence is workspace-global. The choice to keep presence on `'global:presence'` rather than per-workspace is documented in the PRD's Open Questions § Q1 with a v0.1.0 follow-up trigger (per-workspace shard when fanout exceeds Redis pub/sub capacity).

### B. API Standards (BLUEPRINT § 4.3 + skill `aaelink-api-route`)

✅ `app/api/collab/typing/route.ts` already wraps with `tracedRoute('POST', '/api/collab/typing', _POST)`, calls `readSessionUserId()`, returns `{ error: 'snake_case_code' }`. Story `typing-emit-on-pubsub` adds the emit inside the existing handler — no chokepoint bypass.

✅ `app/api/collab/presence/route.ts` already wraps with `tracedRoute`. Story `presence-emit-and-shell-wiring` adds the emit inside the existing handler.

✅ Both stories explicitly call out `getPubSub().publish(...)` for emit; no raw `res.write`.

### C. Realtime (BLUEPRINT § 4.4 + skill `aaelink-realtime`)

✅ Emits route through `lib/redisPubSub.ts` `publish` per the chokepoint rule.

⚠️ **Replay-on-reconnect for ephemeral signals.** Typing has an 8-second TTL. If the replay store records typing events without filtering, a reconnecting client receives ghost typers older than the TTL. PRD Goal §5 and story `typing-emit-on-pubsub` Risk §1 both flag this. Acceptable today: `lib/wsGateway/replay.ts` `MemoryReplayStore` and `RedisStreamsReplayStore` cap by count (`WS_REPLAY_MAX_PER_TOPIC`), so the practical exposure is small. Add a follow-up story `replay-skip-ephemeral-topics` if the reconnect tests show flicker. Not a blocker for v0.0.43 ship.

✅ Presence replay semantic is "latest per user" (PRD Goal §5). Acceptance criterion 3 of story `presence-emit-and-shell-wiring` Risk §3 captures the consolidation work as a follow-up if reconnect tests show flicker. Acceptable.

✅ ACL before subscribe — `presenceTopic()` is a single, server-controlled string. No new ACL surface for v0.0.43.

⚠️ **Topic allowlist on the gateway.** Story `ws-router-topic-passthrough` Risk §1 calls out that arbitrary `topic` strings are accepted today. This is acceptable because all topic strings are server-emitted (no client-introduced topic value reaches the bus), but a v0.0.44 follow-up should add a regex allowlist (`^global:presence$`, `^channel:[A-Za-z0-9_-]+$`, `^workspace:[A-Za-z0-9_-]+$`). Tracked under the `gateway-rate-limit` v0.0.43-alpha P2 item in `docs/ROADMAP.yaml` — extend that item to also carry the allowlist hardening.

### D. Data Layer (BLUEPRINT § 4.5)

✅ No schema change. `aaelink.channel_typing` / `aaelink.thread_typing` / `aaelink.user_status` / `aaelink.presence` already exist. `lib/migrate.ts` not touched.

✅ Workspace_id scoping — typing is channel-scoped (channels carry workspace), presence is global (intentional).

### E. Security & Compliance (BLUEPRINT § 4.5 + § 5.5 + skill `aaelink-compliance`)

✅ AuthN — both POSTs reject unauthenticated callers with 401 today; no change.

✅ AuthZ — typing requires channel membership (existing); presence is per-user-self, no cross-user write.

✅ DLP — typing and presence carry no user-authored text; PRD Compliance Implications confirms no DLP scan needed.

✅ Retention — both signals are ephemeral; no retention policy change. PRD calls this out explicitly.

✅ Audit — no new audit rows. PRD justifies (high-frequency signals; auditing the broadcast configuration would be redundant).

✅ Profile compatibility — Default only. HIPAA / FINRA / GDPR / FedRAMP profiles not in scope for typing/presence per blueprint.

### F. Performance (BLUEPRINT § 5.4)

✅ Removes the 10-second presence SSE snapshot query — net DB load reduction. PRD Success Metric §1 measures this.

✅ Removes the typing GET poll — net network reduction. PRD Success Metric §2 measures this.

✅ Replay store cap (`WS_REPLAY_MAX_PER_TOPIC`) bounds memory.

✅ No N+1 queries introduced; emits go through the pub/sub bus, not the DB.

### G. Accessibility (BLUEPRINT § 3.5)

✅ `<TypingIndicator>` UI surface unchanged (story explicitly preserves the public API).

✅ Presence dot color tokens unchanged.

✅ No new motion or animation; `prefers-reduced-motion` not affected.

✅ Keyboard reachability of consumers unchanged.

### H. Tests (skill `aaelink-testing`)

✅ Test budget: 6 (protocol) + 2 (router) + 4 (typing emit) + 3 (presence emit + component) + 4 (client) = 19 new tests. Baseline 1422 → ≥1441 expected.

✅ Each story carries a per-criterion test mapping table.

✅ TDD discipline declared in every story DoD ("written-first, watched fail").

✅ Regression coverage — every story has at least one regression assertion against the existing 1422-test baseline.

### I. Phase / Milestone (BLUEPRINT § 6.1)

✅ M2 (Messaging Core) hardening — revisits the v0.0.42 fanout audit findings.

✅ Prerequisites in place: v0.0.34 (Redis pub/sub), v0.0.35 (gateway), v0.0.36 (replay), v0.0.38 (browser client), v0.0.39 (home shell WS), v0.0.40 (thread updates), v0.0.41 (multi-event sweep) — all `shipped` per `docs/ROADMAP.yaml`.

### J. Roadmap Alignment (`docs/ROADMAP.yaml`)

✅ Targets `current_version: 0.0.58-alpha` `theme: BMAD Method dialect formalization` — wait. Wrong. Re-read.

Actually targets `0.0.43-alpha.items.typing-presence-ws` (status `planned`, audit_section `2.1`). The `current_version` in `docs/ROADMAP.yaml` is `0.0.58-alpha` because that is the version under active engineering when this planning artifact was written. The work itself targets the `0.0.43-alpha` planned milestone. **This is the gotcha** — the current alpha cycle (`0.0.58-alpha`) is BMAD adoption, not typing/presence. Typing/presence ships in a future `0.0.43-alpha`-themed release (named for its audit-section ancestry, not its calendar position).

✅ All five `depends_on:` items for the predecessor work (Redis pub/sub auto-connect, gateway, replay, browser client, home-shell WS) are `shipped` in `docs/ROADMAP.yaml`. No blocked dependencies.

✅ The work does not cross a milestone boundary; all stories carry `Roadmap milestone: 0.0.43-alpha`.

⚠️ **Naming clarification needed.** The roadmap version key `0.0.43-alpha` is older than the current `0.0.58-alpha` — this is intentional (versions in `docs/ROADMAP.yaml` are themed buckets, not strictly sequential calendar tags), but it confuses any reader who expects strict sequence. Add a comment to `docs/ROADMAP.yaml` clarifying that version keys are themed buckets — or move typing/presence to a calendar-sequential `0.0.59-alpha` bucket and deprecate the `0.0.43-alpha` key. **Not a blocker** — captured here for the next maintenance pass.

## Conflict detection (BLUEPRINT § 5.3)

- **Realtime expectation vs async-first design** — typing is opt-in display, presence is opt-in subscriber. No conflict.
- **AI/Search vs data residency / HIPAA** — no AI in scope.
- **Granular RBAC vs UX simplicity** — no RBAC change.
- **Federation/multi-org channels vs DLP** — no federation in scope.
- **Plugin extensibility vs supply-chain risk** — no plugin scope.

No new conflicts introduced.

## Required actions (blockers)

None.

## Recommended actions (warnings)

1. **Add a follow-up story `replay-skip-ephemeral-topics`** to the v0.0.43-alpha milestone in `docs/ROADMAP.yaml`. Owner: same as `typing-emit-on-pubsub`. The story body should: (a) decide whether the replay store filter is by topic prefix (`typing:`) or by event-type field; (b) add the filter; (c) add a unit test that confirms typing events older than 8s are not replayed.

2. **Extend the v0.0.43-alpha `gateway-rate-limit` roadmap item** to include topic allowlist hardening (`^global:presence$`, `^channel:[A-Za-z0-9_-]+$`, `^workspace:[A-Za-z0-9_-]+$`). Today's exposure is low because no client-introduced topic value reaches the bus, but the allowlist is the right place to harden before adding any future workspace/admin topic.

3. **Clarify version naming in `docs/ROADMAP.yaml`** — add a top-of-file comment stating that the version keys (`0.0.20-alpha`, `0.0.43-alpha`) are themed buckets, not strictly sequential calendar tags. Or rebucket.

## Out of scope / deferred

1. Per-workspace presence shard — v0.1.0 when fanout exceeds Redis pub/sub capacity. PRD Q1.
2. Thread typing on the WS gateway — PRD non-goal; thread typing stays on the existing DB poll for v0.0.43.
3. `/api/typing` (legacy in-memory) cleanup — separate v0.0.44 cleanup.
4. `useAutoAway` reshaping — PRD non-goal; stays as a producer of the existing `/api/collab/presence` POST.

## References

- `_bmad-output/planning-artifacts/2026-05-20-typing-presence-ws-prd.md`
- `docs/ADR/0002-ws-gateway-topic-on-subscribe.md`
- `.kiro/stories/2026-05-20-ws-protocol-topic-field.md`
- `.kiro/stories/2026-05-20-ws-router-topic-passthrough.md`
- `.kiro/stories/2026-05-20-ws-client-subscribe-topic.md`
- `.kiro/stories/2026-05-20-typing-emit-on-pubsub.md`
- `.kiro/stories/2026-05-20-presence-emit-and-shell-wiring.md`
- `docs/audit-2026-05-19.md` § 2.1
- `docs/BLUEPRINT.md` § 3.2, § 4.4, § 5.4, § 6.1
