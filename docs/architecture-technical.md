# AAELink — Technical architecture

Internal technical view of how the product is built, how data moves, and how the stack is expected to scale. For **Slack/Mattermost capability parity**, see [`parity-reference-matrix.md`](./parity-reference-matrix.md).

**If you are looking for files on disk:** Docker engine vs Next.js vs `vendor/upstream` — [`WHERE-IS-THE-ENGINE.md`](./WHERE-IS-THE-ENGINE.md).

---

## 1. Scope: what this repo implements vs the platform README

| Layer | In this repository | Described in README / Compose (verify separately) |
|-------|--------------------|---------------------------------------------------|
| UI | Next.js 16 App Router (`app/`), React 19, Tailwind v4 | Desktop shell in `desktop/` (Electron) |
| HTTP API | Route handlers under `app/api/**` | May be complemented by separate HTTP services in a split deployment (not in this tree by default) |
| Database access | `pg` from Node route handlers | Same Postgres; connection pooling at edge |
| Files | S3-compatible SDK usage, presigned patterns | MinIO in dev |
| Realtime to browser | SSE (`/api/collab/events`, notification stream) | NATS mentioned for bus-scale fan-out |
| Cache / sessions | Cookies + server session (per routes) | Redis for session/rate-limit at scale |

Treat anything not imported or configured in this tree as a **deployment target**, not a guaranteed local dev path.

---

## 2. Logical architecture (C4-style, level 1)

```
Clients (web, desktop)
        │
        ▼
┌───────────────────┐
│  TLS / reverse    │  Traefik (prod), Next dev server (local)
│  proxy            │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  Next.js BFF      │  SSR/CSR pages + `app/api/*` Route Handlers
│  - cookies        │
│  - JSON APIs      │
│  - SSE streams    │
└─────────┬─────────┘
          │
    ┌─────┴─────┬─────────────┐
    ▼           ▼             ▼
 Postgres    Object store    (optional Redis / NATS / search)
```

---

## 3. Module to API surface (grounded)

| Module | Primary routes | Realtime / side effects |
|--------|----------------|-------------------------|
| Auth | `/api/auth/*`, `/api/auth/me` | Email for verify / reset flows |
| Workspaces | `/api/workspaces`, `/api/workspaces/[id]` | — |
| Channels | `/api/channels` | Collab membership |
| Messages | `/api/messages`, `/api/messages/[id]`, `/api/messages/search`, `/api/messages/reactions` | SSE `collab/events`, typing, read-state |
| Collab | `/api/collab/events`, `presence`, `typing`, `read-state`, `users`, `workspace-members` | SSE primary; polling fallback per `NORTH-STAR-A.md` |
| Tickets | `/api/tickets`, `/api/tickets/[id]`, `/api/tickets/[id]/messages` | Invalidate / refresh patterns in UI |
| Documents | `/api/documents`, `download`, `ocr` | Async OCR implied; job orchestration TBD |
| Notifications | `/api/notifications`, `/api/notifications/stream` | SSE stream; PATCH for read state |
| Admin | `/api/admin/*` | Privileged mutations |
| Support | `/api/support/*` | OTP, emergency queue |

---

## 4. Data and consistency

| Concern | Current pattern | Scale / hardening direction |
|---------|-----------------|----------------------------|
| System of record | PostgreSQL schema `aaelink` | Migrations versioned; avoid dual writes without outbox |
| File metadata | DB + object keys | Virus scan async before “trusted” flag (job) |
| Search | `messages/search` (SQL-backed in practice) | OpenSearch index + worker (Mattermost-style split) |
| Idempotency | Per-endpoint | Add `Idempotency-Key` on creates (messages, tickets) |
| Side effects (email, index) | Inline or fire-and-forget in routes | Outbox table or NATS JetStream consumers |

---

## 5. Realtime design

| Stream | Path | Client behavior |
|---------|------|-----------------|
| Channel collab | `GET /api/collab/events?…` | `EventSource`; reconnect on error |
| Notifications | notification stream route | Same family; auth via session cookie |

Constraints and registration flags: [`NORTH-STAR-A.md`](./NORTH-STAR-A.md).

---

## 6. Client shell — “fortress” interaction model

Cross-cutting UI rules for modals, drawers, and global shortcuts:

| Mechanism | Implementation intent |
|-----------|-------------------------|
| Overlay host | `createPortal(…, document.body)` for blocking UI |
| Background | `inert` on `<main>` when shell-blocking overlays are active |
| Tickets compose | Reports `onBlockingOverlayChange` so home includes tickets in the same `inert` + `overflow: hidden` contract |
| Focus | Save prior focus on open; restore on close (`useLayoutEffect` + rAF where needed) |
| Keyboard | Tab traps on modal roots; Escape handled in capture phase where it must win over global handlers |
| Notifications popover | Bell remains inside `main`; popover does **not** use `main inert` — uses local trap + Escape + focus restore |

**Recommendation:** centralize “blocking overlay” into a small registry (stack + z-index constants) as more surfaces port to body.

---

## 7. Security boundaries (technical)

| Boundary | Notes |
|----------|--------|
| Session | HttpOnly cookies; no long-lived tokens in `localStorage` for desktop auth (per product ruleset) |
| CSRF | Same-site cookies + POST JSON patterns; review for any form posts |
| Authorization | Workspace-scoped checks on tickets/messages (see README isolation rules) |
| Admin | Separate routes; role checks server-side |
| File access | Presigned URLs; short TTL; permission check before sign |

---

## 8. Observability and operations

**Default dev stack** (`docker-compose.yml` + `npm run dev`) does not start Prometheus, Grafana, or Loki; the app exposes normal HTTP logs and in-app health where implemented. **Optional** bundles and k8s references live under `infra/` and in phase operations docs (`PHASE5`, `ROADMAP`).

| Signal | Direction |
|--------|-----------|
| HTTP metrics | Add at reverse proxy or app when you adopt a full ops stack |
| Logs | Node/Next stdout today; ship to your log stack in production |
| Traces | OpenTelemetry when multi-service split lands |

---

## 9. Target scale topology (reference — not all in-tree)

When message volume and search exceed Postgres comfort:

1. **Write path** unchanged: Postgres remains SoR.
2. **Outbox** row per side effect → publisher → NATS.
3. **Consumers:** indexer (OpenSearch), email sender, AV scanner, webhook dispatcher.
4. **Read path:** search hits OpenSearch; hydrate permissions from DB or denormalized ACL snapshot.

This mirrors Mattermost’s **app + jobs + Elasticsearch** split without requiring Slack’s closed design.

---

## 10. Technical follow-ups (ordered)

1. Document **OpenSearch index mappings** for messages, tickets, document metadata.
2. Add **idempotency** and **request dedupe** for high-value POST APIs.
3. Introduce **outbox** (table or stream) before adding heavy async workers.
4. **Fortress:** overlay registry + z-index token file shared with CSS.
5. **E2E:** Playwright + axe on login, home chat, tickets compose, notifications popover.

---

## Related docs

| Doc | Role |
|-----|------|
| [`parity-reference-matrix.md`](./parity-reference-matrix.md) | Slack/Mattermost parity vs AAELink |
| [`architecture-ecosystem-map.md`](./architecture-ecosystem-map.md) | Index hub for technical + parity |
| [`NORTH-STAR-A.md`](./NORTH-STAR-A.md) | Realtime + registration |
| [`README.md`](../README.md) | Public stack and roadmap |
| [`ARCHITECTURE-AAELINK-STACK.md`](./ARCHITECTURE-AAELINK-STACK.md) | Pinned Mattermost Team Edition engine, phase docs, Compose topology |
| [`ROADMAP-PHASES-AND-LAYERS.md`](./ROADMAP-PHASES-AND-LAYERS.md) | Which phase document to read next |
