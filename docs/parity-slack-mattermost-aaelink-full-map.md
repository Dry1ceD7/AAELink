# Slack-class parity — full map to AAELink

This document is the **exhaustive** planning map from a **Slack-class** product (user-visible capabilities) to **AAELink** (this repository’s **Next.js** app under `app/`, APIs under `app/api/**`, schema `aaelink` in PostgreSQL). Where Slack’s internals are not public, it uses **Mattermost Team Edition** as the engineering reference (data model, jobs, search, push, plugins).

**Shorter matrix:** [`parity-reference-matrix.md`](./parity-reference-matrix.md)  
**Runtime and scale:** [`architecture-technical.md`](./architecture-technical.md)  
**Optional Mattermost engine** (Docker / `vendor/upstream`, not required for the Next app): [`WHERE-IS-THE-ENGINE.md`](./WHERE-IS-THE-ENGINE.md), [`ARCHITECTURE-AAELINK-STACK.md`](./ARCHITECTURE-AAELINK-STACK.md)

---

## 1. Method and status legend

| Status | Meaning |
|--------|---------|
| **Shipped** | Implemented for alpha users in this repo (UI + API + persistence as applicable) |
| **Partial** | Some workflows exist; missing depth, scale, policy, or UX parity |
| **Planned** | Called out on the root [`README.md`](../README.md) roadmap |
| **Gap** | Not present; not on roadmap wording (may still be product intent) |

**“Mirror Slack”** does not require identical UX; it means **comparable organizational outcomes**: secure multi-user workspace, channels and DMs, searchable history, files, realtime collaboration, notifications, admin and compliance hooks, and an extensibility story.

### 1.1 `Target (semver)` column (all tables below)

Planning targets are **semver bands**, not promises. Re-baseline when the root [`README.md`](../README.md) roadmap changes.

| Value | Meaning |
|-------|---------|
| `v0.0.2-alpha` | Current ship line; row matches this alpha for its stated **status** |
| `v0.1.0-alpha` | Next alpha milestone (deeper chat/DM/sidebar/collab) |
| `v0.2.0-alpha` | Following alpha (workflows, richer messaging, search/index UX) |
| `v0.3.0-beta` | Beta band (scale-out, ops hardening, more enterprise controls) |
| `v1.0.0` | GA-class target (mobile, calls, heavy compliance, full extensibility) |
| `TBD` | No semver locked; product charter required |

---

## 2. Runtimes, frameworks, and engines (project scope)

| Layer | Slack (reference) | Mattermost (reference) | AAELink — **this repo** | AAELink — **optional engine track** | Target (semver) |
|-------|-------------------|------------------------|-------------------------|-------------------------------------|-----------------|
| Primary web app | Proprietary web + desktop | React `webapp/` in server bundle | **Next.js 16** App Router (`app/`), React 19, Tailwind v4, `lucide-react` | Not used when you run Next-only | `v0.0.2-alpha` |
| HTTP APIs | Proprietary | REST + WebSocket (`/api/v4/...`) | **`app/api/**`** Route Handlers | Same upstream API if you deploy MM | `v0.0.2-alpha` |
| Realtime transport | WebSocket (assumed) | WebSocket hub | **SSE** [`/api/collab/events`](../app/api/collab/events/route.ts); typing/presence/read routes under `app/api/collab/` | WebSocket hub in MM server | `v0.1.0-alpha` (SSE parity depth); `TBD` if adopting MM hub only |
| Application database | Proprietary | PostgreSQL (MM schema) | **PostgreSQL** schema `aaelink` via [`lib/migrate.ts`](../lib/migrate.ts) | Separate Postgres DB for MM when deployed | `v0.0.2-alpha` |
| Full-text search | Proprietary | Elasticsearch / OpenSearch (typical scale deployment) | **SQL / API** [`app/api/messages/search`](../app/api/messages/search/route.ts) — index tier **Gap** for Slack-grade scale | MM job server + indexer pattern | `v0.3.0-beta` (index tier); `TBD` (OpenSearch depth) |
| Object storage | Proprietary cloud | S3-compatible file backend | **S3 SDK** + MinIO in dev ([`docker-compose.yml`](../docker-compose.yml)) | MM file attachment store when on MM | `v0.0.2-alpha` |
| PDF / document services | Slack Canvas, lists, file tools | Integrations / plugins | **Stirling-PDF** URL + [`app/api/documents`](../app/api/documents/route.ts), OCR route | N/A unless bridged | `v0.0.2-alpha` (foundation); `v0.2.0-alpha` (Canvas-class) |
| Desktop shell | Electron | Desktop apps (separate repos upstream) | **Electron** [`desktop/`](../desktop/) loading web URL | MM desktop clients if you adopt MM UX | `v0.0.2-alpha` |
| Mobile | Native apps | Native apps | **Gap** | MM mobile + **push proxy** pattern when mobile ships | `v1.0.0` |
| Identity (enterprise) | SAML, SCIM, OIDC | SAML, OAuth, AD/LDAP | Email/password sessions; **SSO/SCIM Planned** per README | MM System Console auth settings | `v0.3.0-beta` (SSO); `TBD` (full SCIM) |
| Job / queue workers | Opaque | `mattermost-jobs` / workers | **Gap** — side effects mostly inline in routes; outbox + workers per [`architecture-technical.md`](./architecture-technical.md) | MM job server | `v0.2.0-alpha` |
| Plugins / apps | Slack apps, Bolt | **Plugins** + HTTP integrations | **Gap** — no plugin host | MM plugin architecture | `v1.0.0` |
| Observability | Opaque | Metrics, logs, audit DB | App logs; deep metrics **Partial** | MM telemetry + ops docs Phase 5 | `v0.3.0-beta` |

---

## 3. Clients, session, and device trust

| Capability | Mattermost hint | AAELink status | AAELink surface (today) | Target (semver) |
|------------|-----------------|----------------|-------------------------|-----------------|
| Web client | Bundled `webapp` | **Shipped** | `app/**` pages and layouts | `v0.0.2-alpha` |
| Desktop client | Electron/Cross-platform | **Shipped** | `desktop/` + `npm run desktop:*` | `v0.0.2-alpha` |
| iOS / Android | Native + push proxy | **Gap** | Roadmap “Later — mobile clients” | `v1.0.0` |
| Session cookies, logout | Session + `POST /users/logout` | **Shipped** | `app/api/auth/login`, `logout`, `me` | `v0.0.2-alpha` |
| MFA at login | LDAP/SAML MFA; TOTP plugins | **Partial** | OTP flows for IT contact / emergency support; not full account MFA policy matrix | `v0.3.0-beta` |
| Device list / remote wipe | Enterprise mobility | **Gap** | | `v1.0.0` |
| “Remember me” / secure storage | Session length policies | **Partial** | Product ruleset targets OS storage for desktop; verify end-to-end per release | `v0.1.0-alpha` |

---

## 4. Organization, workspaces, and directory

| Capability | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------------|-----------------|----------------|-----------------|-----------------|
| Multi-workspace / org | Teams = MM “teams” | **Partial** | [`app/api/workspaces`](../app/api/workspaces/route.ts), workspace pages | `v0.1.0-alpha` |
| Workspace switcher | Team sidebar switcher | **Partial** | UI depends on `app/` workspace routes | `v0.1.0-alpha` |
| Domains / URL (Site URL) | `MM_SERVICESETTINGS_SITEURL` | **Shipped** (Next) | `NEXT_PUBLIC_APP_URL`, cookies; see [`HOSTING-MACBOOK.md`](./HOSTING-MACBOOK.md) vs MM | `v0.0.2-alpha` |
| Member invites | Team invite flows | **Partial** | Account request + admin flows [`app/api/auth/account-request`](../app/api/auth/account-request/route.ts), [`app/api/admin/account-requests`](../app/api/admin/account-requests/route.ts) | `v0.1.0-alpha` |
| Guests / external collab | Guest accounts, channel constraints | **Gap** | Slack Connect–class **Gap** | `TBD` |
| User groups / IDP groups | AD group sync | **Gap** | SCIM **Planned** | `v0.3.0-beta` |

---

## 5. Sidebar, navigation, and information architecture

| Capability | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------------|-----------------|----------------|-----------------|-----------------|
| Home / activity feed | Global threads / activity | **Partial** | Home page; not full Slack “Activity” taxonomy | `v0.1.0-alpha` |
| Unread markers / sections | Sidebar categories | **Partial** | Collab UI; “sections” not equivalent | `v0.1.0-alpha` |
| Starred / favorites | Sidebar preferences | **Gap** | | `v0.2.0-alpha` |
| DMs list | Direct message list | **Planned** | README “Next — DM” | `v0.1.0-alpha` |
| Channels list | LHS channels | **Partial** | [`app/api/channels`](../app/api/channels/route.ts) | `v0.1.0-alpha` |
| Apps in sidebar | Integrations | **Gap** | | `v1.0.0` |

---

## 6. Channels and membership

| Capability | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------------|-----------------|----------------|-----------------|-----------------|
| Public channel | Open team channels | **Partial** | Channels API + UI | `v0.1.0-alpha` |
| Private channel | Private channels | **Partial** | ACL matrix to validate vs MM `Channel` privacy | `v0.1.0-alpha` |
| Archive / delete channel | Soft-delete patterns | **Gap** | | `v0.2.0-alpha` |
| Join / leave | Channel membership APIs | **Partial** | [`app/api/collab/workspace-members`](../app/api/collab/workspace-members/route.ts) | `v0.1.0-alpha` |
| Shared channels (cross-org) | Shared channels (EE) | **Gap** | Parity matrix “Slack Connect” | `TBD` |
| Default channels | Town-square analogue | **Gap** | | `v0.2.0-alpha` |

---

## 7. Messaging core (Slack’s center of gravity)

| Capability | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------------|-----------------|----------------|-----------------|-----------------|
| Send / receive messages | `POST/GET /posts` | **Partial** | [`app/api/messages`](../app/api/messages/route.ts), [`messages/[id]`](../app/api/messages/[id]/route.ts) | `v0.1.0-alpha` |
| Rich text / markdown | Markdown renderer in webapp | **Partial** | Match renderer feature list explicitly in UX specs | `v0.1.0-alpha` |
| Thread replies | Threaded posts | **Partial** | Ticket thread messages [`tickets/[id]/messages`](../app/api/tickets/[id]/messages/route.ts); channel threads need parity review | `v0.1.0-alpha` |
| Reactions | Reactions API | **Partial** | [`app/api/messages/reactions`](../app/api/messages/reactions/route.ts) | `v0.1.0-alpha` |
| Edits / deletes | Post patch/delete | **Partial** | Confirm on `messages/[id]` | `v0.1.0-alpha` |
| Permalinks | Post IDs in URLs | **Partial** | Routing + deep links | `v0.1.0-alpha` |
| Message search (in workspace) | Search backend + APIs | **Partial** | [`app/api/messages/search`](../app/api/messages/search/route.ts) — scale **Gap** (OpenSearch path in architecture doc) | `v0.3.0-beta` |
| Pinned messages | Pinned posts | **Gap** | | `v0.2.0-alpha` |
| Saved items / bookmarks | Flagged posts | **Gap** | | `v0.2.0-alpha` |
| Reminders / scheduled | Plugin / custom | **Gap** | | `v0.2.0-alpha` |
| Link unfurls (preview) | OpenGraph proxy, caches | **Gap** | Worker + cache + allowlist | `v0.2.0-alpha` |
| Drafts | Client drafts | **Gap** | | `v0.2.0-alpha` |
| Notifications for mentions | Keyword push | **Partial** | Notifications + stream [`notifications`](../app/api/notifications/route.ts), [`notifications/stream`](../app/api/notifications/stream/route.ts) | `v0.1.0-alpha` |

---

## 8. Realtime signals (typing, presence, read)

| Capability | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------------|-----------------|----------------|-----------------|-----------------|
| Typing indicators | WebSocket events | **Partial** | [`app/api/collab/typing`](../app/api/collab/typing/route.ts) + SSE fan-out | `v0.1.0-alpha` |
| Presence (online/away) | Status API + hub | **Partial** | [`app/api/collab/presence`](../app/api/collab/presence/route.ts), [`collab/users`](../app/api/collab/users/route.ts) | `v0.1.0-alpha` |
| Read receipts / read state | Channel viewed APIs | **Partial** | [`app/api/collab/read-state`](../app/api/collab/read-state/route.ts) | `v0.1.0-alpha` |
| Live delivery to clients | Hub + connections | **Partial** | [`collab/events` SSE](../app/api/collab/events/route.ts), client [`lib/realtime.ts`](../lib/realtime.ts) | `v0.1.0-alpha` |

---

## 9. Files, uploads, and content safety

| Capability | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------------|-----------------|----------------|-----------------|-----------------|
| Attach to message | File uploads bound to posts | **Partial** | Message attachments pattern vs [`documents`](../app/api/documents/route.ts) | `v0.1.0-alpha` |
| File preview | Media proxy | **Partial** | Documents + PDF pipeline | `v0.1.0-alpha` |
| Search inside files | Index pipeline | **Gap** | Needs doc indexer | `v0.3.0-beta` |
| Virus / malware scanning | Job after upload | **Gap** | Async AV scan (parity matrix) | `v0.3.0-beta` |
| Data loss prevention | DLP hooks | **Gap** | | `v1.0.0` |

---

## 10. Tickets and work management (AAELink differentiator vs pure Slack)

Slack: **Workflows**, some ticketing via apps. Mattermost: **Playbooks** (product). AAELink: **first-class tickets** in schema.

| Capability | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------------|-----------------|----------------|-----------------|-----------------|
| Ticket create / list | Playbooks / Jira plugin | **Shipped** | [`app/api/tickets`](../app/api/tickets/route.ts) | `v0.0.2-alpha` |
| Ticket detail / state | Checklists, runs | **Shipped** | [`tickets/[id]`](../app/api/tickets/[id]/route.ts) | `v0.0.2-alpha` |
| Task assignment / SLAs | Playbook timers | **Partial** | Extend ticket model + notifications | `v0.1.0-alpha` |
| Approvals (sequential / parallel) | Custom flows | **Planned** | README “Next — Approvals and workflows” | `v0.2.0-alpha` |

---

## 11. Knowledge, docs, and “Canvas-like” surfaces

| Capability | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------------|-----------------|----------------|-----------------|-----------------|
| Wiki / knowledge base | MM Boards (legacy) / integrations | **Planned** | README “Later — knowledge base” | `TBD` (README “Later”) |
| Pins / saved for later | Post metadata | **Gap** | | `v0.2.0-alpha` |
| Slack Canvas / Lists | Structured docs | **Gap** | Documents module is PDF-centric today, not freeform canvas | `TBD` |

---

## 12. Calls, meetings, and voice

| Capability | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------------|-----------------|----------------|-----------------|-----------------|
| Voice / video calls | `calls` plugin, WebRTC, TURN | **Gap** | Phase ops doc covers TURN when used | `v1.0.0` |
| Screen share | Calls | **Gap** | | `v1.0.0` |
| Huddles (ad hoc rooms) | N/A direct | **Gap** | | `v1.0.0` |
| Clips / short video | Slack feature | **Gap** | | `TBD` |

---

## 13. Notifications and email

| Capability | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------------|-----------------|----------------|-----------------|-----------------|
| In-app notifications | Notification model | **Shipped** | `notifications`, `notifications/stream`, SSE collab | `v0.0.2-alpha` |
| Email notifications | SMTP in System Console | **Partial** | Resend / Twilio / SMTP per `.env.example` | `v0.1.0-alpha` |
| Mobile push | Push proxy + HPNS | **Gap** | | `v1.0.0` |
| Per-channel mute | Channel notify props | **Partial** | [`auth/notification-prefs`](../app/api/auth/notification-prefs/route.ts) | `v0.1.0-alpha` |
| DND schedule | Do not disturb | **Gap** | | `v0.2.0-alpha` |
| Keywords / highlight words | Notify props | **Gap** | | `v0.2.0-alpha` |

---

## 14. Apps, bots, webhooks, and automation

| Capability | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------------|-----------------|----------------|-----------------|-----------------|
| Incoming webhooks | Integrations | **Gap** | | `v0.2.0-alpha` |
| Outgoing webhooks | Integrations | **Gap** | | `v0.2.0-alpha` |
| Slash commands | Commands API | **Gap** | Command palette without server registry | `v0.2.0-alpha` |
| Bot users / OAuth apps | OAuth apps | **Gap** | | `v1.0.0` |
| Event subscriptions | WebSocket events to integrations | **Gap** | | `v1.0.0` |
| Workflow builder | Slack Workflow Builder / MM automation | **Planned** | Roadmap approvals/workflows | `v0.2.0-alpha` |

---

## 15. Admin, moderation, and trust & safety

| Capability | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------------|-----------------|----------------|-----------------|-----------------|
| User admin CRUD | System Console users | **Shipped** | [`app/api/admin/users`](../app/api/admin/users/route.ts) | `v0.0.2-alpha` |
| Roles / permissions | Scheme + roles | **Shipped** | Platform roles in product docs | `v0.0.2-alpha` |
| Content moderation | Compliance exports | **Partial** | Admin routes; deepen audit surfaces | `v0.2.0-alpha` |
| Analytics / usage | System statistics | **Gap** | | `v0.3.0-beta` |
| Announcement / mandatory channels | Team policies | **Gap** | | `v0.2.0-alpha` |

---

## 16. Compliance, retention, and legal

| Capability | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------------|-----------------|----------------|-----------------|-----------------|
| Audit log (admin actions) | `audit` tables + exports | **Partial** | Deepen beyond basic admin | `v0.3.0-beta` |
| Data retention policies | Retention jobs | **Gap** | Policy engine + storage | `v1.0.0` |
| Legal hold | Compliance hold | **Gap** | | `v1.0.0` |
| eDiscovery export | Compliance export jobs | **Gap** | | `v1.0.0` |
| Customer-managed encryption | EKM | **Gap** | | `TBD` |

---

## 17. Enterprise identity

| Capability | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------------|-----------------|----------------|-----------------|-----------------|
| SAML / OIDC SSO | SAML OKTA etc. | **Planned** | README “Later — Entra ID” | `v0.3.0-beta` |
| SCIM provisioning | SCIM endpoints | **Planned** | Same roadmap bucket | `v0.3.0-beta` |
| LDAP / AD sync | AD/LDAP | **Gap** | | `TBD` |

---

## 18. Operations, reliability, and scale

| Area | Mattermost hint | AAELink status | AAELink surface | Target (semver) |
|------|-----------------|----------------|-----------------|-----------------|
| Horizontal scale of app | Clustering docs | **Gap** | SSE + session stickiness story | `v0.3.0-beta` |
| Rate limits / abuse | `Rate` settings | **Gap** | Edge or middleware | `v0.2.0-alpha` |
| Backup / restore | DB + files | **Partial** | [`deployment/production-checklist.md`](./deployment/production-checklist.md), [`PHASE5`](./PHASE5-OPERATIONS-LAYER.md) | `v0.1.0-alpha` |
| Feature flags | N/A | **Gap** | | `v0.2.0-alpha` |
| Health checks | Cluster status | **Partial** | README release notes theme | `v0.1.0-alpha` |

---

## 19. Components you may have missed (checklist)

Use this as a **gap sweep** against Slack’s surface area; each either maps to a row above or is intentionally out of scope until chartered.

| Area | Slack-like item | AAELink | Target (semver) |
|------|-----------------|--------|-----------------|
| Collaboration | Scheduled messages; message forwarding; copy block kit JSON | **Gap** | `v0.2.0-alpha` |
| Collaboration | Huddles / coworking presence in channels | **Gap** | `v1.0.0` |
| Collaboration | Shared canvas in channel | **Gap** | `TBD` |
| Discovery | “All DMs” unified view; AI summary (out of scope for parity doc) | **Gap** | `TBD` |
| Files | In-browser video/audio playback policies | **Partial** | `v0.2.0-alpha` |
| Search | Cross-workspace search (Grid) | **Gap** | `v1.0.0` |
| Search | Filters: from:user, in:#channel, has:link, before/after | **Gap** | `v0.2.0-alpha` |
| Admin | Custom emoji management | **Gap** | `v0.2.0-alpha` |
| Admin | App approval policies | **Gap** | `v1.0.0` |
| Enterprise | Information barriers | **Gap** | `TBD` |
| Enterprise | Data residency region pins | **Gap** | `TBD` |
| Integrations | Email ingestion (email-to-channel) | **Gap** | `v0.3.0-beta` |
| Integrations | Calendar sync (Google/Outlook) | **Gap** | `TBD` |
| Quality | Accessibility parity with Slack shortcuts | **Partial** | `v0.2.0-alpha` |
| Quality | Internationalization beyond three locales | **Gap** | `TBD` |

---

## 20. How to use this map in delivery

1. **Pick a Slack pillar** (e.g. “DMs + group DMs”) and copy rows into a PRD or epic with acceptance tests; carry **`Target (semver)`** into the epic title or milestone field.  
2. **Decide engine dependency:** pure Next + Postgres + S3, vs optional Mattermost for WebSocket/plugin ecosystem.  
3. **Update** [`parity-reference-matrix.md`](./parity-reference-matrix.md) **section 5** when status changes (keep that table small; use this doc for detail).  
4. **Update** root [`README.md`](../README.md) **roadmap** when “Gap” becomes “Planned” for communicable commitments, then **reconcile `Target (semver)` here** so planning bands stay consistent.

---

## Related docs

| Doc | Role |
|-----|------|
| [`parity-reference-matrix.md`](./parity-reference-matrix.md) | Condensed parity table |
| [`architecture-technical.md`](./architecture-technical.md) | Fortress UI, APIs, scale topology |
| [`NORTH-STAR-A.md`](./NORTH-STAR-A.md) | SSE + registration |
| [`ROADMAP-PHASES-AND-LAYERS.md`](./ROADMAP-PHASES-AND-LAYERS.md) | Phases vs stack slices |
| [`phase-1/mattermost-api-map.md`](./phase-1/mattermost-api-map.md) | Historical REST map to MM routes |
