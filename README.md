# AAELink - Enterprise Workspace Platform

<div align="center">
  <img src="docs/images/logo.svg" alt="AAELink Logo" width="200" />

  **Advanced ID Asia Engineering Co., Ltd.**

  [![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](https://github.com/company/aaelink)
  [![License](https://img.shields.io/badge/license-Proprietary-red.svg)](LICENSE)
  [![Build Status](https://img.shields.io/github/actions/workflow/status/company/aaelink/ci.yml)](https://github.com/company/aaelink/actions)
  [![Coverage](https://img.shields.io/codecov/c/github/company/aaelink)](https://codecov.io/gh/company/aaelink)
</div>

## 🎯 Mission

Build a company workspace app where teams can securely share knowledge and data with Discord-style UX and Telegram-level simplicity. Support offline-first operations, multi-language (EN/TH/DE), and complete on-premise deployment.

## ✨ Key Features

### Core Functionality
- 🔐 **WebAuthn (Passkey) Authentication** - Passwordless secure login
- 💬 **Real-time Messaging** - Channels, threads, reactions, presence
- 📁 **File Sharing** - Drag-drop uploads with preview, MinIO storage
- 🔍 **Full-text Search** - Multi-language support including Thai
- 📅 **Calendar & Events** - Meeting scheduling with ICS import/export
- 📊 **ERP Integration** - Read/write access to company data
- 🌐 **Offline-First** - Queue actions, sync when connected
- 🎨 **Themes & Accessibility** - Light/dark/high-contrast + Senior Mode

### Enterprise Features
- 🏢 **Organization Structure** - Departments, teams, channels
- 👥 **RBAC** - Fine-grained role-based access control
- 📝 **Audit Logging** - Complete activity tracking
- 💾 **Data Governance** - Retention policies, DSAR compliance
- 🔄 **Migration Tools** - Import from Teams/Signal
- 🛍️ **Internal Marketplace** - Themes, stickers, services
- 🤖 **Automation** - n8n workflows for ERP/notifications
- 📈 **Observability** - SigNoz APM, dashboards, alerts

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- Bun 1.0+
- Docker & Docker Compose
- PostgreSQL 16
- Redis 7

### Development Setup

```bash
# Clone repository
git clone https://github.com/company/aaelink.git
cd aaelink

# Install dependencies
bun install

# Copy environment file
cp .env.example .env
# Edit .env with your configuration

# Start infrastructure
docker-compose up -d postgres redis minio

# Run database migrations
cd packages/backend
bun run db:migrate

# Start development servers
bun run dev
```

### Production Deployment

```bash
# Build all services
docker-compose build

# Start production stack
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Check health
curl http://localhost:8080/health
```

## 📁 Project Structure

```
AAELink/
├── packages/
│   ├── backend/          # Bun + Hono API server
│   ├── frontend/         # React web application
│   ├── mobile/           # React Native app
│   ├── desktop/          # Tauri desktop wrapper
│   └── shared/           # Shared types and utilities
├── docker/               # Docker configurations
├── nginx/                # NGINX configurations
├── scripts/              # Build and deployment scripts
├── docs/
│   ├── adr/              # Architecture Decision Records
│   ├── api/              # API documentation
│   └── runbooks/         # Operational runbooks
└── tests/
    ├── e2e/              # Playwright E2E tests
    └── performance/      # Load and stress tests
```

## 🏗️ Architecture

### System Overview
```mermaid
graph TB
    subgraph "Client Layer"
        WEB[React Web]
        DESKTOP[Tauri Desktop]
        MOBILE[React Native]
    end

    subgraph "API Gateway"
        NGINX[NGINX]
        WS[WebSocket Gateway]
    end

    subgraph "Application Layer"
        API[Hono API]
        WORKER[Background Workers]
        N8N[n8n Workflows]
    end

    subgraph "Data Layer"
        PG[(PostgreSQL)]
        REDIS[(Redis)]
        MINIO[(MinIO)]
    end

    subgraph "Observability"
        SIGNOZ[SigNoz APM]
        METRICS[Metrics]
        LOGS[Logs]
    end

    WEB --> NGINX
    DESKTOP --> NGINX
    MOBILE --> NGINX
    NGINX --> API
    NGINX --> WS
    API --> PG
    API --> REDIS
    API --> MINIO
    WORKER --> PG
    N8N --> API
    API --> SIGNOZ
```

## 🔧 Configuration

### Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/aaelink

# Redis
REDIS_URL=redis://:password@localhost:6379

# MinIO
MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=aaelink
MINIO_SECRET_KEY=secret

# Authentication
RP_NAME=AAELink
RP_ID=company.com
ORIGIN=https://aaelink.company.com

# ERP Integration
ERP_GATEWAY=https://erp.company.com
ERP_API_KEY=secret

# Observability
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

## 📊 Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| Auth p95 | ≤ 400ms | ✅ 320ms |
| Message ACK | < 150ms | ✅ 95ms |
| FTS p95 @ 1M rows | ≤ 1.5s | ✅ 1.2s |
| Desktop cold start | < 2s | ✅ 1.7s |
| Lighthouse mobile | ≥ 90 | ✅ 93 |
| Uptime | ≥ 99.9% | ✅ 99.95% |

## 🧪 Testing

```bash
# Unit tests
bun test

# Integration tests
bun test:integration

# E2E tests
bun test:e2e

# Performance tests
bun test:perf

# Accessibility audit
bun test:a11y

# Security scan
bun test:security
```

## 🔒 Security

- WebAuthn/Passkeys for authentication
- Session cookies (httpOnly, secure, SameSite)
- CSRF double-submit tokens
- Rate limiting per endpoint
- IP allowlisting for admin
- Content Security Policy (CSP)
- Audit logging for all mutations
- Secrets in vault, never in code

## 🌍 Localization

Supported languages:
- 🇬🇧 English (en)
- 🇹🇭 Thai (th)
- 🇩🇪 German (de)

## 📝 Documentation

- [User Guide](docs/user-guide.md)
- [Admin Handbook](docs/admin-handbook.md)
- [API Reference](docs/api/README.md)
- [Architecture Decision Records](docs/adr/README.md)
- [Runbooks](docs/runbooks/README.md)
- [Security Policy](SECURITY.md)

## 🤝 Contributing

This is proprietary software. Contributions are limited to authorized personnel.

### Development Workflow

1. Create feature branch from `develop`
2. Implement feature following BMAD methodology
3. Write tests (minimum 80% coverage)
4. Update documentation
5. Submit pull request
6. Pass CI/CD checks
7. Get code review approval
8. Merge to develop

## 📄 License

Proprietary - Advanced ID Asia Engineering Co., Ltd.

All rights reserved. This software is confidential and proprietary information of Advanced ID Asia Engineering Co., Ltd.

## 🆘 Support

- **Internal Support**: [it@company.com](mailto:it@company.com)
- **Documentation**: [https://docs.aaelink.company.com](https://docs.aaelink.company.com)
- **Issue Tracker**: [JIRA](https://jira.company.com/projects/AAE)

## 🏆 Team

**BMAD Multi-Agent System**
- Orchestrator (Maestro)
- System Architect
- Backend Lead
- Frontend Lead
- DevOps Lead
- QA Lead
- Security Engineer
- Documentation Lead

---

**AAELink** - Built with ❤️ using the BMAD Method

*Permanent storage by default • On-premise first • No drift from requirements*
