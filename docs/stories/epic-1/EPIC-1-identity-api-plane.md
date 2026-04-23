# Epic 1 — Identity & API Plane
**Epic ID**: E-1  
**Owner**: BMAD — Winston + Amelia  
**Status**: Blocked on Epic 0 completion  
**Layer**: 1 — Auth + Gateway + Policy  
**Prerequisite for**: All communication and application services

---

## Epic Goal
Every API call is authenticated, authorized, rate-limited, and audited before it reaches any service. When this Epic is done, no service needs to implement its own auth logic — the platform enforces it.

---

## Stories

### E-1-S1: Kong API Gateway
- Deploy Kong 3+ with DB-less declarative config (sync from Gitea via Argo CD)
- Plugins enabled per route: `oidc` (Keycloak), `rate-limiting`, `cors`, `request-id`, `prometheus`
- Routes defined for all Epic 2+ services (stubs acceptable)
- Health endpoint: `GET /status` returns 200 for all upstream services

### E-1-S2: Audit Log Service (microservice)
- NestJS service; receives events via NATS `AUDIT.*` subject
- Writes to Elasticsearch `aaelink-audit` index (append-only; no update/delete)
- Index fields: `event_id`, `actor_id`, `actor_role`, `tenant_id`, `resource_type`, `resource_id`, `action`, `timestamp_utc`, `ip_address`, `user_agent`, `payload_hash`
- REST API: `GET /audit?actor=&resource=&from=&to=` (admin only, OPA enforced)

### E-1-S3: Multi-tenancy Router
- Every request includes `X-Tenant-ID` header (set by Kong after OIDC claim extraction)
- All services read tenant context from request context; never cross-query tenant data
- Tenant table in PostgreSQL `aaelink_auth`; Keycloak realm-per-tenant OR realm-attribute strategy decision documented as ADR

### E-1-S4: Vault Secrets Injector Validation
- Every service deployed in Epic 2+ has a `vault.hashicorp.com/inject: "true"` annotation
- Integration test: service starts with empty env vars; Vault sidecar injects DB creds at runtime
- Rotation test: Vault rotates DB password; service reconnects without restart

### E-1-S5: OPA API Authorization Policies
- Rego policy: `authz/api/main.rego` — maps role → resource → action
- All 7 default roles have full policy coverage for messaging resources (preview of Epic 2)
- Policy CI test suite: 30+ unit tests in `opa test ./policies/`
- Kong calls OPA `/v1/data/authz/api/allow` on every request above auth layer

---

## Epic 1 Exit Criteria
1. A request with no token → 401 from Kong (Keycloak)
2. A request with `member` token trying to access admin API → 403 from OPA
3. 10,000 requests/min to messaging stub → rate limiter triggers 429
4. Every request produces an audit event in Elasticsearch within 500ms
5. Cross-tenant data query returns 0 results (isolation verified)
