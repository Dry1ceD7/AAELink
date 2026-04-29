# Phases 2–4: upstream trace at `v11.6.1` (AAELink engine)

**Identity:** **AAELink** = application; **Advanced ID Asia Engineering Co., Ltd.** = company.

This is a **read map** of the real tree under **`AAELinkPowered/vendor/upstream/`** checked out at git tag **`v11.6.1`** (commit `ffee10a61081dcc058f92fe65ba138804c3ca73b`). Use it to continue the plan: **do not hand-write** SQL or routing from memory—follow these files when auditing, forking, or porting.

**Path names** in the tables below (`cmd/mattermost`, `mattermost-redux`, and similar) are **unchanged in the cloned engine tree**; they are upstream directory and package names, not **AAELink** product branding.

**Deeper layers:** Phase 3 (real-time), Phase 4 (frontend), and Phase 5 (operations) now have dedicated guides—see **See also** at the bottom.

**Get the tree:** `../AAELinkPowered` → `AAELINK_UPSTREAM_GIT_REF=v11.6.1 zsh scripts/clone-upstream-engine.zsh` → then `cd vendor/upstream && git checkout v11.6.1`.

**Next.js product (this monorepo):** Nothing in the tables below lives under `AAELink/app/` — that stack is mapped in [`architecture-technical.md`](./architecture-technical.md) and [`WHERE-IS-THE-ENGINE.md`](./WHERE-IS-THE-ENGINE.md).

---

## Phase 2 — Core server, config, HTTP API, database

### Process entry and wiring

| Step | Path | Notes |
|------|------|--------|
| `main` | `server/cmd/mattermost/main.go` | Delegates to `commands.Run` |
| CLI / `server` command | `server/cmd/mattermost/commands/server.go` | `serverCmdF` → `config.NewStoreFromDSN` → `runServer` |
| Server assembly | `server/cmd/mattermost/commands/server.go` (`runServer`) | `app.NewServer(...)` with options (`app.ConfigStore`, `app.StartMetrics`, …) |
| REST API registration | same file | `api4.Init(server)` |
| WebSocket API init | same file | `wsapi.Init(server)` |
| Static / SPA handler | same file | `web.New(server)` |
| Start | same file | `server.Start()` |

Config loading uses the **`server/config`** package (import path in Go modules may include `/v8/`; on disk it is under `server/config/`). The application core lives under **`server/channels/app`**.

### PostgreSQL schema (migrations)

| Location | Role |
|----------|------|
| `server/channels/db/migrations/postgres/*.up.sql` | Ordered migrations for the main product database |
| `server/config/migrations/postgres/*.up.sql` | Configuration store (separate from channel DB migrations) |

**Important:** table creation is **not** always migration `000001`. Example: `users` is introduced in **`000046_create_users.up.sql`** (historical ordering). For AAELink-as-upstream, **run the server’s migrator** or apply the full migration set in order—never paste a single “bootstrap” script as the full schema.

Persistence implementations are under **`server/channels/store/`** (interfaces + `sqlstore` and related).

### Authentication and sessions

Trace from **`server/channels/api4`** handlers into **`server/channels/app`** (session attach, MFA, OAuth). Types live under **`server/public/model`**. Exact files change between minors—use repo search for `Session`, `Mfa`, `Login` from `api4/`.

---

## Phase 3 — Real-time WebSocket hub

| Component | Path | Role |
|-----------|------|------|
| Hub / broadcast | `server/channels/app/platform/web_hub.go` | Connection registry, broadcast queues, fan-out (large file; start from type defs at top) |
| WS action routing | `server/channels/app/platform/websocket_router.go` | `WebSocketRouter`, `ServeWebSocket`, action dispatch |
| WS API surface | `server/channels/wsapi/` | Initialized from `commands/server.go` via `wsapi.Init(server)` |

Event payloads use **`model.WebSocketEvent`** / related types in **`server/public/model`**.

---

## Phase 4 — Frontend (bundled web client)

| Area | Path | Role |
|------|------|------|
| Product UI | `webapp/channels/` | Channels, threads, modals, login, System Console |
| Shared libs | `webapp/platform/` | e.g. `mattermost-redux`, `client`, `components`, `types` |
| Root scripts | `webapp/package.json` | Workspace / build entry |

State is historically **Redux**-centric via **`webapp/platform/mattermost-redux`**; treat any Next.js rewrite as a **separate client** that must implement the same API + WebSocket contracts (derive from `api4` + client usage in `webapp/platform/client`).

---

## Practical order of operations (fork or study)

1. Build upstream once using **their** developer docs for **v11.6.1** (toolchain versions matter).
2. Run tests for `server/channels/...` after any change.
3. For **AAELink branding** with minimal risk: fork at `v11.6.1`, change `webapp/` strings/assets and rebuild; keep server diff small until you own the compliance story.

## See also

- [`architecture-technical.md`](./architecture-technical.md) — Next.js `app/` + `app/api/` map (not upstream paths)  
- [`WHERE-IS-THE-ENGINE.md`](./WHERE-IS-THE-ENGINE.md) — clone location vs Docker vs `npm run dev`  
- [`ROADMAP-PHASES-AND-LAYERS.md`](./ROADMAP-PHASES-AND-LAYERS.md) — phases vs stack slices; how this trace doc fits Phase 2–4  
- [`PHASE1-REPOSITORY-BLUEPRINT.md`](./PHASE1-REPOSITORY-BLUEPRINT.md) — Phase 1 complete: target tree, dependencies, upstream map  
- [`PHASE2-SERVER-DATA-LAYER.md`](./PHASE2-SERVER-DATA-LAYER.md) — Phase 2 goals and reading order  
- [`PHASE3-REALTIME-WEBSOCKET-LAYER.md`](./PHASE3-REALTIME-WEBSOCKET-LAYER.md) — Phase 3: WebSocket hub and `wsapi` in depth  
- [`PHASE4-FRONTEND-LAYER.md`](./PHASE4-FRONTEND-LAYER.md) — Phase 4: `webapp/` workspaces and build  
- [`PHASE5-OPERATIONS-LAYER.md`](./PHASE5-OPERATIONS-LAYER.md) — Phase 5: production operations  
- [`PHASE6-GO-DEVELOPMENT-MACBOOK.md`](./PHASE6-GO-DEVELOPMENT-MACBOOK.md) — Phase 6: full Go dev on macOS  
- [`PHASE7-END-TO-END-DEV-LOOP.md`](./PHASE7-END-TO-END-DEV-LOOP.md) — Phase 7: `make run` (server + webapp)  
- [`ARCHITECTURE-AAELINK-STACK.md`](./ARCHITECTURE-AAELINK-STACK.md) — product slices and deployment map  
- [`BRANDING.md`](./BRANDING.md) — env + System Console branding for the stock image  
- [`../AAELinkPowered/CONTRIBUTING.md`](../AAELinkPowered/CONTRIBUTING.md) — fork, license, shallow clone  
- [`../AAELinkPowered/docs/UPSTREAM-ARCHITECTURE.md`](../AAELinkPowered/docs/UPSTREAM-ARCHITECTURE.md) — high-level monorepo map  
