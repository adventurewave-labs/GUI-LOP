# GUI-LOP Enhanced API Documentation

## Overview

This enhanced API implementation provides comprehensive production-ready features for the GUI-LOP platform, including advanced authentication, real-time monitoring, rate limiting, caching, and extensive API documentation.

## Features

### 🔐 Authentication & Security
- JWT-based authentication with refresh tokens
- Secure password hashing with bcrypt
- Rate limiting for authentication endpoints
- Input validation and sanitization
- CORS configuration
- Helmet security headers

### 📊 Real-time Monitoring & Analytics
- **Dashboard**: Real-time monitoring dashboard at `http://localhost:3003`
- **Metrics**: Request/response times, error rates, user activity
- **Alerts**: Configurable alerts for performance thresholds
- **Charts**: Interactive charts for response times and request volume
- **WebSocket**: Real-time updates via Socket.IO

### 🚀 API Documentation
- **OpenAPI 3.1**: Complete specification in `/docs/openapi.yaml`
- **Swagger UI**: Interactive documentation at `http://localhost:3001/docs`
- **ReDoc**: Alternative documentation at `http://localhost:3001/redoc`
- **Postman**: Auto-generated collection

### ⚡ Performance & Caching
- **Response Caching**: Memory and Redis-based caching
- **Rate Limiting**: Multiple strategies (progressive, role-based, adaptive)
- **Compression**: Gzip compression for responses
- **Metrics Collection**: Performance monitoring and bottlenecks detection

### 🛡️ Error Handling & Validation
- **Comprehensive Validation**: JSON schema validation for all endpoints
- **Error Recovery**: Circuit breaker pattern for resilience
- **Detailed Errors**: Structured error responses with proper HTTP codes
- **Request Tracking**: Unique request IDs for debugging

### 🧪 Testing & Quality Assurance
- **Unit Tests**: Comprehensive test coverage for all components
- **Integration Tests**: End-to-end workflow testing
- **Performance Tests**: Load testing and benchmarking
- **Security Tests**: Authentication and authorization testing

## Quick Start

### Installation

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration
```

### Environment Configuration

```bash
# Required
API_PORT=3001
JWT_SECRET=your-secret-key
FRONTEND_URL=http://localhost:3000

# Optional
ENABLE_RATE_LIMITING=true
ENABLE_CACHE=true
ENABLE_MONITORING=true
ENABLE_API_DOCS=true
DASHBOARD_PORT=3003
```

### Running the API

```bash
# Development
npm run dev:api

# Production
npm start:api

# With frontend
npm run dev:api-full
```

### Access Points

- **API Server**: http://localhost:3001
- **API Documentation**: http://localhost:3001/docs
- **Monitoring Dashboard**: http://localhost:3003
- **Health Check**: http://localhost:3001/health

## API Endpoints

### Authentication
- `POST /api/v1/auth/register` - User registration
- `POST /api/v1/auth/login` - User login
- `POST /api/v1/auth/refresh` - Refresh access token
- `POST /api/v1/auth/logout` - User logout
- `POST /api/v1/auth/change-password` - Change password

### Workflows
- `GET /api/v1/workflows` - List workflows
- `POST /api/v1/workflows` - Create workflow
- `GET /api/v1/workflows/:id` - Get workflow details
- `PUT /api/v1/workflows/:id` - Update workflow
- `DELETE /api/v1/workflows/:id` - Delete workflow
- `POST /api/v1/workflows/:id/execute` - Execute workflow
- `POST /api/v1/workflows/:id/respond` - Respond to workflow

### Public Endpoints
- `GET /health` - Health check
- `GET /api/public/status` - Public status
- `GET /api/v1/workflows/templates` - Workflow templates

### Monitoring
- `GET /metrics` - Prometheus metrics (if enabled)
- WebSocket: `/api/v1/ws` - Real-time updates

## Rate Limiting

### Default Limits
- **General**: 1000 requests per 15 minutes
- **Authentication**: 5 attempts per 15 minutes
- **Registration**: 3 attempts per hour
- **Password Changes**: 5 attempts per hour
- **Workflow Creation**: 50 per hour
- **Workflow Execution**: 100 per hour

### Headers
Rate limit information is included in response headers:
- `X-RateLimit-Limit`: Request limit
- `X-RateLimit-Remaining`: Remaining requests
- `X-RateLimit-Reset`: Reset time

## Caching

### Strategies
- **Memory Cache**: Default for development
- **Redis Cache**: Recommended for production
- **Response Compression**: Gzip for API responses

### Cacheable Endpoints
- `GET /api/v1/workflows/templates` - 5 minutes TTL
- `GET /health` - 1 minute TTL

## Error Handling

### Error Response Format
```json
{
  "success": false,
  "message": "Error description",
  "code": "ERROR_CODE",
  "details": {
    "field": "validation error"
  },
  "timestamp": "2024-01-01T00:00:00.000Z",
  "requestId": "req_123456789"
}
```

### Common HTTP Status Codes
- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `429` - Too Many Requests
- `500` - Internal Server Error

## Testing

### Running Tests
```bash
# All API tests
npm run test:api

# Unit tests only
npm run test:api:unit

# Integration tests
npm run test:api:integration

# Performance tests
npm run test:api:performance

# Coverage report
npm run test:api -- --coverage
```

### Test Structure
```
tests/api/
├── setup.js                 # Test environment setup
├── unit/                    # Unit tests
│   ├── auth.test.js        # Authentication tests
│   ├── validation.test.js  # Validation tests
│   └── middleware.test.js  # Middleware tests
├── integration/             # Integration tests
│   ├── workflows.test.js   # Workflow tests
│   └── auth.test.js       # Auth integration tests
└── e2e/                    # End-to-end tests
    ├── api-performance.test.js # Performance tests
    └── load.test.js       # Load tests
```

## Monitoring Dashboard

### Features
- **Real-time Metrics**: Request rates, response times, error rates
- **System Monitoring**: Memory usage, CPU, uptime
- **Alert System**: Configurable alerts for performance thresholds
- **Interactive Charts**: Response time trends, request volume
- **Top Endpoints**: Most accessed API endpoints
- **User Activity**: Active users and session tracking

### Access
Visit `http://localhost:3003` to access the monitoring dashboard.

### WebSocket Events
```javascript
// Connect to real-time updates
const socket = io('http://localhost:3003');

// Listen for metrics updates
socket.on('metrics', (data) => {
  console.log('Real-time metrics:', data);
});

// Listen for alerts
socket.on('alert', (alert) => {
  console.log('Alert:', alert);
});
```

## Configuration

### API Configuration
All configuration is managed through environment variables. See `src/api/config/index.js` for complete options.

### Key Configuration Areas
- **Server**: Port, host, request size limits
- **Authentication**: JWT settings, password policies
- **Rate Limiting**: Request limits, Redis configuration
- **Caching**: Cache strategy, TTL settings
- **Database**: PostgreSQL connection settings
- **Monitoring**: Metrics collection, alert thresholds
- **Security**: CORS, helmet, validation settings

## Deployment

### Production Checklist
- [ ] Set strong JWT secrets
- [ ] Configure production database
- [ ] Set up Redis for caching
- [ ] Configure rate limiting
- [ ] Set up monitoring alerts
- [ ] Enable HTTPS
- [ ] Configure CORS for production domains
- [ ] Set up log aggregation
- [ ] Configure backup strategy

### Docker Deployment
```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY src/ ./src/
EXPOSE 3001 3003

CMD ["npm", "start:api"]
```

### Environment Variables for Production
```bash
NODE_ENV=production
API_PORT=3001
JWT_SECRET=your-production-secret
DB_HOST=your-database-host
REDIS_HOST=your-redis-host
ENABLE_MONITORING=true
ENABLE_CACHE=true
```

## Contributing

1. Follow the existing code style
2. Write tests for new features
3. Update documentation
4. Run the full test suite before submitting
5. Ensure all rate limits and security measures are in place

## Support

- **Documentation**: See `/docs` directory for detailed API specs
- **Issues**: Create GitHub issues for bugs or feature requests
- **Monitoring**: Check the dashboard for system health

## License

MIT License - see LICENSE file for details.