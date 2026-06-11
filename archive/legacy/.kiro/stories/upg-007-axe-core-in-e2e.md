---
source_finding: UPG-007
pillar: "🟡 Upgrades Recommended"
severity: P2
slug: upg-007-axe-core-in-e2e
created_at: 2026-05-26
audit_run: docs/audit-2026-05-26.md
---

# Story: Axe-core in E2E + zero-violations gate

- **Roadmap milestone:** v0.0.60-alpha (gate); v0.1.0 (enforce)
- **Size:** M

## Scope
- Add `@axe-core/playwright` to devDependencies.
- New `e2e/a11y/*.spec.ts` covering: login, home shell, message timeline, modal focus trap, theme contrast (12 themes).
- Gate v0.1.0 release on zero axe-core violations.

## Acceptance criteria
1. Axe-core runs against every visited page in the suite.
2. Violations broken down by severity in CI output.
3. Four gates pass; zero violations at "serious" / "critical" level.
