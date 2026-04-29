# AAELink roadmap: phases versus stack slices

**Identity:** **AAELink** = application; **Advanced ID Asia Engineering Co., Ltd.** = company.

This page ties together **phases** (numbered docs you work through in a sensible order) and **stack slices** (vertical concerns in the running product). Use it to answer “where are we?” and “what do we read next?”

**Canonical pin and phase list:** [`ARCHITECTURE-AAELINK-STACK.md`](./ARCHITECTURE-AAELINK-STACK.md).

**Next.js app in this repository** (not the pinned engine tree): architecture and Slack-class parity are in [`architecture-ecosystem-map.md`](./architecture-ecosystem-map.md) → [`architecture-technical.md`](./architecture-technical.md) and [`parity-reference-matrix.md`](./parity-reference-matrix.md).

---

## Stack slices (what the system is made of)

These are **not** a separate numbering scheme from phases; they are **labels** for parts of the engine + your deployment. Several phases touch one slice.

| Slice | What it covers | Primary docs |
|-------|----------------|--------------|
| **Identity** | Product name, company line, login branding, fork/redistribution policy | [`BRANDING.md`](./BRANDING.md), [`../AAELinkPowered/CONTRIBUTING.md`](../AAELinkPowered/CONTRIBUTING.md) |
| **Deploy** | Compose, env, volumes, pinned image, Site URL | [`README.md`](../README.md), [`docker-compose.yml`](../docker-compose.yml), [`WHERE-IS-THE-ENGINE.md`](./WHERE-IS-THE-ENGINE.md) |
| **Server & data** | Go process, Postgres, migrations, REST API, auth | [`PHASE2-SERVER-DATA-LAYER.md`](./PHASE2-SERVER-DATA-LAYER.md), [`PHASE2-4-UPSTREAM-TRACE-v11.6.1.md`](./PHASE2-4-UPSTREAM-TRACE-v11.6.1.md) (Phase 2 sections) |
| **Real-time** | Live channel updates (native stack: SSE [`/api/collab/events`](../app/api/collab/events/route.ts), client [`lib/realtime.ts`](../lib/realtime.ts)); upstream WebSocket trace | [`PHASE3-REALTIME-WEBSOCKET-LAYER.md`](./PHASE3-REALTIME-WEBSOCKET-LAYER.md), trace doc Phase 3 |
| **Web client** | `webapp/`, bundles, fork UI | [`PHASE4-FRONTEND-LAYER.md`](./PHASE4-FRONTEND-LAYER.md), trace doc Phase 4 |
| **Operations** | TLS, proxy, backups, mail, calls/mobile when scaled | [`PHASE5-OPERATIONS-LAYER.md`](./PHASE5-OPERATIONS-LAYER.md), [`deployment/production-checklist.md`](./deployment/production-checklist.md), [`HOSTING-MACBOOK.md`](./HOSTING-MACBOOK.md), [`deployment/secrets.md`](./deployment/secrets.md) |
| **Engineering** | Clone, Go toolchain, `make`, full `make run` | [`PHASE6-GO-DEVELOPMENT-MACBOOK.md`](./PHASE6-GO-DEVELOPMENT-MACBOOK.md), [`PHASE7-END-TO-END-DEV-LOOP.md`](./PHASE7-END-TO-END-DEV-LOOP.md), `../AAELinkPowered/scripts/bootstrap-*.zsh` |
| **Next app** | This monorepo: Next.js UI, `app/api`, collab SSE, tickets, documents | [`architecture-technical.md`](./architecture-technical.md), [`parity-reference-matrix.md`](./parity-reference-matrix.md) |

---

## Phases (recommended reading and execution order)

| Phase | Document | Dominant slice(s) |
|-------|----------|-------------------|
| **1** | [`PHASE1-REPOSITORY-BLUEPRINT.md`](./PHASE1-REPOSITORY-BLUEPRINT.md) | Deploy, Server & data (inventory), Identity (legal checkbox) |
| **2** | [`PHASE2-SERVER-DATA-LAYER.md`](./PHASE2-SERVER-DATA-LAYER.md) | Server & data |
| **2–4 trace** | [`PHASE2-4-UPSTREAM-TRACE-v11.6.1.md`](./PHASE2-4-UPSTREAM-TRACE-v11.6.1.md) | Server & data, Real-time, Web client (file-level map at `v11.6.1`) |
| **3** | [`PHASE3-REALTIME-WEBSOCKET-LAYER.md`](./PHASE3-REALTIME-WEBSOCKET-LAYER.md) | Real-time |
| **4** | [`PHASE4-FRONTEND-LAYER.md`](./PHASE4-FRONTEND-LAYER.md) | Web client |
| **5** | [`PHASE5-OPERATIONS-LAYER.md`](./PHASE5-OPERATIONS-LAYER.md) | Operations |
| **6** | [`PHASE6-GO-DEVELOPMENT-MACBOOK.md`](./PHASE6-GO-DEVELOPMENT-MACBOOK.md) | Engineering (+ Server & data build) |
| **7** | [`PHASE7-END-TO-END-DEV-LOOP.md`](./PHASE7-END-TO-END-DEV-LOOP.md) | Engineering (server + webapp loop) |

**Trace doc:** read **alongside** Phases 2–4 whenever you need exact paths under `AAELinkPowered/vendor/upstream/`; it is not a gate you “finish” before Phase 3.

---

## Where to go next (typical situations)

| Situation | Next focus |
|-----------|------------|
| **Docker already runs; operators only** | Phase **5** + [`deployment/production-checklist.md`](./deployment/production-checklist.md); **Identity** (`BRANDING`, Site URL). |
| **Someone must debug server or DB issues** | Phase **2** goals + trace § Phase 2; then Phase **6** when you compile locally. |
| **WebSocket or live updates misbehave** | Phase **3** + trace § Phase 3. |
| **Fork or rebrand the bundled UI** | Phase **4** + `CONTRIBUTING`; expect sustained merge work from upstream. |
| **Full product from source on a MacBook** | Phases **6** then **7** (after you are oriented on **2** and **4** at outline level). |
| **Production cutover from MacBook** | Phase **5** + `HOSTING-MACBOOK` migration notes + secrets doc. |

---

## After Phase 7 (ongoing)

- **Security:** track upstream releases for your pin; plan image tag bumps and regression smoke (Compose + critical flows).
- **Fork:** if you ship custom images, keep `upstream` merges on a schedule and document digest pins in Compose.
- **Legal / license:** revisit when you change binaries, bundle, or redistribution path (`CONTRIBUTING`).

There is no separate “Phase 8” doc; the numbered track ends at **7**. Anything larger (greenfield client, new backend) is a **new program** with its own charter, not an extension of this phase list.
