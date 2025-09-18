# AAELink ENTERPRISE ULTIMATE ENTERPRISE - AI-ORCHESTRATED PRD + MASTER PROMPT - PRODUCTION READY
**Version: 1.2 | Local-First Architecture | Zero Cloud Dependencies | BMAD-Orchestrated**

## PART 1: AI AGENT SUPREME ORCHESTRATION

### 1.1 Master AI Agent Capabilities & Requirements
**Core Capabilities:**
* Complete understanding of BMAD architecture, components, and principles
* Expert orchestration of unlimited sub-agents with autonomous spawning
* Deep expertise in template logic programming and semantic markup
* Comprehensive expansion pack development and customization
* Advanced character persona development and agent coordination
* Quality validation systems with automated approval frameworks
* Implementation strategies for all BMAD components and workflows

**Response Requirements:**
* Provide highly detailed, explicit, actionable guidance
* Adapt response depth to task complexity
* Include practical examples and implementation patterns
* Reference appropriate BMAD components consistently
* Suggest logical next steps and dependencies
* Maintain zero-drift from PRD principles

**Quality Enhancement Framework:**
* Learning from previous architectural decisions
* Metrics for architectural quality (latency, uptime, error rates)
* Feedback loops for continuous improvement
* Benchmarks for architectural excellence
* Dependency verification before progression

### 1.2 Supreme Control Hierarchy
**Fundamental Rule:** BMAD Method controls everything. All operations, decisions, and implementations flow through BMAD orchestration first, even when not explicitly mentioned.

**Master AI Agent Architecture**
1. **BMAD Supreme Orchestrator**
    * Primary control over all agents and sub-agents
    * Can spawn unlimited sub-agents dynamically
    * Enforces error-checking loops at each phase
    * Validates against PRD before proceeding
    * Error Gate: No progression until Problems = 0

2. **Core Agent Squadron**
    * UX/UI Builder Agent: Discord theme + Telegram simplicity (web/desktop); Telegram + LINE style (mobile)
    * Full-Stack Agent: Complete implementation across all layers
    * Security Agent: Zero-trust, E2E encryption, network isolation
    * Quality Assurance Agent: Continuous error detection and resolution
    * Infrastructure Agent: Docker, Kubernetes, deployment automation
    * Integration Agent: APIs, databases, third-party services

3. **Dynamic Sub-Agent Creation**
    * Agents autonomously spawn specialized sub-agents for:
        * Component development
        * API integration
        * Database optimization
        * Testing automation
        * Documentation generation
        * Performance tuning

### 1.3 Error-Prevention Loop Protocol
```
PHASE START → Error Scan → Problem Detection → 
IF (Problems > 0):
  → Fix Implementation → Validation → Re-scan
  → REPEAT until Problems = 0
ELSE:
  → Proceed to Next Phase
```

### 1.4 Agent Hierarchy with Sub-Agent Spawning
```
BMAD Orchestrator
├── Infrastructure Agent
│   ├── Docker Configuration Sub-Agent
│   ├── SSL Certificate Sub-Agent
│   ├── Backup Automation Sub-Agent
│   └── Monitoring Setup Sub-Agent
├── Development Agent
│   ├── Frontend Builder Sub-Agents (Web/Mobile)
│   ├── Backend Service Sub-Agents
│   ├── Database Schema Sub-Agent
│   └── API Integration Sub-Agent
├── Security & Compliance Agent
│   ├── Audit Trail Sub-Agent
│   ├── Encryption Sub-Agent
│   ├── Access Control Sub-Agent
│   └── Data Retention Sub-Agent
└── Quality Assurance Agent
    ├── Testing Automation Sub-Agents
    ├── Performance Optimizer Sub-Agent
    └── Error Detection Sub-Agent
```

## PART 2: CORE PRODUCT REQUIREMENTS

### 2.1 Mission Statement
Build a 100% local-hosted enterprise workspace for Advanced ID Asia Engineering Co., Ltd. where 200+ employees chat, share files, plan work, run meetings, access calendars and ERP4All, with senior-friendly interfaces and aggregated APIs - all without cloud dependencies.

### 2.2 Top Priority Use Cases
1. **Department Chat System**
    * Threaded replies with context preservation
    * File attachments with preview
    * Pin important messages
    * @mentions with notifications

2. **Meeting & Calendar Integration**
    * Create events with ERP4All calendar sync
    * Send invites via company email
    * Automated reminders (email/push/in-app)
    * Meeting room booking system

3. **ERP Data Access**
    * Real-time inventory lookup
    * Order status tracking
    * Timesheet submission/approval
    * Purchase requisition workflow

4. **Offline-First Architecture**
    * Queue messages/edits offline
    * Automatic sync on reconnection
    * Conflict resolution with version history
    * Local-first data storage

5. **Global Search**
    * Full-text search across messages
    * File content indexing (PDF, Office docs)
    * Task and calendar search
    * Search result caching

6. **Marketplace & Customization**
    * Theme store (dark/light/custom)
    * Sticker packs and emojis
    * Internal employee listings (no external payments)
    * Department-specific templates

7. **Aggregated Dashboard**
    * n8n workflow integration
    * MCP (Model Context Protocol) for AI
    * Multiple API aggregation
    * Real-time data visualization

## PART 3: COMPREHENSIVE UX/UI SPECIFICATIONS

### 3.1 Web/Desktop Application (Discord + Telegram Fusion)
**Complete Layout Architecture**
Three-Panel Responsive System:
* **Left Panel (312px):**
    * Workspace selector (72px width)
    * Channel/Chat list (240px width)
    * Pinned chats section (static position - new messages don't push down)
    * Search bar with filters
* **Center Panel (fluid):**
    * Message area with infinite scroll
    * Typing indicators
    * Message reactions/threads
    * File preview inline
    * Code syntax highlighting
* **Right Panel (240px, collapsible):**
    * User profile/info
    * Shared files
    * Pinned messages
    * Voice/video controls

**All Required Pages/Layouts**
1. **Authentication Pages:**
    * Login (username/email + password, passkey button, no signup link, no hints)
    * Session expired
    * Device verification

2. **Main Application Pages:**
    * Dashboard home
    * Direct messages
    * Group channels
    * Voice/Video rooms
    * File manager
    * Search results
    * Settings (user/workspace)
    * Admin dashboard (IT control panel)

3. **Advanced UI Components:**
    * Floating action buttons
    * Context menus (right-click)
    * Keyboard shortcuts overlay
    * Command palette (Ctrl+K)
    * Toast notifications
    * Modal system (nested support)
    * Drag-and-drop zones
    * Virtual scrolling for performance

### 3.2 Mobile Application (Telegram + LINE Fusion)
**Complete Mobile Architecture**
Bottom Navigation (5 tabs):
* Chats (with pinned section)
* Calls
* Teams
* Files
* Profile

**Mobile-Specific Features**
* **Chat Features:**
    * Swipe to reply/delete/pin
    * Hold for reactions
    * Voice messages with waveform
    * Sticker/GIF keyboard
    * LINE-style timeline
* **Notification System:**
    * Rich notifications with actions
    * Notification channels (urgent/normal/silent)
    * Smart grouping
    * Do not disturb scheduling

### 3.3 Cross-Platform Compatibility
**Supported Platforms:**
* Windows 10/11 (native + PWA)
* macOS 11+ (native + PWA)
* Linux (Ubuntu 20.04+, Fedora, Arch)
* Android 7+ (native app)
* iOS 14+ (native app)
* iPadOS (optimized tablet layout)
* watchOS (companion app)

## PART 4: COMPLETE TECHNICAL STACK

### 4.1 Full-Stack Architecture

**Frontend Stack**
```typescript
// Core Framework
- Next.js 15 (App Router, Server Components)
- React 18+ (Concurrent features)
- TypeScript 5.3+ (strict mode)

// State & Data
- Zustand (global state)
- TanStack Query (server state)
- Valtio (proxy state)

// UI & Styling
- Tailwind CSS 3.4
- Radix UI (headless components)
- Framer Motion (animations)
- React Spring (physics animations)

// Real-time & Communication
- Socket.io-client
- WebRTC (SimpleWebRTC)
- EventSource (SSE)

// Mobile & Desktop
- React Native (Expo managed)
- Tauri 2.0 (desktop wrapper)
- Capacitor (alternative mobile)
```

**Backend Stack**
```typescript
// Runtime & Framework
- Node.js 20 LTS
- Bun (performance-critical services)
- Fastify (primary API)
- tRPC (type-safe APIs)
- GraphQL (Apollo Server 4)

// Database Layer
- PostgreSQL 16 (primary)
- TimescaleDB (time-series)
- Redis Stack (cache + queues)
- Elasticsearch (full-text search)

// File Storage
- MinIO (S3-compatible)
- Sharp (image processing)
- FFmpeg (video processing)

// Authentication
- Passport.js (strategies)
- Jose (JWT)
- Argon2 (password hashing)
- WebAuthn (passkeys)

// Real-time
- Socket.io (WebSocket)
- BullMQ (job queues)
- EventEmitter3 (events)
```

**Infrastructure Stack**
```yaml
# Container & Orchestration
- Docker 24+
- Docker Compose (development)
- Kubernetes 1.28+ (production)
- Helm 3 (package management)

# Networking
- Nginx (reverse proxy)
- Traefik (ingress)
- Cloudflare Tunnel (secure exposure)

# Monitoring & Logging
- Prometheus
- Grafana
- Loki (logs)
- Sentry (error tracking)

# Security
- Trivy (vulnerability scanning)
- OWASP ZAP (security testing)
- HashiCorp Vault (secrets)
```

## PART 5: IT ADMINISTRATOR DASHBOARD

### 5.1 Admin Control Panel Features
1. **User Management:**
    * Create/provision users (no self-signup)
    * Assign roles and permissions
    * Bulk import from ERP
    * Password reset without hints
    * Device management

2. **System Monitoring:**
    * Real-time metrics dashboard
    * Service health status
    * Performance analytics
    * Error rate tracking
    * Resource utilization

3. **Security Controls:**
    * Access logs with filtering
    * Failed login attempts
    * IP whitelist/blacklist
    * Rate limit configuration
    * Encryption key rotation

4. **Content Management:**
    * Message audit trails
    * File storage quotas
    * Retention policies
    * Compliance reports
    * Data export tools

5. **Integration Management:**
    * API key generation
    * Webhook configuration
    * ERP sync status
    * Calendar integration
    * SSO settings

## PART 6: ENTERPRISE FEATURES & INNOVATIONS

### 6.1 Core Enterprise Requirements
1. **Authentication & Security:**
    * Admin-provisioned accounts only (no public signup)
    * Username/email + password
    * Optional passkey authentication
    * No password hints or recovery questions
    * Session management with device tracking

2. **Chat System Essentials:**
    * Pinned chats (fixed position, unaffected by new messages)
    * Thread conversations
    * Message editing/deletion with history
    * Read receipts and typing indicators
    * Presence status (online/away/busy/offline)
    * Message search with filters

3. **File Management:**
    * Drag-and-drop upload
    * Progress indicators
    * Resume interrupted uploads
    * Version control
    * Preview for 50+ file types
    * Virus scanning integration

4. **Network Isolation:**
    * VLAN segmentation support
    * Private network deployment
    * Air-gapped operation mode
    * Proxy configuration
    * Custom DNS settings

### 6.2 Innovative Enhancements
1. **AI-Powered Features:**
    * Smart message summarization
    * Auto-translation (100+ languages)
    * Meeting transcription
    * Sentiment analysis
    * Predictive text

2. **Advanced Collaboration:**
    * Shared whiteboards
    * Screen annotation
    * Co-browsing
    * Document collaboration
    * Task management integration

3. **Enterprise Compliance:**
    * Audit logging (immutable)
    * Data residency controls
    * Legal hold capabilities
    * GDPR/CCPA tools
    * Export for e-discovery

## PART 7: BMAD METHOD EXECUTION PROTOCOL

### 7.1 Phase-by-Phase Implementation
**Phase 1: BREAK (Analysis)**
```
Input: Requirements → Output: Detailed Plan
- Parse all requirements
- Identify dependencies
- Create component map
- Define API contracts
- Error check: Validate completeness
```

**Phase 2: MAKE (Build)**
```
Input: Plan → Output: Implementation
- Generate code via AI agents
- Build all components
- Integrate services
- Create tests
- Error check: Compilation and linting
```

**Phase 3: ASSESS (Validate)**
```
Input: Implementation → Output: Quality Report
- Run all tests
- Security scanning
- Performance testing
- Accessibility audit
- Error check: All tests must pass
```

**Phase 4: DELIVER (Deploy)**
```
Input: Validated Build → Output: Deployable Artifact
- Build containers
- Generate manifests
- Prepare documentation
- Create rollback plan
- Error check: Deployment simulation
```

### 7.2 Error Resolution Loop
```python
while problems_exist():
    problems = detect_all_problems()
    for problem in problems:
        solution = ai_agent.generate_fix(problem)
        apply_fix(solution)
        validate_fix()
    if problems_exist():
        continue
    else:
        proceed_to_next_phase()
```

## PART 8: INFRASTRUCTURE & DEPLOYMENT

### 8.1 Local Server Requirements (finished product deployment)
**Hardware Specifications:**
```
Production Server:
  CPU: Intel Xeon E5-2680 v4 or AMD EPYC 7302 (minimum 16 cores)
  RAM: 64GB DDR4 ECC
  Storage:
    - OS: 256GB NVMe SSD
    - Database: 2TB NVMe SSD (RAID 1)
    - File Storage: 10TB HDD (RAID 6)
  Network: Dual 10Gbps NICs (bonded)
  Backup: Dedicated NAS (20TB minimum)
```

### 8.2 Automated Backup System
**Backup Architecture:**
```yaml
# Continuous Data Protection
- Real-time database replication (streaming)
- Hourly file system snapshots
- Daily full backups to NAS
- Weekly offsite backup to tape

# Retention Policy
- Messages: Permanent (unless admin-deleted)
- Files: Permanent with versioning
- Logs: 1 year rolling
- Audit trails: 7 years (compliance)

# Recovery Objectives
- RPO: < 1 hour
- RTO: < 2 hours
- Automated failover: < 5 minutes
```

### 8.3 SSL Certificate Management
**Enterprise PKI Implementation:**
```
Certificate Authority:
  Root CA: Internal AAE Root Certificate
  Intermediate CA: Department-specific CAs
  
Certificate Types:
  - Server certificates (wildcard *.aae.local)
  - Client certificates (per device)
  - Code signing certificates
  
Automation:
  - Auto-renewal 30 days before expiry
  - Certificate rotation without downtime
  - HSM integration for key storage
  - ACME protocol for internal CA
```

## PART 9: MONITORING & PERFORMANCE

### 9.1 Prometheus/Grafana Configuration
**Metrics Collection (200+ Users):**
```
Prometheus Targets:
  - Application metrics (custom exporters)
  - Database metrics (postgres_exporter)
  - Redis metrics (redis_exporter)
  - Node metrics (node_exporter)
  - Container metrics (cAdvisor)

Key Dashboards:
  - User Activity (concurrent users, message rate)
  - System Performance (CPU, memory, disk I/O)
  - Database Performance (query time, connections)
  - API Performance (request rate, latency)
  - Error Tracking (5xx errors, failed jobs)

Alerting Rules:
  - CPU usage > 80% for 5 minutes
  - Memory usage > 90%
  - Disk space < 20%
  - Database connections > 180
  - API response time > 500ms (p95)
  - Error rate > 1%
```

### 9.2 Performance Optimization
**Optimization Targets:**
```
Message Delivery:
  - Latency: < 50ms (local network)
  - Throughput: 10,000 msg/sec
  - Concurrent connections: 500+

File Operations:
  - Upload speed: 100MB/s (LAN)
  - Preview generation: < 2 seconds
  - Thumbnail cache: 100% hit rate

Database:
  - Query response: < 10ms (p95)
  - Connection pool: 200 connections
  - Index coverage: > 95%

Frontend:
  - Initial load: < 2 seconds
  - Route transition: < 200ms
  - Memory usage: < 150MB
```

## PART 10: AUDIT & COMPLIANCE

### 10.1 Audit Trail System
**Comprehensive Logging:**
```typescript
interface AuditLog {
  id: string;
  timestamp: Date;
  userId: string;
  action: AuditAction;
  resource: string;
  details: object;
  ipAddress: string;
  userAgent: string;
  sessionId: string;
  result: 'success' | 'failure';
}

enum AuditAction {
  // Authentication
  LOGIN = 'auth.login',
  LOGOUT = 'auth.logout',
  PASSWORD_CHANGE = 'auth.password.change',
  
  // Messages
  MESSAGE_SEND = 'message.send',
  MESSAGE_EDIT = 'message.edit',
  MESSAGE_DELETE = 'message.delete',
  
  // Files
  FILE_UPLOAD = 'file.upload',
  FILE_DOWNLOAD = 'file.download',
  FILE_DELETE = 'file.delete',
  
  // Admin
  USER_CREATE = 'admin.user.create',
  USER_MODIFY = 'admin.user.modify',
  PERMISSION_CHANGE = 'admin.permission.change',
  
  // Data Access
  ERP_QUERY = 'erp.query',
  REPORT_GENERATE = 'report.generate',
  DATA_EXPORT = 'data.export',
}
```

### 10.2 Compliance Features
**Regulatory Compliance:**
* Data residency (100% on-premises)
* Right to erasure (admin-controlled)
* Access logs retention (7 years)
* Encryption at rest (AES-256)
* Encryption in transit (TLS 1.3)
* Role-based access control
* Data classification system
* Regular compliance reports

## PART 11: INTEGRATION REQUIREMENTS

### 11.1 ERP4All Integration
```typescript
// ERP Integration Service
class ERP4AllConnector {
  // Inventory Management
  async getInventory(filters: InventoryFilter): Promise<InventoryItem[]>
  async updateStock(itemId: string, quantity: number): Promise<void>
  
  // Order Management  
  async getOrders(status?: OrderStatus): Promise<Order[]>
  async createOrder(order: OrderRequest): Promise<Order>
  
  // Timesheet Management
  async submitTimesheet(data: TimesheetEntry): Promise<void>
  async getTimesheets(userId: string, period: DateRange): Promise<Timesheet[]>
  
  // Calendar Sync
  async syncCalendar(userId: string): Promise<CalendarEvent[]>
  async createMeeting(meeting: MeetingRequest): Promise<CalendarEvent>
}
```

### 11.2 API Aggregation via n8n/MCP
**Workflow Examples:**
```
Daily Report Workflow:
  Triggers:
    - Cron: "0 9 * * *" (9 AM daily)
  Actions:
    - Fetch ERP data (sales, inventory)
    - Query attendance system
    - Aggregate project status
    - Generate report
    - Send to department heads

Real-time Notifications:
  Triggers:
    - Webhook from ERP
    - Database changes
  Actions:
    - Process event
    - Route to appropriate users
    - Send notifications (push/email/in-app)
```

---

## ORCHESTRATOR FINAL COMMAND

**SYSTEM // AAELink BMAD Supreme Orchestrator**

You are the master orchestrator implementing a 100% local-hosted enterprise workspace.

**CRITICAL REQUIREMENTS:**
- Zero cloud dependencies (everything on-premises)
- Support 200+ concurrent users
- Permanent data retention (admin-controlled deletion only)
- Automated backup system with tape archival
- SSL certificate management with internal PKI
- Full ERP4All integration
- Prometheus/Grafana monitoring
- Complete audit trails (7-year retention)

**EXECUTION PROTOCOL:**
1. Every action through BMAD method
2. Spawn specialized sub-agents as needed
3. Zero-error tolerance at each phase
4. Continuous validation loops

**DELIVERABLES:**
- Lightweight, fast, secure platform
- Docker development environment
- Production deployment scripts
- Complete documentation
- Performance optimization
- Permanent storage architecture

**Output: PHASE → AGENTS → IMPLEMENTATION → VALIDATION → DEPLOYMENT**

**Extra:** Push to Github only production, do not push with demo+test+AI agents related+development. Always update readme.md, after end of phase or steps, pause everything and push to Github, if fail fix any necessary to make push work successfully before going to next phase or steps.
