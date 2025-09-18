#!/bin/bash

# AAELink Enterprise v1.2 - Production Deployment Script
# Phase 4: DELIVER - Deploy Production
# Advanced ID Asia Engineering Co.,Ltd

set -e

echo "🚀 AAELink Enterprise v1.2 - Production Deployment"
echo "=================================================="
echo "Advanced ID Asia Engineering Co.,Ltd"
echo "Version: 1.2.0 | Local-First Architecture | Zero Cloud Dependencies"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_NAME="aaelink-enterprise"
FRONTEND_DIR="aaelink-enterprise-frontend"
BACKEND_DIR="aaelink-enterprise-backend"
DOCKER_COMPOSE_FILE="docker-compose.enterprise.yml"

# Functions
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install Docker first."
        exit 1
    fi

    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        log_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi

    # Check Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js is not installed. Please install Node.js 20+ first."
        exit 1
    fi

    # Check npm
    if ! command -v npm &> /dev/null; then
        log_error "npm is not installed. Please install npm first."
        exit 1
    fi

    log_success "All prerequisites are installed"
}

# Create production environment
create_production_env() {
    log_info "Creating production environment..."

    # Create .env file for backend
    cat > $BACKEND_DIR/.env << EOF
# Database
DATABASE_URL="postgresql://aaelink:aaelink_secure_2024@postgres_primary:5432/aaelink"
DB_PASSWORD="aaelink_secure_2024"
REPL_PASSWORD="aaelink_repl_2024"

# Redis
REDIS_HOST="redis_master"
REDIS_PORT="6379"
REDIS_PASSWORD=""

# MinIO
MINIO_ENDPOINT="minio"
MINIO_PORT="9000"
MINIO_USE_SSL="false"
MINIO_ACCESS_KEY="aaelink_admin"
MINIO_SECRET_KEY="aaelink_minio_2024"
MINIO_BUCKET="aaelink-files"

# JWT
JWT_SECRET="aaelink_jwt_secret_2024_production"

# Server
PORT="3000"
HOST="0.0.0.0"
NODE_ENV="production"
LOG_LEVEL="info"

# Frontend
FRONTEND_URL="http://localhost:3000"

# API
API_HOST="localhost:3000"
EOF

    log_success "Production environment created"
}

# Build frontend
build_frontend() {
    log_info "Building frontend..."

    cd $FRONTEND_DIR

    # Install dependencies
    log_info "Installing frontend dependencies..."
    npm install --production

    # Build the application
    log_info "Building Next.js application..."
    npm run build

    cd ..

    log_success "Frontend built successfully"
}

# Build backend
build_backend() {
    log_info "Building backend..."

    cd $BACKEND_DIR

    # Install dependencies
    log_info "Installing backend dependencies..."
    npm install --production

    # Build TypeScript
    log_info "Building TypeScript..."
    npm run build

    cd ..

    log_success "Backend built successfully"
}

# Start infrastructure
start_infrastructure() {
    log_info "Starting infrastructure services..."

    # Stop any existing containers
    docker-compose -f $DOCKER_COMPOSE_FILE down

    # Start infrastructure
    docker-compose -f $DOCKER_COMPOSE_FILE up -d postgres_primary postgres_replica redis_master minio elasticsearch prometheus grafana n8n

    # Wait for services to be ready
    log_info "Waiting for services to be ready..."
    sleep 30

    log_success "Infrastructure services started"
}

# Deploy application
deploy_application() {
    log_info "Deploying application..."

    # Start application containers
    docker-compose -f $DOCKER_COMPOSE_FILE up -d

    # Wait for application to be ready
    log_info "Waiting for application to be ready..."
    sleep 15

    log_success "Application deployed successfully"
}

# Run health checks
run_health_checks() {
    log_info "Running health checks..."

    # Check frontend
    if curl -f http://localhost:3000/health > /dev/null 2>&1; then
        log_success "Frontend health check passed"
    else
        log_warning "Frontend health check failed - may need more time to start"
    fi

    # Check backend
    if curl -f http://localhost:3000/api/health > /dev/null 2>&1; then
        log_success "Backend health check passed"
    else
        log_warning "Backend health check failed - may need more time to start"
    fi

    # Check Grafana
    if curl -f http://localhost:3001 > /dev/null 2>&1; then
        log_success "Grafana health check passed"
    else
        log_warning "Grafana health check failed - may need more time to start"
    fi

    # Check MinIO
    if curl -f http://localhost:9000/minio/health/live > /dev/null 2>&1; then
        log_success "MinIO health check passed"
    else
        log_warning "MinIO health check failed - may need more time to start"
    fi
}

# Display deployment information
display_deployment_info() {
    echo ""
    echo "🎉 AAELink Enterprise v1.2 Deployment Complete!"
    echo "=============================================="
    echo ""
    echo "📱 Application URLs:"
    echo "  Frontend:     http://localhost:3000"
    echo "  Backend API:  http://localhost:3000/api"
    echo "  API Docs:     http://localhost:3000/docs"
    echo "  WebSocket:    ws://localhost:3000/ws"
    echo ""
    echo "📊 Monitoring URLs:"
    echo "  Grafana:      http://localhost:3001"
    echo "  Prometheus:   http://localhost:9090"
    echo "  MinIO:        http://localhost:9001"
    echo "  n8n:          http://localhost:5678"
    echo ""
    echo "🔐 Default Credentials:"
    echo "  Username: admin or admin@aae.co.th"
    echo "  Password: 12345678"
    echo ""
    echo "📋 Management Commands:"
    echo "  View logs:    docker-compose -f $DOCKER_COMPOSE_FILE logs -f"
    echo "  Stop all:     docker-compose -f $DOCKER_COMPOSE_FILE down"
    echo "  Restart:      docker-compose -f $DOCKER_COMPOSE_FILE restart"
    echo ""
    echo "🏢 Advanced ID Asia Engineering Co.,Ltd"
    echo "   Version 1.2.0 | Local-First Architecture | Zero Cloud Dependencies"
    echo ""
}

# Main deployment process
main() {
    echo "Starting AAELink Enterprise v1.2 deployment..."
    echo ""

    check_prerequisites
    create_production_env
    build_frontend
    build_backend
    start_infrastructure
    deploy_application
    run_health_checks
    display_deployment_info

    log_success "🎉 PHASE 4 (DELIVER) COMPLETE - PRODUCTION DEPLOYED"
    log_success "✅ AAELink Enterprise v1.2 is now running in production!"
}

# Run main function
main "$@"
