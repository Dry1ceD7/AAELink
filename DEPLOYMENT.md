# 🚀 AAELink Production Deployment Guide

## 📋 Prerequisites

- Docker & Docker Compose v2.0+
- Domain name with DNS access
- SSL certificate (Let's Encrypt recommended)
- Server with minimum 4GB RAM, 2 CPU cores, 50GB storage

## 🔧 Quick Deployment

### 1. Clone Repository
```bash
git clone https://github.com/Dry1ceD7/AAELink.git
cd AAELink
```

### 2. Configure Environment
```bash
# Copy production environment template
cp env.production.example .env

# Edit with your configuration
nano .env
```

**Required Variables:**
```bash
DOMAIN=your-domain.com
POSTGRES_PASSWORD=your-secure-password
REDIS_PASSWORD=your-secure-password
MINIO_ACCESS_KEY=your-access-key
MINIO_SECRET_KEY=your-secret-key
JWT_SECRET=your-32-char-secret
SESSION_SECRET=your-32-char-secret
```

### 3. SSL Setup (Let's Encrypt)
```bash
# Install Certbot
sudo apt install certbot

# Generate SSL certificates
sudo certbot certonly --standalone -d your-domain.com

# Copy certificates
sudo mkdir -p nginx/ssl
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem nginx/ssl/cert.pem
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem nginx/ssl/key.pem
```

### 4. Deploy Production Stack
```bash
# Build and start all services
docker-compose -f docker-compose.prod.yml up -d

# Check status
docker-compose -f docker-compose.prod.yml ps

# View logs
docker-compose -f docker-compose.prod.yml logs -f
```

### 5. Initialize Database
```bash
# Run migrations and seed data
docker-compose -f docker-compose.prod.yml exec backend bun run db:migrate
docker-compose -f docker-compose.prod.yml exec backend bun run db:seed
```

## 🏗️ Architecture Overview

```
Internet → Nginx (SSL) → Frontend/Backend → PostgreSQL/Redis/MinIO
                    ↓
              Observability Stack
            (SigNoz + ClickHouse)
```

### Services

| Service | Purpose | Port | Health Check |
|---------|---------|------|--------------|
| nginx | Reverse proxy & SSL | 80/443 | `/health` |
| frontend | React SPA | Internal | HTTP 200 |
| backend | Hono API | Internal | `/health` |
| postgres | Database | Internal | `pg_isready` |
| redis | Cache/Sessions | Internal | `PING` |
| minio | File storage | Internal | `/minio/health/live` |

## 🔍 Monitoring

### Enable Monitoring Stack
```bash
# Start with monitoring
docker-compose -f docker-compose.prod.yml --profile monitoring up -d

# Access SigNoz dashboard
open http://your-domain.com:3301
```

### Health Checks
```bash
# Overall system health
curl https://your-domain.com/health

# Individual service health
docker-compose -f docker-compose.prod.yml exec backend curl http://localhost:8080/health
```

## 💾 Backup & Recovery

### Automated Backups
```bash
# Enable backup service
docker-compose -f docker-compose.prod.yml --profile backup up -d

# Manual backup
docker-compose -f docker-compose.prod.yml exec backup sh /backup.sh
```

### Manual Database Backup
```bash
# Backup database
docker-compose -f docker-compose.prod.yml exec postgres pg_dump -U aaelink aaelink_db > backup.sql

# Restore database
docker-compose -f docker-compose.prod.yml exec -T postgres psql -U aaelink aaelink_db < backup.sql
```

## 📊 Performance Tuning

### PostgreSQL Optimization
```bash
# Already optimized in docker-compose.prod.yml:
# - max_connections=200
# - shared_buffers=256MB
# - effective_cache_size=1GB
# - And more...
```

### Redis Optimization
```bash
# Pre-configured:
# - maxmemory=512mb
# - maxmemory-policy=allkeys-lru
# - appendonly=yes
```

### Nginx Caching
```bash
# Static assets cached for 1 year
# API responses cached for 5 minutes
# WebSocket connections optimized
```

## 🔒 Security Features

### Enabled by Default
- [x] SSL/TLS encryption
- [x] CSRF protection
- [x] Rate limiting
- [x] Secure headers
- [x] Session security
- [x] Input validation
- [x] Audit logging

### Additional Security
```bash
# Enable fail2ban
sudo apt install fail2ban

# Configure firewall
sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

## 📈 Scaling Options

### Horizontal Scaling
```bash
# Scale backend services
docker-compose -f docker-compose.prod.yml up -d --scale backend=3

# Load balancer will automatically distribute requests
```

### Database Scaling
```bash
# PostgreSQL read replicas
# Redis cluster mode
# MinIO distributed mode
```

## 🐛 Troubleshooting

### Common Issues

**1. SSL Certificate Issues**
```bash
# Check certificate
openssl x509 -in nginx/ssl/cert.pem -text -noout

# Renew Let's Encrypt
sudo certbot renew
```

**2. Database Connection Issues**
```bash
# Check PostgreSQL logs
docker-compose -f docker-compose.prod.yml logs postgres

# Test connection
docker-compose -f docker-compose.prod.yml exec postgres psql -U aaelink -d aaelink_db -c "SELECT 1;"
```

**3. Memory Issues**
```bash
# Check memory usage
docker stats

# Increase PostgreSQL memory
# Edit docker-compose.prod.yml shared_buffers
```

### Log Analysis
```bash
# Application logs
docker-compose -f docker-compose.prod.yml logs backend | grep ERROR

# Nginx access logs
tail -f logs/nginx/access.log

# Database slow queries
docker-compose -f docker-compose.prod.yml exec postgres \
  psql -U aaelink -d aaelink_db -c "SELECT * FROM pg_stat_statements ORDER BY total_time DESC LIMIT 10;"
```

## 🔄 Updates & Maintenance

### Application Updates
```bash
# Pull latest code
git pull origin main

# Rebuild and restart
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d

# Run any new migrations
docker-compose -f docker-compose.prod.yml exec backend bun run db:migrate
```

### System Maintenance
```bash
# Clean up Docker
docker system prune -a

# Update system packages
sudo apt update && sudo apt upgrade

# Monitor disk space
df -h
```

## 📞 Support

### Default Admin Credentials
- **Email**: `admin@aaelink.com`
- **Password**: `admin123!`

⚠️ **Change immediately after first login!**

### Health Endpoints
- **Overall**: `https://your-domain.com/health`
- **API**: `https://your-domain.com/api/health`
- **Database**: Check via logs

### Performance Metrics
- **SigNoz**: `http://your-domain.com:3301`
- **MinIO Console**: `https://your-domain.com/minio`

## 🎯 Production Checklist

- [ ] Environment variables configured
- [ ] SSL certificates installed
- [ ] Database initialized
- [ ] Admin password changed
- [ ] Monitoring enabled
- [ ] Backups configured
- [ ] Firewall configured
- [ ] DNS records set
- [ ] Health checks passing
- [ ] Performance tested

## 📚 Additional Resources

- [Configuration Guide](./docs/configuration.md)
- [API Documentation](./docs/api.md)
- [Security Guide](./docs/security.md)
- [Troubleshooting](./docs/troubleshooting.md)
