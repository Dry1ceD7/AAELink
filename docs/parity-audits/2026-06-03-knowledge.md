# Parity Audit — Knowledge
Date: 2026-06-03
Auditor: Claude

Scope: Slack Canvases (canvases.*, channel canvases, conversations.canvases), Slack Lists
(creation, fields/columns, items, item comments), the Slack canvas/list API surface, plus the
AAELink-specific Wiki/Knowledge-Base (`kb_*`). Mattermost has no real Canvas/Lists equivalent;
the closest analogues (Boards, Playbook checklists) are noted where relevant. Code was read
directly; the parity full-map's "Shipped" claims (lines 170–172, 267, 293) are treated as
suspect and downgraded below where the code does not support them.

## Summary
- Coverage: 9 / 23 behaviors at Full or Partial (≥🟡); the rest are stub or missing.
- Full (✅): 4 | Partial (🟡): 5 | Stub (🟠): 6 | Missing (🔴): 8

Counting note: "Full" = behavior present and reasonably complete; "Partial" = present but
materially incomplete (e.g. no access enforcement, declared-but-unimplemented actions);
"Stub" = table/route exists but the behavior is not actually wired/enforced; "Missing" = no code.

## Behavior Matrix

| # | Behavior | Slack | Mattermost | AAELink Route | Test | Level | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Create canvas (standalone / personal) | canvases.create | — | `POST /api/docs/canvas` `app/api/docs/canvas/route.ts:104` | none | ✅ | Block-based JSON, word/block counts computed. No audit, no CSRF. |
| 2 | Edit canvas content (block model) | canvases.edit | — | `PUT /api/docs/canvas` `route.ts:153` | none | 🟡 | Whole-document replace of `content_blocks`; no granular section ops via this route, no optimistic-concurrency / version guard. No CSRF, no audit. |
| 3 | Delete canvas | canvases.delete | — | none (`route.ts:204-206` only GET/POST/PUT) | none | 🔴 | No DELETE handler; canvases cannot be removed via API. |
| 4 | Channel canvas (canvas embedded in channel) | channel canvases | — | `type='channel_canvas'` filter `route.ts:74,80` | none | 🟡 | Stored + listable by `channel_id`, but access = "any channel_canvas is readable by anyone" (`route.ts:57,80`) — no channel-membership check. Over-broad. |
| 5 | conversations.canvases (canvas linked to a conversation) | conversations.canvases | — | `app/api/conversations/canvases/route.ts:14,40` | none | 🟠 | Separate table `conversation_canvases` linking to `aaelink.documents` (NOT the `canvases` table). Two divergent canvas backends; this one stores `body` text, not blocks. No membership check on `channel_id`. |
| 6 | canvases.access — set/grant access | canvases.access (set) | — | `POST /api/docs/canvas/access` action=set `app/api/docs/canvas/access/route.ts:62` | none | 🟠 | Writes to `canvas_access` table, but that table is NOT consulted by the canvas GET access check (`docs/canvas/route.ts:57` only looks at `shared_with` jsonb + type). Grants are inert. |
| 7 | canvases.access — revoke access | canvases.access (delete) | — | action=delete `access/route.ts:86` | none | 🟠 | Same inert-table problem as #6. |
| 8 | canvases.access — lookup access list | (read) | — | action=lookup `access/route.ts:50` | none | 🟡 | Returns rows; functional read but reflects the unenforced grant table. |
| 9 | Canvas sections — create/update/delete/reorder | canvases.sections.* | — | `POST /api/docs/canvas/sections` `app/api/docs/canvas/sections/route.ts:39` | none | 🟠 | `canvas_sections` is a parallel table to `content_blocks`; the main canvas GET (`docs/canvas/route.ts:38`) returns `content_blocks`, not sections. Sections are write-only relative to the editor's read path — not unified. No ownership/access check on section writes. |
| 10 | Canvas templates | template type / starter docs | — | `is_template` + `type='template'` `docs/canvas/route.ts:74,144` | none | 🟡 | Templates are creatable and universally readable, but there is no "instantiate from template" action; caller must copy blocks client-side. |
| 11 | Canvas sharing via shared_with | (share) | — | `shared_with` jsonb `docs/canvas/route.ts:57,81,177` | none | ✅ | Works for the GET path (creator/channel_canvas/template/shared_with). This is the *actually enforced* sharing mechanism (contrast #6–7). |
| 12 | Canvas pin | pin canvas | — | `is_pinned` `docs/canvas/route.ts:176` | none | 🟡 | Boolean stored/updatable; no dedicated pinned-canvas listing or channel-tab surfacing. |
| 13 | Canvas realtime collaboration | live cursors / co-edit | — | none | none | 🔴 | No `lib/realtime` emit on canvas writes; last-write-wins full replace. No presence/cursors. |
| 14 | Canvas version history | (revision history) | — | none | none | 🔴 | `canvases` table has no version columns (`migrate.ts:1445-1462`); only `updated_at`/`last_edited_by`. No revisions. |
| 15 | Create list (custom columns) | Slack Lists | (Boards) | `POST /api/lists` action=create_list `app/api/lists/route.ts:107` | `__tests__/api/lists.test.ts` | ✅ | Default columns (Title/Status/Assignee/Due Date); custom columns accepted. `view_type` table/board/calendar stored. |
| 16 | List field/column types | text/number/date/user/status/link/etc. | — | column `type` free-string `lists/route.ts:96,111` | partial (lists.test) | 🟡 | Types are not validated/enforced server-side; `values` is opaque JSON. No select-option validation against `status` options. |
| 17 | Add/update/delete list item (row) | list items | (Board cards) | actions add_item/update_item/delete_item `lists/route.ts:151,167,182` | `__tests__/api/lists.test.ts` | ✅ | Full row CRUD with position. No audit, no CSRF, no realtime. |
| 18 | Add column | add field | — | action=add_column `lists/route.ts:188` | none | 🟡 | Implemented (appends to columns JSON). |
| 19 | Update / delete column | edit/remove field | — | declared in type union `lists/route.ts:94` but no handler | none | 🟠 | `update_column`/`delete_column` are in the action union type but fall through to `unknown action` (`route.ts:201`). Declared, not implemented. |
| 20 | List item comments / threads | list item activity/comments | — | `app/api/lists/items/[itemId]/comments/route.ts` + `lib/lists/itemThreads.ts` | `__tests__/api/list-item-threads.test.ts` | ✅ | Cleanest surface: CSRF (`route.ts:38,54`), real access enforcement via `resolveItemAccess` (channel-membership aware), author/list-creator delete. Migration `013_list_item_comments` (`migrate.ts:2849,3246`). No audit/realtime emit. |
| 21 | List access control / per-list permissions | list sharing | — | none on `/api/lists` GET (`lists/route.ts:23-82` returns any list) | none | 🔴 | `GET /api/lists` and single-list fetch do NO access check — any authenticated user reads any list/items. Item-comments path enforces access but the list itself does not. Security gap. |
| 22 | List realtime updates | live updates | — | none | none | 🔴 | No realtime emit on list/item mutations. |
| 23 | Wiki / Knowledge Base CRUD | (no Slack equiv; KB ≈ posts) | (no direct equiv) | `app/api/kb/articles`, `kb/articles/[id]`, `kb/categories` | none | 🟡 | Article + category CRUD with workspace scoping, publish flag, view_count. But: edit/delete have NO RBAC (code comment at `kb/articles/[id]/route.ts:53` admits "any platform user" can edit), no audit, no CSRF, no versioning, no full-text search. |

### Additional gaps (not behaviors, but parity-relevant)
- No DELETE for KB categories; no reorder/nesting of categories.
- No canvas/list/KB search endpoints (Slack search includes canvases & list content).
- Two competing canvas data models: `aaelink.canvases` (block JSON, used by `/api/docs/canvas`)
  vs `aaelink.documents` with `doc_type='canvas'` (used by `/api/conversations/canvases`).
  They do not share storage or access logic.

## Critical Gaps (severity-ordered)

1. **List read access is unauthenticated-equivalent (security).** `GET /api/lists`
   (`app/api/lists/route.ts:23-82`) returns any list and all its items to any logged-in user
   with no workspace/channel/ownership check. Item *comments* enforce access
   (`lib/lists/itemThreads.ts:21`) but the list rows and item values do not. This contradicts
   Hard Rule #1 (workspace/RBAC check) and the full-map "Shipped" claim (line 293).

2. **canvases.access grants are inert (correctness/security).** The `canvas_access` table
   written by `/api/docs/canvas/access` (`route.ts:62-94`) is never read by the canvas access
   check (`docs/canvas/route.ts:57`, which only honors `shared_with` + type). Granting/revoking
   access has no effect on who can read a canvas. The whole `canvases.access` surface is a stub.

3. **Channel canvases ignore channel membership.** Any `channel_canvas` is readable by any
   user (`docs/canvas/route.ts:57,80`) regardless of whether they belong to the channel —
   private-channel canvas content leaks across the workspace.

4. **No audit logging on any knowledge write.** Canvases, lists, list items, and KB articles
   are all mutated with zero `lib/auditLog` calls — violates Hard Rule #5 for compliance-scoped
   content. Only `list_item_comments` and the KB routes even use CSRF selectively (KB does not).

5. **KB edit/delete has no RBAC.** `kb/articles/[id]/route.ts:53` explicitly allows any
   platform user to edit/delete any article ("for alpha"); no author/admin gate, no audit.

6. **Fragmented / duplicated canvas model.** `aaelink.canvases` vs `documents(doc_type=canvas)`
   vs `canvas_sections` are three storage paths for "canvas" with no shared read/access logic,
   making true parity (single addressable canvas with sections + access) impossible without
   consolidation.

7. **No realtime + no version history** on canvases/lists — last-write-wins full-document
   replace (`docs/canvas/route.ts:179-185`) loses concurrent edits silently.

8. **Declared-but-unimplemented list column ops.** `update_column`/`delete_column`
   (`lists/route.ts:94`) advertise capability that returns `unknown action`.

## Recommended Next Steps
1. Add workspace/channel access enforcement to `GET /api/lists` (single + list-all), mirroring
   `resolveItemAccess` in `lib/lists/itemThreads.ts`. Highest-severity, smallest fix.
2. Wire `canvas_access` into the canvas GET/PUT access check, or delete the surface and document
   `shared_with` as the canonical mechanism. Either way, stop advertising inert grants.
3. Enforce channel membership for `channel_canvas` reads (join `channel_members`).
4. Add `lib/auditLog` calls to all canvas/list/KB writes; add CSRF to KB + canvas + lists
   mutations (only list-item-comments has it today).
5. Add author/admin RBAC to KB article edit/delete; remove the "alpha" bypass.
6. Implement `update_column`/`delete_column` or remove them from the action union.
7. Decide on one canvas storage model and migrate the conversations.canvases path onto it.
8. Add tests: there are zero tests for canvases (`/api/docs/canvas*`), conversations.canvases,
   and KB. Only lists + list-item-threads are covered.

## Out of Scope
- AI/ML features (canvas AI summaries, smart-compose, auto-tagging) — excluded per the standing
  Slack-parity directive (AI/ML out of scope).
- Mattermost Boards/Playbooks full feature parity — Slack Lists is the parity target; MM is
  reference-only here.
- Real-time co-editing CRDT/OT engine design — flagged as a gap (#7) but its implementation is a
  larger initiative beyond this audit.
