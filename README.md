# AAELink - Enterprise Workspace Platform

<div align="center">
  <img src="https://img.shields.io/badge/Version-1.1.0-blue.svg" alt="Version" />
  <img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License" />
  <img src="https://img.shields.io/badge/Status-Production%20Ready-brightgreen.svg" alt="Status" />
  <img src="https://img.shields.io/badge/Company-Advanced%20ID%20Asia%20Engineering-orange.svg" alt="Company" />
</div>

## 🚀 Overview

AAELink is a comprehensive enterprise workspace platform designed for Advanced ID Asia Engineering Co.,Ltd. It provides a modern, secure, and scalable solution for team collaboration, communication, and project management.

## ✨ Features

### 🔐 Authentication & Security
- **JWT-based Authentication** with secure token management
- **WebAuthn Passkey Support** for enhanced security
- **Role-based Access Control** (Admin, User, Moderator)
- **Rate Limiting** and security middleware
- **CSRF Protection** and secure headers

### 💬 Real-time Communication
- **Discord-inspired Chat Interface** with channel-based messaging
- **WebSocket Real-time Messaging** for instant communication
- **Message Reactions** and engagement features
- **File Sharing** with drag-and-drop support
- **Voice & Video Call Integration** (coming soon)

### 📁 File Management
- **MinIO Distributed Storage** for scalable file management
- **Drag-and-Drop Upload** with progress tracking
- **File Type Validation** and size limits
- **Secure File Access** with proper permissions

### 📅 Calendar & Events
- **Event Management** with scheduling capabilities
- **Team Calendar** integration
- **Meeting Notifications** and reminders
- **Resource Booking** system

### 🏢 Organization Management
- **Multi-tenant Architecture** for different organizations
- **Team Structure** with hierarchical permissions
- **User Management** with profile customization
- **Department Organization** and role assignment

### 🎨 Modern UI/UX
- **Discord + Telegram Hybrid Design** for familiar user experience
- **Responsive Design** for mobile and desktop
- **Dark/Light Theme** support
- **Accessibility Compliance** (WCAG 2.1)
- **Senior Mode** for enhanced usability

## 🛠️ Technology Stack

### Frontend
- **Next.js 15** with App Router
- **TypeScript 5.3.3** for type safety
- **Tailwind CSS 3.4.0** for styling
- **Radix UI** for accessible components
- **Lucide React** for icons
- **Socket.io Client** for real-time communication

### Backend
- **Node.js 18** with Fastify framework
- **TypeScript 5.3.3** for type safety
- **PostgreSQL 16** with Prisma ORM
- **Redis** for caching and sessions
- **MinIO** for file storage
- **WebSocket** for real-time features

### Infrastructure
- **Docker & Docker Compose** for containerization
- **PostgreSQL** for primary database
- **Redis** for caching and sessions
- **MinIO** for distributed file storage
- **Nginx** for reverse proxy (production)

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- Docker & Docker Compose
- Git

### 1. Clone the Repository
```bash
git clone https://github.com/Dry1ceD7/AAELink.git
cd AAELink
```

### 2. Start with Docker Compose
```bash
# Start all services
docker-compose up -d

# Check service status
docker-compose ps

# View logs
docker-compose logs -f
```

### 3. Access the Application
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001
- **Database**: localhost:5432
- **Redis**: localhost:6379
- **MinIO Console**: http://localhost:9001

### 4. Default Credentials
- **Username**: `admin` or `admin@aae.co.th`
- **Password**: `12345678`

## 🔧 Development Setup

### Frontend Development
```bash
cd aaelink-frontend
npm install
npm run dev
```

### Backend Development
```bash
cd packages/backend
npm install
npm run dev
```

### Database Setup
```bash
# Generate Prisma client
npm run db:generate

# Run migrations
npm run db:migrate

# Seed database
npm run db:seed
```

## 📊 Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend API   │    │   Database      │
│   (Next.js)     │◄──►│   (Fastify)     │◄──►│   (PostgreSQL)  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   WebSocket     │    │   Redis Cache   │    │   MinIO Storage │
│   (Real-time)   │    │   (Sessions)    │    │   (Files)       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 🔒 Security Features

- **JWT Authentication** with secure token storage
- **Rate Limiting** to prevent abuse
- **CORS Protection** with configurable origins
- **Helmet.js** for security headers
- **Input Validation** with Zod schemas
- **SQL Injection Protection** with Prisma ORM
- **File Upload Security** with type validation

## 📱 Mobile Support

- **Responsive Design** for all screen sizes
- **Touch-friendly Interface** for mobile devices
- **Progressive Web App** capabilities
- **Offline Support** with service workers

## 🌐 Internationalization

- **Multi-language Support** (EN, TH, DE)
- **RTL Language Support** for Arabic/Hebrew
- **Localized Date/Time** formatting
- **Currency and Number** formatting

## 🚀 Deployment

### Production Deployment
```bash
# Build for production
docker-compose -f docker-compose.prod.yml up -d

# Scale services
docker-compose up -d --scale backend=3
```

### Environment Variables
```bash
# Copy environment template
cp packages/backend/env.example packages/backend/.env

# Configure your environment
nano packages/backend/.env
```

## 📈 Monitoring & Analytics

- **Health Check Endpoints** for service monitoring
- **Logging** with Winston
- **Performance Metrics** with built-in monitoring
- **Error Tracking** and reporting

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🏢 Company

**Advanced ID Asia Engineering Co.,Ltd**

- **Website**: [Company Website]
- **Email**: admin@aae.co.th
- **Location**: Thailand

## 📞 Support

For support and questions:
- **Email**: support@aae.co.th
- **Documentation**: [Project Wiki]
- **Issues**: [GitHub Issues](https://github.com/Dry1ceD7/AAELink/issues)

## 🎯 Roadmap

### Phase 1 (Current)
- ✅ User Authentication
- ✅ Real-time Messaging
- ✅ File Management
- ✅ Basic UI/UX

### Phase 2 (Next)
- 🔄 Video/Audio Calls
- 🔄 Mobile App (React Native)
- 🔄 Desktop App (Tauri)
- 🔄 Advanced Analytics

### Phase 3 (Future)
- 📋 AI-powered Features
- 📋 Advanced Integrations
- 📋 Enterprise SSO
- 📋 Advanced Security

---

<div align="center">
  <p>Built with ❤️ by Advanced ID Asia Engineering Co.,Ltd</p>
  <p>© 2024 AAELink. All rights reserved.</p>
</div>