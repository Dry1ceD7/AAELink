# Phase 1 — Repository blueprint (complete)

**Identity:** **AAELink** = application; **Advanced ID Asia Engineering Co., Ltd.** = company.

**Status:** Phase 1 is **documentation-complete** in this file: full **AAELink target** tree, **resource allocation**, **dependency matrix**, and **engine monorepo mapping** at **`v11.6.1`**. It does **not** copy the full engine source into `AAELink/` (that remains a **fork** under `AAELinkPowered/vendor/upstream/` or your GitHub fork).

**Downstream:** Phase 2+ execution → [`PHASE2-SERVER-DATA-LAYER.md`](./PHASE2-SERVER-DATA-LAYER.md) and [`PHASE2-4-UPSTREAM-TRACE-v11.6.1.md`](./PHASE2-4-UPSTREAM-TRACE-v11.6.1.md).

**Product code in `AAELink/`:** The **Next.js** implementation (`app/`, `app/api/`) is **not** the upstream `server/` tree — see [`architecture-technical.md`](./architecture-technical.md).

---

## 1. Upstream monorepo (reference) — `v11.6.1`

Verified **top-level** layout of the [public AAELink engine monorepo](https://github.com/mattermost/mattermost) at **`v11.6.1`**:

| Path | Role |
|------|------|
| `server/` | Go: API v4, WebSockets, app layer, stores, migrations, plugins, `cmd/mattermost`, `enterprise/` |
| `webapp/` | React/TypeScript client workspace (`channels/`, `platform/`) |
| `api/` | API specs / OpenAPI-related artifacts |
| `e2e-tests/` | Browser E2E |
| `tools/` | Repo tooling |

---

## 2. AAELink target monorepo — full folder blueprint

Use this when you **greenfield** a long-lived `aaelink/` product repo **or** when you document how a **fork** of upstream maps into your release pipeline. Names are **suggestions**; adjust to your org standard.

```text
aaelink/
├── README.md
├── LICENSE
├── CONTRIBUTING.md
├── Makefile
├── .editorconfig
├── .gitignore
│
├── docs/
│   ├── architecture/
│   │   ├── 00-overview.md
│   │   ├── 01-runtime-topology.md
│   │   ├── 02-authn-authz.md
│   │   ├── 03-realtime-websocket.md
│   │   ├── 04-data-model.md
│   │   └── 05-observability-security.md
│   ├── runbooks/
│   └── adr/
│
├── infra/
│   ├── docker/
│   │   ├── compose.yaml
│   │   ├── Dockerfile.server
│   │   ├── Dockerfile.web
│   │   └── nginx/
│   ├── k8s/
│   ├── terraform/
│   └── ci/
│
├── deploy/
│   ├── helm/
│   └── scripts/
│       ├── migrate.sh
│       └── smoke.sh
│
├── sql/
│   ├── migrations/                 # if you own schema (greenfield)
│   └── seeds/
│
├── api/
│   ├── openapi/
│   └── events/                     # WebSocket event schemas
│
├── packages/
│   ├── api-types/
│   ├── validation/
│   └── config-schema/
│
├── apps/
│   ├── server/                     # Go: HTTP + WS + jobs (or: fork lives elsewhere; this wraps CI)
│   │   ├── cmd/
│   │   │   └── aaelink-server/
│   │   │       └── main.go
│   │   ├── internal/
│   │   │   ├── app/
│   │   │   ├── config/
│   │   │   ├── http/
│   │   │   │   ├── router.go
│   │   │   │   ├── middleware/
│   │   │   │   └── handlers/
│   │   │   ├── ws/
│   │   │   │   ├── hub.go
│   │   │   │   ├── conn.go
│   │   │   │   └── events.go
│   │   │   ├── authn/
│   │   │   ├── authz/
│   │   │   ├── store/
│   │   │   ├── sqlstore/
│   │   │   ├── jobs/
│   │   │   ├── files/
│   │   │   ├── search/
│   │   │   ├── plugins/
│   │   │   ├── notify/
│   │   │   └── telemetry/
│   │   └── test/
│   │       ├── integration/
│   │       └── fixtures/
│   │
│   └── web/                        # Next.js or SPA
│       ├── public/
│       ├── src/
│       │   ├── app/
│       │   ├── components/
│       │   │   ├── shell/
│       │   │   ├── sidebar/
│       │   │   ├── channel/
│       │   │   ├── thread-drawer/
│       │   │   └── common/
│       │   ├── features/
│       │   ├── state/
│       │   ├── api/
│       │   ├── realtime/
│       │   ├── lib/
│       │   └── styles/
│       └── e2e/
│
├── tools/
│   ├── codegen/
│   └── linters/
│
├── config/
│   ├── server.example.yaml
│   └── web.example.env
│
└── third_party/
    └── notices/
```

---

## 3. Resource allocation (where things live)

| Resource class | AAELink blueprint path | Upstream analogue (`v11.6.1`) |
|----------------|------------------------|--------------------------------|
| Server process entry | `apps/server/cmd/.../main.go` | `server/cmd/mattermost/main.go` |
| HTTP API surface | `apps/server/internal/http/handlers/` + `api/openapi/` | `server/channels/api4/` + `api/` |
| WebSocket hub | `apps/server/internal/ws/` | `server/channels/app/platform/web_hub.go`, `websocket_router.go`, `server/channels/wsapi/` |
| Relational migrations | `sql/migrations/` **or** inherited from fork | `server/channels/db/migrations/postgres/`, `server/config/migrations/postgres/` |
| Config store | `apps/server/internal/config/` + `config/*.yaml` | `server/config/` |
| Web UI | `apps/web/src/` | `webapp/channels/`, `webapp/platform/` |
| Static / brand assets | `apps/web/public/` | `webapp` build public assets + System Console uploads on running server |
| Container build | `infra/docker/Dockerfile.*` | Upstream `server/build/` packaging |
| Secrets (never in git) | Inject via Compose / K8s / vault | `MM_*` env (see `AAELink/.env.example`) |

---

## 4. Dependency matrix (runtime and build)

| Dependency | Tier | AAELink / engine monorepo role |
|------------|------|---------------------------|
| **PostgreSQL** | Required | Primary application DB |
| **Go toolchain** | Build | Server compile (`server/` upstream); version per upstream release notes |
| **Node + npm/pnpm** | Build | Webapp bundle (`webapp/` upstream) |
| **Redis** | Optional → common at scale | Cache, rate limits, cluster/session patterns (depends on deployment) |
| **S3-compatible object store** | Optional → typical prod | File attachments when not on local disk |
| **Reverse proxy (TLS)** | Production | nginx, Traefik, etc. |
| **TURN / ICE** | If voice/video | Calls plugin / WebRTC |
| **SMTP** | Email features | Invites, notifications |
| **Push (FCM/APNS + proxy)** | Mobile reliability | Separate infra from single-node MacBook demo |
| **Docker** | Dev + deploy | Matches current `AAELink/docker-compose.yml` |

---

## 5. Phase 1 completion checklist

- [x] **Pinned upstream** tag and image documented (`ARCHITECTURE-AAELINK-STACK.md`).
- [x] **Upstream top-level** inventory (`api`, `server`, `webapp`, `e2e-tests`, `tools`).
- [x] **AAELink target tree** (this document) for greenfield or fork-aligned CI layout.
- [x] **Resource allocation** and **dependency matrix** (sections 3–4).
- [x] **Trace handoff** to Phase 2 file paths (`PHASE2-4-UPSTREAM-TRACE-v11.6.1.md`).
- [ ] **Physical scaffold** — optional: `mkdir -p` the tree only when you start coding; not required to mark Phase 1 “done” for planning.
- [ ] **Legal** — fork / redistribution reviewed (`../AAELinkPowered/CONTRIBUTING.md`).

When the checklist items you care about are checked, **Phase 1 is complete** for planning purposes. Proceed to **`PHASE2-SERVER-DATA-LAYER.md`**, then **[`PHASE3-REALTIME-WEBSOCKET-LAYER.md`](./PHASE3-REALTIME-WEBSOCKET-LAYER.md)**, **[`PHASE4-FRONTEND-LAYER.md`](./PHASE4-FRONTEND-LAYER.md)**, **[`PHASE5-OPERATIONS-LAYER.md`](./PHASE5-OPERATIONS-LAYER.md)**.

## See also

- [`ROADMAP-PHASES-AND-LAYERS.md`](./ROADMAP-PHASES-AND-LAYERS.md) — phases vs stack slices; default “what’s next” after Phase 1  
- [`ARCHITECTURE-AAELINK-STACK.md`](./ARCHITECTURE-AAELINK-STACK.md) — product slices, pin, fork guidance  
- [`PHASE2-4-UPSTREAM-TRACE-v11.6.1.md`](./PHASE2-4-UPSTREAM-TRACE-v11.6.1.md) — verified paths inside `vendor/upstream`  
- [`BRANDING.md`](./BRANDING.md) — deployment branding for the stock image  
