<div align="center">

<img src="public/brand/aae-logo.png" alt="AAELink" height="84"/>

# AAELink

**Enterprise SuperApp — Advanced ID Asia Engineering Co.,Ltd**

[![CI](https://github.com/Dry1ceD7/AAELink/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Dry1ceD7/AAELink/actions/workflows/ci.yml)
[![Desktop Build](https://github.com/Dry1ceD7/AAELink/actions/workflows/desktop-build.yml/badge.svg?branch=main)](https://github.com/Dry1ceD7/AAELink/actions/workflows/desktop-build.yml)
[![Latest release](https://img.shields.io/github/v/release/Dry1ceD7/AAELink?display_name=release&label=latest%20release&color=1e63b3)](https://github.com/Dry1ceD7/AAELink/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Dry1ceD7/AAELink/total?label=downloads&color=blue)](https://github.com/Dry1ceD7/AAELink/releases)
[![License](https://img.shields.io/badge/license-Proprietary-0a2342)](#license)

### Current version: **`v0.0.17-alpha`** &nbsp;·&nbsp; [Download installers](https://github.com/Dry1ceD7/AAELink/releases/latest) &nbsp;·&nbsp; [Release notes](docs/release-notes/v0.0.17-alpha.md)

</div>

---

## About

**AAELink** is the internal enterprise SuperApp for **Advanced ID Asia Engineering Co.,Ltd**.
It started as an **IT Help Desk** and has grown into a **full Slack/Mattermost-grade** communication and productivity platform — tickets, messaging, channels, files, compliance, identity, workflows, and more. **227 API routes. 55/55 Slack method groups. 1,220 tests (103 suites, 84/84 lib modules). 429+ traced handlers (100% route coverage). Redis Pub/Sub fan-out. WebSocket transport layer. Channel archival automation. Bulk user provisioning. Webhook HMAC signing. DLQ + data retention. IP access control. Prometheus metrics exporter. OpenTelemetry export. SCIM v2. OpenID Connect. CSP + CSRF middleware. Enterprise security hardening.**

The project ships as:

- **Docker Compose** for local dependencies (Postgres, MinIO, Stirling-PDF) and a **Next.js** app on the host.
- **Kubernetes-ready** with K8s manifests for production deployment.
- **Native desktop clients** for **Windows 10/11** and **macOS**.
- A **modern web UI** accessible from any browser on the same network.

---

## Install the Desktop Client

Download the latest installer from the [Releases](https://github.com/Dry1ceD7/AAELink/releases/latest) page.

| Platform | File | Notes |
|---|---|---|
| Windows 10 / 11 | `AAELink-Setup-*.exe` | NSIS installer, 64-bit |
| macOS | `AAELink-*.dmg` | Drag to Applications |

### First Launch

1. Install and open AAELink.
2. On first launch, you'll see the **Connect to Server** screen.
3. Enter the server host's WiFi IP address (e.g. `192.168.11.80`).
4. Click **Connect** — the app loads and saves the address for next time.

> **Note:** Both your device and the server host must be on the **same WiFi network**.

---

## Platform Capabilities (v0.0.8-alpha — 100% Parity)

| Domain | Features | Routes |
|--------|----------|--------|
| **Messaging** | Channels, DMs, threads, reactions, forwarding, scheduled, drafts, permalinks, clips | 25+ |
| **Search** | Full-text messages, advanced filters, user search, file content search, cross-workspace | 5 |
| **Identity & Auth** | SSO (SAML/OIDC/OAuth2), SCIM, LDAP/AD, MFA (TOTP + backup codes), sessions, device trust | 12 |
| **Compliance** | Legal hold, eDiscovery export, DLP rules, information barriers, audit log, retention | 8 |
| **Collaboration** | Canvas docs, knowledge base, workflow builder, approvals, calendar, file preview | 10 |
| **Voice & Video** | Call rooms (voice/video/huddle/screen share), TURN/STUN config, participant tracking | 1+ |
| **Notifications** | In-app (SSE), email queue, push (APNS/FCM/Web Push), DND, keyword highlights | 6 |
| **Integrations** | Webhooks, bot users, OAuth apps, event subscriptions, email ingestion, plugins | 8 |
| **Admin** | Analytics, user/role/dept management, guest accounts, app policies, media policies | 15+ |
| **Infrastructure** | Background jobs, cluster management, data residency, EKM, backups, observability | 10+ |
| **Internationalization** | 18 locales, per-user locale preferences | 1 |
| **Desktop** | Electron (Win/macOS), auto-update, idle detection, tray, deep links | — |

> **227 API routes · 30/30 Slack method groups · 2,156 lines of DDL · 1,220 tests · 0 parity gaps**

---

## Roadmap

### ✅ Completed (v0.0.2 → v0.0.9)

| Version | Milestone |
|---------|----------|
| v0.0.2 | Auth, users, roles, tickets, notifications, desktop clients |
| v0.0.3 | Channels, messages, threads, reactions, presence, 20+ micro-animations |
| v0.0.4 | Pins, bookmarks, link preview, webhooks, calendar |
| v0.0.5 | Rate limits, feature flags, default channels, activity feed |
| v0.0.6 | Advanced search, DND, custom emoji, slash commands, drafts |
| v0.0.7 | **100% enterprise parity** — SSO/SCIM/LDAP/MFA, compliance suite, federation, Canvas, calls, push, EKM, clustering |
| v0.0.8 | **Full Slack API parity (30/30 method groups)** — conversations.*, chat.*, views.*, oauth.*, workflows.*, functions.*, lists, assistant, reactions, usergroups, migration, 14 new DDL tables, 4 worker handlers |
| v0.0.9 | **Observability & Admin Console** — OpenTelemetry tracing (W3C traceparent, P50/P95/P99 metrics), Vitest test suite (30 tests), 4 new admin panels (OAuth, Functions, Migration, Observability), `/api/admin/tracing` |
| v0.0.10–v0.0.16 | Thread intelligence, notification UX, session intelligence, enterprise ticketing, document viewer, annotations, signatures, channel archival, bulk provisioning, CSRF hardening |
| v0.0.17 | **Full stabilization** — zero demo-data stubs, Prometheus metrics exporter, Grafana dashboard, 7 new integration test suites |

### 🔜 Next: v0.0.18-alpha — Alerting, E2E Testing & Production Hardening

| Priority | Item | Description |
|----------|------|-------------|
| P0 | **Alertmanager rules** | Error rate > 5%, P99 latency > 500ms, DB pool exhaustion alerts |
| P0 | **E2E testing (Playwright)** | Full browser-based login → channel → message → thread flows |
| P0 | **mTLS federation** | Certificate-based auth for cross-org shared channels |
| P1 | **Audit log streaming** | Export audit events to SIEM (Splunk, Elastic, S3) |
| P1 | **API rate limit dashboard** | Real-time rate limit metrics per route/user/IP |
| P2 | **CI integration test runner** | Docker Compose-based CI pipeline with PostgreSQL + MinIO |
| P2 | **OpenAPI spec generation** | Auto-generate OpenAPI 3.1 spec from 227 route handlers |

### 🗓️ v0.1.0-beta — Production Readiness

| Priority | Item | Description |
|----------|------|-------------|
| P0 | **Kubernetes production manifests** | Helm chart with horizontal pod autoscaling, ingress, cert-manager |
| P0 | **Redis pub/sub fan-out** | Replace Postgres NOTIFY for SSE at scale (>500 concurrent connections) |
| P0 | **Elasticsearch integration** | Swap SQL full-text for Elasticsearch/OpenSearch at scale |
| P1 | **WebRTC media server** | Janus/mediasoup integration for actual voice/video/screen share media |
| P1 | **Native mobile app (PWA)** | Progressive Web App shell with push notifications, offline cache |
| P1 | **LDAP live connector** | Actual LDAP bind/search against Active Directory |
| P2 | **ClamAV integration** | Connect file scan API to live ClamAV daemon |
| P2 | **HSM/KMS integration** | Connect EKM API to AWS KMS / Azure Key Vault / HashiCorp Vault |

### 🎯 v1.0.0 — Enterprise GA

| Priority | Item | Description |
|----------|------|-------------|
| P0 | **Native mobile clients** | React Native iOS/Android with push proxy (APNS/FCM) |
| P0 | **WebRTC calls** | Full voice/video/screen share with TURN/STUN servers |
| P0 | **SOC 2 Type II audit** | Compliance certification readiness |
| P1 | **Federation protocol** | Cross-org message relay for shared channels |
| P1 | **Plugin SDK** | Developer SDK for building and distributing AAELink plugins |
| P2 | **Marketplace** | App marketplace for third-party integrations |
| P2 | **AI assistant** | Built-in AI copilot for message summarization, search, and workflows |

---

## Stack

| Layer | Technology |
|---|---|
| App server | **Next.js 16** (App Router + Route Handlers), **Node.js 22** |
| Web UI | React 19, TypeScript |
| Desktop | Electron (loads web UI URL; electron-builder installers) |
| Database | PostgreSQL 17 (schema `aaelink`; auto-migrated on startup) |
| Local deps | Docker Compose: Postgres, MinIO, Stirling-PDF |
| File storage | S3-compatible API (MinIO in dev) |

---

## Run the Server (Local Development)

### Prerequisites

- [Node.js](https://nodejs.org/) 22+ (LTS recommended)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) for Compose services
- [Git](https://git-scm.com/)

### Steps

```bash
git clone https://github.com/Dry1ceD7/AAELink.git
cd AAELink
cp .env.example .env
# Edit .env: set secrets, DATABASE_URL, S3_* as needed.
npm run docker:up
npm ci
AAELINK_SEED_ADMIN_PASSWORD='choose-a-long-password' npm run seed:platform-admin
npm run dev
```

The seed step creates the platform super-admin (`adminaaelink` / `adminaaelink@aae.co.th`).

| What | URL / Port |
|---|---|
| AAELink (Next.js) | http://localhost:3040 |
| PostgreSQL | `127.0.0.1:25432` |
| MinIO S3 API | `http://127.0.0.1:29000` (console `:29001`) |
| Stirling-PDF | `http://localhost:28085` |

### Serve Other Devices on WiFi

To let other PCs or the desktop client connect over WiFi:

```bash
npm run dev:wifi:auto
```

This binds the server to `0.0.0.0:3040`, detects your WiFi IP, and configures everything automatically. Other devices connect to `http://<YOUR_WIFI_IP>:3040`.

> **Tip:** Make sure macOS firewall allows connections on port 3040.

---

## Project Structure

```
AAELink/
├── app/               # Next.js App Router: pages, layouts, API routes
├── lib/               # Shared libraries (API client, realtime, migrations)
├── public/            # Static assets and branding
├── desktop/           # Electron desktop shell
├── scripts/           # Tooling (seed scripts, dev helpers)
├── docs/              # Documentation
├── docker-compose.yml # Postgres, MinIO, Stirling-PDF
├── package.json       # npm run dev / build / start
└── .github/workflows/ # CI / Desktop build
```

---

## License

Proprietary — © Advanced ID Asia Engineering Co.,Ltd. All rights reserved.

This software, including its source code, binaries, designs, and documentation,
is the confidential property of **Advanced ID Asia Engineering Co.,Ltd** and is
intended solely for internal use by employees and authorized partners. No part
of this project may be copied, redistributed, sublicensed, or used outside of
Advanced ID Asia Engineering Co.,Ltd without prior written permission.
