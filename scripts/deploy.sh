#!/bin/bash

# AAELink Deployment Script
# Supports Docker Compose and Kubernetes deployments

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT=${1:-development}
DEPLOYMENT_TYPE=${2:-docker}

echo -e "${BLUE}🚀 Starting AAELink deployment...${NC}"
echo -e "${YELLOW}Environment: ${ENVIRONMENT}${NC}"
echo -e "${YELLOW}Deployment Type: ${DEPLOYMENT_TYPE}${NC}"

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check prerequisites
check_prerequisites() {
    echo -e "${BLUE}Checking prerequisites...${NC}"
    
    if [ "$DEPLOYMENT_TYPE" = "docker" ]; then
        if ! command_exists docker; then
            echo -e "${RED}Docker is not installed${NC}"
            exit 1
        fi
        
        if ! command_exists docker-compose; then
            echo -e "${RED}Docker Compose is not installed${NC}"
            exit 1
        fi
    elif [ "$DEPLOYMENT_TYPE" = "kubernetes" ]; then
        if ! command_exists kubectl; then
            echo -e "${RED}kubectl is not installed${NC}"
            exit 1
        fi
        
        if ! command_exists helm; then
            echo -e "${RED}Helm is not installed${NC}"
            exit 1
        fi
    fi
    
    echo -e "${GREEN}Prerequisites check passed${NC}"
}

# Function to build Docker images
build_images() {
    echo -e "${BLUE}Building Docker images...${NC}"
    
    # Build backend image
    echo -e "${YELLOW}Building backend image...${NC}"
    docker build -t aaelink/backend:latest ./packages/backend/
    
    # Build frontend image
    echo -e "${YELLOW}Building frontend image...${NC}"
    docker build -t aaelink/frontend:latest ./packages/frontend/
    
    echo -e "${GREEN}Docker images built successfully${NC}"
}

# Function to deploy with Docker Compose
deploy_docker() {
    echo -e "${BLUE}Deploying with Docker Compose...${NC}"
    
    if [ "$ENVIRONMENT" = "production" ]; then
        # Create production environment file
        if [ ! -f .env.production ]; then
            echo -e "${YELLOW}Creating production environment file...${NC}"
            cat > .env.production << EOF
POSTGRES_PASSWORD=secure_password_123
REDIS_PASSWORD=redis_password_123
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin123
JWT_SECRET=your_jwt_secret_key_here
CSRF_SECRET=your_csrf_secret_key_here
N8N_USER=admin
N8N_PASSWORD=n8n_password_123
EOF
        fi
        
        # Deploy production stack
        docker-compose -f docker-compose.prod.yml --env-file .env.production up -d
    else
        # Deploy development stack
        docker-compose -f docker-compose.dev.yml up -d
    fi
    
    echo -e "${GREEN}Docker Compose deployment completed${NC}"
}

# Function to deploy with Kubernetes
deploy_kubernetes() {
    echo -e "${BLUE}Deploying with Kubernetes...${NC}"
    
    # Create namespace
    kubectl apply -f k8s/namespace.yaml
    
    # Deploy PostgreSQL
    echo -e "${YELLOW}Deploying PostgreSQL...${NC}"
    kubectl apply -f k8s/postgres.yaml
    
    # Wait for PostgreSQL to be ready
    kubectl wait --for=condition=ready pod -l app=postgres -n aaelink --timeout=300s
    
    # Deploy Redis
    echo -e "${YELLOW}Deploying Redis...${NC}"
    kubectl apply -f k8s/redis.yaml
    
    # Deploy MinIO
    echo -e "${YELLOW}Deploying MinIO...${NC}"
    kubectl apply -f k8s/minio.yaml
    
    # Deploy Backend
    echo -e "${YELLOW}Deploying Backend...${NC}"
    kubectl apply -f k8s/backend.yaml
    
    # Deploy Frontend
    echo -e "${YELLOW}Deploying Frontend...${NC}"
    kubectl apply -f k8s/frontend.yaml
    
    # Deploy NGINX Ingress
    echo -e "${YELLOW}Deploying NGINX Ingress...${NC}"
    kubectl apply -f k8s/ingress.yaml
    
    echo -e "${GREEN}Kubernetes deployment completed${NC}"
}

# Function to run health checks
run_health_checks() {
    echo -e "${BLUE}Running health checks...${NC}"
    
    if [ "$DEPLOYMENT_TYPE" = "docker" ]; then
        # Check if containers are running
        docker-compose ps
        
        # Test backend health
        echo -e "${YELLOW}Testing backend health...${NC}"
        sleep 10
        curl -f http://localhost:3001/health || echo -e "${RED}Backend health check failed${NC}"
        
        # Test frontend
        echo -e "${YELLOW}Testing frontend...${NC}"
        curl -f http://localhost:3000/ || echo -e "${RED}Frontend health check failed${NC}"
        
    elif [ "$DEPLOYMENT_TYPE" = "kubernetes" ]; then
        # Check pod status
        kubectl get pods -n aaelink
        
        # Test services
        echo -e "${YELLOW}Testing services...${NC}"
        kubectl port-forward -n aaelink service/backend 3001:3001 &
        sleep 5
        curl -f http://localhost:3001/health || echo -e "${RED}Backend health check failed${NC}"
        pkill -f "kubectl port-forward"
    fi
    
    echo -e "${GREEN}Health checks completed${NC}"
}

# Function to run load tests
run_load_tests() {
    echo -e "${BLUE}Running load tests...${NC}"
    
    if command_exists k6; then
        k6 run scripts/load-test.js
    else
        echo -e "${YELLOW}k6 not installed, skipping load tests${NC}"
    fi
}

# Function to show deployment status
show_status() {
    echo -e "${BLUE}Deployment Status:${NC}"
    
    if [ "$DEPLOYMENT_TYPE" = "docker" ]; then
        docker-compose ps
        echo -e "${GREEN}Access URLs:${NC}"
        echo -e "Frontend: http://localhost:3000"
        echo -e "Backend API: http://localhost:3001/api"
        echo -e "Health Check: http://localhost:3001/health"
        
    elif [ "$DEPLOYMENT_TYPE" = "kubernetes" ]; then
        kubectl get all -n aaelink
        echo -e "${GREEN}Access URLs:${NC}"
        echo -e "Frontend: http://localhost (via ingress)"
        echo -e "Backend API: http://localhost:3001/api (via port-forward)"
    fi
}

# Main deployment flow
main() {
    check_prerequisites
    
    if [ "$DEPLOYMENT_TYPE" = "docker" ]; then
        build_images
        deploy_docker
    elif [ "$DEPLOYMENT_TYPE" = "kubernetes" ]; then
        build_images
        deploy_kubernetes
    else
        echo -e "${RED}Invalid deployment type: $DEPLOYMENT_TYPE${NC}"
        echo -e "Usage: $0 [environment] [deployment_type]"
        echo -e "Environments: development, production"
        echo -e "Deployment types: docker, kubernetes"
        exit 1
    fi
    
    run_health_checks
    
    if [ "$ENVIRONMENT" = "production" ]; then
        run_load_tests
    fi
    
    show_status
    
    echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
}

# Run main function
main "$@"
