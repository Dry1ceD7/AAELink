# AAELink — UI/UX Slack-Parity Audit (2026-06-08)

> Authoritative UI-parity audit. Produced by an 8-auditor + synthesis multi-agent
> sweep of the live codebase on branch `feat/slack-parity-execution-engine`.
> Every high-severity finding was re-verified against source (file:line) before listing.
> Supersedes ad-hoc UI notes. Pairs with `docs/parity-reference-matrix.md` (backend
> capability parity) — this document covers the **UI-Wired / look-and-feel** dimension
> the matrix deliberately scopes out (`parity-reference-matrix.md:38`).

## Why this audit exists

The matrix reports **71.9% Full (189/263)** backend method-group parity. That number is
honest *for what it measures* — response shape, RBAC, CSRF, audit, realtime, invoked
end-to-end. It does **not** measure whether a user can reach the feature in the UI, or
whether the app *looks and feels* like enterprise Slack. The user-reported problem
("so buggy and doesn't look parity to Slack, backend not connected to frontend") lives
entirely in that unmeasured gap.

## Headline finding

The parity problem is **70% wiring/error-handling, 30% visual polish** — not "missing CSS":

1. **FE↔BE wiring chasm** — 306 backend `route.ts` files exist; **~180 wired (~59%)**, **~64 orphaned** (built, no UI caller). Features exist but are invisible.
2. **Swallowed errors** — **107 empty `catch {}`** blocks across components + **10 blocking `alert()`** sites in 3 panels. Users can't tell success from silent failure → "feels buggy."
3. **Compliance theater** — ~7 admin panels (InformationBarriers, DataRetentionSettings, EMMPanel, LegalHoldPanel partial) are pure local-state mocks with **zero `apiFetch`**. Dangerous for an enterprise product that advertises these controls.
4. **Signature Slack affordances absent** — no presence dots on message avatars, no right-click context menus anywhere, mention pills are red (`#cd2b31`) not Slack blue, no global toast layer.

### Honest parity read

- Backend method-group parity: **~72% Full** (plausible, per matrix).
- UI-wired endpoint coverage: **~59%** of routes have a UI caller.
- End-to-end "a user recognizes this as enterprise Slack" UX parity: **~55–65%**.

Reporting a single conflated number is the root doc-drift. Fix is structural: add a
UI-Wired dimension; stop reporting one number.

## Auditor corrections (false positives dropped — do NOT re-investigate)

Adversarial cross-check killed several wrong findings. Future agents: these are settled.

- `.unread-separator` **IS** styled — `app/styles.css:10934`. (Defect is value/weight, not missing rule.)
- `.channel-mention-pill` **IS** styled — `app/styles.css:17363`. (Defect is the **color** `#cd2b31` red; recolor to Slack blue `#1264a3`.)
- Responsive sidebar rule `.app-shell--channels-open .channel-list { transform: translateX(0) }` **EXISTS** — `app/styles.css:2604`.
- `Cmd+/` (shortcuts) and `Cmd+Shift+F` (search) **ARE** wired — `app/home/page.tsx:1069,1073`; `Cmd+K` at `:1159`. Do **not** re-add.

## Top 10 highest-leverage changes (ranked by user-visible parity impact)

1. **Global error + toast layer; kill `alert()` and empty `catch {}`.** Single biggest perceived-quality jump. Every mutating action gains visible success/failure.
2. **`apiFetch` 401/403 interceptor + session-expiry redirect.** `lib/api/apiClient.ts` never inspects `res.status`; expiry silently bricks the UI. Foundational.
3. **Wire orphaned message features** — edit-history popover (`/api/messages/:id/edits`, no caller), thread broadcast toggle (backend writes broadcast row, no UI), scheduled-message visibility.
4. **Presence dots on avatars + author rows.** `ChatMessage.tsx` has zero presence rendering. Slack's signature visual cue.
5. **Right-click context menus on messages AND channels.** No `onContextMenu` anywhere; absence makes the app feel like a prototype.
6. **FilePreviewModal: code highlight + native video/audio + office→PDF.** Currently image+PDF only; backend already emits `can_code_highlight`/`can_player` hints.
7. **Mention pills → Slack blue; unread → true white/700; presence custom-status; draft prominence.** Low effort, high recognition.
8. **Replace admin compliance mocks with real CRUD wiring.** Biggest enterprise-credibility risk.
9. **Modal focus-trap + `ContentFlagModal` dialog semantics.** `Modal.tsx:15` still says "Future: add focus-trap." WCAG + keyboard parity.
10. **Reconcile docs** — `ROADMAP.md:5` "100% parity" vs real 71.9%; add UI-Wired column.

## Execution slices (STRICT disjoint file ownership — parallel-safe)

> Ordered wiring-first. Cross-slice imports are allowed; cross-slice **edits** are not.
> `app/home/page.tsx` is owned by Slice 4; only Slice 4 edits it (other slices expose
> props/components for it to wire).

### Slice 1 — Global Error/Toast Infrastructure + `alert()` removal (HIGH)
**Owns:** `components/shared/ToastProvider.tsx` (new), `lib/ui/toast.ts` (new), `components/workspace/{IntegrationsPanel,CalendarPanel,ApprovalsPanel}.tsx`
- Portal toast (role=status, aria-live=polite, 4s auto-dismiss, error/success/info).
- Replace 10 `alert()` → `toast.error`; add `toast.success` on success paths.
- `<ToastProvider>` mount is a single-line add in Slice 4's page.tsx.
**Accept:** webhook/calendar/approval failures show non-blocking toast; no `window.alert` remains.

### Slice 2 — `apiFetch` resilience + JSON parse guards (HIGH)
**Owns:** `lib/api/apiClient.ts`, `components/chat/{ThreadPanel,ForwardMessageModal,LinkPreview,TypingIndicator}.tsx`
- 401 → redirect `/login` (guard `/api/auth/*` loops); expose status for 403.
- Wrap every `res.json()` as `await res.json().catch(()=>({}))`; guard `res.ok` before state writes.
- ForwardModal closes only on real 2xx; LinkPreview renders "unavailable" placeholder on failure.
**Accept:** expired session redirects; malformed JSON never crashes thread/forward/typing.

### Slice 3 — Wire orphaned message features (HIGH)
**Owns:** `components/chat/ChatMessage.tsx`, `components/chat/EditHistoryModal.tsx` (new), `components/chat/BroadcastToggle.tsx` (new)
- `(edited)` becomes a button → fetch `/api/messages/:id/edits` → EditHistoryModal.
- Render presence dot from a `presence` prop (type owned by Slice 5).
- BroadcastToggle component for thread composer reuse; `last_reply_at` in thread tease.
**Accept:** edit-history modal populated from backend; broadcast toggle posts `broadcast=true`.

### Slice 4 — Keyboard + context menus + quick-switcher (MEDIUM) — page.tsx owner
**Owns:** `app/home/page.tsx`, `components/chat/MessageContextMenu.tsx` (new), `components/chat/ChannelContextMenu.tsx` (new)
- Do NOT re-add Cmd+/ Cmd+Shift+F Cmd+K (already wired). Add j/k message nav only.
- Cursor-positioned context-menu portals; expose `onContextMenu` handler props for ChatMessage/ChannelSidebar to attach.
- QuickSwitcher highlights current channel; mount `<ToastProvider>`.
**Accept:** right-click message → copy/react/reply/pin/delete; right-click channel → mute/leave/archive.

### Slice 5 — Presence model end-to-end (MEDIUM)
**Owns:** `app/home/ChannelSidebar.tsx`, `lib/types/presence.ts` (new), `components/chat/MessageHeader.tsx` (new if extracted)
- `presence: 'active'|'away'|'dnd'|'offline'` + custom-status emoji/text as single source of truth.
- Sidebar: custom-status emoji in presence span; brighten draft icon; persist Enterprise/Admin section collapse.
**Accept:** sidebar rows show presence + custom-status; draft indicator visible; all sections remember collapse.

### Slice 6 — File preview parity (MEDIUM)
**Owns:** `components/media/FilePreviewModal.tsx`, `components/media/CodePreview.tsx` (new)
- Syntax-highlighted code for text/code MIME (driven by `can_code_highlight`).
- Native `<video>`/`<audio>` for media MIME; office → existing convert route → PDF iframe.
**Accept:** code highlighted, mp4/mp3 play inline, docx/xlsx/pptx preview as PDF.

### Slice 7 — Admin compliance: replace mocks with real CRUD (HIGH)
**Owns:** `components/admin/{InformationBarriers,DataRetentionSettings,EMMPanel,LegalHoldPanel}.tsx`, `app/api/compliance/barriers/route.ts` (new), `app/api/admin/retention-policies/route.ts` (new), `app/api/admin/emm-policy/route.ts` (new)
- New routes follow repo conventions (tracedRoute + auth + RBAC + CSRF + audit); migrations appended at end of MIGRATIONS with pre-assigned numbers.
- Remove hardcoded `useState` seeds; load via `apiFetch` on mount; wire create/delete/persist + loading/error states.
**Accept:** each panel loads real data, persists (verifiable via reload), writes audit rows. No mock arrays ship.

### Slice 8 — Visual + a11y polish (MEDIUM)
**Owns:** `app/styles.css`, `components/primitives/Modal.tsx`, `lib/a11y/useFocusTrap.ts` (new), `components/moderation/ContentFlagModal.tsx`
- styles.css: `.channel-mention-pill` `#cd2b31`→`#1264a3`; `.channel--unread` true white + 700; raise `--mm-sidebar-text` to 0.85 (WCAG AA); fix `.high-contrast` to override real `--mm-*` tokens; one `:focus-visible` rule. Do NOT "add missing" pill/separator (already exist).
- Modal focus-trap via `useFocusTrap`; ContentFlagModal `role=dialog`/`aria-modal`/`aria-labelledby`/Esc.
**Accept:** mention blue, unread true-white-bold, sidebar text passes 4.5:1, modals trap+restore focus.

## Doc corrections to apply

1. `ROADMAP.md:5` — retract "100% parity achieved at v0.0.7-alpha" (already retired by `parity-reference-matrix.md:21`); cite this audit.
2. `parity-reference-matrix.md` — add **UI-Wired** dimension; re-grade backend-Full/UI-absent rows: `messages/:id/edits`, `kb/articles/:id` detail, in-call reactions, file preview (code/video/audio/office), canvas version history, canvas pin, thread broadcast, ephemeral messages.
3. `parity-reference-matrix.md` — annotate ~64 orphaned backend-only endpoints; tally user-reachable features, not route existence.
4. `parity-reference-matrix.md` — flag admin compliance panels (InformationBarriers, DataRetentionSettings, EMMPanel, LegalHoldPanel) as UI-stub/mock regardless of any Full compliance row.
5. `parity-next-slices.md` — append UI-wiring slice section + false-positive notes (above).
