<div align="center">

<img src="frontend/public/logo.svg" alt="AAELink" height="84"/>

# AAELink

**Enterprise SuperApp — Advanced ID Asia Engineering**

[![CI](https://github.com/Dry1ceD7/AAELink/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Dry1ceD7/AAELink/actions/workflows/ci.yml)
[![Build & Push](https://github.com/Dry1ceD7/AAELink/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/Dry1ceD7/AAELink/actions/workflows/build.yml)
[![Security](https://github.com/Dry1ceD7/AAELink/actions/workflows/security.yml/badge.svg?branch=main)](https://github.com/Dry1ceD7/AAELink/actions/workflows/security.yml)
[![Release](https://github.com/Dry1ceD7/AAELink/actions/workflows/release.yml/badge.svg)](https://github.com/Dry1ceD7/AAELink/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/Dry1ceD7/AAELink?include_prereleases&label=release&color=1e63b3)](https://github.com/Dry1ceD7/AAELink/releases)
[![License](https://img.shields.io/badge/license-Proprietary-0a2342)](#license)
[![Backend](https://img.shields.io/badge/backend-Go%201.25-00ADD8?logo=go&logoColor=white)](https://go.dev/)
[![Frontend](https://img.shields.io/badge/frontend-Next.js%2016-000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![Runtime](https://img.shields.io/badge/runs%20on-Docker-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)

</div>

---

## About

**AAELink** is the internal enterprise SuperApp for Advanced ID Asia Engineering.
It starts as an **IT Help Desk** and grows into a single place for the whole
company to work — tickets, files, notifications, identity, and (soon) chat,
approvals, knowledge base and more.

The project ships as:

- A **Docker Compose stack** for the server (one Mac, Windows PC or Linux box can host the team).
- **Native desktop clients** for **Windows** and **macOS**.
- A **modern web UI** in English, ภาษาไทย and Deutsch.

---

## Current features (alpha 0.0.1)

- **IT Help Desk** — submit, comment, triage and resolve tickets with realtime updates.
- **Identity & access** — sign-in, sessions, three roles: `it_admin`, `it_employee`, `employee`.
- **Admin panel** — user CRUD, department CRUD, role assignment, system config (admin only).
- **Notifications** — email delivery (Mailhog in dev, Microsoft 365 SMTP in prod).
- **File storage** — uploads and downloads via MinIO with presigned URLs.
- **Internationalization** — English (default) · ภาษาไทย · Deutsch, URL-based locale switcher.
- **Native desktop clients** — Windows installer (`Setup .exe`) and macOS `.dmg`.
- **LAN deployable** — one host can serve the whole office for alpha testing.
- **Operations** — Grafana, Prometheus, Loki and Promtail dashboards.

---

## Roadmap

| Status | Item |
|---|---|
| Shipped (Alpha 0.0.1) | IT Help Desk, identity, admin panel, file uploads, email, desktop clients |
| Next | Group chat, direct messages, channels |
| Next | Approvals and workflows |
| Later | Knowledge base / wiki |
| Later | Calendar, leave requests, attendance |
| Later | HR, finance and procurement integrations |
| Later | Mobile clients (iOS, Android) |
| Later | Single sign-on with Microsoft Entra ID |

---

## Stack

| Layer | Technology |
|---|---|
| Backend services | Go 1.25 + Fiber v3 |
| Frontend | Next.js 16 + React 19 + TypeScript 5 + Tailwind v4 + shadcn/ui |
| Desktop | Electron 33 + electron-builder 25 |
| Database | PostgreSQL 16 |
| Cache | Redis 7 |
| Event bus | NATS 2.x + JetStream |
| File storage | MinIO (S3-compatible) |
| Reverse proxy | Traefik v3 |
| Observability | Prometheus, Grafana, Loki, Promtail |
| Email (dev) | Mailhog |
| Email (prod) | Microsoft 365 SMTP |

---

## Install the desktop client

Download the latest installer from the [Releases](https://github.com/Dry1ceD7/AAELink/releases)
page.

| Platform | File |
|---|---|
| Windows 10 / 11 | `AAELink-Setup-<version>.exe` |
| macOS (Apple Silicon) | `AAELink-<version>-arm64.dmg` |
| macOS (Intel) | `AAELink-<version>.dmg` |

After installing, open the **Help → Configure Server URL…** menu and point the
client at your AAELink server (for example `http://192.168.1.42:18080`).

---

## Run the server

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) ≥ 4.x
- [Git](https://git-scm.com/)
- [Task](https://taskfile.dev/) (`brew install go-task` or `winget install Task.Task`)

### Steps

```bash
git clone https://github.com/Dry1ceD7/AAELink.git
cd AAELink
cp .env.example .env
# edit .env — change passwords!
task up
task migrate:up
```

Then open the app:

| Service | URL |
|---|---|
| AAELink app | http://localhost:18080 |
| Traefik dashboard | http://localhost:8080 |
| Grafana | http://localhost:3000 |
| Prometheus | http://localhost:9090 |
| Mailhog | http://localhost:8025 |
| MinIO console | http://localhost:9001 |

> Default admin: `admin@aaelink.local` / `AdminAaeLink#2026` — change on first login.

### Serve other devices on the LAN

```bash
ipconfig getifaddr en0      # macOS — get host IP, e.g. 192.168.1.42
task up
```

Other PCs and the desktop client can then reach the server at:

```
http://<HOST_LAN_IP>:18080
```

---

## Project structure

```
AAELink/
├── services/          # Backend services (auth, ticket, notify, media)
├── frontend/          # Web UI (Next.js)
├── desktop/           # Desktop client (Electron)
├── migrations/        # Database migrations
├── infra/             # Traefik, Prometheus, Grafana, Loki, Promtail
├── docs/              # Documentation
└── .github/workflows/ # CI / build / security / release
```

---

## License

Private — Advanced ID Asia Engineering. All rights reserved.
