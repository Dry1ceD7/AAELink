---
source_finding: CHG-011
pillar: "🟠 Changes Required"
severity: P1
slug: chg-011-home-shell-split
created_at: 2026-05-26
audit_run: docs/audit-2026-05-26.md
---

# Story: Split app/home/page.tsx (1,808 lines) into hooks + panels

- **Status:** Draft
- **Roadmap milestone:** v0.0.59-alpha
- **Size:** L

## Context
`app/home/page.tsx` grew to 1,808 lines (was 1,779 in 2026-05-19). v0.0.46 was supposed to extract `useTimelineConnection`; nothing landed. The shell still owns chat, sidebar, WS, presence, drafts, modals, member list. Every UX iteration funnels here.

## Scope
- Extract: `useTimelineConnection`, `useChannelList`, `useMembers`, `useDrafts`, `useBootstrap` to `app/home/hooks/*.ts`.
- Cap `app/home/page.tsx` at 600 lines via an ESLint rule (`max-lines: 600`).
- Co-locate `ChannelSidebar.tsx`, `MessageTimeline.tsx`, `ModuleRenderer.tsx`.

## Acceptance criteria
1. `wc -l app/home/page.tsx` ≤ 600.
2. Each new hook has a `tests/<name>.test.ts`.
3. Four gates pass.
4. Playwright `e2e/chat/messaging.spec.ts` continues to pass without changes.

## References
- `docs/audit-2026-05-26.md` § Required Changes — CHG-011
