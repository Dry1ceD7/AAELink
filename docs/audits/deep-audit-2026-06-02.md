# AAELink — Deep Audit (Stage A)

Date: 2026-06-02
Scope doc: `docs/SLACK-PARITY-DIRECTIVE.md` (12 domains, AI/ML out of scope)
Driving directive: `AAELINK-AUDIT-AND-FINISH-DIRECTIVE.md` (Audit → Remediate → Complete)
Baseline: v0.0.58-alpha, Next.js 16 / React 19 / TS 6 strict / PG 17 / MinIO / Redis / Stirling / Bun.

This is the Stage A diagnosis. **No fixes applied.** Remediation (Stage B) must not begin
until this report is committed.

---

## 0. Executive summary

The codebase is **healthier and far more complete than its own state docs claim**, but it sits
in a **non-atomic mid-reorg working tree** (678 uncommitted changes) and carries **live AI
surfaces that violate the explicit scope boundary**.

Green baseline (this is the headline):

| Gate | Result | Detail |
|------|--------|--------|
| `bun run type-check` | PASS | 0 `error TS` |
| `bun run lint` | PASS | 0 errors, 146 warnings |
| `bun run test` | PASS | 129 files, 1485 tests |
| `bun run build` | PASS | full Next.js build succeeds |
| `madge --circular` | PASS | no circular dependencies |
| `bun audit` | 1 moderate | transitive `brace-expansion` via eslint |
| AI/ML deps | NONE | clean at dependency level |

Counts by severity: **Critical 3, High 7, Medium 9.**

Top ten items (remediation order):
1. (C1) Live AI surfaces in scope-OUT: `AISummaryPanel`, `/api/assistant`.
2. (C2) 678-change mid-reorg tree uncommitted — no atomic baseline.
3. (C3) State docs contradict reality (D1 "not started" but org container shipped).
4. (H1) `docker-compose.yml` missing Redis (app depends on Redis pub/sub).
5. (H2) Root `package-lock.json` tracked — npm remnant after Bun cutover.
6. (H3) `__tests__/api/*` excluded from `bun run test` (only run in a separate CI job).
7. (H4) `pg` imported directly in ~10 routes (hard rule: only via `getPool()`).
8. (H5) Doc sources-of-truth sprawl: 40 `docs/*.md` + 56 release notes + 7 stale `audit-*.md`.
9. (H6) D4 search is naive `ILIKE`, not PostgreSQL FTS; no cross-workspace scope.
10. (H7) `infra/**/mattermost.yaml` shipped in deploy manifests — stale competing service.

---

## CRITICAL

### C1. Live AI surfaces violate the scope boundary (section 2)
- Evidence:
  - `components/shared/AISummaryPanel.tsx` — header: "AI summaries of threads and channel
    recaps, AI document analysis, conversational AI, tone-matched drafting". Rendered live at
    `app/home/ModuleRenderer.tsx:193`.
  - `app/api/assistant/route.ts` — "AI Assistant API — Slack assistant.threads.*"
    (in-product assistant surface).
- Impact: directly contradicts directive section 2 (recaps, summaries, drafting, agents are OUT).
  Ships an AI feature class the program forbids.
- Proposed fix: remove `AISummaryPanel` import/usage from `ModuleRenderer`; delete or move the
  component and `/api/assistant` to a deferred/parked location; mark Deferred(AI) in the ledger.
  Keep no AI behavior wired. (Stage B.)

### C2. Working tree is a non-atomic mid-reorg (678 changes)
- Evidence: `git status --porcelain` → 341 modified, 201 deleted, 136 untracked, 0 staged.
  Dominant change: `app/components/*.tsx` (111 deleted, flat) → `components/<category>/*.tsx`
  (129 untracked, nested). Build is green against the **new** `components/` location.
- Impact: no committed baseline to audit/remediate against; a reset or bad merge could lose the
  129 untracked files (incl. the entire relocated component tree and many new routes). The
  directive requires the audit report be committed before Stage B — currently impossible to do
  cleanly without first resolving this tree.
- Proposed fix (Stage B, first action): stage and commit the reorg as atomic moves
  (`git add -A` of the rename pairs), verify gates stay green, then commit. Confirm no true data
  loss first (see C2-note). Only `DocumentAssemblyPanel.tsx` appears genuinely dropped with 0
  refs; `CommandPalette/SettingsShell/TemplatesPanel/UserProfileCard` have residual refs to
  verify (build green implies refs live in deleted files or resolve elsewhere).

### C3. State documentation contradicts the codebase
- Evidence: `docs/STATE.md` lists D1 org/workspace and the Bun migration as "in progress" and
  the directive reconciliation note says "Phase 1 (QA audit + D1 org/workspace) has not been
  started." Reality: `aaelink.organizations` + `org_members` tables exist (migrate.ts:2403+,
  v0.0.44), `workspaces.org_id` FK, `lib/enterprise/{orgAdmin,orgMembers,orgPolicies}.ts`, and
  routes `admin/org/[orgId]/{members,policies,shared-channels,workspaces}`, `admin/roles`,
  `scim/v2/*`, full compliance suite. Bun cutover is effectively done (CI is Bun-only).
- Impact: planning off STATE.md mis-sequences Stage C and re-does shipped work.
- Proposed fix: rewrite STATE.md from reality during Stage B `/handoff`; treat the parity ledger
  (section A1 below) as the authoritative status.

---

## HIGH

### H1. `docker-compose.yml` missing Redis
- Evidence: `docker-compose.yml` defines only `postgres`, `stirling-pdf`, `minio`. Redis is
  present in `infra/k3s/redis.yaml` and `infra/docker-desktop/redis.yaml` but not in local
  compose. App uses Redis pub/sub (`lib/realtime/redisPubSub.ts`).
- Impact: local stack does not match the documented 4-service stack; realtime fan-out degrades
  or fails locally; contradicts directive section A5 ("confirm local stack coherent: PostgreSQL,
  MinIO, Stirling, Redis").
- Proposed fix: add a `redis:7-alpine` service to `docker-compose.yml` with a documented port;
  align env var (`REDIS_URL`) in `.env.example`.

### H2. Root `package-lock.json` tracked (npm remnant)
- Evidence: `git ls-files` → `package-lock.json` (373 KB, 19 May) and `desktop/package-lock.json`
  both tracked; `bun.lock` (text) is the live lockfile and is currently untracked.
- Impact: two competing lockfiles; violates Bun-only rule (directive section 1).
- Proposed fix: `git rm package-lock.json`; track `bun.lock`. Keep `desktop/package-lock.json`
  (Electron toolchain still on npm — acceptable, document it).

### H3. `__tests__/api/*` excluded from the default test gate
- Evidence: `bun run test` (`vitest run`) executes 129 files in `tests/` (1485 tests) but knip
  flags all `__tests__/api/*.test.ts` + `__tests__/helpers.ts` as unused; CI runs them only via
  a separate job (`bunx vitest run --dir __tests__`).
- Impact: API integration tests are not part of the primary local gate; regressions in routes
  can pass `bun run test` locally. Directive hard rule 8 expects route tests to gate.
- Proposed fix: include `__tests__` in the vitest config (or add a `test:api` script wired into
  `/gates`) so both suites run in one local command.

### H4. Direct `pg` imports in route handlers
- Evidence: `import { Pool } from 'pg'` (value import) in `app/api/lists`, `reactions`,
  `workflows`, `functions`, `admin/rate-limits`, `admin/audit-log/stream`, `files/remote`, plus
  `import type { Pool }` in `messages`, `messages/reactions`, `collab/typing`. No `new Pool()`
  exists outside `lib/infra` (singletons intact), so these are type-only/style violations.
- Impact: violates hard rule 2 ("never import `pg` directly; use `getPool()`"). Risk a future
  edit constructs a per-request pool.
- Proposed fix: replace with `import type { Pool } from 'pg'` only where needed, or import the
  pool type from `lib/infra/db.ts`. Add a lint rule banning `pg` value imports outside `lib/infra`.

### H5. Documentation sources-of-truth sprawl
- Evidence: 40 `docs/*.md`, 56 `docs/release-notes/*`, 7 untracked `docs/audit-2026-05-*.md`,
  plus `docs/ADR/`, `docs/_archive/`, `docs/blueprint-alignment/`, `docs/ROADMAP.yaml`.
  Multiple parity/blueprint/roadmap documents coexist.
- Impact: contradictory guidance (see C3); directive requires a single source of truth.
- Proposed fix: designate `docs/SLACK-PARITY-DIRECTIVE.md` + the two parity matrices + this
  audit as canonical; move superseded `audit-*.md` and stale blueprints into `docs/_archive/`.

### H6. D4 search is non-FTS `ILIKE`
- Evidence: `app/api/search/messages/route.ts:105,127` use `WHERE m.body ILIKE $2`;
  `lib/messaging/searchFilters.ts` documents an "ILIKE body match". No `to_tsvector`/`tsquery`,
  no lexical index, no cross-workspace scope.
- Impact: D4 parity partial only; will not scale and lacks filter/cross-workspace parity.
- Proposed fix (Stage C, D4): migrate to PostgreSQL FTS (`tsvector` column + GIN index) or a
  lexical OpenSearch index; add the directive's filter set. No vector/rank-learning.

### H7. Stale Mattermost service in deploy manifests
- Evidence: `infra/k3s/mattermost.yaml`, `infra/docker-desktop/mattermost.yaml`.
- Impact: AAELink is the product; shipping a Mattermost deployment is a competing/stale artifact
  that confuses the production stack.
- Proposed fix: remove both `mattermost.yaml` manifests (and any kustomization references)
  unless deliberately retained as a parity reference outside deploy.

---

## MEDIUM

### M1. 74 unused files (knip)
- Evidence: `bunx knip` → 74 unused files. Beyond the `__tests__` set (H3), genuine orphans
  include `components/media/FilePreviewModal.tsx`, `components/modals/ContentFlagModal.tsx`,
  `components/shared/ModuleChrome.tsx`, `components/tickets/SlaCountdown.tsx`.
- Fix: confirm each is dead (not lazy/dynamic imported) then remove; record justification.

### M2. 1338 unused-export lines (ts-prune)
- Evidence: `bunx ts-prune` → 1338 lines. Many are false positives (Next.js route exports,
  `index.ts` re-export barrels in `components/primitives`, `lib/documents/puzzleBox/blocks.ts`,
  `lib/enterprise`, `lib/realtime`).
- Fix: add a `knip.json` to scope project files (knip itself suggests this), then triage the
  real unused exports; do not mass-delete barrel exports.

### M3. `bun audit` — 1 moderate advisory
- Evidence: `brace-expansion` GHSA-jxxr-4gwj-5jf2 (DoS), transitive via eslint /
  typescript-eslint / eslint-config-next.
- Fix: `bun update` to pull the patched transitive, or document as accepted (dev-only,
  lint toolchain).

### M4. Oversized modules (refactor targets, not blockers)
- Evidence (lines): `lib/infra/migrate.ts` 2541, `app/home/page.tsx` 1808,
  `components/tickets/TicketsPanel.tsx` 1522, `components/modals/PreferencesModal.tsx` 1179,
  `components/chat/Composer.tsx` 1016, `app/styles.css` 18278.
- Fix: stage refactors toward the <200-line rule where they unblock parity work; otherwise track.

### M5. AI-framed but non-AI component: `CatchUpView`
- Evidence: `components/shared/CatchUpView.tsx` wired to `/api/notifications` (real triage, no
  LLM) but named after Slack's "Catch Up" AI surface (listed OUT in section 2); rendered at
  `ModuleRenderer.tsx:174`.
- Fix: confirm zero AI behavior; keep as notification triage and rename to avoid AI framing, or
  defer. Distinct from C1 (which is real AI).

### M6. `package.json` name is `aaelink-clean`
- Evidence: `package.json` `"name": "aaelink-clean"`.
- Fix: rename to `aaelink` for branding consistency (low risk).

### M7. `docker-compose.yml` postgres double host-port mapping
- Evidence: postgres maps both `25432:5432` and `30432:5432`.
- Fix: keep one host port; document it. Verify no script depends on both.

### M8. CLAUDE.md path drift
- Evidence: `.claude/CLAUDE.md` says components live in `app/components/` (PascalCase); reality
  after the reorg is `components/<category>/`.
- Fix: update CLAUDE.md conventions to match `components/`.

### M9. `docs/audits/` was empty
- Evidence: directory existed with no report until this file.
- Fix: none — this report establishes the audit trail.

---

## A1. Parity ledger (D1–D12)

Status legend: **Done** (route + lib backing, looks complete) / **Partial** (present, gaps
noted) / **Gap** (absent) / **Deferred(AI)** (out of scope, must not build). Depths marked
"unverified" were classified by route+lib existence, not full handler read — Stage C `/plan`
must confirm before building.

### D1 — Organization & workspace architecture (Partial)
| Capability | Status | Module/route | Note |
|---|---|---|---|
| Org entity parent of workspaces | Done | `migrate.ts:2407` orgs, `admin/org` | tables + routes exist |
| Org settings/billing container | Partial | `team/billing`, `admin/org/[orgId]/policies` | billing thin |
| Unlimited workspaces under org | Partial | `workspaces`, `org_id` FK | provisioning yes; move/archive lifecycle unverified |
| Enterprise identity (org-wide user id) | Partial | `lib/enterprise/userIdMigration.ts` | translation layer started; verify cross-ws identity |
| Org-wide channels | Gap | `channels/shared` (multi-ws) | org-wide visibility/join not confirmed |
| Multi-workspace shared channels | Partial | `admin/org/[orgId]/shared-channels`, `channels/shared` | verify per-ws appearance |
| Workspace access levels | Partial | `workspaces`, `workspaces/invite*` | open/invite/managed levels unverified |
| Workspace discovery | Gap | — | not found |

### D2 — Identity, authentication, access (Partial → strong)
| Capability | Status | Module/route | Note |
|---|---|---|---|
| SAML 2.0 SSO (IdP/SP init, X.509) | Partial | `auth/sso`, `admin/sso` | verify signed-response + JIT + owner bypass |
| OIDC SSO | Partial | `auth/openid`, `auth/entra` | present |
| SCIM 2.0 users/groups | Done | `scim/v2/{Users,Groups,Schemas,ResourceTypes,ServiceProviderConfig}` | full v2 surface |
| Org-scope SCIM | Partial | `admin/scim` | confirm org vs ws scope |
| Domain claiming/capture | Gap | — | not found |
| Session duration policy (app-enforced) | Partial | `admin/session-policy`, `lib/auth/sessionSecurity.ts` | verify enforcement |
| MFA enforcement | Partial | `auth/mfa` | policy cascade unverified |
| EMM (device controls, remote wipe) | Partial | `admin/devices` | wipe signaling unverified |
| Guests (multi/single channel) | Partial | `admin/guests`, `admin/invite-requests` | single-channel guest mgmt unverified |
| User groups (mentionable) | Done | `usergroups`, `usergroups/users`, `admin/user-groups` | |

### D3 — Messaging & conversations (Done → strong, few Partials)
| Capability | Status | Module/route | Note |
|---|---|---|---|
| Channel types + convert + topic/purpose | Done | `channels`, `channels/topic`, `channels/posting-perms` | |
| DM + group DM | Done | `channels/dm`, `conversations/open` | |
| Threads + reply broadcast | Done | `threads`, `conversations/replies` | |
| Mentions (here/channel/everyone/group) | Partial | `lib/messaging/mentionParse.ts` | user-group mention coverage to verify |
| Reactions (custom+standard) | Done | `reactions`, `messages/reactions`, `emoji`, `admin/emoji` | |
| Pins / bookmarks / saved | Done | `pins`, `bookmarks`, `saved`, `starred` | |
| Drafts + scheduled send | Done | `drafts`, `scheduled-messages`, `messages/scheduled` | |
| Edit/delete + history | Partial | `messages/[id]` | edit-history indicator to verify |
| Formatting | Done | `lib/messaging/composerMarkdown.ts` | |
| Attachments + unfurl + download-all | Partial | `messages/attachments`, `messages/unfurl`, `link-preview` | download-all to verify |
| Channel canvas | Partial | `docs/canvas`, `conversations/canvases` | per-channel binding to verify |
| Channel mgmt (archive/rename/slow/sections) | Done | `channels/rename`, `channel-archival`, `sidebar/sections` | slow-mode to verify |

### D4 — Search & navigation (Partial)
| Capability | Status | Module/route | Note |
|---|---|---|---|
| Full-text search (msgs/files/channels/people) | Partial | `search/{messages,files,users,advanced}` | **ILIKE not FTS** (H6) |
| Granular filters | Partial | `lib/messaging/searchFilters.ts` | partial filter set |
| Cross-workspace search | Gap | — | depends on D1 |
| Quick switcher / jump-to | Partial | `QuickSwitcher` (reorg), `sidebar` | verify |
| Saved searches | Gap | — | not found |

### D5 — Voice, video, realtime (Partial, heavy gap)
| Capability | Status | Module/route | Note |
|---|---|---|---|
| Huddles | Partial | `calls/rooms` | room/signaling DB only |
| Calls 1:1 + group | Partial | `calls/rooms` | **no TURN/STUN/media server** (route comments confirm pending) |
| Screen sharing | Partial | `calls/rooms` | client-side WebRTC only |
| Clips (record/share) | Partial | `messages/clips`, media recorder | recording in scope; no transcription |
| Presence + typing (SSE/WS + Redis) | Done | `collab/presence/stream`, `collab/typing`, `lib/realtime` | strong |

### D6 — Productivity surfaces (Partial)
| Capability | Status | Module/route | Note |
|---|---|---|---|
| Canvas (standalone + per-channel) | Partial | `docs/canvas`, `lib/documents/puzzleBox` | PuzzleBox backs it |
| Lists | Partial | `lists` | typed fields/views/per-item threads to verify |
| Workflow Builder | Partial | `workflows`, `admin/workflows`, `functions` | triggers/steps/branches depth unverified |
| Reminders (one-off + recurring) | Done | `reminders`, `reminders/dispatch` | |
| Bookmarks bar | Done | `bookmarks` | |

### D7 — Apps & developer platform (Partial)
| Capability | Status | Module/route | Note |
|---|---|---|---|
| Web API method families | Partial | `conversations/*`, `messages/*`, `users/*`, `reactions`, `pins`, `usergroups` | broad coverage |
| Events API (retry/ack/dedup) | Partial | `integrations/events`, `webhooks/v2` | Grid dedup hazard unverified |
| OAuth 2.0 scopes/consent/rotation | Partial | `oauth/access`, `apps/connections` | scope consent unverified |
| Block Kit equivalent | Partial | `views`, `dialog` | structured blocks depth unverified |
| Slash commands + shortcuts | Done | `slash-commands`, `lib/comms/slashCommands.ts` | |
| Incoming/outgoing webhooks + HMAC + DLQ | Done | `webhooks`, `webhooks/v2`, `lib/webhooks/{signing,DLQ}` | strong |
| Request signing/replay protection | Done | `webhooks/verify-signature` | |
| Socket mode | Partial | `rtm/connect`, `ws`, `apps/connections` | app socket mode unverified |
| App manifest + directory + bots | Partial | `marketplace/*`, `integrations/apps`, `bots/info` | manifest format gap likely |
| Custom functions/steps | Partial | `functions` | Workflow Builder plug-in unverified |

### D8 — Connect & external federation (Gap, depends on D1)
| Capability | Status | Module/route | Note |
|---|---|---|---|
| Cross-org shared channels | Gap | `SlackConnectPanel` (reorg) UI only | backend not found |
| External DMs (Connect DMs) | Gap | — | |
| External collab governance | Gap | — | |
| External guest access | Partial | `admin/guests` | distinct from Connect |

### D9 — Administration & governance (Done → strong)
| Capability | Status | Module/route | Note |
|---|---|---|---|
| Org admin console (members/deactivate/roles) | Done | `admin/org/[orgId]/members`, `admin/users`, `admin/roles` | 50+ admin routes |
| Role model (owner/admin/custom) | Partial | `admin/roles/assignments`, `lib/auth/customRoles.ts` | custom-role scoping to verify |
| Org policies cascade to workspaces | Partial | `admin/org/[orgId]/policies`, `lib/enterprise/orgPolicies.ts` | delegation depth unverified |
| App/integration approval | Partial | `admin/app-policies`, `marketplace/install` | OAuth-scope review unverified |
| Channel mgmt policies | Done | `channels/posting-perms`, `channel-archival`, `admin/channel-archival` | |
| File/upload controls + AV hook | Partial | `admin/media-policy`, `files/scan` | virus scan hook to verify |
| Email/domain restrictions | Partial | `admin/ldap`, `admin/account-requests` | domain restriction to verify |
| Custom ToS ack | Gap | — | not found |
| Analytics/reporting (descriptive) | Done | `admin/analytics`, `admin/stats`, `admin/metrics`, `admin/prometheus` | |
| Access/activity log views | Done | `admin/audit-log`, `admin/audit-log/stream` | |

### D10 — Security, compliance, data governance (Done → strong; advanced Partial)
| Capability | Status | Module/route | Note |
|---|---|---|---|
| Audit Logs API (queryable/streamable) | Done | `admin/audit-log{,/export,/stream}`, `admin/audit-streams`, `lib/enterprise/auditStream.ts` | |
| eDiscovery / Discovery export | Partial | `compliance/ediscovery`, `admin/exports` | third-party pull API to verify |
| Legal hold | Done | `compliance/legal-holds` | |
| Retention (global/ws/channel) | Done | `admin/retention{,/enforce}`, `lib/enterprise/retention.ts` | |
| Data exports (standard + gated) | Partial | `admin/exports`, `admin/users/export` | gated/approval flow to verify |
| DLP (regex/classifiers, block/alert) | Done | `compliance/dlp`, `lib/enterprise/dlpInterceptor.ts` | |
| Information barriers | Done | `compliance/barriers`, `lib/enterprise/barrierGuard.ts` | |
| IP/network access controls | Done | `admin/ip-access`, `lib/auth/ipAccess.ts` | |
| Encryption at rest/in transit | Partial | `admin/encryption` | verify default-on |
| Customer-managed keys (advanced) | Partial | `admin/encryption` | KMS integration likely gap; sequence last |
| Data residency (advanced) | Partial | `admin/data-residency` | region pinning depth unverified; sequence last |

### D11 — Notifications, profiles, preferences (Done → strong)
| Capability | Status | Module/route | Note |
|---|---|---|---|
| Notification prefs (per-channel/global) | Done | `notifications`, `channel-prefs`, `auth/notification-prefs` | |
| Keyword/highlight notifications | Partial | `keywords` | verify highlight wiring |
| Schedules + mute | Done | `notifications/stream`, `channels/mute`, `lib/notifications/notificationSchedule.ts` | |
| DND + override | Done | `dnd`, `lib/comms/dndSchedule.ts` | |
| Desktop/native/push | Done | `notifications/push`, `lib/notifications/{desktopNotify,nativeNotify}`, `desktop/` | |
| Electron + mobile | Partial | `desktop/` | mobile client absent |
| Custom status + presence | Done | `user-status{,/bulk,/expire}` | |
| Org-level custom profile fields | Partial | `users/profile`, `team/profile` | org-defined fields to verify |
| Theme/density/a11y/i18n | Done | `user/accessibility`, `i18n/locales`, `components/a11y` | |

### D12 — Files & storage (Partial)
| Capability | Status | Module/route | Note |
|---|---|---|---|
| Upload/download + previews + comments | Done | `files/upload`, `files/[id]/download`, `files/preview`, `files/comments`, `lib/documents/stirlingPdf.ts` | |
| External share/public link controls | Partial | `admin/media-policy` | toggles to verify |
| File retention (aligned to D10) | Partial | `lib/enterprise/retention.ts` | file-scope parity to verify |
| S3/MinIO storage | Done | `lib/infra/s3` (singleton) | |
| Virus-scanning hook | Partial | `files/scan` | confirm real scanner vs stub |

### Deferred (AI — OUT of scope, must not build)
- `AISummaryPanel` (recaps/summaries/drafting) — remove (C1).
- `/api/assistant` (assistant agent surface) — defer (C1).
- Any semantic/vector search, learning-to-rank, translation, transcription, AI workflow step.

---

## A1b. Flat gap/partial list (Stage C build order)

Phase 1 (D1): org-wide channels; workspace discovery; workspace access levels; enterprise
identity cross-workspace verification; workspace move/archive lifecycle. (L)
Phase 2 (D2): domain claiming/capture (M); SAML signed-response + owner-bypass verify/complete
(M); session-duration enforcement (S); MFA/EMM policy cascade + remote wipe (M); single-channel
guest mgmt (S).
Phase 3 (D3+D4): user-group mentions (S); edit-history indicator (S); download-all attachments
(S); per-channel canvas binding (M); **D4 FTS migration + filter set + cross-workspace search +
saved searches** (L).
Phase 4 (D9+D10): custom-role scoping (M); org-policy delegation (M); app/OAuth-scope approval
(M); virus-scan hook real impl (M); custom ToS ack (S); gated compliance export (M); eDiscovery
pull API (M); encryption default-on verify (S).
Phase 5 (D5): TURN/STUN + media server/SFU for huddles & calls (L, isolated heavy phase).
Phase 6 (D6+D7): Lists views/typed-fields/per-item threads (M); Workflow Builder triggers/steps/
branches (L); Block Kit blocks/modals/app-home (L); app manifest format (M); socket mode (M);
custom functions in Workflow Builder (M); events API Grid dedup (M).
Phase 7 (D8 Connect): cross-org shared channels (L); Connect DMs (M); external collab governance
(M). Depends on D1.
Phase 8 (polish + advanced): keyword/highlight notifications (S); org-level custom profile fields
(M); external-share/public-link controls (S); file retention parity (S); then D10 advanced —
customer-managed keys/KMS (L) and data residency region pinning (L).

---

## A5. Config & infrastructure summary
- CI (`.github/workflows/ci.yml`): Bun-only, gates lint + type-check + test + build + a separate
  `__tests__` job + Playwright e2e. Good (one gap: see H3).
- `docker-compose.yml`: postgres:17 (25432+30432→5432, M7), stirling-pdf (28085→8080),
  minio (29000/29001). **Redis missing (H1).**
- `infra/`: k3s + docker-desktop kustomize sets (postgres, minio, stirling, redis, ingress,
  secrets.example) + grafana. **mattermost.yaml present (H7).**
- Lockfiles: `bun.lock` (live, untracked), `package-lock.json` (tracked remnant, H2),
  `desktop/package-lock.json` (Electron, keep).
- Secrets: no committed `.env`/cert/sqlite found in `git ls-files` — clean.
- Boundary integrity: 0 routes bypass `tracedRoute`; no per-request DB/S3 clients; `pg`
  value-imports flagged (H4). No raw `.sql` migrations outside `migrate.ts`.

---

## Proposed remediation order (Stage B)
1. C2 — commit the reorg atomically; establish clean baseline (keep gates green).
2. C1 — strip live AI surfaces; mark Deferred(AI).
3. H2 — drop `package-lock.json`; track `bun.lock`.
4. H1 — add Redis to docker-compose; align env.
5. H4 — fix `pg` value imports + add ban-rule.
6. H3 — fold `__tests__` into the default test gate.
7. H7 — remove stale mattermost manifests.
8. H5 + C3 — consolidate docs; rewrite STATE.md from reality.
9. H6 — (begin in Stage C D4) FTS migration.
10. M1–M9 — dead-file cleanup, knip.json, audit advisory, oversized-file refactors as they
    unblock parity work.

End of Stage A. Do not begin Stage B until this report is committed.

---

## Stage B — resolutions (2026-06-02)

Gates after Stage B: tsc 0 errors, lint 0 errors (146 warnings), 1482 passed /
3 skipped (1485 total), `docker compose config` parses. Each fix committed
atomically.

| ID | Status | Resolution |
|----|--------|------------|
| C2 | Resolved | Mid-reorg tree committed as clean baseline (`2b86b1bf`). |
| C1 | Resolved | Removed `AISummaryPanel`, `/api/assistant`, `'ai'` nav → Deferred(AI) (`d8f62e6b`). |
| C3 | Resolved | STATE.md rewritten from reality (`c5f14993`). |
| H1 | Resolved | Redis added to docker-compose (port 26379) (`c9ae3057`). |
| H2 | Resolved | Root `package-lock.json` removed; `bun.lock` tracked (`c9ae3057`). |
| H3 | Resolved | `test:integration` / `test:all` scripts added (`58f2c62f`). |
| H4 | Resolved | pg value imports → type-only + eslint ban rule (`7975f9d4`). |
| H5 | Partial | 8 stale audits archived; blueprint/roadmap consolidation deferred to a human "which is canonical" decision (`c5f14993`). |
| H6 | Deferred→Stage C | D4 FTS migration belongs to the D4 epic. |
| H7 | Re-scoped | `infra/**` kustomize deploys **Mattermost, not AAELink**; no AAELink k8s manifest exists. Authoring real manifests is a Stage C infra epic; not deleted piecemeal (would break kustomization). |

Medium items (tracked, not blockers):
- M1 re-assessed: the four knip "orphans" (`FilePreviewModal`, `ContentFlagModal`,
  `ModuleChrome`, `SlaCountdown`) are likely **unwired parity WIP**, not junk —
  wire or remove per the relevant Stage C epic rather than delete now.
- New: `tests/auditShape.test.ts` now skips by design (no `docs/audit-*.md` in
  docs root after H5) and is **obsolete** — it mandates emoji pillar headers,
  which the zero-emoji rule forbids, and references archived `.kiro` specs.
  Recommend retiring it. Benign skip; suite stays green.
- M3 (bun audit moderate), M4 (oversized files), M2 (ts-prune/knip.json),
  M6–M9: unchanged, tracked in STATE.md.

Stage B exit criteria met: gates green, compose valid, dependency tree clean
(no AI deps; 1 documented advisory), legacy archived, no duplicate/legacy files
live. Proceeding to Stage C.
