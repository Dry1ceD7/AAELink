---
source_finding: UPG-004
pillar: "🟡 Upgrades Recommended"
severity: P2
slug: upg-004-e2e-suite-expansion
created_at: 2026-05-26
audit_run: docs/audit-2026-05-26.md
---

# Story: Six new Playwright E2E specs

- **Roadmap milestone:** v0.0.59-alpha
- **Size:** M

## Scope
6 new specs under `e2e/`:
- `e2e/chat/threads.spec.ts` — thread reply
- `e2e/chat/upload.spec.ts` — file upload + preview
- `e2e/chat/slash.spec.ts` — slash command exec
- `e2e/admin/rbac-deny.spec.ts` — RBAC denial path
- `e2e/dm/create.spec.ts` — DM creation
- `e2e/search/messages.spec.ts` — search with operators

## Acceptance criteria
1. All 6 specs pass against the dev stack.
2. CI runs them in parallel projects.
3. Total wall-clock < 8 minutes on the existing GitHub runner.
