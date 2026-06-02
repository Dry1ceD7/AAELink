# User Profile Panel — Design Spec

**Date:** 2026-05-15
**Owner:** Claude Opus 4.7 (this session)
**Status:** Approved by user 2026-05-15
**Origin:** `docs/parity-ui-audit-2026-05-11.md` §9.2; v0.0.29 milestone

---

## Problem

AAELink today exposes user profile information through three surfaces:

1. **`UserHovercard`** — 300ms hover preview on `@mentions` (lightweight, 6-field summary)
2. **`UserProfileCard`** — popup that opens on avatar / mention click (modal-style overlay)
3. **`PreferencesModal` → Profile tab** — self-edit form

The popup variant is the bottleneck. It's modal — it blocks the main view, doesn't share the right-rail real estate where every other "supplementary" surface lives (channel info, threads, pins, member list), and it can't be deep-linked. Slack uses a right-rail pane for the same data, which is why audit §9.2 flagged this gap.

The full-page profile route the audit names (`/profile/[id]`) is a related but separate concern — that's Option B and stays out of this spec.

---

## Goal

Replace the popup `UserProfileCard` with a right-rail `<UserProfilePanel>` that:

- Slots into the same rail real-estate as `ChannelInfoPanel`, `ThreadPanel`, `PinnedMessagesPanel`, `MemberListPanel`
- Is deep-linkable via `?profile=<userId>` so URLs are shareable and the browser back button works
- Replaces (does not stack with) any other right-rail pane that's already open
- Reuses the existing `GET /api/users/profile?user_id=<id>` endpoint — no new server work

The hovercard stays as the 300ms preview. Edit-your-own-profile stays in the Preferences modal.

---

## Non-goals

- Full-page profile route (`/profile/[id]`) — explicitly Option B, future milestone
- "Recent in this channel" mini-feed — Option B alternate, explicitly out of scope
- Mutual-channels list — directory feature, belongs on the future full page
- Profile editing from the pane — stays in Preferences > Profile
- Org-chart / reporting-line UI — not in scope; data not available in this codebase yet

---

## Architecture

### Component layout

```
app/home/page.tsx                       Owner of profilePaneId state, URL sync
└── <ChannelSidebar />                  Triggers via avatar / DM click
└── <MessageTimeline />                 Triggers via mention / avatar click in messages
└── <ChatHeader />
└── <ChannelInfoPanel />                Right rail — mutually exclusive
    OR
    <ThreadPanel />                     Right rail — mutually exclusive
    OR
    <PinnedMessagesPanel />             Right rail — mutually exclusive
    OR
    <UserProfilePanel />     ← NEW      Right rail — mutually exclusive
    OR
    <MemberListPanel />                 Right rail — mutually exclusive
```

### Data flow

```
URL ?profile=USER_ID  ──→  page.tsx useEffect  ──→  setProfilePaneId(USER_ID)
                                                          │
mention/avatar click  ──→  setProfilePaneId(USER_ID)  ────┤
                                                          │
                                                          ▼
                                          <UserProfilePanel userId={...} />
                                                          │
                                                          ▼
                              GET /api/users/profile?user_id=USER_ID
                                                          │
                                                          ▼
                              { user, profile, custom_status, department_name }
                                                          │
                                                          ▼
                                                    8 rendered sections
```

### Rail mutual-exclusion

Only one of `channelInfoOpen`, `threadRoot`, `pinnedPanelOpen`, `memberListOpen`, `profilePaneId` is non-null at a time. Setter ergonomics:

- `setProfilePaneId(uid)` calls a small `closeAllRailPanes()` helper before setting itself
- `setChannelInfoOpen(true)` etc. likewise clear `profilePaneId`

This is the simplest correct model — predictable for the user (one click = one pane swap) and predictable for the code (no need for a stack data structure).

### URL sync

- On `setProfilePaneId(uid)` → `router.replace('/home?...&profile=' + uid)` (preserves other params)
- On `setProfilePaneId(null)` → strip `?profile`
- On mount with `?profile=` present → set state once
- The URL is the source of truth on hard refresh; state is the source of truth during the session

---

## Component contract

### `<UserProfilePanel userId={...} onClose={...} onMessage={...} onHuddle={...} onViewFullProfile={...} />`

| Prop | Type | Required | Notes |
|------|------|----------|-------|
| `userId` | `string` | yes | The user to display |
| `onClose` | `() => void` | yes | Caller clears `profilePaneId` |
| `onMessage` | `(uid: string) => void` | yes | Opens / creates DM with this user |
| `onHuddle` | `(uid: string) => void` | yes | Opens huddle module with this user as recipient |
| `onViewFullProfile` | `(uid: string) => void \| undefined` | no | If provided, button enabled; else disabled with tooltip |
| `presenceStatus` | `string` | yes | From the page's `getStatus(uid)` helper |

### Internal state

- `loading: boolean` — true while fetching `/api/users/profile`
- `error: string | null` — message if fetch fails
- `data: ProfileData | null` — typed response from the API
- `lightboxOpen: boolean` — for the existing `AvatarLightbox` reuse
- `copiedField: string | null` — UX flash after copy-to-clipboard

### Sections (top to bottom)

| # | Section | What it shows | Empty state |
|---|---------|---------------|-------------|
| 1 | Header | Close X (top right), avatar (click → AvatarLightbox), name, pronouns, job title | initial letter avatar if no `avatar_url` |
| 2 | Status row | Presence dot + label, custom status emoji + text, local time (from `timezone`) | "Active" / "Offline" only |
| 3 | Actions | `Message`, `Huddle`, `View full profile` (disabled, tooltipped) | always rendered |
| 4 | Contact | email (mailto + copy), phone (tel + copy), `@username` (copy) | section hidden when all three empty |
| 5 | About me | `profile.about` rendered as paragraph | "No bio yet." muted |
| 6 | Job title / Department | admin-locked styling matching Preferences modal | section hidden when both empty |
| 7 | Timezone / local time | IANA tz + computed local time | section hidden when timezone empty |
| 8 | Member since | `created_at` as a friendly relative date | always rendered |

---

## Data model

No schema changes. Reuses `GET /api/users/profile?user_id=<id>` exactly as today. Response shape:

```ts
{
  user: {
    id: string
    username: string
    email: string
    display_name: string
    platform_role: string
    avatar_url: string
    status: string  // 'active' | 'inactive' | 'guest'
    created_at: number
  },
  profile: Record<string, string>,  // 'profile.about' | 'profile.pronouns' | 'profile.title' | etc.
  custom_status: { status_text, status_emoji, expires_at } | null,
  department_name: string,
}
```

The pane shapes this into the 8 sections client-side. No new endpoints.

---

## Error handling

- **Network failure / 5xx** — show inline error with Retry button. Pane stays open.
- **404 (user not found)** — show "This user no longer exists" + close button. Could happen if a deactivated user's `profile?id=` URL is shared.
- **403 (no access — information barrier)** — show "You don't have access to this profile". Could happen across information-barrier boundaries.
- **No avatar_url** — show first-letter initial in a colored disc (already the convention).
- **Empty profile metadata** — collapse the section instead of showing empty rows.

---

## Testing

TDD per Superpowers steering. Tests live in `tests/userProfilePanel.test.tsx`. Vitest + `@testing-library/react` (already used by other component tests).

| # | Test | Type |
|---|------|------|
| 1 | Pane is hidden when `userId` is null | unit |
| 2 | Pane fetches `/api/users/profile?user_id=<id>` on mount | unit (mock fetch) |
| 3 | Loading state shown while fetching | unit |
| 4 | Error state with Retry on network failure | unit |
| 5 | Esc key closes the pane (calls `onClose`) | integration |
| 6 | X button calls `onClose` | unit |
| 7 | Message button calls `onMessage(userId)` | unit |
| 8 | Huddle button calls `onHuddle(userId)` | unit |
| 9 | "View full profile" button is disabled when no `onViewFullProfile` provided | unit |
| 10 | Avatar click opens `AvatarLightbox` | integration |

Plus an integration check that opening the profile pane closes any other rail pane (page-level state test, not component test).

---

## Performance / accessibility

- Component is `memo`'d; only re-renders when `userId` changes.
- ARIA: `role="complementary"` on the panel, `aria-labelledby={nameId}`.
- Esc handler installed only when pane is open (no global listener leak).
- Action buttons are real `<button>` elements with `type="button"` and `aria-label`.
- Tab order: X → avatar (when clickable) → action buttons → contact links → "View full profile".

---

## Migration

| File | Operation |
|------|-----------|
| `app/components/UserProfilePanel.tsx` | **NEW** — ~300 lines |
| `app/components/UserProfileCard.tsx` | **DELETED** — replaced by the pane |
| `app/components/UserHovercard.tsx` | Update — `onOpenFullProfile` keeps signature; new wiring |
| `app/home/page.tsx` | `profileUserId` → `profilePaneId`; URL sync; rail mutual-exclusion helper; `<UserProfilePanel>` mount |
| `app/styles.css` | New `.user-profile-panel-*` styles (mirror `.channel-info-*`) |
| `tests/userProfilePanel.test.tsx` | **NEW** — 10 tests |

`UserProfileCard` is currently used in two places: `app/home/page.tsx` (the modal mount) and `app/components/UserHovercard.tsx` (only as a type reference, not a component import — confirmed by grep). Deletion is safe after the page rewires.

---

## Risk assessment

- **Low risk.** Only state shapes change. No schema, no API. The popup → pane swap is mechanical. URL sync is additive.
- **One subtle thing:** the hovercard "View full profile" button has to point to the new mount target rather than the deleted card. Already typed correctly via the existing `onOpenFullProfile` prop, so just rewire.
- **No production-data risk.** No deletes, no migrations, no audit-logged mutations. Profile reads are idempotent.

---

## Time estimate

~2 hours total:
- Tests first: ~25 min
- `UserProfilePanel.tsx`: ~50 min
- `app/home/page.tsx` rewire + URL sync: ~30 min
- CSS: ~15 min
- Hovercard / mention link rewire: ~10 min
- Four-gate verification: ~10 min

---

## Out of scope (deferred)

- Full-page profile route (`/profile/[id]`)
- "Recent in this channel" feed (Question 2 Option B)
- Mutual-channels list
- Org chart / reporting line
- Edit-from-pane (stays in Preferences > Profile)
- Cover image / banner

---

## Sign-off

Design approved by user in chat session, 2026-05-15. Spec written to `docs/superpowers/specs/2026-05-15-user-profile-panel-design.md`.

Per Superpowers brainstorming skill — next step is the written-spec self-review, then user reviews this file, then transition to `writing-plans` for the implementation plan.
