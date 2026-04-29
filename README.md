# AAELink

Team collaboration hub: workspaces, channels, messages, tickets, and document storage. Collaboration data is stored in **PostgreSQL** (schema `aaelink`); files use S3-compatible storage when configured.

See [`docs/NORTH-STAR-A.md`](./docs/NORTH-STAR-A.md) for scope and environment flags. **Documentation index:** [`docs/README.md`](./docs/README.md) (architecture, parity, phases, deployment). **Slack-class full parity map:** [`docs/parity-slack-mattermost-aaelink-full-map.md`](./docs/parity-slack-mattermost-aaelink-full-map.md).

## Phase 1

- PostgreSQL for app data
- Optional Compose stack: Postgres, MinIO, Stirling-PDF (see `docker-compose.yml`)

## Status

Active development.
<div align="center">

<img src="public/brand/aae-logo.png" alt="AAELink" height="84"/>

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
[![App server](https://img.shields.io/badge/app%20server-Node.js%20%2B%20Next.js-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Frontend](https://img.shields.io/badge/frontend-Next.js%2016.2-000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![Desktop](https://img.shields.io/badge/desktop-Electron-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Runtime](https://img.shields.io/badge/runs%20on-Docker-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)

### Current version: **`v0.0.2-alpha`** &nbsp;·&nbsp; [Download installers](https://github.com/Dry1ceD7/AAELink/releases/latest) &nbsp;·&nbsp; [Release notes](https://github.com/Dry1ceD7/AAELink/releases/tag/v0.0.2-alpha) &nbsp;·&nbsp; [Changelog](docs/release-notes/v0.0.2-alpha.md)

</div>

---

## About

**AAELink** is the internal enterprise SuperApp for **Advanced ID Asia Engineering Co.,Ltd**.
It starts as an **IT Help Desk** and grows into a single place for the whole
company to work — tickets, files, notifications, identity, and (soon) chat,
approvals, knowledge base and more.

> **Latest update — v0.0.2-alpha**
> Features a massive UI overhaul achieving parity with Slack/Mattermost (workspace dropdowns, user profile popovers, and styled confirmation modals). Also adds service readiness checks, stronger container health routing, emergency
> IT support queueing from the login screen, a dedicated documents module
> foundation for PDF workflows, and 20 MB profile avatar uploads. See the
> [release notes](https://github.com/Dry1ceD7/AAELink/releases/tag/v0.0.2-alpha)
> for the full changelog.

The project ships as:

- **Docker Compose** for local dependencies (Postgres, MinIO, Stirling-PDF) and a **Next.js** app you run with **`npm run dev`** or **`npm run start`** on the host (one machine can serve the team for alpha).
- **Native desktop clients** for **Windows** and **macOS**.
- A **modern web UI** in English, ภาษาไทย and Deutsch.

---

## Current features (alpha 0.0.2)

- **IT Help Desk** — submit, comment, triage and resolve tickets with realtime updates.
- **Identity & access** — sign-in, sessions, four built-in roles: `super_admin`, `it_admin`, `it_employee`, `employee`.
- **Super-admin oversight** — the platform super-admin has identity-level, cross-departmental visibility over every ticket, user, and module; protected against accidental lockout (cannot be deactivated, demoted, or deleted).
- **Admin panel** — user CRUD, department CRUD, custom role CRUD, permission assignment, system config (admin only).
- **Ticket data isolation** — non-IT users only see own/department tickets; global queue stays restricted to IT staff and the super-admin.
- **Notifications** — realtime in-app alerts via SSE plus email (Resend or Microsoft 365 SMTP in prod; optional OTP logging to stdout in dev).
- **Security workflows** — two-step password confirmation for user creation and password reset actions.
- **Emergency IT support** — OTP-verified login screen request queue for urgent access help when users cannot sign in.
- **Documents foundation** — isolated document module with upload/download controls and PDF operation queues for preview, OCR, redaction, annotations, forms, signing, and export.
- **File storage** — uploads and downloads via MinIO with presigned URLs.
- **Internationalization** — English (default) · ภาษาไทย · Deutsch, URL-based locale switcher.
- **Native desktop clients** — Windows installer (`Setup .exe`) and macOS `.dmg`.
- **LAN deployable** — one host can serve the whole office for alpha testing.
- **Operations** — health and readiness checks in-app; optional observability stacks are documented under `infra/` and phase operations docs.

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

## Stack (this repository)

| Layer | Technology |
|---|---|
| App server and HTTP API | **Next.js 16** (App Router + Route Handlers under `app/api/**`), **Node.js** |
| Web UI | React 19, TypeScript, Tailwind CSS v4, lucide-react |
| Desktop | Electron (`desktop/`, loads web UI URL; electron-builder installers) |
| Database | PostgreSQL 17 in Docker Compose (schema `aaelink`; applied on startup via `lib/migrate.ts`) |
| Local dependencies | Docker Compose: Postgres, MinIO, Stirling-PDF (`docker-compose.yml`) |
| File storage | S3-compatible API (MinIO in dev; see `.env.example`) |
| Email / OTP | Resend, Twilio, or stdout logging for dev (`AAELINK_OTP_LOG_TO_STDOUT`); production SMTP as configured |

**Optional Mattermost Team Edition** engine, Redis/NATS, Traefik, and full observability bundles are **not** required for the Next.js app; they appear in [`docs/WHERE-IS-THE-ENGINE.md`](./docs/WHERE-IS-THE-ENGINE.md), [`docs/ARCHITECTURE-AAELINK-STACK.md`](./docs/ARCHITECTURE-AAELINK-STACK.md), and `infra/` when you run that track.

---

## Install the desktop client

Download the latest installer from the [Releases](https://github.com/Dry1ceD7/AAELink/releases)
page.

| Platform | File |
|---|---|
| Windows 10 / 11 | Signed NSIS `.exe` installer |
| macOS | Signed `.dmg` installer |

After installing, open the **Help → Configure Server URL…** menu and point the
client at your AAELink server (for example `http://192.168.1.42:3040` when using `npm run dev`, or the host and port you set in production).

---

## Run the server (local development)

### Prerequisites

- [Node.js](https://nodejs.org/) 22+ (matches CI; LTS recommended)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) or another engine for Compose (Postgres, MinIO, Stirling-PDF)
- [Git](https://git-scm.com/)

### Steps

```bash
git clone https://github.com/Dry1ceD7/AAELink.git
cd AAELink
cp .env.example .env
# Edit .env: set secrets, DATABASE_URL if you change Compose ports, S3_* and STIRLING_URL as needed.
npm run bootstrap:local   # or: npm run docker:up
npm ci
AAELINK_SEED_ADMIN_PASSWORD='choose-a-long-password' npm run seed:platform-admin
npm run dev
```

The seed step creates the platform super-admin (`adminaaelink` / `adminaaelink@aae.co.th` by default). Use that **user name or email** and the password you set in `AAELINK_SEED_ADMIN_PASSWORD` (the address is spelled **admin-a-a-e-link**, not `adminae…`).

Then open the app (default from `.env.example`):

| What | URL / port |
|---|---|
| AAELink (Next.js) | http://localhost:3040 |
| PostgreSQL (host port from Compose) | `127.0.0.1:25432` → maps to container `5432` |
| MinIO S3 API | `http://127.0.0.1:29000` (console `http://127.0.0.1:29001`) |
| Stirling-PDF | `http://localhost:28085` |

The database schema is created when the app first talks to Postgres (`ensureSchema` in `lib/migrate.ts`). For a first super-admin on an empty database, see [`docs/LAN-DESKTOP-CLIENTS.md`](./docs/LAN-DESKTOP-CLIENTS.md) (`npm run seed:platform-admin`).

### Serve other devices on the LAN

1. Open the host firewall for the HTTP port you expose (default dev **3040**; override with `npm run dev -- -p <port>`).
2. Set `NEXT_PUBLIC_APP_URL` to the URL clients actually use (see [`docs/HOSTING-MACBOOK.md`](./docs/HOSTING-MACBOOK.md) when Mattermost and Next.js share one machine).
3. For other machines on the same Wi‑Fi, run **`npm run dev:wifi:auto`** (binds `0.0.0.0` and sets `NEXT_PUBLIC_APP_URL`); see [`docs/LAN-DESKTOP-CLIENTS.md`](./docs/LAN-DESKTOP-CLIENTS.md).

Other PCs and the desktop shell then use `http://<HOST_LAN_IP>:<PORT>` (same origin you put in `NEXT_PUBLIC_APP_URL` for cookie and redirect behavior).

---

## Project structure

```
AAELink/
├── app/               # Next.js App Router: pages, layouts, `app/api/*` route handlers
├── lib/               # Shared libraries (API client, realtime, migrations, …)
├── public/            # Static assets
├── desktop/           # Electron desktop shell (loads web UI from a URL)
├── scripts/           # Tooling (e.g. seed scripts)
├── infra/             # k3s, observability references
├── docs/              # Documentation ([`docs/README.md`](./docs/README.md))
├── docker-compose.yml # Optional: Postgres, MinIO, engine image, …
├── package.json       # `npm run dev` / `build` / `start`
└── .github/workflows/ # CI / build / security / release
```

Optional **Mattermost Team Edition** engine (same folder, different process): see [`docs/WHERE-IS-THE-ENGINE.md`](./docs/WHERE-IS-THE-ENGINE.md).

---

## License

Proprietary — © Advanced ID Asia Engineering Co.,Ltd. All rights reserved.

This software, including its source code, binaries, designs, and documentation,
is the confidential property of **Advanced ID Asia Engineering Co.,Ltd** and is
intended solely for internal use by employees and authorized partners. No part
of this project may be copied, redistributed, sublicensed, or used outside of
Advanced ID Asia Engineering Co.,Ltd without prior written permission.
