<div align="center">

<img src="frontend/public/logo.svg" alt="AAELink" height="84"/>

# AAELink

**Enterprise SuperApp — Advanced ID Asia Engineering**

AI-Native · Agent-Driven · Cognitive Orchestration (BMAD Method)

[![CI](https://github.com/Dry1ceD7/AAELink/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Dry1ceD7/AAELink/actions/workflows/ci.yml)
[![Build & Push](https://github.com/Dry1ceD7/AAELink/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/Dry1ceD7/AAELink/actions/workflows/build.yml)
[![Security](https://github.com/Dry1ceD7/AAELink/actions/workflows/security.yml/badge.svg?branch=main)](https://github.com/Dry1ceD7/AAELink/actions/workflows/security.yml)
[![Release](https://github.com/Dry1ceD7/AAELink/actions/workflows/release.yml/badge.svg)](https://github.com/Dry1ceD7/AAELink/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/Dry1ceD7/AAELink?include_prereleases&label=release&color=1e63b3)](https://github.com/Dry1ceD7/AAELink/releases)
[![License](https://img.shields.io/badge/license-Proprietary-0a2342)](#license)
[![Made with Go](https://img.shields.io/badge/backend-Go%201.25-00ADD8?logo=go&logoColor=white)](https://go.dev/)
[![Made with Next.js](https://img.shields.io/badge/frontend-Next.js%2016-000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![Docker](https://img.shields.io/badge/runs%20on-Docker-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![BMAD](https://img.shields.io/badge/method-BMAD%20Cognitive%20Orchestration-5cb8e4)](docs/bmad/)

</div>

---

## About

**AAELink** is the internal enterprise SuperApp for Advanced ID Asia Engineering.
It begins as an **IT Help Desk** and evolves into a unified inter-departmental
collaboration platform — chat, files, tickets, approvals, knowledge base.

The codebase is built **agent-first** under the **BMAD Method**
(Business · Mechanics · Architecture · Delivery) so that every layer is
specified, generated, reviewed and verified by AI agents under human
supervision. Layers 0–9 are fully delivered (infra, auth, tickets, notify,
media, frontend, observability) and shipped as a Compose-deployable suite plus
a native desktop client for Windows and macOS.

## Highlights

- **Polyglot micro-services** — Go 1.25 (Fiber v3) services behind Traefik v3.
- **Modern web client** — Next.js 16, React 19, TypeScript 5, Tailwind v4, shadcn/ui.
- **Native desktop** — Electron shell (`desktop/`), DMG/ZIP/EXE/portable.
- **Identity & RBAC** — Argon2id, JWT (access/refresh), `it_admin` admin panel.
- **Operational data plane** — PostgreSQL 16, Redis 7, NATS JetStream, MinIO (S3).
- **Observability** — Prometheus, Grafana, Loki, Promtail.
- **i18n** — English · ภาษาไทย · Deutsch (URL-prefixed locales).
- **Hardened CI** — vet + test + lint + type-check + Trivy + govulncheck + Gitleaks.

---

## Stack

| Layer | Technology |
|---|---|
| **Backend** | Go 1.25 + Fiber v3 (auth · ticket · notify · media) |
| **Frontend** | Next.js 16 + React 19 + TypeScript 5 + Tailwind v4 + shadcn/ui |
| **Desktop** | Electron 33 + electron-builder 25 |
| **Database** | PostgreSQL 16 |
| **Cache** | Redis 7 |
| **Event Bus** | NATS 2.x + JetStream |
| **File Storage** | MinIO (S3-compatible) |
| **Reverse Proxy** | Traefik v3 |
| **Observability** | Prometheus + Grafana + Loki + Promtail |
| **Email (dev)** | Mailhog |
| **Email (prod)** | Microsoft 365 SMTP |

---

## Quick Start (Windows 11 / macOS)

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) ≥ 4.x
- [Git](https://git-scm.com/)
- [Go 1.25+](https://go.dev/dl/)
- [Node.js 22+](https://nodejs.org/)
- [Task](https://taskfile.dev/) — `winget install Task.Task` / `brew install go-task`

**Windows 11 WSL2 config** — create/update `%USERPROFILE%\.wslconfig`:

```ini
[wsl2]
memory=10GB
processors=8
swap=4GB
```

### 1. Clone and configure

```bash
git clone https://github.com/Dry1ceD7/AAELink.git
cd AAE/AAELink
cp .env.example .env
# Edit .env — change passwords!
```

### 2. Start all services

```bash
task up
```

### 3. Run migrations

```bash
task migrate:up
```

### 4. Access the app

| Service | URL |
|---|---|
| **AAELink App** | http://localhost:18080 |
| **Traefik Dashboard** | http://localhost:8080 |
| **Grafana** | http://localhost:3000 |
| **Prometheus** | http://localhost:9090 |
| **Mailhog** | http://localhost:8025 |
| **MinIO Console** | http://localhost:9001 |

> Default admin: `admin@aaelink.local` / `AdminAaeLink#2026` — change on first login.

---

## Run as a temporary LAN server (MacBook)

The Compose stack and Traefik are configured to accept traffic on any host header,
so a single Mac can serve the whole team during alpha testing.

```bash
ipconfig getifaddr en0     # → e.g. 192.168.1.42
task up
```

Then point clients (browser or desktop app) at:

```
http://<MAC_LAN_IP>:18080
```

In the desktop app, edit `Configure Server URL…` and set `serverUrl` to the
same `http://<MAC_LAN_IP>:18080`.

---

## Desktop application

Native shells live under [`desktop/`](desktop/). Releases are produced
automatically by `.github/workflows/release.yml` whenever a tag matching
`v*.*.*` (e.g. `v0.0.1-alpha`) is pushed:

- macOS — `AAELink-<version>-arm64.dmg`, `AAELink-<version>-x64.dmg` and `.zip`
- Windows — `AAELink Setup <version>.exe` (NSIS installer) and portable `.exe`

Local build:

```bash
cd desktop
npm install
npm run dist:mac     # or: npm run dist:win
```

---

## Development

```bash
task up           # Start all infrastructure
task down         # Stop everything
task reset        # ⚠️ Destroy all data and restart

task test         # Run all Go tests
task lint         # Run golangci-lint
task sqlc:generate  # Re-generate DB code

task psql         # Open PostgreSQL prompt
task redis        # Open Redis CLI
task logs -- auth # Tail auth service logs
```

### Hot reload (Go services)

Each service uses [Air](https://github.com/air-verse/air) for live reload:

```bash
cd services/auth && air
```

### Frontend dev server

```bash
cd frontend
npm install
npm run dev   # http://localhost:3000 (Turbopack)
```

---

## Project Structure

```
AAELink/
├── services/           # Go micro-services
│   ├── auth/           # Authentication & RBAC (port 8001)
│   ├── ticket/         # IT Help Desk core (port 8002)
│   ├── notify/         # Email / WebSocket notifications (port 8003)
│   └── media/          # File upload / MinIO proxy (port 8004)
├── frontend/           # Next.js 16 app (port 3000 behind Traefik)
├── desktop/            # Electron desktop client (Win + mac + Linux)
├── migrations/         # golang-migrate SQL files
│   ├── auth/
│   └── ticket/
├── infra/              # Traefik · Prometheus · Grafana · Loki · Promtail
├── docs/               # Architecture decisions, runbooks, stories, BMAD
└── .github/workflows/  # ci.yml · build.yml · security.yml · release.yml
```

---

## Roles

| Role | Description |
|---|---|
| `it_admin` | Full access — user management, system config |
| `it_employee` | IT staff — receive and resolve tickets |
| `employee` | All other departments — submit tickets |

---

## Languages

English (default) · ภาษาไทย · Deutsch

---

## BMAD Method

AAELink is delivered using **BMAD** (Business · Mechanics · Architecture · Delivery)
cognitive orchestration. Personas, rulesets and per-layer playbooks live under
[`docs/bmad/`](docs/bmad/) and `.cursor/rules/bmad-cognitive-orchestration.mdc`.

---

## Phase Roadmap

| Phase | Target | Description |
|---|---|---|
| **Alpha v0.0.1** | Local Mac/Win + LAN | IT Help Desk — tickets, users, email, desktop client |
| **Alpha Shared** | QNAP NAS2New | Shared team testing |
| **Beta** | On-premises server | Production with full feature set |

---

## License

Private — Advanced ID Asia Engineering. All rights reserved.
