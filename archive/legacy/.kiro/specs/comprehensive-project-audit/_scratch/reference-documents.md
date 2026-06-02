# Phase A — Reference_Documents Scratch Note

**Audit run:** comprehensive-project-audit
**Run date (UTC):** 2026-05-25
**Source documents (Reference_Documents, read-only context per Requirement 2.2):**
- `docs/ENTERPRISE-BLUEPRINT.md` (Enterprise Blueprint v2.0, 559 lines, 24 KB)
- `docs/NORTH-STAR-A.md` (North Star — Native collaboration hub, 16 lines, 991 B)
- `docs/ROADMAP.yaml` (machine-readable roadmap, 280 lines, 12 KB)
**North_Star_Document (sole goal source per Requirement 2.1):** `docs/BLUEPRINT.md` (Blueprint v1.0, 451 lines)
**Phase:** A (in-memory; not an audit deliverable)
**Status:** scratch — internal working state for tasks 2.2 (`aaelink-blueprint`), 7.3 (Verification_Protocol goal cross-check), Property 6
**Pair file:** `_scratch/blueprint-goals.md` (records the empty `BlueprintGoal[]` extracted from the North_Star_Document)
**Do not** treat this file as a deliverable. Phase H (task 10.x) is the only disk-emit phase for `docs/audit-*.md`.

---

## Methodology

Per Requirement 2.2 and `design.md` § "Blueprint_Goal extraction":

1. Read each Reference_Document end-to-end. All three confirmed present on disk.
2. Inventory goal-like statements (headings + bullets, with line numbers) — **but never** add them to `BlueprintGoal[]`.
3. Diff each Reference_Document against the North_Star_Document for substantive disagreements.
4. Per Requirement 2.3: every conflict becomes a candidate 🎯 `DRIFT-NNN` Finding **against the Reference_Document**, not against `docs/BLUEPRINT.md`. The North_Star_Document is never amended.

The conflict diffs below are **observations**, not Findings. The `aaelink-blueprint` skill in Phase B (task 2.2) decides which observations become 🎯 `DRIFT-NNN` Findings on the deliverable. The Phase E `Verification_Protocol` (task 7.3) cross-checks emitted Findings against the empty `BlueprintGoal[]` from `_scratch/blueprint-goals.md`.

---

## 1. Goal-like statement inventories (per document)

### 1.1 `docs/ENTERPRISE-BLUEPRINT.md` (559 lines)

Headings (L1–L3) and goal-like bullets enumerated. None of the L2/L3 headings prefix-matches `/^(Goal|Requirement|Objective|Capability)/i`; one bullet ("Build an enterprise-grade communication platform achieving 100% Slack/Mattermost functional parity…") is heading-bound to § 1.4 Strategic Vision and would prefix-match `/^Build/i` but **not** the design.md regex `/^MUST|^SHALL|^Provide|^Support/i`. So zero entries would qualify for `BlueprintGoal[]` even if extraction were authorized — and it is not (Requirement 2.2).

| Line | Level / form | Heading or bullet | Topic |
|---|---|---|---|
| 1 | # | AAELink — Enterprise Blueprint v2.0 | doc title |
| 23 | ## | 1. Executive Summary | section |
| 25 | ### | 1.1 What AAELink Is | scope |
| 29 | ### | 1.2 Current State (v0.0.3-alpha — May 2026) | metrics snapshot |
| 43 | ### | 1.3 Technology Stack | stack table |
| 58 | ### | 1.4 Strategic Vision | vision |
| 61 | bullet (under 1.4) | "Build an enterprise-grade communication platform achieving 100% Slack/Mattermost functional parity…" | goal-like (parity + scale 100–250k seats) |
| 64 | ## | 2. Architecture Overview | section |
| 66 | ### | 2.1 System Topology | monolith Next.js + Postgres + MinIO + Redis + Stirling |
| 100 | ### | 2.2 Data Flow | flow |
| 111 | ### | 2.3 Service Boundaries | route domain table |
| 132 | ### | 2.4 Lib Module Architecture (84 modules, 13,438 lines) | lib catalog |
| 151 | ## | 3. Infrastructure & Deployment | section |
| 153 | ### | 3.1 Current Deployment Topology | Docker Desktop K8s |
| 170 | ### | 3.2 Kubernetes Manifests | manifest sets |
| 190 | ### | 3.3 Scaling Strategy | Alpha→Beta→GA→Enterprise table |
| 199 | ### | 3.4 HA/DR Plan | RTO < 15 min, RPO < 5 min |
| 210 | ### | 3.5 CI/CD Pipeline | gates |
| 224 | ## | 4. Security & Compliance | section |
| 226 | ### | 4.1 Authentication Stack | bcrypt, OAuth, OIDC, MFA, SAML/Passkeys planned |
| 237 | ### | 4.2 Authorization Model | platform / channel / workspace roles |
| 257 | ### | 4.3 Security Middleware | csrf, csp, ipAccess, rate-limit, session, audit |
| 269 | ### | 4.4 Encryption | TLS 1.3, TDE, SSE-S3, EKM planned |
| 279 | ### | 4.5 Compliance Readiness | SOC 2 (in progress), ISO 27001 / HIPAA / FedRAMP planned, GDPR partial |
| 289 | ### | 4.6 Enterprise Compliance Features | DLP / IB / legal hold / retention / audit / SCIM v2 / domain claim / EMM |
| 305 | ## | 5. API & Integration Surface | section |
| 307 | ### | 5.1 Route Distribution (226 total) | route counts |
| 327 | ### | 5.2 Slack Method Group Parity (55/55) | parity claim |
| 331 | ### | 5.3 Webhook System | webhook engine |
| 342 | ### | 5.4 Realtime Transport | SSE + WS table |
| 354 | ## | 6. Feature Matrix & Flag System | section |
| 356 | ### | 6.1 Feature Flag Architecture | env→DB→default tier |
| 368 | ### | 6.2 Complete Flag Registry (28 flags) | 20 consumer + 8 enterprise |
| 410 | ## | 7. Observability Stack | section |
| 412 | ### | 7.1 Tracing (OpenTelemetry) | 429+ handlers traced |
| 421 | ### | 7.2 Metrics (Prometheus) | metric catalog |
| 430 | ### | 7.3 Logging | structured + audit + audit stream |
| 438 | ### | 7.4 Health Checks | `/api/health` shape |
| 454 | ## | 8. Release Plan & Roadmap | section |
| 456 | ### | 8.1 Version History | shipped table (v0.0.1, v0.0.2, v0.0.3) |
| 464 | ### | 8.2 Roadmap: Alpha → GA | per-version theme box |
| 477 | ### | 8.3 v0.0.8 — Hardening & Observability (Target: Jun–Jul 2026) | deliverables |
| 488 | ### | 8.4 v0.1.0 — Production Readiness (Target: Aug–Oct 2026) | deliverables |
| 499 | ### | 8.5 v1.0.0 — Enterprise GA (Target: Q1 2027) | deliverables |
| 509 | ### | 8.6 Success Metrics (12 months post-GA) | targets |
| 521 | ## | Appendix A — QA Coverage Summary | suites/tests/modules |
| 539 | ## | Appendix B — Database Schema (Key Tables) | key tables |
| 558 | bullet (footer) | "This document supersedes BLUEPRINT.md v1.0 and serves as the canonical reference…" | **claim of supersession** |

### 1.2 `docs/NORTH-STAR-A.md` (16 lines)

Tiny document. All goal-like content listed in full — extraction excluded per Requirement 2.2.

| Line | Level / form | Heading or bullet | Topic |
|---|---|---|---|
| 1 | # | North Star — Native collaboration hub | doc title — claims to be a "north star" |
| 3 | bullet | "AAELink (this Next.js app) is the primary product: workspaces, channels, messages, tickets, and documents are implemented here against PostgreSQL (schema `aaelink`) and optional S3-compatible storage." | scope statement (primary product = web app; 5 entities) |
| 5 | ## | Realtime | section |
| 7 | bullet | "The web client opens Server-Sent Events on `/api/collab/events`… If `EventSource` is unavailable, it falls back to polling via `/api/messages`." | realtime transport: SSE + polling fallback |
| 9 | ## | Registration | section |
| 11 | bullet | "When `AAELINK_OPEN_REGISTRATION` is unset or not `0`, anyone can register. Set `AAELINK_OPEN_REGISTRATION=0` to block new signups…" | open-registration toggle |
| 13 | ## | See also | xref to `architecture-technical.md` + `README.md` |

### 1.3 `docs/ROADMAP.yaml` (280 lines)

YAML — flat key tree, not headings. Goal-like content lives in `versions.<semver>.items[*]` entries. Each entry has `id`, `priority`, `title`, `description`, optional `audit_section`, optional `depends_on`, optional `status`/`shipped_on`. Inventory by version-status-priority (counts) rather than reproducing every entry; full enumeration is on disk and unchanged.

| Line | YAML key | Value | Topic |
|---|---|---|---|
| 26 | schema_version | 1 | metadata |
| 27 | current_version | 0.0.58-alpha | metadata |
| 28 | last_updated | 2026-05-20 | metadata |
| 30 | versions | (mapping) | per-version themes |
| 32 | 0.0.57-alpha | shipped, theme: Versioned migration runner | 1 item (`migration-runner` P0) |
| 47 | 0.0.58-alpha | in-progress, theme: BMAD Method dialect formalization | 8 items (`bmad-install`, `bmad-steering`, `roadmap-yaml`, `adr-register`, `skill-handoff-blocks`, `aaelink-analyst-skill`, `story-format`, `blueprint-align-roadmap`) — all P1 |
| 132 | 0.0.43-alpha | planned, theme: Inline-style cleanup round 2 + typing/presence WS migration | 9 items: 4× P1, 4× P2; three already `shipped_on: 2026-05-20` (`home-shell-disable-presence-sse`, `replay-skip-ephemeral-topics`, `gateway-rate-limit`) |
| 199 | 0.0.20-alpha | planned, theme: Alerting, E2E testing, production hardening | 7 items: 3× P0 (`alertmanager-rules`, `e2e-full-flow`, `mtls-federation`), 2× P1 (`audit-log-streaming`, `rate-limit-dashboard`), 2× P2 (`ci-integration`, `openapi-richer`) |
| 234 | 0.1.0-beta | planned, theme: Production readiness | 8 items: 3× P0 (`k8s-helm`, `redis-fanout-scale`, `elasticsearch`), 3× P1 (`webrtc-media`, `pwa-mobile`, `ldap-live`), 2× P2 (`clamav-integration`, `hsm-kms`) |
| 263 | 1.0.0 | planned, theme: Enterprise GA | 7 items: 3× P0 (`native-mobile`, `webrtc-full`, `soc2`), 2× P1 (`federation`, `plugin-sdk`), 2× P2 (`marketplace`, `ai-copilot`) |

Total roadmap items: 40 across 6 versions. Zero items mention ScyllaDB / OpenSearch / Vespa / Neo4j / ClickHouse / Kafka / Temporal / Tauri / Citus / OpenFGA / SPIFFE / WebTransport / Y.js server / mediasoup-as-now / LiveKit-as-now (only `webrtc-media` v0.1.0-beta and `webrtc-full` v1.0.0 mention WebRTC at all).

---

## 2. Conflict table vs `docs/BLUEPRINT.md`

Each row records a substantive disagreement. Wording is precise; the column "Reference says" carries the Reference_Document position, "BLUEPRINT.md says" carries the North_Star_Document position. Lines cited so Phase B can re-resolve without re-reading.

### 2.1 `docs/ENTERPRISE-BLUEPRINT.md` vs `docs/BLUEPRINT.md`

| # | Topic | Reference (`docs/ENTERPRISE-BLUEPRINT.md`) says | `docs/BLUEPRINT.md` says | Severity (candidate) |
|---|---|---|---|---|
| EB-1 | **Document supersession** | line 558: "This document supersedes BLUEPRINT.md v1.0 and serves as the canonical reference for all architectural, security, and deployment decisions." | line 4 + line 451 fix BLUEPRINT.md as the canonical reference; per Requirement 2.1 BLUEPRINT.md is the sole North_Star_Document | 🎯 (drift on canonicality — direct contradiction of Requirement 2.1) |
| EB-2 | **Target architecture** | § 2.1 (lines 66–99): single Next.js BFF monolith with route-grouped subsystems is the target topology | § 4.3 (lines 258–286) + § 4.1 (lines 205–236) mandate 15 microservices behind a service mesh; § 7 (lines 444–448) calls today's monolith the **starting point**, not the target | 🎯 |
| EB-3 | **Realtime engine** | § 2.1 + § 5.4 (lines 342–352): SSE + Next.js `/api/ws` route as transport | § 4.4 (lines 288–294): Elixir/OTP gateway, ≥ 2M concurrent WS / region, NATS option, Kafka per-workspace partitioning | 🎯 |
| EB-4 | **Messages store** | § 2.1 / Appendix B (lines 539–555): `messages` lives in PostgreSQL | § 4.5 (lines 296–307): ScyllaDB for messages (write-optimized, 1M+ ops/sec/node) | 🎯 |
| EB-5 | **Event backbone** | § 2.1 / § 5.4: Redis pub/sub only | § 4.1 + § 4.4 + § 4.5: Kafka / Redpanda as event backbone | 🎯 |
| EB-6 | **Search** | § 5.1 (line 326): "Search 4 GET" routes; § 8.4 lists Elasticsearch as a v0.1.0 P0 future item | § 4.5 + § 4.6 (lines 309–315): OpenSearch + dense vectors + LightGBM LTR + RRF as the search architecture (with Vespa as alternative) | 🎯 |
| EB-7 | **Workflow orchestration** | § 6.2 (line 387): `WORKFLOWS` flag (Workflow Builder automation) — no Temporal mention | § 4.5 (line 308): Temporal for durable workflows / retries / sagas | 🎯 |
| EB-8 | **Graph store** | absent — no graph store anywhere in the document | § 4.5 (line 305): Neo4j for permissions and entity graph | 🎯 |
| EB-9 | **Analytics store** | absent — no separate analytics store | § 4.5 (line 307): ClickHouse for real-time admin/usage dashboards | 🎯 |
| EB-10 | **AI/ML stack** | § 6.2 (line 374): `AI_SUMMARY` consumer flag (default ON); § 8.5: AI Assistant v1.0.0 P2 | § 4.7 (lines 317–322): vLLM/TGI + Bedrock/Vertex/Azure with tenant isolation, "no training on your data", continuous offline+online A/B with safety filter | 🎯 |
| EB-11 | **Cloud strategy** | § 3.1 (lines 153–169): Docker Desktop K8s + K3s; § 3.3 multi-region only listed at "Enterprise" phase with no provider | § 4.8 (lines 324–334): AWS primary, Azure & GCP for sovereignty regions, on-prem via OpenShift, Karpenter, Crossplane, ArgoCD | 🎯 |
| EB-12 | **Desktop client** | § 1.3 (line 56): Electron, no Tauri migration anywhere | § 4.2 (line 246): "Electron (current) → Tauri (target)" | 🎯 |
| EB-13 | **Compliance certifications** | § 4.5 (lines 282–288): SOC 2 (in progress), ISO 27001 (planned), GDPR (partial), HIPAA (planned), FedRAMP (planned) — **omits** ISO 27017, ISO 27018, FINRA 17a-4, SEC 17a-4 | § 5.5 (lines 392–406) + § 1.3 (line 33): SOC 2 Type II, ISO 27001 / 27017 / 27018, HIPAA, GDPR, FedRAMP path, FINRA 17a-4, SEC 17a-4 | 🎯 |
| EB-14 | **Cross-region latency target** | § 8.6 (line 519): only p95 ≤ 150 ms in-region listed | § 1.3 (line 28): p95 fan-out ≤ 150 ms in-region **and** ≤ 400 ms cross-region | 🎯 |
| EB-15 | **Data residency regions** | absent | § 5.5 (line 405): per-workspace pinning across US, EU, UK, CA, AU, JP, IN, AE, SG | 🎯 |
| EB-16 | **Authorization model** | § 4.2 (lines 237–256): role-hierarchy strings (super_admin, it_admin, employee, etc.) | § 4.3 (line 286) + § 5.5 (line 393): OAuth 2.1 + PKCE; mTLS + SPIFFE; OpenFGA (ReBAC) + ABAC overlays | 🎯 |
| EB-17 | **Roadmap framing** | § 8.2–8.5 (lines 464–508): version-themed roadmap (v0.0.8 → v0.1.0 → v1.0.0) with calendar-quarter targets | § 6.1 (lines 410–423): 76-week roadmap (M0–M8 → GA) with milestone exit criteria | 🎯 (framing drift, not target drift) |
| EB-18 | **Test coverage targets** | § 1.2 (line 36): 1,193 tests / 94 suites — no explicit threshold | § 5.2 (line 351): "≥ 80% on services; 70% UI" coverage targets | 🎯 |
| EB-19 | **Vulnerability SLA + bug bounty** | absent | § 5.5 (lines 405–407): Critical 24h, High 7d, Medium 30d, Low 90d; public bug bounty at GA | 🎯 |

### 2.2 `docs/NORTH-STAR-A.md` vs `docs/BLUEPRINT.md`

| # | Topic | Reference (`docs/NORTH-STAR-A.md`) says | `docs/BLUEPRINT.md` says | Severity (candidate) |
|---|---|---|---|---|
| NS-1 | **Document scope / canonicality** | line 1: titled "North Star — Native collaboration hub" — invites the file to be read as a north star | per Requirement 2.1 the sole North_Star_Document is `docs/BLUEPRINT.md`; NORTH-STAR-A.md is a Reference_Document only | 🎯 (canonicality / naming drift) |
| NS-2 | **Realtime transport** | lines 7–8: SSE on `/api/collab/events` with **polling** fallback to `/api/messages` | § 4.2 (line 245): "WebSocket + WebTransport fallback; SSE for low-priority streams" — WS is primary, SSE is the secondary path | 🎯 |
| NS-3 | **Information architecture** | line 3: "workspaces, channels, messages, tickets, and documents" — 5 primary entities | § 3.2 (lines 145–161): Workspace → Spaces → Channels → Messages/Threads/Canvases/Lists/Files/Huddles+Calls + DMs + Later inbox + Activity + Apps | 🎯 (omits Spaces, Canvases, Lists, Huddles/Calls, Later inbox, Activity, Apps, Bookmarks, DMs as a top-level entity) |
| NS-4 | **Storage stack** | line 3: "PostgreSQL (schema `aaelink`) and optional S3-compatible storage" | § 4.5 (lines 296–307): Postgres + Citus, ScyllaDB, OpenSearch + Vector, S3/MinIO, Neo4j, ClickHouse, Kafka, Temporal | 🎯 |
| NS-5 | **Open-registration toggle** | lines 11–12: `AAELINK_OPEN_REGISTRATION` env var documented as supported and authoritative | absent in BLUEPRINT.md; § 5.5 names auth stack (OAuth 2.1, OIDC, SAML 2.0, passkeys, MFA mandatory for admins) without an open-registration env switch | 🎯 (BLUEPRINT silent; Reference asserts policy mechanism) |

### 2.3 `docs/ROADMAP.yaml` vs `docs/BLUEPRINT.md`

| # | Topic | Reference (`docs/ROADMAP.yaml`) says | `docs/BLUEPRINT.md` says | Severity (candidate) |
|---|---|---|---|---|
| RM-1 | **Microservice extraction** | absent — zero items name extracting any of the 15 BLUEPRINT services | § 4.3 (lines 258–286): identity-svc, workspace-svc, messaging-svc, realtime-gw, search-svc, files-svc, calls-svc, notification-svc, workflow-svc, app-platform-svc, kb-svc, ai-svc, audit-svc, billing-svc, admin-svc | 🎯 |
| RM-2 | **Realtime engine migration** | `0.1.0-beta.redis-fanout-scale` (P0) replaces pg_notify with Redis pub/sub for SSE; no Elixir/OTP gateway item | § 4.4 (lines 288–294): Elixir/OTP gateway is the target | 🎯 |
| RM-3 | **Messages store migration** | absent — no item migrates messages off PostgreSQL | § 4.5 (line 299): ScyllaDB for messages | 🎯 |
| RM-4 | **Search migration** | `0.1.0-beta.elasticsearch` (P0): "Swap SQL full-text for Elasticsearch at scale" | § 4.5 (line 305) + § 4.6 (lines 309–315): OpenSearch + dense vectors + LightGBM LTR (Vespa as alternative) | 🎯 (Elasticsearch ≠ OpenSearch + vector + LTR) |
| RM-5 | **Event backbone** | absent — no Kafka / Redpanda item; only Redis | § 4.1 + § 4.4 + § 4.5: Kafka / Redpanda | 🎯 |
| RM-6 | **Workflow orchestration** | absent — no Temporal item | § 4.5 (line 308): Temporal | 🎯 |
| RM-7 | **Graph + analytics stores** | absent — no Neo4j item, no ClickHouse item | § 4.5 (lines 305–307): Neo4j, ClickHouse | 🎯 |
| RM-8 | **Desktop client migration** | absent — no Tauri item; current Electron unchanged through v1.0.0 | § 4.2 (line 246): Electron → Tauri | 🎯 |
| RM-9 | **Compliance certifications** | only `1.0.0.soc2` (P0) — omits ISO 27001 / 27017 / 27018, HIPAA, GDPR ratification, FedRAMP, FINRA 17a-4, SEC 17a-4 | § 5.5 (lines 402–404): SOC 2 + ISO 27001 / 27017 / 27018 + HIPAA + GDPR + FedRAMP path + FINRA / SEC 17a-4 | 🎯 |
| RM-10 | **Federation scope** | `mtls-federation` (v0.0.20-alpha P0) + `federation` (v1.0.0 P1, "cross-org message relay for shared channels") | § 5.5 (line 393) + § 1.2: federation is part of compliance posture (ethical walls, info barriers, DLP egress at boundary, multi-org from day one) | 🎯 (scope drift: relay-only vs full multi-org infra) |
| RM-11 | **Per-region scalability targets** | absent — no scale targets listed | § 5.4 (lines 380–390): 100k workspaces/region, 250k members/workspace, 50k WS/gateway pod, 5M WS/region, 250k messages/sec/region, 10 GB/s file upload throughput | 🎯 |
| RM-12 | **Roadmap framing** | per-version `themes` with `shipped_on` dates; current_version 0.0.58-alpha | § 6.1 (lines 410–423): 76-week roadmap with M0–M8 milestone exit criteria | 🎯 (framing drift; same target dates do not map onto the same plan structure) |
| RM-13 | **Vulnerability SLA + bug bounty** | absent | § 5.5 (lines 405–407): Critical 24h, High 7d, Medium 30d, Low 90d; public bug bounty at GA | 🎯 |
| RM-14 | **AI tenant isolation guarantee** | `1.0.0.ai-copilot` (P2): "Tenant-isolated, opt-in, disabled in regulated profiles" — single line, no "no training on your data" guarantee | § 4.7 (line 320): explicit "no training on your data" guarantee, logs scrubbed, opt-out per workspace | 🎯 (weakened guarantee) |

### 2.4 Cross-reference between Reference_Documents (informational only)

The audit only emits 🎯 against a Reference_Document for conflicts vs `docs/BLUEPRINT.md`. Disagreements between two Reference_Documents are recorded here for `aaelink-blueprint` to optionally surface as additional context, **not** as DRIFT findings (out of scope per Requirement 2.3 wording).

| # | Topic | `docs/ENTERPRISE-BLUEPRINT.md` says | `docs/ROADMAP.yaml` says | `docs/NORTH-STAR-A.md` says |
|---|---|---|---|---|
| X-1 | Current version | `v0.0.3-alpha — May 2026` (line 29) | `current_version: 0.0.58-alpha` / `last_updated: 2026-05-20` (lines 27–28) | unspecified |
| X-2 | Test count | 1,193 across 94 suites (line 36) | unspecified | unspecified |
| X-3 | Realtime fallback | `/api/ws` WebSocket route + 4 SSE streams (§ 5.4 lines 342–352) | `typing-presence-ws` (v0.0.43 P1) shifts typing+presence onto a WS gateway | SSE + polling fallback (lines 7–8) |

---

## 3. Implications block — candidate 🎯 `DRIFT-NNN` Findings for Phase B

Per Requirement 2.3, every conflict above maps to a candidate 🎯 `DRIFT-NNN` Finding **emitted against the Reference_Document, not against `docs/BLUEPRINT.md`**. The `aaelink-blueprint` skill in task 2.2 owns the final emit decision (which conflicts get filed, what severity, what evidence form). This block lists the recommended candidate set so Phase B does not re-derive it.

Numbering is sequential within prefix, restarting at `001` per the design.md determinism rule. The IDs below are *proposed* — Phase E task 7.6 (Critical_Finding re-verification) does not affect 🎯 numbering, but Phase D / triage may renumber if 🎯 Findings interleave with other DRIFT sources.

### 3.1 Against `docs/ENTERPRISE-BLUEPRINT.md`

| Candidate ID | Title (≤ 80 chars) | Source row | Suggested evidence form |
|---|---|---|---|
| DRIFT-001 | ENTERPRISE-BLUEPRINT supersession claim contradicts BLUEPRINT canonicality | EB-1 | `docQuote` of `docs/ENTERPRISE-BLUEPRINT.md` line 558 |
| DRIFT-002 | ENTERPRISE-BLUEPRINT pictures monolith as target architecture | EB-2 | `docQuote` of `docs/ENTERPRISE-BLUEPRINT.md` § 2.1 lines 66–99 |
| DRIFT-003 | ENTERPRISE-BLUEPRINT omits Elixir/OTP realtime gateway | EB-3 | `docQuote` of `docs/ENTERPRISE-BLUEPRINT.md` § 5.4 lines 342–352 |
| DRIFT-004 | ENTERPRISE-BLUEPRINT puts messages in Postgres, not ScyllaDB | EB-4 | `docQuote` of `docs/ENTERPRISE-BLUEPRINT.md` Appendix B lines 539–555 |
| DRIFT-005 | ENTERPRISE-BLUEPRINT lacks Kafka/Redpanda event backbone | EB-5 | `docQuote` of `docs/ENTERPRISE-BLUEPRINT.md` § 2.1 lines 66–99 |
| DRIFT-006 | ENTERPRISE-BLUEPRINT search omits OpenSearch + vector + LTR | EB-6 | `docQuote` of `docs/ENTERPRISE-BLUEPRINT.md` § 5.1 line 326 + § 8.4 line 494 |
| DRIFT-007 | ENTERPRISE-BLUEPRINT omits Temporal for durable workflows | EB-7 | `docQuote` of `docs/ENTERPRISE-BLUEPRINT.md` § 6.2 line 387 |
| DRIFT-008 | ENTERPRISE-BLUEPRINT omits Neo4j for permissions/entity graph | EB-8 | absence-of-mention (no `docQuote`; treat as `docQuote` against BLUEPRINT.md § 4.5 line 305 with note "Reference silent") |
| DRIFT-009 | ENTERPRISE-BLUEPRINT omits ClickHouse for analytics | EB-9 | absence-of-mention (same form as DRIFT-008) |
| DRIFT-010 | ENTERPRISE-BLUEPRINT AI/ML maturity weaker than BLUEPRINT | EB-10 | `docQuote` of `docs/ENTERPRISE-BLUEPRINT.md` § 6.2 line 374 + § 8.5 line 507 |
| DRIFT-011 | ENTERPRISE-BLUEPRINT cloud strategy narrower than BLUEPRINT | EB-11 | `docQuote` of `docs/ENTERPRISE-BLUEPRINT.md` § 3.1 lines 153–169 + § 3.3 lines 190–198 |
| DRIFT-012 | ENTERPRISE-BLUEPRINT lacks Tauri migration | EB-12 | `docQuote` of `docs/ENTERPRISE-BLUEPRINT.md` § 1.3 line 56 |
| DRIFT-013 | ENTERPRISE-BLUEPRINT compliance set drops ISO 27017/27018 + FINRA + SEC 17a-4 | EB-13 | `docQuote` of `docs/ENTERPRISE-BLUEPRINT.md` § 4.5 lines 282–288 |
| DRIFT-014 | ENTERPRISE-BLUEPRINT omits cross-region p95 ≤ 400 ms target | EB-14 | `docQuote` of `docs/ENTERPRISE-BLUEPRINT.md` § 8.6 line 519 |
| DRIFT-015 | ENTERPRISE-BLUEPRINT lacks data-residency region list | EB-15 | absence-of-mention |
| DRIFT-016 | ENTERPRISE-BLUEPRINT authorization model omits OpenFGA / SPIFFE / mTLS | EB-16 | `docQuote` of `docs/ENTERPRISE-BLUEPRINT.md` § 4.2 lines 237–256 |
| DRIFT-017 | ENTERPRISE-BLUEPRINT roadmap framing diverges from BLUEPRINT 76-week M0–M8 | EB-17 | `docQuote` of `docs/ENTERPRISE-BLUEPRINT.md` § 8.2–8.5 lines 464–508 |
| DRIFT-018 | ENTERPRISE-BLUEPRINT lacks coverage thresholds | EB-18 | `docQuote` of `docs/ENTERPRISE-BLUEPRINT.md` § 1.2 line 36 |
| DRIFT-019 | ENTERPRISE-BLUEPRINT lacks vulnerability SLA + bug bounty commitment | EB-19 | absence-of-mention |

### 3.2 Against `docs/NORTH-STAR-A.md`

| Candidate ID | Title (≤ 80 chars) | Source row | Suggested evidence form |
|---|---|---|---|
| DRIFT-020 | NORTH-STAR-A title invites confusion with sole North_Star_Document | NS-1 | `docQuote` of `docs/NORTH-STAR-A.md` line 1 |
| DRIFT-021 | NORTH-STAR-A makes SSE primary; BLUEPRINT makes WebSocket primary | NS-2 | `docQuote` of `docs/NORTH-STAR-A.md` lines 7–8 |
| DRIFT-022 | NORTH-STAR-A IA collapses to 5 entities; BLUEPRINT is richer | NS-3 | `docQuote` of `docs/NORTH-STAR-A.md` line 3 |
| DRIFT-023 | NORTH-STAR-A storage stack omits Citus / Scylla / OpenSearch / Neo4j / ClickHouse / Kafka / Temporal | NS-4 | `docQuote` of `docs/NORTH-STAR-A.md` line 3 |
| DRIFT-024 | NORTH-STAR-A documents AAELINK_OPEN_REGISTRATION not in BLUEPRINT auth stack | NS-5 | `docQuote` of `docs/NORTH-STAR-A.md` lines 11–12 |

### 3.3 Against `docs/ROADMAP.yaml`

| Candidate ID | Title (≤ 80 chars) | Source row | Suggested evidence form |
|---|---|---|---|
| DRIFT-025 | ROADMAP omits 15-microservice extraction roadmap | RM-1 | absence-of-mention vs `docs/ROADMAP.yaml` lines 30–280 |
| DRIFT-026 | ROADMAP realtime path stops at Redis pub/sub; BLUEPRINT mandates Elixir/OTP gateway | RM-2 | `docQuote` of `docs/ROADMAP.yaml` lines 240–244 |
| DRIFT-027 | ROADMAP lacks ScyllaDB messages-store migration | RM-3 | absence-of-mention |
| DRIFT-028 | ROADMAP search target is Elasticsearch alone, not OpenSearch + vector + LTR | RM-4 | `docQuote` of `docs/ROADMAP.yaml` lines 245–249 |
| DRIFT-029 | ROADMAP lacks Kafka/Redpanda event-backbone migration | RM-5 | absence-of-mention |
| DRIFT-030 | ROADMAP lacks Temporal workflow orchestration migration | RM-6 | absence-of-mention |
| DRIFT-031 | ROADMAP lacks Neo4j + ClickHouse migrations | RM-7 | absence-of-mention |
| DRIFT-032 | ROADMAP lacks Electron → Tauri migration | RM-8 | absence-of-mention |
| DRIFT-033 | ROADMAP compliance set drops ISO 27001/27017/27018, HIPAA, GDPR, FedRAMP, FINRA/SEC 17a-4 | RM-9 | `docQuote` of `docs/ROADMAP.yaml` line 271 (`soc2`) |
| DRIFT-034 | ROADMAP federation scope reduced to message relay; BLUEPRINT requires full multi-org compliance | RM-10 | `docQuote` of `docs/ROADMAP.yaml` lines 209–212 + 274–278 |
| DRIFT-035 | ROADMAP omits per-region scalability targets | RM-11 | absence-of-mention |
| DRIFT-036 | ROADMAP framing per-version diverges from BLUEPRINT 76-week M0–M8 plan | RM-12 | `docQuote` of `docs/ROADMAP.yaml` lines 30–280 |
| DRIFT-037 | ROADMAP lacks vulnerability SLA + bug bounty commitments | RM-13 | absence-of-mention |
| DRIFT-038 | ROADMAP AI tenant isolation guarantee weaker than BLUEPRINT "no training on your data" | RM-14 | `docQuote` of `docs/ROADMAP.yaml` line 280 |

### 3.4 Suggested triage hint for Phase B

The 38 candidate 🎯 Findings above are **not yet** Findings. Phase B (`aaelink-blueprint` skill, task 2.2) makes three decisions per candidate:

1. **Emit or merge** — Several rows (e.g. EB-13, NS-4, RM-9) overlap on the same underlying drift (compliance certifications). The skill may merge overlapping candidates into one DRIFT Finding citing multiple Reference_Documents.
2. **Severity rationale** — DRIFT severity is fixed (🎯 Goal Drift Flag) but the rationale text varies per row; the table above supplies the disagreement, not the rationale.
3. **Evidence form selection** — Most rows are best filed with `docQuote` evidence; `absence-of-mention` rows are filed as `docQuote` against the BLUEPRINT.md anchor with a Reference-silent note, since `EvidenceCitation` requires exactly one of `pathLineRange | commandOutput | docQuote`.

### 3.5 Notes for downstream tasks

- **Task 2.2 (`aaelink-blueprint`)** — Consume this implications block. Decide which candidates emit, merge, or drop. Renumber if interleaving with `_scratch/blueprint-goals.md` "Implications flagged for Phase B" 🎯 / 🟡 candidates (the empty-extraction observation).
- **Task 7.3 (`Verification_Protocol` goal cross-check)** — `BlueprintGoal[]` is empty (per `_scratch/blueprint-goals.md`); per-goal coverage assertion is vacuously satisfied. The Final_Verification_Summary `Goal coverage cross-check` block must record "0 Blueprint_Goals extracted under the design.md regex; 38 candidate DRIFT-NNN tracked from `_scratch/reference-documents.md`."
- **Property 6 (Reference_Document conflicts emit a 🎯 against the Reference_Document)** — Property test asserts every 🎯 DRIFT-NNN with a Reference_Document `docQuote.docPath` cites one of `docs/ENTERPRISE-BLUEPRINT.md | docs/NORTH-STAR-A.md | docs/ROADMAP.yaml`, **not** `docs/BLUEPRINT.md`. The 38 candidates above all conform.
- **Reference_Documents read-only** — None of the three files were modified. Per Requirement 2.3 they cannot override the North_Star_Document; per task spec they are read-only inputs.

---

_Scratch artifact — internal to the comprehensive-project-audit run on 2026-05-25._
