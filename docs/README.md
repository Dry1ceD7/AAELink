# AAELink documentation index

Quick entry points for engineers and operators.

## Product and scope

| Document | Description |
|----------|-------------|
| [../README.md](../README.md) | Install, **local run** (`docker compose` + `npm run dev`), stack snapshot, shipped features, public roadmap |
| [NORTH-STAR-A.md](./NORTH-STAR-A.md) | Realtime (SSE) and registration flags |

## Architecture and parity (this app — Next.js)

| Document | Description |
|----------|-------------|
| [architecture-ecosystem-map.md](./architecture-ecosystem-map.md) | Hub linking technical architecture and parity matrix |
| [architecture-technical.md](./architecture-technical.md) | Layers, APIs, data, fortress UI, security, scale path |
| [parity-reference-matrix.md](./parity-reference-matrix.md) | Slack / Mattermost capability parity states |
| [parity-slack-mattermost-aaelink-full-map.md](./parity-slack-mattermost-aaelink-full-map.md) | Full Slack pillars, Mattermost hints, frameworks, engines, `app/api` mapping, **`Target (semver)`** per row |

## Engine track (pinned Mattermost Team Edition)

| Document | Description |
|----------|-------------|
| [WHERE-IS-THE-ENGINE.md](./WHERE-IS-THE-ENGINE.md) | Docker engine vs `vendor/upstream` vs **Next.js** in the same `AAELink/` folder |
| [ARCHITECTURE-AAELINK-STACK.md](./ARCHITECTURE-AAELINK-STACK.md) | Engine pin, Compose, phase reading order |
| [ROADMAP-PHASES-AND-LAYERS.md](./ROADMAP-PHASES-AND-LAYERS.md) | Phases vs stack layers |
| [PHASE1-REPOSITORY-BLUEPRINT.md](./PHASE1-REPOSITORY-BLUEPRINT.md) | Target monorepo tree (engine track) |
| [PHASE2-SERVER-DATA-LAYER.md](./PHASE2-SERVER-DATA-LAYER.md) | Server + Postgres (engine) |
| [PHASE3-REALTIME-WEBSOCKET-LAYER.md](./PHASE3-REALTIME-WEBSOCKET-LAYER.md) | Upstream WebSocket / hub |
| [PHASE4-FRONTEND-LAYER.md](./PHASE4-FRONTEND-LAYER.md) | Upstream `webapp/` |
| [PHASE5-OPERATIONS-LAYER.md](./PHASE5-OPERATIONS-LAYER.md) | TLS, proxy, backups, observability |
| [PHASE6-GO-DEVELOPMENT-MACBOOK.md](./PHASE6-GO-DEVELOPMENT-MACBOOK.md) | Go toolchain on Mac |
| [PHASE7-END-TO-END-DEV-LOOP.md](./PHASE7-END-TO-END-DEV-LOOP.md) | Full `make run` loop |
| [PHASE2-4-UPSTREAM-TRACE-v11.6.1.md](./PHASE2-4-UPSTREAM-TRACE-v11.6.1.md) | File-level map at engine tag |

## Branding and deployment

| Document | Description |
|----------|-------------|
| [BRANDING.md](./BRANDING.md) | Product vs legal naming |
| [deployment/production-checklist.md](./deployment/production-checklist.md) | Production checks |
| [deployment/secrets.md](./deployment/secrets.md) | Secret handling |
| [HOSTING-MACBOOK.md](./HOSTING-MACBOOK.md) | Local / Mac hosting notes |
| [LAN-DESKTOP-CLIENTS.md](./LAN-DESKTOP-CLIENTS.md) | Desktop clients on LAN |
| [release-notes/v0.0.2-alpha.md](./release-notes/v0.0.2-alpha.md) | Hand-written notes for the current alpha tag |

## Redirects

| Document | Description |
|----------|-------------|
| [ARCHITECTURE-MATTERMOST-TO-AAELINK.md](./ARCHITECTURE-MATTERMOST-TO-AAELINK.md) | Points to `ARCHITECTURE-AAELINK-STACK.md` |
