# Phase 6 — Full Go development (macOS, upstream `v11.6.1`)

**Identity:** **AAELink** = application you ship to users; **Advanced ID Asia Engineering Co., Ltd.** = company (login / email defaults in Compose).

**Prerequisites:** [`PHASE2-SERVER-DATA-LAYER.md`](./PHASE2-SERVER-DATA-LAYER.md), clone at **`v11.6.1`** (`AAELinkPowered/vendor/upstream/`). Team Edition lineage contributor setup (authoritative for your tag): [developer setup](https://developers.mattermost.com/contribute/developer-setup/).

This phase is **native Go (and usually Docker)** against the **upstream server** tree—not the small `AAELink/` Compose-only repo.

**Next.js:** Day-to-day product work in **`AAELink/`** is `npm run dev` (see [`WHERE-IS-THE-ENGINE.md`](./WHERE-IS-THE-ENGINE.md)); this phase is **upstream Go only**.

---

## 6.1 Toolchain (from `server/go.mod` at `v11.6.1`)

| Tool | Requirement |
|------|-------------|
| **Go** | Toolchain **`go 1.25.8`** (see `vendor/upstream/server/go.mod` line `go …`). Install with [go.dev/dl](https://go.dev/dl/) or `brew install go` if it provides a compatible version. |
| **Docker** | **Docker Desktop** (or Colima) running — `make run-server` / `make start-docker` start Postgres and deps via upstream compose. |
| **Node / npm** | Needed to build the **webapp** (`make build` / `make run-server` path uses `build-client`). Match **`webapp/package.json`** engines (at `v11.6.1`: **Node ^24**, **npm ^11**). Use `nvm` / `fnm` if needed. |

---

## 6.2 Team Edition builds (no Enterprise tree)

Default upstream Makefile may set **`BUILD_ENTERPRISE=true`**. For **Team Edition**-aligned local work without a separate `enterprise/` checkout:

```bash
export BUILD_ENTERPRISE=false
```

Pass it on every `make` invocation or `export` it in your shell for the session.

---

## 6.3 Quick paths (from `vendor/upstream/server/`)

| Goal | Command (illustrative) |
|------|-------------------------|
| **Create `go.work`** | `BUILD_ENTERPRISE=false make setup-go-work` |
| **Compile server CLI binary** | After `setup-go-work`: `go build -buildvcs=false -tags 'sourceavailable' -o bin/mattermost ./cmd/mattermost` (`./cmd/mattermost` is the engine tree entry package name; add `-ldflags` like upstream `Makefile` / `release.mk` if you need embedded `BuildNumber` / `BuildHash`). |
| **Prepackaged plugins + mmctl in `bin/`** | `BUILD_ENTERPRISE=false make prepackaged-binaries` (downloads plugins; network). |
| **Start dev databases** | `BUILD_ENTERPRISE=false make start-docker` |
| **Run server from source** | `BUILD_ENTERPRISE=false make run-server` (expects webapp `dist` / `make client` path—see upstream docs). |
| **Server + webapp dev** | `BUILD_ENTERPRISE=false make run` (heavy; read upstream README). |
| **Tests** | `BUILD_ENTERPRISE=false make test-server-quick` (uses `check-prereqs-enterprise`; starts Docker for full `test-server` path unless `MM_NO_DOCKER=true` where supported). |

**Apple Silicon:** upstream supports `darwin_arm64` builds (`build/release.mk`). Rosetta is not required for **native** Go builds (unlike the AAELink Docker image pin to `linux/amd64`).

---

## 6.4 Bootstrap script in this workspace

From **`AAELinkPowered`**, clone the engine tree if needed, then run the bootstrap:

```bash
AAELINK_UPSTREAM_GIT_REF=v11.6.1 zsh scripts/clone-upstream-engine.zsh   # once
zsh scripts/bootstrap-go-dev.zsh
```

The bootstrap checks clone presence, prints **`go`** vs `server/go.mod`, verifies **Docker**, then prints **`BUILD_ENTERPRISE=false`** **`make`** / **`go build`** commands for Team Edition.

For **server + webapp** (`make run`), run **`AAELinkPowered/scripts/bootstrap-e2e-dev.zsh`** and read **[`PHASE7-END-TO-END-DEV-LOOP.md`](./PHASE7-END-TO-END-DEV-LOOP.md)**.

---

## 6.5 Conflict with AAELink Docker on port 8065

Upstream dev server defaults to **8065**. If **`AAELink/docker compose`** is already bound to **8065**, either:

- `docker compose -f /Users/d7y1ce/AAE/AAELink/docker-compose.yml stop`, or  
- Override listen address / Site URL for the dev server per upstream env docs.

---

## 6.6 Handoff after Go dev works

When **`go build`** / **`make run-server`** prerequisites are clear, use **[`PHASE7-END-TO-END-DEV-LOOP.md`](./PHASE7-END-TO-END-DEV-LOOP.md)** for **`make run`** (server + webpack client). Then return to **[`PHASE3-REALTIME-WEBSOCKET-LAYER.md`](./PHASE3-REALTIME-WEBSOCKET-LAYER.md)** with a debugger (`make debug-server` or IDE **Delve**), or **[`PHASE4-FRONTEND-LAYER.md`](./PHASE4-FRONTEND-LAYER.md)** for webapp-only iteration.

## See also

- [`ROADMAP-PHASES-AND-LAYERS.md`](./ROADMAP-PHASES-AND-LAYERS.md) — phases vs stack slices  
- [`PHASE7-END-TO-END-DEV-LOOP.md`](./PHASE7-END-TO-END-DEV-LOOP.md) — **`make run`**, **`make dist`**, **`make stop`**  
- [`PHASE5-OPERATIONS-LAYER.md`](./PHASE5-OPERATIONS-LAYER.md) — when moving from laptop to shared environments  
