# Slack UI/UX Parity Audit — Design

**Date:** 2026-05-11
**Author:** Claude (Opus 4.7) + project owner
**Path chosen:** C (UI/UX-only) → C1 (audit first)
**Methodology:** Static (source + Slack public docs)

## Purpose

Produce a single verified gap report comparing AAELink's UI/UX to Slack's, so we can prioritize subsequent fix work. **No code changes.** This document is the methodology spec; the audit itself is the deliverable.

## Inputs

- 79 components under `app/components/` and 17 under `app/home/`
- Global styles `app/styles.css`, theme `lib/theme.ts`
- `app/layout.tsx`, `app/admin/`, `app/login/`, `app/settings/`
- Existing parity docs: `docs/parity-reference-matrix.md`, `docs/parity-slack-mattermost-aaelink-full-map.md`, `docs/BLUEPRINT.md`
- Slack public references:
  - Slack Help Center (help.slack.com)
  - Slack Design Patterns (api.slack.com/surfaces)
  - Slack Block Kit (api.slack.com/block-kit)
  - Slack keyboard shortcuts cheat sheet
  - Public Slack changelog (slack.com/release-notes)

## Coverage — 16 areas, ~50 surfaces

1. Shell & nav (workspace switcher, sidebar sections, channel/DM/app lists, unread, presence, density)
2. Channel surface (header, member count, topic, pinned bar, bookmark bar, info pane, member list)
3. Message list (density, day separators, new-messages line, system messages, edits/deletes, reactions, attachments, link previews)
4. Message hover/actions (react, reply, save, share, pin, copy link, bookmark, more menu)
5. Composer (formatting, slash, mentions, emoji, drafts, scheduled, file upload, send states)
6. Threads pane (open, jump, follow, "All threads")
7. Search & command palette (global search, filters, scopes, recents; Cmd-K)
8. Notifications & status (DND, custom status, scheduler, mentions inbox, Catch up)
9. Profiles (hovercard, modal, edit)
10. Settings & prefs (notifications, sidebar, themes, advanced; account/security/sessions/MFA)
11. Files (viewer, lightbox, PDF, browser pane)
12. Admin (users, roles, channels, retention, DLP, audit, SCIM, SSO, sessions, integrations)
13. Calls/huddles (panel, controls, participants)
14. Canvases & lists
15. Apps/integrations (directory, slash surfacing, workflow builder)
16. Cross-cutting (dark mode, focus rings, motion, keyboard nav, loading/empty/error, toasts, modals, density)

## Per-surface row schema

| Field | Content |
|---|---|
| Surface | Name + Slack help URL |
| Slack behaviors | Bulleted enumeration of visual elements, interactions, keyboard, a11y |
| AAELink component(s) | Exact file paths |
| Visual parity | Full / Partial / Stub / Missing |
| Interaction parity | Full / Partial / Stub / Missing |
| Keyboard parity | Full / Partial / Stub / Missing |
| A11y parity | Full / Partial / Stub / Missing |
| Severity (if gap) | P0 / P1 / P2 |
| Specific fixes | Actionable bullets, each implementable in ≤1 day |

## Severity rubric

- **P0** — blocks user workflow, breaks core Slack-class UX expectation, or accessibility violation (WCAG 2.2 AA fail)
- **P1** — noticeable parity gap, hurts day-to-day usability, no workaround
- **P2** — polish / nice-to-have / power-user feature

## Output document structure

`docs/parity-ui-audit-2026-05-11.md` (gitignored per `docs/parity-*.md` rule)

1. Executive summary
   - Overall parity verdict (Full / Partial / Stub / Missing distribution)
   - Top 10 P0 gaps in order
   - Recommended first sprint (5-10 items)
2. Cross-cutting findings (themes across surfaces)
3. Sections 1–16 with per-surface rows
4. Appendix: surfaces explicitly out of scope and why

## Constraints

- No code changes during audit
- No new components, no new routes, no schema changes
- No claim of Slack equivalence without citing a public Slack source
- No screenshot fabrication; visual claims must reference actual AAELink source files
- No estimate of business impact — only severity and scope

## Done criteria

- Every coverage item enumerated above has a row in the report
- Every gap has a severity and at least one specific fix
- Executive summary lists top 10 P0 gaps
- Cross-cutting section has at least 5 themes
- Document committed (or saved locally if gitignored) and surfaced to user

## What comes after this audit

User picks the P0/P1 items to fix → we move to `writing-plans` skill for the chosen batch → implement in subsequent sessions.
