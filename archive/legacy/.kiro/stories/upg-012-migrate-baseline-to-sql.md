---
source_finding: UPG-012
pillar: "🟡 Upgrades Recommended"
severity: P2
slug: upg-012-migrate-baseline-to-sql
created_at: 2026-05-26
audit_run: docs/audit-2026-05-26.md
---

# Story: Convert lib/migrate.ts baseline to plain SQL files

- **Roadmap milestone:** v0.0.59-alpha
- **Size:** M

## Context
Same target as CHG-001 but a smaller scope: just convert the existing `migration001InitialSchema` body to a `.sql` file. CHG-001 handles the runner refactor that consumes it.

## Scope
- Capture `migration001InitialSchema` body verbatim in `migrations/0001_initial_schema.sql`.
- `lib/migrate.ts` registers the SQL file via `migrationRunner.registerSqlFile(...)`.

## Acceptance criteria
1. Identical schema output via Postgres MCP `analyze_db_health`.
2. `tests/migrate.test.ts` continues to pass.
