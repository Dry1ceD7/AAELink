# AAELink — Enterprise Blueprint v2.0

**Company:** Advanced ID Asia Engineering Co., Ltd
**Document:** Comprehensive Enterprise Architecture & Deployment Blueprint
**Version:** 2.0 — May 2026
**Classification:** Internal Engineering — Confidential

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Infrastructure & Deployment](#3-infrastructure--deployment)
4. [Security & Compliance](#4-security--compliance)
5. [API & Integration Surface](#5-api--integration-surface)
6. [Feature Matrix & Flag System](#6-feature-matrix--flag-system)
7. [Observability Stack](#7-observability-stack)
8. [Release Plan & Roadmap](#8-release-plan--roadmap)

---

## 1. Executive Summary

### 1.1 What AAELink Is

AAELink is the internal enterprise SuperApp for Advanced ID Asia Engineering Co., Ltd. It started as an IT Help Desk and has evolved into a **full Slack/Mattermost-grade** communication, collaboration, and productivity platform.

### 1.2 Current State (v0.0.3-alpha — May 2026)

| Metric | Value |
|--------|-------|
| **API Routes** | 226 REST endpoints |
| **Slack Method Parity** | 55/55 method groups |
| **Test Coverage** | 1,193 tests across 94 suites |
| **Lib Modules Covered** | 84/84 (100%) |
| **Traced Handlers** | 429+ (100% route coverage) |
| **Total TypeScript Files** | 541 |
| **Total Lines of Code** | ~85,000 |
| **Feature Flags** | 28 (20 consumer + 8 enterprise) |
| **Release Batches Shipped** | 42 |

### 1.3 Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router) | 16.2.4 |
| UI Library | React | 19.2.5 |
| Language | TypeScript (strict) | 6.0.3 |
| Testing | Vitest | 4.1.5 |
| Database | PostgreSQL | 16 |
| Object Storage | MinIO (S3-compatible) | Latest |
| PDF Engine | Stirling PDF | Latest |
| Cache/Pub-Sub | Redis | 7+ |
| Desktop | Electron | Latest |
| Container | Docker / Kubernetes | Docker Desktop |

### 1.4 Strategic Vision

Build an enterprise-grade communication platform achieving **100% Slack/Mattermost functional parity** with improvements in: information density, async-first workflows, deep work protection, native task management, compliance posture, and TCO for organizations of 100–250,000 seats.

---

## 2. Architecture Overview

### 2.1 System Topology

```
┌──────────────────────────────────────────────────────────┐
│     Clients: Web (Next.js SSR/CSR) + Desktop (Electron)  │
└──────────────────────────┬───────────────────────────────┘
                           │ HTTPS / WSS / SSE
┌──────────────────────────▼───────────────────────────────┐
│              Next.js BFF (App Router)                     │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐  │
│  │ Auth    │ │ Messaging│ │ Collab   │ │ Admin       │  │
│  │ 13 rtes │ │ 15 rtes  │ │ 8 rtes   │ │ 43 rtes     │  │
│  └─────────┘ └──────────┘ └──────────┘ └─────────────┘  │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐  │
│  │ Tickets │ │ Documents│ │ Files    │ │ Compliance  │  │
│  │ 4 rtes  │ │ 13 rtes  │ │ 7 rtes   │ │ 4 rtes      │  │
│  └─────────┘ └──────────┘ └──────────┘ └─────────────┘  │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐  │
│  │ Webhooks│ │ Search   │ │ Notif    │ │ + 100 more  │  │
│  │ 6 rtes  │ │ 4 rtes   │ │ 5 rtes   │ │             │  │
│  └─────────┘ └──────────┘ └──────────┘ └─────────────┘  │
└────┬─────────────┬──────────────┬────────────────────────┘
     │             │              │
┌────▼────┐  ┌─────▼─────┐  ┌────▼────┐
│Postgres │  │   MinIO    │  │  Redis  │
│ (SoR)   │  │(S3 objects)│  │(pub/sub)│
└─────────┘  └───────────┘  └─────────┘
                  │
            ┌─────▼─────┐
            │ Stirling   │
            │ PDF Engine │
            └───────────┘
```

### 2.2 Data Flow

```
User Action → Next.js Route Handler → PostgreSQL (write)
                    │                         │
                    ├── Redis Pub/Sub ────────►│ SSE Fan-out → All Clients
                    ├── MinIO (file ops) ──────┘
                    ├── Stirling PDF (doc ops)
                    └── Audit Log (immutable)
```

### 2.3 Service Boundaries

| Domain | Routes | Responsibility |
|--------|--------|---------------|
| **Identity** | 13 | Auth, SSO/OIDC, SCIM, MFA, sessions |
| **Messaging** | 15 | Messages, threads, reactions, drafts, scheduled |
| **Channels** | 14 | CRUD, join/leave, mute, stars, topics, archival |
| **Collaboration** | 8 | Presence, typing, read-state, SSE streams |
| **Admin** | 43 | Users, audit, retention, IP access, feature flags |
| **Tickets** | 4 | SLA engine, routing, comments, activity log |
| **Documents** | 13 | Upload, versions, annotations, signatures, OCR |
| **Files** | 7 | Upload, download, preview, scan, comments |
| **Notifications** | 5 | In-app, email, push, SSE stream |
| **Webhooks** | 6 | CRUD, HMAC signing, DLQ, test delivery |
| **Search** | 4 | Messages, files, users, advanced |
| **Compliance** | 4 | DLP, legal holds, eDiscovery, info barriers |
| **Integrations** | 5 | Apps, bots, plugins, email ingestion, events |
| **HR** | 3 | Attendance, leave requests |
| **Conversations** | 8 | Slack-parity conversation methods |
| **Other** | 74 | Calendar, KB, marketplace, workflows, SCIM v2, etc. |

### 2.4 Lib Module Architecture (84 modules, 13,438 lines)

| Category | Modules | Purpose |
|----------|---------|---------|
| **Security** | `csrf`, `cspPolicy`, `ipAccess`, `sessionSecurity`, `password` | Request protection, IP ACLs |
| **Auth** | `adminAuth`, `platformRole`, `session`, `csrfClient` | Role hierarchy, session management |
| **Messaging** | `composerMarkdown`, `mentionParse`, `composerSlash`, `chatPost` | Composer logic, mention extraction |
| **Notifications** | `notificationSchedule`, `dndSchedule`, `notificationSound`, `notificationClient`, `notificationHref` | Schedule evaluation, sound, routing |
| **Realtime** | `realtime`, `sseResilience`, `wsTransport`, `redisPubSub` | SSE/WS transport, Redis fan-out |
| **Data** | `db`, `migrate`, `s3`, `messageDrafts`, `outboxQueue`, `messageCache` | Persistence, caching, offline queue |
| **Enterprise** | `featureFlags`, `auditLog`, `auditStream`, `retention`, `scimProvisioning`, `bulkProvision` | Flags, audit, compliance |
| **Tickets** | `ticketRouter`, `ticketAccess`, `slaEngine` | Auto-routing, SLA calculation |
| **Webhooks** | `webhookEngine`, `webhookSigning`, `webhookEmitter`, `webhookDlq` | Delivery, HMAC, dead-letter |
| **Observability** | `tracedRoute`, `tracing`, `otelExport`, `metrics`, `logger` | OpenTelemetry, Prometheus |
| **Templates** | `templateEngine`, `emailTemplates` | Mustache engine, email rendering |
| **UI** | `theme`, `uiDensity`, `slug`, `constants` | Theme scheduling, density modes |

---

## 3. Infrastructure & Deployment

### 3.1 Current Deployment Topology

```
Docker Desktop (macOS development)
├── Namespace: aaelink
│   ├── Deployment: aaelink-app (Next.js)
│   ├── StatefulSet: postgres (PostgreSQL 16)
│   ├── StatefulSet: minio (MinIO S3)
│   ├── Deployment: stirling-pdf
│   └── Deployment: redis
├── Namespace: monitoring (planned)
│   ├── Prometheus
│   ├── Grafana
│   └── Tempo (traces)
└── ConfigMaps + Secrets
```

### 3.2 Kubernetes Manifests

Two manifest sets maintained:

| Set | Path | Target |
|-----|------|--------|
| **Docker Desktop** | `infra/docker-desktop/` | Local K8s (11 files, Kustomize) |
| **K3s** | `infra/k3s/` | Edge/production (8 files) |

**Docker Desktop manifests include:**
- `namespaces.yaml` — `aaelink` namespace
- `postgres.yaml` — StatefulSet + PVC + Service
- `minio.yaml` — StatefulSet + PVC + Service
- `redis.yaml` — Deployment + Service
- `stirling-pdf.yaml` — Deployment + Service
- `ingress.yaml` — Ingress rules
- `secrets.example.yaml` — Template for credentials
- `deploy.sh` — Automated deployment script
- `kustomization.yaml` — Kustomize overlay

### 3.3 Scaling Strategy

| Phase | Architecture | Scale Target |
|-------|-------------|-------------|
| **Alpha (now)** | Monolith + Docker Desktop K8s | 1–50 users |
| **Beta (v0.1.0)** | Monolith + Helm chart + HPA | 50–500 users |
| **GA (v1.0.0)** | Service mesh extraction | 500–10,000 users |
| **Enterprise** | Microservices + multi-region | 10,000–250,000 users |

### 3.4 HA/DR Plan

| Concern | Strategy |
|---------|----------|
| **Database** | PostgreSQL streaming replication → Citus sharding at scale |
| **Object Storage** | MinIO erasure coding; cross-region replication |
| **Session** | Redis Cluster with AOF persistence |
| **Application** | HPA (CPU/memory); PDB for rolling updates |
| **Backup** | Daily automated PG dumps; S3 versioning |
| **RTO/RPO** | Target: RTO < 15 min, RPO < 5 min |

### 3.5 CI/CD Pipeline

| Stage | Tool | Gate |
|-------|------|------|
| Lint | ESLint + Prettier | PR block |
| Type check | `tsc --noEmit` | PR block |
| Unit tests | Vitest (1,193 tests) | PR block |
| Security scan | `npm audit` + Snyk | Advisory |
| Build | `next build` | PR block |
| Deploy (staging) | K8s rolling update | Auto on `main` |
| Deploy (production) | K8s blue-green | Manual approval |

---

## 4. Security & Compliance

### 4.1 Authentication Stack

| Method | Status | Implementation |
|--------|--------|---------------|
| Email/Password | ✅ Live | `bcrypt` hashing, login rate limiting (10/15min) |
| SSO (Microsoft Entra ID) | ✅ Live | OAuth 2.1 + PKCE via `/api/auth/sso` |
| OpenID Connect | ✅ Live | `/api/auth/openid` |
| MFA (TOTP) | ✅ Live | `/api/auth/mfa` |
| SAML 2.0 | 🔲 Planned | v1.0.0 |
| Passkeys (WebAuthn) | 🔲 Planned | v1.0.0 |

### 4.2 Authorization Model

```
Platform Roles:
  super_admin ──► Full platform control
  it_admin ──────► IT operations + user management
  it_employee ──► View-only IT dashboard
  employee ─────► Standard user

Channel Roles:
  admin ──► Channel settings, member management
  member ─► Read/write messages

Workspace Roles:
  owner ──► Workspace lifecycle, billing
  admin ──► Settings, invites
  member ─► Participate
  guest ──► Limited channel access
```

### 4.3 Security Middleware

| Layer | Module | Protection |
|-------|--------|-----------|
| **CSRF** | `csrf.ts` + `csrfClient.ts` | Double-submit cookie pattern |
| **CSP** | `cspPolicy.ts` | Content Security Policy headers |
| **IP Access** | `ipAccess.ts` | CIDR allowlist/denylist with env overrides |
| **Rate Limiting** | `rateLimiter.ts` + `rateLimitMetrics.ts` | Token-bucket per user/IP |
| **Session** | `sessionSecurity.ts` | HttpOnly cookies, rotation, device tracking |
| **Password** | `password.ts` | bcrypt, complexity rules |
| **Audit** | `auditLog.ts` + `auditStream.ts` | Immutable event log, SSE streaming |

### 4.4 Encryption

| Layer | Method |
|-------|--------|
| **In Transit** | TLS 1.3 (enforced) |
| **At Rest (DB)** | PostgreSQL TDE + per-column encryption |
| **At Rest (Files)** | MinIO server-side encryption (SSE-S3) |
| **Sessions** | HttpOnly + Secure + SameSite cookies |
| **EKM (planned)** | BYOK via AWS KMS / Azure Key Vault / Custom HSM |

### 4.5 Compliance Readiness

| Framework | Status | Coverage |
|-----------|--------|----------|
| **SOC 2 Type II** | 🟡 In Progress | Audit logging, access control, encryption |
| **ISO 27001** | 🔲 Planned | Security controls mapped |
| **GDPR** | 🟡 Partial | Data retention, right-to-erasure API |
| **HIPAA** | 🔲 Planned | BAA-ready architecture |
| **FedRAMP** | 🔲 Planned | Air-gapped deployment path |

### 4.6 Enterprise Compliance Features

| Feature | Status | Module |
|---------|--------|--------|
| Data Loss Prevention (DLP) | ✅ UI + API | Pattern scanning, Block/Flag/Redact |
| Information Barriers | ✅ UI + API | Group-to-group walls |
| Legal Holds / eDiscovery | ✅ UI + API | Custodian management, export |
| Data Retention | ✅ UI + API | Per-scope policies, enforcement |
| Audit Log + Export | ✅ Live | Filterable, CSV export, streaming |
| SCIM v2 Provisioning | ✅ API | Users + Groups endpoints |
| Bulk User Provisioning | ✅ API | CSV-based mass onboarding |
| Domain Claiming | ✅ UI | DNS/CNAME/email verification |
| Device Management (EMM) | ✅ UI | Enrollment, compliance, remote wipe |

---

## 5. API & Integration Surface

### 5.1 Route Distribution (226 total)

| Domain | Count | Methods |
|--------|-------|---------|
| Admin | 43 | GET, POST, PUT, PATCH, DELETE |
| Messaging | 15 | GET, POST, PATCH, DELETE |
| Channels | 14 | GET, POST, PATCH, DELETE |
| Auth | 13 | GET, POST, PUT, DELETE |
| Documents | 13 | GET, POST, PATCH, DELETE |
| Conversations | 8 | GET, POST |
| Collaboration | 8 | GET, POST, PATCH |
| Files | 7 | GET, POST, DELETE |
| Webhooks | 6 | GET, POST, PATCH, DELETE |
| Notifications | 5 | GET, POST, PATCH |
| Integrations | 5 | GET, POST |
| Compliance | 4 | GET, POST, PATCH |
| Search | 4 | GET |
| Tickets | 4 | GET, POST, PATCH |
| Remaining | 77 | Mixed |

### 5.2 Slack Method Group Parity (55/55)

Full parity achieved across all Slack Web API method groups including: `auth.*`, `chat.*`, `conversations.*`, `channels.*`, `files.*`, `pins.*`, `reactions.*`, `reminders.*`, `search.*`, `stars.*`, `team.*`, `usergroups.*`, `users.*`, `views.*`, `rtm.*`, `dnd.*`, `emoji.*`, `bots.*`, `dialog.*`, `oauth.*`, and all enterprise methods.

### 5.3 Webhook System

| Component | Module | Function |
|-----------|--------|----------|
| Engine | `webhookEngine.ts` | Delivery with exponential backoff |
| Signing | `webhookSigning.ts` | HMAC-SHA256 payload verification |
| Emitter | `webhookEmitter.ts` | Event-driven webhook dispatch |
| Dead Letter | `webhookDlq.ts` | Failed delivery retry queue |
| Test | `/api/webhooks/test` | Test delivery with response metrics |
| Delivery Log | `/api/webhooks/deliveries` | Audit trail per webhook |

### 5.4 Realtime Transport

| Transport | Path | Use Case |
|-----------|------|----------|
| SSE | `/api/collab/events` | Channel messages, typing, presence |
| SSE | `/api/notifications/stream` | Notification delivery |
| SSE | `/api/collab/presence/stream` | Presence heartbeat |
| SSE | `/api/admin/audit-log/stream` | Real-time audit streaming |
| WebSocket | `/api/ws` | Full-duplex messaging (RTM) |

---

## 6. Feature Matrix & Flag System

### 6.1 Feature Flag Architecture

Three-tier resolution: **Environment Variable** → **Database Override** → **Compile-time Default**

```typescript
// Sync check (client-safe, no DB):
isFeatureEnabledSync('HUDDLES')  // checks FEATURE_HUDDLES env → default

// Async check (full resolution):
await isFeatureEnabled('HUDDLES')  // checks env → DB → default
```

### 6.2 Complete Flag Registry (28 flags)

#### Consumer Features (default: ON)

| Flag | Description |
|------|------------|
| `AUDIO_VIDEO_CLIPS` | Clip recording in composer |
| `HUDDLES` | Voice chat rooms |
| `AI_SUMMARY` | AI-powered channel summaries |
| `SLACK_CONNECT` | Cross-org shared channels |
| `WORKFLOWS` | Workflow Builder automation |
| `CANVAS_EDITOR` | Collaborative documents |
| `MARKETPLACE` | Plugin marketplace |
| `THREAD_BROADCAST` | "Also send to channel" |
| `CHANNEL_TYPE_CONVERSION` | Public ↔ Private |
| `ACTIVITY_FEED` | Activity panel |
| `CUSTOM_EMOJI` | Custom emoji management |
| `DOCUMENT_ASSEMBLY` | Template engine |
| `RATE_LIMITING` | API rate limiting |
| `LINK_PREVIEWS` | URL unfurling |
| `SCHEDULED_MESSAGES` | Send Later |
| `REMINDERS` | `/remind` system |
| `APPROVALS` | Approval workflows |
| `KNOWLEDGE_BASE` | Wiki system |
| `TICKETS` | Ticketing system |
| `CALENDAR` | Calendar/HR features |

#### Enterprise Features (default: OFF)

| Flag | Description |
|------|------------|
| `SSO_SETTINGS` | SSO configuration panel |
| `DLP` | Data Loss Prevention |
| `EKM` | Encryption Key Management |
| `LEGAL_HOLD` | Legal holds / eDiscovery |
| `INFO_BARRIERS` | Information barriers |
| `SCIM` | SCIM v2 provisioning |
| `MOBILE_PUSH` | Mobile push notifications |
| `WEBRTC_CALLS` | Voice/video calls |

---

## 7. Observability Stack

### 7.1 Tracing (OpenTelemetry)

| Component | Module | Function |
|-----------|--------|----------|
| Route Tracing | `tracedRoute.ts` | Auto-instrumented span per handler |
| Span Management | `tracing.ts` | Custom spans, attributes, error recording |
| OTLP Export | `otelExport.ts` | Export to Jaeger/Tempo/Datadog |
| Coverage | **429+ handlers** | 100% route-level tracing |

### 7.2 Metrics (Prometheus)

| Metric | Module | Type |
|--------|--------|------|
| Request latency | `metrics.ts` | Histogram (p50/p95/p99) |
| Rate limit hits | `rateLimitMetrics.ts` | Counter by route/IP |
| Active SSE connections | `realtime.ts` | Gauge |
| Error rate | `tracedRoute.ts` | Counter by status code |

### 7.3 Logging

| Feature | Module | Detail |
|---------|--------|--------|
| Structured logging | `logger.ts` | JSON with trace_id correlation |
| Audit logging | `auditLog.ts` | Immutable, filterable, exportable |
| Audit streaming | `auditStream.ts` | Real-time SSE to admin dashboards |

### 7.4 Health Checks

```
GET /api/health → {
  status: "healthy" | "degraded",
  checks: {
    postgres: { status, latency_ms },
    minio:    { status, latency_ms },
    stirling: { status, latency_ms }
  },
  uptime_seconds, node_version, timestamp
}
```

---

## 8. Release Plan & Roadmap

### 8.1 Version History

| Version | Status | Key Deliverables |
|---------|--------|-----------------|
| v0.0.1 | ✅ Shipped | IT Help Desk MVP |
| v0.0.2 | ✅ Shipped | Messaging, channels, threads |
| v0.0.3 | ✅ Shipped | 42 batches, 226 routes, full Slack parity |

### 8.2 Roadmap: Alpha → GA

```
v0.0.3-alpha (NOW)          v0.0.8-alpha             v0.1.0-beta              v1.0.0 GA
     │                           │                        │                       │
     ├─ 226 routes               ├─ Integration tests     ├─ Helm chart           ├─ Native mobile
     ├─ 1,193 unit tests         ├─ Grafana dashboards    ├─ Redis pub/sub        ├─ WebRTC calls
     ├─ 100% trace coverage      ├─ Admin console UI      ├─ Elasticsearch        ├─ SOC 2 Type II
     ├─ K8s manifests            ├─ Email templates        ├─ WebRTC SFU           ├─ Plugin SDK
     └─ Full Slack parity        └─ Webhook v2             ├─ PWA mobile           └─ AI assistant
                                                           └─ Live connectors
```

### 8.3 v0.0.8 — Hardening & Observability (Target: Jun–Jul 2026)

| Deliverable | Priority | Detail |
|-------------|----------|--------|
| Integration test suite | P0 | 100% route coverage via supertest + testcontainers |
| Grafana + Prometheus | P0 | 6 pre-built dashboards, alerting rules |
| OpenTelemetry export | P0 | OTLP → Tempo, trace_id in all logs |
| Admin System Console | P1 | React panels for SSO, LDAP, SCIM, MFA, EKM |
| Email templates | P1 | Welcome, MFA, password reset, invite, digest |
| Webhook v2 | P1 | HMAC signatures, backoff, event filtering |

### 8.4 v0.1.0 — Production Readiness (Target: Aug–Oct 2026)

| Deliverable | Priority | Detail |
|-------------|----------|--------|
| Kubernetes Helm chart | P0 | Full Helm chart with HPA, PDB, Ingress |
| Redis pub/sub fan-out | P0 | Replace pg_notify for SSE distribution |
| Elasticsearch | P0 | Hybrid search replacing SQL ts_query |
| WebRTC media server | P1 | Janus/mediasoup SFU integration |
| PWA mobile shell | P1 | Progressive Web App for mobile |
| Live connectors | P1 | LDAP, ClamAV, KMS, SMTP real integrations |

### 8.5 v1.0.0 — Enterprise GA (Target: Q1 2027)

| Deliverable | Priority | Detail |
|-------------|----------|--------|
| Native mobile | P0 | React Native — iOS (APNS) + Android (FCM) |
| Full WebRTC calls | P0 | 1:1 + group, screen share, recording |
| SOC 2 Type II | P0 | Continuous controls, external audit |
| Plugin SDK + Marketplace | P1 | TypeScript SDK, V8 sandbox, app store |
| AI Assistant | P2 | Summarization, smart search, translation |

### 8.6 Success Metrics (12 months post-GA)

| Metric | Target |
|--------|--------|
| Uptime SLO | ≥ 99.99% (≤ 52 min/year) |
| p95 message fan-out | ≤ 150 ms in-region |
| Search satisfaction | ≥ 70% |
| UI input-to-paint | ≤ 30 ms median |
| Accessibility | WCAG 2.2 AA certified |

---

## Appendix A — QA Coverage Summary

| Category | Suites | Tests | Key Modules |
|----------|--------|-------|-------------|
| Security | 8 | 142 | csrf, csp, ipAccess, sessionSecurity, password |
| Auth | 4 | 48 | adminAuth, platformRole, session |
| Messaging | 6 | 89 | composerMarkdown, mentionParse, slashCommands |
| Notifications | 6 | 78 | schedule, dnd, sound, href, client, prefs |
| Realtime | 4 | 62 | redisPubSub, sseResilience, wsTransport |
| Webhooks | 4 | 58 | engine, signing, emitter, dlq |
| Enterprise | 6 | 94 | featureFlags, auditStream, scim, bulkProvision |
| Tickets | 3 | 52 | ticketRouter, slaEngine, ticketAccess |
| Data | 5 | 38 | db, s3, messageDrafts, outboxQueue |
| Observability | 4 | 62 | tracedRoute, tracing, otelExport, metrics |
| Templates | 2 | 48 | templateEngine, emailTemplates |
| UI/Utils | 12 | 68 | theme, slug, uiDensity, constants |
| **TOTAL** | **94** | **1,193** | **84 modules** |

## Appendix B — Database Schema (Key Tables)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `users` | Identity store | id, email, password_hash, platform_role, login_count |
| `workspaces` | Org containers | id, name, owner_id, plan |
| `channels` | Communication | id, workspace_id, name, type, is_default |
| `messages` | Message store | id, channel_id, user_id, body, root_id |
| `tickets` | Help desk | id, category, status, priority, sla_due_at |
| `audit_log` | Immutable audit | actor_id, action, resource_id, metadata |
| `feature_flags` | Runtime flags | flag_name, enabled, deleted_at |
| `webhook_deliveries` | Delivery log | webhook_id, event_type, status_code |
| `retention_policies` | Data lifecycle | scope, retention_days, delete_files |
| `document_templates` | Template engine | name, placeholders, variables |
| `sessions` | Session tracking | user_id, device, ip, last_active_at |
| `channel_members` | Membership | channel_id, user_id, role |

---

**End of Enterprise Blueprint v2.0**
*This document supersedes BLUEPRINT.md v1.0 and serves as the canonical reference for all architectural, security, and deployment decisions.*
