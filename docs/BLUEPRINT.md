# AAELink — Enterprise Communication Platform Blueprint

**Codename:** AAELink (Advanced Async + Enterprise Link)
**Version:** Blueprint v1.0
**Status:** Architectural Specification — canonical reference for all feature work

---

## 1. Executive Summary

### 1.1 Vision
Build an enterprise-grade communication and collaboration platform that achieves **100% functional parity with Slack/Mattermost** while delivering measurable improvements in: information density, search relevance, async-first workflows, deep work protection, native task management, compliance posture, and total cost of ownership for organizations of 100–250,000 seats.

### 1.2 Strategic Positioning
| Dimension | Slack (baseline) | AAELink (target) |
|---|---|---|
| Primary metaphor | Synchronous chat with channels | Hybrid sync/async workspace |
| Pricing model | Per-seat, message limits | Per-seat with self-hostable tier; no message caps |
| Information architecture | Channel-centric | Workspace → Spaces → Channels → Canvases/Threads |
| Search | Keyword + filters | Hybrid lexical + semantic + entity |
| Automation | Workflow Builder | Visual + DSL + LLM-authored |
| Compliance | Enterprise Grid only | Built-in from day one |
| Deployment | SaaS only | SaaS + Private Cloud + Air-gapped on-prem |

### 1.3 Success Metrics (12 months post-GA)
- ≥ 99.99% uptime SLO (≤ 52 min/year downtime)
- p95 message fan-out latency ≤ 150 ms in-region; ≤ 400 ms cross-region
- ≥ 70% search query satisfaction
- ≤ 30 ms median UI input-to-paint on 4-year-old hardware
- WCAG 2.2 AA conformance verified by third-party audit
- SOC 2 Type II, ISO 27001, ISO 27018, HIPAA-ready, FedRAMP Moderate path

---

## 2. Feature Set Analysis

### 2.1 Slack Feature Parity Matrix

#### 2.1.1 Core Messaging
| Feature | Spec |
|---|---|
| Public/Private Channels | Unlimited, with categories, sections, starring, muting, custom retention |
| Direct Messages | 1:1 and group (up to 50); E2EE optional in compliance mode |
| Threads | Unlimited depth (UI optimized for 1 level); follow/unfollow; thread digests |
| Mentions | `@user`, `@here`, `@channel`, `@group`, `@role`, `@team`, smart-suppress on focus mode |
| Reactions | Full Unicode + custom emoji + animated emoji (Lottie) + skin tones |
| Message editing | Versioned with diff view; admin-controlled edit window |
| Message deletion | Soft-delete with retention; tombstone for compliance |
| Pinning & Bookmarks | Per-channel pins; personal bookmarks; bookmark folders |
| Drafts | Auto-save server-side, multi-device sync |
| Scheduled send | Up to 120 days; recurring scheduled messages |
| Saved items | Replaced by **"Later" inbox** with snooze, tags, due dates |

#### 2.1.2 Calls & Video
| Feature | Spec |
|---|---|
| Huddles | Always-on lightweight audio rooms per channel |
| Video calls | Up to 50 participants; SFU (mediasoup or LiveKit) |
| Screen sharing | Multi-stream, region select, audio share |
| Recording | Auto-transcribed, speaker-labeled, searchable |
| Clips | Up to 5 min async video/audio, auto-captioned |
| Live captions | Real-time ASR with speaker diarization |

#### 2.1.3 Files & Knowledge
| Feature | Spec |
|---|---|
| File sharing | Up to 5 GB per file (configurable); resumable upload |
| File preview | PDF, Office, code, images, video, 3D (gltf), CAD (DWG) |
| Canvases | Notion-like collaborative documents per channel/DM |
| Lists | Structured data with views (table/kanban/calendar) |
| Knowledge Base | First-class wiki with versioning and approvals |
| Code snippets | Syntax-highlighted, runnable in sandbox (optional) |

#### 2.1.4 Search & Discovery
| Feature | Spec |
|---|---|
| Universal search | Hybrid: BM25 + dense vectors + entity graph |
| Filters | People, channel, date, file type, has:link, before/after, in:thread |
| Saved searches | With alerts on new matches |
| Smart suggestions | LLM-grounded answers citing source messages |

#### 2.1.5 Notifications & Presence
| Feature | Spec |
|---|---|
| Per-channel prefs | All / mentions / nothing; thread overrides |
| DND & Focus | Schedule-based + calendar-aware + smart focus mode |
| Status | Custom emoji + text + auto-clear + calendar sync |
| Presence | Active / away / in-meeting / on-leave; privacy controls |
| Push | APNs, FCM, WebPush; per-device prefs |
| Digest emails | Configurable: realtime, hourly, daily, weekly |

#### 2.1.6 Integrations & Extensibility
| Feature | Spec |
|---|---|
| Apps | OAuth 2.1 + PKCE app framework |
| Slash commands | Built-in + custom; autocomplete with schemas |
| Webhooks | Incoming + outgoing + event subscriptions |
| Workflow Builder | Visual DAG editor + DSL + LLM authoring |
| Bots | Conversational + reactive; first-class agent SDK |

### 2.2 Enhancement & Gap-Closing Features

#### 2.2.1 Async-First Primitives
- **Loops** — Threaded async stand-ups with structured templates and digests
- **Decisions** — First-class decision records with stakeholders, deadlines, audit trail
- **Action Items** — Auto-extracted from messages via NLU; assigned, tracked, due-dated
- **Boards** — Per-channel kanban/sprint views fed by messages and tasks

#### 2.2.2 Deep Work & Wellbeing
- **Focus Sessions** — Pomodoro-style with notification suppression and presence broadcast
- **Meeting-Free Blocks** — Calendar-integrated; auto-decline new invites
- **Cognitive Load Indicators** — Show recipient's notification load before sending
- **Quiet Hours by Region** — Org-wide policy with override audit

#### 2.2.3 Enterprise Differentiators
- **Granular RBAC** — Attribute-based (ABAC) with per-channel, per-message-class policies
- **DLP** — Inline scanning for PII/PHI/PCI/secrets with policy-driven actions
- **Information Barriers** — Ethical walls between teams (legal, M&A, trading)
- **eDiscovery** — Native legal hold, custodian export, chain-of-custody
- **Data Residency** — Per-workspace region pinning with automated egress controls
- **Customer Key (BYOK/HYOK)** — Tenant-controlled encryption keys
- **Compliance Modes** — HIPAA, FINRA 17a-4, SEC 17a-4, GDPR, FedRAMP profiles

#### 2.2.4 Intelligence Layer
- **Recap** — Daily/weekly TL;DRs of channels and threads with citations
- **Smart Reply** — Context-aware drafts respecting your voice
- **Translation** — 90+ languages, inline, with original toggle
- **Action Extraction** — Auto-suggest tasks, decisions, FAQs from conversation
- **Knowledge Mining** — Surface answers from prior conversations + connected docs
- All AI features tenant-isolated; opt-in; "no training on your data" guarantee

---

## 3. UI/UX Design Principles & Roadmap

### 3.1 Design Philosophy
1. Calm by default, powerful on demand
2. Information density without clutter (1.5× Slack at same legibility)
3. Direct manipulation
4. Keyboard-first power
5. Accessibility is a baseline (WCAG 2.2 AA)
6. Responsive across breakpoints
7. Themable & customizable

### 3.2 Information Architecture
```
Workspace (org)
├─ Spaces (departments / projects / customers)
│  ├─ Channels (public, private, multi-org)
│  │  ├─ Messages → Threads
│  │  ├─ Canvases (collaborative docs)
│  │  ├─ Lists (structured data)
│  │  ├─ Files (DAM-grade)
│  │  └─ Huddles & Calls
│  └─ Bookmarks, Pins, Members
├─ DMs (1:1, Group)
├─ Later (personal inbox / saved)
├─ Activity (mentions, reactions, follows)
├─ Search (universal)
└─ Apps & Automations
```

### 3.3 Layout System
- **Rail (40 px)** — Workspace switcher, primary nav (Home, Activity, Later, Search, More)
- **Sidebar (240–320 px)** — Collapsible Spaces tree with custom sections
- **Main (flex)** — Channel/DM/Doc/Search view; supports split-pane (message + thread)
- **Right Panel (320–420 px)** — Threads, profiles, file details, app surfaces
- Adaptive: triple-pane (≥1280 px), dual-pane (≥768 px), single-pane (mobile)
- Compact + Comfortable density modes

### 3.4 Key UX Innovations
- **Smart Inbox ("Later")** — unified triage + snooze + tags
- **Thread-as-page** — promote thread to canvas without losing context
- **Smart Notifications** — bundle / batch / prioritize with on-device ML
- **Slash++** — command palette (Cmd/Ctrl+K)
- **Inline Composers** — reply/edit/react/translate without leaving the message
- **Conversation Cards** — decisions, action items, polls render as structured cards
- **Presence with Context** — "In a meeting until 3:00" auto from calendar
- **Time Zone Aware Send** — show recipient local time; suggest scheduled send

### 3.5 Accessibility
- WCAG 2.2 AA across all surfaces; AAA on auth and core read paths
- Full keyboard navigation; visible focus rings (≥ 2 px, 3:1 contrast)
- ARIA live regions for incoming messages with batching
- Reduced motion mode
- Captions for all video/audio; transcripts for huddles
- 40+ languages at GA; RTL tested
- Cognitive accessibility: simple-language toggle

### 3.6 Phased UI/UX Rollout
| Phase | Weeks | Scope |
|---|---|---|
| P0 Foundations | 1–8 | Design system, tokens, primitives, a11y baseline |
| P1 Core Messaging | 9–20 | Channels, DMs, threads, composer, search v1 |
| P2 Collaboration | 21–32 | Canvases, lists, files, huddles, presence |
| P3 Automation & Apps | 33–44 | Workflows, apps, slash++, integrations gallery |
| P4 Intelligence | 45–56 | Recap, smart reply, translation, action extraction |
| P5 Enterprise | 57–68 | Admin, compliance, DLP, eDiscovery, BYOK |
| P6 Polish & GA | 69–76 | Performance, AT audit, pen-test, GA launch |

---

## 4. Technical Architecture Specification

### 4.1 High-Level Architecture
```
┌─────────────────────────────────────────────────────────────┐
│       Clients (Web, Desktop, iOS, Android)                   │
└─────────────────────────────────────────────────────────────┘
        │ HTTPS/WSS (h3, h2, fallback h1.1)
┌─────────────────────────────────────────────────────────────┐
│  Edge: TLS 1.3, WAF, DDoS, Geo-routing, CDN                  │
└─────────────────────────────────────────────────────────────┘
        │
┌─────────────────────────────────────────────────────────────┐
│  API Gateway / GraphQL Federation                            │
│  AuthN/AuthZ, Rate-limit, Schema validation, Feature flags   │
└─────────────────────────────────────────────────────────────┘
        │
┌─────────────────────────────────────────────────────────────┐
│  Service Mesh — mTLS, retries, circuit breakers              │
│  Identity│Messaging│Channels│Files│Search│Notifications│     │
│  Calls   │Workflow │Apps    │KB   │Audit │AI/ML        │     │
└─────────────────────────────────────────────────────────────┘
        │
┌─────────────────────────────────────────────────────────────┐
│  Event Backbone: Kafka/Redpanda                              │
│  Cache: Redis Cluster                                        │
└─────────────────────────────────────────────────────────────┘
        │
┌─────────────────────────────────────────────────────────────┐
│  Stores                                                      │
│  Postgres 16 (Citus), ScyllaDB, OpenSearch+Vector,           │
│  S3/MinIO, Neo4j, ClickHouse                                 │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Frontend
- Next.js 16 App Router + React 19
- TypeScript 6 strict
- State: Zustand (UI) + TanStack Query (server) + Y.js (CRDT for canvases)
- Realtime: WebSocket + WebTransport fallback; SSE for low-priority streams
- Styling: Tailwind + CSS variables for theming + Radix UI primitives
- Component library: AAELink design system on Radix
- Build: Turbopack/SWC; Module Federation for plugins
- Testing: Vitest, RTL, Playwright, axe-core, Lighthouse CI
- Native wrappers: Electron (current) → Tauri (target) for desktop; native iOS/Android

#### Patterns
- Hybrid SPA/SSR: RSC for shell, SPA for messaging hot path
- Atomic design: tokens → primitives → patterns → templates → views
- Optimistic UI with reconciliation
- Virtualization (Virtuoso) for message lists
- Offline: IndexedDB-backed mailbox with sync engine
- Bundle: ≤ 220 KB initial JS; per-route code-splitting
- Performance budgets: LCP ≤ 1.5 s p75; INP ≤ 100 ms; CLS ≤ 0.05

### 4.3 Backend Microservices

| Service | Responsibility | Stack |
|---|---|---|
| identity-svc | Auth, sessions, SSO/SAML/OIDC, SCIM, MFA | Go + OpenFGA |
| workspace-svc | Workspaces, spaces, channels, members | Go + Postgres |
| messaging-svc | Message ingest, fanout, read receipts | Rust + ScyllaDB + Kafka |
| realtime-gw | WebSocket fanout, presence | Elixir/OTP (or Go + nats) |
| search-svc | Indexing, query, suggestions | Go + OpenSearch + vector |
| files-svc | Upload, AV scan, transcode, preview | Go + S3 |
| calls-svc | Signaling, room state, recording | Node + LiveKit/mediasoup |
| notification-svc | Push, email, digest, dedupe | Go |
| workflow-svc | DAG executor, triggers, retries | Go + Temporal |
| app-platform-svc | OAuth apps, manifests, marketplace | Go |
| kb-svc | Canvases, lists, wiki | Node + Postgres + Y.js server |
| ai-svc | LLM gateway, embeddings, recap | Python + vLLM/Triton |
| audit-svc | Append-only audit log, eDiscovery | Go + immutable storage |
| billing-svc | Plans, usage, invoicing | Go + Stripe |
| admin-svc | Org admin, policies, DLP rules | Go |

> **Current AAELink reality:** monolithic Next.js + Postgres. The blueprint describes the target distributed architecture; migration is incremental — extract services as load demands.

#### API Design
- External: GraphQL (federated) + WebSocket subscriptions; REST for files; gRPC for partners
- Internal: gRPC with Buf-managed schemas; async over Kafka with CloudEvents
- Versioning: schema-first; backward compat ≥ 12 months
- AuthN/AuthZ: OAuth 2.1 + PKCE; mTLS + SPIFFE; OpenFGA (ReBAC)
- Rate Limiting: token-bucket per user/app/IP
- Idempotency: `Idempotency-Key` on all mutations; 24-hour replay window

### 4.4 Real-Time Engine
- Connection tier: Elixir/OTP gateway — ≥ 2 M concurrent WS / region
- Fanout: Kafka topic per workspace partitioned by channel_id
- Presence: Redis pub/sub; CRDT for cross-region
- Ordering: per-channel monotonic sequence ID; client gap detection
- Backpressure: per-connection token bucket; shed to digest path
- Reconnection: stream resumption with last-seen offset; max 30s session continuity

### 4.5 Data Layer
| Concern | Choice | Rationale |
|---|---|---|
| Relational | PostgreSQL 16 + Citus | Sharded by workspace_id; ACID for membership/permissions |
| Messages | ScyllaDB | Time-series, write-optimized, 1M+ ops/sec/node |
| Search | OpenSearch + Vector (or Vespa) | Hybrid lexical + semantic |
| Object | S3 / MinIO | Multipart, presigned, lifecycle, CRR |
| Cache | Redis Cluster | Presence, sessions, hot reads |
| Graph | Neo4j | Permissions, entity graph |
| Analytics | ClickHouse | Real-time admin/usage dashboards |
| Streaming | Kafka / Redpanda | Event backbone, audit, derived stores |
| Workflow | Temporal | Durable workflows, retries, sagas |

### 4.6 Search Engine
- Lexical: OpenSearch BM25 + custom analyzers
- Semantic: SBERT/E5-class embeddings; HNSW index
- Hybrid Ranking: Reciprocal Rank Fusion + LightGBM LTR
- Personalization: per-user click signals (privacy-preserving)
- Permissioning: pre-filter by ACL before scoring
- Freshness: ≤ 2 s via Kafka → indexer

### 4.7 AI/ML Layer
- Inference: vLLM/TGI for OSS; Bedrock/Vertex/Azure for managed
- Tenant Isolation: per-tenant prompt + retrieval; no cross-tenant context
- Privacy: "no training on your data"; logs scrubbed; opt-out per workspace
- Use Cases: recap, smart reply, translation, search, action extraction
- Eval: continuous offline + online A/B; safety filter; abstention on low confidence

### 4.8 Infrastructure & DevEx
- Cloud: AWS primary; Azure & GCP for sovereignty regions; on-prem via OpenShift
- Compute: Kubernetes (EKS) with Karpenter
- IaC: Terraform + Crossplane; ArgoCD for GitOps
- CI/CD: GitHub Actions + Buildkite; progressive delivery via Argo Rollouts
- Observability: OpenTelemetry → Tempo + Loki + Mimir + Grafana
- SLOs: per-service error budgets; auto-rollback on burn-rate
- Chaos: Litmus / Gremlin scheduled in pre-prod
- Feature Flags: OpenFeature

---

## 5. Audit, QA, and Conflict Analysis

### 5.1 Architecture Risks

| Risk | Mitigation |
|---|---|
| WS gateway is stateful — AZ failure drops connections | Multi-AZ sticky sessions + 30s session resume; 2-region active/standby |
| Postgres+Citus learning curve | Pre-prod load tests at 10× target; pgBouncer + read-replicas |
| Vector search cost at scale | Tiered: hot (90 d) + cold; per-tenant budgets |
| AI features → cost overrun | Per-tenant rate limits + caching + small-model routing |
| Multi-region consistency | Per-channel home region; cross-region read-only mirrors |
| Compliance ↔ AI | Per-workspace AI gating; HIPAA disables third-party LLMs |
| Plugin sandbox escape | Webview isolation, manifest scopes, runtime CSP, security review |

### 5.2 QA Strategy
| Layer | Approach | Tooling |
|---|---|---|
| Unit | ≥ 80% on services; 70% UI | Vitest, Go test, pytest |
| Component | All design-system primitives | Storybook + Chromatic |
| Contract | Provider/consumer pacts | Pact, Buf breaking-change |
| Integration | Real DB/Kafka via Testcontainers | Testcontainers |
| End-to-End | Critical user journeys | Playwright, Detox |
| Performance | k6 load profiles | k6, Locust |
| Soak | 72-hour realistic-load runs | k6 + Argo Workflows |
| Chaos | Pod kills, partitions, latency injection | Litmus, Toxiproxy |
| Security | SAST/DAST/SCA/IaC/secrets | CodeQL, Semgrep, Trivy, Gitleaks |
| Penetration | External quarterly + pre-GA | Third party |
| Accessibility | Automated + manual + AT user | axe-core, NVDA, VoiceOver, JAWS |
| Localization | Pseudo-localization in CI | Crowdin |
| Compliance | Continuous controls testing | Drata/Vanta + custom |

### 5.3 Conflict Patterns

| Conflict | Resolution |
|---|---|
| Async-first features vs realtime expectations | Default async; opt-in realtime overlays |
| AI vs data residency | Per-region inference; in-region only; explicit consent |
| E2EE vs Search/AI | Default plaintext-on-server with strong ACLs; compliance mode opts out of cross-message search/AI |
| Granular RBAC vs UX simplicity | Sensible defaults + role templates; advanced UI admin-only |
| Federation/multi-org vs DLP | Egress DLP at boundary; admin policies; "external" indicators |
| Plugin extensibility vs supply-chain | Manifest scopes, signed apps, marketplace review, runtime sandbox |
| High info density vs accessibility | Configurable density per user; AA conformance verified at every density |
| Self-hosted vs SaaS feature parity | Single codebase; feature flags for managed-only services |

### 5.4 Scalability Targets
| Dimension | Target |
|---|---|
| Workspaces / region | 100,000 |
| Members / workspace | 250,000 |
| Concurrent WS / gateway pod | 50,000 |
| Concurrent WS / region | 5,000,000 |
| Messages / sec / region (peak) | 250,000 |
| p95 fanout latency | ≤ 150 ms in-region |
| Search QPS / tenant (sustained) | 50; bursts to 500 |
| File upload throughput | 10 GB/s per region |

### 5.5 Security & Compliance
- AuthN: OAuth 2.1, OIDC, SAML 2.0; passkeys (WebAuthn) first-class; MFA mandatory for admins
- AuthZ: OpenFGA (ReBAC) + ABAC overlays
- Encryption: TLS 1.3 transit; AES-256-GCM at rest; KMS envelope; HYOK/BYOK
- Secrets: Vault + workload identity
- DLP: inline scanners; actions block/redact/quarantine/alert
- Auditing: tamper-evident chain; SIEM export
- eDiscovery: legal hold, custodian search, chain-of-custody
- Information Barriers: bidirectional walls
- Compliance: SOC 2 Type II, ISO 27001/27017/27018, HIPAA, GDPR, FedRAMP path, FINRA/SEC 17a-4
- Data Residency: per-workspace pinning (US, EU, UK, CA, AU, JP, IN, AE, SG)
- Vulnerability SLA: Critical 24h, High 7d, Medium 30d, Low 90d
- Bug Bounty: public at GA

---

## 6. Program Plan & Milestones

### 6.1 Roadmap (76 weeks to GA)

| Milestone | Week | Exit Criteria |
|---|---|---|
| M0 Foundation | 8 | Design system v1, IaC, CI/CD, observability stack |
| M1 Identity & Workspaces | 14 | SSO/SCIM, RBAC, workspace lifecycle |
| M2 Messaging Core | 22 | Channels, DMs, threads, search v1, presence |
| M3 Files & Calls | 32 | Files, huddles, video, recording |
| M4 Knowledge | 40 | Canvases, lists, wiki, KB |
| M5 Apps & Workflows | 48 | App platform, workflow builder, marketplace beta |
| M6 Intelligence | 56 | Recap, smart reply, hybrid search, translation |
| M7 Enterprise & Compliance | 66 | DLP, eDiscovery, BYOK, audit, residency |
| M8 Hardening | 72 | Pen-test, AT audit, soak, chaos passes |
| **GA** | **76** | All SLOs met; compliance certifications in flight |

### 6.2 Risk Register (top 10)

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | Realtime gateway scale | High | Elixir/OTP proven; load tests at 10×; multi-region |
| 2 | Search relevance vs Slack | High | Hybrid + LTR; continuous eval; feedback loop |
| 3 | AI cost overrun | Medium | Per-tenant budgets; small-model routing; caching |
| 4 | Compliance certification delays | High | Continuous controls; engage auditors at M5 |
| 5 | Mobile parity | Medium | Native iOS/Android team from M1 |
| 6 | App ecosystem cold start | Medium | First-party integrations + Slack-app migration |
| 7 | Migration friction from Slack | High | Native importer (channels, history, files, users) |
| 8 | Org-wide change management | Medium | Admin migration kit; rollout playbook; training |
| 9 | Multi-region consistency edge cases | Medium | Conservative home-region design; chaos tests |
| 10 | Insider threat / data egress | High | DLP, audit, info barriers, anomaly detection |

---

## 7. Appendix — Current AAELink Reality vs Blueprint

The current codebase is a single Next.js 16 monolith with Postgres + Redis + S3/MinIO. The blueprint describes the **target** architecture for ≥ M2 scale; treat each blueprint section as a north star to migrate toward, not as a requirement that today's monolith must already satisfy.

When proposing a change, reference this appendix to be honest about whether the change brings us *closer* to the blueprint or *further* from it.

---

**End of Blueprint v1.0.**
This document is the canonical reference for `/aae-feature-plan`, `/aae-blueprint-align`, and all architectural decisions. Update with explicit ADR-style notes; do not silently rewrite.
