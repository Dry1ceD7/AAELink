# AAELink — Slack Enterprise Parity Development Directive

A standing instruction for the AI agent working on the existing AAELink
codebase. The objective is structural and feature parity with Slack Enterprise
Grid, implemented systematically into the current project. This is a continuation
directive, not a greenfield build.

Non-personal voice. No emojis. Read fully before acting.

---

## 0. Prime directive

Continue on the existing AAELink repository (v0.0.58-alpha: Next.js 16 App
Router, React 19, TypeScript 6 strict, PostgreSQL 17, MinIO, Redis 7, Stirling
PDF, SSE plus WebSocket gateway, Electron, Bun). Do not re-scaffold, do not
rewrite working subsystems, and do not start from a blank project. Extend what
exists.

Target: match the native infrastructure and feature set of Slack Enterprise Grid
for everything in scope below, to a fully working, production-ready state.

The existing parity documents are the living source of truth and must be kept
current, not duplicated:
- docs/parity-reference-matrix.md (14 categories)
- docs/parity-slack-mattermost-aaelink-full-map.md (three-way capability map)

Before building anything, reconcile this directive against those two documents
and the production checklist (docs/deployment/production-checklist.md).

---

## 1. Operating rules (non-negotiable)

- Use the .claude agent system. Plan and chain through the orchestrator; route
  server work to backend, infrastructure and migrations to platform, UI to
  frontend; gate every change through reviewer and test-runner.
- Every API route passes through tracedRoute(). No bypass.
- Migrations are forward-only, appended to lib/infra/migrate.ts. Never alter an
  applied migration.
- PostgreSQL, Redis, and S3 clients are module-level singletons in lib/infra.
- Zero emojis anywhere. New and edited files under 200 lines, one concern each.
  Known oversized files are refactor targets, listed in section 5.
- Bun only: bun install, bun add, bun run. Update bun.lockb, never reintroduce
  npm or yarn.
- Secrets live in .env only. Local exclusions via .git/info/exclude.
- Work in vertical slices: one feature epic at a time, each closed by /gates.
  No big-bang merges. Keep the build green at every step.
- Legal hygiene: build equivalent functionality only. Do not copy Slack source
  code, trademarks, brand assets, copy, or visual design. Use the AAELink
  design system (app/styles.css, Eldora UI) and AAE naming and branding
  throughout. Implement against open standards (SAML, SCIM, OAuth, WebRTC, SCIM,
  the documented webhook and event patterns), not Slack's proprietary internals.

---

## 2. Scope boundary: AI and machine learning are OUT

All artificial intelligence and machine learning capabilities are reserved for a
future roadmap and must not be built, wired, or provisioned in this scope. Do
not install AI or ML dependencies, model runtimes, vector stores, or ranking
models for any of the following:

- Conversation intelligence: thread, channel, and meeting recaps; summaries;
  digests; "catch up" surfaces.
- Search intelligence: AI search answers, natural-language query, semantic or
  vector retrieval, and learning-to-rank result ordering.
- Writing assistance: drafting, rewriting, tone, autocomplete, smart replies.
- Translation: automatic message or content translation.
- Media intelligence: clip, huddle, audio, and video transcription; captions;
  audio or video summaries.
- Workflow intelligence: any "generate AI response" automation step or
  LLM-backed workflow step.
- Agents: in-product assistants, agent builders, bring-your-own-LLM tooling, or
  third-party model integrations.

Search nuance: lexical full-text search is IN scope (PostgreSQL full-text search,
or an OpenSearch or equivalent lexical index). Vector embeddings, semantic
ranking, and learning-to-rank are OUT. If a search index is introduced, configure
keyword and filter search only; do not enable vector or rank-learning features.

Where the architecture must leave room for future AI (for example, storing
content in a form that could later be indexed), design the seam but ship no AI
behavior now.

---

## 3. Feature parity breakdown (in scope)

Twelve domains. For each capability, confirm whether the existing codebase
already satisfies it (mark Done), partially satisfies it (Partial, note the gap),
or lacks it (Gap). Record the satisfying route or module. Build the Gaps and
complete the Partials.

### D1. Organization and workspace architecture (Enterprise Grid core)

This is the largest structural lift. Slack Grid is an organization container that
is the parent of unlimited workspaces, with a single enterprise identity per
person across all workspaces.

- Organization entity as the parent of many workspaces; org-level settings and
  billing container.
- Unlimited workspaces under one org; workspace provisioning and lifecycle
  (create, archive, move, default workspaces).
- Enterprise identity: one user identity across all workspaces in the org, with
  an org-level user identifier distinct from per-workspace (local) identifiers,
  and a translation layer so existing per-workspace data and integrations keep
  working.
- Org-wide channels: channels visible and joinable across the entire org.
- Multi-workspace shared channels: a single channel shared among a selected
  subset of workspaces, appearing in each.
- Workspace access levels (open, invite-only, managed) and cross-workspace
  membership.
- Workspace discovery within the org.
- Map to: lib/workspace, lib/channels. Current state is multi-workspace via a
  selector; the org container, enterprise identity, and cross-workspace channels
  are the parity gaps. Sequence this first; identity and compliance depend on it.

### D2. Identity, authentication, and access

- SAML 2.0 SSO: identity-provider-initiated and service-provider-initiated
  flows; signed SAML responses with X.509 certificate verification; HTTP POST
  binding; NameID and email attributes; just-in-time provisioning. Provide an
  owner bypass so an org owner can sign in by email and password if the IdP
  fails. Support required-SSO and optional-SSO modes.
- OIDC SSO as an alternative connection.
- SCIM provisioning (target SCIM 2.0; remain compatible with 1.1) for users and
  groups, at both workspace and org scope; create, update, deactivate, and full
  workspace or org deprovisioning; user-group provisioning.
- Domain claiming and domain-based account capture.
- Session duration controls enforced by the application (do not rely on IdP
  single logout or IdP session limits).
- Multi-factor authentication enforcement (org and workspace policy).
- Enterprise mobility management hooks: device controls, screen-lock
  requirement, and remote wipe signaling for the desktop and mobile clients.
- Guest accounts: multi-channel guests (provisionable via SCIM) and
  single-channel guests (managed in-app); guest invite request and approval.
- User groups (mentionable group handles) at org scope.
- Map to: lib/auth (session, CSRF, CSP, OTP exist), app/api/auth, scim/. SCIM v2
  and SSO are partially present; org-scope SCIM, domain claiming, session-
  duration policy, and EMM are likely gaps.

### D3. Messaging and conversations (core collaboration)

- Channel types: public, private; conversion between them; default channels;
  channel topic, description, and purpose.
- Direct messages and group direct messages (multi-person).
- Threads and thread replies; reply broadcast to the parent channel.
- Mentions: individual, here, channel, everyone, and user-group mentions.
- Reactions (custom and standard emoji); reaction counts and actors.
- Pins; bookmarks (per channel); saved or later items per user.
- Drafts, including across devices; scheduled send.
- Edit and delete; edit history indicators.
- Message formatting: bold, italic, strikethrough, underline, inline code, code
  blocks, block quotes, ordered and unordered lists, links.
- File attachments with previews; rich link unfurling; download-all-attachments.
- Channel canvas: a canvas surface attached to each channel (see D6).
- Channel management: archive, rename, posting permissions, slow mode or
  posting restrictions, channel sections in the sidebar, mark read and unread.
- Map to: lib/messaging, lib/channels; app/api/messages, chat, threads, pins,
  reactions. Composer, threads, pins, reactions, and drafts exist. Verify
  scheduled send, saved-for-later, channel canvas, user-group mentions, and
  unfurling coverage.

### D4. Search and navigation (lexical, non-AI)

- Full-text search across messages, files, channels, and people.
- Granular filters: in-channel, from-user, date before and after, has-link,
  has-file, is-pinned, and similar modifiers.
- Cross-workspace search across the org (depends on D1).
- Quick switcher and jump-to navigation; in-channel find.
- Saved searches.
- Map to: existing search plus app/api search routes. Cross-workspace scope and
  filter parity are the work. Infrastructure: PostgreSQL full-text search or a
  lexical OpenSearch index. No vector or learning-to-rank.

### D5. Voice, video, and realtime collaboration

- Huddles: lightweight audio, video, and multi-person screen sharing; in-huddle
  message thread; hand-raise; a huddle window with a docked toolbar; huddle
  notes or canvas.
- Calls: one-to-one and group.
- Screen sharing.
- Clips: asynchronous audio and video recording and sharing. Recording is in
  scope; transcription and captions are out (section 2).
- Presence and typing indicators; live delivery over the SSE and WebSocket
  gateway with Redis fan-out.
- Map to: lib/realtime, components/media (recorder exists). Huddles and calls
  require a WebRTC stack (signaling plus a media server or SFU); this is heavy
  and may be delivered in a dedicated phase. Preserve the topic-on-subscribe
  gateway contract.

### D6. Productivity surfaces

- Canvas: standalone canvases and per-channel canvases; rich text and headings;
  embedded files, clips, and links; templates; emoji reactions on canvas text;
  embedded workflows; granular sharing and permissions; mobile share. Exclude
  any AI canvas generation.
- Lists: structured records with typed fields; per-item threads; multiple views;
  embedding a list in a canvas. Exclude AI list recaps and AI search in lists.
- Workflow Builder: no-code automation with triggers (link, scheduled, emoji
  reaction, keyword including in private channels, webhook); steps including
  forms, send-message, and create-channel-with-canvas; conditional branches with
  nesting up to a defined depth; custom steps and functions exposed through the
  developer platform; connectors to third-party tools; a workflow gallery and a
  per-conversation workflows view. Exclude the AI response step.
- Reminders: one-off and recurring, via a slash command and UI.
- Bookmarks: per-channel bookmark bar.
- Map to: PuzzleBox documents partially anticipate canvas; Lists and Workflow
  Builder are largely greenfield. Org-wide installation is required for custom
  workflow functions; account for that in D1 and D7.

### D7. Apps and developer platform (extensibility parity)

- Web API: a complete set of method families covering conversations, messages,
  users, files, reactions, pins, channels, user groups, and admin operations.
- Events API: event subscriptions with retry and acknowledgement semantics, and
  deduplication. Note the Grid hazard: a message in a multi-workspace shared
  channel emits an event per sharing workspace; deduplicate on the timestamp
  plus channel key and design event receivers to be stateless and horizontally
  scalable.
- OAuth 2.0 with granular scopes; per-scope consent; token rotation.
- Block Kit equivalent: structured message blocks, interactive components,
  modals and views, and an app home tab.
- Slash commands; message shortcuts and actions.
- Incoming webhooks; outgoing and event-driven webhooks with HMAC signing and a
  dead-letter queue.
- Request signing and verification for inbound interactivity (signed-secret
  scheme with timestamp and replay protection).
- A persistent socket connection mode for apps (WebSocket-based), as an
  alternative to public request URLs.
- App manifest format; app directory or marketplace with admin approval and an
  allowlist; bot users; granular bot permissions.
- Custom functions and workflow steps that plug into Workflow Builder (D6).
- Map to: lib/webhooks (engine, signing, DLQ exist), app/api/webhooks and
  integrations, the marketplace component. Block Kit, app manifest, scopes, and
  socket mode are the larger gaps.

### D8. Connect and external federation

- Shared channels across separate organizations (cross-org Connect).
- External direct messages (Connect DMs).
- External collaboration governance: admin approval, allowlists of partner orgs
  and domains, and tighter retention and monitoring on externally shared
  channels.
- External guest access distinct from cross-org Connect.
- Map to: depends on D1. Treat as a dedicated phase after the org container and
  governance exist.

### D9. Administration and governance console

- Org admin console: member management, deactivation, and role assignment.
- Roles: org owner, org admin, workspace owner, workspace admin, custom admin
  roles, member, and guest; role definitions and scoping.
- Org-level policies that cascade to workspaces, with controlled delegation to
  workspace admins.
- App and integration management: approve, allowlist, and review OAuth scopes
  before enabling an app org-wide or per workspace.
- Channel management policies: naming standards, default channels, who can
  create, archive, rename, and post; announcement-only channels.
- File and upload controls: allowed types and sizes, external sharing toggles,
  public link controls, and a virus-scanning hook.
- Email and domain restrictions for membership and invitations.
- Custom terms of service acknowledgement.
- Analytics and reporting dashboards: member, usage, and channel analytics. These
  are descriptive metrics only and are in scope; no predictive or AI analytics.
- Access and activity log views in the console.
- Map to: app/admin (18 panels exist), lib/enterprise, lib/workspace. Org-level
  cascade, role management, and app approval are the main gaps.

### D10. Security, compliance, and data governance (enterprise grade)

- Audit Logs API: a queryable, streamable record of actions with actor, target,
  and context, plus anomaly events for risky app or user behavior; built for
  ingestion into security information and event tooling.
- eDiscovery and Discovery surface: an export API that lets approved third-party
  archiving and supervision tools pull message and file content for compliance.
- Legal hold: preserve specified users, channels, or the whole org from deletion
  during investigations, exempt from retention rules.
- Retention policies: global, per-workspace, and per-channel; retain
  indefinitely, retain for a fixed period, or delete after a period; separate
  controls for messages and files.
- Data exports: a standard export and a gated compliance or corporate export
  that requires explicit approval and covers all conversation types.
- Data loss prevention: a native rule engine using regular expressions and
  pattern classifiers (for example, payment-card and national-identifier
  patterns) across messages, files, and public channels, with block or alert
  actions; plus an integration path for third-party DLP via the Discovery
  surface.
- Information barriers: policy-based restriction of communication and discovery
  between defined groups of members.
- IP and network access controls; allowlisting.
- Encryption at rest and in transit by default.
- Advanced tier (large add-ons, sequence last and flag explicitly):
  - Customer-managed encryption keys (a key-management integration, for example
    AWS KMS or a KMS-compatible service), with granular and immediate key
    revocation and a key-usage audit trail.
  - Data residency: store selected categories of data, and encryption keys,
    within a chosen region.
- Certifications (SOC 2, ISO 27001 family, FedRAMP) are process and audit
  outcomes, not code; design and document to support them but do not treat them
  as build tasks.
- Map to: lib/enterprise (audit, DLP, SLA, information barriers exist), lib/infra,
  IP access control. Strong base. Gaps: the Discovery and export API, retention
  granularity, gated compliance export; the key-management and data-residency
  items are advanced.

### D11. Notifications, profiles, and preferences

- Notification preferences per channel and globally; highlight or keyword
  notifications; notification schedules; mute.
- Do Not Disturb with a schedule and an override-to-notify path.
- Desktop, native, and push notifications.
- Desktop application (Electron) and mobile clients.
- Custom statuses with expiry; presence.
- Custom profile fields defined at the org level.
- User preferences: theme, density, accessibility and screen-reader options,
  language and localization.
- Map to: lib/notifications, lib/ui, components/notifications, desktop. Most
  exist. Keyword notifications and org-level custom profile fields are likely
  gaps.

### D12. Files and storage

- Upload and download; previews for images and for PDFs via the Stirling
  pipeline; file comments.
- External file sharing controls and public link toggles.
- File retention aligned with D10 retention policy.
- S3 and MinIO storage; a virus-scanning hook on upload.
- Map to: lib/documents, lib/infra S3, app/api/files and documents. Gaps:
  virus scanning, external-share controls, and retention parity.

---

## 4. Mandatory QA audit (run before and alongside feature work)

Perform a comprehensive audit of the entire repository. Produce a prioritized
report at docs/audits/parity-audit-<date>.md, grouped Critical, High, Medium,
each item with file path, evidence, and a concrete fix. Resolve findings before
or as part of the related epic.

### 4.1 Inventory and conflict detection
- Map duplicate and legacy files and competing sources of truth. The legacy
  agent and methodology systems (.agents, .kiro, _bmad, _bmad-output,
  _skills-import) are being collapsed into the single .claude registry; archive
  them per MIGRATION.md and remove their wiring rather than leaving them live.
- Detect conflicting configuration, dead and unreachable routes, orphaned
  components, and stale documentation that contradicts the parity matrix.
- Detect boundary violations: frontend reaching into lib or app/api, backend
  editing components or migrations, routes bypassing tracedRoute().

### 4.2 Dependency audit
- Identify unused files, exports, and dependencies (for example with knip and
  ts-prune), circular dependencies (for example with madge), and duplicate or
  competing libraries that serve the same purpose.
- Remove junk and unused dependencies that add weight without value. Record
  every removal with a one-line justification.
- Run a vulnerability scan (bun audit) and resolve or document advisories. Pin
  versions and deduplicate the lockfile.

### 4.3 Code conflicts and integrity
- Resolve all TypeScript strict errors, ESLint violations, broken imports, and
  failing tests.
- Flag the oversized modules for staged refactor toward the under-200-line
  standard: lib/infra/migrate.ts, app/home/page.tsx,
  components/tickets/TicketsPanel.tsx, components/modals/PreferencesModal.tsx,
  and app/styles.css. Treat these as refactor targets, not immediate blockers.

### 4.4 Test integrity
- Keep the existing suite green. Add tests for every new parity capability,
  test-first where practical. Maintain unit, integration, and end-to-end
  coverage.

---

## 5. Auto-install and configuration mandate

For each epic, install and configure the technologies required to reach a
working, production-ready state. Do not ask for manual setup that the agent can
perform.

- Install dependencies with bun add, pinned to explicit versions. No global
  installs. Update bun.lockb.
- Add required services to docker-compose.yml for local development and to the
  infra manifests (docker-desktop kustomize, k3s) for deployment. Likely
  additions by epic: a lexical search service for D4 (OpenSearch or equivalent,
  lexical only); a TURN or STUN service and a media server or SFU for D5
  huddles and calls; a key-management integration for the D10 advanced tier.
- Add new environment variables to .env.example and document them; never commit
  secrets.
- Generate forward-only migrations for every schema change.
- Update CI to install and gate with Bun: type-check, lint, test, build.
- Verify the result boots: docker compose up healthy, the app starts, and /gates
  returns green. Bloat note: AAELink is the enterprise application; the
  featherweight file-size rule from the legacy desktop tooling does not apply
  here, but still avoid unnecessary or duplicate dependencies.
- Document every added technology and the reason in the relevant epic note.

---

## 6. Execution protocol

1. Read CLAUDE.md, docs/STATE.md, the two parity documents, and the production
   checklist. Run the QA audit (section 4) and establish a green baseline with
   /gates. Commit the audit report.
2. Build a parity ledger: every capability in section 3 marked Done, Partial, or
   Gap, with the satisfying route or module. Keep it in sync with the parity
   matrix.
3. Work the epics in dependency order (section 7). For each epic:
   - /plan the epic, then /grill the plan.
   - Implement through the orchestrator: platform first for schema, migration,
     client, and infrastructure; then backend for routes and lib logic; then
     frontend for UI. Pass each contract forward verbatim.
   - reviewer (gates 1 to 2), then test-runner (gate 3), then /gates for gate 4.
   - /handoff to update docs/STATE.md and the parity ledger and matrix.
4. Report cadence: after each epic, summarize what shipped, the ledger delta, and
   the remaining gaps. Do not silently expand scope into AI features.

---

## 7. Recommended phase order

| Phase | Epics | Rationale |
|-------|-------|-----------|
| 1 | QA audit, then D1 organization and workspace architecture | Foundation; enterprise identity and cross-workspace channels gate everything |
| 2 | D2 identity and access | SSO, SCIM, sessions, guests build on the org container |
| 3 | D3 messaging gaps, D4 lexical search | Close core collaboration parity |
| 4 | D9 administration, D10 compliance and governance | Enterprise parity hinges on admin and compliance; advanced D10 tier deferred to the end |
| 5 | D5 huddles and calls | WebRTC stack, isolated and heavy |
| 6 | D6 productivity surfaces, D7 developer platform | Canvas, Lists, Workflow Builder, Block Kit, manifests |
| 7 | D8 Connect | Depends on org container and governance |
| 8 | D11 notifications and profiles, D12 files, then D10 advanced tier (key management, data residency) | Polish and the heaviest add-ons last |

---

## 8. Definition of done (production parity)

- Every in-scope capability in section 3 maps to a shipped, tested route or
  module, recorded in the parity ledger and matrix as Done.
- The parity matrix is fully green for all in-scope items; out-of-scope AI items
  are explicitly marked Deferred.
- /gates returns green; docker compose and the infra manifests bring the stack up
  healthy.
- No duplicate or legacy files remain live; the legacy systems are archived; the
  dependency tree is clean and audited.
- The QA audit report is resolved.
- The production checklist (docs/deployment/production-checklist.md) is satisfied.

---

## Reconciliation note (2026-06-02)

Recorded when this directive was registered into the repository as source of truth.
The directive text above is preserved verbatim; this note captures repo reality.

- Legacy systems already archived (section 4.1): `.agents`, `.kiro`, `_bmad`,
  `_bmad-output`, `_skills-import` were moved to `archive/legacy/` and excluded
  from tsconfig, eslint, and the build. The `.claude` agent registry
  (orchestrator, backend, platform, frontend, reviewer, test-runner) is live.
- Lockfile: the repo uses Bun 1.2+ text `bun.lock`, not the older binary
  `bun.lockb` named in sections 1 and 5. Read every `bun.lockb` reference as
  `bun.lock`.
- Migrations live at `lib/infra/migrate.ts` (confirmed); `lib/infra/` holds the
  module-level db/redis/s3 singletons.
- `docs/audits/` created for the section 4 audit report.
- Dependency policy deviation: a daily auto-update job
  (`scripts/daily-update.sh`, launchd `com.aaelink.daily-update`) runs
  `bun update --latest`. This intentionally overrides the pin-explicit-versions
  guidance in sections 4.2 and 5 for now; revisit when the parity program
  defines a pinning policy.
- Phase 1 (QA audit + D1 org/workspace) has not been started. This registration
  is documentation only.
