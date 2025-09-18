# AAELink - Enterprise Communication & Collaboration Hub

A modern, real-time communication platform built with React, Fastify, and WebSocket technology.

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- PostgreSQL (or use Docker)
- Redis (or use Docker)

### Development Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd aaelink
   ```

2. **Run the setup script**
   ```bash
   chmod +x setup-dev.sh
   ./setup-dev.sh
   ```

3. **Start development servers**
   ```bash
   # Backend
   cd aaelink-backend
   npm run dev

   # Frontend (in another terminal)
   cd packages/frontend
   npm run dev
   ```

### Using Docker Compose

```bash
# Start all services
docker-compose -f docker-compose.dev.yml up

# Or start specific services
docker-compose -f docker-compose.dev.yml up postgres redis minio
```

## 📁 Project Structure

```
aaelink/
├── aaelink-backend/          # Main backend API
├── aaelink-enterprise-backend/ # Enterprise backend
├── packages/
│   └── frontend/             # React frontend
├── docker-compose.dev.yml    # Development services
├── setup-dev.sh             # Development setup script
└── README.md
```

## 🛠️ Available Scripts

### Backend
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run test` - Run tests
- `npm run lint` - Run ESLint
- `npm run db:push` - Push database schema
- `npm run db:studio` - Open Prisma Studio

### Frontend
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run test` - Run tests
- `npm run lint` - Run ESLint
- `npm run e2e` - Run E2E tests

## 🔧 Configuration

### Environment Variables

Create `.env` files in the respective directories:

**Backend (.env)**
```env
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://aaelink:aaelink@localhost:5432/aaelink
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-super-secret-jwt-key-that-is-at-least-32-characters-long
FRONTEND_URL=http://localhost:5173
```

**Frontend (.env)**
```env
VITE_API_URL=http://localhost:3001/api
VITE_WS_URL=ws://localhost:3001/ws
```

## 🌐 Access Points

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3001
- **WebSocket**: ws://localhost:3001/ws
- **MinIO Console**: http://localhost:9001
- **Database**: localhost:5432

## 🧪 Testing

```bash
# Run all tests
npm run test

# Run tests with coverage
npm run test:coverage

# Run E2E tests
npm run e2e
```

## 🚀 Deployment

### Production Build

```bash
# Build backend
cd aaelink-backend
npm run build

# Build frontend
cd packages/frontend
npm run build
```

### Docker Production

```bash
# Build and run with Docker Compose
docker-compose -f docker-compose.prod.yml up --build
```

## 📚 API Documentation

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration
- `GET /api/auth/session` - Get current session
- `POST /api/auth/logout` - User logout

### Messages
- `POST /api/messages/send` - Send message
- `GET /api/messages` - Get messages
- `POST /api/messages/react` - React to message
- `POST /api/messages/read` - Mark as read

### Files
- `POST /api/files/upload` - Upload file
- `GET /api/files/:fileId` - Get file
- `DELETE /api/files/:fileId` - Delete file

### Groups
- `POST /api/groups` - Create group
- `GET /api/groups` - Get user's groups
- `GET /api/groups/:groupId` - Get group details
- `PUT /api/groups/:groupId` - Update group

## 🔒 Security Features

- JWT-based authentication
- Password hashing with bcrypt
- CORS protection
- Rate limiting
- Input validation with Zod
- SQL injection protection with Prisma

## 🎨 Frontend Features

- React 18 with TypeScript
- Tailwind CSS for styling
- Real-time WebSocket communication
- Internationalization (i18n)
- Dark/Light theme support
- Responsive design
- Error boundaries
- Toast notifications

## 🏗️ Architecture

- **Frontend**: React + Vite + TypeScript
- **Backend**: Fastify + Prisma + PostgreSQL
- **Real-time**: WebSocket + Socket.IO
- **Cache**: Redis
- **Storage**: MinIO (S3-compatible)
- **Database**: PostgreSQL
- **Authentication**: JWT + HTTP-only cookies

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

## 🆘 Support

For support, email support@aaelink.com or create an issue in the repository.