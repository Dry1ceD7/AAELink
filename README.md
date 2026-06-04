<div align="center">

<img src="public/brand/aae-logo.png" alt="AAELink" height="84"/>

# AAELink

**Enterprise SuperApp — Advanced ID Asia Engineering Co.,Ltd**

[![CI](https://github.com/Dry1ceD7/AAELink/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Dry1ceD7/AAELink/actions/workflows/ci.yml)
[![Desktop Build](https://github.com/Dry1ceD7/AAELink/actions/workflows/desktop-build.yml/badge.svg?branch=main)](https://github.com/Dry1ceD7/AAELink/actions/workflows/desktop-build.yml)
[![Latest release](https://img.shields.io/github/v/release/Dry1ceD7/AAELink?display_name=release&label=latest%20release&color=1e63b3)](https://github.com/Dry1ceD7/AAELink/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Dry1ceD7/AAELink/total?label=downloads&color=blue)](https://github.com/Dry1ceD7/AAELink/releases)
[![License](https://img.shields.io/badge/license-Proprietary-0a2342)](#license)

### Current version: **`v0.0.57-alpha`** &nbsp;·&nbsp; [Download installers](https://github.com/Dry1ceD7/AAELink/releases/latest) &nbsp;·&nbsp; [Release notes](docs/release-notes/v0.0.57-alpha.md)

</div>

---

## About

**AAELink** is the internal enterprise SuperApp for **Advanced ID Asia Engineering Co.,Ltd**.
It started as an **IT Help Desk** and has grown into a **Slack/Mattermost-grade** communication and productivity platform — tickets, messaging, channels, files, compliance, identity, workflows, and more. **Audit-derived Slack parity (2026-06-04): 53.6% of behaviors Full, 84.4% Full-or-Partial across 263 audited behaviors** — see [`docs/parity-reference-matrix.md`](docs/parity-reference-matrix.md). **Redis Pub/Sub fan-out. WebSocket transport layer. Channel archival automation. Bulk user provisioning. Webhook HMAC signing. DLQ + data retention. IP access control. Prometheus metrics exporter. OpenTelemetry export. SCIM v2. OpenID Connect + SAML SP. MFA (TOTP + WebAuthn). CSP + CSRF middleware. Enterprise security hardening.**

The project ships as:

- **Docker Compose** for local dependencies (Postgres, MinIO, Stirling-PDF) and a **Next.js** app on the host.
- **Kubernetes-ready** with K8s manifests for production deployment.
- **Native desktop clients** for **Windows 10/11** and **macOS**.
- A **modern web UI** accessible from any browser on the same network.

---

## Install the Desktop Client

Download the latest installer from the [Releases](https://github.com/Dry1ceD7/AAELink/releases/latest) page.

| Platform | File | Notes |
|---|---|---|
| Windows 10 / 11 | `AAELink-Setup-*.exe` | NSIS installer, 64-bit |
| macOS | `AAELink-*.dmg` | Drag to Applications |

### First Launch

1. Install and open AAELink.
2. On first launch, you'll see the **Connect to Server** screen.
3. Enter the server host's WiFi IP address (e.g. `192.168.11.80`).
4. Click **Connect** — the app loads and saves the address for next time.

> **Note:** Both your device and the server host must be on the **same WiFi network**.

---

## Platform Capabilities (Slack parity — audit-derived 2026-06-04)

| Domain | Features | Routes |
|--------|----------|--------|
| **Messaging** | Channels, DMs, threads, reactions, forwarding, scheduled, drafts, permalinks, clips | 25+ |
| **Search** | Full-text messages, advanced filters, user search, file content search, cross-workspace | 5 |
| **Identity & Auth** | SSO (SAML/OIDC/OAuth2), SCIM, LDAP/AD, MFA (TOTP + backup codes), sessions, device trust | 12 |
| **Compliance** | Legal hold, eDiscovery export, DLP rules, information barriers, audit log, retention | 8 |
| **Collaboration** | Canvas docs, knowledge base, workflow builder, approvals, calendar, file preview | 10 |
| **Voice & Video** | Call rooms (voice/video/huddle/screen share), TURN/STUN config, participant tracking | 1+ |
| **Notifications** | In-app (SSE), email queue, push (APNS/FCM/Web Push), DND, keyword highlights | 6 |
| **Integrations** | Webhooks, bot users, OAuth apps, event subscriptions, email ingestion, plugins | 8 |
| **Admin** | Analytics, user/role/dept management, guest accounts, app policies, media policies | 15+ |
| **Infrastructure** | Background jobs, cluster management, data residency, EKM, backups, observability | 10+ |
| **Internationalization** | 18 locales, per-user locale preferences | 1 |
| **Desktop** | Electron (Win/macOS), auto-update, idle detection, tray, deep links | — |

> **Slack parity (audit-derived, 2026-06-04): 53.6% Full · 84.4% Full-or-Partial across 263 behaviors.** Status reflects working capability, not route existence — full breakdown in [`docs/parity-reference-matrix.md`](docs/parity-reference-matrix.md). Known env-blocked: SFU calls, APNS push, LDAP sync, KMS encryption-at-rest.

---

## Roadmap

### ✅ Completed (v0.0.2 → v0.0.9)

| Version | Milestone |
|---------|----------|
| v0.0.2 | Auth, users, roles, tickets, notifications, desktop clients |
| v0.0.3 | Channels, messages, threads, reactions, presence, 20+ micro-animations |
| v0.0.4 | Pins, bookmarks, link preview, webhooks, calendar |
| v0.0.5 | Rate limits, feature flags, default channels, activity feed |
| v0.0.6 | Advanced search, DND, custom emoji, slash commands, drafts |
| v0.0.7 | **Enterprise surface area** — SSO/SCIM/LDAP/MFA, compliance suite, federation, Canvas, calls, push, EKM, clustering (route + DDL scaffold; capability depth audited later — see parity matrix) |
| v0.0.8 | **Slack API method-group surface (30 groups)** — conversations.*, chat.*, views.*, oauth.*, workflows.*, functions.*, lists, assistant, reactions, usergroups, migration, 14 new DDL tables, 4 worker handlers (surface, not full capability — see [`docs/parity-reference-matrix.md`](docs/parity-reference-matrix.md)) |
| v0.0.9 | **Observability & Admin Console** — OpenTelemetry tracing (W3C traceparent, P50/P95/P99 metrics), Vitest test suite (30 tests), 4 new admin panels (OAuth, Functions, Migration, Observability), `/api/admin/tracing` |
| v0.0.10–v0.0.16 | Thread intelligence, notification UX, session intelligence, enterprise ticketing, document viewer, annotations, signatures, channel archival, bulk provisioning, CSRF hardening |
| v0.0.17 | **Full stabilization** — zero demo-data stubs, Prometheus metrics exporter, Grafana dashboard, 7 new integration test suites |
| v0.0.18 | **Slack UI/UX parity, A11y, Ticketing v2 & Document Automation** — a11y primitives + `window.confirm()`/`window.prompt()` elimination, system messages, message keyboard nav (J/K/R/T/E), search filter chips, channel context menu, inline-style → CSS-token migration, Jira-grade ticket state machine + SLA v2 (business hours, dual clocks, pausable) with admin UI, Puzzle Box document automation pipeline (ingest → extract → normalize → assemble → render → deliver) |
| v0.0.19 | **Documents Module v2** — schema consolidation (one canonical `client_profiles` + `document_templates`), Assembly Pipeline UI with stage chips + per-stage log + resume/discard/download, Assembly Ingest modal (paste text / upload file / pre-built JSON), HTML/CSS template editor with versioning + live preview + deactivate, ticket → document action with auto-comment delivery, `/api/documents/assemblies` DELETE + download endpoints, `/api/documents/templates` PATCH for activation toggle, 12 new pipeline tests |
| v0.0.20 | **Puzzle Box block-tree documents** — typed block library (logo/sender/recipient/delivery/order_meta/line_items/totals/terms/signature/note/text/image/divider/spacer), slot model with sources (manual/client/workspace/assembly/ticket/user/formula), per-document overrides, drag-resize-rearrange editor with live preview, automatic client swap, schema bump to `schema_version='2'`, seed catalogue (Order Confirmation), 49 new tests, legacy `/api/templates` + `/api/documents/assemble` retired |
| v0.0.21 | **Slack parity polish & cleanup** — QuickSwitcher absorbs CommandPalette into one `Cmd+K` (actions + channels + people + messages), 300ms hovercard on `@mentions`, thread unread badges + Mark all read + Unread filter, Call history module (`calls`), orphan-route detector hardened to reduce false positives, dead `CommandPalette.tsx` deleted |
| v0.0.22 | **Workspace rail + custom sidebar sections + Canvas persistence + a11y polish** — `Cmd+1..9` switches workspaces (rail hidden for single-workspace users); right-click any channel → Move to section → pick or create a custom group; `ChannelContextMenu` learned submenus + "Mark as read"; `CanvasEditor` now loads channel canvas on mount and auto-saves every 800ms via real `/api/docs/canvas`; new `?id=` single-canvas lookup endpoint; `/api/test` reads version from `package.json`; `lib/sidebarSections.ts` helper + 10 unit tests |
| v0.0.23 | **Single Preferences surface + Slack-class motion utilities** — collapsed `/settings` page + `PreferencesModal` into one 12-tab modal (Profile / Account & Security / Notifications / Home / Themes / Messages & Media / Mark As Read / Audio & Video / Language & Region / Accessibility / Help & IT / Advanced); avatar upload wired; new "Mark As Read" radio (oldest unread / most recent / newest), "Also notify you about" group (thread replies / huddle starts / VIP-during-DND), Audio & Video device pickers via `enumerateDevices()`, test-mic + test-speaker; deleted `SettingsShell.tsx` (1,172 lines), `SettingsDrawer.tsx`, slim `SessionManagementPanel.tsx`; new motion utility classes (`aae-hoverable`, `aae-hover-pop`, `aae-pop-in`) applied to ThreadsListPanel / CallHistoryPanel / UserHovercard |
| v0.0.24 | **Slack-class named theme palettes** — 12 palette catalogue (`Default Light/Dark`, `Aubergine`, `Banana`, `Forest`, `Hoth`, `Mint`, `Nocturne`, `Ochin`, `Terminal`, `Wartocks`, `Workhaus`), live preview swatches in Themes tab, cross-tab sync via `storage` event, FOUC-free boot in `ThemeBoot`; 10 new unit tests; total 1,326 passing |
| v0.0.25 | **Manage Sidebar menu + Avatar lightbox + animation sweep** — Slack §1.4 manage button (filter All/Unread/Active, hide muted, sort A→Z, show profile pictures) with localStorage-persisted prefs and full WAI-ARIA radio/checkbox semantics; `AvatarLightbox.tsx` opens full-size profile photos with backdrop blur + download + Esc dismiss; 6 high-traffic panels migrated from inline `transition:` strings to the `aae-hoverable` utility class |
| v0.0.26 | **Animation sweep round 2 + legacy v1 retired + Superpowers methodology** — 6 admin panels (EKM, EMM, DomainClaiming, LegalHold, AuditLog, CustomEmoji) migrated to `aae-hoverable`/`aae-chevron-toggle` (inline-`transition:` count down 24→19); `lib/puzzleBox/assemble.ts` legacy v1 fallback removed in favor of `legacy_template_unsupported` clear error; vendored [obra/superpowers](https://github.com/obra/superpowers) v5.1.0 (MIT) with always-on `.kiro/steering/superpowers.md`, three activatable adapted skills, and `superpowers-four-gates` post-write verification hook; `docs/audit-2026-05-15.md` full QA audit drives the v0.0.27 plan |
| v0.0.27 | **Security hardening — CSRF + audit-log lifted into `tracedRoute`** — every wrapped mutation method now auto-verifies CSRF before the handler runs and writes a structured `http.<method>.<route>` audit entry on success or failure; closes both P0 audit findings (12/236 → 235/236 routes for both); `verifyCsrf` made resilient to non-request contexts; new `tests/tracedRouteSecurity.test.ts` (11 tests) pins the chokepoint behavior — total 1,337 passing |
| v0.0.28 | **Drag-to-reorder default sidebar sections** — Slack §1.4 follow-on; new `lib/sidebarOrder.ts` ordering module (Starred / `__custom__` / Channels / DMs); HTML5 DnD on every section header with drag-over highlight + `cursor: grab/grabbing`; localStorage persistence; user-saved partial state preserved across version bumps that introduce new slots; new `tests/sidebarOrder.test.ts` (20 tests) — total 1,357 passing |
| v0.0.29 | **User Profile Pane (RHS) + DOM test harness** — Slack §9.2 closure: replaces `UserProfileCard` popup with `<UserProfilePanel>` deep-linkable via `?profile=`, eight sections, rail mutual-exclusion via new `closeAllRailPanes` / `openProfilePane` helpers; new test harness via `@testing-library/react` + `happy-dom` + Vitest 4 docblock env; new `tests/userProfilePanel.test.tsx` (10 tests) — total 1,367 passing |
| v0.0.30 | **Maintenance roll-up** — `npm audit fix` clears both high advisories (Next.js 16.x patch); animation sweep round 3 finishes the migration off hand-rolled `transition:` strings (final 14 are state-driven and stay inline); 65 documented Slack-compat / enterprise-admin / external-integration routes now carry a `// keep:` marker so the orphan detector reports zero unexplained orphans; `lib/templateEngine.ts` (379 lines) deleted, replaced by `lib/findReplace.ts` (40 lines) — total 1,315 passing |
| v0.0.31 | **Compact mode actually shrinks the chrome** — `messageDensity` is now the single source of truth for compact UI; `applyPreferenceSideEffects` mirrors it through `persistUiDensity` so the sidebar header, channel header, channel rows, and composer all tighten in lockstep with the message timeline; `app/layout.tsx` inline boot script does the same so cold loads are FOUC-free; PreferencesModal description rewritten to match actual scope — 1,315 passing |
| v0.0.32 | **Slash command registry de-duplication** — Composer's hardcoded 21-entry slash list (drifting from `lib/slashCommands.ts`) replaced with a runtime merge of `getClientSlashCommands()` + `getSlashCommands()`; new `lib/composerSlash.ts` export lists the seven client-handled commands (`/me`, `/shrug`, `/tableflip`, `/unflip`, `/code`, `/clear`, `/shortcuts`) so the parser and the autocomplete stay locked together; `tests/composerSlash.test.ts` (6 tests) pins the invariant — total 1,303 passing |
| v0.0.33 | **Workspace-scoped slash commands in autocomplete** — `GET /api/slash-commands?workspace_id=...` (shipped at v0.0.7) was never read by the Composer; new `lib/useWorkspaceSlashCommands.ts` hook fetches once per workspace, caches in a module-level `Map`, and merges custom commands into the alphabetical autocomplete list; `selectCustomCommands` mapper drops API-side built-ins (already in local registries) and reshapes survivors to the `{ name, description, usage }` shape; 9 mapper tests pin the contract — total 1,312 passing |
| v0.0.34 | **Redis pub/sub auto-connect** — closes audit §1.1 P0: `getPubSub()` now seeds a `MemoryPubSub` synchronously and kicks off a background Redis connect when `REDIS_URL` is set, swapping in the connected `RedisPubSub` once it lands; new `lib/redisClientFactory.ts` ships `wrapIoredis` and `defaultRedisClientFactory` (lazy `ioredis` import — package stays optional); `RedisPubSub.connect()` widened to accept async factories; `.env.example` documents `REDIS_URL` (now **required** for >1 Next.js node) and `WS_GATEWAY_URL` (queued for v0.0.35); 10 factory tests — total 1,322 passing |
| v0.0.35 | **WebSocket gateway service** — closes the second half of audit §1.1 / §2.1: standalone Node + `ws` process subscribes to the same Redis bus the Next.js app publishes to; new `lib/wsGateway/{protocol,router}.ts` (transport-agnostic, injectable `PubSubAdapter` for tests); new `scripts/wsGateway.ts` boot script (lazy `ws` import); `lib/session.ts` adds `readSessionUserIdFromCookieHeader` for non-Next.js contexts; `npm run ws:gateway` / `ws:gateway:dev` scripts; 13 protocol tests + 8 router tests — total 1,343 passing |
| v0.0.36 | **Replay-on-reconnect** — closes audit §2.1 follow-on: WS clients reconnecting with a `since` cursor now get the events they missed during disconnect (no more 2.5 s SSE-poll round-trip); new `lib/wsGateway/replay.ts` ships `ReplayStore` interface + `MemoryReplayStore` (per-pod ring buffer, `WS_REPLAY_MAX_PER_TOPIC` env-tunable, default 1000); protocol extended with optional `since` on subscribe + required `id` and optional `replay: true` on event frames; gateway boot script `psubscribe('*')`-feeds the store; 9 store tests + 4 router replay tests — total 1,356 passing |
| v0.0.37 | **Redis Streams replay store** — closes audit §2.1 cross-pod gap: `RedisStreamsReplayStore` implements the `ReplayStore` interface against `XADD MAXLEN ~ N` / `XRANGE` so retention is shared across gateway pods (was per-pod memory ring at v0.0.36); `wrapIoredisStream` adapter encapsulates the ioredis stream argument layout; boot script picks the streams store when `REDIS_URL` is set, falls back cleanly to memory when not; 7 streams adapter tests pin the behavior — total 1,363 passing |
| v0.0.38 | **Browser WS client + cursor management** — closes the v0.0.34–v0.0.37 stack: new `lib/wsClient.ts` ships `parseServerFrame` + `serializeClientFrame` (pure, tested) and `connectWsCollab(opts)` (browser-only) with auto-reconnect, 30 s heartbeat ping, per-topic cursor tracking, and resume-with-`since` on every reconnect so the v0.0.36/v0.0.37 replay store actually fires; 14 parser/serializer tests pin the protocol contract — total 1,377 passing |
| v0.0.39 | **Home shell speaks WebSocket** — `app/home/page.tsx` realtime hook switches on `NEXT_PUBLIC_WS_GATEWAY_URL`: when set, opens `connectWsCollab(...)` and routes `event` frames into the existing `onIncoming` / `onDeletions` handlers; when unset, keeps the SSE/poll fallback. End-to-end user-visible payoff for v0.0.34–v0.0.38: reconnect with no message gap. Defensive coercion on `payload: unknown` so a malformed server frame never crashes the timeline. `.env.example` documents the public env var. — total 1,377 passing (no test churn) |
| v0.0.40 | **`thread_update` events on the WS path** — extends v0.0.39's WS hook to also forward `thread_update` events into the timeline; reply counts on root posts now stay accurate when replies land on a different gateway pod or after a delete; defensive type checks on payload fields mirror the existing `message` and `deletion` cases — total 1,377 passing (no test churn) |
| v0.0.41 | **Multi-event WS sweep + bootstrap endpoint + pre-commit gates** — five wins in one release: `reaction`, `read_state`, `channel_update` events all wired into the WS hook (debounced refetches for aggregates and channel list; cross-tab "mark as read" sync); new `GET /api/bootstrap?workspace_id=` collapses 5 mount-time fetches into 1 (audit §2.3); new `scripts/git-hooks/pre-commit` runs all four gates locally (audit §2.6) — total 1,377 passing (no test churn — wiring + new server route + new shell script) |
| v0.0.42 | **OpenAPI generator + reactions E2E + WorkflowBuilder layout cleanup** — three audit items: `scripts/gen-openapi.mjs` walks every `tracedRoute(...)` and emits `docs/openapi.json` (237 routes / 448 operations / 71 tags) with `// keep:` markers as descriptions (§2.5); new `e2e/chat/reactions.spec.ts` adds reaction toolbar + chip tests (§1.3); 14 inline `style={{...}}` blocks in `WorkflowBuilder.tsx` lifted into 5 new `.workflow-*` utility classes (71 → 57 blocks; §1.2 round 1) — total 1,377 passing (no test churn) |
| v0.0.43 | **Foundation: real ESLint, coverage measurement, central logger, duplicate-index drop** — replaces v0.0.42's empty ESLint config with `typescript-eslint/recommended` + `react-hooks` rules (caught a real `useMemo`-after-early-return bug in `SlaCountdown.tsx`); installed `@vitest/coverage-v8` with conservative thresholds (50.28% lines / 48.43% statements baseline); new `lib/log.ts` process-scoped logger (separate from request-scoped `lib/logger.ts`); 16 redundant indexes (caught by Postgres MCP) dropped via idempotent `DROP INDEX IF EXISTS` block in `ensureSchema()`; 4 inline `require('crypto')` callsites cleaned up — total 1,383 passing (+6 logger tests) |
| v0.0.44 | **Wave 1 design system primitives** — seven new primitives at `app/components/primitives/*` (`<Surface>`, `<Stack>`, `<Modal>`, `<Tooltip>`, `<Skeleton>`, `<EmptyState>`, `<ErrorState>`) + design tokens (motion: `--motion-instant/-fast/-normal/-slow/-modal`; z-index scale `--z-modal-backdrop/-modal/-popover/-toast/-tooltip`; surface elevation tokens). Global `:focus-visible` ring for keyboard a11y. No production callsite migrated yet — sweep starts in v0.0.45 against the top three offenders (`LegalHoldPanel`, `EKMPanel`, `TicketingSettingsPanel`) — total 1,383 passing (no test churn) |
| v0.0.45 | **`lib/` console codemod + audit + roadmap docs** — `docs/audit-2026-05-19.md` and `docs/superpowers/plans/2026-05-19-slack-parity-roadmap.md` written to disk (the deliverables the previous turns walked through in chat); 8 `lib/` files migrated to `lib/log.ts` via new idempotent `scripts/codemod-console-to-log.mjs`; `lib/worker.ts` (47 callsites) deferred to v0.0.46 for dedicated batch — total 1,383 passing (no test churn) |
| v0.0.46 | **`lib/worker.ts` codemod + first primitive adoption** — closes audit F6: `lib/worker.ts` 47 `console.*` callsites migrated to `lib/log.ts` with structured fields (`name`, `error`); zero `console.*` remain in `lib/`. First production callsite for v0.0.44 primitives: `LegalHoldPanel` loading state → `<SkeletonStack>`, two empty states → `<EmptyState>` (68 → 62 inline blocks). Wave 2 sweep officially begun — total 1,383 passing (no test churn) |
| v0.0.47 | **`LegalHoldPanel` modal extraction → `<Modal>` primitive** — Create-hold dialog swapped from a hand-rolled `position: fixed` backdrop + nested card to a single `<Modal open onClose title footer>` call from `app/components/primitives`. Gains: Esc-to-close, body-scroll lock, `role="dialog"` + `aria-modal` + `aria-labelledby`, and z-index driven by the `--z-modal` token shipped in v0.0.44. Inline-style block count: 62 → ~50; ~20 lines of inline backdrop/card styling deleted — total 1,383 passing (no test churn) |
| v0.0.48 | **`LegalHoldPanel` stats grid → `<Surface>` cards** — the four header stat cards (Active Holds, Custodians, Total Holds, Exports) swapped from inline `padding`/`borderRadius`/`border` to `<Surface bordered padded="sm">`; token-driven radius and border now match every other surface in the app. Inline blocks ~50 → ~46 — total 1,383 passing (no test churn) |
| v0.0.49 | **`EKMPanel` full primitive adoption (loading, 2 empties, stats, modal)** — Wave-2 sweep applied to `EKMPanel.tsx` in one release: loading → `<SkeletonStack count={3} variant="card">`; keys-tab and audit-tab empty states → `<EmptyState>`; 4-card stats grid → `<Surface bordered padded="sm">`; the hand-rolled `position: fixed` Add-Key dialog → `<Modal>` (Esc-to-close, body-scroll lock, `role=dialog`/`aria-modal`/`aria-labelledby`, token-driven z-index). `Loader2` import removed. Inline blocks 67 → ~50 — total 1,383 passing (no test churn) |
| v0.0.50 | **`TicketingSettingsPanel` primitive adoption (loading + form/window surfaces)** — Wave-2 sweep into `TicketingSettingsPanel.tsx` (517 lines): loading → `<SkeletonStack count={3} variant="card">`; "Add a schedule" form container → `<Surface bordered padded="md">`; seven weekday window cards (Mon–Sun) → `<Surface bordered padded="sm">` each. Table-row cell styling deferred to a future `<DataTable>` primitive. Inline blocks 66 → ~57 — total 1,383 passing (no test churn) |
| v0.0.51 | **Composer polish (send-button states + reduced-motion guard)** — `.send-button` gains `:active` press feedback (`scale(0.96)` + `brightness(0.94)`), proper `:disabled` / `[aria-disabled="true"]` styling (opacity, grayscale, `cursor: not-allowed`), and `transform`/`opacity` joined the transition list using v0.0.44 motion tokens (`--motion-instant`, `--motion-fast`). Added `prefers-reduced-motion` guard that disables both the send-button press scale and the `.message--pending` pulse animation, mirroring the same accessibility pattern used by the v0.0.44 `<Skeleton>` primitive — total 1,383 passing (no test churn) |
| v0.0.52 | **Composer expand mode (Cmd+Shift+F)** — second composer-polish carve: new `expanded` state on `<Composer>` toggles a full-area panel via toolbar Maximize/Minimize button or the Cmd/Ctrl+Shift+F shortcut. Esc collapses (when no autocomplete is open). New `.composer--expanded` CSS uses `position: absolute; inset: 16px;` with `z-index: var(--z-modal)`, `surface-shadow-3`, and a 0.985→1.0 scale fade-in tied to `--motion-fast`. `prefers-reduced-motion` guard disables the entry animation. New `Maximize2`/`Minimize2` imports — total 1,383 passing (no test churn) |
| v0.0.53 | **Search filter parser → `lib/searchFilters.ts` (TDD)** — extracts the previously-inline `parseFilters` from `GlobalSearchModal.tsx` into `lib/searchFilters.ts`. New public surface: `parseSearchFilters(raw)`, `isValidDate(s)`, `validateHasValue(s)`, plus the `SearchFilters` type. 18 TDD tests written-first (and watched fail) before the implementation: text-only, single-filter extraction (`from`, `in`, `before`, `after`, `has`), multi-filter combinations, case-insensitive keys, malformed input, position-independence. `FILTER_SUGGESTIONS` chips expanded from 5 → 8 (per-`has`-keyword chips: link, file, pin, reaction). Inline parser deleted from `GlobalSearchModal.tsx` (~25 LOC) — total 1,401 passing (1,383 → +18 from the new searchFilters suite) |
| v0.0.54 | **`<Toggle>` primitive + first two adopters** — new `app/components/primitives/Toggle.tsx`: `<button role="switch">` with `aria-checked`, full keyboard activation, `labelledBy` linkage to a visible label, `disabled`, `danger`, focus-visible ring (uses the global v0.0.44 ring), `prefers-reduced-motion` guard. New `.ds-toggle*` CSS block at the bottom of `app/styles.css`. Adopted in `LegalHoldPanel` settings tab (4 toggles) and `EKMPanel` settings tab (3 toggles + the rotation-interval `<select>` gains `aria-labelledby`). Settings rows in both panels also moved to `<Surface bordered padded="md">` to match the rest of the design system. The settings toggles now actually toggle (previously they were locked to a hardcoded display state); local placeholder state hooks added in both panels. Inline blocks: LegalHoldPanel ~46 → ~38, EKMPanel ~50 → ~44 — total 1,401 passing (no test churn) |
| v0.0.55 | **`<SearchFiltersChips>` primitive + helper extension (TDD)** — extends `lib/searchFilters.ts` with `removeFilterToken(raw, key)` and `formatFilterChip(key, value)` plus a `FilterKey` type union. 13 new TDD tests written-first (and watched fail) before the implementation. New `app/components/primitives/SearchFilters.tsx`: declarative chip strip rendered as `role="list"` with `role="listitem"` chips and per-chip `aria-label` X buttons, returning `null` when no filters active. New `.ds-search-filter*` CSS block reuses the existing `--mm-mention-bg` / `--mm-mention-text` tokens for visual continuity with @mention rendering, plus reduced-motion guard. Existing `GlobalSearchModal.tsx` icon-rich chip UI preserved as-is; primitive is staged for future sidebar/in-channel search adoption — total 1,414 passing (1,401 → +13 from the new searchFiltersChip suite) |
| v0.0.56 | **`<DataTable>` primitive + TicketingSettingsPanel adoption** — new `app/components/primitives/DataTable.tsx` wraps `<table>` in a `.ds-table-scroll` overflow div + applies `.ds-table` styling to nested `thead/th/tr/td`. New CSS block in `app/styles.css` with dark-mode border overrides. Both tables in `TicketingSettingsPanel.tsx` (SLA policies + business-hours) plus `PolicyRow` migrated: outer `<div style={{ overflowX: 'auto' }}>` and per-cell `style={{ padding: '8px 4px' }}` deleted. Inline blocks ~57 → ~37 — total 1,414 passing (no test churn) |
| v0.0.57 | **Versioned migration runner (Camp A, release 1 of 3)** — new `lib/migrationRunner.ts` (~140 LOC) with `ensureMigrations(pool, migrations)` API: bookkeeping table `aaelink.schema_migrations`, idempotent re-run, fail-stops-tail, array-order-respected, `pg_advisory_lock` for concurrent-boot safety, and a synthetic-baseline path that detects existing populated databases (probes `aaelink.users` via `to_regclass`) and records `001_initial_schema` as already-applied without running it. The legacy `lib/migrate.ts` body is now `migration001InitialSchema` — verbatim, **no schema change** in this release. New `lib/MIGRATIONS.md` contributor doc covers the forward-only contract. 8 TDD tests written-first against a stub Pool. Brainstorm + plan on disk at `docs/superpowers/brainstorms/2026-05-19-migrate-split.md` and `docs/superpowers/plans/2026-05-19-migrate-split.md` — total 1,422 passing (1,414 → +8 from the new migrationRunner suite) |

### 🔜 Next: v0.0.20-alpha — Alerting, E2E Testing & Production Hardening

| Priority | Item | Description |
|----------|------|-------------|
| P0 | **Alertmanager rules** | Error rate > 5%, P99 latency > 500ms, DB pool exhaustion alerts |
| P0 | **E2E testing expansion** | Full Playwright flows: login → channel → message → thread → search |
| P0 | **mTLS federation** | Certificate-based auth for cross-org shared channels |
| P1 | **Audit log streaming** | Export audit events to SIEM (Splunk, Elastic, S3) |
| P1 | **API rate limit dashboard** | Real-time rate limit metrics per route/user/IP |
| P2 | **CI integration test runner** | Docker Compose-based CI pipeline with PostgreSQL + MinIO |
| P2 | **OpenAPI spec generation** | Auto-generate OpenAPI 3.1 spec from 227 route handlers |

### 🔜 v0.0.43-alpha — More inline-style cleanup + typing/presence WS migration

| Priority | Item | Description | Audit § |
|----------|------|-------------|---------|
| **P1** | **Inline `style={{...}}` reduction round 2** | `WorkflowBuilder.tsx` (57 remaining), then `LegalHoldPanel`, `EKMPanel`, `TicketingSettingsPanel` (≥60 blocks each) | §1.2 |
| **P1** | **`typing` / `presence` migration to WS** | Typing is HTTP polling today; presence has its own SSE stream | §2.1 |
| **P1** | **More E2E specs** | `read_state`, `channel_update`, thread reply, file upload, slash commands, RBAC denial | §1.3 |
| P2 | **Two moderate `npm audit` advisories** | `next` and `postcss` — accepted | — |
| P2 | **`lib/migrate.ts` monolith → versioned** | 2,380 lines | §2.2 |
| P2 | **`app/styles.css` split** | 17,696 lines | §2.4 |
| P2 | **Zod-typed bodies for OpenAPI** | Generator captures method/path today; richer schemas need typed handlers | §2.5 follow-on |
| P2 | **Gateway-side rate limiting** | Per-connection cap | — |

### ✅ Closed in v0.0.42

| Item | Description | Audit § |
|------|-------------|---------|
| **OpenAPI 3.1 generator** | `npm run openapi` walks `tracedRoute(...)` and emits `docs/openapi.json` (237 routes / 448 operations); `// keep:` markers carry through as descriptions | §2.5 |
| **Reactions E2E** | `e2e/chat/reactions.spec.ts` — toolbar + chip tests | §1.3 |
| **WorkflowBuilder inline cleanup round 1** | 14 layout shells → 5 `.workflow-*` utility classes; 71 → 57 blocks | §1.2 |

### ✅ Closed in v0.0.41

| Item | Description | Audit § |
|------|-------------|---------|
| **`reaction` events on WS** | Debounced refetch (200 ms per message_id) → `onReactionsUpdated` handler | §2.1 |
| **`read_state` events on WS** | Cross-tab "mark as read" sync; clears unread + mention counts when same user marks read elsewhere | §2.1 |
| **`channel_update` events on WS** | Debounced channel list refetch when admins edit topic/purpose/etc. | §2.1 |
| **Bootstrap endpoint** | `GET /api/bootstrap?workspace_id=` collapses 5 mount-time fetches into 1 | §2.3 |
| **Pre-commit four-gates hook** | `scripts/git-hooks/pre-commit` runs the same four gates CI runs | §2.6 |

### ✅ Closed in v0.0.40

| Item | Description | Audit § |
|------|-------------|---------|
| **`thread_update` events on the WS path** | Reply counts on root posts stay accurate across multi-pod fan-out and after deletes | §2.1 |

### ✅ Closed in v0.0.39

| Item | Description | Audit § |
|------|-------------|---------|
| **Home shell speaks WebSocket** | `app/home/page.tsx` opens `connectWsCollab` when `NEXT_PUBLIC_WS_GATEWAY_URL` is set; SSE fallback unchanged. End-to-end user-visible payoff for v0.0.34–v0.0.38 | §2.1 |

### ✅ Closed in v0.0.38

| Item | Description | Audit § |
|------|-------------|---------|
| **Browser WS client + cursor management** | `connectWsCollab` ships with auto-reconnect, 30 s heartbeat, per-topic cursor tracking, resume-with-`since` on every reconnect. Pure parser/serializer tested in unit; connection lifecycle pending E2E coverage | §2.1 |

### ✅ Closed in v0.0.37

| Item | Description | Audit § |
|------|-------------|---------|
| **Redis Streams replay store** | `RedisStreamsReplayStore` provides cross-pod replay coverage via `XADD MAXLEN ~ N` / `XRANGE`; swap from memory store is config-only (`REDIS_URL` set → streams) | §2.1 |

### ✅ Closed in v0.0.36

| Item | Description | Audit § |
|------|-------------|---------|
| **Replay-on-reconnect** | WS gateway now flushes events missed during a client's disconnect when the client re-subscribes with a `since` cursor; in-process `MemoryReplayStore` ships today, Redis Streams adapter swaps in via the same interface in v0.0.37 | §2.1 |

### ✅ Closed in v0.0.35

| Item | Description | Audit § |
|------|-------------|---------|
| **WebSocket gateway service** | Standalone Node + `ws` process subscribes to the Redis pub/sub bus and fans out to connected browsers; transport-agnostic router with injectable `PubSubAdapter` for tests; lazy `ws` import keeps the package optional | §1.1 / §2.1 |

### ✅ Closed in v0.0.34

| Item | Description | Audit § |
|------|-------------|---------|
| **Redis pub/sub auto-connect** | `getPubSub()` now actually connects when `REDIS_URL` is set; falls back to `MemoryPubSub` on connection failure with a one-time warning; `ioredis` stays an optional dependency via lazy import | §1.1 |
| **`REDIS_URL` and `WS_GATEWAY_URL` env-doc'd** | Both documented in `.env.example`; `REDIS_URL` is **required** for any deployment with >1 Next.js node | §1.1 |

### ✅ Closed in v0.0.33

| Item | Description | Audit § |
|------|-------------|---------|
| **Workspace-scoped slash commands in autocomplete** | `useWorkspaceSlashCommands` hook fetches and merges custom commands into the autocomplete; cached per workspace | mid-tier |

### ✅ Closed in v0.0.32

| Item | Description | Audit § |
|------|-------------|---------|
| **Slash command registry de-duplication** | Composer's hardcoded 21-entry list is gone; autocomplete is now a runtime merge of `getClientSlashCommands()` + `getSlashCommands()` | mid-tier |

### ✅ Closed in v0.0.31

| Item | Description | Audit § |
|------|-------------|---------|
| **Compact mode actually shrinks the chrome** | `messageDensity` now drives both `data-density` (timeline scope) and `data-mm-density` (sidebar / header / composer scope) so flipping the Preferences select tightens everything together | mid-tier |

### ✅ Closed in v0.0.30

| Item | Description | Audit § |
|------|-------------|---------|
| **`npm audit` clean-up (high)** | Both high advisories cleared via `npm audit fix` non-breaking patch | — |
| **Animation sweep round 3** | Hover-driven `transition:` strings migrated to `aae-hoverable` / `aae-hover-pop`; 14 state-driven cases remain inline by design | — |
| **Orphan-route review** | Detector now honors `// keep: <reason>` markers; 65 routes marked, 0 unexplained orphans | — |
| **Migrate `find-replace` off `lib/templateEngine.ts`** | New 40-line `lib/findReplace.ts`; 379-line legacy engine + ~52 unused tests deleted | — |

### ✅ Closed in v0.0.29

| Item | Description | Audit § |
|------|-------------|---------|
| **User Profile Pane** (RHS) | Eight-section profile pane, deep-linkable via `?profile=`, replaces deprecated popup | §9.2 |
| **Rail mutual-exclusion** | New `closeAllRailPanes` / `openProfilePane` helpers; one rail surface at a time | — |
| **DOM test harness** | `@testing-library/react` + `happy-dom` + Vitest 4 docblock env; opens the door to component tests across the project | — |

### ✅ Closed in v0.0.28

| Item | Description | Audit § |
|------|-------------|---------|
| **Drag-to-reorder default sidebar sections** | Starred / Custom / Channels / DMs with HTML5 DnD + localStorage; user-saved partial state preserved across version bumps | §1.4 |

### ✅ Closed in v0.0.27

| Item | Description | Audit § |
|------|-------------|---------|
| **CSRF coverage** | `verifyCsrf` lifted into `tracedRoute` — 235/236 routes auto-protected | — |
| **Audit-log coverage** | `writeAuditLog` lifted into `tracedRoute` — every mutation writes a structured entry | — |
| **`verifyCsrf` non-request resilience** | Returns null when `cookies()` is unavailable (unit-test parity) | — |

### ✅ Closed in v0.0.26

| Item | Description | Audit § |
|------|-------------|---------|
| **Animation sweep round 2** | 6 admin panels migrated to `aae-hoverable` / `aae-chevron-toggle` | — |
| **Legacy v1 doc fallback retired** | `lib/puzzleBox/assemble.ts` now returns `legacy_template_unsupported` for pre-v2 rows | — |
| **Superpowers methodology installed** | Vendored MIT `.claude/skills/superpowers/`, always-on steering, post-write verification hook | — |
| **Full QA audit refreshed** | `docs/audit-2026-05-15.md` — surfaces the two P0 security findings that drive v0.0.27 | — |

### ✅ Closed in v0.0.25

| Item | Description | Audit § |
|------|-------------|---------|
| **Manage Sidebar menu** | Filter (All/Unread/Active 30d), Hide muted, Sort A→Z, Show profile pictures — full WAI-ARIA semantics | §1.4 |
| **Avatar lightbox** | Click profile avatar → backdrop-blurred full-size viewer with download and Esc-dismiss | — |
| **Animation sweep round 1** | 6 panels migrated to `aae-hoverable` utility class | — |

### ✅ Closed in v0.0.24

| Item | Description | Audit § |
|------|-------------|---------|
| **Named theme palettes** | 12-palette catalogue, live preview swatches, cross-tab sync | §10.2 |

### ✅ Closed in v0.0.23

| Item | Description | Audit § |
|------|-------------|---------|
| **Single Preferences surface** | Collapsed `/settings` + `PreferencesModal` into one 12-tab modal | — |
| **Mark As Read tab** | Three-way radio: oldest unread / most recent / newest | §10 |
| **Audio & Video tab** | Mic / speaker / camera pickers, test-mic + test-speaker | §10 |
| **"Also notify you about"** | Thread replies, huddle starts, VIP-during-DND | §Notifications |
| **Avatar upload** | Profile photo upload via `/api/files/upload` | §9.2 |
| **Motion utility classes** | `aae-hoverable`, `aae-hover-pop`, `aae-pop-in`, `aae-chevron-toggle`, `aae-rhs-enter` | — |

### ✅ Closed in v0.0.22

| Item | Description | Audit § |
|------|-------------|---------|
| **Workspace switcher `Cmd+1..9`** | Switch workspaces from the keyboard; rail auto-hides for single-workspace users | §1.1 |
| **Custom sidebar sections** | Right-click → Move to section → pick existing or create new; persists via `/api/channel-categories` | §1.3 |
| **Canvas persistence** | `CanvasEditor` loads + auto-saves canvases server-side | §14.1 |

### ✅ Closed in v0.0.21

| Item | Description | Audit § |
|------|-------------|---------|
| **QuickSwitcher dedup** | Merged CommandPalette + QuickSwitcher into one `Cmd+K` | §7.1 |
| **User hovercard** | 300ms hover → mini profile card on @mentions | §9.1 |
| **Thread list unread badges** | Per-thread unread indicators + "Mark all read" + Unread filter | §6.2 |
| **Call history UI** | `CallHistoryPanel` lists active + past calls with type/duration/participants | §13.8 |

### 🗓️ v0.1.0-beta — Production Readiness

| Priority | Item | Description |
|----------|------|-------------|
| P0 | **Kubernetes production manifests** | Helm chart with horizontal pod autoscaling, ingress, cert-manager |
| P0 | **Redis pub/sub fan-out** | Replace Postgres NOTIFY for SSE at scale (>500 concurrent connections) |
| P0 | **Elasticsearch integration** | Swap SQL full-text for Elasticsearch/OpenSearch at scale |
| P1 | **WebRTC media server** | Janus/mediasoup integration for actual voice/video/screen share media |
| P1 | **Native mobile app (PWA)** | Progressive Web App shell with push notifications, offline cache |
| P1 | **LDAP live connector** | Actual LDAP bind/search against Active Directory |
| P2 | **ClamAV integration** | Connect file scan API to live ClamAV daemon |
| P2 | **HSM/KMS integration** | Connect EKM API to AWS KMS / Azure Key Vault / HashiCorp Vault |

### 🎯 v1.0.0 — Enterprise GA

| Priority | Item | Description |
|----------|------|-------------|
| P0 | **Native mobile clients** | React Native iOS/Android with push proxy (APNS/FCM) |
| P0 | **WebRTC calls** | Full voice/video/screen share with TURN/STUN servers |
| P0 | **SOC 2 Type II audit** | Compliance certification readiness |
| P1 | **Federation protocol** | Cross-org message relay for shared channels |
| P1 | **Plugin SDK** | Developer SDK for building and distributing AAELink plugins |
| P2 | **Marketplace** | App marketplace for third-party integrations |
| P2 | **AI assistant** | Built-in AI copilot for message summarization, search, and workflows |

---

## Stack

| Layer | Technology |
|---|---|
| App server | **Next.js 16** (App Router + Route Handlers), **Node.js 22** |
| Web UI | React 19, TypeScript |
| Desktop | Electron (loads web UI URL; electron-builder installers) |
| Database | PostgreSQL 17 (schema `aaelink`; auto-migrated on startup) |
| Local deps | Docker Compose: Postgres, MinIO, Stirling-PDF |
| File storage | S3-compatible API (MinIO in dev) |

---

## Run the Server (Local Development)

### Prerequisites

- [Node.js](https://nodejs.org/) 22+ (LTS recommended)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) for Compose services
- [Git](https://git-scm.com/)

### Steps

```bash
git clone https://github.com/Dry1ceD7/AAELink.git
cd AAELink
cp .env.example .env
# Edit .env: set secrets, DATABASE_URL, S3_* as needed.
npm run docker:up
npm ci
AAELINK_SEED_ADMIN_PASSWORD='choose-a-long-password' npm run seed:platform-admin
npm run dev
```

The seed step creates the platform super-admin (`adminaaelink` / `adminaaelink@aae.co.th`).

| What | URL / Port |
|---|---|
| AAELink (Next.js) | http://localhost:3040 |
| PostgreSQL | `127.0.0.1:25432` |
| MinIO S3 API | `http://127.0.0.1:29000` (console `:29001`) |
| Stirling-PDF | `http://localhost:28085` |

### Serve Other Devices on WiFi

To let other PCs or the desktop client connect over WiFi:

```bash
npm run dev:wifi:auto
```

This binds the server to `0.0.0.0:3040`, detects your WiFi IP, and configures everything automatically. Other devices connect to `http://<YOUR_WIFI_IP>:3040`.

> **Tip:** Make sure macOS firewall allows connections on port 3040.

---

## Project Structure

```
AAELink/
├── app/               # Next.js App Router: pages, layouts, API routes
├── lib/               # Shared libraries (API client, realtime, migrations)
├── public/            # Static assets and branding
├── desktop/           # Electron desktop shell
├── scripts/           # Tooling (seed scripts, dev helpers)
├── docs/              # Documentation
├── docker-compose.yml # Postgres, MinIO, Stirling-PDF
├── package.json       # npm run dev / build / start
└── .github/workflows/ # CI / Desktop build
```

---

## License

Proprietary — © Advanced ID Asia Engineering Co.,Ltd. All rights reserved.

This software, including its source code, binaries, designs, and documentation,
is the confidential property of **Advanced ID Asia Engineering Co.,Ltd** and is
intended solely for internal use by employees and authorized partners. No part
of this project may be copied, redistributed, sublicensed, or used outside of
Advanced ID Asia Engineering Co.,Ltd without prior written permission.
