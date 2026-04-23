# AAELink

**Enterprise IT Support Portal — Advanced ID Asia Engineering**

AAELink is the internal enterprise SuperApp for AAE. It starts with an **IT Help Desk / Ticket Service** and is designed to grow into a full inter-departmental communication platform.

---

## Stack

| Layer | Technology |
|---|---|
| **Backend** | Go 1.22 + Fiber v3 (micro-services) |
| **Frontend** | Next.js 15 (App Router + RSC) + TypeScript 5 |
| **Database** | PostgreSQL 16 |
| **Cache** | Redis 7 |
| **Event Bus** | NATS 2.x + JetStream |
| **File Storage** | MinIO (S3-compatible) |
| **Reverse Proxy** | Traefik v3 |
| **Observability** | Prometheus + Grafana + Loki |
| **Email (dev)** | Mailhog |
| **Email (prod)** | Microsoft 365 SMTP |

---

## Quick Start (Windows 11 / macOS)

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) ≥ 4.x
- [Git](https://git-scm.com/)
- [Go 1.22+](https://go.dev/dl/)
- [Node.js 22+](https://nodejs.org/)
- [Task](https://taskfile.dev/) — `winget install Task.Task` / `brew install go-task`

**Windows 11 WSL2 config** — create/update `%USERPROFILE%\.wslconfig`:
```ini
[wsl2]
memory=10GB
processors=8
swap=4GB
```

### 1. Clone and configure

```bash
git clone https://github.com/Dry1ceD7/AAELink.git
cd AAELink
cp .env.example .env
# Edit .env — change passwords!
```

### 2. Start all services

```bash
task up
```

This starts: Traefik, PostgreSQL, Redis, NATS, MinIO, Mailhog, Prometheus, Grafana, Loki, and all application services.

### 3. Run migrations

```bash
task migrate:up
```

### 4. Access the app

| Service | URL |
|---|---|
| **AAELink App** | http://localhost |
| **Traefik Dashboard** | http://localhost:8080 |
| **Grafana** | http://localhost:3000 |
| **Prometheus** | http://localhost:9090 |
| **Mailhog** | http://localhost:8025 |
| **MinIO Console** | http://localhost:9001 |

---

## Development

```bash
task up           # Start all infrastructure
task down         # Stop everything
task reset        # ⚠️ Destroy all data and restart

task test         # Run all Go tests
task lint         # Run golangci-lint
task sqlc:generate  # Re-generate DB code

task psql         # Open PostgreSQL prompt
task redis        # Open Redis CLI
task logs -- auth # Tail auth service logs
```

### Hot reload (Go services)

Each service uses [Air](https://github.com/air-verse/air) for live reload:

```bash
cd services/auth && air
```

### Frontend dev server

```bash
cd frontend
npm install
npm run dev   # http://localhost:3000 (Turbopack)
```

---

## Project Structure

```
AAELink/
├── services/           # Go micro-services
│   ├── auth/           # Authentication & RBAC (port 8001)
│   ├── ticket/         # IT Help Desk core (port 8002)
│   ├── notify/         # Email / WebSocket notifications (port 8003)
│   └── media/          # File upload / MinIO proxy (port 8004)
├── frontend/           # Next.js 15 app (port 3000 behind Traefik)
├── migrations/         # golang-migrate SQL files
│   ├── auth/
│   └── ticket/
├── infra/              # Infrastructure config
│   ├── traefik/
│   ├── prometheus/
│   ├── grafana/
│   ├── loki/
│   └── promtail/
├── docs/               # Architecture decisions, runbooks, stories
└── .github/workflows/  # CI / Security / Build pipelines
```

---

## Roles

| Role | Description |
|---|---|
| `it_admin` | Full access — user management, system config |
| `it_employee` | IT staff — receive and resolve tickets |
| `employee` | All other departments — submit tickets |

Additional roles can be added via the `roles` and `permissions` tables without code changes.

---

## Languages

English (default) · ภาษาไทย · Deutsch

---

## Phase Roadmap

| Phase | Target | Description |
|---|---|---|
| **Alpha** | Local Windows 11 | IT Help Desk — tickets, users, email |
| **Alpha Shared** | QNAP NAS2New | Shared team testing |
| **Beta** | On-premises server | Production with full feature set |

---

## License

Private — Advanced ID Asia Engineering. All rights reserved.
