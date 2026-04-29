# Phase 2 — Server and data layer (next layer after Phase 1)

**Identity:** **AAELink** = app you operate; **Advanced ID Asia Engineering Co., Ltd.** = legal entity.

**Prerequisites:** [`PHASE1-REPOSITORY-BLUEPRINT.md`](./PHASE1-REPOSITORY-BLUEPRINT.md) read and upstream clone at **`v11.6.1`** (see [`ARCHITECTURE-AAELINK-STACK.md`](./ARCHITECTURE-AAELINK-STACK.md)).

**File map for this tag:** [`PHASE2-4-UPSTREAM-TRACE-v11.6.1.md`](./PHASE2-4-UPSTREAM-TRACE-v11.6.1.md).

This phase is **understanding and hardening the Go server + PostgreSQL + auth path** on the upstream tree (or your fork). It is **not** reimplemented in `AAELink/` until you choose greenfield or fork-based builds.

**Next.js app (this monorepo):** The shipping web product under `app/` + `app/api/` is documented in [`architecture-technical.md`](./architecture-technical.md) and [`WHERE-IS-THE-ENGINE.md`](./WHERE-IS-THE-ENGINE.md) (Docker engine vs `npm run dev`).

---

## 2.1 Goals (what “done” means for Phase 2)

| Track | Outcome |
|--------|---------|
| **A. Orientation** | You can narrate boot: config → `NewServer` → `api4` → `wsapi` → `web` → `Start` from real files. |
| **B. Data** | You can point to migration dirs and explain that **full schema = ordered migrations**, not one SQL dump. |
| **C. Auth** | You can locate session attachment, login, MFA, OAuth entrypoints (`api4` → `app`) via search. |
| **D. Build** | On a dev machine, upstream `server` Makefile targets are known (see §2.4); optional: `test-server-quick` after upstream prereqs. |
| **E. AAELink product** | Either **no code change** (keep Docker image) or **fork** with CI producing your image digest-pin in Compose. |

---

## 2.2 Ordered reading (server only)

1. `server/cmd/mattermost/main.go`
2. `server/cmd/mattermost/commands/server.go` — `serverCmdF`, `runServer`
3. `server/config/` — how DSN and env override work
4. `server/channels/app` — search `NewServer`, `Start`, `Shutdown`
5. `server/channels/api4/` — `Init` and router registration
6. `server/channels/store/` and `server/channels/store/sqlstore/` — persistence
7. `server/channels/db/migrations/postgres/` — schema evolution
8. `server/public/model/` — `User`, `Session`, `Team`, `Channel`, `Post`, …

---

## 2.3 Auth and security (discovery, not rewrite)

In `server/channels/api4` and `server/channels/app`, search for:

- `Session`, `GetSession`, `AttachSession`
- `Login`, `DoLogin`
- `Mfa`, `MFASecret`, `ValidateMfa`
- `OAuth`, `SAML` (as applicable to your edition)

Implement **AAELink-specific** policy (password rules, SSO IdP) only after legal/security sign-off; default remains upstream behavior for Team Edition.

---

## 2.4 Build and test hooks (upstream `server/`)

For **installing Go, Docker, Node, and Team Edition `make` invocations on a MacBook**, use **[`PHASE6-GO-DEVELOPMENT-MACBOOK.md`](./PHASE6-GO-DEVELOPMENT-MACBOOK.md)** and `../AAELinkPowered/scripts/bootstrap-go-dev.zsh`. For **server + webapp from source** (upstream **`make run`**), use **[`PHASE7-END-TO-END-DEV-LOOP.md`](./PHASE7-END-TO-END-DEV-LOOP.md)** and `../AAELinkPowered/scripts/bootstrap-e2e-dev.zsh`.

From **`vendor/upstream/server/`** (after the Team Edition lineage [contributor setup](https://developers.mattermost.com/contribute/developer-setup/) for your tag), the **`Makefile`** exposes targets including:

- `make build` — compile server
- `make test-server-quick` — quicker server test subset (still requires upstream prereqs; read Makefile `check-prereqs-enterprise` behavior)
- `make test-server` — full server tests (heavier)

**Team Edition:** keep `BUILD_ENTERPRISE=false` unless your fork and license intentionally enable enterprise builds.

Exact commands change by release; always read **`server/Makefile`** and upstream docs for **`v11.6.1`**.

---

## 2.5 Phase 2 completion checklist

Use this when you need a clear “Phase 2 done for our team” without rewriting the engine.

- [ ] **A — Boot narrative** — Can trace config → store → `NewServer` → `api4.Init` → `Start` using the files in §2.2 (and the trace doc).
- [ ] **B — Schema story** — Can explain migrations under `server/channels/db/migrations/postgres/` vs ad-hoc SQL.
- [ ] **C — Auth map** — Know where sessions attach and where login/MFA/OAuth hooks live (`api4` / `app` search).
- [ ] **D — Build** — Optional: `make build` or agreed subset succeeds on a dev machine with `BUILD_ENTERPRISE=false`.
- [ ] **E — AAELink stance** — Documented: **stock image** vs **fork + private image** (who owns digest bumps).

---

## 2.6 Handoff to Phase 3

When Phase 2 goals A–C (and checklist above as needed) are satisfied, open **[`PHASE3-REALTIME-WEBSOCKET-LAYER.md`](./PHASE3-REALTIME-WEBSOCKET-LAYER.md)** (and **`PHASE2-4-UPSTREAM-TRACE-v11.6.1.md`** § Phase 3) and read **`web_hub.go`** with the HTTP upgrade path from `wsapi` in mind.

## See also

- [`ROADMAP-PHASES-AND-LAYERS.md`](./ROADMAP-PHASES-AND-LAYERS.md) — phases vs stack slices, where to read next  
- [`PHASE2-4-UPSTREAM-TRACE-v11.6.1.md`](./PHASE2-4-UPSTREAM-TRACE-v11.6.1.md) — WebSocket and webapp paths  
- [`PHASE7-END-TO-END-DEV-LOOP.md`](./PHASE7-END-TO-END-DEV-LOOP.md) — `make run` after Phases 4 and 6  
- [`../AAELinkPowered/CONTRIBUTING.md`](../AAELinkPowered/CONTRIBUTING.md) — fork workflow  
