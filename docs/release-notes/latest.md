# AAELink v0.0.1-alpha

> **Version:** `v0.0.1-alpha` &middot; **Channel:** Alpha &middot; **Status:** First public alpha

First public alpha of **AAELink**, the internal enterprise SuperApp for
Advanced ID Asia Engineering. Ships an IT Help Desk and the foundation of
the company-wide collaboration platform, deployable on a single Mac, Windows
PC, or LAN host via Docker, with native desktop clients for macOS and Windows.

---

## Highlights

- IT Help Desk end-to-end (submit, triage, comment, resolve) with realtime updates.
- Identity & RBAC with three roles: `it_admin`, `it_employee`, `employee`.
- Admin panel for users, departments, roles and system config.
- Native desktop clients for **Windows (.exe)** and **macOS (.dmg, Apple Silicon + Intel)**.
- LAN-deployable Docker stack so one host can serve the whole office.

---

## What's new

### Application
- **IT Help Desk** — submit, triage, comment and resolve tickets with realtime updates over Server-Sent Events.
- **Identity & access** — sign-in, JWT access + refresh tokens, three roles: `it_admin`, `it_employee`, `employee`.
- **Admin panel** — user CRUD, department CRUD, role assignment, system config; restricted to `it_admin`.
- **Notifications** — email delivery via Mailhog (dev) or Microsoft 365 SMTP (production).
- **File storage** — uploads / downloads through MinIO with presigned URLs.
- **Internationalization** — English (default), Thai (ภาษาไทย), German (Deutsch); URL-based locale switcher.
- **Operations dashboards** — Grafana, Prometheus, Loki and Promtail wired in for ops visibility.

### Desktop clients
- **Windows installer** — `AAELink-Setup-0.0.1-alpha.exe` (NSIS, x64).
- **macOS disk images** — `AAELink-0.0.1-alpha-arm64.dmg` (Apple Silicon) and `AAELink-0.0.1-alpha.dmg` (Intel).
- **Server URL switcher** — point any client at `http://<HOST>:18080` from the Help menu.
- **Persistent sign-in** — opt-in "Keep me signed in" backed by OS-protected secure storage.
- **Auto-update on launch** — clients check this repository for newer releases and offer a one-click update.

### Server / runtime
- Single-command Docker Compose stack: Traefik &middot; PostgreSQL &middot; Redis &middot; NATS &middot; MinIO.
- LAN-friendly defaults so one Mac/PC can host the team for alpha testing.

## Changed
- Locale switcher is now URL-based and shareable (`/en`, `/th`, `/de`).
- Sidebar, header and admin shortcuts now use a single, professional vector icon set across the whole UI.

## Fixed
- Locale switching: the English locale is reachable from any page.
- Admin API routing: `/api/v1/admin/*` resolves through Traefik to the auth service.
- Release pipeline: only `.dmg`, `AAELink-Setup-<version>.exe` and source archives are published; intermediate build files (`*.zip`, `*.blockmap`, `latest*.yml`, `builder-*.yml`) are pruned.

---

## Default credentials

- **Admin** — `admin@aaelink.local` / `AdminAaeLink#2026` _(please change after first login)_.

## Install

### Windows 10 / 11
1. Download `AAELink-Setup-0.0.1-alpha.exe`.
2. Run the installer; choose install location.
3. Launch AAELink, set the server URL from the Help menu.

### macOS
1. Download the matching `.dmg` (`arm64` for Apple Silicon, the other for Intel).
2. Open it and drag **AAELink** into `Applications`.
3. Launch AAELink, set the server URL from the Help menu.

### Server (any Docker host)
```bash
git clone https://github.com/Dry1ceD7/AAELink.git
cd AAELink
cp .env.example .env
# edit .env, then:
task up
task migrate:up
```
Then open `http://<HOST>:18080`.

---

## Roadmap (next releases)

- Group chat, direct messages, channels.
- Approvals & workflows.
- Knowledge base / wiki.
- Calendar, leave requests, attendance.
- HR, finance and procurement integrations.
- Mobile clients (iOS, Android).
- Single sign-on with Microsoft Entra ID.

## Notes

- This is an **alpha**: data model, APIs and storage layout may change between releases.
- Do not use this build for production data yet.
- Issues and feedback: please open a GitHub issue.

## Release assets

| Asset | Platform |
|---|---|
| `AAELink-Setup-0.0.1-alpha.exe` | Windows 10 / 11 (x64) |
| `AAELink-0.0.1-alpha-arm64.dmg` | macOS, Apple Silicon |
| `AAELink-0.0.1-alpha.dmg` | macOS, Intel |
| `Source code (zip)` | Source archive |
| `Source code (tar.gz)` | Source archive |
