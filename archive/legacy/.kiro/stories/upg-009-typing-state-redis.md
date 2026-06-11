---
source_finding: UPG-009
pillar: "🟡 Upgrades Recommended"
severity: P2
slug: upg-009-typing-state-redis
created_at: 2026-05-26
audit_run: docs/audit-2026-05-26.md
---

# Story: Move typing state from in-memory Map to Redis

- **Roadmap milestone:** v0.0.59-alpha
- **Size:** S

## Context
`app/api/typing/route.ts` keeps state in a module-scope `Map`. Behind multiple replicas, typing indicators flicker as clients land on different nodes.

## Scope
- Replace the Map with a Redis SET keyed by channel; values are `userId`.
- Use TTL via `EXPIRE`.
- Pattern matches the rate-limit Redis fallback in `lib/rateLimitStore.ts`.

## Acceptance criteria
1. Typing across replicas converges to the same indicator state.
2. In-process fallback when `REDIS_URL` is unset.
3. Four gates pass.

## Depends on
- UPG-003 (which deprecates HTTP typing entirely; this story is the bridge)
