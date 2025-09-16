# AAELink Setup Instructions

## Current Status

✅ **Local Git Repository**: Initialized with commits
❌ **GitHub Connection**: Not connected
❌ **Docker Testing**: Not verified

## 🔗 Connect to GitHub

### Step 1: Create GitHub Repository
```bash
# Go to https://github.com/new and create a repository named "AAELink"
# Choose: Public/Private, no README (we already have one)
```

### Step 2: Add GitHub Remote
```bash
cd /Users/d7y1ce/AAELink-new

# Replace YOUR_USERNAME with your GitHub username
git remote add origin https://github.com/YOUR_USERNAME/AAELink.git

# Verify remote is added
git remote -v
```

### Step 3: Push to GitHub
```bash
# Push all commits to GitHub
git push -u origin main

# Verify on GitHub web interface
```

## 🐳 Test Docker Integration

### Step 1: Verify Docker is Running
```bash
docker --version
docker-compose --version
```

### Step 2: Test Development Environment
```bash
cd /Users/d7y1ce/AAELink-new

# Start services
docker-compose -f docker-compose.dev.yml up -d

# Check running containers
docker ps

# View logs
docker-compose -f docker-compose.dev.yml logs

# Stop services
docker-compose -f docker-compose.dev.yml down
```

### Step 3: Test Application Build
```bash
# Build backend Docker image
docker build -t aaelink/backend:test ./packages/backend

# Build frontend Docker image
docker build -t aaelink/frontend:test ./packages/frontend

# List images
docker images | grep aaelink
```

## 🚀 Full Production Test

### Start Complete Stack
```bash
# Start all services
docker-compose up -d

# Verify all services are running
docker-compose ps

# Check service health
docker-compose logs backend
docker-compose logs frontend
docker-compose logs postgres
docker-compose logs redis
docker-compose logs minio

# Access services:
# Frontend: http://localhost:3000
# Backend: http://localhost:8080
# MinIO Console: http://localhost:9001
```

## 📊 Verification Commands

### Check Git Connection
```bash
git log --oneline
git branch -a
git remote show origin  # (after adding remote)
```

### Check Docker Status
```bash
docker system info
docker-compose config  # Validate docker-compose.yml
docker network ls | grep aaelink
docker volume ls | grep aaelink
```

### Test API Endpoints
```bash
# Health check
curl http://localhost:8080/health

# Test CORS
curl -H "Origin: http://localhost:3000" \
     -H "Content-Type: application/json" \
     http://localhost:8080/health
```

## 🛠️ Quick Development Commands

```bash
# Development workflow
make docker-up     # Start services
make dev          # Start development servers
make docker-logs  # View logs
make docker-down  # Stop services

# Testing
make test         # Run all tests
```

## ❗ Common Issues

### GitHub Connection
- **Issue**: Permission denied (publickey)
- **Solution**: Use HTTPS instead of SSH, or setup SSH keys

### Docker Issues
- **Issue**: Port already in use
- **Solution**: `docker-compose down` or change ports in docker-compose.yml

- **Issue**: Permission denied
- **Solution**: Run with `sudo` or add user to docker group

### Database Connection
- **Issue**: Connection refused
- **Solution**: Wait for PostgreSQL to be ready (health check)

## 📋 Current Project Structure

```
AAELink-new/
├── packages/
│   ├── backend/          # Bun + Hono API
│   └── frontend/         # React + Tailwind
├── tests/
│   ├── e2e/             # Playwright tests
│   └── performance/     # k6 load tests
├── docker-compose.yml   # Production services
├── docker-compose.dev.yml # Development services
├── Makefile            # Development commands
└── .github/workflows/  # CI/CD pipeline
```

## ✅ Next Steps After Setup

1. **Connect to GitHub** (follow steps above)
2. **Test Docker** (follow steps above)
3. **Run tests**: `make test`
4. **Start development**: `make dev`
5. **Deploy**: `docker-compose up -d`
