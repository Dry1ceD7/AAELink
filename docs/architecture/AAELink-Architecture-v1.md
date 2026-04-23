# AAELink — Architecture Decision Record (Master)
**Version**: 1.0.0  
**Status**: Approved for Epic 0  
**Author**: BMAD — Winston (Architect)  
**Date**: 2026-04-23

---

## ADR-001: Microservices with Domain-Driven Boundaries

**Context**: AAELink spans 7+ business domains (comms, manufacturing, marketplace, auth, CRM, docs, AI). A monolith would create an unmanageable codebase and block independent deployments.

**Decision**: Independent microservices, one per domain subdomain. Services communicate via:
- **Synchronous**: REST (NestJS/Fiber) or gRPC for request-response
- **Asynchronous**: NATS JetStream for events (message sent, order created, QC alert)

**Consequences**: Operational complexity offset by GitOps (Argo CD) + Backstage catalog. Each service owns its schema migration (no shared DB).

---

## ADR-002: Keycloak as Single Identity Provider

**Decision**: One Keycloak instance per environment. One realm per AAELink tenant. Roles synced to OPA for policy enforcement.

**Rejected**: Auth0 (cost at scale), custom JWT service (maintenance burden)

**Migration Path**: LDAP/AD connector in Epic 1 for AAE's existing directory.

---

## ADR-003: NATS JetStream as Primary Event Bus

**Decision**: NATS JetStream (not Kafka) for event streaming.

**Rationale**: Lower operational footprint, built-in K-V store, subject-based routing maps cleanly to domain events. Kafka considered but deemed overpowered for initial scale.

**Scale trigger**: Re-evaluate Kafka when message volume exceeds 50M events/day.

---

## ADR-004: PostgreSQL for Structured Data, MongoDB for Messages

**Decision**: Split storage strategy.

| Store | Use Case |
|-------|---------|
| PostgreSQL 16 | Users, orgs, tickets, orders, QC records, audit |
| MongoDB 7 | Chat messages (append-heavy, flexible schema) |
| Elasticsearch 8 | Full-text search across all content types |
| MinIO | Binary objects: files, images, CAD, video |
| Redis 7 | Sessions, presence, rate limit counters, cache |

**Note**: TimescaleDB (or pg_timeseries extension) will be evaluated in Epic 6 for equipment telemetry time-series data.

---

## ADR-005: Next.js 14 App Router Monorepo (Frontend)

**Decision**: Single Turborepo monorepo for frontend.

```
apps/
  web/          ← main Next.js app shell
  admin/        ← admin dashboard (separate deployment)
  storybook/    ← component library
packages/
  ui/           ← shadcn/ui + custom design tokens
  sdk/          ← API client (generated from OpenAPI)
  i18n/         ← EN/DE/TH translation bundles
  theme/        ← white-label CSS variable system
  cad-viewer/   ← CAD SDK wrapper component
```

**Micro-frontend slots**: Plugin system mounts remote Next.js components via Module Federation (Webpack 5).

---

## ADR-006: GitOps via Gitea + Argo CD

**Decision**: All infrastructure and application manifests live in Gitea. Argo CD watches and reconciles to K8s.

```
aaelink-gitops/         ← Gitea repo
  apps/
    messaging/
    auth/
    manufacturing/
    ...
  infra/
    vault/
    keycloak/
    monitoring/
    ...
  helm-charts/
    aaelink-core/
    aaelink-manufacturing/
    aaelink-marketplace/
```

**Benefits**: Rollback = revert git commit. Drift detection built-in. Secrets never in git (Vault CSI driver).

---

## ADR-007: OPA for Policy Enforcement (Not Just RBAC in Code)

**Decision**: OPA Rego policies enforced at:
1. K8s Admission Controller (workload policies: no privileged containers, image signing required)
2. API Gateway layer (request-level authz: can user X perform action Y on resource Z?)
3. Service-level (NestJS guard calls OPA HTTP API for data-sensitive operations)

**Base roles**: `platform_admin`, `org_admin`, `manager`, `agent`, `member`, `guest`, `vendor`

---

## ADR-008: CAD Viewer Strategy

**Decision**: Evaluate in Epic 5 spike. Two candidates:

| Option | License | Formats | Annotation API |
|--------|---------|---------|---------------|
| Autodesk APS Viewer SDK | Commercial (per-view) | DWG, STEP, RVT, NWD, IFC | Full |
| Open Design Alliance Web Viewer | Commercial OEM | DWG, STEP, IGES, STL | Partial |
| three.js + step-file-parser | MIT | STEP, STL, OBJ | Custom build |

**Recommendation**: Start with APS Viewer (best format coverage) with OSS fallback if cost unacceptable. Annotation data stored in PostgreSQL linked to MinIO file ID and chat thread ID.

---

## ADR-009: Message Retention & Soft Delete

**Decision**: Two-tier deletion model.

1. **User delete**: Sets `deleted_by_user = true` flag; message hidden from user's view. Still readable by admins.
2. **Admin purge**: Hard delete only available to `platform_admin` after legal hold review. Requires two-admin confirmation.
3. **Retention policy**: Configurable per space (default: indefinite). Legal hold overrides all policies.
4. **Audit**: Every delete event (user or admin) written to Audit Log Service with actor, timestamp, message hash.

**Compliance**: Policy surfaced in onboarding wizard and user settings. GDPR erasure requests trigger workflow that substitutes message content with `[Message removed by user request — compliant with GDPR Art. 17]` while retaining metadata for legal hold.

---

## ADR-010: Plugin Architecture

**Decision**: Plugin manifest-based system.

```yaml
# plugin.manifest.yaml
name: erp-connector
version: 1.2.0
author: AAE Internal
entry: https://plugins.aaelink.local/erp-connector/remote.js
permissions:
  - read:messages
  - write:custom_fields
  - webhook:production_orders
signature: sha256:abc123...  # Cosign-verified
```

Plugins are:
- Loaded via Next.js Module Federation remote entry
- Sandboxed by OPA permission scopes
- Deployed to Plugin Registry (MinIO + PostgreSQL catalog)
- Signed with Cosign; unsigned plugins rejected by admission policy

---

## ADR-011: Observability Stack

```
Metrics:    Prometheus → Grafana (dashboards per service)
Traces:     OpenTelemetry SDK → Jaeger
Logs:       Promtail → Grafana Loki
Errors:     Sentry (application exceptions)
Uptime:     Prometheus Blackbox Exporter
SLOs:       Grafana SLO plugin (error budget tracking)
Dashboards: One per Epic domain; one executive summary board
```

Every service MUST emit:
- `aaelink_http_request_duration_seconds` (histogram)
- `aaelink_ws_connections_total` (gauge)
- `aaelink_nats_events_published_total` (counter)
- OpenTelemetry trace with `service.name`, `tenant.id`, `user.id` (hashed)

---

## Service Interaction Diagram (Simplified)

```
Browser / PWA
     │
     ▼
[Kong API Gateway + OPA Authz]
     │
     ├──► [Auth Service → Keycloak]
     ├──► [Messaging Service ← NATS ← all services]
     ├──► [Media Service → MinIO → ClamAV]
     ├──► [Document Service → ProseMirror + Yjs → MongoDB]
     ├──► [Manufacturing Service → PostgreSQL + Elasticsearch]
     ├──► [CRM / Ticketing Service → PostgreSQL]
     ├──► [Marketplace Service → PostgreSQL + Stripe]
     ├──► [Analytics Service → Superset / Grafana]
     ├──► [AI/LLM Gateway → RAG → Elasticsearch + Vault]
     └──► [Audit Log Service → Elasticsearch (append-only)]

All services → [Prometheus + Jaeger + Loki]
All deployments → [Gitea → Argo CD → Kubernetes]
All secrets → [Vault CSI Sidecar]
```

---

*Next document: `docs/stories/epic-0/` — Infrastructure stories by John (PM)*  
*Architecture reviews scheduled after each Epic completion.*
