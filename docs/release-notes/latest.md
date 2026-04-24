# AAELink v0.0.1-Alpha

> **Tag:** `v0.0.1-alpha` &middot; **Channel:** Alpha &middot; **Status:** Resubmitted alpha baseline

This release resubmits the current AAELink baseline with deployment fixes,
updated documentation, and a complete installer asset set for Windows and
macOS.

---

## What's New

### Product capabilities
- IT Help Desk workflow with ticket creation, assignment, comments, and status transitions.
- Realtime notification stream in the app using SSE, with unread badge and in-app panel.
- Email notifications routed to verified account addresses for creators, assignees, and IT staff.
- Admin role management with custom role creation and granular permission assignment.
- Security workflow updates including two-step password confirmation in create/reset paths.
- Department-aware ticket visibility for strict data isolation between non-IT teams.

### Desktop deliverables
- Windows installer: `AAELink-Setup-0.0.1-alpha.exe`.
- macOS installers: `AAELink-0.0.1-alpha-arm64.dmg` and `AAELink-0.0.1-alpha-x64.dmg`.
- Persistent sign-in with secure token storage and release-based in-app update checks.

## Changed
- Navigation and layout polish: global back navigation, cleaner module entry points, and refined admin flows.
- Administration portal structure now centralizes user, department, and role operations.
- Settings and notification surfaces updated for denser enterprise workflows.
- Release workflow enforces explicit artifact allowlist and release-notes body publishing.

## Fixed
- UI overlap and drag-region layering issues affecting titlebar interaction.
- Notification delivery gaps where assignees or creators missed ticket updates.
- API authorization behavior for ticket list/detail visibility by role and department.
- Release artifact hygiene: blocked files (`*.zip`, `*.blockmap`, `latest*.yml`, `builder-*.yml`) are pruned before publish.

## Known Issues
- Alpha builds are not code-signed yet; some OS security prompts may appear during installation.
- Breaking changes may still occur between alpha updates for selected admin and notification endpoints.
- Production SMTP configuration remains environment-dependent and must be validated per deployment.

---

## Release Assets

| Asset | Platform |
|---|---|
| `AAELink-Setup-0.0.1-alpha.exe` | Windows 10 / 11 (x64) |
| `AAELink-0.0.1-alpha-arm64.dmg` | macOS, Apple Silicon |
| `AAELink-0.0.1-alpha-x64.dmg` | macOS, Intel |
| `Source code (zip)` | Source archive |
| `Source code (tar.gz)` | Source archive |
