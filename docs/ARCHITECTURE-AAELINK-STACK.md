# AAELink stack architecture (engine source to deployment)

**Product identity:** **AAELink** is the **application name** users see. **Advanced ID Asia Engineering Co., Ltd.** is the **company / legal entity** on the login line and in email feedback defaults (see `BRANDING.md` and `.env.example`).

This document answers: **what makes the Team Edition–line engine a complete collaboration product**, how that differs from **this repository**, and how **AAELink** maps onto each layer—without treating a full greenfield rewrite as a small task.

## Pinned engine release (matches `AAELink/docker-compose.yml`)

| Item | Value |
|------|--------|
| **Public engine monorepo** | [github.com/mattermost/mattermost](https://github.com/mattermost/mattermost) (historic upstream path; clone or fork for source) |
| **Git tag** | `v11.6.1` |
| **Release page** | [releases/tag/v11.6.1](https://github.com/mattermost/mattermost/releases/tag/v11.6.1) |
| **Tag points to commit** | `ffee10a61081dcc058f92fe65ba138804c3ca73b` (verify with `git rev-parse v11.6.1` after fetch) |
| **Container image (registry path)** | `mattermost/mattermost-team-edition:11.6.1` — **AAELink** is your deployment; this is the prebuilt Team Edition image name on the public registry |

**Shallow clone at the same revision** (large tree; use beside AAELink for diff review—see `AAELinkPowered`):

```bash
cd /Users/d7y1ce/AAE/AAELinkPowered
AAELINK_UPSTREAM_GIT_REF=v11.6.1 zsh scripts/clone-upstream-engine.zsh
```

That lands under `AAELinkPowered/vendor/upstream/` (gitignored). For a full fork with remotes, follow `../AAELinkPowered/CONTRIBUTING.md`.

### This repository — Next.js app (technical + parity)

The phase table below targets the **pinned Mattermost Team Edition** engine (`AAELinkPowered` / Compose). The **Next.js** product in **this** repo has its own architecture and Slack-class parity tracking:

| Document | Purpose |
|----------|---------|
| [`architecture-ecosystem-map.md`](./architecture-ecosystem-map.md) | Hub linking the two docs below |
| [`architecture-technical.md`](./architecture-technical.md) | Layers, `app/api` map, realtime, fortress shell, scale topology |
| [`parity-reference-matrix.md`](./parity-reference-matrix.md) | Shipped / partial / planned / gap vs Slack and Mattermost patterns |

### Documentation phase index

**Phases vs parts of the stack:** [`ROADMAP-PHASES-AND-LAYERS.md`](./ROADMAP-PHASES-AND-LAYERS.md) (where you are, what to read next).

| Phase | Document | Purpose |
|-------|----------|---------|
| **1** | [`PHASE1-REPOSITORY-BLUEPRINT.md`](./PHASE1-REPOSITORY-BLUEPRINT.md) | Target monorepo tree, resource map, dependency matrix, upstream top-level |
| **2** | [`PHASE2-SERVER-DATA-LAYER.md`](./PHASE2-SERVER-DATA-LAYER.md) | Server + Postgres + auth: goals, reading order, `server/Makefile` hooks |
| **2–4 trace** | [`PHASE2-4-UPSTREAM-TRACE-v11.6.1.md`](./PHASE2-4-UPSTREAM-TRACE-v11.6.1.md) | Exact file paths under `vendor/upstream` at **`v11.6.1`** |
| **3** | [`PHASE3-REALTIME-WEBSOCKET-LAYER.md`](./PHASE3-REALTIME-WEBSOCKET-LAYER.md) | Hub, router, `wsapi`, `WebConn`, read order, upgrade path hints |
| **4** | [`PHASE4-FRONTEND-LAYER.md`](./PHASE4-FRONTEND-LAYER.md) | `webapp/` workspaces, dev/build commands, state + client entrypoints |
| **5** | [`PHASE5-OPERATIONS-LAYER.md`](./PHASE5-OPERATIONS-LAYER.md) | TLS, proxy, backups, observability, calls/mobile/push checklist |
| **6** | [`PHASE6-GO-DEVELOPMENT-MACBOOK.md`](./PHASE6-GO-DEVELOPMENT-MACBOOK.md) | **Full Go dev:** toolchain, `BUILD_ENTERPRISE=false`, `make` / `go build`, bootstrap script |
| **7** | [`PHASE7-END-TO-END-DEV-LOOP.md`](./PHASE7-END-TO-END-DEV-LOOP.md) | **Server + webapp:** `make run`, `webapp` deps, `make dist` vs dev client, `make stop` |

### Continuing the plan after the pin

1. **Phase 2** — `PHASE2-SERVER-DATA-LAYER.md` + `PHASE2-4-UPSTREAM-TRACE-v11.6.1.md` § Phase 2.  
2. **Phase 3** — `PHASE3-REALTIME-WEBSOCKET-LAYER.md` (real-time).  
3. **Phase 4** — `PHASE4-FRONTEND-LAYER.md` (web client / fork branding).  
4. **Phase 5** — `PHASE5-OPERATIONS-LAYER.md` (production ops).  
5. **Phase 6** — `PHASE6-GO-DEVELOPMENT-MACBOOK.md` + `AAELinkPowered/scripts/bootstrap-go-dev.zsh` (native Go on MacBook).  
6. **Phase 7** — `PHASE7-END-TO-END-DEV-LOOP.md` + `AAELinkPowered/scripts/bootstrap-e2e-dev.zsh` (full **`make run`** loop).

## 1. What “the full app” is (product slices)

| Slice | Role | Typical location in engine monorepo | AAELink today |
|-------|------|-------------------------------------|---------------|
| HTTP API and real-time hub | Auth, teams, channels, posts, files, jobs, plugins, WebSockets | `server/` (Go) | Same code paths inside the **pinned Team Edition** container image |
| Web client | Primary UI (React), bundled with server release | `webapp/` | Same bundle inside the image; **AAELink** naming / logo / links partly via `MM_*` env and System Console |
| Database | Relational state | PostgreSQL (you run `postgres` service) | Yes |
| File storage | Uploads, attachments | In-container paths such as `/mattermost/data` (upstream image layout) or S3-compatible (System Console / env) | Local volumes in Compose |
| Search | Post and file search | Built into server | Whatever the pinned image supports for that release |
| Job runner | Scheduled tasks, imports, indexing helpers | Inside `server/` | Same |
| Plugin runtime | Extensions, slash commands, integrations | Server + `client/plugins` tree in webapp | Enabled in Compose; marketplace URL may remain the default catalog unless you host a compatible registry |
| Real-time calls (voice/video) | WebRTC sessions, ICE/TURN | Server + client; TURN is yours to operate | Configure in System Console when you need production-grade calls |
| Mobile / desktop clients | Native apps talking to your Site URL | Separate engine-line repositories and stores | Point clients at **`MM_SERVICESETTINGS_SITEURL`**; full in-app **AAELink** rebranding is **not** env-only |
| Push notifications | APNS/FCM via proxy or vendor path | Optional **push proxy** or cloud connector in scaled setups | Add when you leave single-host MacBook trial |

Nothing in the list above is missing for a complete **AAELink** deployment on Team Edition; this workspace ships **AAELink** as a **branded, pinned-image** rollout of that engine—not a second independent implementation of every line of Go and React.

## 2. Engine monorepo layout (conceptual)

The public repository linked above is the **source-of-truth tree** for a given release line. At a high level:

- **`server/`** — Go services: REST and WebSocket API, business logic, data access, clustering hooks, plugin API, jobs.
- **`webapp/`** — React application: channels, threads, admin console, login, settings, plugin client hooks.
- **Tests and tooling** — e2e, load tests, packaging, CI definitions, often under `e2e/`, `Makefile`, `.github/`, and package scripts.
- **Plugins and examples** — first-party plugins or references (exact paths vary by tag).

Release **Docker images** compile `server` and ship a **prebuilt** `webapp` bundle so operators do not build from source on every install.

## 3. Runtime topology (single node vs production)

**Minimal complete stack (what you run now)**

- One **application container** (Team Edition image).
- One **PostgreSQL** instance.
- Persistent volumes for **config**, **data**, **logs**.

**Common production additions (same engine family, scaled)**

- Reverse proxy (TLS termination, `X-Forwarded-*`, rate limits).
- Object storage (S3-compatible) for files at scale.
- Redis or other cache when clustering or certain performance profiles require it.
- Dedicated **push proxy** and push credentials for mobile reliability.
- **TURN** server for calls through restrictive networks.
- Backups, monitoring, log shipping.

**AAELink** does not need a different architecture to be “complete”; it needs **your** Site URL, **your** branding policy, **your** ops extras, and optionally **your** fork if every string and icon must read **AAELink**.

## 4. What this repo (`AAELink/`) actually contains

| Artifact | Purpose |
|----------|---------|
| `docker-compose.yml` | Wires Postgres + Team Edition image + env-driven **AAELink** naming and support links |
| `.env.example` | Documents `MM_*` and company branding variables |
| `docs/BRANDING.md` | Login text, logo upload, marketplace caveat, attribution |
| `scripts/` | Local lifecycle helpers |

It does **not** vendor the entire engine tree; for a shallow clone beside this workspace, use **`AAELinkPowered`** per `../AAELinkPowered/CONTRIBUTING.md`.

## 5. “Rewrite everything for AAELink” — realistic meanings

| Goal | Effort class | Notes |
|------|--------------|--------|
| Users see **AAELink** and company on login and email footers | Low | Already covered by Compose + `docs/BRANDING.md` + System Console logo |
| No default outbound links to third-party marketing/support hosts | Low–medium | Support URLs, notices, diagnostics flags as in Compose |
| Replace **every** UI string, icon, and mobile app identity with **AAELink** | Very high | Requires **maintained fork** of `webapp/` and mobile repos, plus legal review of upstream marks and redistribution |
| New product that **behaves** like Team Edition but is independent code | Extreme | Multi-year; duplicates security, compatibility, mobile, plugin ecosystem |

## 6. Recommended path if you outgrow env-only branding

1. Fork the public engine monorepo per **`../AAELinkPowered/CONTRIBUTING.md`** (keep `upstream` remote, track a release tag).
2. Branch prefix such as `aae/` for company-only deltas; merge or rebase from `upstream` regularly for security fixes.
3. Change **product strings and assets** in `webapp/` (and mobile repos if needed); run upstream tests before shipping images.
4. Build **private** container images from your fork; point `AAELink/docker-compose.yml` at **your** registry and digest-pinned tags.

## 7. License and attribution (short)

Team Edition is open source under the engine’s upstream terms; **Enterprise** features and commercial modules are a different story—do not enable or redistribute what your license does not cover.

Names, logos, and binary distributions belonging to the **upstream vendor** still apply to **their** unmodified releases and to references inside the cloned tree. **AAELink** is how **Advanced ID Asia Engineering Co., Ltd.** brands *this* deployment and any binaries you lawfully build from a fork. Details: `../AAELinkPowered/CONTRIBUTING.md`.

## See also

- `docs/ROADMAP-PHASES-AND-LAYERS.md` — phases (1–7) mapped to stack slices; next-step table  
- `docs/BRANDING.md` — operational branding checklist  
- `../AAELinkPowered/CONTRIBUTING.md` — fork, sync, build-from-source overview  
- `README.md` — what this deployment runs on a MacBook vs server migration
