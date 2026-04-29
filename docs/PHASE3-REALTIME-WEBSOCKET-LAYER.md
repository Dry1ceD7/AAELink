# Phase 3 — Real-time and WebSocket layer

**Identity:** **AAELink** (product) · **Advanced ID Asia Engineering Co., Ltd.** (company).

**Prerequisites:** [`PHASE2-SERVER-DATA-LAYER.md`](./PHASE2-SERVER-DATA-LAYER.md) (or equivalent familiarity with `app.NewServer` and `api4`). **Paths:** [`PHASE2-4-UPSTREAM-TRACE-v11.6.1.md`](./PHASE2-4-UPSTREAM-TRACE-v11.6.1.md) § Phase 3.

**Clone:** `AAELinkPowered/vendor/upstream/` at **`v11.6.1`**.

This layer is how the server keeps browsers and native clients **in sync** (posts, typing, presence, reactions, etc.). AAELink on Docker uses this unchanged inside the image; this doc is for **audit, fork, or replacement** planning.

**Next.js app (this monorepo):** Channel realtime for the shipped product uses **SSE** on `/api/collab/events` (see [`NORTH-STAR-A.md`](./NORTH-STAR-A.md) and [`architecture-technical.md` §5](./architecture-technical.md#5-realtime-design)), not upstream WebSockets.

---

## 3.1 Architecture (conceptual)

| Piece | Role |
|-------|------|
| **Hub** (`WebHub`) | Per-user or scoped fan-out: registers `WebConn`, queues outbound messages, reap idle connections |
| **Router** (`WebSocketRouter`) | Dispatches inbound **actions** (`model.WebSocketRequest`) to handlers by string action name |
| **WS API** (`wsapi` package) | Registers user/system/status actions on the router; ties HTTP-upgraded connections to `app.App` |
| **`WebConn`** | One browser (or client) connection: user id, session token, locale, underlying `WebSocket` |
| **Events** (`model.WebSocketEvent`, etc.) | Broadcast payloads to channel/team/user scopes |

High-volume paths use **queues and goroutines** (see constants at top of `web_hub.go`, e.g. `broadcastQueueSize`).

---

## 3.2 Read order (upstream `server/`)

1. `server/channels/app/platform/websocket_router.go` — `WebSocketRouter`, `ServeWebSocket`, auth errors
2. `server/channels/wsapi/api.go` — `Init(s *app.Server)` wires `InitUser`, `InitSystem`, `InitStatus`
3. `server/channels/wsapi/user.go`, `system.go`, `status.go` — concrete actions
4. `server/channels/wsapi/websocket_handler.go` — `ServeWebSocket` wrapper: session load, `GetHubForUserId`, `hub.SendMessage`
5. `server/channels/app/platform/web_hub.go` — hub implementation (large; read types and `Register`/`Broadcast`/`Start` patterns first)
6. `server/public/model/client.go` and websocket-related types in `server/public/model/` — wire format the webapp expects

---

## 3.3 HTTP upgrade path (where WS attaches to HTTP)

The WebSocket listener is registered from the same server bootstrap as REST (see `server/cmd/mattermost/commands/server.go`: `wsapi.Init(server)` after `api4.Init`). Trace **`channels/web`** for route registration that upgrades to WS (search for `websocket`, `WebSocket`, or `api` route setup under `server/channels/web`).

Exact handler names can shift by release; use **`rg -n websocket server/channels/web`** in `vendor/upstream`.

---

## 3.4 “Done” for Phase 3 (planning / fork prep)

| Goal | Evidence |
|------|----------|
| Explain login → WS connect | You can point from client upgrade URL to `WebConn` creation |
| Explain broadcast path | Post create → store → hub `Publish` / `Broadcast` (trace one event end-to-end) |
| Load / HA | You know whether you run single-node (Docker) vs clustered hubs (enterprise/topology docs upstream) |

---

## 3.5 Handoff to Phase 4

Open [`PHASE4-FRONTEND-LAYER.md`](./PHASE4-FRONTEND-LAYER.md): the webapp **client** must speak the same action set and event types you traced here.

## See also

- [`ROADMAP-PHASES-AND-LAYERS.md`](./ROADMAP-PHASES-AND-LAYERS.md) — phases vs stack slices  
- [`PHASE5-OPERATIONS-LAYER.md`](./PHASE5-OPERATIONS-LAYER.md) — TLS, proxy timeouts, and WS sticky sessions in production  
