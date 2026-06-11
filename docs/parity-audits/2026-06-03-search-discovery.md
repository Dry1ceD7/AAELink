# Parity Audit — Search & Discovery
Date: 2026-06-03
Auditor: Claude

## Summary
- Coverage: 18 / 22 behaviors have at least partial implementation (4 fully missing)
- Full: 7 | Partial: 8 | Stub: 0 | Missing: 7

(22 behaviors enumerated. "Coverage" counts behaviors with ✅ or 🟡; the 7 🔴 are
absent. Note one behavior — `during:` — is folded into the before/after row's notes.)

## Backend reality (trust code over README)

AAELink ships **four** message/file search routes plus a users route, a saved-searches
CRUD route, and a cross-workspace (org) route. They do **not** share a backend, and the
two main message-search paths disagree on engine and operator grammar:

| Route | Engine | Operators parsed server-side | Used by UI |
|---|---|---|---|
| `app/api/search/messages/route.ts` | **Real Postgres FTS** — `body_tsv` GENERATED column + GIN index (migration `023_messages_fts`, `lib/infra/migrate.ts:3056`), `websearch_to_tsquery('english',$2)`, `ts_rank` ordering | `from`, `before`, `after`, `has` (file/attachment/pin/reaction/link) — taken as **discrete query params**, not parsed from the `q` string | `components/search/GlobalSearchModal.tsx` (primary user-facing search) |
| `app/api/search/advanced/route.ts` | **ILIKE substring** (`m.body ILIKE '%…%'`) — *not* FTS | parses inline grammar from `q`: `from:`, `in:#`, `has:link/reaction/pin`, `before:`, `after:`, `is:thread`. Requires `workspace_id` | none found in repo (Slack-compat surface only) |
| `app/api/messages/search/route.ts` | **ILIKE substring** | none — plain `q` only | `components/chat/SearchPanel.tsx` |
| `app/api/search/org-messages/route.ts` → `lib/messaging/orgSearch.ts` | **ILIKE substring**, cross-workspace by org graph (D4) | none | none found |
| `app/api/search/files/route.ts` | **Real Postgres FTS** — `file_index.search_vector` GIN (`migrate.ts:1305`), `to_tsquery`, `ts_rank`, `ts_headline` server-side highlight | `channel_id`, `file_type` query params | none found in repo |
| `app/api/search/users/route.ts` | ILIKE across username/name/email/dept/title, username-prefix boost | `workspace_id` scope | (people search) |
| `app/api/saved-searches/route.ts` | CRUD on `aaelink.saved_searches` (`migrate.ts:3149`); per (user_id, workspace_id); audited create/delete | name/query/filters JSON | `components/search/SavedSearches.tsx` via GlobalSearchModal |

Client-side token parser: `lib/messaging/searchFilters.ts` (`parseSearchFilters`) understands
`from:`, `in:`, `before:`, `after:`, `has:(link|file|attachment|pin|reaction)` and feeds them
to `/api/search/messages` as discrete params. `is:` is **not** in the client parser.

## Behavior Matrix

| # | Behavior | Slack | Mattermost | AAELink Route | Test | Level | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Full-text message search (`search.messages`) | proprietary index | ES/DB FTS | `app/api/search/messages/route.ts` | `__tests__/api/search-messages.test.ts` | ✅ Full | Real PG FTS, `body_tsv` GIN, stemming via `websearch_to_tsquery`, test asserts stemming + ranking + ACL |
| 2 | File content search (`search.files`) | yes | yes | `app/api/search/files/route.ts` | none | 🟡 Partial | Real FTS + `ts_headline` highlights, but no test; POST-index path relies on worker `index_rebuild` job; **no UI consumer found** |
| 3 | Combined search (`search.all`) | messages+files in one call | n/a | — | — | 🔴 Missing | No single endpoint returns messages+files+people together; UI must call 3 routes |
| 4 | People search | users.list filter | autocomplete | `app/api/search/users/route.ts` | none | 🟡 Partial | Works (name/email/dept/title), username-prefix boost; no dedicated test |
| 5 | Channel search/discovery | yes | yes | — (none dedicated) | — | 🔴 Missing | No `search/channels` route; `in:` only filters an existing message search. Channel browse lives elsewhere (channels list), not a search surface |
| 6 | `from:<user>` modifier | yes | yes | `search/messages` (param) + `search/advanced` (inline) | `searchFilters.test.ts` | ✅ Full | Matches exact `u.username`; no display-name or `@me` resolution |
| 7 | `in:<#channel>` modifier | yes | yes | `search/advanced` (`c.name`); `search/messages` takes `channel_id` not name | `searchFilters.test.ts` (parse only) | 🟡 Partial | GlobalSearchModal maps parsed `in:` → `channel_id` param, but route filter expects an **id** while user types a **name** → effectively broken in primary UI path; advanced route resolves by `c.name` correctly |
| 8 | `before:<date>` modifier | yes | yes | both routes | `searchFilters.test.ts`, `searchDateWindows.test.ts`, `search-messages.test.ts` | ✅ Full | `YYYY-MM-DD` validated; `messages` uses `created_at < next-UTC-midnight` (inclusive of the whole day — see searchEngine.ts line 312), `advanced` uses `<`. **Day boundary is UTC** (`searchEngine.dayWindow` parses `…T00:00:00.000Z`), not server-local — see the searchEngine module TIME ZONE CONTRACT |
| 9 | `after:<date>` modifier | yes | yes | both routes | `searchFilters.test.ts`, `searchDateWindows.test.ts`, `search-messages.test.ts` | ✅ Full | `messages` uses `created_at >= start-of-day` (UTC). **UTC day** (deterministic across deploys; not server-local). Filter wiring covered end-to-end in `search-messages.test.ts` (before:/after: cases) |
| 10 | `on:<date>` modifier | yes | yes | — | — | 🔴 Missing | No single-day exact-date operator |
| 11 | `during:<month/year>` modifier | yes | yes (date filters) | — | — | 🔴 Missing | Not parsed anywhere |
| 12 | `has:link` modifier | yes | yes | both routes | implied | ✅ Full | `messages`: `body ~ 'https?://'`; `advanced`: `LIKE '%http%'` |
| 13 | `has:<file/attachment>` modifier | yes (`has:file`/`has:image` etc.) | yes | `search/messages` (`EXISTS file_attachments`) | `searchFilters.test.ts` (validate) | 🟡 Partial | Only generic file/attachment; no `has:image`, `has:video`, `has:star`, `has:emoji` granularity |
| 14 | `has:pin` / `has:reaction` | yes (`has::emoji:`, `is:saved`) | partial | both routes | — | 🟡 Partial | pin + reaction supported; reaction is any-reaction, not `has::thumbsup:` emoji-specific. **Table hazard:** `search/messages` queries `aaelink.reactions`, `advanced` queries `aaelink.message_reactions` — likely one wrong table name |
| 15 | `is:thread` modifier | n/a | n/a | `search/advanced` only (`root_id <> ''`) | none | 🟡 Partial | Server-supported in advanced route, but **not in client parser** so unreachable from GlobalSearchModal |
| 16 | `is:saved` / `is:pinned` / `is:dm` modifiers | yes | partial | — | — | 🔴 Missing | Not parsed; no saved/dm scoping operator |
| 17 | Saved searches (persist query) | yes | no (MM lacks) | `app/api/saved-searches/route.ts` | `__tests__/api/saved-searches.test.ts` | ✅ Full | Full CRUD, owner-scoped, workspace-asserted, audited, UI in `SavedSearches.tsx` |
| 18 | Saved-search **alerts on new matches** | yes (BLUEPRINT §2.1.4 mandates) | no | — | — | 🔴 Missing | No notify/alert wiring; BLUEPRINT §2.1.4 "Saved searches — With alerts on new matches" unmet |
| 19 | Smart suggestions / autocomplete / typeahead | yes (recent, suggested) | yes | partial — `GlobalSearchModal` static filter chips only | none | 🟡 Partial | Static `FILTER_SUGGESTIONS` list + saved searches; **no recent-search history, no result/term suggestions, no people/channel typeahead in the box**. BLUEPRINT §4.6 "Indexing, query, suggestions" unmet at engine level |
| 20 | Result highlighting | yes | yes | client substring `<mark>` in `GlobalSearchModal.highlightBody`; server `ts_headline` for files | none for highlight | 🟡 Partial | Message highlight is naive client-side substring of `filters.text` (won't highlight stemmed/FTS matches like "running"→"run"); files route has proper server `ts_headline` |
| 21 | Sort by relevance | yes (default) | yes | `search/messages` (`ts_rank DESC`), `files` (`relevance DESC`) | `search-messages.test.ts` ("ranks denser higher") | 🟡 Partial | Only the FTS message route + files route rank by relevance; `advanced`, `messages/search`, `org-messages` all sort `created_at DESC` only — no relevance, and **no user-selectable sort toggle** |
| 22 | Sort by recency / pagination | yes | yes | all routes `created_at DESC`; `messages`/`advanced`/`org` support limit+offset+total count | `search-messages.test.ts`, `searchMessages.test.ts` (clamp), `org-search.test.ts` | ✅ Full | limit clamped (≤50/60), offset, total count returned. `files`/`users` return no total and no offset |

## Critical Gaps (severity-ordered)

1. **Fragmented backend with divergent semantics (HIGH).** Three of the five message-search
   paths (`search/advanced`, `messages/search`, `org-messages`) use `ILIKE '%q%'` substring
   matching, while only `search/messages` and `search/files` use real Postgres FTS. This means
   relevance ranking, stemming, and result quality depend entirely on *which* route the UI
   happens to call. The primary UI (`GlobalSearchModal`) calls the good one (`search/messages`),
   but `SearchPanel` (in-channel) calls the ILIKE `messages/search`. Users get inconsistent
   results for the same query. Recommend consolidating all message search onto the FTS engine.

2. **`in:` channel filter broken in the primary search UI (HIGH).** `GlobalSearchModal`
   parses `in:general` and sends it as `channel_id=general`
   (`GlobalSearchModal.tsx:85`), but `/api/search/messages` filters `m.channel_id = $idx`
   expecting an opaque channel **id**, not the human-typed **name**. So `in:` from the
   main search box matches nothing unless the user happens to type the raw channel id. The
   `advanced` route resolves by `c.name` correctly — but nothing in the repo calls it.

3. **Likely wrong table name in `has:reaction` (MEDIUM, correctness bug).**
   `search/messages` (`route.ts:81`) references `aaelink.reactions`, whereas `search/advanced`
   (`route.ts:108`) references `aaelink.message_reactions`. Only one can be the real table;
   the other `has:reaction` filter throws or no-ops at runtime. Needs verification against
   `lib/infra/migrate.ts` reactions DDL and a regression test (currently untested).

4. **Saved-search alerts missing (MEDIUM, BLUEPRINT-mandated).** BLUEPRINT §2.1.4 explicitly
   lists "Saved searches — With alerts on new matches." Current `saved-searches` route is pure
   CRUD; no scheduled re-run, no notification on new matching messages. This is a named
   differentiator in the blueprint, not just Slack parity.

5. **No relevance/recency sort toggle + weak highlighting (MEDIUM, UX).** Slack lets users
   switch "Most relevant ↔ Most recent." AAELink hard-codes order per route. Highlighting in
   the message modal is naive client-side substring matching that will miss stemmed FTS hits
   (search "running", FTS matches "run", client highlights nothing). The files route already
   does it right with `ts_headline` — adopt the same server-side approach for messages.

## Recommended Next Steps
1. Consolidate all message search onto the FTS `search/messages` engine; retire or redirect
   `messages/search` and fold `advanced`'s inline-operator parser + `org-messages`' cross-org
   visibility into it. Single route, single grammar.
2. Fix `in:` in `GlobalSearchModal` — resolve channel name→id client-side, or add a
   `channel_name` param to `search/messages` that resolves server-side (like `advanced`).
3. Reconcile the `reactions` vs `message_reactions` table name; add a `has:reaction` /
   `has:pin` / `has:file` integration test (none exist today).
4. Add `is:thread` (and ideally `is:saved`, `on:`, `during:`) to the client parser + FTS route
   so server-side support already in `advanced` becomes reachable.
5. Move message highlighting to server-side `ts_headline` (mirror `search/files`) so highlights
   track the FTS match, not a literal substring; add a highlight test.
6. Add saved-search alerts (worker job that re-runs saved queries, notifies on new matches) to
   satisfy BLUEPRINT §2.1.4.
7. Add tests for `search/files` and `search/users` (both currently untested).
8. Add a relevance/recency sort param to the search routes + a UI toggle.

## Out of Scope
- **OpenSearch / Elasticsearch index tier** — BLUEPRINT §4.6 mandates OpenSearch BM25 + custom
  analyzers; matrix tracks as Gap/DRIFT-006, planned `v0.3.0-beta`. PG FTS is the interim
  engine. Not a regression to flag here beyond noting the drift.
- **Hybrid lexical + dense-vector / semantic search, entity graph, learning-to-rank (LTR)** —
  BLUEPRINT §2.1.4 / §4.6 / §6 list these under M6 Intelligence. Per the standing directive,
  AI/ML semantic search is **out of scope** for the current parity program.
- **`search.context` for LLM/assistant** (`api/assistant`) — AI-adjacent, out of scope.
- **eDiscovery / custodian search** — compliance-scope feature, audited separately.
