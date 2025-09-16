# AAELink Deployment Guide

## 🚀 Overview

This guide covers deploying AAELink in various environments, from development to production. The platform supports multiple deployment strategies including Docker Compose, Kubernetes, and cloud-native solutions.

## 📋 Prerequisites

### System Requirements
- **CPU**: 2+ cores (4+ recommended for production)
- **RAM**: 4GB+ (8GB+ recommended for production)
- **Storage**: 50GB+ SSD (100GB+ recommended for production)
- **Network**: Stable internet connection

### Software Requirements
- **Docker**: 20.10+ with Docker Compose 2.0+
- **Kubernetes**: 1.24+ (for K8s deployment)
- **kubectl**: 1.24+ (for K8s deployment)
- **Helm**: 3.8+ (for K8s deployment)
- **Git**: 2.30+ (for source deployment)

## 🏗 Deployment Options

### 1. Docker Compose (Recommended for Small-Medium Deployments)

#### Development Deployment
```bash
# Clone repository
git clone https://github.com/Dry1ceD7/AAELink.git
cd AAELink

# Start development environment
docker-compose -f docker-compose.dev.yml up -d

# Check status
docker-compose ps
```

#### Production Deployment
```bash
# Create production environment file
cp .env.production.example .env.production

# Edit environment variables
nano .env.production

# Deploy production stack
docker-compose -f docker-compose.prod.yml up -d

# Check logs
docker-compose -f docker-compose.prod.yml logs -f
```

### 2. Kubernetes (Recommended for Large Deployments)

#### Prerequisites
```bash
# Install kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl

# Install Helm
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

#### Deploy to Kubernetes
```bash
# Create namespace
kubectl apply -f k8s/namespace.yaml

# Deploy PostgreSQL
kubectl apply -f k8s/postgres.yaml

# Deploy Redis
kubectl apply -f k8s/redis.yaml

# Deploy MinIO
kubectl apply -f k8s/minio.yaml

# Deploy Backend
kubectl apply -f k8s/backend.yaml

# Deploy Frontend
kubectl apply -f k8s/frontend.yaml

# Deploy NGINX Ingress
kubectl apply -f k8s/ingress.yaml

# Check deployment status
kubectl get all -n aaelink
```

### 3. Cloud Deployment

#### AWS EKS
```bash
# Create EKS cluster
eksctl create cluster --name aaelink-cluster --region us-west-2 --nodegroup-name workers --node-type t3.medium --nodes 3

# Deploy to EKS
kubectl apply -f k8s/
```

#### Google GKE
```bash
# Create GKE cluster
gcloud container clusters create aaelink-cluster --zone us-central1-a --num-nodes 3

# Deploy to GKE
kubectl apply -f k8s/
```

#### Azure AKS
```bash
# Create AKS cluster
az aks create --resource-group aaelink-rg --name aaelink-cluster --node-count 3 --enable-addons monitoring --generate-ssh-keys

# Deploy to AKS
kubectl apply -f k8s/
```

## ⚙️ Configuration

### Environment Variables

#### Backend Configuration
```env
# Application
NODE_ENV=production
PORT=3001

# Database
DATABASE_URL=postgresql://aaelink:password@postgres:5432/aaelink

# Cache
REDIS_URL=redis://:password@redis:6379

# File Storage
MINIO_ENDPOINT=http://minio:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin123
MINIO_BUCKET=aaelink-files

# Security
JWT_SECRET=your-super-secure-jwt-secret-key
CSRF_SECRET=your-super-secure-csrf-secret-key

# Automation
N8N_URL=http://n8n:5678

# Monitoring
SIGNOZ_URL=http://signoz:3301
```

#### Frontend Configuration
```env
# API Configuration
VITE_API_URL=https://api.yourdomain.com/api
VITE_WS_URL=wss://api.yourdomain.com/ws

# Feature Flags
VITE_ENABLE_ANALYTICS=true
VITE_ENABLE_DEBUG=false
```

### Database Configuration

#### PostgreSQL Setup
```sql
-- Create database
CREATE DATABASE aaelink;

-- Create user
CREATE USER aaelink WITH PASSWORD 'secure_password_123';

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE aaelink TO aaelink;

-- Create extensions
\c aaelink
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
```

#### Redis Configuration
```conf
# redis.conf
maxmemory 2gb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000
```

### SSL/TLS Configuration

#### Let's Encrypt with Certbot
```bash
# Install Certbot
sudo apt-get install certbot

# Generate certificate
sudo certbot certonly --standalone -d yourdomain.com

# Copy certificates to Docker volume
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem ./nginx/ssl/cert.pem
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem ./nginx/ssl/key.pem
```

#### Self-Signed Certificates (Development)
```bash
# Generate self-signed certificate
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/key.pem \
  -out nginx/ssl/cert.pem \
  -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"
```

## 🔧 Service Configuration

### NGINX Configuration

#### Production NGINX Config
```nginx
server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    # SSL Configuration
    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;
    ssl_prefer_server_ciphers off;

    # Security Headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains";

    # API Routes
    location /api/ {
        proxy_pass http://backend:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket Routes
    location /ws {
        proxy_pass http://backend:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    # Frontend Routes
    location / {
        proxy_pass http://frontend:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Database Configuration

#### PostgreSQL Tuning
```conf
# postgresql.conf
shared_buffers = 256MB
effective_cache_size = 1GB
maintenance_work_mem = 64MB
checkpoint_completion_target = 0.9
wal_buffers = 16MB
default_statistics_target = 100
random_page_cost = 1.1
effective_io_concurrency = 200
```

#### Redis Tuning
```conf
# redis.conf
maxmemory 2gb
maxmemory-policy allkeys-lru
tcp-keepalive 300
timeout 0
tcp-backlog 511
```

## 📊 Monitoring Setup

### SigNoz Configuration
```yaml
# signoz-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: signoz-config
data:
  signoz.yaml: |
    storage:
      clickhouse:
        enabled: true
        host: clickhouse
        port: 9000
        database: signoz
        username: default
        password: ""
```

### Prometheus Configuration
```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'aaelink-backend'
    static_configs:
      - targets: ['backend:3001']
    metrics_path: '/metrics'
    scrape_interval: 5s

  - job_name: 'aaelink-frontend'
    static_configs:
      - targets: ['frontend:80']
    metrics_path: '/metrics'
    scrape_interval: 5s
```

## 🔒 Security Configuration

### Firewall Rules
```bash
# UFW Configuration
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### Docker Security
```yaml
# docker-compose.prod.yml
services:
  backend:
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp
    user: "1001:1001"
```

### Kubernetes Security
```yaml
# security-context.yaml
apiVersion: v1
kind: Pod
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1001
    fsGroup: 1001
  containers:
  - name: backend
    securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop:
        - ALL
```

## 🚀 Deployment Scripts

### Automated Deployment
```bash
# Make deployment script executable
chmod +x scripts/deploy.sh

# Deploy development environment
./scripts/deploy.sh development docker

# Deploy production environment
./scripts/deploy.sh production docker

# Deploy to Kubernetes
./scripts/deploy.sh production kubernetes
```

### Health Checks
```bash
# Check service health
curl -f http://localhost:3001/health

# Check database connectivity
docker exec -it aaelink-postgres psql -U aaelink -d aaelink -c "SELECT 1;"

# Check Redis connectivity
docker exec -it aaelink-redis redis-cli ping

# Check MinIO connectivity
curl -f http://localhost:9000/minio/health/live
```

## 📈 Scaling Configuration

### Horizontal Pod Autoscaler
```yaml
# hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: backend-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: backend
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

### Load Balancer Configuration
```yaml
# loadbalancer.yaml
apiVersion: v1
kind: Service
metadata:
  name: backend-lb
spec:
  type: LoadBalancer
  ports:
  - port: 80
    targetPort: 3001
  selector:
    app: backend
```

## 🔄 Backup and Recovery

### Database Backup
```bash
# Create backup
docker exec aaelink-postgres pg_dump -U aaelink aaelink > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore backup
docker exec -i aaelink-postgres psql -U aaelink aaelink < backup_20240101_120000.sql
```

### File Storage Backup
```bash
# Backup MinIO data
docker exec aaelink-minio mc mirror /data s3://backup-bucket/aaelink-files/

# Restore MinIO data
docker exec aaelink-minio mc mirror s3://backup-bucket/aaelink-files/ /data
```

### Automated Backup Script
```bash
#!/bin/bash
# backup.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups"

# Create backup directory
mkdir -p $BACKUP_DIR

# Database backup
docker exec aaelink-postgres pg_dump -U aaelink aaelink > $BACKUP_DIR/db_$DATE.sql

# File storage backup
docker exec aaelink-minio mc mirror /data s3://backup-bucket/aaelink-files/$DATE/

# Cleanup old backups (keep 30 days)
find $BACKUP_DIR -name "*.sql" -mtime +30 -delete
```

## 🐛 Troubleshooting

### Common Issues

#### Port Already in Use
```bash
# Find process using port
sudo lsof -i :3001

# Kill process
sudo kill -9 <PID>
```

#### Database Connection Issues
```bash
# Check PostgreSQL logs
docker logs aaelink-postgres

# Test connection
docker exec -it aaelink-postgres psql -U aaelink -d aaelink -c "SELECT 1;"
```

#### Memory Issues
```bash
# Check memory usage
docker stats

# Increase memory limits
docker-compose -f docker-compose.prod.yml up -d --scale backend=2
```

#### SSL Certificate Issues
```bash
# Check certificate validity
openssl x509 -in nginx/ssl/cert.pem -text -noout

# Renew Let's Encrypt certificate
sudo certbot renew
```

### Log Analysis
```bash
# View all logs
docker-compose -f docker-compose.prod.yml logs

# View specific service logs
docker-compose -f docker-compose.prod.yml logs backend

# Follow logs in real-time
docker-compose -f docker-compose.prod.yml logs -f
```

### Performance Monitoring
```bash
# Check resource usage
docker stats

# Check database performance
docker exec -it aaelink-postgres psql -U aaelink -d aaelink -c "SELECT * FROM pg_stat_activity;"

# Check Redis performance
docker exec -it aaelink-redis redis-cli info stats
```

## 📞 Support

### Getting Help
- **Documentation**: [docs/README.md](README.md)
- **API Reference**: [docs/API.md](API.md)
- **GitHub Issues**: [https://github.com/Dry1ceD7/AAELink/issues](https://github.com/Dry1ceD7/AAELink/issues)
- **Discussions**: [https://github.com/Dry1ceD7/AAELink/discussions](https://github.com/Dry1ceD7/AAELink/discussions)

### Emergency Contacts
- **Critical Issues**: Create GitHub issue with `critical` label
- **Security Issues**: Email security@aaelink.com
- **General Support**: GitHub Discussions

---

**AAELink Deployment Guide** - Your complete guide to deploying AAELink in any environment
