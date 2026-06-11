# ADR-0013: Electron → Tauri desktop migration

- **Status:** Proposed
- **Date:** 2026-05-26
- **Deciders:** AAELink architecture team
- **Related:** `docs/BLUEPRINT.md` § 4.2; audit-2026-05-26 DRIFT-011; UPG-005; `docs/ROADMAP.yaml` post-ga.desktop-tauri-migration

## Context

`docs/BLUEPRINT.md` § 4.2 frames the desktop client as "Electron (current) → Tauri (target)". `desktop/` is an `aaelink-desktop` Electron package today. ENTERPRISE-BLUEPRINT and the previous ROADMAP carried no migration item — audit DRIFT-011 records the gap.

Tauri's value proposition over Electron: ~3× smaller installer, ~3× lower memory, native webview avoids bundling Chromium.

## Decision

Migrate the `desktop/` Electron client to Tauri at milestone M7, after a 2-day spike (UPG-005) confirms the AAELink IPC surface (`desktop/src/main/ipcHandlers.js`) maps cleanly onto Tauri commands. The Electron build stays available behind a flag for one minor version after the Tauri build ships.

## Alternatives considered

1. **Stay on Electron.** Works; misses the BLUEPRINT § 4.2 target, the bundle-size win, and the memory-footprint win. Reject as the GA target.
2. **Build a native AppKit / WPF / GTK shell.** Three implementations to maintain. Reject.
3. **Pure-PWA replacement.** PWAs do not match the IT-deployment story (MDM, MSI, EXE installers, code signing). Reject as the only desktop target.

## Consequences

### Positive
- 3× smaller installer, 3× lower memory.
- Aligns with BLUEPRINT § 4.2.
- Keeps a Rust runtime on the AAELink stack (paves the way for native crypto / KMS work).

### Negative
- New language in the desktop tree (Rust).
- Code signing pipeline rewrite (electron-builder is not Tauri-compatible).
- Auto-updater rewrite (electron-updater → Tauri's updater).

### Neutral
- The web bundle is shared; the Tauri shell loads `https://localhost:3040/home` exactly like the Electron shell does today.

## Implementation notes

- Spike (UPG-005) lives at `desktop-tauri/`. The full migration moves it to `desktop/` after Electron is removed.
- Code-signing certs already exist for the AAELink Electron build; verify they apply to Tauri's signed-binary distribution model.

## References

- `docs/BLUEPRINT.md` § 4.2
- `docs/audit-2026-05-26.md` § Goal Drift Flags — DRIFT-011 + UPG-005
- Tauri documentation: <https://tauri.app/>
