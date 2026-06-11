# User Profile Panel Implementation Plan

> **For agentic workers:** Use the project's standard four-gate verification at every checkpoint marked. Steps use checkbox (`- [ ]`) syntax for tracking. Each task is a single feature with RED → GREEN → verification.

**Goal:** Replace the popup `UserProfileCard` with a right-rail `<UserProfilePanel>`, deep-linkable via `?profile=<userId>`, replacing any other rail pane on open.

**Architecture:** New panel component mirrors `ChannelInfoPanel.tsx`. State + URL sync owned by `app/home/page.tsx`. Reuses existing `GET /api/users/profile?user_id=<id>` (no new endpoints, no schema changes).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest. Existing project conventions: `tests/` (not `__tests__/`), `apiFetch` from `lib/apiClient`, `tracedRoute` chokepoint already secures all routes, design tokens in `app/styles.css`.

**Spec:** `docs/superpowers/specs/2026-05-15-user-profile-panel-design.md`

---

## File Map

Files to create:
- `app/components/UserProfilePanel.tsx` — the panel component (~280 lines)
- `tests/userProfilePanel.test.tsx` — 10 unit tests

Files to modify:
- `app/home/page.tsx` — replace `profileUserId` modal mount with `profilePaneId` rail mount; add URL sync; close-other-panes helper
- `app/components/UserHovercard.tsx` — `onOpenFullProfile` handler now triggers the rail pane (no signature change)
- `app/styles.css` — append `.user-profile-panel-*` styles

Files to delete:
- `app/components/UserProfileCard.tsx` — replaced by the new pane

---

## Task 1 — Test scaffolding (RED)

**Files:**
- Create: `tests/userProfilePanel.test.tsx`

- [ ] **Step 1: Write the test file with all 10 cases**

The test file imports `UserProfilePanel` (which doesn't exist yet) — that's the failing-import RED. We assert behavior up-front so the implementation has a target.

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { UserProfilePanel } from '@/app/components/UserProfilePanel'

vi.mock('@/lib/apiClient', () => ({
  apiFetch: vi.fn(async () => ({
    ok: true,
    json: async () => ({
      user: {
        id: 'u1', username: 'alice', email: 'alice@aae.local',
        display_name: 'Alice Adams', platform_role: 'member',
        avatar_url: '', status: 'active', created_at: 1700000000000,
      },
      profile: { 'profile.about': 'Engineer', 'profile.title': 'Senior Eng' },
      custom_status: null,
      department_name: 'Engineering',
    }),
  })),
}))

describe('UserProfilePanel', () => {
  let onClose: ReturnType<typeof vi.fn>
  let onMessage: ReturnType<typeof vi.fn>
  let onHuddle: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onClose = vi.fn()
    onMessage = vi.fn()
    onHuddle = vi.fn()
  })

  it('renders nothing when userId is null', () => {
    const { container } = render(
      <UserProfilePanel userId={null} presenceStatus="online"
        onClose={onClose} onMessage={onMessage} onHuddle={onHuddle} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows loading state while fetching', () => {
    render(
      <UserProfilePanel userId="u1" presenceStatus="online"
        onClose={onClose} onMessage={onMessage} onHuddle={onHuddle} />
    )
    expect(screen.getByText(/loading/i)).toBeTruthy()
  })

  it('renders the name once fetched', async () => {
    render(
      <UserProfilePanel userId="u1" presenceStatus="online"
        onClose={onClose} onMessage={onMessage} onHuddle={onHuddle} />
    )
    await waitFor(() => expect(screen.getByText('Alice Adams')).toBeTruthy())
  })

  it('Esc key calls onClose', async () => {
    render(
      <UserProfilePanel userId="u1" presenceStatus="online"
        onClose={onClose} onMessage={onMessage} onHuddle={onHuddle} />
    )
    await waitFor(() => screen.getByText('Alice Adams'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('X button calls onClose', async () => {
    render(
      <UserProfilePanel userId="u1" presenceStatus="online"
        onClose={onClose} onMessage={onMessage} onHuddle={onHuddle} />
    )
    await waitFor(() => screen.getByText('Alice Adams'))
    fireEvent.click(screen.getByLabelText(/close/i))
    expect(onClose).toHaveBeenCalled()
  })

  it('Message button calls onMessage with userId', async () => {
    render(
      <UserProfilePanel userId="u1" presenceStatus="online"
        onClose={onClose} onMessage={onMessage} onHuddle={onHuddle} />
    )
    await waitFor(() => screen.getByText('Alice Adams'))
    fireEvent.click(screen.getByRole('button', { name: /^message$/i }))
    expect(onMessage).toHaveBeenCalledWith('u1')
  })

  it('Huddle button calls onHuddle with userId', async () => {
    render(
      <UserProfilePanel userId="u1" presenceStatus="online"
        onClose={onClose} onMessage={onMessage} onHuddle={onHuddle} />
    )
    await waitFor(() => screen.getByText('Alice Adams'))
    fireEvent.click(screen.getByRole('button', { name: /^huddle$/i }))
    expect(onHuddle).toHaveBeenCalledWith('u1')
  })

  it('"View full profile" button is disabled when no callback provided', async () => {
    render(
      <UserProfilePanel userId="u1" presenceStatus="online"
        onClose={onClose} onMessage={onMessage} onHuddle={onHuddle} />
    )
    await waitFor(() => screen.getByText('Alice Adams'))
    const btn = screen.getByRole('button', { name: /view full profile/i })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows error state with retry on fetch failure', async () => {
    const apiClient = await import('@/lib/apiClient')
    vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
      ok: false, status: 500,
      json: async () => ({ error: 'internal_server_error' }),
    } as Response)
    render(
      <UserProfilePanel userId="u_err" presenceStatus="offline"
        onClose={onClose} onMessage={onMessage} onHuddle={onHuddle} />
    )
    await waitFor(() => expect(screen.getByText(/could not load/i)).toBeTruthy())
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy()
  })

  it('renders the department from the API response', async () => {
    render(
      <UserProfilePanel userId="u1" presenceStatus="online"
        onClose={onClose} onMessage={onMessage} onHuddle={onHuddle} />
    )
    await waitFor(() => expect(screen.getByText('Engineering')).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run the test file. Verify it fails with module-not-found**

```bash
npm test -- userProfilePanel
```

Expected: 10 tests fail, all with the same import error: `Cannot find module '@/app/components/UserProfilePanel'`. That's the canonical RED — the implementation simply doesn't exist yet.

---

## Task 2 — Build `UserProfilePanel.tsx` (GREEN)

**Files:**
- Create: `app/components/UserProfilePanel.tsx`

- [ ] **Step 1: Implement the component**

Full component shape:
- `'use client'` directive
- Props: `{ userId: string | null; presenceStatus: string; onClose: () => void; onMessage: (uid) => void; onHuddle: (uid) => void; onViewFullProfile?: (uid) => void }`
- Uses `useEffect` to fetch on `userId` change; aborts on unmount
- Returns `null` when `userId` is null
- Renders the 8 sections from the spec
- Mounts `AvatarLightbox` for the click-avatar interaction
- Esc handler installed only when pane is open (no listener leak)

The shape mirrors `ChannelInfoPanel.tsx` for consistency. Reuses existing classes where possible (`ghost-button`, `slack-button`, `mm-icon-btn`).

- [ ] **Step 2: Run the targeted suite. Verify GREEN**

```bash
npm test -- userProfilePanel
```

Expected: all 10 pass. If any fails, fix the component, not the test (unless the test was wrong — see the v0.0.28 lesson where description and assertion disagreed).

- [ ] **Step 3: Run the full test suite to catch regressions**

```bash
npm test
```

Expected: 1,367 / 1,367 passing (1,357 baseline + 10 new). Anything else means we broke something elsewhere.

---

## Task 3 — CSS for the panel (no test — visual)

**Files:**
- Modify: `app/styles.css`

- [ ] **Step 1: Append `.user-profile-panel-*` block**

Mirror the `.channel-info-*` patterns. Width matches the right rail (~340px), full-height, scrollable body, `aae-rhs-enter` animation token from v0.0.23 motion utilities. Honor `prefers-reduced-motion` (already done via the token).

- [ ] **Step 2: Run lint and type-check**

```bash
npm run lint
npm run type-check
```

Both should remain at 0 issues / 0 errors.

---

## Task 4 — Wire into `app/home/page.tsx` (the rail mount)

**Files:**
- Modify: `app/home/page.tsx`

- [ ] **Step 1: Replace `profileUserId` state with `profilePaneId`**

Search-and-replace the modal-mount usage. The existing state was used by `<UserProfileCard>` which the spec deletes; the new `<UserProfilePanel>` lives in the right rail.

- [ ] **Step 2: Add `closeAllRailPanes` helper**

Small function that clears `channelInfoOpen`, `threadRoot`, `pinnedPanelOpen`, `memberListOpen`, and `profilePaneId`. Used by the various open-pane handlers so they're mutually exclusive.

- [ ] **Step 3: Replace existing open-pane setters with versions that call `closeAllRailPanes` first**

E.g. `setChannelInfoOpen(true)` → `() => { closeAllRailPanes(); setChannelInfoOpen(true) }` (or wrap in a single `openRailPane('channelInfo' | 'thread' | 'profile' | ...)` helper if it's cleaner).

- [ ] **Step 4: Mount `<UserProfilePanel>` where `<UserProfileCard>` used to be**

Replace the modal-style `<UserProfileCard>` block with the rail-style `<UserProfilePanel>` mount. Pass `userMap[profilePaneId]` as the user, `presenceStatus={getStatus(profilePaneId)}`, `onClose={() => setProfilePaneId(null)}`, `onMessage={openDm}`, `onHuddle={(uid) => router.push(...)}`.

- [ ] **Step 5: Add URL sync**

In a `useEffect`:
- On mount, read `?profile=` from `searchParams` and set `profilePaneId` if present
- When `profilePaneId` changes, `router.replace` with the param added or stripped

- [ ] **Step 6: Run all four gates**

```bash
npm run type-check && npm run lint && npm test && npm run build
```

All four must exit 0.

---

## Task 5 — Wire mention/avatar clicks to the new pane

**Files:**
- Modify: `app/home/page.tsx`

- [ ] **Step 1: Update mention/avatar click handlers**

Search `app/home/page.tsx` for callers of `setProfileUserId`. Each becomes `setProfilePaneId` (or whatever the helper from Task 4 step 3 is named). The callers are: `ChatMessage`'s `onMentionClick`, `onAvatarClick`, `ChannelSidebar`'s DM avatar click (if any), and the hovercard's `onOpenFullProfile`.

- [ ] **Step 2: Run all four gates**

---

## Task 6 — Update the hovercard hand-off

**Files:**
- Modify: `app/components/UserHovercard.tsx`

- [ ] **Step 1: Verify the existing prop is still wired correctly**

Hovercard already exposes `onOpenFullProfile?: (uid: string) => void`. After Task 5 the page-level handler points at the rail pane; nothing else should change inside the hovercard. Read through the component to confirm no stray `UserProfileCard` references remain.

- [ ] **Step 2: Run all four gates**

---

## Task 7 — Delete the old `UserProfileCard`

**Files:**
- Delete: `app/components/UserProfileCard.tsx`

- [ ] **Step 1: Confirm zero remaining imports**

```bash
/usr/bin/grep -rln "UserProfileCard" app lib
```

Expected: empty. If anything remains, fix the import before deleting.

- [ ] **Step 2: Delete the file**

- [ ] **Step 3: Run all four gates**

```bash
npm run type-check && npm run lint && npm test && npm run build
```

This is the **release-ready checkpoint**. After this all four gates must be green.

---

## Task 8 — Bump version, write release notes, update README

**Files:**
- Modify: `package.json` (0.0.28-alpha → 0.0.29-alpha)
- Create: `docs/release-notes/v0.0.29-alpha.md`
- Modify: `README.md` (version header + changelog row + roadmap roll-forward)

- [ ] **Step 1: Bump version**

- [ ] **Step 2: Write release notes**

Cover: new `<UserProfilePanel>`, deletion of `<UserProfileCard>`, deep-link via `?profile=`, rail mutual-exclusion, 10 new tests, total 1,367 passing.

- [ ] **Step 3: Update README**

- [ ] **Step 4: Final four-gate run at v0.0.29-alpha**

This is the publishing checkpoint. The Superpowers verification skill's "shipped" message format is only valid after this.

---

## Verification checklist (cross-cutting)

Before declaring v0.0.29-alpha shipped:

- [ ] All 10 new tests pass
- [ ] No regressions in the 1,357 existing tests
- [ ] `tsc --noEmit` exits 0
- [ ] `eslint .` exits 0
- [ ] `next build` exits 0
- [ ] Manual click-test: open the app, hover @mention → hovercard appears; click @mention → pane opens; press Esc → pane closes; click another @mention → pane swaps; Channel-info button → pane swaps to channel info; back to a profile mention → pane swaps back; copy `/home?...&profile=<uid>` link → loads with pane open
- [ ] No remaining `UserProfileCard` references in `app` or `lib`
- [ ] Spec doc still accurate (or amended in-place if implementation deviated)

---

## Out of scope (do not include in this implementation)

- Full-page `/profile/[id]` route
- "Recent in this channel" mini-feed
- Mutual-channels list
- Org chart / reporting line
- Edit-from-pane (stays in Preferences > Profile)
- Cover image / banner

---

## Estimated time

- Task 1 (tests): 25 min
- Task 2 (component): 50 min
- Task 3 (CSS): 15 min
- Task 4 (page wire-up + URL sync): 30 min
- Task 5 (mention click): 5 min
- Task 6 (hovercard): 5 min
- Task 7 (delete card): 5 min
- Task 8 (release): 15 min
- **Total: ~2.5 hours** including verification

---

## Sign-off

Plan written 2026-05-15 per the Superpowers `writing-plans` skill. Spec at `docs/superpowers/specs/2026-05-15-user-profile-panel-design.md` was approved by user via brainstorming session. Plan ready to execute.
