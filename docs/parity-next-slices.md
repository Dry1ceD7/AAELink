# AAELink Slack-Parity — Next Slices (resume plan)

Branch: `feat/slack-parity-execution-engine`. Last updated 2026-06-08.

State at pause:
- Full parity **71.9%** (189/263). Partial 57 · Stub 6 · Missing 6 · Excluded 5.
- All gates green: lint 0 errors, tsc clean, unit 1971 + integration 1052 (3023 total).
- Working tree clean except `.mcp.json` (uncommitted by design — removes context7 MCP server; decide: commit as chore or restore).
- 4 slices shipped on this branch: parity-review fixes, security/correctness sweep, admin/identity enforcement, integrations engine.

## Workflow recipe (what worked, reuse it)
1. Read target matrix rows from `docs/parity-reference-matrix.md` "Known gaps" / per-area "Open:" lines.
2. Workflow: N parallel fixer lanes (STRICT disjoint file ownership; pre-assign migration numbers; one lane owns `lib/infra/worker.ts`).
3. Gate loop (lint + tsc + `bun run test:all`, 3-4 repair rounds, repair migrate.ts append collisions).
4. Adversarial per-lane verify (catches: unwired/dead helpers, IDOR/RBAC holes, audit_log INSERT missing id+created_at → silent throw, raw-INSERT realtime instead of redisPubSub, vacuous tests).
5. Fix flagged items inline / follow-up executor; resume dead agents via SendMessage(agentId).
6. Honest doc reconciliation (Full only if whole row complete; recount tally + aggregates).
7. git-master: atomic conventional commits, tests+migration travel with feature, exclude `.mcp.json`, end msgs with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. No push.

Hard rules: every route `tracedRoute()` + auth + RBAC + CSRF on session mutations + audit (id+created_at). DB via `getPool()`/lib/infra. Realtime via redisPubSub only. Migrations append-only at end of MIGRATIONS. Files < 200 lines. Zero emojis. Bun only.

## Candidate next slices (codeable, not env-blocked)

### Slice A — finish integrations emit + OAuth scope (highest leverage; 2 Partial→Full)
- **Int 5 / 23** (Partial): wire remaining `WEBHOOK_EVENT_TYPES` emits — `message.updated`, `file.deleted`, `channel.member_joined`, `channel.member_left`, `compliance.legal_hold_created`. Find each write path, add best-effort `emitWebhookEvent`. Then Int 5+23 → Full.
- **Int 21** (Partial): OAuth-scope enforcement only covers a subset of privileged bearer routes (`enforceScope` in `lib/api/oauthScopes.ts`). Audit all bearer-reachable routes; wire `enforceScope` where missing. NOTE: conflicts with emit lane on shared routes — run emit first or sequence them.

### Slice B — compliance/admin depth
- **Admin 5/6** (Partial): custom roles exist (`lib/auth/customRoles.ts`) but not enforced as ReBAC — runtime gates still key off `platform_role`/`isPlatformAdmin`. Wire custom-role permission checks into route authorization.
- **Admin 34** (Missing): HIPAA/FINRA compliance mode + WORM — no `compliance_mode`/`hipaa_mode`/`finra_mode` toggle; audit_log rows mutable; retention hard-DELETEs. Build mode toggle + immutable-audit (append-only/WORM) + retention guard under mode.

### Slice C — knowledge + remaining UI-depth
- **Knowledge 14** (Missing): canvas version history — no versioning on canvas PUT (whole-doc replace). Add version table + history endpoint.
- **Notif 27**: hourly digest done; realtime digest mode still absent (BLUEPRINT drift) — lower priority.
- **Admin 31**: IP allowlist enforced at API layer (tracedRoute); server-rendered app pages NOT IP-gated (edge can't read DB). Decide if app-page gating is required; if so, session-layer check.

### Deferred (hard / env-blocked — do last or skip)
- **Int 33** plugin runtime sandbox — genuine sandboxed execution is security-hard, needs isolation runtime.
- Excluded set (SFU calls, recording, transcription, APNS, 3D/CAD preview) — env-blocked, out of scope.

## Open follow-ups
- `.mcp.json`: still modified in tree — resolve.
- Migration numbering cosmetic nit: MIGRATIONS array has a couple of out-of-sequence ids (049/050 after 051; 052-055 ordering) — functionally harmless (runner keys by id, idempotent), tidy if convenient.

---

## UI-WIRED PARITY SLICES (added 2026-06-08 — primary track)

The candidate slices above are backend/compliance-focused. The dominant user-facing gap
is **UI/UX + FE↔BE wiring** (see `docs/parity-ui-audit-2026-06-08.md`). These 8 slices have
STRICT disjoint file ownership and are parallel-safe. Ordered wiring-first (70% of the
"feels buggy" complaint is wiring/error-handling, 30% visual).

1. **Toast/error infra** — `ToastProvider.tsx` + `lib/ui/toast.ts` (new); kill 10 `alert()` + empty `catch {}` in IntegrationsPanel/CalendarPanel/ApprovalsPanel.
2. **apiFetch resilience** — `lib/api/apiClient.ts` 401→/login + JSON parse guards in ThreadPanel/ForwardMessageModal/LinkPreview/TypingIndicator.
3. **Orphaned message features** — edit-history popover (`/api/messages/:id/edits`), thread broadcast toggle, `last_reply_at` tease.
4. **Keyboard + context menus** — `app/home/page.tsx` owner; MessageContextMenu/ChannelContextMenu (new); j/k nav; QuickSwitcher current-channel highlight.
5. **Presence end-to-end** — `lib/types/presence.ts` (new); sidebar custom-status emoji; draft prominence; section collapse persistence.
6. **File preview parity** — `FilePreviewModal` + `CodePreview.tsx` (new): code highlight, native video/audio, office→PDF.
7. **Admin compliance real CRUD** — replace InformationBarriers/DataRetentionSettings/EMMPanel/LegalHoldPanel mocks with backend routes + migrations.
8. **Visual + a11y polish** — `app/styles.css` mention `#cd2b31`→`#1264a3`, unread true-white/700, WCAG contrast; Modal focus-trap; ContentFlagModal dialog semantics.

### False positives — do NOT re-investigate (settled 2026-06-08)
- `.unread-separator` IS styled — `app/styles.css:10934` (fix value/weight only).
- `.channel-mention-pill` IS styled — `app/styles.css:17363` (fix is the red color, not missing rule).
- Responsive `.app-shell--channels-open .channel-list { transform: translateX(0) }` EXISTS — `app/styles.css:2604`.
- `Cmd+/`, `Cmd+Shift+F`, `Cmd+K` ARE wired — `app/home/page.tsx:1069,1073,1159`. Do not re-add.

### Orphaned backend (~64 routes, no UI caller) — highest "built but invisible" leverage
`/api/messages/{:id/edits,forward,scheduled,clips,permalink,reactions/users,unfurl,attachments}`,
`/api/kb/articles/:id`, `/api/documents/{:id,assemblies/:id}`, `/api/files/:id`,
`/api/workspaces/:id/{archive,move}`, `/api/admin/{org/:id/*,devices/:id/wipe,emm-policy,retention/enforce,users/deactivate}`,
`/api/webhooks/{v2,:token}`, `/api/calendar/events/:id`, `/api/approvals/requests/:id`, `/api/calls/:id/signals`, `/api/channels/:id/convert`, `/api/rtm/connect`.
