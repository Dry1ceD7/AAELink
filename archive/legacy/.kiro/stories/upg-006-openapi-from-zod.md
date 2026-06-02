---
source_finding: UPG-006
pillar: "🟡 Upgrades Recommended"
severity: P2
slug: upg-006-openapi-from-zod
created_at: 2026-05-26
audit_run: docs/audit-2026-05-26.md
---

# Story: Generate OpenAPI 3.1 from Zod schemas

- **Roadmap milestone:** v0.0.60-alpha
- **Size:** L

## Scope
- Add `zod` dependency.
- Co-locate request/response schemas next to each route handler.
- Have `scripts/gen-openapi.mjs` walk the route tree and emit `docs/openapi.json`.
- ADR-0014: Zod adoption.

## Acceptance criteria
1. `npm run openapi` regenerates `docs/openapi.json` from source schemas.
2. The output validates against OpenAPI 3.1 schema.
3. Four gates pass.
