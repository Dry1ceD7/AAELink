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

## 🚀 Installation & Deployment

### Prerequisites

#### **System Requirements**
- **OS**: Windows 10/11, macOS 11+, Ubuntu 20.04+ (64-bit)
- **RAM**: 16GB minimum (64GB recommended for production)
- **Storage**: 2TB SSD minimum (10TB recommended for production)
- **CPU**: 8 cores minimum (32 cores recommended for production)
- **Network**: Gigabit Ethernet with VLAN support

#### **Software Dependencies**
- **Node.js**: 20 LTS or higher
- **Docker**: 24+ and Docker Compose
- **Git**: Latest version
- **PostgreSQL**: 16+ (if not using Docker)
- **Redis**: 7+ (if not using Docker)

### 🏗️ Production Deployment

#### **1. Clone Repository**
```bash
git clone https://github.com/Dry1ceD7/AAELink.git
cd AAELink
```

#### **2. Environment Configuration**
```bash
# Copy environment template
cp .env.example .env

# Edit environment variables
nano .env
```

**Required Environment Variables:**
```bash
# Database Configuration
DATABASE_URL=postgresql://aaelink:aaelink_secure_2024@localhost:5432/aaelink
DB_PASSWORD=aaelink_secure_2024
REPL_PASSWORD=aaelink_repl_2024

# Redis Configuration
REDIS_URL=redis://localhost:6379

# MinIO Storage
MINIO_USER=aaelink_admin
MINIO_PASSWORD=aaelink_minio_2024

# Elasticsearch
ELASTIC_PASSWORD=aaelink_elastic_2024

# Monitoring
GRAFANA_PASSWORD=aaelink_grafana_2024

# Workflow Automation
N8N_USER=aaelink_admin
N8N_PASSWORD=aaelink_n8n_2024

# Security
JWT_SECRET=your-super-secure-jwt-secret-key-here
ENCRYPTION_KEY=your-32-character-encryption-key

# API Configuration
API_BASE_URL=http://localhost:3001
WS_URL=http://localhost:3001
```

#### **3. Infrastructure Setup**
```bash
# Start all services with Docker Compose
docker-compose -f docker-compose.enterprise.yml up -d

# Verify all services are running
docker-compose ps
```

#### **4. Database Initialization**
```bash
# Run database migrations
cd aaelink-backend
npm run db:migrate

# Seed initial data (optional)
npm run db:seed
```

#### **5. Build Applications**
```bash
# Build backend
cd aaelink-backend
npm install
npm run build

# Build enterprise backend
cd ../aaelink-enterprise-backend
npm install
npm run build

# Build enterprise frontend
cd ../aaelink-enterprise-frontend
npm install
npm run build

# Build packages frontend
cd ../packages/frontend
npm install
npm run build
```

#### **6. Start Production Services**
```bash
# Start backend services
cd aaelink-backend
npm start &

cd ../aaelink-enterprise-backend
npm start &

# Start frontend (served by Next.js)
cd ../aaelink-enterprise-frontend
npm start
```

### 🐳 Docker Deployment

#### **Single Container Deployment**
```bash
# Build production image
docker build -t aaelink-enterprise:latest .

# Run container
docker run -d \
  --name aaelink-enterprise \
  -p 3000:3000 \
  -p 3001:3001 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/db \
  -e REDIS_URL=redis://host:6379 \
  aaelink-enterprise:latest
```

#### **Kubernetes Deployment**
```bash
# Apply Kubernetes manifests
kubectl apply -f k8s/

# Check deployment status
kubectl get pods
kubectl get services
```

### 🔧 Development Setup

#### **1. Clone and Install**
```bash
git clone https://github.com/Dry1ceD7/AAELink.git
cd AAELink

# Install root dependencies
npm install

# Install workspace dependencies
npm run install:all
```

#### **2. Start Development Environment**
```bash
# Start infrastructure
docker-compose -f docker-compose.dev.yml up -d

# Start all services in development mode
npm run dev
```

#### **3. Access Development Environment**
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001
- **Grafana**: http://localhost:3001/grafana
- **MinIO Console**: http://localhost:9001
- **Database Admin**: http://localhost:8080

### 🔐 Default Credentials

#### **Application Access**
- **Username**: `admin` or `admin@aae.co.th`
- **Password**: `12345678`

#### **Service Access**
- **Grafana**: admin / `aaelink_grafana_2024`
- **MinIO**: `aaelink_admin` / `aaelink_minio_2024`
- **PostgreSQL**: aaelink / `aaelink_secure_2024`
- **Redis**: (no password by default)
- **Elasticsearch**: elastic / `aaelink_elastic_2024`

### 🚀 Quick Start Commands

```bash
# Full production deployment
git clone https://github.com/Dry1ceD7/AAELink.git
cd AAELink
cp .env.example .env
# Edit .env with your configuration
docker-compose -f docker-compose.enterprise.yml up -d
npm run build:all
npm run start:all

# Development setup
git clone https://github.com/Dry1ceD7/AAELink.git
cd AAELink
npm install
npm run install:all
docker-compose -f docker-compose.dev.yml up -d
npm run dev
```

### 📊 Health Checks

```bash
# Check application health
curl http://localhost:3000/api/health

# Check backend health
curl http://localhost:3001/api/health

# Check database connectivity
curl http://localhost:3001/api/db/health

# Check Redis connectivity
curl http://localhost:3001/api/redis/health
```

### 🔧 Troubleshooting

#### **Common Issues**

**1. Port Already in Use**
```bash
# Find process using port
lsof -i :3000
lsof -i :3001

# Kill process
kill -9 <PID>
```

**2. Database Connection Failed**
```bash
# Check PostgreSQL status
docker-compose ps postgres

# Restart database
docker-compose restart postgres

# Check logs
docker-compose logs postgres
```

**3. Build Failures**
```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Clear Next.js cache
rm -rf .next
npm run build
```

**4. Memory Issues**
```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=4096"
npm start
```

#### **Logs and Debugging**

```bash
# View all logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f aaelink-backend
docker-compose logs -f aaelink-enterprise-frontend

# Check system resources
docker stats
```

### 🔄 Maintenance

#### **Regular Maintenance Tasks**

**Daily:**
- Monitor system resources and performance
- Check application logs for errors
- Verify backup completion

**Weekly:**
- Review security logs
- Update dependencies (if needed)
- Clean up old log files

**Monthly:**
- Full system backup
- Security audit
- Performance optimization review

#### **Backup and Recovery**

```bash
# Database backup
pg_dump -h localhost -U aaelink aaelink > backup_$(date +%Y%m%d).sql

# File storage backup
docker exec minio mc mirror /data /backup/$(date +%Y%m%d)

# Full system backup
tar -czf aaelink_backup_$(date +%Y%m%d).tar.gz /opt/aaelink/
```

#### **Updates and Upgrades**

```bash
# Pull latest changes
git pull origin main

# Rebuild and restart
npm run build:all
docker-compose restart

# Verify deployment
npm run health:check
```

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