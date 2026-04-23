# Epic 0 — Infrastructure Foundation
**Epic ID**: E-0  
**Owner**: BMAD — Winston (Architect) + Amelia (Developer)  
**Status**: Ready for Development  
**Layer**: 0 — Platform Backbone  
**Prerequisite for**: All other Epics

---

## Epic Goal
Provision a fully operational, GitOps-managed, observable, secure Kubernetes platform on which every AAELink service will be deployed. When this Epic is done, the team should be able to deploy any microservice with a Helm chart, have it auto-enrolled into the service mesh, automatically scrape metrics, emit traces, and have secrets injected without any manual config.

---

## Stories

### E-0-S1: Kubernetes Cluster Bootstrap
**As a** platform engineer  
**I want** a Kubernetes cluster running  
**So that** all services have a deployment target

**Acceptance Criteria**:
- [ ] k3s (local dev) or K8s 1.30+ (production) cluster provisioned
- [ ] `kubectl get nodes` shows all nodes Ready
- [ ] Cluster namespaces created: `aaelink-infra`, `aaelink-core`, `aaelink-mfg`, `aaelink-marketplace`, `aaelink-ai`, `monitoring`, `security`
- [ ] Node labels applied for affinity rules (db, messaging, worker)
- [ ] StorageClass configured (local-path for dev; Longhorn/Rook for prod)

**Tasks**:
1. Write K8s cluster manifest (or k3s install script)
2. Create namespace YAML files
3. Apply NetworkPolicy default-deny-all per namespace
4. Document in `docs/operations/k8s-cluster-setup.md`

---

### E-0-S2: Gitea + Argo CD (GitOps Pipeline)
**As a** developer  
**I want** a GitOps pipeline  
**So that** every git push to `aaelink-gitops` repo auto-deploys to the cluster

**Acceptance Criteria**:
- [ ] Gitea running at `http://git.aaelink.local` with AAELink org and repos
- [ ] Argo CD running at `https://argocd.aaelink.local`; syncing `aaelink-gitops` repo
- [ ] App-of-Apps pattern: one root Argo CD Application managing all child apps
- [ ] Argo CD webhook from Gitea triggers sync on push
- [ ] Argo CD RBAC: `admin` and `readonly` roles

**Tasks**:
1. Helm install Gitea into `aaelink-infra` namespace
2. Create `aaelink-gitops` repo structure
3. Helm install Argo CD; configure App-of-Apps
4. Set up Gitea → Argo CD webhook
5. Document branching strategy (`main` → prod, `staging` → staging)

---

### E-0-S3: HashiCorp Vault — Secrets Management
**As a** security engineer  
**I want** Vault running and integrated with Kubernetes  
**So that** no service ever has a hardcoded secret

**Acceptance Criteria**:
- [ ] Vault running in HA mode (Raft backend) in `security` namespace
- [ ] Kubernetes auth method enabled; each service namespace has a Vault role
- [ ] Vault Agent Sidecar Injector installed; annotated pods auto-receive secrets
- [ ] PKI CA configured; Vault issues TLS certs for internal services
- [ ] Dynamic PostgreSQL credentials working (test with a dummy service)
- [ ] Vault UI accessible to `vault-admin` role only

**Tasks**:
1. Helm install Vault (HA Raft)
2. Initialize and unseal (auto-unseal via KMS for prod)
3. Enable `kubernetes` auth method
4. Create policies per service namespace
5. Enable PKI secrets engine; create root + intermediate CA
6. Enable `database` secrets engine for PostgreSQL
7. Document in `docs/security/vault-setup.md`

---

### E-0-S4: Keycloak — Identity Platform
**As a** platform admin  
**I want** Keycloak running with an AAELink master realm  
**So that** user login works across all services from day one

**Acceptance Criteria**:
- [ ] Keycloak 24+ running at `https://auth.aaelink.local`
- [ ] `aaelink-master` realm created with OIDC, SAML endpoints active
- [ ] Roles created: `platform_admin`, `org_admin`, `manager`, `agent`, `member`, `guest`, `vendor`
- [ ] Demo users created for each role (for testing)
- [ ] OIDC client created for the Next.js frontend
- [ ] Client credentials client created for service-to-service auth
- [ ] Keycloak theme stubbed (AAELink branding placeholder)

**Tasks**:
1. Helm install Keycloak (PostgreSQL-backed via external-db)
2. Configure realm via Keycloak admin REST API (IaC with Terraform or realm export)
3. Create roles and demo users
4. Create OIDC clients
5. Document in `docs/security/keycloak-setup.md`

---

### E-0-S5: OPA — Policy Engine
**As a** security engineer  
**I want** OPA running as a K8s admission webhook  
**So that** only compliant, signed workloads can be deployed

**Acceptance Criteria**:
- [ ] OPA Gatekeeper installed in `security` namespace
- [ ] ConstraintTemplates created: require-image-digest, deny-privileged-container, require-resource-limits, require-labels (`app`, `version`, `team`)
- [ ] Constraints applied to all namespaces except `kube-system`
- [ ] OPA HTTP API available for service-level authz queries
- [ ] Test: deploying a privileged container is rejected

**Tasks**:
1. Helm install OPA Gatekeeper
2. Write ConstraintTemplate YAMLs
3. Apply Constraint objects to namespaces
4. Write base Rego policies for API authz (role→resource→action)
5. Document in `docs/security/opa-policies.md`

---

### E-0-S6: NATS JetStream — Event Bus
**As a** backend developer  
**I want** NATS JetStream running  
**So that** services can publish and consume domain events reliably

**Acceptance Criteria**:
- [ ] NATS 3-node cluster in `aaelink-infra` namespace
- [ ] JetStream enabled; `aaelink.*` subject namespace reserved
- [ ] Streams created: `MESSAGES`, `EVENTS`, `MANUFACTURING`, `AUDIT`
- [ ] Consumer groups configured per service
- [ ] NATS monitoring dashboard accessible (`nats-surveyor` or built-in)
- [ ] TLS certs from Vault PKI

**Tasks**:
1. Helm install NATS cluster
2. Configure JetStream streams via NATS CLI or K8s config
3. Test publish/consume with `nats` CLI
4. Document stream naming convention

---

### E-0-S7: PostgreSQL HA Cluster
**As a** data engineer  
**I want** a HA PostgreSQL cluster  
**So that** all relational data is durable and auto-failovers

**Acceptance Criteria**:
- [ ] Patroni-managed PostgreSQL 16 cluster (1 primary + 2 replicas)
- [ ] pgBouncer connection pooler deployed
- [ ] Databases pre-created: `aaelink_auth`, `aaelink_messaging`, `aaelink_crm`, `aaelink_tickets`, `aaelink_manufacturing`, `aaelink_marketplace`, `aaelink_audit`
- [ ] Vault dynamic credentials working for all databases
- [ ] Automated daily backups to MinIO via `pgBackRest` or `Barman`
- [ ] Replica lag monitoring in Prometheus

**Tasks**:
1. Deploy PostgreSQL via CloudNativePG (preferred operator) or Patroni
2. Configure pgBouncer
3. Create databases and user roles via init SQL
4. Configure Vault database secrets engine for each DB
5. Set up backup CronJob

---

### E-0-S8: MongoDB Replica Set
**As a** backend developer  
**I want** MongoDB running for message storage  
**So that** high-volume chat messages have a flexible, scalable store

**Acceptance Criteria**:
- [ ] MongoDB 7 replica set (1 primary + 2 secondaries) in `aaelink-infra`
- [ ] `aaelink_messages` and `aaelink_documents` databases created
- [ ] Indexes on: `conversation_id`, `created_at`, `sender_id`, `tenant_id`
- [ ] Vault-managed MongoDB credentials
- [ ] Mongo backup CronJob to MinIO

**Tasks**:
1. Deploy MongoDB via MongoDB Operator or Helm
2. Configure replica set
3. Create databases + indexes
4. Wire Vault credentials

---

### E-0-S9: Elasticsearch Cluster
**As a** search developer  
**I want** Elasticsearch 8 running  
**So that** all full-text search (messages, docs, KB, CAD metadata) works

**Acceptance Criteria**:
- [ ] Elasticsearch 8 (3-node) in `aaelink-infra`
- [ ] Kibana (or OpenSearch Dashboards) accessible for index management
- [ ] Indices pre-created: `aaelink-messages`, `aaelink-docs`, `aaelink-knowledge`, `aaelink-audit`
- [ ] ILM policies configured (hot-warm-cold tiers)
- [ ] Security enabled (TLS + Vault-managed API keys)

**Tasks**:
1. Deploy via ECK (Elastic Cloud on Kubernetes) operator
2. Create index templates with mappings
3. Configure ILM policies
4. Test basic search query

---

### E-0-S10: MinIO — Object Storage
**As a** media engineer  
**I want** MinIO running  
**So that** all files, images, CAD files, and backups have a durable S3-compatible store

**Acceptance Criteria**:
- [ ] MinIO single-node (dev) or distributed (prod) at `https://storage.aaelink.local`
- [ ] Buckets created: `aaelink-media`, `aaelink-cad`, `aaelink-docs`, `aaelink-backups`, `aaelink-plugins`
- [ ] Server-side encryption (SSE-KMS) via Vault KMS integration
- [ ] Pre-signed URL generation working
- [ ] Virus scan hook: ClamAV scans on every upload to `aaelink-media`
- [ ] MinIO Console accessible to `minio-admin` only

**Tasks**:
1. Helm install MinIO
2. Create buckets with lifecycle policies
3. Configure SSE-KMS with Vault
4. Deploy ClamAV DaemonSet; configure MinIO bucket notification → ClamAV service
5. Document upload flow

---

### E-0-S11: Redis Sentinel Cluster
**As a** backend developer  
**I want** Redis HA running  
**So that** sessions, presence, and rate limiting have a fast, resilient cache

**Acceptance Criteria**:
- [ ] Redis 7 with Sentinel (1 primary + 2 replicas + 3 sentinels) in `aaelink-infra`
- [ ] Separate Redis logical DBs: `0` (sessions), `1` (presence), `2` (rate-limit), `3` (cache)
- [ ] `maxmemory-policy allkeys-lru` configured
- [ ] Vault-managed Redis credentials

---

### E-0-S12: Observability Stack
**As a** SRE  
**I want** Prometheus, Grafana, Loki, and Jaeger deployed  
**So that** every service is observable from day one

**Acceptance Criteria**:
- [ ] Prometheus scraping all K8s node/pod/service metrics
- [ ] Grafana with pre-built dashboards: K8s overview, NATS, PostgreSQL, MongoDB, Elasticsearch, MinIO
- [ ] Grafana Loki receiving logs from all pods via Promtail DaemonSet
- [ ] Jaeger UI accessible at `https://tracing.aaelink.local`
- [ ] OpenTelemetry Collector running as K8s DaemonSet
- [ ] Alertmanager with Slack webhook channel configured
- [ ] SLO dashboard stub created (latency, error rate, saturation)

**Tasks**:
1. Helm install kube-prometheus-stack (includes Prometheus + Grafana + Alertmanager)
2. Helm install Grafana Loki stack
3. Helm install Jaeger (all-in-one for dev; production mode for prod)
4. Deploy OpenTelemetry Collector
5. Import dashboard JSONs (from vendored Grafana repo)

---

### E-0-S13: Security Scanning Pipeline
**As a** security engineer  
**I want** Trivy + Cosign in CI and Nuclei scheduled against staging  
**So that** no vulnerable or unsigned image ever reaches production

**Acceptance Criteria**:
- [ ] Gitea Actions workflow: every push triggers `trivy image` scan; HIGH/CRITICAL fails pipeline
- [ ] Cosign signs every image pushed to registry; OPA admission rejects unsigned images
- [ ] Nuclei CronJob in `security` namespace scans staging endpoints daily
- [ ] Nuclei findings posted to Gitea Issue tracker via webhook
- [ ] Trivy SBOM generated and stored in MinIO `aaelink-backups/sbom/`

---

### E-0-S14: Backstage Service Catalog
**As a** developer  
**I want** Backstage running  
**So that** every AAELink microservice is cataloged with docs, runbooks, and ownership

**Acceptance Criteria**:
- [ ] Backstage running at `https://catalog.aaelink.local`
- [ ] Software catalog: initial entries for all Epic 0 infrastructure components
- [ ] TechDocs enabled (MkDocs backend → `/docs` folders in each service repo)
- [ ] GitHub/Gitea integration: catalog auto-discovers `catalog-info.yaml` files
- [ ] Scaffolder template: "Create AAELink Microservice" wizard

---

## Epic 0 Exit Criteria

All 14 stories DONE + the following verified:
1. Deploy a test service via Argo CD → it appears in Prometheus, Loki, Jaeger
2. Service retrieves secrets from Vault without any hardcoded credentials
3. Keycloak login flow completes with a demo user
4. OPA blocks a privileged container deployment
5. NATS message published from one pod, consumed by another
6. File uploaded to MinIO, ClamAV scan completes, pre-signed URL returned
7. Trivy scan catches a HIGH CVE in a test image; pipeline fails

---

*Epic 1 starts only after Epic 0 exit criteria are fully met.*  
*BMAD Winston reviews ADRs; Amelia implements; QA Agent validates exit criteria.*
