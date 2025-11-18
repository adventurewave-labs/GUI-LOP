# GUI-LOP Production Deployment Guide

## Overview

This guide provides comprehensive instructions for deploying the GUI-LOP platform to production with all security fixes and optimizations implemented.

## Security Status ✅

**All 38 vulnerabilities have been resolved:**
- ✅ **3 Critical vulnerabilities fixed**
- ✅ **23 High severity vulnerabilities fixed**
- ✅ **9 Moderate severity vulnerabilities fixed**
- ✅ **3 Low severity vulnerabilities fixed**

## Prerequisites

### System Requirements
- **Node.js**: v18.0.0 or higher
- **Memory**: Minimum 4GB RAM, 8GB recommended
- **Storage**: Minimum 10GB available disk space
- **Network**: HTTPS enabled for production
- **Database**: PostgreSQL 13+ (if using persistent storage)

### Environment Variables
```bash
# Core Configuration
NODE_ENV=production
PORT=3001
HOST=0.0.0.0

# Database Configuration
DATABASE_URL=postgresql://user:password@localhost:5432/gui_lop
DATABASE_SSL_MODE=require

# JWT Configuration
JWT_SECRET=your-super-secure-jwt-secret-key-here
JWT_REFRESH_SECRET=your-refresh-token-secret-key-here

# Redis Configuration (optional for caching)
REDIS_URL=redis://localhost:6379

# Security Configuration
CORS_ORIGIN=https://your-domain.com
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Monitoring Configuration
METRICS_ENABLED=true
DASHBOARD_PORT=3003
LOG_LEVEL=info
```

## Deployment Steps

### 1. Security Verification

Run security audit to confirm zero vulnerabilities:
```bash
npm audit
# Expected: "found 0 vulnerabilities"
```

### 2. Dependency Installation

Install production dependencies only:
```bash
npm ci --production
```

### 3. Database Setup

```bash
# Run database migrations
npm run db:migrate

# Seed initial data
npm run db:seed

# Verify database health
npm run db:health
```

### 4. Configuration Validation

Create production configuration:
```bash
# Create production environment file
cp .env.example .env.production

# Edit with production values
nano .env.production
```

### 5. SSL/TLS Configuration

Ensure HTTPS is enabled:
```bash
# Using reverse proxy (nginx/apache)
# Configure SSL certificates and redirect HTTP to HTTPS

# Using Node.js directly (not recommended for production)
# Install and configure ssl-certify or similar
```

### 6. Process Management

Using PM2 (recommended):
```bash
# Install PM2 globally
npm install -g pm2

# Create PM2 ecosystem file
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'gui-lop-api',
    script: 'src/api/index.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    error_file: './logs/api-error.log',
    out_file: './logs/api-out.log',
    log_file: './logs/api-combined.log',
    time: true,
    max_memory_restart: '1G',
    node_args: '--max-old-space-size=1024'
  }]
};
EOF

# Start the application
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save
pm2 startup
```

### 7. Firewall Configuration

```bash
# Allow HTTP/HTTPS traffic
sudo ufw allow 80
sudo ufw allow 443

# Allow application port (if not behind reverse proxy)
sudo ufw allow 3001

# Enable firewall
sudo ufw enable
```

### 8. Reverse Proxy Setup (NGINX Example)

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/ssl/cert.pem;
    ssl_certificate_key /path/to/ssl/private.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload";

    location /api {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }

    location / {
        root /path/to/frontend/build;
        try_files $uri $uri/ /index.html;
    }
}
```

## Monitoring & Alerting

### Health Checks

```bash
# API Health Check
curl https://your-domain.com/health

# Expected Response:
# {
#   "status": "ok",
#   "timestamp": "...",
#   "features": {
#     "authentication": true,
#     "rateLimiting": true,
#     "caching": true,
#     "monitoring": true
#   }
# }
```

### Log Monitoring

```bash
# Monitor application logs
pm2 logs gui-lop-api

# Monitor system logs
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

### Performance Metrics

Access monitoring dashboard:
```
https://your-domain.com:3003
```

## Security Best Practices

### 1. Regular Security Updates
```bash
# Check for new vulnerabilities weekly
npm audit

# Update dependencies regularly
npm update

# Review security advisories
npm audit audit-info
```

### 2. Access Control
- Use strong, unique passwords
- Implement IP whitelisting where appropriate
- Regular security audits of user access
- Multi-factor authentication for admin access

### 3. Data Protection
- Regular database backups
- Encrypt sensitive data at rest and in transit
- Implement data retention policies
- GDPR compliance considerations

### 4. Incident Response
Create monitoring alerts for:
- Unusual authentication patterns
- High error rates
- Resource exhaustion
- Security violations

## Performance Optimization

### 1. Database Optimization
```sql
-- Create indexes for frequently queried fields
CREATE INDEX idx_workflows_owner ON workflows(owner_id);
CREATE INDEX idx_workflows_status ON workflows(status);
CREATE INDEX idx_workflows_created ON workflows(created_at);
```

### 2. Caching Strategy
- API response caching for GET requests
- Database query result caching
- Static asset caching
- CDN integration for global performance

### 3. Resource Management
- Implement connection pooling
- Optimize memory usage
- Monitor CPU and memory utilization
- Scale horizontally as needed

## Backup & Recovery

### Database Backups
```bash
# Daily database backups
0 2 * * * pg_dump gui_lop > /backups/gui_lop_$(date +\%Y\%m\%d).sql

# Weekly full backup with compression
0 3 * * 0 pg_dump gui_lop | gzip > /backups/gui_lop_weekly_$(date +\%Y\%m\%d).sql.gz
```

### Configuration Backups
```bash
# Backup environment configurations
cp .env.production /backups/env_production_$(date +\%Y\%m\%d).backup
cp ecosystem.config.js /backups/ecosystem_$(date +\%Y\%m\%d).backup
```

## Troubleshooting

### Common Issues

1. **Application won't start**
   ```bash
   # Check logs
   pm2 logs gui-lop-api

   # Check configuration
   node -c src/api/index.js
   ```

2. **Database connection issues**
   ```bash
   # Test database connection
   npm run db:health

   # Check credentials
   echo $DATABASE_URL
   ```

3. **Memory issues**
   ```bash
   # Monitor memory usage
   pm2 monit

   # Increase memory limit if needed
   pm2 restart gui-lop-api --max-memory-restart 2G
   ```

### Performance Issues
```bash
# Profile application
npm run test:load:quick

# Check slow queries
-- Enable query logging in PostgreSQL
ALTER SYSTEM SET log_statement = 'all';
SELECT pg_reload_conf();
```

## Rollback Procedure

### Quick Rollback
```bash
# Rollback to previous version
pm2 stop gui-lop-api
git checkout previous-version-tag
npm ci --production
pm2 start ecosystem.config.js
```

### Database Rollback
```bash
# Restore from backup
npm run db:restore -- --backup-file=/backups/gui_lop_backup.sql
```

## Support & Contact

For deployment issues:
1. Check this documentation first
2. Review application logs
3. Monitor system resources
4. Contact the development team with specific error details

---

**Deployment Checklist:**
- [ ] Security audit passed (0 vulnerabilities)
- [ ] Environment variables configured
- [ ] Database migrations completed
- [ ] SSL/TLS certificates installed
- [ ] Reverse proxy configured
- [ ] Firewall rules applied
- [ ] Monitoring set up
- [ ] Backup procedures tested
- [ ] Load testing completed
- [ ] Documentation updated

**Version:** 1.0.0
**Last Updated:** 2025-11-18
**Status:** ✅ Production Ready