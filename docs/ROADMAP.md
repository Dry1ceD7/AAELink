# AAELink — Master Roadmap
**Version**: 1.0.0  
**Updated**: 2026-04-23

## Layer-by-Layer Build Plan

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  EPIC 0  │  Infrastructure Foundation                     │  Weeks 1-2      │
│          │  K8s · Gitea/ArgoCD · Vault · Keycloak · OPA  │                 │
│          │  NATS · PostgreSQL · MongoDB · ES · MinIO      │  ← START HERE   │
│          │  Redis · Prometheus · Grafana · Jaeger · Loki  │                 │
├──────────┼────────────────────────────────────────────────┼─────────────────┤
│  EPIC 1  │  Identity & API Plane                          │  Weeks 3-4      │
│          │  Kong API GW · Audit Log Service               │                 │
│          │  Multi-tenancy · OPA Policies                  │                 │
├──────────┼────────────────────────────────────────────────┼─────────────────┤
│  EPIC 2  │  Messaging Core                                │  Weeks 5-8      │
│          │  WebSocket service · Rooms/Spaces              │                 │
│          │  Media upload + virus scan                     │                 │
│          │  Notifications · Presence · Archival           │                 │
├──────────┼────────────────────────────────────────────────┼─────────────────┤
│  EPIC 3  │  Frontend Shell v1                             │  Weeks 6-8      │
│          │  Next.js monorepo · Design system              │  (parallel E-2) │
│          │  Auth shell (PKCE) · White-label theming · PWA │                 │
├──────────┼────────────────────────────────────────────────┼─────────────────┤
│  EPIC 4  │  Omnichannel + CRM + ITSM                      │  Weeks 9-14     │
│          │  Channel adapters · Ticket routing             │                 │
│          │  CRM · Canned replies · Macros                 │                 │
├──────────┼────────────────────────────────────────────────┼─────────────────┤
│  EPIC 5  │  Collaboration & Knowledge                     │  Weeks 15-20    │
│          │  Document hub (CRDT) · Task/Kanban             │                 │
│          │  CAD viewer · Knowledge base · Calendar        │                 │
├──────────┼────────────────────────────────────────────────┼─────────────────┤
│  EPIC 6  │  Manufacturing Modules                         │  Weeks 21-28    │
│          │  Production · QC/SPC · Equipment               │                 │
│          │  PLM docs · RFQ/BOM · Logistics · ESG          │                 │
├──────────┼────────────────────────────────────────────────┼─────────────────┤
│  EPIC 7  │  AI & Intelligence                             │  Weeks 29-32    │
│          │  LLM Gateway · RAG · AI Routing                │                 │
│          │  BMAD Agent hooks · Predictive analytics       │                 │
├──────────┼────────────────────────────────────────────────┼─────────────────┤
│  EPIC 8  │  Marketplace                                   │  Weeks 33-38    │
│          │  Digital store · Physical marketplace          │                 │
│          │  Plugin registry · Seller dashboard            │                 │
├──────────┼────────────────────────────────────────────────┼─────────────────┤
│  EPIC 9  │  Admin Dashboard + Hardening                   │  Weeks 39-42    │
│          │  Admin shell · Audit viewer · Retention config │                 │
│          │  SOC2 prep · GDPR workflows · Penetration test │                 │
├──────────┼────────────────────────────────────────────────┼─────────────────┤
│   v1.0   │  Production Release                            │  Week 48        │
│          │  Full staging validation · Load test           │                 │
│          │  Documentation complete · Training material    │                 │
└──────────┴────────────────────────────────────────────────┴─────────────────┘
```

## Decision Gates (Required Before Next Epic)

| Gate | Requirement |
|------|------------|
| E-0 → E-1 | All 14 Epic 0 exit criteria passed |
| E-1 → E-2 | Auth + policy enforced; audit log writing; tenant isolation verified |
| E-2 → E-4 | Messaging MVP live; 1,000 concurrent WebSocket connections stable |
| E-3 → E-4 | Frontend login flow working; design system published to Storybook |
| E-4 → E-5 | Omnichannel inbox receiving messages from at least 2 channels |
| E-5 → E-6 | Document collab tested with 5 concurrent editors; CAD viewer spike done |
| E-6 → E-7 | At least 3 manufacturing modules in production use by AAE team |
| E-7 → E-8 | RAG answering KB questions with >70% accuracy; LLM gateway cost metered |
| E-8 → E-9 | Digital store transacting; at least 10 test orders processed |
| E-9 → v1.0 | All SOC2 controls mapped; GDPR DPA signed; load test passes SLOs |

## Parallel Work Rules

- **Epic 3** (Frontend) runs in parallel with **Epic 2** (Backend) after Epic 1 is complete
- **Epic 7** (AI) spike tasks can start during Epic 5
- **Documentation** (Paige/Tech Writer agent) runs continuously alongside each Epic
- **Security scans** (Nuclei, Trivy) run on every staging deploy from Epic 0 onwards

## Technology Dependencies by Epic

| Epic | New Tech Introduced |
|------|-------------------|
| 0 | K8s, Gitea, Argo CD, Vault, Keycloak, OPA, NATS, PostgreSQL, MongoDB, ES, MinIO, Redis, Prometheus, Grafana, Loki, Jaeger, Trivy, Cosign, Backstage |
| 1 | Kong, OPA HTTP API, Elasticsearch audit index |
| 2 | Socket.IO / Gorilla, NestJS WebSocket gateway, ClamAV |
| 3 | Next.js 14, Turborepo, shadcn/ui, Tailwind, Keycloak JS adapter |
| 4 | Meta WhatsApp Business API, Telegram Bot API, IMAP/SMTP adapter, BullMQ |
| 5 | ProseMirror, Yjs (CRDT), APS Viewer SDK (CAD), Calendso/Cal.com (calendar) |
| 6 | TimescaleDB (eval), SPC charting libs, carrier API integrations |
| 7 | OpenAI API / Ollama, LlamaIndex / LangChain, embeddings store |
| 8 | Stripe SDK, payment webhook handlers |
| 9 | — (hardening only) |

## Repository Structure (Target)

```
aaelink-gitops/           ← Kubernetes manifests, Helm values
aaelink-monorepo/         ← Application code (Turborepo)
  apps/
    web/                  ← Next.js frontend
    admin/                ← Admin dashboard
  services/
    auth-service/
    messaging-service/
    media-service/
    notification-service/
    crm-service/
    ticket-service/
    document-service/
    task-service/
    cad-service/
    kb-service/
    manufacturing-service/
    qc-service/
    equipment-service/
    rfq-service/
    marketplace-service/
    store-service/
    ai-gateway/
    audit-service/
    tenant-service/
  packages/
    ui/
    sdk/
    i18n/
    theme/
    cad-viewer/
    types/
    config/
```
