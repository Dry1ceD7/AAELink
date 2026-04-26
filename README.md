# AAELink

Clean-slate enterprise chat app.

Backend engine: Mattermost.

Current phase: Phase 1.

## Phase 1

- K3s namespaces
- Mattermost backend
- PostgreSQL backend
- Redis cache
- Traefik ingress
- API map
- WebSocket map

## Status

Awaiting Phase 2 approval.
<div align="center">

<img src="frontend/public/logo.svg" alt="AAELink" height="84"/>

# AAELink

**Enterprise SuperApp — Advanced ID Asia Engineering Co.,Ltd**

[![CI](https://github.com/Dry1ceD7/AAELink/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Dry1ceD7/AAELink/actions/workflows/ci.yml)
[![Build & Push](https://github.com/Dry1ceD7/AAELink/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/Dry1ceD7/AAELink/actions/workflows/build.yml)
[![Security](https://github.com/Dry1ceD7/AAELink/actions/workflows/security.yml/badge.svg?branch=main)](https://github.com/Dry1ceD7/AAELink/actions/workflows/security.yml)
[![Release pipeline](https://img.shields.io/github/actions/workflow/status/Dry1ceD7/AAELink/release.yml?event=push&label=release&logo=github)](https://github.com/Dry1ceD7/AAELink/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/Dry1ceD7/AAELink?display_name=release&label=latest%20release&color=1e63b3)](https://github.com/Dry1ceD7/AAELink/releases/latest)
[![Release date](https://img.shields.io/github/release-date/Dry1ceD7/AAELink?label=released&color=4c1)](https://github.com/Dry1ceD7/AAELink/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Dry1ceD7/AAELink/total?label=downloads&color=blue)](https://github.com/Dry1ceD7/AAELink/releases)
[![License](https://img.shields.io/badge/license-Proprietary-0a2342)](#license)
[![Backend](https://img.shields.io/badge/backend-Go%201.25-00ADD8?logo=go&logoColor=white)](https://go.dev/)
[![Frontend](https://img.shields.io/badge/frontend-Next.js%2016.2-000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![Desktop](https://img.shields.io/badge/desktop-Tauri%202-24C8DB?logo=tauri&logoColor=white)](https://tauri.app/)
[![Runtime](https://img.shields.io/badge/runs%20on-Docker-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)

### Current version: **`v0.0.2-alpha`** &nbsp;·&nbsp; [Download installers](https://github.com/Dry1ceD7/AAELink/releases/latest) &nbsp;·&nbsp; [Release notes](https://github.com/Dry1ceD7/AAELink/releases/tag/v0.0.2-alpha) &nbsp;·&nbsp; [Changelog](docs/release-notes/)

</div>

---

## About

**AAELink** is the internal enterprise SuperApp for **Advanced ID Asia Engineering Co.,Ltd**.
It starts as an **IT Help Desk** and grows into a single place for the whole
company to work — tickets, files, notifications, identity, and (soon) chat,
approvals, knowledge base and more.

> **Latest update — v0.0.2-alpha**
> Adds service readiness checks, stronger container health routing, emergency
> IT support queueing from the login screen, a dedicated documents module
> foundation for PDF workflows, and 20 MB profile avatar uploads. See the
> [release notes](https://github.com/Dry1ceD7/AAELink/releases/tag/v0.0.2-alpha)
> for the full changelog.

The project ships as:

- A **Docker Compose stack** for the server (one Mac, Windows PC or Linux box can host the team).
- **Native desktop clients** for **Windows** and **macOS**.
- A **modern web UI** in English, ภาษาไทย and Deutsch.

---

## Current features (alpha 0.0.2)

- **IT Help Desk** — submit, comment, triage and resolve tickets with realtime updates.
- **Identity & access** — sign-in, sessions, four built-in roles: `super_admin`, `it_admin`, `it_employee`, `employee`.
- **Super-admin oversight** — the platform super-admin has identity-level, cross-departmental visibility over every ticket, user, and module; protected against accidental lockout (cannot be deactivated, demoted, or deleted).
- **Admin panel** — user CRUD, department CRUD, custom role CRUD, permission assignment, system config (admin only).
- **Ticket data isolation** — non-IT users only see own/department tickets; global queue stays restricted to IT staff and the super-admin.
- **Notifications** — realtime in-app alerts via SSE plus email delivery (Mailhog in dev, Microsoft 365 SMTP in prod).
- **Security workflows** — two-step password confirmation for user creation and password reset actions.
- **Emergency IT support** — OTP-verified login screen request queue for urgent access help when users cannot sign in.
- **Documents foundation** — isolated document module with upload/download controls and PDF operation queues for preview, OCR, redaction, annotations, forms, signing, and export.
- **File storage** — uploads and downloads via MinIO with presigned URLs.
- **Internationalization** — English (default) · ภาษาไทย · Deutsch, URL-based locale switcher.
- **Native desktop clients** — Windows installer (`Setup .exe`) and macOS `.dmg`.
- **LAN deployable** — one host can serve the whole office for alpha testing.
- **Operations** — Grafana, Prometheus, Loki and Promtail dashboards.

---

## Roadmap

| Status | Item |
|---|---|
| Shipped (Alpha 0.0.2) | IT Help Desk, identity, admin panel, file uploads, email, desktop clients, emergency support queue, documents foundation |
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
| Frontend | Next.js 16.2 + React 19.2 + TypeScript 5.9 + Tailwind CSS v4 + shadcn/ui |
| Desktop | Tauri 2 + Rust native shell |
| Database | PostgreSQL 17 |
| Cache | Redis 8 |
| Event bus | NATS 2.x + JetStream |
| File storage | MinIO (S3-compatible) |
| Reverse proxy | Traefik v3.6 |
| Observability | Prometheus, Grafana, Loki, Promtail |
| Email (dev) | Mailhog |
| Email (prod) | Microsoft 365 SMTP |

---

## Install the desktop client

Download the latest installer from the [Releases](https://github.com/Dry1ceD7/AAELink/releases)
page.

| Platform | File |
|---|---|
| Windows 10 / 11 | Signed NSIS `.exe` installer |
| macOS | Signed `.dmg` installer |

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
├── desktop-tauri/     # Desktop client (Tauri)
├── migrations/        # Database migrations
├── infra/             # Traefik, Prometheus, Grafana, Loki, Promtail
├── docs/              # Documentation
└── .github/workflows/ # CI / build / security / release
```

---

## License

Proprietary — © Advanced ID Asia Engineering Co.,Ltd. All rights reserved.

This software, including its source code, binaries, designs, and documentation,
is the confidential property of **Advanced ID Asia Engineering Co.,Ltd** and is
intended solely for internal use by employees and authorized partners. No part
of this project may be copied, redistributed, sublicensed, or used outside of
Advanced ID Asia Engineering Co.,Ltd without prior written permission.
