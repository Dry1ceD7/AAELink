# Slack Parity Roadmap — v0.0.45 → v0.1.0

**Authored:** 2026-05-19
**Audit basis:** `docs/audit-2026-05-19.md`
**Status today:** v0.0.44-alpha shipped — foundation + Wave 1 design system primitives in place
**Goal:** make this app feel like (or better than) Slack, end-to-end

This is the **executable** plan. Each release is a single coherent batch with clear pieces, gates, and exit criteria. Branches off `main`; one PR per release.

---

## Operating principles

- One release = one PR = one user-visible win
- Every release ends with all four gates green: `tsc / eslint / vitest / next build`
- Brainstorming gate (Superpowers) before any release that splits a >1,000-line file
- Bonus items folded only when they fit the same release's review surface
- Releases are paced so reviewers can read each one in <30 minutes

---

## Sprint A — UI sweep + search (Week 1–2)

### v0.0.45 — Wave 2: primitive adoption sweep + motion polish + search filters

**Pieces (one batch):**

1. **Adopt primitives in top-3 inline-style offenders** — replace inline `style={{...}}` shells with the `<Surface>` / `<Stack>` primitives from v0.0.44, swap spinners for `<Skeleton>`, plain "No data" for `<EmptyState>`. Targets:
   - `app/components/admin/LegalHoldPanel.tsx` (68 → ~25)
   - `app/components/admin/EKMPanel.tsx` (67 → ~25)
   - `app/components/admin/TicketingSettingsPanel.tsx` (66 → ~25)
   - **Net: ~120 inline blocks lifted; total inline count 2,254 → ~2,135**

2. **Motion polish round 1** — migrate inline `transition:` strings on top-7 panels to motion-token classes. Standardize on `var(--motion-fast)` for hover, `var(--motion-modal)` for modals.

3. **Search filter operators** — token parser for `from:`, `in:`, `before:`, `after:`, `has:link`, `has:file` + chip UI + structured query. New `<SearchFilters>` primitive in `app/components/primitives/SearchFilters.tsx`.

4. **Composer polish** — mention pill CSS class, optimistic-message-send opacity (`.message--pending`), send-button state animation.

5. **Bonus:** Codemod 12 `lib/` `console.*` callsites to `lib/log.ts`.

**Tests:** new `tests/searchFilters.test.ts` for the parser. Existing test count stays ≥1,383.

**Gates:** all four green.

**Exit criteria:**
- Inline `style={{...}}` count <2,150 (down from 2,254)
- Search bar accepts `from:@user in:#channel` and renders chips
- Pending messages render at 60% opacity via CSS class
- 12 `lib/` files no longer use raw `console.*`

---

### v0.0.46 — Home shell split phase A + composer polish

**Brainstorming gate triggers** — `app/home/page.tsx` is 1,779 lines / 114 hooks. Cut points need explicit sign-off.

**Pieces (one batch after sign-off):**

1. **`useTimelineConnection` extraction** — owns the SSE/WS hook + onIncoming/onDeletions composition + sinceMs cursor + bootstrap-prefetch effect's timeline portion. Pulls out ~250 lines from `app/home/page.tsx`.

2. **Composer expand mode** — Cmd+Shift+F maximizes the composer. New CSS class `.composer--expanded`, keyboard handler in `Composer.tsx`.

3. **Slash command inline preview** — show command syntax inline as user types matching `/`.

4. **Codemod remaining `console.*` in `app/components`** — 29 callsites.

**Tests:** new `tests/useTimelineConnection.test.tsx`.

**Gates:** all four green.

**Exit criteria:**
- `app/home/page.tsx` <1,550 lines
- Cmd+Shift+F toggles composer expand mode
- 0 raw `console.*` in `app/components` (audit `grep "console\." app/components -l | wc -l` = 0)

---

### v0.0.47 — Dockerfile + CI image build + a11y audit

**Pieces:**

1. **Multi-stage Node 22 Dockerfile** — `FROM node:22-alpine AS deps`, `FROM ... AS builder`, `FROM ... AS runner`. Final image <250 MB.

2. **GitHub Actions image build** — `.github/workflows/image.yml` builds on tag pushes, pushes to GHCR.

3. **Icon-button `aria-label` audit** — find every `<button>` with no text and no `aria-label`, add labels. Target component count: ~20.

4. **Mouse-only menu audit** — keyboard-walk every dropdown/popover, fix any that don't open on Space/Enter or close on Esc.

**Tests:** none new (audit-style work).

**Gates:** all four green; new `image-build` job green in CI.

**Exit criteria:**
- `docker build .` produces a <250 MB image
- All icon-only buttons have `aria-label`
- All dropdowns work with keyboard

---

## Sprint B — Architecture refactors (Week 3–6)

### v0.0.48 — Migrations split phase A

**Brainstorming gate triggers** — `lib/migrate.ts` is 2,380 lines, called by every route. Risky surgery.

**Pieces (after sign-off):**

1. **`migrations/` directory** — `0001_initial_schema.sql` ... `000N_*.sql`.

2. **`lib/migrationRunner.ts`** — records applied migrations in `aaelink.migrations` table. Idempotent, picks up un-applied at runtime.

3. **`ensureSchema()` becomes a wrapper** — calls `migrationRunner.applyAll()` instead of raw SQL.

4. **Validation test** — runs all migrations against fresh Postgres in CI, compares schema diff against the v0.0.47 baseline. Postgres MCP `get_object_details` per table.

**Tests:** new `tests/migrationRunner.test.ts`.

**Gates:** all four green; new schema-equivalence integration test.

**Exit criteria:**
- `migrations/` directory contains the full schema split into <500-line files
- `lib/migrate.ts` becomes a 30-line wrapper
- CI runs cold migration against ephemeral Postgres and passes equivalence check

---

### v0.0.49 — `app/styles.css` split phase A

**Pieces:**

1. **Extract per-feature stylesheets:** `app/styles/{base,sidebar,timeline,modal,admin,workflow}.css`

2. **`app/styles.css` becomes an `@import` chain.**

3. **Lazy-load admin CSS** — non-admin users skip ~3,000 lines.

**Tests:** none new (purely CSS).

**Gates:** all four green; visual regression tests via Playwright if added.

**Exit criteria:**
- `app/styles.css` <500 lines (just imports + base)
- Per-feature files <2,000 lines each
- Admin CSS loaded only when admin route mounts

---

### v0.0.50 — E2E expansion + workspace switcher rail + DM read indicators

**Pieces:**

1. **6 new E2E specs** — thread reply, file upload, slash command execution, RBAC denial, DM creation, search.

2. **Conditional permanent workspace rail** — when `teams.length > 1`, render persistent left rail with workspace logos.

3. **DM read indicators** — iMessage-style ticks on the last message in each DM.

**Tests:** 6 new E2E specs in `e2e/`.

**Gates:** all four green; E2E job green in CI.

**Exit criteria:**
- 11 E2E specs total (was 5)
- Workspace rail visible when user has 2+ workspaces
- DM messages show read state to sender

---

### v0.0.51 — Typing + presence on WS gateway

**Pieces:**

1. **Typing event subscription** via `connectWsCollab` — replaces 2s HTTP poll.

2. **Presence pattern subscription** (`presence:*`) — replaces dedicated SSE stream.

3. **Mid-session WS↔SSE downgrade** — after 8 reconnect failures, switch transport.

4. **Cleanup:** delete `app/api/typing/` polling endpoint; delete `app/api/collab/presence/stream/` SSE endpoint.

**Tests:** new `tests/wsTypingPresence.test.ts`.

**Gates:** all four green.

**Exit criteria:**
- Typing latency <100ms (was 2s)
- Presence updates instant (was SSE)
- All 8 `PubSubEvent` variants flow through gateway

---

## Sprint C — Beyond-Slack (Month 2–3+)

### v0.0.52+ — Beyond-Slack feature wave

**Pieces (one per release):**

- **Real AI thread summarizer** — `AISummaryPanel.tsx` is currently a stub. Implement against an LLM with the same `lib/log.ts` + `tracedRoute` discipline as the rest.
- **Workflow Builder runtime** — queued executor + retries + DLQ. Connects the existing UI (shipped) to actual step execution.
- **Beyond-Slack: AI-assisted message search** — semantic search via embeddings, falls back to FTS.

### v0.0.55+ — Native mobile

- **Capacitor wrapper** — iOS + Android shells around the existing PWA.
- **APNs/FCM proxy** — `/api/notifications/push` becomes the authoritative push endpoint; native shells subscribe via the proxy.

### v0.0.60+ — Accessibility certification

- **WCAG 2.1 AA full audit** with axe-core integrated into Playwright E2E.
- **Color contrast across 12 themes** verified automatically per release.

### v0.1.0 — Public beta

- Feature parity with Slack on the surfaces that matter for mid-market enterprise.
- Beyond-Slack wins on AI summarizer, workflow runtime, mobile.
- WCAG 2.1 AA certified.

---

## Risk register

| Risk | Mitigation |
|---|---|
| Wave 2 primitive adoption breaks visual regression in admin panels | Take screenshots of each panel before migration; visual-diff in CI |
| `useTimelineConnection` extraction misses an edge case (e.g., the optimistic post + onIncoming dedupe path) | Brainstorming gate writes the full hook contract before any code |
| Migrations split corrupts existing dev data | Migration runner refuses to run unless `aaelink.migrations` table exists or DB is empty; explicit operator opt-in |
| Typing/presence WS migration breaks dev (no `WS_GATEWAY_URL` set) | Keep SSE fallback in `connectCollab` as the polling-mode path |
| ESLint 10 ecosystem catches up and we should switch to `eslint-config-next` | Re-evaluate at every release; switch when `eslint-plugin-react@8` drops |

---

## Forward dependencies (what unlocks what)

```
v0.0.44 (Wave 1 primitives) ──┐
                              │
                              ├──▶ v0.0.45 (sweep top-3) ──▶ v0.0.46 (home split)
                              │                              │
                              │                              ▼
                              │                       v0.0.47 (Docker + a11y)
                              │
                              └──▶ v0.0.51 (typing/presence WS) ◀── v0.0.46
                                          │
                                          ▼
                                  v0.0.52+ (beyond-Slack)

v0.0.43 (foundation: lint, coverage, logger) ──▶ everything above
```

---

## Communication shape

Each release ships:

1. PR with one-paragraph description + link to its release notes
2. `docs/release-notes/vX.Y.Z-alpha.md` — what changed, files of note, what's queued
3. README updates: version pointer + changelog row + roadmap roll-forward
4. All four gates green in CI

The audit doc (`docs/audit-2026-05-19.md`) is the **stable** reference — every release updates the audit's "Phase 4 fix log" section to reflect what shipped.

---

## What I will execute next

Per the agreed Option C path (continue execution): **v0.0.45 starts now** — Wave 2 sweep (top-3 panels), motion polish round 1, search filters, composer polish, lib codemod.

If the user prefers to stop and review v0.0.43 + v0.0.44 first, that's fine — the audit doc + this roadmap are now stable references.
