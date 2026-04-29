# AAELink production checklist

**AAELink** = application; **Advanced ID Asia Engineering Co., Ltd.** = company line.

Use this when moving from **MacBook / lab Compose** to **shared or internet-facing production**. It extends the short gates in [`PHASE5-OPERATIONS-LAYER.md`](../PHASE5-OPERATIONS-LAYER.md) and the secret inventory in [`secrets.md`](./secrets.md).

**Minimal app compose** ([`docker-compose.yml`](../../docker-compose.yml)): named volumes `postgres-data` and `minio-data`. Docker prefixes them with the Compose project name from the file’s top-level `name:` (for example `aaelink-clean_postgres-data`). **Mattermost engine** deployments add separate volumes (often `*-engine-data`, plugins, config); names depend on the stack file you use.

**Scope:** Sections 2–4, 8–9 are **Mattermost engine** oriented (`MM_*`, System Console, engine volumes, mobile). For **Next.js-only** production, use sections 1 (TLS/proxy), 3 (Postgres + object storage), 5–7, and adapt items using [`architecture-technical.md`](../architecture-technical.md) and [`secrets.md`](./secrets.md).

---

## 1. TLS and reverse proxy

- [ ] **Public URL** — `MM_SERVICESETTINGS_SITEURL` is exactly the origin users and mobile clients use (scheme + host + path prefix if any), typically **`https://collab.example.com`** with no trailing slash unless your deployment intentionally uses one.
- [ ] **Certificates** — TLS certs are valid, auto-renewed (ACME or PKI), and monitored for expiry.
- [ ] **TLS versions** — Edge listener disables obsolete protocols/ciphers per your security baseline.
- [ ] **HTTP to HTTPS** — Users hitting `http://` are redirected to `https://` (or blocked if policy forbids cleartext).
- [ ] **Forwarded headers** — Reverse proxy sets **`X-Forwarded-Proto`**, **`X-Forwarded-For`** (and **`Host`** as needed); the app is configured per **upstream documentation for your release** to trust those headers so links, cookies, and rate limits are correct.
- [ ] **WebSockets** — Proxy allows **`Upgrade`** and **`Connection`**; idle/read timeouts are long enough for long-lived WS (avoid silent drops at 60s if your proxy defaults that low).
- [ ] **Sticky sessions** — If you run **more than one** app instance behind a load balancer, confirm whether your edition/topology requires **session affinity** for WebSockets or clustering; document the choice.
- [ ] **No accidental bypass** — Production users do not reach the app container port directly unless that is an explicit architecture choice; traffic goes through the TLS terminator.

---

## 2. Application hardening (Compose + System Console)

- [ ] **Local / diagnostic modes** — Review **`MM_SERVICESETTINGS_ENABLELOCALMODE`** (lab Compose often enables it). Set to production-safe values per upstream guidance; do not leave developer-only modes on in production without intent.
- [ ] **Site URL vs System Console** — After cutover, open **System Console → Environment → Web Server** (or equivalent for your pin) and confirm **Site URL** matches the public HTTPS URL.
- [ ] **File storage** — Default is local volumes under the engine container. For scale or HA, plan **S3-compatible** storage and configure it in **System Console** (and network path from the app).
- [ ] **Extensions** — Marketplace URL, air-gap policy, and allowed uploads align with [`BRANDING.md`](../BRANDING.md) and legal review.
- [ ] **Branding** — Login text, logo, support links, feedback name/org match published policies (not placeholders pointing at Site URL if you now have real pages).

---

## 3. Backups and recovery

- [ ] **PostgreSQL** — Scheduled logical dumps (`pg_dump` / managed backup) **or** approved volume snapshots; retention and encryption at rest defined.
- [ ] **Engine data** (Mattermost deployment only) — Plan covers upload/config/plugin volumes from **your** engine Compose or chart (names vary); include logs if compliance requires them.
- [ ] **RPO / RTO** — Documented (how much data loss and downtime are acceptable).
- [ ] **Restore drill** — At least one **test restore** from a recent backup into a non-production environment succeeded end-to-end (DB + file restore if applicable).
- [ ] **Runbook** — Who runs restore, how to pause writes, how to validate before reopening users.
- [ ] **Destructive scripts** — Everyone on the team knows **`scripts/stack-reset.zsh`** destroys local data and is **not** for production hosts.

---

## 4. SMTP (email)

- [ ] **Network** — Outbound path from the app (or SMTP relay) to the mail service is allowed by firewall and egress policy.
- [ ] **System Console** — **SMTP** host, port, TLS mode, authentication, **From** address, and connection pool limits set; test credentials stored in your secret manager where supported.
- [ ] **DNS / mail auth** — Sending domain has **SPF**, **DKIM**, and **DMARC** (or your org’s equivalent) so invites and notifications are not rejected or spam-foldered.
- [ ] **Functional test** — Send a **team invite** or **notification** from the app and confirm delivery, headers, and reply-to behavior.
- [ ] **Feedback headers** — `MM_EMAILSETTINGS_FEEDBACKNAME` / org (or env overrides) match the identity you want recipients to see.

---

## 5. Authentication and access policy

- [ ] **Administrator MFA** — Enforced for system admin accounts (minimum bar for production).
- [ ] **User auth** — Password policy, **SSO/SAML/LDAP** if used, and guest access rules are decided and configured; break-glass admin access documented.
- [ ] **Session security** — Idle timeout and session length match policy; logout and “remember me” behavior tested behind the same proxy as production.
- [ ] **API / integrations** — Personal access tokens and webhook usage follow least privilege; rotation story exists for long-lived tokens.

---

## 6. Secrets and configuration management

- [ ] **No secrets in git** — Production values live in a secret store or host-only env, not the repo (see [`secrets.md`](./secrets.md)).
- [ ] **`POSTGRES_PASSWORD`** — Strong, unique, rotated when staff change or after incident. **Mattermost stacks:** align with **`MM_SQLSETTINGS_DATASOURCE`**. **Next.js-only:** align with **`DATABASE_URL`** (same database the app uses).
- [ ] **Rotation** — Procedure exists for DB password, SMTP, and OAuth client secrets without unplanned full outage.

---

## 7. Observability and capacity

- [ ] **Logs** — Container or host logs reach a central store; retention matches compliance.
- [ ] **Metrics / health** — HTTP health checks, DB connectivity, disk usage (Postgres + uploads volume) monitored; alerts go to on-call.
- [ ] **Capacity** — Postgres connections, file upload size limits, and Docker CPU/RAM are sized for expected peak (adjust from MacBook defaults).

---

## 8. Calls, mobile, and push (when you use them)

- [ ] **Voice/video** — ICE/STUN documented; **TURN** deployed if users are on restrictive networks; ports and credentials secured.
- [ ] **Mobile / desktop clients** — Point to production **Site URL**; push notifications have **FCM/APNS** (or org-approved path) and any required **push proxy** configured.
- [ ] **Client updates** — Plan for app store links if you changed **`MM_NATIVEAPPSETTINGS_*`** from defaults.

---

## 9. Legal, license, and custom binaries

- [ ] **Stock image** — Team Edition terms cover your deployment model (users, hosting, data).
- [ ] **Custom images / fork** — Review [`../../AAELinkPowered/CONTRIBUTING.md`](../../AAELinkPowered/CONTRIBUTING.md) and legal before shipping modified binaries or redistributing builds.

---

## See also

- [`../PHASE5-OPERATIONS-LAYER.md`](../PHASE5-OPERATIONS-LAYER.md) — operations layer overview  
- [`./secrets.md`](./secrets.md) — env and secret inventory  
- [`../HOSTING-MACBOOK.md`](../HOSTING-MACBOOK.md) — LAN and migration off a MacBook  
- [`../ROADMAP-PHASES-AND-LAYERS.md`](../ROADMAP-PHASES-AND-LAYERS.md) — where this fits in phases vs stack slices  
