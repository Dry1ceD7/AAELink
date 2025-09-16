# AAELink Enterprise Workspace Platform

## 🚀 Overview

AAELink is a comprehensive enterprise workspace platform built with modern technologies and designed for scalability, security, and user experience. The platform provides real-time collaboration, file sharing, calendar management, ERP integration, and advanced administrative capabilities.

## 📋 Table of Contents

- [Features](#features)
- [Technology Stack](#technology-stack)
- [Architecture](#architecture)
- [Installation](#installation)
- [Configuration](#configuration)
- [API Documentation](#api-documentation)
- [Deployment](#deployment)
- [Security](#security)
- [Monitoring](#monitoring)
- [Contributing](#contributing)
- [License](#license)

## ✨ Features

### Core Features
- **Real-time Messaging**: WebSocket-based chat with offline support
- **File Sharing**: Secure file upload and sharing with MinIO
- **Calendar & Events**: Full CRUD operations with recurring events
- **ERP Integration**: n8n workflow automation for data synchronization
- **Advanced Search**: Global full-text search across all content
- **Multi-language Support**: English, Thai, and German localization
- **Theme System**: Light, dark, and high-contrast themes
- **Accessibility**: WCAG AA compliance with Senior Mode

### Enterprise Features
- **Admin Console**: System monitoring and user management
- **Security Hardening**: Audit logging, rate limiting, and compliance
- **Performance Monitoring**: Real-time metrics and alerting
- **Offline-First**: Service workers and IndexedDB for offline support
- **Scalability**: Auto-scaling with Kubernetes and load balancing
- **High Availability**: Multi-region deployment support

## 🛠 Technology Stack

### Backend
- **Runtime**: Bun 1.0.0
- **Framework**: Hono (lightweight web framework)
- **Database**: PostgreSQL 16 with Drizzle ORM
- **Cache**: Redis 7
- **File Storage**: MinIO (S3-compatible)
- **Authentication**: WebAuthn (passkeys) + JWT
- **Real-time**: WebSocket with Bun native support
- **Automation**: n8n workflow engine

### Frontend
- **Framework**: React 18 with TypeScript
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **Internationalization**: i18next
- **PWA**: Service Workers and offline support
- **Testing**: Vitest, Playwright, React Testing Library

### Infrastructure
- **Containerization**: Docker + Docker Compose
- **Orchestration**: Kubernetes with Helm
- **Reverse Proxy**: NGINX with SSL termination
- **Monitoring**: SigNoz APM
- **CI/CD**: GitHub Actions
- **Load Testing**: K6

## 🏗 Architecture

### System Architecture
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend       │    │   Database      │
│   (React)       │◄──►│   (Bun + Hono)  │◄──►│   (PostgreSQL)  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   NGINX         │    │   Redis         │    │   MinIO         │
│   (Reverse      │    │   (Cache)       │    │   (File Storage)│
│    Proxy)       │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Microservices Architecture
- **API Gateway**: NGINX with rate limiting and SSL
- **Authentication Service**: WebAuthn + JWT management
- **Messaging Service**: Real-time WebSocket communication
- **File Service**: MinIO integration with security validation
- **Calendar Service**: Event management and scheduling
- **Search Service**: Full-text search with PostgreSQL FTS
- **Admin Service**: System monitoring and management
- **ERP Service**: n8n workflow integration

## 🚀 Installation

### Prerequisites
- Bun 1.0.0+
- Node.js 20+
- PostgreSQL 16+
- Redis 7+
- MinIO (optional for development)

### Development Setup

1. **Clone the repository**
```bash
git clone https://github.com/Dry1ceD7/AAELink.git
cd AAELink
```

2. **Install dependencies**
```bash
# Install root dependencies
bun install

# Install backend dependencies
cd packages/backend
bun install

# Install frontend dependencies
cd ../frontend
bun install
```

3. **Set up environment variables**
```bash
# Backend environment
cp packages/backend/.env.example packages/backend/.env
# Edit packages/backend/.env with your configuration

# Frontend environment
cp packages/frontend/.env.example packages/frontend/.env
# Edit packages/frontend/.env with your configuration
```

4. **Start the development servers**
```bash
# Terminal 1: Backend
cd packages/backend
bun run dev

# Terminal 2: Frontend
cd packages/frontend
bun run dev
```

5. **Access the application**
- Frontend: http://localhost:5174
- Backend API: http://localhost:3001/api
- Health Check: http://localhost:3001/health

### Production Setup

#### Docker Compose
```bash
# Production deployment
./scripts/deploy.sh production docker
```

#### Kubernetes
```bash
# Kubernetes deployment
./scripts/deploy.sh production kubernetes
```

## ⚙️ Configuration

### Environment Variables

#### Backend (.env)
```env
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://user:password@localhost:5432/aaelink
REDIS_URL=redis://localhost:6379
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin123
JWT_SECRET=your_jwt_secret_key_here
CSRF_SECRET=your_csrf_secret_key_here
N8N_URL=http://localhost:5678
```

#### Frontend (.env)
```env
VITE_API_URL=http://localhost:3001/api
VITE_WS_URL=ws://localhost:3001
```

### Database Configuration
```sql
-- Create database
CREATE DATABASE aaelink;

-- Create user
CREATE USER aaelink WITH PASSWORD 'secure_password_123';
GRANT ALL PRIVILEGES ON DATABASE aaelink TO aaelink;
```

## 📚 API Documentation

### Authentication Endpoints
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/auth/session` - Get current session
- `POST /api/auth/register` - User registration
- `POST /api/auth/webauthn/register` - WebAuthn registration
- `POST /api/auth/webauthn/authenticate` - WebAuthn authentication

### Messaging Endpoints
- `GET /api/messages/:channelId` - Get channel messages
- `POST /api/messages` - Send message
- `PUT /api/messages/:id` - Update message
- `DELETE /api/messages/:id` - Delete message
- `POST /api/messages/:id/reactions` - Add reaction

### File Management Endpoints
- `POST /api/files/upload` - Upload file
- `GET /api/files/:id` - Download file
- `DELETE /api/files/:id` - Delete file
- `GET /api/files` - List user files

### Calendar Endpoints
- `GET /api/calendar/events` - Get events
- `POST /api/calendar/events` - Create event
- `PUT /api/calendar/events/:id` - Update event
- `DELETE /api/calendar/events/:id` - Delete event
- `GET /api/calendar/upcoming` - Get upcoming events

### Search Endpoints
- `GET /api/search` - Global search
- `GET /api/search/suggestions` - Search suggestions

### Admin Endpoints
- `GET /api/admin/stats` - System statistics
- `GET /api/admin/users` - User management
- `POST /api/admin/users` - Create user
- `PUT /api/admin/users/:id` - Update user
- `DELETE /api/admin/users/:id` - Delete user

### Security Endpoints
- `GET /api/security/audit-logs` - Get audit logs
- `GET /api/security/events` - Get security events
- `GET /api/security/stats` - Security statistics
- `POST /api/security/validate-password` - Validate password
- `POST /api/security/validate-file` - Validate file

## 🚀 Deployment

### Docker Deployment
```bash
# Development
docker-compose -f docker-compose.dev.yml up -d

# Production
docker-compose -f docker-compose.prod.yml up -d
```

### Kubernetes Deployment
```bash
# Apply all manifests
kubectl apply -f k8s/

# Check deployment status
kubectl get all -n aaelink
```

### Environment-Specific Configurations

#### Development
- Hot reloading enabled
- Debug logging
- Mock services for external dependencies
- CORS enabled for localhost

#### Production
- SSL/TLS encryption
- Rate limiting enabled
- Security headers
- Performance monitoring
- Auto-scaling enabled

## 🔒 Security

### Authentication & Authorization
- **WebAuthn Passkeys**: FIDO2/WebAuthn standard for passwordless authentication
- **JWT Tokens**: Secure session management with refresh tokens
- **Role-Based Access Control**: Granular permissions system
- **Multi-Factor Authentication**: Optional 2FA support

### Data Protection
- **Encryption at Rest**: Database and file storage encryption
- **Encryption in Transit**: TLS 1.3 for all communications
- **Secure Headers**: CSP, HSTS, XSS protection
- **Input Validation**: Comprehensive input sanitization

### Compliance
- **GDPR Ready**: Data protection and privacy controls
- **Audit Logging**: Complete audit trail for all actions
- **Data Retention**: Configurable retention policies
- **Right to be Forgotten**: User data deletion capabilities

### Security Monitoring
- **Real-time Alerts**: Security event monitoring
- **Rate Limiting**: API protection against abuse
- **IP Whitelisting**: Network access controls
- **Vulnerability Scanning**: Automated security assessments

## 📊 Monitoring

### Performance Metrics
- **Response Times**: API endpoint performance
- **Throughput**: Requests per second
- **Error Rates**: Application error monitoring
- **Resource Usage**: CPU, memory, and disk utilization

### Business Metrics
- **User Activity**: Active users and engagement
- **Feature Usage**: Most used features and workflows
- **System Health**: Overall platform health status
- **SLA Monitoring**: Service level agreement compliance

### Alerting
- **Performance Alerts**: High response times, error rates
- **Security Alerts**: Suspicious activities, failed logins
- **System Alerts**: Resource exhaustion, service failures
- **Business Alerts**: SLA violations, user experience issues

## 🧪 Testing

### Test Coverage
- **Unit Tests**: 90%+ code coverage
- **Integration Tests**: API endpoint testing
- **E2E Tests**: Full user journey testing
- **Load Tests**: Performance under load
- **Security Tests**: Vulnerability assessments

### Running Tests
```bash
# Backend tests
cd packages/backend
bun test

# Frontend tests
cd packages/frontend
bun test

# E2E tests
bunx playwright test

# Load tests
k6 run scripts/load-test.js
```

## 🤝 Contributing

### Development Workflow
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run the test suite
6. Submit a pull request

### Code Standards
- **TypeScript**: Strict mode enabled
- **ESLint**: Code quality enforcement
- **Prettier**: Code formatting
- **Conventional Commits**: Standardized commit messages

### Pull Request Process
1. All tests must pass
2. Code coverage must be maintained
3. Security scan must pass
4. Documentation must be updated
5. Review and approval required

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

### Documentation
- [API Documentation](docs/api.md)
- [Deployment Guide](docs/deployment.md)
- [Security Guide](docs/security.md)
- [Troubleshooting](docs/troubleshooting.md)

### Community
- [GitHub Issues](https://github.com/Dry1ceD7/AAELink/issues)
- [Discussions](https://github.com/Dry1ceD7/AAELink/discussions)
- [Wiki](https://github.com/Dry1ceD7/AAELink/wiki)

### Enterprise Support
For enterprise support and custom implementations, please contact the development team.

---

**AAELink Enterprise Workspace Platform** - Built with ❤️ for modern enterprises
