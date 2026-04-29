# Phase 5 — Operations and production layer

**Identity:** **AAELink** (app) · **Advanced ID Asia Engineering Co., Ltd.** (company).

**Prerequisites:** Running Compose stack from this repository (see root [`README.md`](../README.md) / [`docker-compose.yml`](../docker-compose.yml)), Phases **1–4** understood at the level your team needs.

This layer is **not** more application code in `vendor/upstream/`; it is how you run **AAELink** safely on a MacBook today and on servers tomorrow.

**Next.js-only deployments:** Many checklist items are **engine / `MM_*` / System Console** oriented. If you ship only the **Next.js** app, translate TLS, cookies, and file storage using [`architecture-technical.md`](./architecture-technical.md) and [`deployment/secrets.md`](./deployment/secrets.md).

---

## 5.1 Reverse proxy and TLS

| Topic | Action |
|-------|--------|
| **HTTPS** | Terminate TLS in nginx, Traefik, Caddy, or a cloud LB; set **`MM_SERVICESETTINGS_SITEURL`** to the **https** origin users type |
| **WebSockets** | Ensure proxy **Upgrade** / **Connection** headers and **idle timeouts** are compatible (WS is long-lived) |
| **Sticky sessions** | If you later run **multiple** app replicas behind a LB, WebSocket affinity may be required unless upstream clustering docs say otherwise for your topology |

---

## 5.2 Data and backups

| Store | This repo’s minimal `docker-compose.yml` | Full Mattermost engine stack (when added) |
|-------|-------------------------------------------|---------------------------------------------|
| **PostgreSQL** | Named volume `postgres-data` (Docker shows it prefixed with the Compose project name, e.g. `aaelink-clean_postgres-data`) | Same pattern; name follows your project `name:` |
| **Uploads / files** | Named volume `minio-data` for the S3-compatible store | Engine deployments add app upload volumes (plugins, config, logs, etc.) per your stack file |

**Backup:** snapshot Postgres **and** file volumes on a schedule; test restore. **`scripts/stack-reset.zsh`** wipes data—do not run on production.

---

## 5.3 Observability and mail

| Area | Notes |
|------|--------|
| **Logs** | Container logs; ship to your SIEM if required |
| **Metrics** | Enable per upstream / System Console where Team Edition allows |
| **SMTP** | Configure in **System Console** for invites and notifications |

---

## 5.4 Calls, mobile, push (when you leave single-host)

| Capability | Typical extra infra |
|--------------|---------------------|
| **Voice/video** | ICE/STUN; production usually adds **TURN** |
| **Mobile** | Point apps at Site URL; **push** often needs proxy + vendor credentials |
| **Extensions** | Marketplace URL and air-gap policy per `docs/BRANDING.md` |

---

## 5.5 Checklist (production-ready)

**Runnable list:** **[`deployment/production-checklist.md`](./deployment/production-checklist.md)** — TLS, reverse proxy and forwarded headers, WebSockets, backups (Postgres + engine volumes), SMTP and DNS mail auth, MFA/SSO, secrets, observability, calls/mobile/push, legal.

**Minimum gates** (must be true before you call the environment production):

- [ ] **`MM_SERVICESETTINGS_SITEURL`** matches the public URL (including **`https`**).
- [ ] **TLS and proxy** — Valid certs; WebSocket-friendly timeouts; forwarded headers trusted per upstream docs for your release.
- [ ] **Postgres backups + tested restore**; **file / config / plugin** volumes covered or S3 plan in place.
- [ ] **SMTP** working end-to-end (invites or notifications); mail authentication (SPF/DKIM/DMARC) coordinated with whoever owns the domain.
- [ ] **Auth policy** signed off (at least **admin MFA**; SSO/password rules as applicable).
- [ ] **Legal** — Fork or custom images only if reviewed (`../AAELinkPowered/CONTRIBUTING.md`).

## See also

- [`deployment/production-checklist.md`](./deployment/production-checklist.md) — full TLS, backup, SMTP, auth, observability checklist  
- [`ROADMAP-PHASES-AND-LAYERS.md`](./ROADMAP-PHASES-AND-LAYERS.md) — phases vs stack slices; operator vs engineer paths  
- [`PHASE7-END-TO-END-DEV-LOOP.md`](./PHASE7-END-TO-END-DEV-LOOP.md) — full source loop (`make run`, webapp + server)  
- [`PHASE6-GO-DEVELOPMENT-MACBOOK.md`](./PHASE6-GO-DEVELOPMENT-MACBOOK.md) — local Go toolchain and upstream `make` flow  
- [`HOSTING-MACBOOK.md`](./HOSTING-MACBOOK.md)  
- [`deployment/secrets.md`](./deployment/secrets.md)  
- [`WHERE-IS-THE-ENGINE.md`](./WHERE-IS-THE-ENGINE.md)  
