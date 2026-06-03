# AAELink State

Read at session start. Update with /handoff before ending a session.
Non-personal voice. No emojis.

Last updated: 2026-06-02 (Stage A audit + Stage B remediation).

## Source of truth
- Parity scope: `docs/SLACK-PARITY-DIRECTIVE.md` (12 domains; AI/ML out of scope).
- Status: `docs/audits/deep-audit-2026-06-02.md` — the authoritative parity ledger
  (D1-D12 Done/Partial/Gap) and finding list.
- Parity matrices: `docs/parity-reference-matrix.md`,
  `docs/parity-slack-mattermost-aaelink-full-map.md`.

## Done
- Single `.claude` agent/skill registry; legacy systems (.agents/.kiro/_bmad/
  _skills-import) archived.
- Bun cutover complete: CI is Bun-only (lint, type-check, test, build, e2e).
- Component reorg committed: `app/components/*` (flat) -> `components/<category>/*`.
- Baseline gates green: tsc 0 errors, lint 0 errors (146 warnings), 1485 unit
  tests pass (129 files), `next build` succeeds, no circular deps.
- Enterprise Grid foundation shipped (contradicts older "not started" note):
  `organizations` + `org_members` tables (migrate v0.0.44), `workspaces.org_id`,
  `lib/enterprise/{orgAdmin,orgMembers,orgPolicies}`, routes `admin/org/[orgId]/*`,
  `admin/roles`, full `scim/v2/*`, compliance suite (DLP, barriers, legal-holds,
  retention, audit streams), 50+ admin routes.

## Stage B remediation (this session)
- C2 resolved: 678-change mid-reorg tree committed as a clean baseline.
- C1 resolved: removed live AI surfaces (AISummaryPanel, /api/assistant, 'ai'
  nav) — Deferred(AI) per scope section 2.
- C3 resolved: this STATE.md rewritten from reality.
- H1: Redis added to docker-compose.yml (port 26379).
- H2: root package-lock.json removed; bun.lock is the tracked lockfile.
- H3: test:integration / test:all scripts added (DB-backed __tests__ suite now
  a discoverable local gate, not CI-only).
- H4: pg value imports converted to type-only; eslint no-restricted-imports rule
  enforces getPool() going forward.
- H5: stale dated audits moved to docs/_archive/.

## Stage C progress (this session)
- CRITICAL fix: fresh-database migration built only 30 of 145 tables (a seed
  guard `if (!users[0]) return` also gated ~115 CREATE TABLE statements). Fixed
  + backfill migration 002. Fresh DB now builds 138 tables. This means clean
  deploys (CI/k8s/new dev) were previously broken for all org/compliance/admin
  routes. See deep-audit C4.
- Fixed 14 enterprise-table columns mistyped UUID (base ids are TEXT) — FKs
  failed on fresh DB. See C5.
- Repaired the __tests__/api integration harness (stale import, wrong users/
  sessions schema, wrong cookie, CI `--dir` no-op). Added
  vitest.integration.config.ts. See C6.
- Shipped D1 workspace discovery (migration 003 access levels +
  /api/workspaces/discover + lib + lib-layer test). D1 discovery Gap → Done.

## Next (Stage C — build in-scope parity gaps, phase order in the directive section 7)
- Re-validate schema-dependent "Done" routes (D9/D10/org/roles) with DB-backed
  lib-layer tests now that the schema actually builds (their "Done" was
  unverified — see C4 correction note at the top of the audit).
- Phase 1 (D1): org-wide channels, workspace discovery, access levels, enterprise
  identity cross-workspace verification, workspace move/archive lifecycle.
- Phase 2 (D2): domain claiming, SAML signed-response + owner bypass, session
  duration enforcement, MFA/EMM cascade, single-channel guest mgmt.
- Phase 3 (D3+D4): user-group mentions, edit-history, download-all; D4 migrate
  search from ILIKE to PostgreSQL FTS + filters + cross-workspace + saved searches.
- See `docs/audits/deep-audit-2026-06-02.md` section A1b for the full ordered list.

## Watch / tracked follow-ups
- TEST HARNESS GAP (audit C7): route handlers invoked directly under vitest 500
  because readSessionUserId() calls cookies() (next/headers) outside a request
  scope. Cookie-auth routes can't be tested by direct invocation. Verify
  business logic at the lib layer (as D1 discovery does) or via a running server
  (Playwright). Needs a request-context shim or a documented testing standard.
- H7 (infra): `infra/k3s` and `infra/docker-desktop` kustomize deploy MATTERMOST
  (namespace `mattermost`, mattermost image, MATTERMOST_URL), not AAELink. There
  is no AAELink Kubernetes deployment manifest. Authoring real AAELink manifests
  is a Stage C infra epic; do not delete mattermost.yaml piecemeal (it would
  break the kustomization).
- Blueprint consolidation (H5, needs human decision): multiple overlapping
  canonical-ish docs coexist — BLUEPRINT.md, ENTERPRISE-BLUEPRINT.md,
  NORTH-STAR-A.md, ARCHITECTURE-{AAELINK-STACK,MATTERMOST-TO-AAELINK}.md,
  architecture-{technical,ecosystem-map}.md, ROADMAP.md vs ROADMAP-PHASES-AND-
  LAYERS.md vs ROADMAP.yaml. Pick one canonical set; archive the rest.
- Oversized refactor targets (not blockers): lib/infra/migrate.ts (2541),
  app/home/page.tsx (1808), components/tickets/TicketsPanel.tsx (1522),
  components/modals/PreferencesModal.tsx (1179), app/styles.css (18278).
- Dead-file cleanup (knip 74): components/media/FilePreviewModal.tsx,
  components/modals/ContentFlagModal.tsx, components/shared/ModuleChrome.tsx,
  components/tickets/SlaCountdown.tsx — confirm dead then remove. Add knip.json.
- bun audit: 1 moderate (brace-expansion via eslint toolchain) — accept or
  `bun update`.
- M5: CatchUpView is notification triage (no AI) but carries Slack "Catch Up"
  framing; keep as triage or rename to avoid AI association.
