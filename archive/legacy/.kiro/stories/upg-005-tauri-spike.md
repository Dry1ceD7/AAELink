---
source_finding: UPG-005
pillar: "🟡 Upgrades Recommended"
severity: P2
slug: upg-005-tauri-spike
created_at: 2026-05-26
audit_run: docs/audit-2026-05-26.md
---

# Story: Tauri desktop spike (proves DRIFT-011 closeable)

- **Roadmap milestone:** v0.0.60-alpha (spike); v1.0.0 (full migration)
- **Size:** M (2-day spike) → L (full migration if greenlit)

## Scope
- Wrap a Tauri build artifact alongside the Electron one in `desktop-tauri/`.
- Verify it loads `https://localhost:3040/home` with the same session-cookie behavior.
- Deliverable: spike report at `docs/superpowers/plans/tauri-spike-report.md`.

## Acceptance criteria
1. `npm run desktop:tauri:dev` opens a window that signs in and shows the home shell.
2. macOS + Windows artifacts produced under `desktop-tauri/src-tauri/target/`.
3. Spike report names go/no-go criteria for full migration.

## References
- `docs/BLUEPRINT.md` § 4.2 (Electron → Tauri target)
- `docs/audit-2026-05-26.md` § Upgrades — UPG-005, DRIFT-011
