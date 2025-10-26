# GUI-LOP Docker Deployment Guide

## Overview

This guide provides comprehensive instructions for deploying the GUI-LOP platform using Docker containers. The platform supports multiple environments with optimized configurations for development, staging, and production deployments.

## Architecture

The GUI-LOP platform consists of the following containerized services:

- **Frontend**: React application served by Nginx
- **Backend**: Node.js/Express API server with JWT authentication
- **Database**: PostgreSQL with optimized schema and indexing
- **Cache**: Redis with intelligent caching strategies
- **Monitoring**: Prometheus, Grafana, and Loki (optional)

## Prerequisites

### System Requirements

- **Docker**: 20.10 or later
- **Docker Compose**: 2.0 or later
- **Memory**: Minimum 4GB RAM (8GB recommended for production)
- **Storage**: Minimum 20GB free disk space
- **OS**: Linux, macOS, or Windows with WSL2

### Software Dependencies

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

## Quick Start

### 1. Environment Configuration

Copy the example environment file and configure it:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```bash
# Required configuration
NODE_ENV=production
POSTGRES_PASSWORD=your-secure-postgres-password
JWT_SECRET=your-super-secure-jwt-secret-min-256-bits
JWT_REFRESH_SECRET=your-super-secure-refresh-secret-min-256-bits

# Optional monitoring
GRAFANA_PASSWORD=your-secure-grafana-password
```

### 2. Development Deployment

```bash
# Deploy to development environment
./scripts/deploy.sh development

# Or using Docker Compose directly
docker-compose -f docker-compose.dev.yml up -d
```

Access the development environment:
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001
- pgAdmin: http://localhost:5050 (admin/admin)
- Redis Commander: http://localhost:8081

### 3. Production Deployment

```bash
# Deploy to production environment
./scripts/deploy.sh production

# Or using Docker Compose directly
docker-compose up -d
```

Access the production environment:
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001

### 4. Staging Deployment

```bash
# Deploy to staging environment with monitoring
./scripts/deploy.sh staging

# Or using Docker Compose directly
docker-compose -f docker-compose.staging.yml up -d
```

Access the staging environment:
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001
- Grafana: http://localhost:3002
- Prometheus: http://localhost:9090

## Environment Configurations

### Development Environment

Features:
- Hot reload for frontend and backend
- Debugging ports exposed
- Development databases (separate from production)
- GUI tools (pgAdmin, Redis Commander)
- Relaxed security settings
- Verbose logging

Configuration files:
- `docker-compose.dev.yml`
- Environment: `development`
- Database: `gui_lop_dev`

### Staging Environment

Features:
- Production-like configuration
- Integrated monitoring stack
- Load testing capabilities
- Performance monitoring
- Extended log retention

Configuration files:
- `docker-compose.staging.yml`
- Environment: `production` (but staging)
- Database: `gui_lop_staging`

### Production Environment

Features:
- Optimized for security and performance
- Minimal attack surface
- Resource limits and health checks
- Graceful shutdown procedures
- Production logging and monitoring

Configuration files:
- `docker-compose.yml`
- Environment: `production`
- Database: `gui_lop`

## Deployment Options

### Automated Deployment Script

Use the provided deployment script for zero-downtime deployments:

```bash
# Basic deployment
./scripts/deploy.sh production

# With custom branch
./scripts/deploy.sh production develop

# Skip tests (for emergencies)
SKIP_TESTS=true ./scripts/deploy.sh production

# Force update all images
FORCE_UPDATE=true ./scripts/deploy.sh staging

# Skip backup (development only)
SKIP_BACKUP=true ./scripts/deploy.sh development
```

### Manual Deployment

For manual control over the deployment process:

```bash
# 1. Build images
docker build -f docker/backend/Dockerfile -t gui-lop-backend:latest .
docker build -f docker/frontend/Dockerfile -t gui-lop-frontend:latest .

# 2. Stop existing services
docker-compose down

# 3. Start new services
docker-compose up -d

# 4. Verify deployment
./docker/monitoring/health-check.sh
```

## Monitoring and Health Checks

### Health Check Script

Run comprehensive health checks:

```bash
# Check all services
./docker/monitoring/health-check.sh

# Monitor continuously
watch -n 30 ./docker/monitoring/health-check.sh
```

### Service Endpoints

Each service includes health check endpoints:

- Frontend: `GET /health`
- Backend: `GET /health`
- PostgreSQL: TCP connection check
- Redis: `PING` command

### Monitoring Stack (Optional)

Enable monitoring in production/staging:

```bash
# Start with monitoring
docker-compose --profile monitoring up -d

# Access Grafana
http://localhost:3002
# Default credentials: admin/GRAFANA_PASSWORD

# Access Prometheus
http://localhost:9090
```

## Data Management

### Database Management

```bash
# View database logs
docker logs gui-lop-postgres

# Connect to database
docker exec -it gui-lop-postgres psql -U gui-lop -d gui_lop

# Create backup
docker exec gui-lop-postgres pg_dump -U gui-lop gui_lop > backup.sql

# Restore backup
docker exec -i gui-lop-postgres psql -U gui-lop -d gui_lop < backup.sql
```

### Redis Management

```bash
# View Redis logs
docker logs gui-lop-redis

# Connect to Redis CLI
docker exec -it gui-lop-redis redis-cli

# Create backup
docker exec gui-lop-redis redis-cli BGSAVE

# View Redis info
docker exec gui-lop-redis redis-cli INFO
```

## Backup and Recovery

### Automated Backups

The deployment script automatically creates backups before deployment:

```bash
# Manual backup
./docker/scripts/graceful-shutdown.sh backup-only production

# View backups
ls -la backups/
```

### Manual Backup

```bash
# Create complete backup
mkdir -p backups/$(date +%Y%m%d_%H%M%S)
cd backups/$(date +%Y%m%d_%H%M%S)

# Backup database
docker exec gui-lop-postgres pg_dump -U gui-lop gui_lop > database.sql

# Backup Redis
docker exec gui-lop-redis redis-cli BGSAVE
sleep 5
docker cp gui-lop-redis:/data/dump.rdb redis.rdb

# Backup configuration
cp ../../.env .env
```

### Recovery

```bash
# Restore from backup
BACKUP_DIR=backups/20240101_120000

# Stop services
docker-compose down

# Restore database
docker-compose up -d postgres
sleep 10
docker exec -i gui-lop-postgres psql -U gui-lop -d gui_lop < $BACKUP_DIR/database.sql

# Restore Redis
docker-compose up -d redis
sleep 5
docker cp $BACKUP_DIR/redis.rdb gui-lop-redis:/data/dump.rdb
docker restart gui-lop-redis

# Start all services
docker-compose up -d
```

## Troubleshooting

### Common Issues

1. **Port conflicts**
   ```bash
   # Check port usage
   netstat -tulpn | grep :3000

   # Change ports in docker-compose.yml
   ```

2. **Permission errors**
   ```bash
   # Fix Docker permissions
   sudo usermod -aG docker $USER

   # Fix log directory permissions
   sudo chown -R $USER:$USER logs/
   ```

3. **Memory issues**
   ```bash
   # Check Docker memory usage
   docker system df

   # Clean up unused resources
   docker system prune -a
   ```

4. **Database connection errors**
   ```bash
   # Check database status
   docker exec gui-lop-postgres pg_isready -U gui-lop

   # Check database logs
   docker logs gui-lop-postgres
   ```

### Log Analysis

```bash
# View application logs
tail -f logs/backend/gui-lop.log

# View container logs
docker logs -f gui-lop-backend
docker logs -f gui-lop-frontend

# View all service logs
docker-compose logs -f
```

### Debug Mode

Enable debug mode for troubleshooting:

```bash
# Set debug environment
export NODE_ENV=development
export DEBUG=*

# Restart services with debug
docker-compose down
docker-compose up -d
```

## Performance Optimization

### Production Optimizations

1. **Resource Limits**: Configure memory and CPU limits
2. **Connection Pooling**: Optimize database connection pools
3. **Caching**: Configure Redis caching strategies
4. **Load Balancing**: Use multiple backend instances
5. **CDN**: Serve static assets via CDN

### Scaling

```bash
# Scale backend services
docker-compose up -d --scale backend=3

# Scale with load balancer
docker-compose --profile production up -d
```

## Security Considerations

### Production Security

1. **Environment Variables**: Use secure secrets management
2. **Network Security**: Configure firewall rules
3. **SSL/TLS**: Enable HTTPS in production
4. **Access Control**: Implement proper RBAC
5. **Security Scanning**: Regular vulnerability assessments

### SSL Configuration

```bash
# Generate SSL certificates (Let's Encrypt)
certbot certonly --webroot -w /var/www/html -d your-domain.com

# Configure Nginx with SSL
# See docker/nginx-proxy/nginx.conf for SSL configuration
```

## Rollback Procedures

### Emergency Rollback

```bash
# Quick rollback to previous version
ROLLBACK=true ./scripts/deploy.sh production /path/to/backup

# Manual rollback
docker-compose down
docker-compose up -d
```

### Version Management

```bash
# Tag images with version numbers
docker build -t gui-lop-backend:v1.0.0 .
docker build -t gui-lop-frontend:v1.0.0 .

# Deploy specific version
docker-compose up -d --force-recreate
```

## Maintenance

### Regular Maintenance Tasks

1. **Log Rotation**: Configure log rotation
2. **Database Maintenance**: Run VACUUM and ANALYZE
3. **Backup Verification**: Test backup restoration
4. **Security Updates**: Keep images updated
5. **Performance Monitoring**: Review metrics regularly

### Cleanup

```bash
# Clean up Docker resources
./docker/scripts/graceful-shutdown.sh cleanup-only production

# Manual cleanup
docker system prune -a
docker volume prune -f
```

## Support

### Documentation

- API Documentation: Available at `/api/docs` endpoint
- Architecture Guide: See `ARCHITECTURE.md`
- Contributing Guide: See `CONTRIBUTING.md`

### Getting Help

- Check logs for error messages
- Run health check script
- Review troubleshooting section
- Create issue in repository

### Performance Tuning

- Monitor resource usage
- Optimize database queries
- Tune Redis configuration
- Configure appropriate caching strategies
- Scale based on load patterns

---

**Note**: This deployment guide covers the complete Docker containerization for the GUI-LOP platform. For specific environment requirements or custom configurations, refer to the individual configuration files in the `docker/` directory.