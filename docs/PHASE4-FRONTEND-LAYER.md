# Phase 4 — Frontend (web client) layer

**Identity:** **AAELink** = application name in deployment; **Advanced ID Asia Engineering Co., Ltd.** = company line. Fork UI work ships in your images; Compose env branding stays until you replace bundles.

**Note:** Paths such as `mattermost-redux` or `@mattermost/*` are **upstream package and directory names** inside the cloned engine tree; they are not the **AAELink** product name in your deployment.

**Prerequisites:** [`PHASE3-REALTIME-WEBSOCKET-LAYER.md`](./PHASE3-REALTIME-WEBSOCKET-LAYER.md) (optional but useful). **Paths:** [`PHASE2-4-UPSTREAM-TRACE-v11.6.1.md`](./PHASE2-4-UPSTREAM-TRACE-v11.6.1.md) § Phase 4.

**Clone:** `AAELinkPowered/vendor/upstream/webapp/`.

AAELink in Docker serves the **pre-built** bundle from the Team Edition image. This phase matters when you **fork**, **rebrand UI**, or build a **separate** client (for example Next.js) that must stay compatible with the same API + WebSocket contract.

**Next.js client in this repo:** [`architecture-technical.md`](./architecture-technical.md), [`WHERE-IS-THE-ENGINE.md`](./WHERE-IS-THE-ENGINE.md).

---

## 4.1 Monorepo layout (`webapp/`)

| Path | Role |
|------|------|
| `webapp/package.json` | Root **npm workspaces** orchestrator; Node/npm engine range |
| `webapp/channels/` | Main product UI (React), webpack/babel/jest configs |
| `webapp/platform/client` | HTTP client to REST API |
| `webapp/platform/mattermost-redux` | Redux stores, selectors, actions (state shape) |
| `webapp/platform/components` | Shared UI components |
| `webapp/platform/types` | Shared TypeScript types |
| `webapp/platform/shared` | Shared utilities |

**Workspaces** (from `webapp/package.json` at `v11.6.1`): `channels`, `platform/client`, `platform/components`, `platform/eslint-plugin`, `platform/mattermost-redux`, `platform/shared`, `platform/types`.

---

## 4.2 Local dev commands (upstream)

From **`vendor/upstream/webapp/`** (after `npm install` per upstream docs for that tag):

| Command | Purpose |
|---------|---------|
| `make run` or `npm run run` | Dev build / watch (see `Makefile` + `scripts/run.mjs`) |
| `make dev` | Webpack dev server (`npm run dev-server`) |
| `make test` | Jest across workspaces |
| `make check` / `make check-types` | Lint and TypeScript |

**Engines** at `v11.6.1` expect **Node ^24** and **npm ^11** per root `package.json`—align your machine or use `nvm` / `fnm` before installing.

---

## 4.3 State and API surface (where to look first)

| Concern | Start here |
|---------|------------|
| REST calls | `webapp/platform/client` |
| Global app state | `webapp/platform/mattermost-redux` (actions, reducers, selectors) |
| Channel UI | `webapp/channels/src` (layout varies by version; `src` is the main tree) |
| WebSocket client | Search `websocket` / `WebSocketClient` under `webapp/platform` and `webapp/channels` |

---

## 4.4 “Done” for Phase 4 (branding fork path)

| Goal | Evidence |
|------|----------|
| Rebuild webapp | `make run` or production `npm run build` succeeds on your branch |
| Rebrand strings/assets | Grep for product strings; replace; verify i18n keys |
| Contract unchanged | E2E or smoke tests against your `MM_SERVICESETTINGS_SITEURL` |

A **greenfield Next.js** client is **not** this tree: it must re-implement or generate clients from **OpenAPI** (`api/`) plus WS event handling—treat as a separate subproject.

---

## 4.5 Handoff to Phase 5

When the app runs locally and the web client meets your policy, move to [`PHASE5-OPERATIONS-LAYER.md`](./PHASE5-OPERATIONS-LAYER.md) for production hardening.

## 4.6 Handoff to Phase 7 (full source loop)

When you need **webpack dev** or **`make dist`** against a **local Go server** (not only the Docker image), follow [`PHASE7-END-TO-END-DEV-LOOP.md`](./PHASE7-END-TO-END-DEV-LOOP.md) after Phase 6 tooling is in place.

## See also

- [`ROADMAP-PHASES-AND-LAYERS.md`](./ROADMAP-PHASES-AND-LAYERS.md) — phases vs stack slices  
- [`PHASE7-END-TO-END-DEV-LOOP.md`](./PHASE7-END-TO-END-DEV-LOOP.md) — `make run` with `server/` + `webapp/`  
- [`BRANDING.md`](./BRANDING.md) — env-only branding on the stock image  
- [`../AAELinkPowered/CONTRIBUTING.md`](../AAELinkPowered/CONTRIBUTING.md) — fork and compliance  
