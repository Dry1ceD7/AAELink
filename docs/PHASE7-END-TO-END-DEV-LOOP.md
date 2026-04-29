# Phase 7 — End-to-end development loop (server + webapp, `v11.6.1`)

**Identity:** **AAELink** = application name in production Compose; **Advanced ID Asia Engineering Co., Ltd.** = company / legal line. Upstream clone is for engineering only—fork branding is separate from env-driven **AAELink** naming on the stock image.

**Prerequisites:** [`PHASE4-FRONTEND-LAYER.md`](./PHASE4-FRONTEND-LAYER.md), [`PHASE6-GO-DEVELOPMENT-MACBOOK.md`](./PHASE6-GO-DEVELOPMENT-MACBOOK.md) (toolchain, `BUILD_ENTERPRISE=false`, Docker). Contributor setup for the Team Edition lineage: [developer setup](https://developers.mattermost.com/contribute/developer-setup/).

Phase 6 focused on **Go** and **`make run-server`**. This phase is the **full product loop from source**: Go API + **webpack dev client** (or a one-shot **`webapp` dist** before server-only dev).

All paths below assume **`AAELinkPowered/vendor/upstream/`** with **`server/`** and **`webapp/`** siblings (upstream layout).

**Next.js:** The production web app in **`AAELink/app/`** is a separate client stack — [`architecture-technical.md`](./architecture-technical.md), [`WHERE-IS-THE-ENGINE.md`](./WHERE-IS-THE-ENGINE.md).

---

## 7.1 What upstream `make run` does

From **`server/Makefile`** at **`v11.6.1`**:

| Target | Meaning |
|--------|---------|
| **`make run`** | **`run-server`** then **`run-client`** — Go process plus **`cd ../webapp && make run`** (webpack / `npm run run`). |
| **`make run-server`** | **`setup-go-work`**, **`prepackaged-binaries`**, **`validate-go-version`**, **`start-docker`**, **`client`** (symlink `server/client` → **`webapp/channels/dist`**), then **`go run`** the server. |
| **`make run-client`** | Ensures **`client`** symlink, then **`webapp`** **`make run`**. |

So **`run-server`** expects **`webapp/channels/dist`** to exist in a usable state. For **first** setup, either install **`webapp`** deps and let the dev client build assets, or produce a **`dist`** once (§7.3).

---

## 7.2 One-time webapp dependencies

From **`webapp/`** (see **`webapp/package.json`** **`engines`** at your pin — **Node ^24**, **npm ^11** for **`v11.6.1`**):

```bash
cd /path/to/AAELinkPowered/vendor/upstream/webapp
npm install
```

Or **`make node_modules`** in **`webapp/`** (runs **`npm install`** when not in CI).

---

## 7.3 Two valid first-time strategies

**A — Full dev (typical):** After **`npm install`** in **`webapp/`**, from **`server/`**:

```bash
export BUILD_ENTERPRISE=false
cd ../server
make run
```

This is **heavy** (two long-lived processes, large **`node_modules`**). Use **`make stop`** from **`server/`** when finished (stops client webpack, server **`go run`**, and upstream dev Docker per Makefile).

**B — Server with a static client bundle:** Build the webapp once, then run only the server:

```bash
export BUILD_ENTERPRISE=false
cd ../webapp && make dist
cd ../server && make run-server
```

Use when you mostly change **Go** and do not need hot-reload for React.

---

## 7.4 Port **8065** and AAELink Docker

Same as Phase 6: the default dev **`SiteURL`** / listen port is **8065**. Stop **`AAELink/`** Compose or use upstream overrides (e.g. **`run-node`** pattern in **`server/Makefile`** uses **8066** for a different profile — read that target before copying env vars).

---

## 7.5 Smoke check

Open the URL your dev server prints (often **`http://localhost:8065`**), create the first team, post a message, open **System Console**. Confirms HTTP, WebSocket, and client assets are wired.

---

## 7.6 After the loop is stable

- **Fork workflow / compliance:** [`../AAELinkPowered/CONTRIBUTING.md`](../AAELinkPowered/CONTRIBUTING.md)  
- **Production hardening:** [`PHASE5-OPERATIONS-LAYER.md`](./PHASE5-OPERATIONS-LAYER.md)  
- **Branding on stock images:** [`BRANDING.md`](./BRANDING.md)

## See also

- [`ROADMAP-PHASES-AND-LAYERS.md`](./ROADMAP-PHASES-AND-LAYERS.md) — phases vs stack slices; after Phase 7 (ongoing)  
- [`PHASE6-GO-DEVELOPMENT-MACBOOK.md`](./PHASE6-GO-DEVELOPMENT-MACBOOK.md) — Go-only path and **`bootstrap-go-dev.zsh`**  
- [`../AAELinkPowered/scripts/bootstrap-e2e-dev.zsh`](../AAELinkPowered/scripts/bootstrap-e2e-dev.zsh) — prints **`make run`** sequence and **`webapp`** checks  
