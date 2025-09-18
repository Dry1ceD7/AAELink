# AAELink Enterprise v1.2

**Advanced ID Asia Engineering Co.,Ltd - Enterprise Workspace Platform**

[![Version](https://img.shields.io/badge/version-1.2.0-blue.svg)](https://github.com/Dry1ceD7/AAELink)
[![License](https://img.shields.io/badge/license-Proprietary-red.svg)](https://github.com/Dry1ceD7/AAELink)
[![Architecture](https://img.shields.io/badge/architecture-Local--First-green.svg)](https://github.com/Dry1ceD7/AAELink)
[![Cloud](https://img.shields.io/badge/cloud-Zero%20Dependencies-orange.svg)](https://github.com/Dry1ceD7/AAELink)

## 🚀 Overview

AAELink Enterprise is a comprehensive, local-first workspace platform designed exclusively for Advanced ID Asia Engineering Co.,Ltd. Built with zero cloud dependencies, it provides a secure, high-performance environment for 200+ concurrent users.

## ✨ Key Features

### 🎨 **Discord + Telegram UI Fusion**
- **Web/Desktop**: Discord-inspired interface with three-panel layout
- **Mobile**: Telegram + LINE style with bottom navigation
- **Cross-Platform**: Windows, macOS, Linux, Android, iOS, iPadOS, watchOS

### 💬 **Advanced Chat System**
- Threaded conversations with context preservation
- File attachments with preview (50+ file types)
- Pinned messages (fixed position)
- @mentions with notifications
- Message editing/deletion with history
- Read receipts and typing indicators
- Presence status (online/away/busy/offline)

### 📁 **Enterprise File Management**
- Drag-and-drop upload with progress indicators
- Resume interrupted uploads
- Version control and conflict resolution
- Virus scanning integration
- Full-text search across file contents

### 🔒 **Zero-Trust Security**
- Admin-provisioned accounts only (no public signup)
- Username/email + password authentication
- Optional WebAuthn passkey support
- End-to-end encryption for messages
- Network isolation and VLAN support
- Complete audit trails (7-year retention)

### 📊 **Real-time Monitoring**
- Prometheus metrics collection
- Grafana dashboards
- Performance optimization
- Error tracking and alerting
- Resource utilization monitoring

### 🔄 **ERP4All Integration**
- Real-time inventory lookup
- Order status tracking
- Timesheet submission/approval
- Purchase requisition workflow
- Calendar synchronization

## 🏗️ Architecture

### **Frontend Stack**
- **Framework**: Next.js 15 (App Router, Server Components)
- **UI**: React 18+ with TypeScript 5.3+
- **State**: Zustand + TanStack Query + Valtio
- **Styling**: Tailwind CSS 3.4 + Radix UI + Framer Motion
- **Real-time**: Socket.io-client + WebRTC + EventSource
- **Mobile**: React Native (Expo) + Tauri 2.0

### **Backend Stack**
- **Runtime**: Node.js 20 LTS + Bun
- **Framework**: Fastify + tRPC + GraphQL (Apollo Server 4)
- **Database**: PostgreSQL 16 + TimescaleDB + Redis Stack + Elasticsearch
- **Storage**: MinIO (S3-compatible) + Sharp + FFmpeg
- **Auth**: Passport.js + Jose (JWT) + Argon2 + WebAuthn
- **Real-time**: Socket.io + BullMQ + EventEmitter3

### **Infrastructure Stack**
- **Containers**: Docker 24+ + Kubernetes 1.28+ + Helm 3
- **Networking**: Nginx + Traefik + Cloudflare Tunnel
- **Monitoring**: Prometheus + Grafana + Loki + Sentry
- **Security**: Trivy + OWASP ZAP + HashiCorp Vault

## 🚀 Quick Start

### Prerequisites
- Node.js 20 LTS or higher
- Docker 24+ and Docker Compose
- 16GB RAM minimum (64GB recommended for production)
- 2TB SSD storage minimum

### Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/Dry1ceD7/AAELink.git
   cd AAELink
   ```

2. **Start the infrastructure**
   ```bash
   docker-compose -f docker-compose.enterprise.yml up -d
   ```

3. **Install frontend dependencies**
   ```bash
   cd aaelink-enterprise-frontend
   npm install
   ```

4. **Start the development server**
   ```bash
   npm run dev
   ```

5. **Access the application**
   - Frontend: http://localhost:3000
   - Grafana: http://localhost:3001
   - MinIO Console: http://localhost:9001

### Default Credentials
- **Username**: `admin` or `admin@aae.co.th`
- **Password**: `12345678`

## 📱 Supported Platforms

| Platform | Status | Notes |
|----------|--------|-------|
| Windows 10/11 | ✅ Native + PWA | Full desktop experience |
| macOS 11+ | ✅ Native + PWA | Optimized for Apple ecosystem |
| Linux (Ubuntu 20.04+) | ✅ Native + PWA | Full compatibility |
| Android 7+ | ✅ Native App | Telegram + LINE UI |
| iOS 14+ | ✅ Native App | Optimized for iPhone |
| iPadOS | ✅ Native App | Tablet-optimized layout |
| watchOS | ✅ Companion App | Notifications and quick actions |

## 🔧 Configuration

### Environment Variables
```bash
# Database
DATABASE_URL=postgresql://aaelink:aaelink_secure_2024@localhost:5432/aaelink
DB_PASSWORD=aaelink_secure_2024
REPL_PASSWORD=aaelink_repl_2024

# Redis
REDIS_URL=redis://localhost:6379

# MinIO
MINIO_USER=aaelink_admin
MINIO_PASSWORD=aaelink_minio_2024

# Elasticsearch
ELASTIC_PASSWORD=aaelink_elastic_2024

# Monitoring
GRAFANA_PASSWORD=aaelink_grafana_2024

# Workflow Automation
N8N_USER=aaelink_admin
N8N_PASSWORD=aaelink_n8n_2024
```

## 📊 Performance Targets

- **Message Delivery**: < 50ms latency, 10,000 msg/sec throughput
- **File Operations**: 100MB/s upload speed, < 2s preview generation
- **Database**: < 10ms query response (p95), 200 connection pool
- **Frontend**: < 2s initial load, < 200ms route transitions
- **Concurrent Users**: 500+ simultaneous connections

## 🔒 Security Features

- **Data Residency**: 100% on-premises (zero cloud dependencies)
- **Encryption**: AES-256 at rest, TLS 1.3 in transit
- **Access Control**: Role-based with granular permissions
- **Audit Logging**: Immutable logs with 7-year retention
- **Compliance**: GDPR, CCPA, PDPA (Thai), ISO 27001, SOC 2 Type II

## 📈 Monitoring & Observability

- **Metrics**: Prometheus with custom exporters
- **Dashboards**: Grafana with real-time visualizations
- **Logging**: Structured logging with Loki
- **Tracing**: Distributed tracing with OpenTelemetry
- **Alerting**: Intelligent alerting with escalation policies

## 🤝 Contributing

This is a proprietary platform for Advanced ID Asia Engineering Co.,Ltd. All development is internal and follows strict security protocols.

## 📄 License

Proprietary - Advanced ID Asia Engineering Co.,Ltd. All rights reserved.

## 🆘 Support

For technical support and issues, contact the internal IT team at Advanced ID Asia Engineering Co.,Ltd.

---

**Built with ❤️ by Advanced ID Asia Engineering Co.,Ltd**

*Version 1.2.0 | Local-First Architecture | Zero Cloud Dependencies*