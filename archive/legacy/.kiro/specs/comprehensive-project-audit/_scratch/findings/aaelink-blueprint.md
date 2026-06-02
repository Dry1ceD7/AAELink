# Phase B step 1 — `aaelink-blueprint` Findings

**Audit run:** comprehensive-project-audit
**Run date (UTC):** 2026-05-25
**Skill:** `aaelink-blueprint` (chain step 1 of 8)
**Skill source:** `.claude/skills/aaelink-blueprint/SKILL.md`
**Inputs consumed:**
- `_scratch/stack-context.md` — immutable `StackContext`
- `_scratch/blueprint-goals.md` — empty `BlueprintGoal[]` under design.md regex
- `_scratch/reference-documents.md` — 38 candidate DRIFT-001..DRIFT-038
**Format:** YAML (one document per finding, `---` separated, schema per `design.md` § "Finding object")
**Status:** scratch — internal Phase B output for tasks 6.x triage, 7.x verification, 10.x emit
**Do not** treat this file as a deliverable. Phase H (task 10.x) is the only disk-emit phase for `docs/audit-*.md`.

## Methodology

1. Read scratch inputs above.
2. Apply task-2.2 decisions:
   - Decision 1: empty `BlueprintGoal[]` produces BOTH a 🎯 `DRIFT-NNN` (no machine-extractable goal anchors in `docs/BLUEPRINT.md`) AND a 🟡 `UPG-NNN` (recommend BLUEPRINT expose `Goal:`/`Requirement:`/`Objective:`/`Capability:` headings or `MUST`/`SHALL`/`Provide`/`Support` bullets).
   - Decision 2: 38 Reference_Document candidates from `_scratch/reference-documents.md` are emitted, merged where they describe the same underlying drift (e.g. EB-13 + RM-9 → one compliance-certifications finding citing both Reference_Documents).
   - Decision 3: numbering per prefix restarts at `001` ascending.
3. Apply Phase G stack-context guardrails (G1–G5) to every recommendation before emit:
   - G1 (`getPool()` outside `lib/db.ts`): not applicable — no DB-query recommendation.
   - G2 (`lib/migrate.ts` for schema): not applicable — no schema-change recommendation.
   - G3 (four-gates citation for release-readiness claims): not applicable — no `shipped`/`done`/`complete`/`release-ready` claim.
   - G4 (`desktop/` Electron client scope): applied to DRIFT-011 (Tauri migration).
   - G5 (`app/api/.../route.ts` path for API-route recommendations): applied to DRIFT-022 / DRIFT-025 where realtime / registration routes are cited.
4. Every emitted Finding carries `pillar`, `evidence` (one of `pathLineRange | commandOutput | docQuote`), `severityRationale`, `recommendation`, `sourceSkills: ["aaelink-blueprint"]`. Per Property 6, every 🎯 DRIFT-NNN cites a Reference_Document, never `docs/BLUEPRINT.md`, in `evidence.docQuote.docPath`.

## Merge map (38 candidates → 26 DRIFT + 1 UPG = 27 findings)

| Merged finding | Source candidates | Notes |
|---|---|---|
| DRIFT-001 | EB-1 | ENTERPRISE-BLUEPRINT supersession claim — standalone |
| DRIFT-002 | EB-2 + RM-1 | Target architecture: monolith vs 15 microservices |
| DRIFT-003 | EB-3 + RM-2 | Realtime engine: Elixir/OTP gateway missing |
| DRIFT-004 | EB-4 + RM-3 | Messages store: Postgres vs ScyllaDB |
| DRIFT-005 | EB-5 + RM-5 | Event backbone: Redis only vs Kafka/Redpanda |
| DRIFT-006 | EB-6 + RM-4 | Search: SQL / Elasticsearch vs OpenSearch + vector + LTR |
| DRIFT-007 | EB-7 + RM-6 | Workflow orchestration: missing Temporal |
| DRIFT-008 | EB-8 + EB-9 + RM-7 | Specialty data stores: Neo4j + ClickHouse |
| DRIFT-009 | EB-10 + RM-14 | AI/ML maturity + tenant isolation guarantees |
| DRIFT-010 | EB-11 | Cloud strategy narrower than BLUEPRINT — standalone |
| DRIFT-011 | EB-12 + RM-8 | Desktop client: Tauri migration missing |
| DRIFT-012 | EB-13 + RM-9 | Compliance certifications: ISO 27017/27018 + FINRA + SEC 17a-4 |
| DRIFT-013 | EB-14 | Cross-region p95 ≤ 400 ms target missing — standalone |
| DRIFT-014 | EB-15 | Data-residency region list missing — standalone |
| DRIFT-015 | EB-16 | Authorization: OpenFGA / SPIFFE / mTLS missing — standalone |
| DRIFT-016 | EB-17 + RM-12 | Roadmap framing: themes vs 76-week M0–M8 |
| DRIFT-017 | EB-18 | Test coverage thresholds missing — standalone |
| DRIFT-018 | EB-19 + RM-13 | Vulnerability SLA + bug bounty missing |
| DRIFT-019 | RM-11 | Per-region scalability targets missing — standalone |
| DRIFT-020 | RM-10 | Federation scope reduced to message relay — standalone |
| DRIFT-021 | NS-1 | NORTH-STAR-A title invites confusion with sole north star |
| DRIFT-022 | NS-2 | NORTH-STAR-A makes SSE primary vs BLUEPRINT WebSocket primary |
| DRIFT-023 | NS-3 | NORTH-STAR-A IA collapses to 5 entities |
| DRIFT-024 | NS-4 | NORTH-STAR-A storage stack omits Citus / Scylla / OpenSearch / Neo4j / ClickHouse / Kafka / Temporal |
| DRIFT-025 | NS-5 | NORTH-STAR-A documents `AAELINK_OPEN_REGISTRATION` not in BLUEPRINT auth stack |
| DRIFT-026 | (Phase A observation) | BLUEPRINT carries no machine-extractable `Goal`/`Requirement`/`Objective`/`Capability` anchors; `BlueprintGoal[]` empty under design.md regex |
| UPG-001 | (Phase A observation) | Recommend BLUEPRINT expose machine-extractable goal anchors so subsequent audits get a non-empty `BlueprintGoal[]` |

## Findings (YAML, design.md schema)

```yaml
---
id: DRIFT-001
title: ENTERPRISE-BLUEPRINT supersession claim contradicts BLUEPRINT canonicality
pillar: "🎯 Goal Drift Flags"
evidence:
  docQuote:
    docPath: docs/ENTERPRISE-BLUEPRINT.md
    headingOrAnchor: "End of Enterprise Blueprint v2.0 (footer line 558)"
    quote: "This document supersedes BLUEPRINT.md v1.0 and serves as the canonical reference for all architectural, security, and deployment decisions."
severityRationale: |
  Per Requirement 2.1, `docs/BLUEPRINT.md` is the sole North_Star_Document for the audit; per
  Requirement 2.2, `docs/ENTERPRISE-BLUEPRINT.md` is a Reference_Document only. The footer
  claim that ENTERPRISE-BLUEPRINT supersedes BLUEPRINT inverts the canonicality contract that
  governs every 🎯 Goal Drift Flag in this audit. Filed against the Reference_Document, not
  BLUEPRINT, per Requirement 2.3.
recommendation: |
  Edit the footer of `docs/ENTERPRISE-BLUEPRINT.md` to remove the supersession claim and
  replace it with a Reference_Document framing (e.g. "Companion to `docs/BLUEPRINT.md`;
  BLUEPRINT remains the canonical north star"). This is a documentation-only change; no
  code paths are affected.
sourceSkills: ["aaelink-blueprint"]
---
id: DRIFT-002
title: ENTERPRISE-BLUEPRINT and ROADMAP target a monolith; BLUEPRINT mandates 15 microservices
pillar: "🎯 Goal Drift Flags"
evidence:
  docQuote:
    docPath: docs/ENTERPRISE-BLUEPRINT.md
    headingOrAnchor: "§ 2.1 System Topology"
    quote: "Single Next.js BFF monolith with route-grouped subsystems is the target topology (lines 66-99)."
severityRationale: |
  BLUEPRINT § 4.3 (lines 258-286) and § 4.1 (lines 205-236) name 15 microservices behind a
  service mesh as the target architecture; BLUEPRINT § 7 (lines 444-448) calls today's
  monolith the starting point, not the target. ENTERPRISE-BLUEPRINT § 2.1 frames the
  monolith as the target, and `docs/ROADMAP.yaml` (lines 30-280) carries zero items naming
  extraction of any of the 15 BLUEPRINT services. Both Reference_Documents drift from the
  North_Star_Document on the same axis. Cross-cite `docs/ROADMAP.yaml` in the recommendation.
recommendation: |
  Add a "Microservice extraction" theme spanning post-GA versions in `docs/ROADMAP.yaml`
  (one item per BLUEPRINT § 4.3 service: identity-svc, workspace-svc, messaging-svc,
  realtime-gw, search-svc, files-svc, calls-svc, notification-svc, workflow-svc,
  app-platform-svc, kb-svc, ai-svc, audit-svc, billing-svc, admin-svc) and amend
  `docs/ENTERPRISE-BLUEPRINT.md` § 2.1 to label the monolith as the v0.0.x starting point,
  not the GA target.
sourceSkills: ["aaelink-blueprint"]
---
id: DRIFT-003
title: Reference_Documents omit Elixir/OTP realtime gateway target
pillar: "🎯 Goal Drift Flags"
evidence:
  docQuote:
    docPath: docs/ENTERPRISE-BLUEPRINT.md
    headingOrAnchor: "§ 5.4 Realtime Transport"
    quote: "SSE + Next.js `/api/ws` route as transport (lines 342-352)."
severityRationale: |
  BLUEPRINT § 4.4 (lines 288-294) names an Elixir/OTP gateway with ≥ 2M concurrent
  WebSocket connections per region, NATS as an option, and Kafka per-workspace partitioning
  as the target. ENTERPRISE-BLUEPRINT § 5.4 stops at SSE + a Next.js `/api/ws` route, and
  `docs/ROADMAP.yaml` (`0.1.0-beta.redis-fanout-scale` P0) only swaps `pg_notify` for Redis
  pub/sub for SSE — neither Reference_Document plans the gateway extraction.
recommendation: |
  Add a "Realtime gateway extraction" theme to `docs/ROADMAP.yaml` (Elixir/OTP gateway,
  NATS option, Kafka per-workspace partitioning) and amend `docs/ENTERPRISE-BLUEPRINT.md`
  § 5.4 to label `/api/ws` as the v0.0.x bridge, not the GA realtime engine.
sourceSkills: ["aaelink-blueprint"]
---
id: DRIFT-004
title: Reference_Documents keep messages in Postgres; BLUEPRINT mandates ScyllaDB
pillar: "🎯 Goal Drift Flags"
evidence:
  docQuote:
    docPath: docs/ENTERPRISE-BLUEPRINT.md
    headingOrAnchor: "Appendix B — Database Schema (Key Tables)"
    quote: "`messages` lives in PostgreSQL (lines 539-555)."
severityRationale: |
  BLUEPRINT § 4.5 (lines 296-307) names ScyllaDB as the messages store (write-optimized,
  1M+ ops/sec/node). ENTERPRISE-BLUEPRINT Appendix B keeps `messages` in Postgres, and
  `docs/ROADMAP.yaml` carries no migration item to move messages off Postgres.
recommendation: |
  Add a "Messages-store migration to ScyllaDB" theme to `docs/ROADMAP.yaml` (post-GA) and
  amend `docs/ENTERPRISE-BLUEPRINT.md` Appendix B to label the Postgres `messages` table as
  the v0.0.x starting point with a forward link to BLUEPRINT § 4.5.
sourceSkills: ["aaelink-blueprint"]
---
id: DRIFT-005
title: Reference_Documents stop at Redis pub/sub; BLUEPRINT requires Kafka/Redpanda backbone
pillar: "🎯 Goal Drift Flags"
evidence:
  docQuote:
    docPath: docs/ENTERPRISE-BLUEPRINT.md
    headingOrAnchor: "§ 2.1 System Topology"
    quote: "Redis pub/sub only as the event backbone (lines 66-99)."
severityRationale: |
  BLUEPRINT § 4.1, § 4.4, and § 4.5 name Kafka / Redpanda as the event backbone for
  fanout, audit streaming, and per-workspace partitioning. ENTERPRISE-BLUEPRINT § 2.1
  picks Redis pub/sub only; `docs/ROADMAP.yaml` carries no Kafka / Redpanda item across
  the 40 enumerated roadmap entries.
recommendation: |
  Add a "Kafka/Redpanda event-backbone" theme to `docs/ROADMAP.yaml` (post-GA) and amend
  `docs/ENTERPRISE-BLUEPRINT.md` § 2.1 to mark Redis pub/sub as the v0.0.x starting point.
sourceSkills: ["aaelink-blueprint"]
---
id: DRIFT-006
title: Reference_Documents pick Elasticsearch alone; BLUEPRINT requires OpenSearch + vector + LTR
pillar: "🎯 Goal Drift Flags"
evidence:
  docQuote:
    docPath: docs/ROADMAP.yaml
    headingOrAnchor: "0.1.0-beta.elasticsearch (P0)"
    quote: "Swap SQL full-text for Elasticsearch at scale."
severityRationale: |
  BLUEPRINT § 4.5 (line 305) and § 4.6 (lines 309-315) name OpenSearch + dense vectors +
  LightGBM Learning-to-Rank with Reciprocal-Rank-Fusion (Vespa as alternative). ROADMAP's
  `0.1.0-beta.elasticsearch` swaps to Elasticsearch alone; ENTERPRISE-BLUEPRINT § 5.1
  (line 326) and § 8.4 (line 494) reproduce the same Elasticsearch-only target. Neither
  Reference_Document plans the vector index, the LTR layer, or RRF fusion.
recommendation: |
  Replace `docs/ROADMAP.yaml`'s `0.1.0-beta.elasticsearch` item with an OpenSearch +
  vector + LTR + RRF item (or an equivalent Vespa item) and amend ENTERPRISE-BLUEPRINT
  § 5.1 / § 8.4 to align.
sourceSkills: ["aaelink-blueprint"]
---
id: DRIFT-007
title: Reference_Documents omit Temporal for durable workflows
pillar: "🎯 Goal Drift Flags"
evidence:
  docQuote:
    docPath: docs/ENTERPRISE-BLUEPRINT.md
    headingOrAnchor: "§ 6.2 Complete Flag Registry"
    quote: "`WORKFLOWS` flag (Workflow Builder automation) — line 387, no Temporal mention."
severityRationale: |
  BLUEPRINT § 4.5 (line 308) names Temporal for durable workflows, retries, and sagas.
  ENTERPRISE-BLUEPRINT § 6.2 lists only a `WORKFLOWS` feature flag with no orchestration
  engine; `docs/ROADMAP.yaml` carries no Temporal migration item.
recommendation: |
  Add a "Temporal workflow orchestration" theme to `docs/ROADMAP.yaml` (post-GA) and
  amend ENTERPRISE-BLUEPRINT § 6.2 to mention Temporal as the durable-execution target
  for the `WORKFLOWS` flag.
sourceSkills: ["aaelink-blueprint"]
---
id: DRIFT-008
title: Reference_Documents omit Neo4j (permissions/entity graph) and ClickHouse (analytics)
pillar: "🎯 Goal Drift Flags"
evidence:
  docQuote:
    docPath: docs/ENTERPRISE-BLUEPRINT.md
    headingOrAnchor: "§ 4.4 Encryption / § 4.6 Enterprise Compliance Features"
    quote: "No graph store and no separate analytics store mentioned anywhere in lines 224-303."
severityRationale: |
  BLUEPRINT § 4.5 names Neo4j (line 305) for permissions and entity graph and ClickHouse
  (line 307) for real-time admin/usage dashboards. ENTERPRISE-BLUEPRINT names neither and
  `docs/ROADMAP.yaml` carries no migration items for either; both Reference_Documents
  omit the same two specialty stores.
recommendation: |
  Add "Neo4j permissions/entity graph" and "ClickHouse analytics store" themes to
  `docs/ROADMAP.yaml` (post-GA) and amend ENTERPRISE-BLUEPRINT § 2.4 / Appendix B to
  reference both stores.
sourceSkills: ["aaelink-blueprint"]
---
id: DRIFT-009
title: Reference_Documents weaken AI tenant isolation guarantees vs BLUEPRINT
pillar: "🎯 Goal Drift Flags"
evidence:
  docQuote:
    docPath: docs/ENTERPRISE-BLUEPRINT.md
    headingOrAnchor: "§ 6.2 Complete Flag Registry"
    quote: "`AI_SUMMARY` consumer flag (default ON) — line 374; § 8.5 line 507 lists 'AI Assistant' v1.0.0 P2 only."
severityRationale: |
  BLUEPRINT § 4.7 (lines 317-322) names vLLM/TGI plus Bedrock/Vertex/Azure with explicit
  tenant isolation, the "no training on your data" guarantee, log scrubbing, and per-
  workspace opt-out, plus continuous offline + online A/B with safety filter.
  ENTERPRISE-BLUEPRINT lists only an `AI_SUMMARY` flag with no isolation language;
  `docs/ROADMAP.yaml` (`1.0.0.ai-copilot` P2) reduces the guarantee to one line ("Tenant-
  isolated, opt-in, disabled in regulated profiles") with no "no training on your data"
  pledge.
recommendation: |
  Amend ENTERPRISE-BLUEPRINT § 6.2 / § 8.5 and `docs/ROADMAP.yaml` `1.0.0.ai-copilot` to
  include the verbatim BLUEPRINT § 4.7 isolation language: tenant isolation, "no training
  on your data", log scrubbing, per-workspace opt-out, continuous offline + online A/B
  with safety filter.
sourceSkills: ["aaelink-blueprint"]
---
id: DRIFT-010
title: ENTERPRISE-BLUEPRINT cloud strategy narrower than BLUEPRINT multi-cloud target
pillar: "🎯 Goal Drift Flags"
evidence:
  docQuote:
    docPath: docs/ENTERPRISE-BLUEPRINT.md
    headingOrAnchor: "§ 3.1 Current Deployment Topology + § 3.3 Scaling Strategy"
    quote: "Docker Desktop K8s + K3s (lines 153-169); multi-region listed only at 'Enterprise' phase with no provider (lines 190-198)."
severityRationale: |
  BLUEPRINT § 4.8 (lines 324-334) names AWS as primary, Azure and GCP for sovereignty
  regions, on-prem via OpenShift, plus Karpenter / Crossplane / ArgoCD as the deployment
  primitives. ENTERPRISE-BLUEPRINT picks Docker Desktop K8s + K3s for current and is
  silent on cloud providers for the multi-region phase.
recommendation: |
  Amend `docs/ENTERPRISE-BLUEPRINT.md` § 3.3 to name AWS / Azure / GCP / on-prem
  OpenShift as the multi-cloud targets and to cite Karpenter, Crossplane, and ArgoCD
  as the deployment-time primitives.
sourceSkills: ["aaelink-blueprint"]
---
id: DRIFT-011
title: Reference_Documents omit Electron-to-Tauri migration for desktop client
pillar: "🎯 Goal Drift Flags"
evidence:
  docQuote:
    docPath: docs/ENTERPRISE-BLUEPRINT.md
    headingOrAnchor: "§ 1.3 Technology Stack"
    quote: "Electron (line 56) — no Tauri migration anywhere in the document."
severityRationale: |
  BLUEPRINT § 4.2 (line 246) frames the desktop client as "Electron (current) → Tauri
  (target)". ENTERPRISE-BLUEPRINT § 1.3 lists Electron only, and `docs/ROADMAP.yaml`
  carries no Tauri item across 40 roadmap entries. Both Reference_Documents drift on the
  desktop migration plan and the change scopes to the `desktop/` Electron client tree.
recommendation: |
  Add a "desktop/ Tauri migration" theme to `docs/ROADMAP.yaml` (post-GA), scoped to the
  `desktop/` Electron client (today an `aaelink-desktop` package targeting `dist:mac` and
  `dist:win`), and amend ENTERPRISE-BLUEPRINT § 1.3 to mark Electron as the v0.0.x
  starting point.
sourceSkills: ["aaelink-blueprint"]
---
id: DRIFT-012
title: Reference_Documents drop ISO 27017/27018 + FINRA + SEC 17a-4 from compliance set
pillar: "🎯 Goal Drift Flags"
evidence:
  docQuote:
    docPath: docs/ENTERPRISE-BLUEPRINT.md
    headingOrAnchor: "§ 4.5 Compliance Readiness"
    quote: "SOC 2 (in progress), ISO 27001 (planned), GDPR (partial), HIPAA (planned), FedRAMP (planned) — lines 282-288."
severityRationale: |
  BLUEPRINT § 5.5 (lines 392-406) and § 1.3 (line 33) commit to SOC 2 Type II,
  ISO 27001 / 27017 / 27018, HIPAA, GDPR, FedRAMP path, FINRA 17a-4, and SEC 17a-4.
  ENTERPRISE-BLUEPRINT § 4.5 omits ISO 27017, ISO 27018, FINRA 17a-4, and SEC 17a-4;
  `docs/ROADMAP.yaml` carries only `1.0.0.soc2` (P0) and omits the other certifications.
recommendation: |
  Amend ENTERPRISE-BLUEPRINT § 4.5 to add ISO 27017, ISO 27018, FINRA 17a-4, and
  SEC 17a-4 to the compliance set, and add corresponding items to `docs/ROADMAP.yaml`
  (one per certification, post-GA, depending on `1.0.0.soc2`).
sourceSkills: ["aaelink-blueprint"]
---
id: DRIFT-013
title: ENTERPRISE-BLUEPRINT omits cross-region p95 ≤ 400 ms target
pillar: "🎯 Goal Drift Flags"
evidence:
  docQuote:
    docPath: docs/ENTERPRISE-BLUEPRINT.md
    headingOrAnchor: "§ 8.6 Success Metrics (12 months post-GA)"
    quote: "Only p95 ≤ 150 ms in-region listed (line 519)."
severityRationale: |
  BLUEPRINT § 1.3 (line 28) commits to p95 fan-out ≤ 150 ms in-region AND ≤ 400 ms
  cross-region. ENTERPRISE-BLUEPRINT § 8.6 reproduces only the in-region target.
recommendation: |
  Amend `docs/ENTERPRISE-BLUEPRINT.md` § 8.6 to add the cross-region p95 ≤ 400 ms target
  alongside the in-region target.
sourceSkills: ["aaelink-blueprint"]
---
id: DRIFT-014
title: ENTERPRISE-BLUEPRINT omits data-residency region list
pillar: "🎯 Goal Drift Flags"
evidence:
  docQuote:
    docPath: docs/ENTERPRISE-BLUEPRINT.md
    headingOrAnchor: "§ 4.5 Compliance Readiness / § 4.6 Enterprise Compliance Features"
    quote: "No data-residency region list across lines 279-303."
severityRationale: |
  BLUEPRINT § 5.5 (line 405) commits to per-workspace pinning across US, EU, UK, CA, AU,
  JP, IN, AE, and SG. ENTERPRISE-BLUEPRINT § 4.5 / § 4.6 are silent on the regions list.
recommendation: |
  Amend `docs/ENTERPRISE-BLUEPRINT.md` § 4.5 to add the per-workspace residency region
  list (US, EU, UK, CA, AU, JP, IN, AE, SG) verbatim from BLUEPRINT § 5.5.
sourceSkills: ["aaelink-blueprint"]
---
id: DRIFT-015
title: ENTERPRISE-BLUEPRINT authorization model omits OpenFGA / SPIFFE / mTLS targets
pillar: "🎯 Goal Drift Flags"
evidence:
  docQuote:
    docPath: docs/ENTERPRISE-BLUEPRINT.md
    headingOrAnchor: "§ 4.2 Authorization Model"
    quote: "Role-hierarchy strings: super_admin, it_admin, employee, etc. (lines 237-256)."
severityRationale: |
  BLUEPRINT § 4.3 (line 286) and § 5.5 (line 393) name OAuth 2.1 + PKCE, mTLS + SPIFFE
  service identities, OpenFGA (ReBAC) plus ABAC overlays as the target authorization
  stack. ENTERPRISE-BLUEPRINT § 4.2 lists only role-hierarchy strings.
recommendation: |
  Amend `docs/ENTERPRISE-BLUEPRINT.md` § 4.2 to add OpenFGA (ReBAC), ABAC overlays,
  mTLS + SPIFFE, and OAuth 2.1 + PKCE as the target stack with role-hierarchy strings
  labelled as the v0.0.x starting point.
sourceSkills: ["aaelink-blueprint"]
---
id: DRIFT-016
title: Reference_Documents adopt theme/version framing; BLUEPRINT mandates 76-week M0–M8 plan
pillar: "🎯 Goal Drift Flags"
evidence:
  docQuote:
    docPath: docs/ENTERPRISE-BLUEPRINT.md
    headingOrAnchor: "§ 8.2-8.5 Roadmap: Alpha → GA"
    quote: "Version-themed roadmap (v0.0.8 → v0.1.0 → v1.0.0) with calendar-quarter targets (lines 464-508)."
severityRationale: |
  BLUEPRINT § 6.1 (lines 410-423) frames the roadmap as a 76-week plan with M0–M8
  milestone exit criteria. ENTERPRISE-BLUEPRINT § 8.2-8.5 and `docs/ROADMAP.yaml`
  (lines 30-280) both adopt a per-version-theme framing that does not map onto the
  M0–M8 milestone structure. Framing drift, not target drift.
recommendation: |
  Add a `milestone:` field to every `docs/ROADMAP.yaml` item (one of M0..M8 per
  BLUEPRINT § 6.1) and add an "M0..M8 milestone exit criteria" subsection to
  ENTERPRISE-BLUEPRINT § 8 cross-referencing BLUEPRINT § 6.1.
sourceSkills: ["aaelink-blueprint"]
---
id: DRIFT-017
title: ENTERPRISE-BLUEPRINT lacks explicit test-coverage thresholds
pillar: "🎯 Goal Drift Flags"
evidence:
  docQuote:
    docPath: docs/ENTERPRISE-BLUEPRINT.md
    headingOrAnchor: "§ 1.2 Current State"
    quote: "1,193 tests / 94 suites — no explicit threshold (line 36)."
severityRationale: |
  BLUEPRINT § 5.2 (line 351) commits to "≥ 80% on services; 70% UI" coverage targets.
  ENTERPRISE-BLUEPRINT § 1.2 reports a count without a threshold.
recommendation: |
  Amend `docs/ENTERPRISE-BLUEPRINT.md` § 1.2 (or Appendix A) to add the BLUEPRINT § 5.2
  thresholds as the contract that governs the count.
sourceSkills: ["aaelink-blueprint"]
---
id: DRIFT-018
title: Reference_Documents omit vulnerability SLA + bug-bounty commitments
pillar: "🎯 Goal Drift Flags"
evidence:
  docQuote:
    docPath: docs/ENTERPRISE-BLUEPRINT.md
    headingOrAnchor: "§ 4 Security & Compliance"
    quote: "No vulnerability SLA or bug-bounty commitment across lines 224-303."
severityRationale: |
  BLUEPRINT § 5.5 (lines 405-407) commits to a vulnerability SLA (Critical 24h, High 7d,
  Medium 30d, Low 90d) and a public bug bounty at GA. ENTERPRISE-BLUEPRINT § 4 and
  `docs/ROADMAP.yaml` carry neither.
recommendation: |
  Amend ENTERPRISE-BLUEPRINT § 4.5 to add the BLUEPRINT vulnerability-SLA tiers verbatim
  and add a "Bug bounty (public, GA)" item to `docs/ROADMAP.yaml` 1.0.0.
sourceSkills: ["aaelink-blueprint"]
---
id: DRIFT-019
title: ROADMAP omits per-region scalability targets
pillar: "🎯 Goal Drift Flags"
evidence:
  docQuote:
    docPath: docs/ROADMAP.yaml
    headingOrAnchor: "versions (lines 30-280)"
    quote: "No items list 100k workspaces/region, 250k members/workspace, 50k WS/gateway pod, 5M WS/region, 250k messages/sec/region, or 10 GB/s file upload throughput."
severityRationale: |
  BLUEPRINT § 5.4 (lines 380-390) commits to per-region scale targets — 100k workspaces /
  250k members per workspace / 50k WebSockets per gateway pod / 5M WebSockets per region /
  250k messages per second per region / 10 GB/s file upload. `docs/ROADMAP.yaml` has zero
  per-region scale items across 40 enumerated entries.
recommendation: |
  Add a "Per-region scalability targets (BLUEPRINT § 5.4)" section to
  `docs/ROADMAP.yaml` (e.g. as a top-level `scalability_targets:` map) capturing each
  threshold and its target version.
sourceSkills: ["aaelink-blueprint"]
---
id: DRIFT-020
title: ROADMAP federation scope reduced to message relay vs BLUEPRINT multi-org compliance
pillar: "🎯 Goal Drift Flags"
evidence:
  docQuote:
    docPath: docs/ROADMAP.yaml
    headingOrAnchor: "0.0.20-alpha.mtls-federation (P0) + 1.0.0.federation (P1)"
    quote: "cross-org message relay for shared channels (lines 209-212 + 274-278)."
severityRationale: |
  BLUEPRINT § 5.5 (line 393) and § 1.2 frame federation as a compliance posture (ethical
  walls, information barriers, DLP egress at the boundary, multi-org from day one).
  `docs/ROADMAP.yaml` reduces it to mTLS-secured cross-org message relay for shared
  channels. Scope drift, not target drift.
recommendation: |
  Expand `docs/ROADMAP.yaml`'s federation items to include explicit DLP egress at the
  org boundary, ethical walls, information barriers, and "external" markers per
  BLUEPRINT § 5.5.
sourceSkills: ["aaelink-blueprint"]
---
id: DRIFT-021
title: NORTH-STAR-A title invites confusion with sole North_Star_Document
pillar: "🎯 Goal Drift Flags"
evidence:
  docQuote:
    docPath: docs/NORTH-STAR-A.md
    headingOrAnchor: "Document title (line 1)"
    quote: "North Star — Native collaboration hub"
severityRationale: |
  Per Requirement 2.1, `docs/BLUEPRINT.md` is the sole North_Star_Document for this audit;
  per Requirement 2.2, `docs/NORTH-STAR-A.md` is a Reference_Document only. The "North
  Star" title invites a reader to treat the file as the canonical source, which would
  inject the drift listed in DRIFT-022..DRIFT-025 into the audit's goal frame.
recommendation: |
  Rename `docs/NORTH-STAR-A.md` (e.g. to `docs/quickstart-collaboration-hub.md`) or
  amend its title to "Quickstart — Native collaboration hub (companion to BLUEPRINT)" so
  the canonical north star is unambiguous. Update inbound links in `docs/README.md` and
  the `## See also` section.
sourceSkills: ["aaelink-blueprint"]
---
id: DRIFT-022
title: NORTH-STAR-A makes SSE primary; BLUEPRINT makes WebSocket primary with SSE fallback
pillar: "🎯 Goal Drift Flags"
evidence:
  docQuote:
    docPath: docs/NORTH-STAR-A.md
    headingOrAnchor: "## Realtime"
    quote: "The web client opens **Server-Sent Events** on `/api/collab/events` for the selected channel… If `EventSource` is unavailable, it falls back to polling via `/api/messages`."
severityRationale: |
  BLUEPRINT § 4.2 (line 245) names "WebSocket + WebTransport fallback; SSE for low-
  priority streams" — WebSocket is primary, SSE is the secondary path. NORTH-STAR-A
  inverts the order. The drift cites two API routes within the ~80 route groups
  (`app/api/collab/events/route.ts`, `app/api/messages/route.ts`).
recommendation: |
  Amend `docs/NORTH-STAR-A.md` § Realtime to mark WebSocket as the primary transport
  (with `app/api/ws` or successor) and SSE on `app/api/collab/events/route.ts` plus
  polling fallback on `app/api/messages/route.ts` as the secondary path, matching
  BLUEPRINT § 4.2.
sourceSkills: ["aaelink-blueprint"]
---
id: DRIFT-023
title: NORTH-STAR-A IA collapses to 5 entities; BLUEPRINT names a richer hierarchy
pillar: "🎯 Goal Drift Flags"
evidence:
  docQuote:
    docPath: docs/NORTH-STAR-A.md
    headingOrAnchor: "Lead bullet (line 3)"
    quote: "workspaces, channels, messages, tickets, and documents are implemented here against PostgreSQL"
severityRationale: |
  BLUEPRINT § 3.2 (lines 145-161) frames the IA as Workspace → Spaces → Channels →
  Messages / Threads / Canvases / Lists / Files / Huddles + Calls plus DMs, Later inbox,
  Activity, and Apps. NORTH-STAR-A reduces this to 5 primary entities and omits Spaces,
  Canvases, Lists, Huddles/Calls, Later inbox, Activity, Apps, Bookmarks, and DMs as a
  top-level entity.
recommendation: |
  Amend `docs/NORTH-STAR-A.md` lead bullet to enumerate the BLUEPRINT § 3.2 IA tiers, or
  reframe the bullet as "Today's surface (subset)" with a forward link to BLUEPRINT
  § 3.2 for the full hierarchy.
sourceSkills: ["aaelink-blueprint"]
---
id: DRIFT-024
title: NORTH-STAR-A storage stack omits Citus / Scylla / OpenSearch / Neo4j / ClickHouse / Kafka / Temporal
pillar: "🎯 Goal Drift Flags"
evidence:
  docQuote:
    docPath: docs/NORTH-STAR-A.md
    headingOrAnchor: "Lead bullet (line 3)"
    quote: "PostgreSQL (schema `aaelink`) and optional S3-compatible storage"
severityRationale: |
  BLUEPRINT § 4.5 (lines 296-307) names Postgres + Citus, ScyllaDB, OpenSearch + Vector,
  S3/MinIO, Neo4j, ClickHouse, Kafka, and Temporal as the data layer. NORTH-STAR-A names
  Postgres + S3 only. The same drift surfaces in DRIFT-004 / DRIFT-005 / DRIFT-007 /
  DRIFT-008 from the other Reference_Documents; this Finding records it specifically
  against `docs/NORTH-STAR-A.md`.
recommendation: |
  Amend `docs/NORTH-STAR-A.md` lead bullet to label Postgres + S3 as the v0.0.x
  starting-point storage and add a forward link to BLUEPRINT § 4.5 for the full data
  layer (Citus, Scylla, OpenSearch + vector, Neo4j, ClickHouse, Kafka, Temporal).
sourceSkills: ["aaelink-blueprint"]
---
id: DRIFT-025
title: NORTH-STAR-A documents AAELINK_OPEN_REGISTRATION not in BLUEPRINT auth stack
pillar: "🎯 Goal Drift Flags"
evidence:
  docQuote:
    docPath: docs/NORTH-STAR-A.md
    headingOrAnchor: "## Registration"
    quote: "When `AAELINK_OPEN_REGISTRATION` is unset or not `0`, anyone can register. Set `AAELINK_OPEN_REGISTRATION=0` to block new signups once at least one user exists."
severityRationale: |
  BLUEPRINT § 5.5 names the auth stack (OAuth 2.1, OIDC, SAML 2.0, passkeys, MFA mandatory
  for admins) but is silent on a registration env switch. NORTH-STAR-A asserts a policy
  mechanism that BLUEPRINT does not contract. The mechanism scopes to API routes within
  the ~80 route groups (e.g. `app/api/auth/register/route.ts`, `app/api/admin/users/`).
recommendation: |
  Either amend BLUEPRINT § 5.5 to formally contract `AAELINK_OPEN_REGISTRATION` (and any
  related routes under `app/api/auth/register/route.ts`) as part of the auth stack, or
  amend `docs/NORTH-STAR-A.md` to mark the env var as a v0.0.x deployment-time toggle
  with no commitment in the GA auth contract. Decide via `/aae-adr-create` so the
  selected option is recorded in `docs/ADR/`.
sourceSkills: ["aaelink-blueprint"]
---
id: DRIFT-026
title: BLUEPRINT carries no machine-extractable Goal/Requirement/Objective/Capability anchors
pillar: "🎯 Goal Drift Flags"
evidence:
  docQuote:
    docPath: docs/BLUEPRINT.md
    headingOrAnchor: "Heading inventory (33 L2/L3 headings, lines 9-442)"
    quote: "None of the 33 enumerated L2/L3 headings prefix-matches `/^(Goal|Requirement|Objective|Capability)/i`; no in-document bullet matches `/^MUST|^SHALL|^Provide|^Support/i`."
severityRationale: |
  Per Requirement 2.4 the audit MUST extract a `BlueprintGoal[]` from the
  North_Star_Document before generating any 🎯 Goal Drift Flag. The `design.md` § "Blueprint_Goal extraction" regex `/^(Goal|Requirement|Objective|Capability)/i` (heading-level) and `/^MUST|^SHALL|^Provide|^Support/i` (bullet-level) yield zero entries against `docs/BLUEPRINT.md`. The North_Star_Document carries north-star content (vision, strategic positioning, success metrics, parity matrix, scalability targets, security posture, roadmap milestones) but the vocabulary is descriptive, not imperative, so the audit-engine extractor cannot generate a non-empty `BlueprintGoal[]`. Filed against BLUEPRINT itself because the drift is in the North_Star_Document's machine-readability, not in a Reference_Document. Phase F task 7.3 will record "0 Blueprint_Goals extracted under the design.md regex" in the Final_Verification_Summary.
recommendation: |
  Either (a) amend `design.md` § "Blueprint_Goal extraction" to widen the heading regex
  to match BLUEPRINT's actual vocabulary (e.g. `/^(Vision|Strategic|Success Metrics|Scalability|Security|Roadmap)/i`) or (b) amend `docs/BLUEPRINT.md` to expose machine-extractable goal anchors per the companion Finding UPG-001. Option (b) is recorded as the Phase B `aaelink-blueprint` recommendation; option (a) is a fallback that requires a `/aae-adr-create` if chosen.
sourceSkills: ["aaelink-blueprint"]
---
id: UPG-001
title: Add machine-extractable Goal/Requirement/Objective/Capability anchors to BLUEPRINT
pillar: "🟡 Upgrades Recommended"
evidence:
  docQuote:
    docPath: docs/BLUEPRINT.md
    headingOrAnchor: "Heading inventory (33 L2/L3 headings, lines 9-442)"
    quote: "Headings use descriptive titles (Vision, Strategic Positioning, Success Metrics, Scalability Targets, Security & Compliance, Roadmap) — no Goal:/Requirement:/Objective:/Capability: anchors and no MUST/SHALL/Provide/Support bullets."
severityRationale: |
  Companion to DRIFT-026. The North_Star_Document is human-readable but not machine-
  readable for the audit-engine extractor in `design.md` § "Blueprint_Goal extraction".
  Without anchors, every subsequent audit run produces an empty `BlueprintGoal[]` and the
  per-goal coverage assertion (Property 28) is vacuously satisfied — a regression vector.
  Filed as 🟡 (upgrade, not critical) because the audit can still run; the cost is the
  loss of a structural invariant.
recommendation: |
  Amend `docs/BLUEPRINT.md` to expose machine-extractable goal anchors. Two options,
  pick one via `/aae-adr-create`:
    1. Add an inline `Goal:` / `Requirement:` / `Objective:` / `Capability:` prefix to
       L2 / L3 headings whose body declares a goal (e.g. § 1.1 "Vision" → "Objective:
       Vision", § 1.3 "Success Metrics" → "Goal: Success Metrics (12 months post-GA)",
       § 5.4 "Scalability Targets" → "Capability: Scalability Targets").
    2. Add an explicit `## Goals` (or `## Requirements`) appendix at the end of the
       document that enumerates every goal as a bullet starting with `MUST` / `SHALL`
       / `Provide` / `Support`, each citing the section it derives from.
  Either option produces a non-empty `BlueprintGoal[]` for subsequent audit runs and
  closes the regression vector. Track via a Story_Stub at
  `.kiro/stories/upg-001-blueprint-goal-anchors.md` per Phase E task 6.3 (this Finding
  is 🟡, so it routes to a stub, not an inline fix task).
sourceSkills: ["aaelink-blueprint"]
```

## Counts

- DRIFT-NNN emitted: 26 (DRIFT-001..DRIFT-026)
- UPG-NNN emitted: 1 (UPG-001)
- **Total findings emitted by `aaelink-blueprint`: 27**
- Source candidates consumed: 38 of 38 (no candidate dropped; merge map above)

## Stack-context guardrail summary

| Rule | Trigger seen in this skill's findings | Resolution |
|---|---|---|
| G1 (`getPool()` outside `lib/db.ts`) | none | n/a |
| G2 (`lib/migrate.ts` for schema changes) | none | n/a |
| G3 (four-gates citation for release-readiness claims) | none | n/a |
| G4 (`desktop/` Electron client scope) | DRIFT-011 (Tauri migration) | recommendation cites `desktop/` Electron client tree explicitly |
| G5 (`app/api/.../route.ts` path for API-route recommendations) | DRIFT-022 (realtime routes) + DRIFT-025 (registration env var) | recommendations cite `app/api/collab/events/route.ts`, `app/api/messages/route.ts`, `app/api/auth/register/route.ts` paths |

## Notes for downstream tasks

- **Task 2.3..2.9 (chain steps 2-8)**: continue invoking remaining skills. Findings from those skills land in their own `_scratch/findings/<skill>.md` files; this file is exclusively the `aaelink-blueprint` output.
- **Task 6.x (triage)**: every Finding above already carries `pillar`. The 26 DRIFT-NNN are routed to `.kiro/stories/<finding-slug>.md` per Phase E task 6.3 (🎯 routing rule TBD by triage; design.md § "Pillar section template" treats 🎯 as story-stub-routed by default). UPG-001 is routed to a stub by Phase E task 6.3.
- **Task 7.3 (Verification_Protocol goal cross-check)**: empty `BlueprintGoal[]` is vacuously satisfied. The per-goal cross-check uses DRIFT-026 as the explicit "no goals extracted" record. Final_Verification_Summary § Goal coverage cross-check MUST cite DRIFT-026.
- **Task 7.5 (contradiction detector)**: DRIFT-021 ("rename / amend NORTH-STAR-A title") and DRIFT-022..DRIFT-025 (which are filed against the same document) do not conflict — DRIFT-021 amends the title, DRIFT-022..DRIFT-025 amend the body. No pairwise contradiction.
- **Property 6 (Reference_Document conflicts emit a 🎯 against the Reference_Document)**: DRIFT-001..DRIFT-025 cite a Reference_Document in `evidence.docQuote.docPath`. DRIFT-026 is the lone exception — it cites BLUEPRINT directly because the drift is in the North_Star_Document's own machine-readability. The property test must allow this case explicitly (or DRIFT-026 may be filed under a different `IdPrefix`; current decision is to keep `DRIFT-026` and document the exception here for the Phase I property test author).
- **Property 28 (Every Blueprint_Goal is either satisfied or flagged as drift)**: vacuously true for the empty `BlueprintGoal[]`. The empty case is itself surfaced via DRIFT-026 + UPG-001.

---

_Scratch artifact — internal to the comprehensive-project-audit run on 2026-05-25._
