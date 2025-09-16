.PHONY: help install dev build test docker-up docker-down docker-build git-push clean

# Default target
help:
	@echo "AAELink Development Commands"
	@echo "============================"
	@echo ""
	@echo "Development:"
	@echo "  make install      - Install all dependencies"
	@echo "  make dev         - Start development servers"
	@echo "  make build       - Build all packages"
	@echo "  make test        - Run tests"
	@echo ""
	@echo "Docker:"
	@echo "  make docker-up   - Start Docker services (DB, Redis, MinIO)"
	@echo "  make docker-down - Stop Docker services"
	@echo "  make docker-build - Build Docker images"
	@echo "  make docker-logs - View Docker logs"
	@echo ""
	@echo "Git:"
	@echo "  make git-push   - Push to GitHub"
	@echo "  make git-status - Show git status"
	@echo ""
	@echo "Utilities:"
	@echo "  make clean      - Clean build artifacts"
	@echo "  make db-migrate - Run database migrations"

# Install dependencies
install:
	@echo "Installing dependencies..."
	cd packages/backend && bun install
	cd packages/frontend && npm install
	@echo "✅ Dependencies installed"

# Start development servers
dev: docker-up
	@echo "Starting development servers..."
	@echo "Starting backend on port 8080..."
	cd packages/backend && bun run dev &
	@echo "Starting frontend on port 3000..."
	cd packages/frontend && npm run dev &
	@echo "✅ Development servers started"
	@echo ""
	@echo "Services:"
	@echo "  Backend:  http://localhost:8080"
	@echo "  Frontend: http://localhost:3000"
	@echo "  MinIO:    http://localhost:9001"
	@echo "  n8n:      http://localhost:5678"

# Build all packages
build:
	@echo "Building packages..."
	cd packages/backend && bun run build
	cd packages/frontend && npm run build
	@echo "✅ Build complete"

# Run tests
test:
	@echo "Running tests..."
	cd packages/backend && bun test
	cd packages/frontend && npm test
	@echo "✅ Tests complete"

# Docker commands
docker-up:
	@echo "Starting Docker services..."
	docker-compose -f docker-compose.dev.yml up -d
	@echo "Waiting for services to be ready..."
	@sleep 5
	@echo "✅ Docker services started"
	@docker-compose -f docker-compose.dev.yml ps

docker-down:
	@echo "Stopping Docker services..."
	docker-compose -f docker-compose.dev.yml down
	@echo "✅ Docker services stopped"

docker-build:
	@echo "Building Docker images..."
	docker build -t aaelink/backend:latest ./packages/backend
	docker build -t aaelink/frontend:latest ./packages/frontend
	@echo "✅ Docker images built"

docker-logs:
	docker-compose -f docker-compose.dev.yml logs -f

# Git commands
git-push:
	@echo "Pushing to GitHub..."
	git add .
	git commit -m "Update: $$(date '+%Y-%m-%d %H:%M:%S')" || true
	git push origin main || echo "Remote not configured. Run: git remote add origin <your-repo-url>"

git-status:
	git status

# Database migrations
db-migrate:
	@echo "Running database migrations..."
	cd packages/backend && bun run db:migrate
	@echo "✅ Migrations complete"

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	rm -rf packages/backend/dist
	rm -rf packages/frontend/dist
	rm -rf packages/backend/node_modules
	rm -rf packages/frontend/node_modules
	@echo "✅ Clean complete"

# Production deployment
deploy:
	@echo "Building for production..."
	docker-compose build
	docker-compose up -d
	@echo "✅ Production deployment complete"
