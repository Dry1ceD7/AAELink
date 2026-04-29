# AAELink — Parity reference matrix

Capability and **parity** view: how **AAELink** compares to a **Slack-class** workspace product, with **Mattermost** as a secondary reference where Slack implementation detail is not public. For **layers, storage, and runtime architecture**, see [`architecture-technical.md`](./architecture-technical.md). For the **exhaustive** pillar-by-pillar map (including components easy to miss) and a **`Target (semver)`** column on every row, see [`parity-slack-mattermost-aaelink-full-map.md`](./parity-slack-mattermost-aaelink-full-map.md).

---

## 1. How to read parity states

| State | Meaning |
|-------|---------|
| **Shipped** | In current alpha as described in `README.md` or clearly present in `app/` + APIs |
| **Partial** | Exists but not full parity with the reference (UX, policy, or scale) |
| **Planned** | Explicitly on README roadmap |
| **Gap** | Not described or not present; work not scheduled |

---

## 2. Reference axes (product taxonomy)

| Axis | Includes |
|------|-----------|
| Surfaces | Web, desktop, mobile, email, OS notifications |
| Core collaboration | Orgs/workspaces, channels, DMs, messages, files, search |
| Realtime | Presence, typing, read state, delivery |
| Work management | Tickets, tasks, approvals |
| Knowledge | Pins, saves, wiki/docs |
| Platform | Apps, webhooks, slash commands, workflows |
| Enterprise | SSO, SCIM, audit, retention, legal hold, DLP, export |
| Operations | Observability, backups, rate limits |

---

## 3. Slack-class reference checklist (capability model)

Slack internals are proprietary; this table is a **normalized feature taxonomy** for planning only.

### 3.1 Clients and session

| Area | Reference capabilities |
|------|------------------------|
| Clients | Web, desktop, iOS, Android |
| Session | Secure session, device list, revoke, MFA policies |

### 3.2 Organization and navigation

| Area | Reference capabilities |
|------|------------------------|
| Org / workspace | Multi-workspace, switching, branding |
| Sidebar | Channels, DMs, apps, unread, sections |
| Channels | Public, private, shared, archived |
| Membership | Invite, join requests, guests |

### 3.3 Messaging

| Area | Reference capabilities |
|------|------------------------|
| Core | Rich text, threads, reactions, edits, deletes |
| Files | Uploads, previews, enterprise malware scanning |
| Composer | Drafts, attachments, shortcuts |
| Discovery | Pins, saves, reminders, global search |

### 3.4 Realtime and notifications

| Area | Reference capabilities |
|------|------------------------|
| Transport | WebSocket and/or SSE; mobile push |
| Signals | Typing, presence, read receipts |
| Preferences | Mutes, keywords, DND schedules |

### 3.5 Calls and meetings

| Area | Reference capabilities |
|------|------------------------|
| Voice/video | Calls, huddles, screen share, recording policy |

### 3.6 Apps and automation

| Area | Reference capabilities |
|------|------------------------|
| Extensibility | OAuth apps, bots, slash commands, workflows, webhooks |

### 3.7 Enterprise

| Area | Reference capabilities |
|------|------------------------|
| Identity | SAML, OIDC, SCIM |
| Compliance | Audit log, retention, legal hold, e-discovery export, DLP |

---

## 4. Mattermost — public patterns used for parity hints

When Slack’s design is unknown, these **Mattermost** components define engineering expectations:

| Pattern | Parity hint for AAELink |
|---------|-------------------------|
| PostgreSQL SoR | Already aligned |
| Elasticsearch / OpenSearch | Needed for Slack-grade global search at scale |
| Job server | Index rebuild, compliance export, bulk email |
| S3 file store | Aligned; add async AV scan for enterprise file parity |
| Push proxy | Needed when mobile ships |
| Plugins | Analogue to Slack apps — future |

---

## 5. Parity matrix — reference → AAELink

| Slack-class bucket | AAELink | Notes |
|--------------------|---------|--------|
| Multi-workspace | **Partial** | Workspaces + switcher; sidebar “sections” not equivalent |
| Channel types (public/private) | **Partial** | Channels API; validate invite + ACL matrix |
| DMs & group DMs | **Planned** | README “Next” |
| Threads | **Partial** | UI + APIs; confirm notification + search coverage |
| Reactions | **Partial** | `/api/messages/reactions` |
| Link unfurls | **Gap** | Worker + cache + allowlist |
| Pins / saves / reminders | **Gap** | New persistence + UI |
| Global search | **Partial** | `messages/search`; index tier TBD |
| File malware scan | **Gap** | Async job after upload |
| Slash commands | **Gap** | Palette without server command registry |
| Workflow builder | **Gap** | Tie to roadmap “Approvals and workflows” |
| Federated channels (Slack Connect) | **Gap** | Cross-org trust — only if required |
| Voice / video | **Gap** | WebRTC program |
| Mobile + push | **Gap** | Push proxy pattern (Mattermost) |
| SSO / SCIM | **Planned** | Entra in README “Later” |
| Unified audit UI + export | **Partial** | Admin exists; deepen |
| Retention / legal hold | **Gap** | Policy engine + storage |
| E-discovery export | **Gap** | Job + manifest |
| Third-party apps | **Gap** | OAuth + webhooks |

---

## 6. Non-Slack “enterprise workspace” maturity items

These affect **trust and operations**, not just feature checkboxes:

| Item | AAELink direction |
|------|-------------------|
| Idempotent writes | API design |
| Outbox for side effects | Async architecture |
| Rate limits / abuse | Edge or middleware |
| Structured audit stream | DB or log pipeline |
| Backup / restore runbooks | Ops |
| Feature flags | Config |
| Accessibility regression | E2E + axe |

---

## 7. Phased parity (product phases)

| Phase | Parity focus |
|-------|----------------|
| **Alpha (now)** | Tickets, documents seed, notifications, collab primitives, fortress modals |
| **Next** | Chat + DM + channel model closer to Slack sidebar norms |
| **Next+1** | Lightweight workflows / approvals |
| **Scale** | Search index + job workers (Mattermost-style) |
| **Enterprise** | SSO, SCIM, retention, export |
| **Voice** | Separate program (Slack huddles class) |

---

## 8. When to update this matrix

- On each **release**: move rows **Gap → Partial → Shipped** with evidence (route, UI, or doc).
- When **roadmap** changes in `README.md`, adjust section 7 and affected rows in section 5.

---

## Related docs

| Doc | Role |
|-----|------|
| [`architecture-technical.md`](./architecture-technical.md) | Runtime, storage, fortress, scale topology |
| [`architecture-ecosystem-map.md`](./architecture-ecosystem-map.md) | Index linking technical + parity |
| [`README.md`](../README.md) | Public roadmap and shipped list |
| [`ARCHITECTURE-AAELINK-STACK.md`](./ARCHITECTURE-AAELINK-STACK.md) | Engine pin, phases, upstream layout |
| [`WHERE-IS-THE-ENGINE.md`](./WHERE-IS-THE-ENGINE.md) | Docker vs Next.js vs `vendor/upstream` on disk |
| [`phase-1/mattermost-api-map.md`](./phase-1/mattermost-api-map.md) | Historical API surface mapping (reference) |
| [`parity-slack-mattermost-aaelink-full-map.md`](./parity-slack-mattermost-aaelink-full-map.md) | Full Slack/Mattermost → AAELink capability and framework map |
