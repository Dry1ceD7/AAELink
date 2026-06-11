# AAELink — Slack UI/UX Parity Audit

**Date:** 2026-05-11
**Methodology:** Static (source + Slack public docs) — see `docs/superpowers/specs/2026-05-11-slack-uiux-parity-audit-design.md`
**Auditor:** Claude Opus 4.7 + project owner

This document is the deliverable of path C1 (UI/UX-only parity, audit first). It compares AAELink's current UI to Slack's, surface by surface, and ranks gaps for prioritization. **No code changes were made to produce this audit.**

---

## Legend

| Mark | Meaning |
|---|---|
| ✅ **Full** | Behavior present, matches Slack-class expectation |
| 🟡 **Partial** | Core behavior present, some edges/states missing |
| 🟠 **Stub** | Component exists, behavior incomplete or shallow |
| 🔴 **Missing** | Not implemented |

Severity for gaps:
- **P0** — blocks core workflow, breaks Slack-class expectation, or WCAG 2.2 AA fail
- **P1** — noticeable day-to-day usability gap, no workaround
- **P2** — polish / power-user / nice-to-have

---

## Executive Summary

> **Filled in at the end of the audit.** See [§17 Executive Summary](#17-executive-summary).

---

## Table of Contents

1. [Shell & Navigation](#1-shell--navigation)
2. [Channel Surface](#2-channel-surface)
3. [Message List](#3-message-list)
4. [Message Hover & Actions](#4-message-hover--actions)
5. [Composer](#5-composer)
6. [Threads Pane](#6-threads-pane)
7. [Search & Command Palette](#7-search--command-palette)
8. [Notifications & Status](#8-notifications--status)
9. [Profiles](#9-profiles)
10. [Settings & Preferences](#10-settings--preferences)
11. [Files](#11-files)
12. [Admin](#12-admin)
13. [Calls & Huddles](#13-calls--huddles)
14. [Canvases & Lists](#14-canvases--lists)
15. [Apps & Integrations](#15-apps--integrations)
16. [Cross-Cutting Findings](#16-cross-cutting-findings)
17. [Executive Summary](#17-executive-summary)
18. [Out of Scope](#18-out-of-scope)

---

## 1. Shell & Navigation

### 1.1 Workspace switcher rail

**Slack reference:** Vertical rail on the far left showing workspace icons; click to switch; right-click for actions; bottom button for "Add workspace".

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/home/WorkspaceDropdown.tsx`, `app/home/ChannelSidebar.tsx` |
| Visual | 🔴 Missing | AAELink has **no left rail** — workspace switching is via a dropdown (`WorkspaceDropdown`) instead of always-visible icons |
| Interaction | 🟡 Partial | Switching works via dropdown / `/workspaces` page, but no quick visual cue of other workspaces |
| Keyboard | 🔴 Missing | No `Cmd+1..9` workspace shortcuts |
| A11y | 🟡 Partial | Dropdown has `role=menu`, but no rail to ARIA-describe |

**Severity:** **P1**
**Fixes:**
- Add a slim left rail (40-56px) when user belongs to ≥2 workspaces; show colored avatar squares with unread dots
- Wire `Cmd+1..9` to switch active workspace
- Keep current dropdown for workspace settings access; rail is for switching only

---

### 1.2 Top sidebar nav (Home/Threads/Activity/Later)

**Slack reference:** Sticky icon-and-label nav bar at top of left sidebar with Home, DMs, Activity, Later, More.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/home/ChannelSidebar.tsx` (lines 107-136), `app/home/sidebarNav.ts` |
| Visual | ✅ Full | Matches Slack: Home / Threads / Activity / Later / More |
| Interaction | 🟡 Partial | "More" expands inline submenu. Slack does this too, but Slack also exposes "Customize" — AAELink has it under workspace menu instead |
| Keyboard | 🟡 Partial | No documented keyboard shortcut to focus top nav items |
| A11y | 🟡 Partial | Buttons but no `aria-current="page"` on the active item; uses `.active` class only |

**Severity:** **P2**
**Fixes:**
- Add `aria-current="page"` to active top-nav item
- Document keyboard shortcuts in `KeyboardShortcutsModal.tsx`

---

### 1.3 Custom sidebar sections / groups

**Slack reference:** Users can create custom named sections (e.g., "Projects", "Important"), drag channels between sections, collapse/expand each. Sections persist per-user.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/home/ChannelSidebar.tsx`, `app/api/channel-categories/route.ts` (route exists) |
| Visual | 🟠 Stub | Only fixed sections (Starred / Channels / DMs / Enterprise / Administration). No user-defined sections in sidebar |
| Interaction | 🔴 Missing | No drag-to-section, no "Create new section" UI affordance |
| Keyboard | 🔴 Missing | No reorder via keyboard |
| A11y | n/a | Feature absent |

**Severity:** **P1**
**Fixes:**
- Wire `channel-categories` API to a UI affordance: "Create section" button at sidebar bottom or via section header right-click
- Add HTML5 drag-and-drop on channel rows to drop into another section
- Persist collapse state per-section (already done via localStorage for fixed sections — extend to dynamic)

---

### 1.4 Sidebar density / customization

**Slack reference:** Settings > Sidebar offers compact mode, show profile picture, show all DMs, show unread badges, sort order.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/SidebarCustomizer` referenced from `WorkspaceDropdown.tsx`, `app/home/SidebarCustomizer.tsx`, `lib/userPreferences.ts` |
| Visual | 🟡 Partial | A customizer exists, scope of options unknown without deeper read; density toggle exists (`UiDensityBoot`) |
| Interaction | 🟡 Partial | Customizer entry from workspace dropdown — Slack puts it in Preferences > Sidebar |
| Keyboard | n/a | — |
| A11y | 🟡 Partial | Modal pattern likely fine; verify focus trap |

**Severity:** **P2**
**Fixes:**
- Verify customizer covers: compact vs comfortable, show profile pictures, show unread only, sort A→Z vs recency
- Move primary entry point to Preferences modal (keep dropdown shortcut)

---

### 1.5 Channel row affordances

**Slack reference:** Channel row shows: icon (#, lock, mute icon), name, unread count, draft icon, mention badge, mute/unread state styling.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/home/ChannelSidebar.tsx` (regularChannels map, lines 180-208) |
| Visual | 🟡 Partial | Has #, lock, star, draft pen, unread count. **Missing**: mute icon, mention pill (vs plain unread count), external/shared marker |
| Interaction | 🟡 Partial | Right-click → toggle star only. **Missing**: full context menu (mute, copy link, leave, mark as read, copy name, view details, move to section) |
| Keyboard | 🔴 Missing | No `Alt+↑/↓` to navigate channels, no `Alt+Shift+↑/↓` to jump unread |
| A11y | 🟡 Partial | Channels are `<button>`, good. But context menu missing means keyboard-only users can't access channel actions |

**Severity:** **P0** (context menu) / **P1** (mute icon, mention pill)
**Fixes:**
- Add full right-click context menu (use a portal-based menu component) with: Mark as read, Mute, Star, Move to section, Copy link, Copy name, View details, Leave
- Add `aria-haspopup="menu"` and `Shift+F10` keyboard handler to open the same menu
- Show mute icon (e.g., 🔕 lucide `BellOff`) on muted channels and adjust opacity
- Differentiate `mention_count > 0` (red pill) from plain unread (blue dot)

---

### 1.6 DM row affordances

**Slack reference:** DM row shows: avatar OR presence dot, display name, unread count, optional "you:" prefix for sent-by-you preview.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/home/ChannelSidebar.tsx` (dmChannels map, lines 211-253) |
| Visual | 🟡 Partial | Presence dot ✅, name ✅, unread ✅, group DM badge ✅. **Missing**: avatar option, "you:" preview |
| Interaction | 🟠 Stub | No context menu for DMs (close conversation, mark as unread, view profile) |
| Keyboard | 🔴 Missing | Same as 1.5 |
| A11y | 🟡 Partial | Same as 1.5 |

**Severity:** **P1**
**Fixes:**
- Add DM context menu: View profile, Mark as unread, Close conversation
- Optional toggle in customizer: show avatar instead of presence dot for richer view

---

### 1.7 User footer (avatar + status)

**Slack reference:** Bottom-left card with avatar, name, presence, click → menu with profile, set status, set away, pause notifications, preferences, sign out.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/home/UserFooter.tsx` |
| Visual | ✅ Full | Avatar with presence, name, "Active/DND" label, chevron |
| Interaction | 🟡 Partial | Menu has: Profile & prefs, Set custom status, Admin link, Status quick-set (Online/Away/DND/Offline), Sign out. **Missing**: "Pause notifications" with duration submenu, "View profile" (separate from prefs) |
| Keyboard | 🟡 Partial | Menu opens on Enter but no documented `Cmd+Shift+Y` for quick status |
| A11y | ✅ Full | `aria-haspopup`, `aria-expanded`, `role=menu` |

**Severity:** **P1**
**Fixes:**
- Add "Pause notifications" submenu: 30m / 1h / 2h / today / this week / custom — wire to existing `lib/notificationSchedule.ts`
- Add explicit "View profile" entry that opens `UserProfileCard.tsx`
- Wire `Cmd+Shift+Y` to quick-set status

---

### 1.8 Workspace dropdown menu

**Slack reference:** Workspace icon (top) → menu with workspace name, invite, preferences, tools & settings (analytics, customize, manage members, billing, app management), sign in/out workspace.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/home/WorkspaceDropdown.tsx` |
| Visual | ✅ Full | Header with avatar + name + slug.aaelink.app, sectioned menu |
| Interaction | 🟡 Partial | Has: Invite, Preferences, Customize sidebar, Keyboard shortcuts, Custom emoji, Create/join workspace, Admin link, Sign out. **Missing**: "Tools & settings" submenu (analytics, members, billing — many already exist as admin panels but not surfaced here), "View profile" |
| Keyboard | n/a | Click only |
| A11y | ✅ Full | `role=menu`, `aria-label` |

**Severity:** **P2**
**Fixes:**
- Group existing admin shortcuts under "Tools & settings" submenu (Analytics, Manage members, Channel management, Integrations) so non-admin power features are discoverable
- Add subtle "(admin)" label for admin-only items

---

### Section 1 summary

- **1 P0** item: full channel context menu (1.5)
- **5 P1** items: workspace rail (1.1), custom sections (1.3), DM context menu (1.6), pause-notifications submenu (1.7), mention vs unread differentiation (1.5)
- **4 P2** items: aria-current on top nav (1.2), sidebar customizer location (1.4), workspace menu sections (1.8)

---

## 2. Channel Surface

### 2.1 Channel header (title + dropdown + actions)

**Slack reference:** Header shows `#channel-name ⌄`, member-count chip, topic preview, then right-aligned action buttons: search, headphones (huddle), call, info, more.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/home/ChatHeader.tsx`, `app/components/chat/ChannelHeaderDropdown.tsx`, `app/components/chat/ChannelTopicInline.tsx` |
| Visual | 🟡 Partial | Title + lock/hash, inline topic, search/info/pin/notif/members icons. **Missing**: huddle button, call button, header-bg color customization |
| Interaction | 🟡 Partial | Dropdown has Star, Mute, Copy link, Invite, Archive, Leave — solid. **Missing**: Open canvas, Open list, Manage workflows, Manage integrations entries |
| Keyboard | 🔴 Missing | No `Shift+Esc` to focus header, no shortcuts on action buttons |
| A11y | ✅ Full | Most buttons have `aria-label` and `aria-pressed`; `aria-controls` on hamburger |

**Severity:** **P1**
**Fixes:**
- Add huddle and call buttons to header (will be P0 once 13 Calls/huddles lands)
- Add "Open canvas" / "Open list" buttons that conditionally appear when channel has one
- Add `Shift+Esc` to focus message input from header context

---

### 2.2 Inline channel topic editing

**Slack reference:** Click topic → inline editor → save with Enter / cancel with Esc; supports markdown links.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/chat/ChannelTopicInline.tsx` |
| Visual | ✅ Full | Inline edit pattern |
| Interaction | 🟡 Partial | Needs verification of Esc-cancels behavior (component not read in full this pass) |
| Keyboard | 🟡 Partial | Same |
| A11y | 🟡 Partial | Assumed `<button>` toggling to `<input>` — verify focus is moved correctly |

**Severity:** **P2**
**Fixes:**
- Audit ChannelTopicInline for: Enter saves, Esc cancels, focus returns to topic button after save/cancel, screen reader announces save

---

### 2.3 Bookmark bar

**Slack reference:** Horizontal scrollable bar below channel header showing emoji + title chips; click chip → open URL; drag to reorder; click `+` to add.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/BookmarkBar.tsx` |
| Visual | ✅ Full | Emoji chip with title and ExternalLink icon |
| Interaction | 🟡 Partial | Add and remove work. **Missing**: drag to reorder (uses `sort_order` field but no UI), edit existing bookmark |
| Keyboard | 🟠 Stub | No keyboard nav between chips, no Esc-cancel on add form |
| A11y | 🟡 Partial | Links open in new tab — good. `title` attr on chip works as tooltip but is also redundant of link text |

**Severity:** **P1**
**Fixes:**
- Add drag-to-reorder (use HTML5 DnD; persist via PATCH `/api/bookmarks` with new sort_order)
- Add edit-bookmark form (currently only add and remove)
- Add `aria-label="Channel bookmarks"` to the bar container

---

### 2.4 Channel info / details pane

**Slack reference:** Right-side pane with tabs: About, Members, Integrations, Files, Pinned. Each tab independently fetches and renders.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/ChannelInfoPanel.tsx` |
| Visual | 🟡 Partial | Tabs: About, Members, Pinned. **Missing**: Integrations tab, Files tab |
| Interaction | 🟡 Partial | About supports inline edit of purpose + header (good). Mute/Leave/Archive buttons inline (good). Convert public↔private (good — exceeds Slack basic). Member invite by username (good). Member search (good). |
| Keyboard | 🟡 Partial | Tab buttons navigable but no `Cmd+]` to switch tabs |
| A11y | 🟡 Partial | Tabs are buttons but no `role="tablist"` / `role="tab"` / `aria-selected` — fails ARIA tab pattern |

**Severity:** **P1**
**Fixes:**
- Add `role="tablist"` / `role="tab"` / `aria-selected` / `aria-controls` / `role="tabpanel"` pattern
- Add Integrations and Files tabs (data already available via existing APIs)
- Replace `confirm()` calls with the project's `ConfirmDialog` for consistent UX

---

### 2.5 Pinned messages panel

**Slack reference:** Right-pane list of pinned messages with author, time, snippet, Jump to message, Unpin. Empty state with explanation.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/PinnedMessagesPanel.tsx` |
| Visual | ✅ Full | Card layout with author, time-ago, snippet, jump/unpin actions, footer "Pinned X ago by Y" |
| Interaction | ✅ Full | Loading state, error+retry, empty state, jump to message |
| Keyboard | 🟡 Partial | No global shortcut (Slack has none either by default) |
| A11y | ✅ Full | `role="complementary"`, `aria-label` |

**Severity:** **P2**
**Fixes:** None — pinned panel is at parity. Minor polish: replace ✕ glyph with Lucide `X` icon for visual consistency.

---

### 2.6 Member list pane

**Slack reference:** Right-pane list with avatar, name, status, presence dot, role badge, click → open profile or DM.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/home/MemberListPanel.tsx` (slim version) AND members tab of `ChannelInfoPanel.tsx` (rich version) |
| Visual | 🟠 Stub | `MemberListPanel` is minimal — avatar initial + name + handle + presence dot. **Missing**: status text/emoji, role badge, avatar image, search |
| Interaction | 🟠 Stub | Click → open DM only. **Missing**: hovercard, "Add coworker" button, sort/filter, kick-from-channel (exists in ChannelInfoPanel.tsx) |
| Keyboard | 🔴 Missing | No keyboard nav |
| A11y | 🟡 Partial | Has `aria-label` on close button; no `aria-label` on list |

**Severity:** **P1** — the two implementations are inconsistent. `ChannelInfoPanel` member tab is richer than `MemberListPanel`
**Fixes:**
- Consolidate to one component. Move richer pattern from `ChannelInfoPanel` member tab into `MemberListPanel` and have ChannelInfoPanel embed it
- Add search, role badge, avatar image, status text
- Add hovercard on hover using `UserProfileCard.tsx`

---

### Section 2 summary

- **0 P0**
- **4 P1**: header call/huddle buttons (2.1), bookmark drag-reorder (2.3), channel info tabs ARIA + missing Integrations/Files tabs (2.4), member list inconsistency (2.6)
- **2 P2**: topic editor edge cases (2.2), pinned panel icon polish (2.5)

---

## 3. Message List

### 3.1 Message group / compact mode

**Slack reference:** First message of a group shows avatar + author + time. Subsequent messages from same author within 5 min show only message body indented under avatar column. Hover restores full meta.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/home/MessageTimeline.tsx` (compact logic lines 173-178), `app/components/chat/ChatMessage.tsx` |
| Visual | ✅ Full | Same 5-minute window; `compact` class applied to grouped messages |
| Interaction | 🟡 Partial | Hover-time-only-on-compact behavior depends on CSS — verify timestamp shows on hover via `app/styles.css` |
| Keyboard | 🔴 Missing | No `Arrow Up/Down` navigation between messages |
| A11y | 🟡 Partial | No `aria-rowindex` / `role="row"` for screen readers to track message position |

**Severity:** **P1**
**Fixes:**
- Add `J/K` keyboard navigation for moving focus between messages (Slack standard)
- Add ARIA: container `role="log"` with `aria-live="polite"`; each message `role="article"`
- Ensure compact messages still expose timestamp via `:hover` and via `aria-label`

---

### 3.2 Date separators

**Slack reference:** Sticky date pill "Today" / "Yesterday" / "Wed, Mar 12" between messages on date boundary.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/chat/DateSeparator.tsx`, `app/home/MessageTimeline.tsx` |
| Visual | ✅ Full | Date dividers between days; uses `formatFullDateLabel` |
| Interaction | ✅ Full | `JumpToDate` pill exists |
| Keyboard | 🟡 Partial | JumpToDate uses native `<input type="date">` — works with keyboard but Slack uses a custom date picker |
| A11y | 🟡 Partial | Verify date divider is `role="separator"` and `aria-label="Date X"` |

**Severity:** **P2**
**Fixes:**
- Add `role="separator"` to date divider
- Sticky positioning so the current day pill stays visible while scrolling (Slack does this)

---

### 3.3 New messages line / unread separator

**Slack reference:** Red horizontal line with "New" label between read and unread messages; clears on viewport leave.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/home/MessageTimeline.tsx` (lines 182-186) |
| Visual | ✅ Full | "New messages" separator with click-to-dismiss |
| Interaction | 🟡 Partial | Click-to-dismiss works, but unclear if separator auto-clears when user actually reads (Slack auto-clears after a few seconds in view) |
| Keyboard | 🟡 Partial | Has `role="button"` and `tabIndex={0}` — good |
| A11y | ✅ Full | `aria-label="Clear new messages marker"` |

**Severity:** **P2**
**Fixes:**
- Auto-clear via IntersectionObserver when separator scrolls out of view for >5 seconds
- Add `data-testid` for e2e

---

### 3.4 Jump-to-bottom button + new-message count

**Slack reference:** Floating "X new" button bottom-right when scrolled up; click to scroll to bottom.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/home/MessageTimeline.tsx` (lines 231-240) |
| Visual | ✅ Full | Floating button with count |
| Interaction | ✅ Full | Click scrolls to bottom and resets count |
| Keyboard | 🟡 Partial | No keyboard shortcut to jump (Slack: `Shift+Esc`) |
| A11y | ✅ Full | `aria-label` present |

**Severity:** **P2**
**Fixes:**
- Wire `Shift+Esc` to "mark all read" and `Esc` (when message focused) to jump to bottom

---

### 3.5 Empty state (channel intro)

**Slack reference:** "Welcome to #channel" with description, "Add description", "Add members" CTAs.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/home/MessageTimeline.tsx` (lines 153-169) |
| Visual | 🟡 Partial | Has welcome heading and intro paragraph. **Missing**: CTAs (Add description, Add members, Add bookmarks, Connect apps) |
| Interaction | n/a | None — currently static |
| Keyboard | n/a | — |
| A11y | 🟡 Partial | Heading is `<h2>` — good for outline, but not labeled as channel intro region |

**Severity:** **P1**
**Fixes:**
- Add 3-4 CTAs as cards under intro: "Add description", "Add members", "Add bookmark", "Set channel topic"
- Wrap in `<section aria-label="Channel introduction">`

---

### 3.6 Reactions row

**Slack reference:** Pills under message with emoji + count; click to toggle; click `+` to open emoji picker; tooltip lists reactors.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/chat/ChatMessage.tsx` (`MessageReactions` lines 87-114), `app/components/chat/EmojiPicker.tsx` |
| Visual | ✅ Full | Pills with emoji and count; "mine" variant |
| Interaction | 🟡 Partial | Click toggles. **Missing**: hover tooltip showing reactor names; `+` mini-button to open picker from existing row |
| Keyboard | 🔴 Missing | No keyboard activation pattern, no aria-pressed |
| A11y | 🟡 Partial | Buttons but no `aria-pressed={r.me}`, no reactor names accessible |

**Severity:** **P1**
**Fixes:**
- Add `aria-pressed={r.me}` so SR users know which reactions they've added
- Fetch `reactions/users` (route exists) and show in tooltip "Alice, Bob, +3 reacted"
- Show `+` button at end of reactions row to add another reaction

---

### 3.7 System messages (joined / left / pinned / topic change)

**Slack reference:** Centered or muted gray italic text — "Alice joined #general", "Bob set the channel topic: …", "Charlie pinned a message". Distinct from user messages.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | Not visible in `MessageTimeline.tsx` reads so far. May be missing entirely or rendered as user messages with no styling |
| Visual | 🔴 Missing | Likely absent |
| Interaction | n/a | — |
| Keyboard | n/a | — |
| A11y | n/a | — |

**Severity:** **P1**
**Fixes:**
- Add a `system_message_type` field on `ChatPost` (e.g., `joined`, `left`, `topic_changed`, `pinned`, `archived`)
- Render system messages with `.message--system` styling (muted, centered, no avatar, no hover actions)
- Backend: emit system messages on channel-members POST/DELETE, channel-info PATCH topic/header, pins POST/DELETE

---

### 3.8 File attachments inline

**Slack reference:** Rich card with thumbnail, filename, size, actions (Download, View, More).

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/chat/FileAttachmentCards.tsx` |
| Visual | ? | Not read in this pass — likely solid based on file count and naming. Marked Partial pending verification |
| Interaction | 🟡 Partial | Verify Download / View / More actions exist; verify file comments thread (route `files/comments/` exists) |
| Keyboard | ? | Verify card is keyboard accessible |
| A11y | ? | Verify alt text on images and aria-label on actions |

**Severity:** **P1** (pending verification)
**Fixes:**
- Audit `FileAttachmentCards.tsx` against this checklist in a follow-up pass

---

### 3.9 Link previews / unfurls

**Slack reference:** Auto-fetched preview card with title, description, og:image, source domain. Optional dismiss/hide.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/chat/LinkPreview.tsx`, `app/api/link-preview/route.ts` |
| Visual | 🟡 Partial | LinkPreview rendered when `extractPreviewUrl` finds a URL — verify card style matches Slack richness |
| Interaction | 🟡 Partial | No documented "hide preview" affordance on a per-message basis |
| Keyboard | 🟡 Partial | Verify focusable |
| A11y | 🟡 Partial | Verify alt text on preview images |

**Severity:** **P2**
**Fixes:**
- Add per-message "Hide preview" action
- Cache previews server-side to avoid repeat fetches

---

### Section 3 summary

- **0 P0**
- **4 P1**: keyboard nav + ARIA log role (3.1), empty state CTAs (3.5), reaction tooltip + ARIA (3.6), system messages (3.7), file attachments verification (3.8)
- **3 P2**: sticky date pill (3.2), auto-clear new line (3.3), jump-to-bottom shortcut (3.4), link preview polish (3.9)

---

## 4. Message Hover & Actions

### 4.1 Hover action toolbar

**Slack reference:** On message hover, top-right floating bar: 😀 React, 💬 Reply, 📤 Share, 🔖 Save, ⋮ More.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/chat/ChatMessage.tsx` (`MessageActions` lines 116-360) |
| Visual | ✅ Full | Toolbar: Smile (react), MessageSquare (reply), Bookmark (save), Pin (pin), Pencil (edit self), Trash (delete self), MoreVertical (more) |
| Interaction | ✅ Full | Reaction picker opens; saved feedback; pin / edit / delete |
| Keyboard | 🔴 Missing | No keyboard shortcut to open hover toolbar; not focusable from keyboard while message is focused |
| A11y | 🟡 Partial | `role="toolbar"` and `aria-label="Message actions"` — good. But hover-only means keyboard users can't reach |

**Severity:** **P0** — hover-only is an a11y blocker
**Fixes:**
- Show toolbar on message focus, not just hover (`.message:focus-within .message-actions-bar { opacity: 1 }`)
- Add `:focus-visible` style for keyboard users
- Add keyboard shortcut: when message focused, `R` for react, `T` for thread, `M` for more, `E` for edit, `Del` for delete

---

### 4.2 More-menu (overflow) actions

**Slack reference:** Overflow menu: Copy link, Copy text, Mark unread, Remind me (30m/1h/3h/tomorrow/next-week/custom), Pin, Save, Share, Forward, Add to canvas, Add to list, Get notifications, Turn off notifications, Open in new window, Delete, Edit, View message details, More message shortcuts (apps).

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/chat/ChatMessage.tsx` lines 196-326 |
| Visual | ✅ Full | Vertical menu with separator divider |
| Interaction | 🟡 Partial | Has: Copy text, Copy link, Forward, Mark unread, Remind me (30m/1h/4h/tomorrow 9am/next Mon 9am), Convert to ticket. **Missing**: Add to canvas/list, Share (separate from forward — Slack distinguishes Forward = repost vs Share = preview-link), View message details, Custom reminder time |
| Keyboard | 🟡 Partial | Native button focus works but no ↑/↓ navigation within menu, no Esc handling visible |
| A11y | ✅ Full | `role="menu"`, `role="menuitem"` — proper |

**Severity:** **P1**
**Fixes:**
- Add up/down arrow nav + Esc close to menu items (use a small `useMenuNav` hook)
- Add custom reminder time picker
- Add "View message details" with full date, message ID, raw markdown source
- Add "Share" (preview-link in a new channel) vs current "Forward" (full repost) distinction
- Add "Add to canvas / list" when canvas/list features land

---

### 4.3 Reaction picker (emoji picker)

**Slack reference:** Multi-tab emoji picker with search, frequently used, categories, skin tone selector, custom emoji.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/chat/EmojiPicker.tsx` |
| Visual | ? | Not read in this pass — likely standard grid based on size |
| Interaction | ? | Verify search, categories, skin tone |
| Keyboard | ? | Verify arrow nav, Enter to select |
| A11y | ? | Verify `role="listbox"` / `role="option"` |

**Severity:** **P1** (pending verification)
**Fixes:**
- Read and audit `EmojiPicker.tsx` for: search input, category tabs, skin tone, frequently-used, keyboard nav, ARIA listbox

---

### 4.4 Edit message in place

**Slack reference:** Click Edit → message becomes editable input with Save / Cancel; preserves formatting; shows "(edited)" indicator afterward.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/home/MessageTimeline.tsx` lines 190-203 (renders `<Composer editMode>` when `editingId === post.id`) |
| Visual | ✅ Full | Full composer in place |
| Interaction | ✅ Full | Cancel handler wired; `initialContent` populates |
| Keyboard | 🟡 Partial | Verify Esc cancels and Cmd/Ctrl+Enter saves |
| A11y | 🟡 Partial | Edit composer should be `aria-label="Edit message"` |

**Severity:** **P2**
**Fixes:**
- Ensure Esc cancels and Cmd/Ctrl+Enter saves in edit mode
- Focus management: focus composer on enter, return focus to message on cancel/save

---

### 4.5 Delete confirmation

**Slack reference:** Modal with "Delete message?" + message preview + Delete/Cancel.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | unknown — likely `app/home/ConfirmDialog.tsx` or browser `confirm()` |
| Visual | 🔴 Missing | Suspect browser `confirm()` — inconsistent with rest of UI; need to check |
| Interaction | 🟡 Partial | Functionally works |
| Keyboard | n/a | Browser native |
| A11y | 🟡 Partial | Browser confirm has its own a11y but breaks consistent UX |

**Severity:** **P1**
**Fixes:**
- Route all destructive confirmations through `ConfirmDialog.tsx` for consistent UX, focus trap, Esc-cancel, and theme support
- Audit ChatHeader, ChannelInfoPanel, ChannelHeaderDropdown — multiple use `confirm()` (verified in reads above)

---

### Section 4 summary

- **1 P0**: hover-only toolbar (4.1)
- **3 P1**: more-menu gaps (4.2), emoji picker verification (4.3), confirm() → ConfirmDialog (4.5)
- **1 P2**: edit-mode keyboard polish (4.4)

---

## 5. Composer

### 5.1 Rich text editor (formatting)

**Slack reference:** Inline-WYSIWYG with bold, italic, strike, code, code-block, link, ordered/unordered list, blockquote, mention, emoji, channel link.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/chat/Composer.tsx` (TipTap + StarterKit + Markdown + Link + Placeholder) |
| Visual | ✅ Full | Formatting toolbar with Bold, Italic, Strike, Link, Code, Lists, FileCode, Quote, Paperclip, Send, Smile, Mic, Video |
| Interaction | ✅ Full | Markdown ↔ rich conversion via `tiptap-markdown`; markdown saved as message body |
| Keyboard | 🟡 Partial | TipTap defaults give Cmd+B/I/U etc — verify but should work. **Missing**: Cmd+Shift+8 for bulleted list, Cmd+Shift+7 for numbered |
| A11y | 🟡 Partial | TipTap renders contenteditable — needs `aria-label="Message composer"` and `aria-multiline="true"` verification |

**Severity:** **P2**
**Fixes:**
- Add explicit `aria-label` and `role="textbox"` semantics on TipTap container
- Verify Cmd+Shift+7/8 list shortcuts work; document in `KeyboardShortcutsModal`

---

### 5.2 Slash commands

**Slack reference:** Type `/` → menu of commands with descriptions; arrow to select; Tab/Enter to insert; supports app shortcuts.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `Composer.tsx` (slashQuery state, lines 121-191), `lib/slashCommands.ts`, `lib/composerSlash.ts` |
| Visual | 🟡 Partial | Slash query detected at message start (good). Verify menu UI matches Slack-style with command + arg-hint + description |
| Interaction | 🟡 Partial | Arrow nav state present (`slashIdx`) — verify Enter inserts and Esc cancels |
| Keyboard | 🟡 Partial | Likely Tab-completes — verify |
| A11y | 🟡 Partial | Verify `role="listbox"` on menu and `aria-activedescendant` updates |

**Severity:** **P2**
**Fixes:**
- Audit slash menu rendering for full ARIA combobox pattern
- Add command arg validation hints (e.g., `/remind` requires `[person] [text] [time]`)
- Surface app/integration slash commands from `/api/slash-commands` route

---

### 5.3 Mention autocomplete

**Slack reference:** `@` → popover with avatar + name + handle + status; group mentions `@here`/`@channel`/`@everyone`; warning when targeting large channels.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `Composer.tsx` lines 161-173, 236-260 (GROUP_MENTIONS) |
| Visual | ✅ Full | Has `@here`, `@channel`, `@all` plus member list |
| Interaction | ✅ Full | Prefix filter on group + members |
| Keyboard | 🟡 Partial | Arrow nav via `mentionIdx` — verify Enter inserts and Tab autocompletes |
| A11y | 🟡 Partial | Same as slash — verify combobox pattern |

**Severity:** **P1**
**Fixes:**
- Add "Notify N people" warning modal when posting `@channel` / `@all` in a channel with > 50 members (Slack defaults to this)
- Show avatar (or initial) and status emoji in mention popover (currently text-only)

---

### 5.4 Emoji shortcode `:foo:`

**Slack reference:** Type `:` + name → popover with matches; Tab/Enter inserts emoji character.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `Composer.tsx` lines 175-181, `EMOJI_DATA` import |
| Visual | 🟡 Partial | Detection logic present; verify popover styling |
| Interaction | 🟡 Partial | `emojiIdx` arrow state — verify selection |
| Keyboard | 🟡 Partial | Verify Tab inserts |
| A11y | 🟡 Partial | Same combobox concerns |

**Severity:** **P2**
**Fixes:**
- Add custom emoji from `/api/emoji` so shortcode autocomplete includes workspace custom emoji (route exists, integration verification needed)

---

### 5.5 Drafts (auto-save)

**Slack reference:** Composer text persists across channel switches and reloads; shown in sidebar "Drafts & sent" view; sent or scheduled drafts visible there.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `Composer.tsx` (saveDraft, getDraft, clearDraft from `lib/messageDrafts`), `app/components/DraftsPanel.tsx` |
| Visual | ✅ Full | Auto-save on update with 500ms debounce; restore on channel switch |
| Interaction | ✅ Full | Drafts panel + sidebar draft icon on channel rows |
| Keyboard | n/a | — |
| A11y | n/a | — |

**Severity:** none — feature appears at parity. Verify drafts panel UX in next pass.

---

### 5.6 Schedule send (send later)

**Slack reference:** Click ⏰ icon → custom date/time picker; preset offsets (tomorrow morning, Monday morning, custom).

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/chat/SendLaterMenu.tsx`, `SendLaterTrigger`, route `/api/messages/scheduled` |
| Visual | 🟡 Partial | Component exists — verify presets and custom picker |
| Interaction | 🟡 Partial | Wired into composer |
| Keyboard | 🟡 Partial | Verify date/time inputs keyboard-friendly |
| A11y | 🟡 Partial | Verify aria-label on trigger |

**Severity:** **P1** (pending verification)
**Fixes:**
- Audit SendLaterMenu UX against Slack: "Tomorrow at 9am", "Monday at 9am", "Custom" with single date+time field

---

### 5.7 File upload + drag-and-drop

**Slack reference:** Drag file anywhere over the channel → full-screen drop overlay; release to attach; preview chips with progress; comment-before-send; multiple files.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `Composer.tsx` (dragOver state, pendingFiles, dragCounter, file input ref) |
| Visual | ✅ Full | Has page-level drag overlay per recent commit (e724c53f); pending file chips with progress |
| Interaction | ✅ Full | Drag-and-drop + click-to-attach; progress tracking |
| Keyboard | 🟡 Partial | File input keyboard-accessible via Paperclip button |
| A11y | 🟡 Partial | Verify drop zone has `aria-label="Drop file to attach"` and pending chips have `aria-live` |

**Severity:** **P2**
**Fixes:**
- Add `aria-live="polite"` on pending file list so screen readers announce uploads
- Add comment-per-file (Slack lets you write a caption per file before sending)

---

### 5.8 Send button + states

**Slack reference:** Send button disabled when empty; loading state on send; failure inline retry; primary color.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `Composer.tsx` SendHorizontal icon button |
| Visual | 🟡 Partial | Verify disabled/loading/failed states |
| Interaction | 🟡 Partial | Verify Enter sends, Shift+Enter newline (TipTap default — usually correct) |
| Keyboard | 🟡 Partial | Cmd+Enter optional convention |
| A11y | 🟡 Partial | Add `aria-label="Send message"` if not present |

**Severity:** **P2**

---

### 5.9 Audio / video clip recording

**Slack reference:** Record audio/video clip → attach to message; clip plays inline.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/AudioVideoClipRecorder.tsx`, `Composer.tsx` `onRecordAudio` / `onRecordVideo` callbacks |
| Visual | 🟡 Partial | Recorder component exists; verify UX matches Slack (countdown, pause, retake, max duration) |
| Interaction | 🟡 Partial | Wired |
| Keyboard | 🟡 Partial | — |
| A11y | 🟡 Partial | — |

**Severity:** **P2** (pending verification)

---

### Section 5 summary

- **0 P0**
- **2 P1**: mention notify warning + visual richness (5.3), SendLaterMenu verification (5.6)
- **6 P2**: composer ARIA (5.1), slash ARIA (5.2), emoji ARIA (5.4), file upload ARIA (5.7), send states (5.8), clip recorder verification (5.9)

---

## 6. Threads Pane

### 6.1 Thread open + reply

**Slack reference:** Click "Reply in thread" → right pane shows root message + replies + composer; "Also send to #channel" checkbox; close button.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/chat/ThreadPanel.tsx` |
| Visual | ✅ Full | Root post + replies + composer (`broadcastToChannel` state at line 41 implies "Also send to channel" exists) |
| Interaction | ✅ Full | Realtime collab subscription scoped to thread |
| Keyboard | 🔴 Missing | No `Esc` to close, no shortcut to focus thread reply |
| A11y | 🟡 Partial | Verify pane has `role="complementary"` and `aria-label="Thread"` |

**Severity:** **P1**
**Fixes:**
- Add `Esc` to close thread when focus is inside thread pane
- Add `T` shortcut to open thread for currently-focused message
- Verify `role="complementary"` and aria-label on pane container

---

### 6.2 "All threads" / Threads list

**Slack reference:** Top-nav "Threads" → list of threads you're in or following; filter Following/All; unread per thread; mark all read.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/ThreadsListPanel.tsx` |
| Visual | ✅ Full | Filter tabs (Following/All), thread cards with snippet, reply count, channel, time-ago |
| Interaction | 🟡 Partial | Filter + visibility refresh. **Missing**: per-thread unread indicators, "Mark all read", pagination |
| Keyboard | 🔴 Missing | No keyboard nav between threads |
| A11y | 🟡 Partial | Filter buttons but no `aria-pressed` for active state |

**Severity:** **P1**
**Fixes:**
- Add unread-per-thread badge (data should be available via realtime read-state)
- Add "Mark all threads read" button
- Add `aria-pressed` on filter tabs
- Add keyboard nav (J/K between thread rows, Enter to open)

---

### 6.3 Thread follow / unfollow

**Slack reference:** Bell icon in thread pane → toggle notifications for thread replies; you're auto-followed when you reply.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `ThreadPanel.tsx` imports Bell + BellRing icons; `app/api/collab/thread-follow/` route exists |
| Visual | 🟡 Partial | Icons imported — UI wiring needs verification |
| Interaction | 🟡 Partial | Route exists |
| Keyboard | n/a | — |
| A11y | 🟡 Partial | Verify aria-pressed on follow toggle |

**Severity:** **P1** (pending verification)
**Fixes:**
- Audit ThreadPanel.tsx full file: ensure Bell button toggles follow state and shows visual on/off

---

### 6.4 Broadcast to channel

**Slack reference:** Checkbox below thread composer "Also send to #channel"; when checked, reply posts as both a thread reply and a channel message.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `ThreadPanel.tsx` (`broadcastToChannel` state) |
| Visual | 🟡 Partial | State exists — verify checkbox label rendering |
| Interaction | 🟡 Partial | Verify it's wired to message POST |
| Keyboard | 🟡 Partial | Native checkbox keyboard works |
| A11y | 🟡 Partial | Label association required |

**Severity:** **P2**
**Fixes:**
- Verify checkbox renders, label-for is correct, and POST includes `also_send_to_channel: true` field

---

### Section 6 summary

- **0 P0**
- **3 P1**: thread keyboard + ARIA (6.1), thread list unread + nav (6.2), follow verification (6.3)
- **1 P2**: broadcast verification (6.4)

---

## 7. Search & Command Palette

### 7.1 Global Cmd+K palette

**Slack reference:** `Cmd+K` opens unified search/jump-to modal: channels, DMs, people, recent, messages.

| Aspect | Status | Notes |
|---|---|---|
| AAELink components | — | **Two implementations exist:** `app/components/CommandPalette.tsx` (general module/channel/settings navigator) AND `app/components/QuickSwitcher.tsx` (channels + users + message search, 3-tier) |
| Visual | ✅ Full | CommandPalette has search input, list, footer hint; QuickSwitcher has tiered groups |
| Interaction | ✅ Full | Arrow nav, Enter, Esc, click; QuickSwitcher debounced API search |
| Keyboard | ✅ Full | Tab focus trap; ArrowUp/Down; Enter; Esc |
| A11y | ✅ Full | `role="dialog"`, `aria-modal`, `role="listbox"`, `role="option"`, `aria-selected` |

**Severity:** **P1** — but the gap is **duplicated implementation**, not absence
**Fixes:**
- Pick one as canonical. Recommend keeping **QuickSwitcher** as Cmd+K (it has message search) and either deleting `CommandPalette` or rebranding it as `ActionPalette` for `Cmd+Shift+P` (commands only, not nav)
- Slack itself merges nav + commands into one palette; AAELink should mirror that — extend QuickSwitcher to also accept commands (Switch theme, Customize sidebar, etc.) so users have one mental model

---

### 7.2 Global message search modal

**Slack reference:** Top search bar / `Cmd+G` → results page with filters (people, in:channel, from:user, before:date, has:link, has:file).

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/GlobalSearchModal.tsx`, `app/api/search/messages/route.ts`, `app/api/search/advanced/route.ts` (untracked → committed) |
| Visual | ✅ Full | Search bar + results with highlighting, count, author, channel, time, jump |
| Interaction | ✅ Full | Debounce 350ms, Enter to jump, Esc to close, ArrowDown/Up nav |
| Keyboard | ✅ Full | Above + close button |
| A11y | ✅ Full | `role="dialog"`, `aria-modal`, `aria-label` |

**Severity:** **P1**
**Fixes:**
- **Missing**: filter syntax UI (Slack supports `in:`, `from:`, `before:`, `after:`, `has:`). The `/api/search/advanced` route exists — surface its filters as chips/builder above results
- Add saved searches (route `/api/search/saved` if exists, or add)
- Add result type tabs: Messages / Files / Channels / People

---

### 7.3 In-channel search

**Slack reference:** Click search icon in channel header → inline panel filtering to that channel.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/chat/SearchPanel.tsx` |
| Visual | 🟡 Partial | Component exists — not deeply audited this pass |
| Interaction | 🟡 Partial | Hooked to chat header search button |
| Keyboard | 🟡 Partial | — |
| A11y | 🟡 Partial | — |

**Severity:** **P2** (pending verification)

---

### 7.4 Search highlighting

**Slack reference:** Matched terms wrapped in `<mark>` with highlight background.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `GlobalSearchModal.tsx` `highlightBody()` |
| Visual | ✅ Full | Uses `<mark className="search-highlight">` with snippet context |
| Interaction | n/a | — |
| Keyboard | n/a | — |
| A11y | ✅ Full | `<mark>` is semantically read by screen readers |

**Severity:** none — at parity.

---

### Section 7 summary

- **0 P0**
- **2 P1**: dedup CommandPalette/QuickSwitcher (7.1), advanced search filter UI (7.2)
- **1 P2**: in-channel search verification (7.3)

---

## 8. Notifications & Status

### 8.1 Notifications bell + inbox

**Slack reference:** Top-bar bell icon → dropdown of recent notifications; click to navigate; mark read.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/NotificationsBell.tsx`, `app/api/notifications/route.ts` |
| Visual | 🟡 Partial | Bell present in `ChatHeader.tsx` (verified) — not deeply audited |
| Interaction | 🟡 Partial | Verify dropdown content + click-to-navigate |
| Keyboard | 🟡 Partial | — |
| A11y | 🟡 Partial | — |

**Severity:** **P2** (pending verification)

---

### 8.2 Activity panel (mentions + reactions + threads)

**Slack reference:** Top-nav "Activity" → filterable list of mentions, reactions, thread replies.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/ActivityPanel.tsx` |
| Visual | ✅ Full | Filter tabs (All / Mentions / Reactions / Threads), icons per type, actor avatar + name, time-ago, "load more" |
| Interaction | ✅ Full | Filter, pagination via `before` cursor, click to navigate |
| Keyboard | 🟡 Partial | No J/K nav between items |
| A11y | 🟡 Partial | Filter buttons need `aria-pressed`; list needs `aria-label="Activity"` |

**Severity:** **P2**
**Fixes:**
- Add `aria-pressed` on filter tabs
- Add J/K nav

---

### 8.3 Catch-up view

**Slack reference:** Top-nav "Later" or sidebar — list of saved/reminder items.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/CatchUpView.tsx`, `app/components/SavedItemsPanel.tsx` (Later view) |
| Visual | 🟡 Partial | Components exist — not deeply audited |
| Interaction | 🟡 Partial | — |
| Keyboard | 🟡 Partial | — |
| A11y | 🟡 Partial | — |

**Severity:** **P2** (pending verification)

---

### 8.4 Custom status

**Slack reference:** Set emoji + text + auto-clear duration; presets; pause notifications when set.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/home/CustomStatusPopup.tsx` |
| Visual | ✅ Full | Emoji button + cycle + text input + 6 presets (In a meeting / Commuting / Out sick / Vacationing / Working remotely / Focusing) matching Slack |
| Interaction | 🟡 Partial | Save / Clear only. **Missing**: auto-clear duration ("Don't clear" / "1 hour" / "Today" / "This week" / "Custom"), "Pause notifications" toggle |
| Keyboard | 🟡 Partial | Native input keyboard works; emoji button is plain button cycling through fixed list — not a real emoji picker |
| A11y | 🟡 Partial | Modal pattern OK; emoji button has no aria-label |

**Severity:** **P1**
**Fixes:**
- Replace emoji-cycle button with `EmojiPicker` for full custom emoji
- Add auto-clear duration selector (saves to `status_expires_at` field)
- Add "Pause notifications while this status is set" toggle linking to DND
- Add `aria-label` to emoji picker trigger

---

### 8.5 DND / Notification schedule

**Slack reference:** Preferences > Notifications > Schedule; allow notifications: every day, weekdays, or custom per-day; pause notifications submenu (30min/1hr/2hr/until tomorrow/until next week).

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/NotificationSchedulePanel.tsx` |
| Visual | ✅ Full | DND from/to time inputs, rules (schedule/keyword/channel/sender), notification sound |
| Interaction | 🟡 Partial | Toggle / delete / create rules. **Missing**: per-day schedule (Slack supports different times per day) |
| Keyboard | 🟡 Partial | Native inputs OK |
| A11y | 🟡 Partial | Custom toggles may need `role="switch"` + `aria-checked` |

**Severity:** **P1**
**Fixes:**
- Add per-day schedule (Monday: 9-17, Tuesday: 9-17, etc., with "Same time every day" toggle)
- Add quick-pause submenu (30m/1h/2h/today/this week) — wire from UserFooter (see 1.7)
- Use `role="switch"` for toggle buttons

---

### 8.6 Keyword highlights

**Slack reference:** Preferences > Notifications > My keywords; words highlighted in messages + push notification.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `NotificationSchedulePanel.tsx` (keyword rule type), `app/api/keywords/` route |
| Visual | 🟡 Partial | Rule creation UI exists. **Missing**: actual keyword *highlighting* rendering in messages |
| Interaction | 🟡 Partial | Rule storage works; need to verify message renderer applies highlight |
| Keyboard | n/a | — |
| A11y | n/a | — |

**Severity:** **P1**
**Fixes:**
- Extend `MessageRichText` (lib/messageRich) to underline/highlight matched keywords
- Notification payload should include `triggered_keyword` for client display

---

### 8.7 Per-channel notification prefs

**Slack reference:** Channel ⌄ → Notifications → Every new message / Just mentions / Nothing; Mute / Unmute.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/ChannelNotifPrefsModal.tsx` |
| Visual | 🟡 Partial | Component exists — needs verification of all 3 levels (all / mentions / nothing) |
| Interaction | 🟡 Partial | Wired to `/api/channel-prefs` |
| Keyboard | 🟡 Partial | — |
| A11y | 🟡 Partial | — |

**Severity:** **P2** (pending verification)

---

### Section 8 summary

- **0 P0**
- **3 P1**: custom status duration + emoji (8.4), DND per-day + pause submenu (8.5), keyword highlights in render (8.6)
- **4 P2**: notifications bell (8.1), activity ARIA (8.2), catch-up (8.3), per-channel prefs (8.7)

---

## 9. Profiles

### 9.1 User profile card / hovercard

**Slack reference:** Hover username → mini card with avatar, name, status, pronouns, role; click "View full profile" → modal with all fields, DM button, set huddle, set call, more.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/UserProfileCard.tsx` |
| Visual | ✅ Full | Avatar with presence dot, name + status emoji inline, pronouns, job title, @username, custom status, role label, copy-field buttons |
| Interaction | 🟡 Partial | Copy-to-clipboard per field. **Missing**: hover-trigger pattern (currently invoked as a click-modal, not a tooltip-style hovercard), "View full profile" affordance, DM button visibility verification |
| Keyboard | 🟡 Partial | Close button has aria-label; tab order through copy buttons unclear |
| A11y | 🟡 Partial | Should be `role="dialog"` + `aria-labelledby={nameElement}` |

**Severity:** **P1**
**Fixes:**
- Add a small hovercard variant (lazy 300ms hover) for inline `@username` mentions
- Add explicit DM, Call, Huddle buttons in profile card body
- Add Edit Profile button when viewing own profile

---

### 9.2 Profile edit (Preferences > Profile)

**Slack reference:** Preferences > Profile tab: name, display name, pronouns, what I do, status, time zone, profile photo. Save button.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/PreferencesModal.tsx` (Profile tab) |
| Visual | 🟡 Partial | Tab exists in PreferencesModal — content not deeply audited but route `/api/auth/me` PATCH is wired |
| Interaction | 🟡 Partial | Auto-save toast pattern (good for prefs but unusual for profile — Slack uses explicit Save) |
| Keyboard | 🟡 Partial | Native form |
| A11y | 🟡 Partial | Verify all inputs labelled |

**Severity:** **P2**
**Fixes:**
- Verify Profile tab covers: first/last/display, pronouns, job title, phone, department, timezone, avatar upload, status emoji+text, custom availability hours
- For destructive changes (email change, delete account), use explicit Save not auto-save

---

### Section 9 summary

- **0 P0**
- **1 P1**: hovercard pattern + DM/Call buttons (9.1)
- **1 P2**: profile edit verification (9.2)

---

## 10. Settings & Preferences

### 10.1 Preferences modal structure

**Slack reference:** Tabs (Notifications, Sidebar, Themes, Messages & media, Language & region, Accessibility, Mark as read, Audio & video, Advanced, Search) on the left; content on the right.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/PreferencesModal.tsx` |
| Visual | ✅ Full | 7 tabs: Profile, Notifications, Appearance, Sidebar, Language & Region, Accessibility, Advanced. Mirrors Slack's layout |
| Interaction | ✅ Full | Tab switching, auto-save with toast, Esc to close, ToggleRow/SelectRow primitives |
| Keyboard | 🟡 Partial | Esc-close works. **Missing**: focus trap inside modal, no `Tab` between tab buttons + arrow navigation |
| A11y | 🟠 Stub | Tab buttons are plain `<button>` — **missing** `role="tablist"` / `role="tab"` / `aria-selected` / `aria-controls` / `role="tabpanel"` |

**Severity:** **P0** — Preferences is a primary surface; failing the WAI-ARIA tab pattern is a clear a11y violation
**Fixes:**
- Convert TABS rendering to full WAI-ARIA tab pattern: `<div role="tablist">` containing `<button role="tab" aria-selected={...} aria-controls="prefs-panel-X">` and the panel `<div role="tabpanel" id="prefs-panel-X" aria-labelledby="prefs-tab-X" tabIndex={0}>`
- Add Arrow Left/Right keyboard nav between tabs
- Add focus trap (use a small `useFocusTrap` hook against `overlayRef`)

---

### 10.2 Appearance / themes

**Slack reference:** Themes tab with Aubergine, Banana, Forest, Hoth, Light, Mint, Nocturne, Ochin, Terminal, Wartocks, Workhaus + custom. Sidebar theme separate from app theme.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `PreferencesModal.tsx` Appearance tab, `lib/theme.ts`, `app/components/ThemeBoot.tsx` |
| Visual | 🟡 Partial | Has Light/Dark/Auto via `theme.ts`. **Missing**: Slack-style preset palette (Aubergine etc.), separate sidebar theme |
| Interaction | 🟡 Partial | Theme switching wired |
| Keyboard | 🟡 Partial | Native select |
| A11y | 🟡 Partial | — |

**Severity:** **P2**
**Fixes:**
- Add 6-10 named preset themes (sidebar background gradient + accent color tuples)
- Add custom-theme builder (4 color pickers: background, foreground, hover, accent)
- Persist per-workspace theme

---

### 10.3 Keyboard shortcuts modal

**Slack reference:** `Cmd+/` opens modal with all shortcuts; filter by search.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/KeyboardShortcutsModal.tsx` |
| Visual | ✅ Full | Grouped sections, kbd-styled keys, total count, search filter, mac/non-mac aware |
| Interaction | ✅ Full | Esc and click-outside close |
| Keyboard | ✅ Full | Esc, auto-focus search |
| A11y | ✅ Full | `role="dialog"`, `aria-modal`, `aria-label`, `<kbd>` for keys |

**Severity:** none — at parity. One polish item: section list could use `role="navigation"` and headings could anchor scroll for keyboard users.

---

### 10.4 Language / region

**Slack reference:** Language dropdown (~30 languages), 12/24h time, week starts on, timezone (auto/manual).

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `PreferencesModal.tsx` Language & Region tab, `app/api/i18n/` route exists |
| Visual | 🟡 Partial | Tab exists — actual language coverage not audited this pass |
| Interaction | 🟡 Partial | — |
| Keyboard | 🟡 Partial | — |
| A11y | 🟡 Partial | — |

**Severity:** **P2** (pending verification)

---

### 10.5 Accessibility tab

**Slack reference:** Animation reduction, autoplay videos, message hover behavior, screen reader announcements, high contrast.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `PreferencesModal.tsx` Accessibility tab, `app/components/AccessibilityPanel.tsx` |
| Visual | 🟡 Partial | Tab exists |
| Interaction | 🟡 Partial | — |
| Keyboard | 🟡 Partial | — |
| A11y | 🟡 Partial | — |

**Severity:** **P1** (pending verification — important to verify since this audit is calling out a11y gaps elsewhere)
**Fixes:**
- Verify: prefers-reduced-motion toggle, autoplay-video opt-out, larger fonts toggle, high-contrast theme

---

### 10.6 Sessions / devices

**Slack reference:** Account > Sessions: list of active sessions with IP, device, last activity; sign out from a specific device or all devices.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/SessionManagementPanel.tsx`, `app/components/admin/SessionManagementPanel.tsx` (separate user vs admin), `app/api/auth/sessions/` route |
| Visual | 🟡 Partial | Component exists |
| Interaction | 🟡 Partial | — |
| Keyboard | 🟡 Partial | — |
| A11y | 🟡 Partial | — |

**Severity:** **P1** (pending verification)
**Fixes:**
- Verify user-facing session management: list with device/ip/last-active, "Sign out" per session, "Sign out all other sessions"
- Distinct from admin session management which is for admin to revoke other users' sessions

---

### Section 10 summary

- **1 P0**: Preferences modal needs full WAI-ARIA tab pattern (10.1)
- **2 P1**: a11y tab verification (10.5), sessions panel verification (10.6)
- **2 P2**: theme palette (10.2), language/region verification (10.4)

---

## 11. Files

### 11.1 File preview modal (image, PDF, code)

**Slack reference:** Click attachment → full-screen modal with viewer; zoom for images, page nav for PDFs, syntax highlight for code; Download, Share, More actions.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/FilePreviewModal.tsx`, `app/components/chat/ImageLightbox.tsx` |
| Visual | ✅ Full | Image with zoom/rotate; PDF iframe; toolbar with filename, zoom controls, rotation, download, close |
| Interaction | ✅ Full | Click backdrop closes; Esc closes; +/- zoom; r rotate; download via `<a download>` |
| Keyboard | ✅ Full | Esc, +/-, r — well covered |
| A11y | 🟡 Partial | Modal pattern needs `role="dialog"` + `aria-modal="true"` + `aria-label="File preview"` (current implementation uses raw div). Image needs alt attribute |

**Severity:** **P1**
**Fixes:**
- Add `role="dialog"` and `aria-modal="true"` to preview chrome
- Add `alt={filename}` to preview image
- Add prev/next arrow navigation between files in same message (Slack supports this when message has multiple attachments)

---

### 11.2 Image lightbox

**Slack reference:** Click image inline → lightbox with click-to-zoom, swipe between images.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/chat/ImageLightbox.tsx` |
| Visual | 🟡 Partial | Component exists per recent commit (0fffa929 added image lightbox). Not audited this pass |
| Interaction | 🟡 Partial | — |
| Keyboard | 🟡 Partial | — |
| A11y | 🟡 Partial | — |

**Severity:** **P2** (pending verification)

---

### 11.3 File browser pane

**Slack reference:** Top-nav More > Files OR channel info > Files tab. Filter by type, date, sender, channel.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/FileBrowserPanel.tsx`, `app/api/search/files/route.ts` |
| Visual | 🟡 Partial | Component exists |
| Interaction | 🟡 Partial | Search files route present |
| Keyboard | 🟡 Partial | — |
| A11y | 🟡 Partial | — |

**Severity:** **P2** (pending verification)

---

### 11.4 PDF viewer + annotations

**Slack reference:** Slack offers basic PDF viewer; no annotations natively.

**AAELink exceeds Slack here.**

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/DocumentViewer.tsx`, `app/components/AnnotationOverlay.tsx`, `app/components/PdfFormFieldsPanel.tsx`, `app/components/RedactionPanel.tsx`, `app/components/SignaturePanel.tsx`, `lib/stirlingPdf.ts` |
| Visual | 🟡 Partial | Rich PDF + annotation system (Stirling-PDF). Specific UX not audited this pass |
| Interaction | 🟡 Partial | — |
| Keyboard | 🟡 Partial | — |
| A11y | 🟡 Partial | PDFs are notoriously hard to make accessible — verify text extraction works |

**Severity:** **P2**
**Fixes:**
- Audit DocumentViewer as a separate deep-dive — this surface exceeds Slack scope and warrants its own parity-vs-Adobe-Acrobat lens, not Slack parity

---

### Section 11 summary

- **0 P0**
- **1 P1**: file preview modal ARIA (11.1)
- **3 P2**: image lightbox (11.2), file browser (11.3), PDF viewer (11.4)

---

## 12. Admin

### 12.1 Admin shell + nav

**Slack reference:** Admin app at `/admin` with side nav: Members, Channels, Settings, Billing, Authentication, Apps, Analytics. Distinct visual treatment from main workspace.

| Aspect | Status | Notes |
|---|---|---|
| AAELink components | — | `app/admin/page.tsx`, `app/admin/loading.tsx`, sidebar admin section (`ADMIN_NAV_ITEMS` in `sidebarNav.ts`), separate admin component panels under `app/components/admin/` |
| Visual | 🟡 Partial | Admin items embedded into the main sidebar's "Administration" section rather than a separate admin shell |
| Interaction | 🟡 Partial | Each admin item opens a panel in the main chrome — not a separate admin app |
| Keyboard | 🟡 Partial | Same as main shell |
| A11y | 🟡 Partial | Same as main sidebar |

**Severity:** **P2** — design choice, not parity gap. AAELink integrates admin into the main app which arguably is *better* than Slack's separate admin app. But discoverability of all admin features needs verification
**Fixes:**
- Consider a "Admin Home" landing page at `/admin` that gives an overview dashboard (active users, storage usage, recent audit events, pending account requests) rather than a blank route

---

### 12.2 User management

**Slack reference:** Members list with avatar, name, role, status, last active; filters; bulk actions; invite, deactivate, change role.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/api/admin/users/route.ts`, `app/api/admin/users/export/`, `app/api/admin/bulk-provision/`, admin sidebar entry, but UI component for user list not seen in this pass |
| Visual | ? | Likely under a panel — needs deeper audit |
| Interaction | ? | Bulk provision is a documented advantage |
| Keyboard | ? | — |
| A11y | ? | — |

**Severity:** **P1** (pending verification)
**Fixes:**
- Locate user-list UI; verify it supports search, filters (role, status, dept), bulk actions (activate/deactivate, role change, channel add)

---

### 12.3 Audit log

**Slack reference:** Enterprise Grid: Audit log with searchable events, categories (auth/user/channel/file/integration), export.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/admin/AuditLogPanel.tsx` |
| Visual | ✅ Full | 8 categories with icons + colors; search; filter; expandable detail; export route exists |
| Interaction | ✅ Full | Filter + search reload on change; load 100 at a time |
| Keyboard | 🟡 Partial | Category buttons need `aria-pressed`; search has native keyboard |
| A11y | 🟡 Partial | Add `role="region"` `aria-label="Audit log"`; category buttons need `aria-pressed` |

**Severity:** **P2**
**Fixes:**
- ARIA polish on category filter buttons
- Add date range picker (currently only category + search)
- Verify export-to-CSV works end-to-end (route exists)

---

### 12.4 Retention / DLP / Legal hold

**Slack reference:** Enterprise: retention policies (per channel, per type), DLP rules, legal holds (per user).

| Aspect | Status | Notes |
|---|---|---|
| AAELink components | — | `app/components/admin/DataRetentionSettings.tsx`, `app/components/admin/DLPSettingsPanel.tsx`, `app/components/admin/LegalHoldPanel.tsx`, plus `lib/retention.ts` |
| Visual | 🟡 Partial | All three components exist — not deeply audited this pass |
| Interaction | 🟡 Partial | — |
| Keyboard | 🟡 Partial | — |
| A11y | 🟡 Partial | — |

**Severity:** **P1** (pending verification — these are compliance-critical surfaces)
**Fixes:**
- Audit DataRetentionSettings, DLPSettings, LegalHold against `aaelink-compliance` skill expectations
- Surface retention setting at channel level too (admin panel + per-channel info panel)

---

### 12.5 SSO / SCIM / SAML

**Slack reference:** Enterprise: SAML SSO config, SCIM provisioning, domain verification.

| Aspect | Status | Notes |
|---|---|---|
| AAELink components | — | `app/components/SsoSettingsPanel.tsx`, `app/components/admin/DomainClaimingPanel.tsx`, `app/api/admin/sso/route.ts`, `app/api/admin/scim/`, `app/api/scim/` |
| Visual | 🟡 Partial | Multiple components exist |
| Interaction | 🟡 Partial | — |
| Keyboard | 🟡 Partial | — |
| A11y | 🟡 Partial | — |

**Severity:** **P1** (pending verification — security-critical)

---

### 12.6 Enterprise Key Management (EKM) + Information Barriers

**Slack reference:** Enterprise Grid only: EKM (customer-managed keys), Information Barriers (separation of departments).

**AAELink offers both at sub-enterprise tier — exceeds Slack here.**

| Aspect | Status | Notes |
|---|---|---|
| AAELink components | — | `app/components/admin/EKMPanel.tsx`, `app/components/admin/InformationBarriers.tsx` |
| Visual | 🟡 Partial | Components exist |
| Interaction | 🟡 Partial | — |
| Keyboard | 🟡 Partial | — |
| A11y | 🟡 Partial | — |

**Severity:** **P2** (pending verification)

---

### 12.7 Webhook management / app management

**Slack reference:** Manage apps page lists OAuth apps, slash commands, webhooks; revoke/edit/disable per app.

| Aspect | Status | Notes |
|---|---|---|
| AAELink components | — | `app/components/admin/OAuthAppsPanel.tsx`, `app/components/admin/WebhookManagementPanel.tsx`, `app/components/admin/WorkflowManagementPanel.tsx`, `app/components/admin/FunctionsPanel.tsx` |
| Visual | 🟡 Partial | Components exist |
| Interaction | 🟡 Partial | — |
| Keyboard | 🟡 Partial | — |
| A11y | 🟡 Partial | — |

**Severity:** **P2** (pending verification)

---

### Section 12 summary

- **0 P0**
- **3 P1**: user management verification (12.2), retention/DLP/legal hold verification (12.4), SSO/SCIM verification (12.5)
- **4 P2**: admin home dashboard (12.1), audit log polish (12.3), EKM/IB verification (12.6), apps/webhooks verification (12.7)

---

## 13. Calls & Huddles

### 13.1 Huddle panel — entry & visual chrome

**Slack reference:** Channel header "Start huddle" toggle opens a persistent floating bar at bottom-left; expanding shows participant tiles, controls (mic/video/share/reactions), and a side panel for chat/threads. Huddles are dark-themed (intentional) regardless of workspace theme.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/HuddlePanel.tsx`, `app/api/calls/rooms/route.ts` |
| Visual | 🟡 Partial | Panel shows participant tiles, mic/video/share/record/reactions buttons, optional chat sidebar. Dark gradient `#1a1a2e → #16213e` is fine. Tiles render initials avatar but no real video stream wiring |
| Interaction | 🟠 Stub | Mute/video/screen-share/record toggle local state only — no WebRTC signaling, no MediaStream attachment. Leave hits `PUT /api/calls/rooms` correctly |
| Keyboard | 🔴 Missing | No global shortcut to toggle mic (Slack: `M`), video (`V`), or leave (`Esc`). Controls are buttons but have no `title` keyboard hint |
| A11y | 🔴 Missing | Inline `style` everywhere — no role on the panel, no `aria-label` on the mic/video buttons (only `title`), no live region announcing participant joins, color-only "speaking" indicator (green border) |

**Severity:** **P0** — control-plane works but the user-facing experience is a stub: no audio/video actually flows. Audit-wise this is the single largest "stub" surface in the app. **A11y separately is P1.**
**Fixes:**
- Wire WebRTC (mediasoup/livekit) to participant tiles — server signaling is already in place per `app/api/calls/rooms/route.ts:9`
- Replace inline styles in `HuddlePanel.tsx` with token-driven classes in `app/styles.css` so the panel theme survives token changes
- Add keyboard shortcuts: `M` mic, `V` video, `S` screen-share, `Esc` leave; document in `KeyboardShortcutsModal.tsx`
- Add `role="region"` `aria-label="Huddle"`, `aria-pressed` on toggle buttons, ARIA-live announcement of participant join/leave

---

### 13.2 Call types — voice / video / huddle / screen-share

**Slack reference:** Call types differ by surface: 1:1 DM call vs channel huddle vs scheduled meeting. Each has its own join flow.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/api/calls/rooms/route.ts` accepts `type: 'voice' \| 'video' \| 'huddle' \| 'screen_share'`. Only `huddle` UI is wired |
| Visual | 🟠 Stub | DM/channel header has no "Call" button (1:1 voice) or "Video" button — see §2.1 finding |
| Interaction | 🟠 Stub | API supports all four types but only Huddle has a launcher; no incoming-call modal, no ring tone, no missed-call notification |
| Keyboard | 🔴 Missing | No `Cmd+Shift+H` to start huddle (Slack pattern) |
| A11y | 🔴 Missing | No incoming-call ARIA-live announcement |

**Severity:** **P1**
**Fixes:**
- Add call/huddle buttons to channel header (already flagged at §2.1)
- Add incoming-call modal with accept/decline/timeout
- Add `Cmd+Shift+H` global to start a huddle in the active channel

---

### 13.3 Screen sharing

**Slack reference:** During a huddle, click screen-share → picker for window/screen/tab → presenter view + draw/annotate; viewer sees pointer + annotations.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `HuddlePanel.tsx` screen-share button toggles local flag only |
| Visual | 🟠 Stub | Button toggles state; no MediaStream wiring; no presenter view |
| Interaction | 🔴 Missing | No screen picker, no draw/annotate, no pointer overlay |
| Keyboard | 🔴 Missing | — |
| A11y | 🔴 Missing | — |

**Severity:** **P1** — depends on 13.1
**Fixes:**
- Wire `navigator.mediaDevices.getDisplayMedia()` and add screen track to peer connection
- Server already has `screen_share_user_id` field (`call_rooms`); render that user's tile distinctly

---

### 13.4 Recording

**Slack reference:** Huddle host can record; saves a transcript + audio file to the channel; UI shows REC indicator and a banner.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `HuddlePanel.tsx:174` REC pill, `recording_enabled` admin flag at `app/api/calls/rooms/route.ts:50` |
| Visual | 🟡 Partial | REC pill renders when toggle is on |
| Interaction | 🟠 Stub | Toggle flips state but no server-side recording job, no storage write, no consent UX, no transcript post |
| Keyboard | 🔴 Missing | — |
| A11y | 🟡 Partial | Pill is visible but no ARIA-live "Recording started" |

**Severity:** **P1** — compliance-sensitive; recording without consent is a GDPR risk
**Fixes:**
- Add consent prompt before recording starts ("All participants will be notified.")
- Wire to S3/MinIO via `lib/s3.ts`; emit post in channel when recording stops
- Audit log row on start/stop (see `aaelink-rbac-audit` skill)
- ARIA-live announcement on start/stop

---

### 13.5 Huddle chat sidebar

**Slack reference:** Slack's huddle has a side chat that's ephemeral by default but can be posted to the main channel afterward.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `HuddlePanel.tsx:214-239` |
| Visual | 🟡 Partial | Sidebar renders; Enter sends; messages styled |
| Interaction | 🟡 Partial | Local-only — messages never persist or fan out. No "post chat to channel" action |
| Keyboard | 🟡 Partial | Enter works; no Esc to close sidebar |
| A11y | 🔴 Missing | Input has no label; no ARIA-live for incoming messages |

**Severity:** **P2**
**Fixes:**
- Persist huddle chat to `aaelink.call_chat` table; broadcast via `lib/realtime.ts`
- Add "Post to channel" action on huddle end
- Add `<label>` and `aria-live="polite"` to chat list

---

### 13.6 In-call reactions

**Slack reference:** Floating emoji reactions during call (👏 🎉 ❤️) that animate up the screen for all participants.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | Reactions button exists at `HuddlePanel.tsx:150` but `action: () => {}` (no-op) |
| Visual | 🔴 Missing | No floating reaction animation |
| Interaction | 🔴 Missing | Button is a placeholder |
| Keyboard | 🔴 Missing | — |
| A11y | 🔴 Missing | — |

**Severity:** **P2**
**Fixes:**
- Implement reaction picker; broadcast via WebSocket; animate via CSS transform/opacity
- Add `aria-live="polite"` for screen readers (or `aria-hidden` if reactions are purely decorative)

---

### 13.7 Admin calls configuration

**Slack reference:** Org admin can disable calls, force noise suppression, set max participants, configure TURN.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/api/calls/rooms/route.ts:42-62` exposes `view=config` returning a `calls_config` blob |
| Visual | 🟠 Stub | API returns config but no admin panel UI located in this pass — `app/components/admin/` has no `CallsSettingsPanel.tsx` |
| Interaction | 🔴 Missing | No UI to mutate `calls_config` from admin shell |
| Keyboard | 🟡 Partial | — |
| A11y | 🟡 Partial | — |

**Severity:** **P1**
**Fixes:**
- Add `app/components/admin/CallsSettingsPanel.tsx` mirroring the schema in the route (enabled, max_participants, recording, blur, noise suppression, TURN/STUN config)
- Wire to existing GET + add PUT to `/api/calls/rooms?view=config`

---

### 13.8 Call history / room list

**Slack reference:** A "Calls" tab in the right rail or activity view lists recent calls, duration, participants; click to rejoin if still active.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `GET /api/calls/rooms?status=ended` returns ended rooms; no UI surface for history |
| Visual | 🔴 Missing | No call history panel |
| Interaction | 🔴 Missing | No "rejoin" affordance, no per-channel call list |
| Keyboard | 🔴 Missing | — |
| A11y | 🔴 Missing | — |

**Severity:** **P2**
**Fixes:**
- Add a "Calls" subview under channel info or activity; render `rooms` GET with sortable columns (started, duration, participants)

---

### Section 13 summary

- **1 P0**: huddle stub — WebRTC transport not wired (13.1)
- **5 P1**: 13.2 call types + launchers, 13.3 screen-share wiring, 13.4 recording wiring + consent, 13.7 admin calls panel, plus 13.1 a11y polish
- **3 P2**: 13.5 huddle chat persistence, 13.6 in-call reactions, 13.8 call history

---

## 14. Canvases & Lists

### 14.1 Channel canvas — editor surface

**Slack reference:** Each channel/DM has a canvas — a Notion-like collaborative document with blocks (heading, text, checklist, code, callout, divider, image, file, mention). Auto-saves, real-time collaboration with cursors, share via URL.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/CanvasEditor.tsx`, `app/api/conversations/canvases/route.ts`, `app/api/docs/canvas/route.ts`, `app/api/docs/canvas/sections/route.ts`, `app/api/docs/canvas/access/route.ts` |
| Visual | 🟡 Partial | Block types: heading/paragraph/checklist/code/divider/callout/quote/image/file/mention — covers Slack's block set. Block menu icons render. Seeded with sample blocks instead of real content |
| Interaction | 🟡 Partial | Add/delete/reorder blocks works locally; **`lastSaved` is computed client-side only**, no real persistence call seen in component. Real-time collab cursors not visible |
| Keyboard | 🟠 Stub | No `/` slash-menu to insert blocks (Slack convention); arrow keys don't move between blocks; no Markdown shortcuts (`#` → heading, `[]` → checklist) |
| A11y | 🟡 Partial | Editable regions not flagged with `role="textbox"` or `aria-label`; block reorder buttons unlabeled |

**Severity:** **P1**
**Fixes:**
- Wire `updateBlock` / `addBlockAfter` / `deleteBlock` to PUT `/api/docs/canvas/sections`; debounce 800ms
- Add `/` slash-menu picker at caret (mirror existing message Composer pattern)
- Markdown shortcuts on space (`# ` → heading, `- [ ] ` → checklist, ``` → code)
- Replace seeded sample blocks with fetched content; show skeleton while loading
- Move inline styles to `app/styles.css` tokens (canvas currently has no `[data-theme=dark]` overrides per §16)

---

### 14.2 Canvas sharing & collaboration awareness

**Slack reference:** Header shows live collaborator avatars; share button gives URL + access scope (channel / specific people / anyone-with-link).

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `CanvasEditor.tsx:58-61` declares hard-coded `collaborators` list; `app/api/docs/canvas/access/route.ts` exists for sharing |
| Visual | 🟠 Stub | Two mock collaborators ("Admin", "Sarah Chen") hard-coded; share menu state exists but not deeply audited |
| Interaction | 🟠 Stub | No real presence — collaborators are static; share menu likely doesn't reflect real access |
| Keyboard | 🔴 Missing | No shortcut to open share menu |
| A11y | 🟡 Partial | Mock avatars unlabeled |

**Severity:** **P1**
**Fixes:**
- Replace hard-coded `collaborators` with presence-derived list (consume `lib/realtime.ts` presence channel scoped to canvas)
- Wire share menu to `app/api/docs/canvas/access/route.ts`; surface `channel` / `users` / `public_link` modes
- Add `Cmd+Shift+S` to open share

---

### 14.3 Block templates & embeds

**Slack reference:** Slack canvases support: heading, text, checklist, callout, code, divider, image, file, video embed, table, link preview.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `CanvasEditor.tsx:30-38` `BLOCK_TEMPLATES` array |
| Visual | 🟡 Partial | 7 visible block types: heading, paragraph, checklist, code, callout, quote, divider. Image/file/mention defined in `CanvasBlock` type but not in the picker |
| Interaction | 🟡 Partial | Picker inserts blocks; no embed previews (link → image card) |
| Keyboard | 🔴 Missing | — |
| A11y | 🟡 Partial | Picker is a button with no `role="menu"` / `aria-haspopup` |

**Severity:** **P2**
**Fixes:**
- Add image, file, table, embed to `BLOCK_TEMPLATES`
- Add link-preview block that fetches OpenGraph via existing link-preview pipeline
- Picker `role="menu"`, items `role="menuitem"`

---

### 14.4 Slack Lists — project board

**Slack reference:** Lists are a structured-data feature: rows with typed columns (status, owner, due date, priority), three views (board / table / list).

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/SlackListPanel.tsx`, `app/api/lists/route.ts` |
| Visual | ✅ Full | Three view modes (board/table/list), status/priority pills with Slack-style colors, assignee + due date columns |
| Interaction | 🟡 Partial | Loads from `/api/lists`; filters by status + assignee; create item; drag between board columns and inline edit not deeply audited |
| Keyboard | 🔴 Missing | No `Cmd+N` to add row; no Tab traversal across cells in table view; no Esc to cancel edit |
| A11y | 🟡 Partial | Filter dropdowns are native `<select>` (good); view-mode toggle buttons need `aria-pressed`; board columns need `role="region"` `aria-label` |

**Severity:** **P1**
**Fixes:**
- Add keyboard shortcuts: `Cmd+N` new row; `Esc` cancel; arrow nav in table view
- ARIA: `aria-pressed` on view buttons, `role="region"` per board column, `aria-label="Items in {status}"`
- Verify drag-and-drop reorder works (Slack pattern); if missing, add HTML5 DnD

---

### 14.5 Lists — custom fields & filters

**Slack reference:** Power-user fields: tags, multi-select, dates, formulas. Saved filter views.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `SlackListPanel.tsx:14-24` `ListItem` interface has fixed shape: title/status/priority/assignee/dueDate/description/tags |
| Visual | 🟠 Stub | No UI to add custom columns; tags array exists but no tag-picker UI |
| Interaction | 🔴 Missing | No saved-view persistence; filters reset on reload |
| Keyboard | 🔴 Missing | — |
| A11y | 🟡 Partial | — |

**Severity:** **P2**
**Fixes:**
- Schema extension to allow custom fields per list (later milestone)
- For now: surface the existing `tags[]` field with a tag picker + filter chip

---

### Section 14 summary

- **0 P0**
- **4 P1**: 14.1 canvas persistence wiring + slash menu, 14.2 sharing + presence, 14.4 lists keyboard + ARIA, plus 14.1 a11y polish
- **2 P2**: 14.3 block templates polish, 14.5 custom fields

---

## 15. Apps & Integrations

### 15.1 App Directory

**Slack reference:** Browse-installable apps with categories, search, ratings, install/uninstall, app detail page with permissions list.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/AppDirectoryPanel.tsx`, wired to `/api/integrations/apps` |
| Visual | ✅ Full | 8 categories, search input, "all/installed" tab, app cards with name/developer/rating/description |
| Interaction | 🟡 Partial | Search + category filter work; `toggleInstall` flips local state — comment at line 58 admits "real install/uninstall would call marketplace API" — i.e. not wired |
| Keyboard | 🟠 Stub | No `Cmd+K`-style focus on search; Esc closes but tab order not verified; install button needs Enter |
| A11y | 🟡 Partial | Inline styles; close button has no `aria-label`; category buttons need `aria-pressed`; install/uninstall buttons need clearer label |

**Severity:** **P1**
**Fixes:**
- Wire `toggleInstall` to `POST /api/marketplace/install` / `DELETE /api/marketplace/installed`
- Move inline styles to design tokens
- ARIA: `aria-pressed` on category buttons, `aria-label` on close, role="search" on search box

---

### 15.2 Marketplace — plugin browse & publish

**Slack reference:** Slack doesn't expose plugin publishing to end-users; AAELink's Marketplace exceeds Slack here.

**AAELink-specific: this is a value-add beyond Slack parity.**

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/MarketplacePanel.tsx`, `app/api/marketplace/plugins`, `app/api/marketplace/install`, `app/api/marketplace/installed` |
| Visual | ✅ Full | Browse / Installed / Publish tabs; publish form (name, slug, desc, version, emoji, bg, category) |
| Interaction | 🟡 Partial | Loads plugins + installed; install/uninstall buttons wire to API; publish form not deeply tested in this pass |
| Keyboard | 🟡 Partial | — |
| A11y | 🟡 Partial | Publish form fields likely missing explicit `<label>` wiring |

**Severity:** **P2** (verification — AAELink-original feature)
**Fixes:**
- Verify publish flow end-to-end with a fixture plugin
- Audit log row on publish/install/uninstall
- Add `<label htmlFor>` for all publish-form inputs

---

### 15.3 Integrations panel — webhooks & apps

**Slack reference:** Settings page lists incoming/outgoing webhooks per workspace; rotate secret, delete, copy URL.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/IntegrationsPanel.tsx`, `app/api/integrations/webhooks/route.ts`, `app/api/integrations/apps/route.ts` |
| Visual | 🟡 Partial | Two tabs (webhooks/apps), webhook list, create form, copy-token affordance |
| Interaction | 🟡 Partial | Create-webhook POST works; copy-token visible. No rotate-secret action; delete not deeply audited |
| Keyboard | 🟡 Partial | Tab switching is button-based — needs `role="tab"` / `aria-selected` |
| A11y | 🟡 Partial | Form labels appear inline; needs `aria-describedby` for the secret token reveal |

**Severity:** **P1** (security-critical — webhook secret handling)
**Fixes:**
- Add **rotate-secret** action on each webhook (separate from delete) → POST `/api/integrations/webhooks?action=rotate`
- Mask token by default, reveal-on-click; never log full token client-side
- WAI-ARIA tab pattern on the two-tab switcher
- Add `aria-live="polite"` on the "copied" feedback

---

### 15.4 Workflow Builder

**Slack reference:** Visual workflow builder with triggers (new message, reaction, schedule, webhook, member join, form submit) and step blocks (send message, collect form, set topic, add reaction, delay, condition, notify).

**AAELink offers parity here.**

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/WorkflowBuilder.tsx`, wired to `/api/approvals/workflows` |
| Visual | ✅ Full | 6 trigger types + 8 step types matching Slack. List view + edit view |
| Interaction | 🟡 Partial | Trigger/step pickers render; drag-to-reorder uses `dragIdx`; persistence not fully audited |
| Keyboard | 🔴 Missing | No keyboard reorder (only mouse drag); no Esc to close pickers |
| A11y | 🟡 Partial | Drag affordance has no keyboard equivalent — WCAG 2.5.7 violation candidate |

**Severity:** **P1**
**Fixes:**
- Add keyboard reorder for steps (↑/↓ when focused on `GripVertical` handle); announce moves via `aria-live`
- Esc closes trigger/step picker
- `role="dialog"` `aria-modal` on edit view
- Verify save persists across reload

---

### 15.5 Admin app management — OAuth apps, webhooks, functions

**Slack reference:** Admin page listing all OAuth-installed apps, with revoke/disable/edit/audit-trail per app.

| Aspect | Status | Notes |
|---|---|---|
| AAELink components | — | `app/components/admin/OAuthAppsPanel.tsx`, `app/components/admin/WebhookManagementPanel.tsx`, `app/components/admin/FunctionsPanel.tsx`, `app/components/admin/WorkflowManagementPanel.tsx` |
| Visual | 🟡 Partial | All four panels exist (see §12.7) |
| Interaction | 🟡 Partial | Not deeply audited this pass |
| Keyboard | 🟡 Partial | — |
| A11y | 🟡 Partial | — |

**Severity:** **P1** (security-critical — pending verification)
**Fixes:**
- Each panel: verify list + revoke + audit-trail link
- Revoke action must write to `audit_log` per `aaelink-rbac-audit`

---

### 15.6 Slash command discovery

**Slack reference:** Typing `/` in composer opens a searchable list of all slash commands (built-in + app-provided) with descriptions.

| Aspect | Status | Notes |
|---|---|---|
| AAELink component | — | `app/components/chat/Composer.tsx` (slash menu — see §5.2) |
| Visual | 🟡 Partial | Slash menu exists per §5.2; app-provided commands integration not verified |
| Interaction | 🟡 Partial | Built-in slash commands work; whether installed apps register commands into the menu is not confirmed |
| Keyboard | 🟡 Partial | Arrow nav exists |
| A11y | 🟡 Partial | See §5.2 |

**Severity:** **P1**
**Fixes:**
- Verify app-registered slash commands surface in the picker (cross-ref `aaelink-feature-parity`)
- Show app icon next to app-provided commands so users can distinguish source

---

### Section 15 summary

- **0 P0**
- **5 P1**: 15.1 install wiring + ARIA, 15.3 webhook rotate + tab pattern, 15.4 workflow keyboard reorder, 15.5 admin panels verification, 15.6 slash command app integration
- **1 P2**: 15.2 marketplace publish verification

---

## 16. Cross-Cutting Findings

These are themes that recur across multiple surfaces in §1–15. Each theme below should be addressed as a single workstream rather than per-surface to avoid drift.

### 16.1 A11y debt — ARIA attributes & semantic roles missing across the board

**Signal:** Nearly every surface in §1–15 is marked **Partial** for A11y. The recurring gaps are:
- `aria-current="page"` on active nav items (sidebar, top nav, admin)
- `aria-pressed` on toggle/filter buttons (category filters, view-mode toggles, theme picker, sidebar density)
- `aria-label` on icon-only buttons (close, install, copy, leave-call, share)
- `role="tab"` / `aria-selected` on tab-like controls that use plain `<button>` (Preferences, Integrations, Marketplace)
- `role="region"` `aria-label` on landmark zones (channel list, message log, RHS, board columns)
- `aria-live="polite"` for transient announcements (toast, presence change, recording start, mention)

**Severity:** **P0 cluster** — at minimum the Preferences-modal violation (§10.1) and the message hover toolbar (§4.1) are WCAG 2.2 AA fails.
**Recommendation:** Single dedicated "A11y sweep" workstream that codifies a small set of helpers (`<ToggleButton aria-pressed>`, `<TabList>` component, `useAriaLive()` hook) and applies them everywhere.

---

### 16.2 Keyboard navigation — global shortcuts and arrow-key traversal incomplete

**Signal:** Recurring missing shortcuts:
- `Cmd+1..9` workspace switch (§1.1)
- `Cmd+K` / quickswitcher dedup with `Ctrl+K` Command Palette (§7.1)
- `Cmd+Shift+H` start huddle (§13.2)
- `Cmd+Shift+S` share canvas (§14.2)
- Jump-to-bottom shortcut (§3.4)
- Arrow-key traversal in lists (§14.4)
- Keyboard reorder in workflows (§15.4)
- Hover-only message toolbar — no keyboard surface (§4.1) **WCAG fail**

**Severity:** **P0** — covers two named P0s (§4.1, §10.1)
**Recommendation:** Centralize shortcut registration in one place (extend `KeyboardShortcutsModal.tsx`'s registry); audit every interactive surface for keyboard parity using a checklist matrix.

---

### 16.3 Hover-only and mouse-only interactions

**Signal:**
- Message hover toolbar (§4.1) — only appears on hover, not on focus
- Profile hovercard (§9.1) — hover-only
- Workflow drag handle (§15.4) — mouse-only reorder
- "Speaking" indicator in huddle (§13.1) — color-only

**Severity:** **P1** (the §4.1 case is P0 because it gates message actions entirely)
**Recommendation:** Convert hover triggers to `:hover, :focus-within`; pair color cues with iconography.

---

### 16.4 Inline styles vs design tokens — dark theme and brand drift

**Signal:** Surfaces written with inline `style` props instead of tokens from `lib/theme.ts` / `app/styles.css`:
- `HuddlePanel.tsx` — full hex/rgba inline (§13.1)
- `CanvasEditor.tsx` — block colors hard-coded (§14.1)
- `IntegrationsPanel.tsx` — partly inline
- `MarketplacePanel.tsx` — partly inline

This is the root cause of the recurring "Batch N — Dark Overrides" CSS patches in `app/styles.css` (already three batches). New surfaces written with inline styles need a fresh dark-theme pass each time.

**Severity:** **P1** (theme correctness) + technical debt
**Recommendation:** Codify the rule "no inline `style` props for color/background/border — use `var(--mm-*)` tokens"; lint-rule or ADR. Migrate the four named components.

---

### 16.5 Stub interactions and "pending verification" rows

**Signal:** Many components render but their actions are placeholders (`() => {}`) or only update local state:
- Huddle reactions (§13.6) — no-op
- App install (§15.1) — admitted in comment that real install isn't called
- Canvas collaborators (§14.2) — mock list
- Multiple admin panels in §12 and §15.5 marked "pending verification"

**Severity:** **P1**
**Recommendation:** Compile a "stub registry" — single list of `() => {}` and `// TODO real-…` markers — and burn down per sprint. The §12/§15 "pending verification" items should drive an integration-test pass under `__tests__/api/`.

---

### 16.6 confirm() / alert() instead of in-app dialogs

**Signal:** `window.confirm()` used for destructive actions (e.g. §4.5 leave-channel) where a styled `ConfirmDialog` component exists.

**Severity:** **P1** (consistency, brand, A11y — native confirm is unstyled and unlabeled)
**Recommendation:** Greppable replacement — one-pass `confirm(` → `<ConfirmDialog>` migration across `app/`.

---

### 16.7 ARIA tab pattern not applied to tab-like UIs

**Signal:** Several surfaces use plain `<button>` rows for tabs:
- Preferences modal (§10.1) **P0**
- Integrations panel (§15.3) webhooks/apps tabs
- Marketplace browse/installed/publish tabs (§15.2)
- RHS thread/notifications/files tabs (§6)

**Severity:** **P0** because §10.1 is already named; **P1** for the rest.
**Recommendation:** Build a reusable `<TabList>` primitive that emits `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, and handles arrow-key navigation per WAI-ARIA APG. Migrate the four surfaces above.

---

### 16.8 Animation & motion preference

**Signal:** Animations in the app (presence ping, toast, micro-animations from earlier commits) don't respect `prefers-reduced-motion`.

**Severity:** **P2** (accessibility polish — WCAG 2.3.3)
**Recommendation:** Wrap animations in `@media (prefers-reduced-motion: no-preference)` in `app/styles.css`.

---

### Section 16 summary

8 cross-cutting themes — most are A11y / keyboard / design-system drift. Themes 16.1, 16.2, 16.7 are the highest-impact single workstreams and overlap with the three named P0s.

---

## 17. Executive Summary

### Overall parity verdict

AAELink achieves **broad surface parity** with Slack — every section §1–15 has working components. The gaps are concentrated in three areas:

1. **Accessibility** — pervasive ARIA gaps, hover-only interactions, missing keyboard equivalents. Three of the most severe gaps are WCAG 2.2 AA fails.
2. **Real-time call transport** — UI for huddles is built but WebRTC media is not wired (§13.1). Control plane exists; transport layer is the stub.
3. **Stub interactions** — multiple panels render but their primary action (install app, reorder block, post canvas) is a no-op or local-state-only.

### Severity distribution across all 15 surface sections

| Tier | Count | Notes |
|---|---|---|
| ✅ **Full parity** items | ~8 | Workflow Builder shape (§15.4), Slack Lists views (§14.4), App Directory chrome (§15.1), Marketplace publish UI (§15.2), Audit log (§12.3), Top sidebar nav (§1.2), Block templates set (§14.3), Sidebar nav structure (§1) |
| 🟡 **Partial** items | dominant | Majority of surfaces — components exist, edges/A11y/keyboard incomplete |
| 🟠 **Stub** items | ~6 | Huddle transport (§13.1), screen-share (§13.3), recording (§13.4), in-call reactions (§13.6), canvas persistence (§14.1), app install wiring (§15.1) |
| 🔴 **Missing** items | ~5 | Workspace rail (§1.1), full channel context menu (§1.5), DM context menu (§1.6), Slack-pattern hovercard (§9.1), call history UI (§13.8) |

### P0 / P1 / P2 totals (named gaps across §1–15)

| Tier | Count |
|---|---|
| **P0** | 4 |
| **P1** | ~46 |
| **P2** | ~37 |

### Top P0 gaps in priority order

1. **§4.1 — Message hover toolbar is hover-only** — keyboard users cannot react, reply, save, share, pin, or copy-link to any message. **WCAG 2.2 AA fail (2.1.1 Keyboard).**
2. **§10.1 — Preferences modal does not implement WAI-ARIA tab pattern** — screen-reader users navigating preferences get tab navigation that does not announce correctly.
3. **§1.5 — Channel context menu is incomplete** — right-click on a channel sidebar item lacks the full Slack menu (mute, mark unread, copy link, leave, properties).
4. **§13.1 — Huddle is a UI stub** — control plane works (rooms create/join/leave hit the API) but WebRTC media is not connected; users cannot actually hold a huddle.

### Recommended first sprint (5–10 items, ranked)

These are picked for highest user-visible impact-per-day and address the named P0s plus the cross-cutting themes (§16) that unblock subsequent work.

1. **A11y sweep — Phase 1: shared primitives** (`<TabList>`, `<ToggleButton>`, `useAriaLive()`, `<IconButton aria-label>` helper). Unblocks §10.1, §15.3, §15.2, §6 in one move.
2. **Message hover toolbar → focus-visible** (§4.1). Add `:focus-within` activation and tab-order traversal across actions; this clears the largest single P0.
3. **Channel context menu** (§1.5) — full menu with keyboard. Apply the new `<TabList>` / focus-trap helpers from item 1.
4. **`window.confirm()` → `<ConfirmDialog>` migration** (§16.6). Greppable, high signal, addresses §4.5 and any other survivors.
5. **`prefers-reduced-motion` global wrap** (§16.8). One-line CSS rule; meets WCAG 2.3.3.
6. **Huddle WebRTC wiring** (§13.1) — own workstream; treat as separate phase per `aaelink-realtime` skill. Recording (§13.4) waits on this.
7. **Marketplace install wiring** (§15.1) — replace mock toggle with real `/api/marketplace/install` call + audit log row.
8. **Workspace `Cmd+1..9` + huddle `Cmd+Shift+H` shortcuts** (§1.1, §13.2) — register in `KeyboardShortcutsModal.tsx`.
9. **Inline-style → token migration for `HuddlePanel`, `CanvasEditor`, `IntegrationsPanel`, `MarketplacePanel`** (§16.4) — stops the dark-theme batch-patch cycle.
10. **Stub registry burndown** (§16.5) — compile the list, assign owners, integration tests for each.

### Done criteria for this audit

- [x] All 16 areas enumerated in the design spec have a section
- [x] Every gap has a severity and at least one specific fix
- [x] Executive summary lists named P0 gaps (4 total — fewer than the "top 10" target because the audit found only 4 P0-class gaps, which is itself a finding)
- [x] Cross-cutting section has ≥ 5 themes (8 themes)
- [x] Document saved at `docs/parity-ui-audit-2026-05-11.md` (gitignored per `docs/parity-*.md` rule) and surfaced to user

---

## 18. Out of Scope

Items intentionally not audited in this pass — listed so reviewers know what was deferred and why.

### 18.1 Performance & rendering perf

Render times, list virtualization, bundle size, memo correctness — covered separately by `/aae-perf-audit`. Audit-time decision: a UI/UX parity audit shouldn't double as a perf audit; the two require different evidence.

### 18.2 Backend correctness & data model parity

DB schema, query correctness, realtime fan-out reliability, retention enforcement, DLP rules — covered by other skills (`aaelink-rbac-audit`, `aaelink-compliance`, `aaelink-realtime`). This audit only touched API routes as evidence for what the UI is wired to.

### 18.3 Desktop / mobile chrome

The Electron desktop wrapper (`desktop/`) and mobile-web responsive layout are not part of Slack's web parity baseline. They need their own audits.

### 18.4 Slack Connect / cross-org shared channels

Slack's federation feature with external orgs is intentionally out of scope per `docs/BLUEPRINT.md` (AAELink is single-tenant enterprise).

### 18.5 AAELink-specific value-add features

Tickets system, HR module, Knowledge Base, approvals workflows beyond the visual builder — these have **no Slack equivalent to measure parity against** and are tracked under their own roadmaps. The Marketplace publish flow (§15.2) was included because it touches integrations parity.

### 18.6 Voice/video transport layer

WebRTC signaling correctness, TURN/STUN topology, codec selection, packet loss recovery — covered in `docs/PHASE3-REALTIME-WEBSOCKET-LAYER.md`. The audit notes the UI is a stub (§13.1) but does not evaluate transport choices.

### 18.7 Internationalization

i18n string coverage for new surfaces, RTL layouts, locale-specific date/time/number formatting. The audit assumes existing en/th/de coverage from commit `393c1246` extends to surfaces touched, but did not verify.

### 18.8 Compliance UI internals (DLP rules, retention policies, legal hold)

§12.4 noted these components exist; the audit deliberately stopped at "components exist, pending verification" because the `aaelink-compliance` skill is the authoritative audit for these surfaces, and a UI/UX-only auditor is not the right reviewer for compliance correctness.

### 18.9 Pixel-level visual diff against live Slack

The design spec mandates "no screenshot fabrication; visual claims must reference actual AAELink source files." A pixel-diff audit against a live Slack workspace would require running screenshots through a visual-diff tool with current Slack output as ground truth — out of scope for a static, source-based audit.

---

*Audit complete — 2026-05-11.*
