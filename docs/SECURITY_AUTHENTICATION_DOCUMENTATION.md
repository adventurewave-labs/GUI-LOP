# GUI-LOP Phase 1 Authentication Security Documentation

**Version:** 1.0.0
**Date:** October 26, 2025
**Classification:** Confidential - Security Information
**Author:** Security Architecture Team

---

## Executive Summary

### Authentication Security Overview

This document provides comprehensive security specifications for Phase 1 authentication implementation of the **Generative UI & Human-in-the-Loop Orchestration Platform (GUI-LOP)**. The security framework addresses identity verification, access control, data protection, and compliance requirements for enterprise-grade deployment.

### Security Objectives

1. **Zero Trust Architecture**: Implement principle of least privilege with continuous verification
2. **Defense in Depth**: Multiple security layers to prevent, detect, and respond to threats
3. **Data Protection**: End-to-end encryption and secure handling of sensitive information
4. **Compliance Alignment**: GDPR, SOC 2, and industry regulatory compliance
5. **Operational Excellence**: Scalable security processes and automated monitoring

### Risk Assessment Summary

**Critical Security Risks Addressed:**
- Unauthorized access to workflow systems
- Data breach and information leakage
- Session hijacking and man-in-the-middle attacks
- Insider threats and privilege escalation
- Compliance violations and legal exposure

---

## Authentication Architecture Overview

### High-Level Security Architecture

```mermaid
graph TB
    subgraph "Client Security Layer"
        BROWSER[Web Browser]
        CLIENT_AUTH[Client Authentication]
        TOKEN_STORE[Secure Token Storage]
    end

    subgraph "Network Security Layer"
        WAF[Web Application Firewall]
        LB[Load Balancer]
        DDOS[DDoS Protection]
    end

    subgraph "Application Security Layer"
        API_GATEWAY[API Gateway]
        AUTH_SERVICE[Authentication Service]
        SESSION_MGR[Session Manager]
        RATE_LIMITER[Rate Limiter]
    end

    subgraph "Data Security Layer"
        USER_DB[(User Database)]
        SESSION_STORE[(Session Store)]
        AUDIT_LOG[(Audit Logs)]
    end

    BROWSER --> WAF
    WAF --> LB
    LB --> API_GATEWAY
    API_GATEWAY --> AUTH_SERVICE
    AUTH_SERVICE --> SESSION_MGR
    AUTH_SERVICE --> USER_DB
    SESSION_MGR --> SESSION_STORE
    AUTH_SERVICE --> AUDIT_LOG
```

### Authentication Flow Architecture

```mermaid
sequenceDiagram
    participant Client
    participant Gateway
    participant AuthService
    participant UserStore
    participant SessionStore
    participant AuditLog

    Client->>Gateway: Login Request
    Gateway->>AuthService: Authenticate Request
    AuthService->>UserStore: Validate Credentials
    UserStore->>AuthService: User Data + Permissions
    AuthService->>SessionStore: Create Session
    AuthService->>AuditLog: Log Authentication Event
    AuthService->>Gateway: JWT + Refresh Token
    Gateway->>Client: Authentication Response

    Note over Client,AuditLog: Subsequent API Requests
    Client->>Gateway: API Request + JWT
    Gateway->>AuthService: Validate JWT
    AuthService->>SessionStore: Check Session Validity
    AuthService->>AuditLog: Log API Access
    AuthService->>Gateway: Authentication Success
    Gateway->>Client: API Response
```

### Security Control Categories

#### 1. Identity and Access Management (IAM)
- **Multi-Factor Authentication (MFA)**: TOTP, SMS, and hardware token support
- **Single Sign-On (SSO)**: SAML 2.0 and OAuth 2.0 integration
- **Role-Based Access Control (RBAC)**: Granular permission management
- **Password Policies**: Strong password requirements and rotation

#### 2. Session and Token Management
- **JWT Implementation**: Secure token generation and validation
- **Refresh Tokens**: Secure token renewal mechanism
- **Session Timeout**: Configurable session lifecycle management
- **Token Revocation**: Immediate token invalidation capabilities

#### 3. Network Security
- **TLS 1.3**: End-to-end encryption for all communications
- **CORS Configuration**: Strict cross-origin resource sharing policies
- **Rate Limiting**: Request throttling and abuse prevention
- **DDoS Protection**: Distributed denial of service mitigation

#### 4. Data Protection
- **Encryption at Rest**: AES-256 encryption for stored data
- **Encryption in Transit**: TLS 1.3 for all data transfers
- **Data Masking**: Sensitive data obfuscation in logs
- **Key Management**: Secure cryptographic key lifecycle management

---

## Phase 1 Authentication Implementation

### Current System Security Analysis

#### Existing Security Measures
```javascript
// Current CORS Configuration
app.use(cors({
  origin: ['http://localhost:3000'], // Restrictive origin policy
  credentials: true // Secure cookie handling
}));

// Current Input Validation
app.use(express.json({ limit: '10mb' })); // Size limit enforcement
```

#### Security Gaps Identified
1. **No Authentication System**: Absence of user identity verification
2. **No Session Management**: No user session tracking or timeout
3. **No Authorization Model**: No permission-based access control
4. **No Audit Logging**: Limited security event tracking
5. **No Rate Limiting**: Vulnerable to brute force attacks

### Phase 1 Security Enhancements

#### 1. Authentication Service Implementation

```javascript
// Enhanced Authentication Middleware
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

class AuthenticationService {
  constructor() {
    this.JWT_SECRET = process.env.JWT_SECRET;
    this.JWT_EXPIRES_IN = '15m';
    this.REFRESH_TOKEN_EXPIRES_IN = '7d';
    this.MAX_LOGIN_ATTEMPTS = 5;
    this.LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes
  }

  // Secure password hashing
  async hashPassword(password) {
    const saltRounds = 12;
    return await bcrypt.hash(password, saltRounds);
  }

  // JWT token generation
  generateTokens(user) {
    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      permissions: user.permissions
    };

    const accessToken = jwt.sign(payload, this.JWT_SECRET, {
      expiresIn: this.JWT_EXPIRES_IN,
      issuer: 'gui-lop',
      audience: 'gui-lop-users'
    });

    const refreshToken = crypto.randomBytes(64).toString('hex');

    return { accessToken, refreshToken };
  }

  // Token validation middleware
  authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        error: 'Access token required',
        code: 'TOKEN_MISSING'
      });
    }

    jwt.verify(token, this.JWT_SECRET, (err, user) => {
      if (err) {
        return res.status(403).json({
          error: 'Invalid or expired token',
          code: 'TOKEN_INVALID'
        });
      }
      req.user = user;
      next();
    });
  }

  // Rate limiting for authentication endpoints
  checkRateLimit(req, res, next) {
    const clientIP = req.ip;
    const attempts = this.getLoginAttempts(clientIP);

    if (attempts >= this.MAX_LOGIN_ATTEMPTS) {
      return res.status(429).json({
        error: 'Too many login attempts',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: this.LOCKOUT_DURATION / 1000
      });
    }

    next();
  }
}
```

#### 2. Enhanced Security Middleware

```javascript
// Security Headers Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// Enhanced CORS Configuration
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = process.env.ALLOWED_ORIGINS.split(',');
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Rate Limiting Configuration
import rateLimit from 'express-rate-limit';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: {
    error: 'Too many authentication attempts',
    code: 'AUTH_RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: {
    error: 'Too many requests',
    code: 'API_RATE_LIMIT_EXCEEDED'
  }
});
```

#### 3. Secure User Management

```javascript
// User Model with Security Features
class User {
  constructor(userData) {
    this.id = userData.id;
    this.email = userData.email;
    this.passwordHash = userData.passwordHash;
    this.role = userData.role || 'user';
    this.permissions = userData.permissions || [];
    this.isActive = userData.isActive || true;
    this.lastLogin = userData.lastLogin || null;
    this.loginAttempts = userData.loginAttempts || 0;
    this.lockedUntil = userData.lockedUntil || null;
    this.mfaSecret = userData.mfaSecret || null;
    this.mfaEnabled = userData.mfaEnabled || false;
    this.createdAt = userData.createdAt || new Date();
    this.updatedAt = userData.updatedAt || new Date();
  }

  // Account lockout management
  isLocked() {
    return !!(this.lockedUntil && this.lockedUntil > Date.now());
  }

  // Increment login attempts
  async incrementLoginAttempts() {
    this.loginAttempts += 1;
    this.updatedAt = new Date();

    if (this.loginAttempts >= 5) {
      this.lockedUntil = Date.now() + (15 * 60 * 1000); // 15 minutes
    }
  }

  // Reset on successful login
  async resetLoginAttempts() {
    this.loginAttempts = 0;
    this.lockedUntil = null;
    this.lastLogin = new Date();
    this.updatedAt = new Date();
  }

  // Permission checking
  hasPermission(permission) {
    return this.permissions.includes(permission) || this.permissions.includes('*');
  }
}
```

#### 4. Secure WebSocket Implementation

```javascript
// Enhanced WebSocket Security
import { WebSocketServer } from 'ws';

class SecureWebSocketServer {
  constructor(server, authService) {
    this.wss = new WebSocketServer({
      server,
      verifyClient: this.verifyClient.bind(this)
    });
    this.authService = authService;
    this.sessions = new Map();

    this.setupSecurityHandlers();
  }

  // Client verification before connection
  verifyClient(info) {
    const token = this.extractToken(info.req);

    if (!token) {
      return false;
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      info.req.user = decoded;
      return true;
    } catch (error) {
      return false;
    }
  }

  // Extract token from WebSocket upgrade request
  extractToken(req) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    return url.searchParams.get('token');
  }

  // Secure connection handling
  setupSecurityHandlers() {
    this.wss.on('connection', (ws, req) => {
      const sessionId = crypto.randomUUID();
      const userId = req.user.userId;

      // Store secure session
      this.sessions.set(sessionId, {
        userId,
        connectedAt: Date.now(),
        lastActivity: Date.now(),
        ipAddress: req.socket.remoteAddress
      });

      // Secure message handling
      ws.on('message', (data) => {
        try {
          // Message size validation
          if (data.length > 1024 * 1024) { // 1MB limit
            ws.close(1009, 'Message too large');
            return;
          }

          const message = JSON.parse(data.toString());

          // Message validation
          if (!this.validateMessage(message)) {
            ws.send(JSON.stringify({
              type: 'error',
              code: 'INVALID_MESSAGE_FORMAT'
            }));
            return;
          }

          // Update activity timestamp
          const session = this.sessions.get(sessionId);
          if (session) {
            session.lastActivity = Date.now();
          }

          this.handleSecureMessage(ws, message, sessionId);

        } catch (error) {
          // Silently handle malformed messages
          ws.close(1003, 'Invalid data');
        }
      });

      // Secure disconnection
      ws.on('close', () => {
        this.sessions.delete(sessionId);
        this.logSecurityEvent('WEBSOCKET_DISCONNECTED', {
          userId,
          sessionId,
          duration: Date.now() - this.sessions.get(sessionId)?.connectedAt
        });
      });
    });
  }

  // Message format validation
  validateMessage(message) {
    const allowedTypes = ['workflow_request', 'human_response', 'ping'];
    return message.type && allowedTypes.includes(message.type) &&
           typeof message.data === 'object';
  }
}
```

---

## API Security Endpoints Documentation

### Authentication Endpoints

#### POST /api/auth/login
**Description:** Authenticate user and return access tokens

**Request:**
```http
POST /api/auth/login
Content-Type: application/json
X-Forwarded-For: <client-ip>
User-Agent: <client-info>

{
  "email": "user@example.com",
  "password": "securePassword123",
  "mfaCode": "123456",
  "rememberMe": false
}
```

**Response (200 OK):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "a1b2c3d4e5f6...",
  "expiresIn": 900,
  "tokenType": "Bearer",
  "user": {
    "id": "uuid-v4",
    "email": "user@example.com",
    "role": "user",
    "permissions": ["workflow:create", "workflow:read"],
    "lastLogin": "2025-10-26T10:00:00.000Z"
  }
}
```

**Security Headers:**
```http
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

#### POST /api/auth/refresh
**Description:** Refresh access token using refresh token

**Request:**
```http
POST /api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "a1b2c3d4e5f6..."
}
```

**Response (200 OK):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 900,
  "tokenType": "Bearer"
}
```

#### POST /api/auth/logout
**Description:** Logout user and invalidate tokens

**Request:**
```http
POST /api/auth/logout
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "refreshToken": "a1b2c3d4e5f6..."
}
```

**Response (200 OK):**
```json
{
  "message": "Successfully logged out",
  "revokedAt": "2025-10-26T10:00:00.000Z"
}
```

#### POST /api/auth/mfa/setup
**Description:** Setup multi-factor authentication

**Request:**
```http
POST /api/auth/mfa/setup
Authorization: Bearer <access-token>
Content-Type: application/json
```

**Response (200 OK):**
```json
{
  "qrCode": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
  "secret": "JBSWY3DPEHPK3PXP",
  "backupCodes": [
    "12345678",
    "87654321",
    "11111111",
    "22222222"
  ]
}
```

### User Management Endpoints

#### GET /api/users/profile
**Description:** Get current user profile

**Request:**
```http
GET /api/users/profile
Authorization: Bearer <access-token>
```

**Response (200 OK):**
```json
{
  "id": "uuid-v4",
  "email": "user@example.com",
  "role": "user",
  "permissions": ["workflow:create", "workflow:read"],
  "mfaEnabled": true,
  "createdAt": "2025-10-01T00:00:00.000Z",
  "lastLogin": "2025-10-26T10:00:00.000Z",
  "loginAttempts": 0,
  "isActive": true
}
```

#### PUT /api/users/password
**Description:** Change user password

**Request:**
```http
PUT /api/users/password
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "currentPassword": "oldPassword123",
  "newPassword": "newSecurePassword456"
}
```

**Response (200 OK):**
```json
{
  "message": "Password updated successfully",
  "updatedAt": "2025-10-26T10:00:00.000Z"
}
```

### Security Monitoring Endpoints

#### GET /api/security/sessions
**Description:** Get active user sessions

**Request:**
```http
GET /api/security/sessions
Authorization: Bearer <access-token>
```

**Response (200 OK):**
```json
{
  "sessions": [
    {
      "id": "session-uuid",
      "createdAt": "2025-10-26T09:00:00.000Z",
      "lastActivity": "2025-10-26T10:00:00.000Z",
      "ipAddress": "192.168.1.100",
      "userAgent": "Mozilla/5.0...",
      "isActive": true
    }
  ],
  "total": 1
}
```

#### DELETE /api/security/sessions/:sessionId
**Description:** Revoke specific session

**Request:**
```http
DELETE /api/security/sessions/session-uuid
Authorization: Bearer <access-token>
```

**Response (200 OK):**
```json
{
  "message": "Session revoked successfully",
  "revokedAt": "2025-10-26T10:00:00.000Z"
}
```

### Security Error Responses

#### 401 Unauthorized
```json
{
  "error": "Authentication required",
  "code": "AUTH_REQUIRED",
  "timestamp": "2025-10-26T10:00:00.000Z",
  "path": "/api/workflows"
}
```

#### 403 Forbidden
```json
{
  "error": "Insufficient permissions",
  "code": "INSUFFICIENT_PERMISSIONS",
  "required": ["workflow:admin"],
  "granted": ["workflow:read"],
  "timestamp": "2025-10-26T10:00:00.000Z",
  "path": "/api/workflows/admin"
}
```

#### 429 Too Many Requests
```json
{
  "error": "Rate limit exceeded",
  "code": "RATE_LIMIT_EXCEEDED",
  "retryAfter": 900,
  "limit": 100,
  "window": 60,
  "timestamp": "2025-10-26T10:00:00.000Z"
}
```

---

## Security Best Practices Guide for Developers

### Development Security Standards

#### 1. Secure Coding Practices

##### Input Validation
```javascript
// ✅ Secure: Comprehensive input validation
const validateWorkflowInput = (input) => {
  const schema = Joi.object({
    template: Joi.string().valid('data-analysis', 'decision-making', 'content-creation').required(),
    context: Joi.object().max(1000).pattern(/^[a-zA-Z0-9_-]+$/, Joi.any()).required(),
    priority: Joi.number().integer().min(1).max(10).default(5)
  });

  const { error, value } = schema.validate(input);
  if (error) {
    throw new ValidationError(`Invalid input: ${error.message}`);
  }

  return value;
};

// ❌ Insecure: No input validation
app.post('/api/workflows', (req, res) => {
  const { template, context } = req.body; // Direct use without validation
  // Process input...
});
```

##### SQL Injection Prevention
```javascript
// ✅ Secure: Parameterized queries
const getUserWorkflows = async (userId) => {
  const query = 'SELECT * FROM workflows WHERE user_id = $1 AND is_deleted = false';
  return await db.query(query, [userId]);
};

// ❌ Insecure: String concatenation
const getUserWorkflows = async (userId) => {
  const query = `SELECT * FROM workflows WHERE user_id = '${userId}'`; // SQL injection risk
  return await db.query(query);
};
```

##### XSS Prevention
```javascript
// ✅ Secure: Output encoding
const renderWorkflowName = (name) => {
  return escapeHtml(name); // Proper HTML escaping
};

// ❌ Insecure: Direct output
const renderWorkflowName = (name) => {
  return name; // XSS vulnerability
};
```

#### 2. Authentication and Authorization

##### Secure Password Handling
```javascript
// ✅ Secure: Strong password hashing
import bcrypt from 'bcrypt';

const hashPassword = async (password) => {
  const saltRounds = 12;
  return await bcrypt.hash(password, saltRounds);
};

const verifyPassword = async (password, hash) => {
  return await bcrypt.compare(password, hash);
};

// ❌ Insecure: Weak or no hashing
const hashPassword = (password) => {
  return crypto.createHash('md5').update(password).digest('hex'); // Weak hashing
};
```

##### JWT Implementation
```javascript
// ✅ Secure: JWT with proper claims and validation
const generateToken = (user) => {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (15 * 60) // 15 minutes
    },
    process.env.JWT_SECRET,
    {
      algorithm: 'HS256',
      issuer: 'gui-lop',
      audience: 'gui-lop-users'
    }
  );
};

// ❌ Insecure: JWT with weak secrets and long expiry
const generateToken = (user) => {
  return jwt.sign(
    { userId: user.id },
    'weak-secret', // Hardcoded weak secret
    { expiresIn: '365d' } // Too long expiry
  );
};
```

#### 3. Data Protection

##### Sensitive Data Handling
```javascript
// ✅ Secure: Data masking and encryption
const logUserActivity = (user, action) => {
  const sanitizedUser = {
    id: user.id,
    email: maskEmail(user.email), // Mask email in logs
    role: user.role
  };

  logger.info('User action', { user: sanitizedUser, action });
};

const maskEmail = (email) => {
  const [username, domain] = email.split('@');
  return `${username.slice(0, 2)}***@${domain}`;
};

// ❌ Insecure: Logging sensitive data
const logUserActivity = (user, action) => {
  logger.info('User action', { user, action }); // Logs sensitive data
};
```

##### Environment Variable Security
```javascript
// ✅ Secure: Environment-based configuration
const config = {
  jwtSecret: process.env.JWT_SECRET,
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,
  port: process.env.PORT || 3001
};

// Validate required environment variables
const requiredEnvVars = ['JWT_SECRET', 'DATABASE_URL'];
requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    throw new Error(`Required environment variable ${varName} is missing`);
  }
});

// ❌ Insecure: Hardcoded secrets
const config = {
  jwtSecret: 'super-secret-key-123', // Hardcoded secret
  databaseUrl: 'mongodb://localhost:27017/gui-lop'
};
```

#### 4. Error Handling and Logging

##### Secure Error Responses
```javascript
// ✅ Secure: Generic error messages for security
const handleAuthError = (error, res) => {
  logger.error('Authentication error', {
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString()
  });

  // Send generic error to client
  res.status(401).json({
    error: 'Authentication failed',
    code: 'AUTH_FAILED',
    timestamp: new Date().toISOString()
  });
};

// ❌ Insecure: Detailed error messages
const handleAuthError = (error, res) => {
  res.status(401).json({
    error: error.message, // May reveal sensitive information
    stack: error.stack,
    sqlQuery: error.query // SQL query exposure
  });
};
```

##### Security Logging
```javascript
// ✅ Secure: Comprehensive security logging
const logSecurityEvent = (eventType, details) => {
  const securityLog = {
    timestamp: new Date().toISOString(),
    eventType,
    severity: getSeverityLevel(eventType),
    sourceIP: details.ip,
    userAgent: details.userAgent,
    userId: details.userId,
    sessionId: details.sessionId,
    resource: details.resource,
    outcome: details.outcome,
    additionalDetails: sanitizeDetails(details)
  };

  logger.info('Security Event', securityLog);

  // Send to SIEM system
  siem.send(securityLog);
};

// ❌ Insecure: No security logging
const handleLogin = (req, res) => {
  // No logging of authentication attempts
  res.json({ token: '...' });
};
```

#### 5. Frontend Security

##### Secure Token Storage
```javascript
// ✅ Secure: HttpOnly cookies for token storage
const setAuthCookie = (res, token) => {
  res.cookie('access_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 15 * 60 * 1000, // 15 minutes
    path: '/'
  });
};

// ❌ Insecure: Local storage for sensitive tokens
const setAuthCookie = (res, token) => {
  localStorage.setItem('access_token', token); // XSS vulnerable
};
```

##### CSP Implementation
```javascript
// ✅ Secure: Content Security Policy
const cspPolicy = {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "https:"],
    connectSrc: ["'self'"],
    fontSrc: ["'self'"],
    objectSrc: ["'none'"],
    mediaSrc: ["'self'"],
    frameSrc: ["'none'"],
    upgradeInsecureRequests: []
  }
};

app.use(helmet.contentSecurityPolicy(cspPolicy));
```

### Development Environment Security

#### 1. Local Development Setup

##### Environment Configuration
```bash
# .env.example
# Copy this to .env and fill in actual values

# Security Configuration
JWT_SECRET=your-super-secure-jwt-secret-key-here-min-32-chars
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=7d

# Database Configuration
DATABASE_URL=postgresql://user:password@localhost:5432/gui_lop_dev
REDIS_URL=redis://localhost:6379

# CORS Configuration
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=info
SECURITY_LOG_LEVEL=warn
```

##### Development Docker Setup
```dockerfile
# Dockerfile.dev
FROM node:18-alpine

# Security-focused base image
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies with security audit
RUN npm ci --audit=moderate --audit-level=moderate && \
    npm audit fix || true

# Copy source code
COPY --chown=nextjs:nodejs . .

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3001

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "run", "dev"]
```

#### 2. Testing Security

##### Security Unit Tests
```javascript
// tests/security/auth.test.js
import request from 'supertest';
import app from '../../src/app.js';

describe('Authentication Security', () => {
  describe('POST /api/auth/login', () => {
    test('should prevent SQL injection in login', async () => {
      const maliciousInput = {
        email: "'; DROP TABLE users; --",
        password: "password"
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(maliciousInput);

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Authentication failed');
    });

    test('should enforce rate limiting', async () => {
      const loginData = {
        email: 'user@example.com',
        password: 'wrongpassword'
      };

      // Make 6 attempts (limit is 5)
      const promises = Array(6).fill().map(() =>
        request(app).post('/api/auth/login').send(loginData)
      );

      const responses = await Promise.all(promises);
      const lastResponse = responses[responses.length - 1];

      expect(lastResponse.status).toBe(429);
      expect(lastResponse.body.code).toBe('AUTH_RATE_LIMIT_EXCEEDED');
    });

    test('should validate input format', async () => {
      const invalidInputs = [
        { email: '', password: 'password' },
        { email: 'invalid-email', password: 'password' },
        { email: 'user@example.com' },
        { password: 'password' },
        { email: 'user@example.com', password: '' }
      ];

      for (const input of invalidInputs) {
        const response = await request(app)
          .post('/api/auth/login')
          .send(input);

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('VALIDATION_ERROR');
      }
    });
  });
});
```

##### Integration Security Tests
```javascript
// tests/security/api.test.js
describe('API Security', () => {
  let authToken;

  beforeEach(async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'test@example.com',
        password: 'testpassword'
      });
    authToken = response.body.accessToken;
  });

  test('should require authentication for protected endpoints', async () => {
    const response = await request(app)
      .get('/api/workflows');

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('TOKEN_MISSING');
  });

  test('should validate JWT tokens', async () => {
    const response = await request(app)
      .get('/api/workflows')
      .set('Authorization', 'Bearer invalid-token');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('TOKEN_INVALID');
  });

  test('should enforce authorization', async () => {
    const response = await request(app)
      .delete('/api/users/12345')
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('INSUFFICIENT_PERMISSIONS');
  });
});
```

### Code Review Security Checklist

#### Authentication & Authorization
- [ ] Passwords are properly hashed with strong algorithms (bcrypt, Argon2)
- [ ] JWT tokens have short expiration times and secure secrets
- [ ] Rate limiting is implemented on authentication endpoints
- [ ] Account lockout mechanisms are in place
- [ ] Multi-factor authentication is supported
- [ ] Permissions are properly validated on protected resources

#### Input Validation & Output Encoding
- [ ] All user inputs are validated and sanitized
- [ ] SQL queries use parameterized statements
- [ ] Output is properly encoded to prevent XSS
- [ ] File uploads have type and size restrictions
- [ ] API responses don't expose sensitive information

#### Data Protection
- [ ] Sensitive data is encrypted at rest and in transit
- [ ] Secrets are not hardcoded or committed to version control
- [ ] Logs don't contain sensitive information
- [ ] Proper data retention policies are implemented
- [ ] Privacy regulations are followed

#### Infrastructure Security
- [ ] HTTPS is enforced in production
- [ ] Security headers are properly configured
- [ ] CORS policies are restrictive
- [ ] Dependencies are regularly updated and audited
- [ ] Container images are scanned for vulnerabilities

---

## Security Testing Procedures and Checklists

### Security Testing Framework

#### 1. Automated Security Testing

##### Security Test Suite Configuration
```javascript
// tests/config/security-test.config.js
export const securityTestConfig = {
  // Authentication Security Tests
  authTests: {
    bruteForceProtection: {
      enabled: true,
      maxAttempts: 10,
      lockoutDuration: 15 * 60 * 1000
    },
    tokenSecurity: {
      jwtValidation: true,
      tokenExpiry: 15 * 60 * 1000,
      refreshRotation: true
    },
    passwordSecurity: {
      minLength: 12,
      complexity: true,
      pwnedCheck: true
    }
  },

  // API Security Tests
  apiTests: {
    injectionTests: {
      sqlInjection: true,
      nosqlInjection: true,
      xssProtection: true,
      commandInjection: true
    },
    authorizationTests: {
      rbacValidation: true,
      resourceIsolation: true,
      privilegeEscalation: true
    },
    rateLimiting: {
      endpointLimits: true,
      globalLimits: true,
      burstProtection: true
    }
  },

  // Network Security Tests
  networkTests: {
    tlsConfiguration: true,
    securityHeaders: true,
    corsPolicy: true,
    websocketSecurity: true
  }
};
```

##### Automated Security Test Runner
```javascript
// tests/security/automated-security-tests.js
import axios from 'axios';
import WebSocket from 'ws';
import { securityTestConfig } from '../config/security-test.config.js';

class SecurityTestRunner {
  constructor(baseURL) {
    this.baseURL = baseURL;
    this.testResults = [];
    this.authToken = null;
  }

  async runAllTests() {
    console.log('Starting automated security tests...');

    await this.runAuthenticationTests();
    await this.runAPISecurityTests();
    await this.runNetworkSecurityTests();
    await this.runWebSocketSecurityTests();

    this.generateReport();
  }

  async runAuthenticationTests() {
    console.log('Running authentication security tests...');

    // Test 1: Brute Force Protection
    await this.testBruteForceProtection();

    // Test 2: Password Security
    await this.testPasswordSecurity();

    // Test 3: JWT Token Security
    await this.testJWTSecurity();

    // Test 4: Session Management
    await this.testSessionManagement();
  }

  async testBruteForceProtection() {
    const testEmail = 'test@example.com';
    const testPassword = 'wrongpassword';
    let attempts = 0;
    let lockedOut = false;

    try {
      for (let i = 0; i < 12; i++) {
        attempts++;

        const response = await axios.post(`${this.baseURL}/api/auth/login`, {
          email: testEmail,
          password: testPassword
        }).catch(error => error.response);

        if (response?.status === 429) {
          lockedOut = true;
          break;
        }
      }

      this.addTestResult('Brute Force Protection', {
        passed: lockedOut && attempts >= 6,
        details: `Locked out after ${attempts} attempts`,
        severity: 'critical'
      });

    } catch (error) {
      this.addTestResult('Brute Force Protection', {
        passed: false,
        details: `Test failed: ${error.message}`,
        severity: 'critical'
      });
    }
  }

  async testJWTSecurity() {
    try {
      // Login to get valid token
      const loginResponse = await axios.post(`${this.baseURL}/api/auth/login`, {
        email: 'test@example.com',
        password: 'testpassword123'
      });

      const validToken = loginResponse.data.accessToken;

      // Test 1: Invalid token
      const invalidResponse = await axios.get(`${this.baseURL}/api/workflows`, {
        headers: { Authorization: 'Bearer invalid-token' }
      }).catch(error => error.response);

      // Test 2: Expired token
      const expiredToken = this.generateExpiredToken();
      const expiredResponse = await axios.get(`${this.baseURL}/api/workflows`, {
        headers: { Authorization: `Bearer ${expiredToken}` }
      }).catch(error => error.response);

      // Test 3: Token tampering
      const tamperedToken = validToken.slice(0, -10) + 'tampered';
      const tamperedResponse = await axios.get(`${this.baseURL}/api/workflows`, {
        headers: { Authorization: `Bearer ${tamperedToken}` }
      }).catch(error => error.response);

      const allTestsPassed =
        invalidResponse?.status === 403 &&
        expiredResponse?.status === 403 &&
        tamperedResponse?.status === 403;

      this.addTestResult('JWT Token Security', {
        passed: allTestsPassed,
        details: 'Invalid, expired, and tampered tokens properly rejected',
        severity: 'critical'
      });

    } catch (error) {
      this.addTestResult('JWT Token Security', {
        passed: false,
        details: `Test failed: ${error.message}`,
        severity: 'critical'
      });
    }
  }

  async runAPISecurityTests() {
    console.log('Running API security tests...');

    // Test 1: SQL Injection
    await this.testSQLInjection();

    // Test 2: XSS Protection
    await this.testXSSProtection();

    // Test 3: Authorization Bypass
    await this.testAuthorizationBypass();

    // Test 4: Rate Limiting
    await this.testRateLimiting();
  }

  async testSQLInjection() {
    const sqlInjectionPayloads = [
      "'; DROP TABLE users; --",
      "' OR '1'='1",
      "1' UNION SELECT * FROM users --",
      "'; UPDATE users SET password='hacked' WHERE '1'='1' --"
    ];

    let allTestsPassed = true;

    for (const payload of sqlInjectionPayloads) {
      try {
        const response = await axios.post(`${this.baseURL}/api/workflows`, {
          template: payload,
          context: { test: 'value' }
        }).catch(error => error.response);

        if (response?.status !== 400 && response?.status !== 401) {
          allTestsPassed = false;
          break;
        }
      } catch (error) {
        allTestsPassed = false;
        break;
      }
    }

    this.addTestResult('SQL Injection Protection', {
      passed: allTestsPassed,
      details: `Tested ${sqlInjectionPayloads.length} SQL injection payloads`,
      severity: 'critical'
    });
  }

  async testXSSProtection() {
    const xssPayloads = [
      '<script>alert("XSS")</script>',
      'javascript:alert("XSS")',
      '<img src="x" onerror="alert(\'XSS\')">',
      '<svg onload="alert(\'XSS\')">',
      '${alert(\'XSS\')}'
    ];

    let allTestsPassed = true;

    for (const payload of xssPayloads) {
      try {
        const response = await axios.post(`${this.baseURL}/api/workflows`, {
          template: 'data-analysis',
          context: { maliciousInput: payload }
        });

        // Check if payload is reflected without encoding
        const responseText = JSON.stringify(response.data);
        if (responseText.includes(payload) && !responseText.includes('script')) {
          allTestsPassed = false;
          break;
        }
      } catch (error) {
        // Expected for unauthorized requests
      }
    }

    this.addTestResult('XSS Protection', {
      passed: allTestsPassed,
      details: `Tested ${xssPayloads.length} XSS payloads`,
      severity: 'high'
    });
  }

  async runWebSocketSecurityTests() {
    console.log('Running WebSocket security tests...');

    // Test 1: Unauthorized connection
    await this.testUnauthorizedWebSocket();

    // Test 2: Message validation
    await this.testWebSocketMessageValidation();

    // Test 3: Connection limits
    await this.testWebSocketConnectionLimits();
  }

  async testUnauthorizedWebSocket() {
    try {
      const ws = new WebSocket('ws://localhost:3001');

      const connectionResult = await new Promise((resolve) => {
        ws.on('open', () => resolve('connected'));
        ws.on('error', () => resolve('rejected'));
        setTimeout(() => resolve('timeout'), 5000);
      });

      this.addTestResult('Unauthorized WebSocket Connection', {
        passed: connectionResult === 'rejected',
        details: `Connection result: ${connectionResult}`,
        severity: 'high'
      });

      ws.close();
    } catch (error) {
      this.addTestResult('Unauthorized WebSocket Connection', {
        passed: true,
        details: 'Connection properly rejected',
        severity: 'high'
      });
    }
  }

  addTestResult(testName, result) {
    this.testResults.push({
      testName,
      timestamp: new Date().toISOString(),
      ...result
    });
  }

  generateReport() {
    const passedTests = this.testResults.filter(r => r.passed).length;
    const totalTests = this.testResults.length;
    const criticalIssues = this.testResults.filter(r => r.severity === 'critical' && !r.passed);

    const report = {
      summary: {
        totalTests,
        passedTests,
        failedTests: totalTests - passedTests,
        criticalIssues: criticalIssues.length,
        timestamp: new Date().toISOString()
      },
      results: this.testResults,
      recommendations: this.generateRecommendations()
    };

    console.log('\n=== Security Test Report ===');
    console.log(`Total Tests: ${totalTests}`);
    console.log(`Passed: ${passedTests}`);
    console.log(`Failed: ${totalTests - passedTests}`);
    console.log(`Critical Issues: ${criticalIssues.length}`);

    if (criticalIssues.length > 0) {
      console.log('\n⚠️  CRITICAL SECURITY ISSUES FOUND:');
      criticalIssues.forEach(issue => {
        console.log(`  - ${issue.testName}: ${issue.details}`);
      });
    }

    return report;
  }

  generateRecommendations() {
    const recommendations = [];

    if (this.testResults.some(r => r.testName.includes('Brute Force') && !r.passed)) {
      recommendations.push('Implement account lockout and rate limiting on authentication endpoints');
    }

    if (this.testResults.some(r => r.testName.includes('JWT') && !r.passed)) {
      recommendations.push('Strengthen JWT validation and token management');
    }

    if (this.testResults.some(r => r.testName.includes('SQL Injection') && !r.passed)) {
      recommendations.push('Implement proper input validation and parameterized queries');
    }

    return recommendations;
  }

  generateExpiredToken() {
    return jwt.sign(
      { sub: 'test-user', iat: Math.floor(Date.now() / 1000) - 3600 },
      process.env.JWT_SECRET,
      { expiresIn: -1 }
    );
  }
}
```

#### 2. Manual Security Testing Procedures

##### Penetration Testing Checklist

**Authentication Security**
- [ ] Test weak password policies
- [ ] Test account lockout mechanisms
- [ ] Test password reset functionality
- [ ] Test multi-factor authentication bypasses
- [ ] Test session fixation vulnerabilities
- [ ] Test session timeout enforcement

**Authorization Testing**
- [ ] Test privilege escalation attempts
- [ ] Test horizontal privilege escalation
- [ ] Test vertical privilege escalation
- [ ] Test broken access control patterns
- [ ] Test insecure direct object references
- [ ] Test parameter-based access control bypasses

**Input Validation Testing**
- [ ] Test SQL injection vulnerabilities
- [ ] Test NoSQL injection vulnerabilities
- [ ] Test XSS vulnerabilities
- [ ] Test command injection vulnerabilities
- [ ] Test LDAP injection vulnerabilities
- [ ] Test XML external entity attacks

**Session Management Testing**
- [ ] Test session token predictability
- [ ] Test session invalidation on logout
- [ ] Test session fixation
- [ ] Test session timeout handling
- [ ] Test concurrent session limits
- [ ] Test session revocation mechanisms

**Error Handling Testing**
- [ ] Test information disclosure in error messages
- [ ] Test stack trace exposure
- [ ] Test database error exposure
- [ ] Test detailed error responses
- [ ] Test exception handling in edge cases

##### Security Test Scenarios

```markdown
# Manual Security Test Scenarios

## Scenario 1: Authentication Bypass
**Objective:** Test if authentication can be bypassed

**Steps:**
1. Access protected endpoint without token
2. Access with expired token
3. Access with malformed token
4. Access with token from different user
5. Test JWT algorithm confusion attacks

**Expected Results:**
- All unauthorized attempts return 401/403
- No sensitive data leaked in error responses
- Proper audit logging for failed attempts

## Scenario 2: Privilege Escalation
**Objective:** Test for privilege escalation vulnerabilities

**Steps:**
1. Login as regular user
2. Attempt to access admin endpoints
3. Attempt to modify other users' data
4. Test parameter tampering in requests
5. Test indirect object references

**Expected Results:**
- All unauthorized access attempts blocked
- Clear permission boundary enforcement
- Comprehensive audit trail

## Scenario 3: Data Exposure
**Objective:** Test for information disclosure vulnerabilities

**Steps:**
1. Probe API endpoints for data leakage
2. Test error messages for sensitive information
3. Test API documentation exposure
4. Test debug information leakage
5. Test user data enumeration

**Expected Results:**
- No sensitive data exposed without authentication
- Generic error messages for security
- No system information leakage
```

### Security Testing Tools Integration

#### 1. OWASP ZAP Integration
```javascript
// tests/security/zap-integration.js
import ZapClient from 'zaproxy';

class OWASPSecurityTesting {
  constructor() {
    this.zap = new ZapClient({
      proxy: 'http://localhost:8080'
    });
  }

  async runSecurityScan(targetURL) {
    console.log('Starting OWASP ZAP security scan...');

    try {
      // Start spidering
      const spiderId = await this.zap.spider.scan(targetURL);
      await this.waitForSpiderCompletion(spiderId);

      // Start active scan
      const scanId = await this.zap.ascan.scan(targetURL);
      await this.waitForScanCompletion(scanId);

      // Generate report
      const alerts = await this.zap.core.alerts();
      const report = this.generateZAPReport(alerts);

      return report;
    } catch (error) {
      console.error('ZAP scan failed:', error);
      return null;
    }
  }

  async waitForSpiderCompletion(spiderId) {
    let status = 0;
    while (status < 100) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const progress = await this.zap.spider.status(spiderId);
      status = parseInt(progress.status);
      console.log(`Spider progress: ${status}%`);
    }
  }

  async waitForScanCompletion(scanId) {
    let status = 0;
    while (status < 100) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      const progress = await this.zap.ascan.status(scanId);
      status = parseInt(progress.status);
      console.log(`Active scan progress: ${status}%`);
    }
  }

  generateZAPReport(alerts) {
    const highRiskAlerts = alerts.alerts.filter(alert =>
      ['High', 'Critical'].includes(alert.risk)
    );

    return {
      summary: {
        totalAlerts: alerts.alerts.length,
        highRiskAlerts: highRiskAlerts.length,
        timestamp: new Date().toISOString()
      },
      criticalIssues: highRiskAlerts.map(alert => ({
        name: alert.alert,
        risk: alert.risk,
        description: alert.desc,
        solution: alert.solution,
        instances: alert.instances?.length || 0
      }))
    };
  }
}
```

#### 2. Nuclei Vulnerability Scanner Integration
```bash
#!/bin/bash
# scripts/security/nuclei-scan.sh

TARGET_URL=${1:-"http://localhost:3001"}
OUTPUT_FILE="security-reports/nuclei-$(date +%Y%m%d-%H%M%S).json"

echo "Starting Nuclei vulnerability scan against $TARGET_URL"

# Create output directory
mkdir -p security-reports

# Run Nuclei scan
nuclei -target $TARGET_URL \
       -json \
       -output $OUTPUT_FILE \
       -severity critical,high,medium \
       -templates /path/to/nuclei-templates

echo "Scan completed. Results saved to $OUTPUT_FILE"

# Generate summary
CRITICAL_COUNT=$(jq '[.[] | select(.info.severity == "critical")] | length' $OUTPUT_FILE)
HIGH_COUNT=$(jq '[.[] | select(.info.severity == "high")] | length' $OUTPUT_FILE)
MEDIUM_COUNT=$(jq '[.[] | select(.info.severity == "medium")] | length' $OUTPUT_FILE)

echo "=== Scan Summary ==="
echo "Critical: $CRITICAL_COUNT"
echo "High: $HIGH_COUNT"
echo "Medium: $MEDIUM_COUNT"

if [ $CRITICAL_COUNT -gt 0 ]; then
    echo "⚠️  CRITICAL VULNERABILITIES FOUND!"
    exit 1
fi
```

### Continuous Security Testing

#### 1. CI/CD Security Pipeline
```yaml
# .github/workflows/security-tests.yml
name: Security Testing Pipeline

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM

jobs:
  security-scan:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: gui_lop_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
    - name: Checkout code
      uses: actions/checkout@v3

    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'npm'

    - name: Install dependencies
      run: npm ci

    - name: Run npm audit
      run: npm audit --audit-level=moderate

    - name: Run Snyk security scan
      uses: snyk/actions/node@master
      env:
        SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
      with:
        args: --severity-threshold=high

    - name: Run automated security tests
      run: npm run test:security
      env:
        JWT_SECRET: ${{ secrets.JWT_SECRET }}
        DATABASE_URL: postgresql://postgres:postgres@localhost:5432/gui_lop_test

    - name: Run OWASP ZAP Baseline Scan
      uses: zaproxy/action-baseline@v0.7.0
      with:
        target: 'http://localhost:3001'
        rules_file_name: '.zap/rules.tsv'
        cmd_options: '-a'

    - name: Run Bandit security scan
      run: |
        pip install bandit
        bandit -r src/ -f json -o security-reports/bandit-report.json

    - name: Run Semgrep security scan
      uses: returntocorp/semgrep-action@v1
      with:
        config: >-
          p/security-audit
          p/owasp-top-ten
          p/secrets

    - name: Upload security reports
      uses: actions/upload-artifact@v3
      if: always()
      with:
        name: security-reports
        path: |
          security-reports/
          .zap/wrk/

    - name: Create security issue for critical findings
      if: failure()
      uses: actions/github-script@v6
      with:
        script: |
          github.rest.issues.create({
            owner: context.repo.owner,
            repo: context.repo.repo,
            title: '🚨 Critical Security Issues Detected',
            body: 'Automated security testing has detected critical vulnerabilities. Please review the security reports in the workflow artifacts.',
            labels: ['security', 'critical']
          })
```

#### 2. Security Monitoring Dashboard
```javascript
// monitoring/security-dashboard.js
class SecurityMonitoringDashboard {
  constructor() {
    this.metrics = {
      authenticationFailures: 0,
      suspiciousActivities: 0,
      blockedRequests: 0,
      activeThreats: 0
    };

    this.alerts = [];
    this.trends = new Map();
  }

  updateMetrics(eventType, data) {
    switch (eventType) {
      case 'AUTH_FAILURE':
        this.metrics.authenticationFailures++;
        this.detectBruteForce(data);
        break;

      case 'SUSPICIOUS_ACTIVITY':
        this.metrics.suspiciousActivities++;
        this.analyzeSuspiciousActivity(data);
        break;

      case 'REQUEST_BLOCKED':
        this.metrics.blockedRequests++;
        break;

      case 'THREAT_DETECTED':
        this.metrics.activeThreats++;
        this.createSecurityAlert(data);
        break;
    }

    this.updateTrends(eventType);
  }

  detectBruteForce(authData) {
    const recentFailures = this.getRecentFailures(authData.ip, 15 * 60 * 1000); // 15 minutes

    if (recentFailures >= 5) {
      this.createSecurityAlert({
        type: 'BRUTE_FORCE_DETECTED',
        severity: 'high',
        sourceIP: authData.ip,
        targetUser: authData.email,
        attempts: recentFailures,
        timestamp: new Date().toISOString()
      });
    }
  }

  createSecurityAlert(alertData) {
    const alert = {
      id: crypto.randomUUID(),
      ...alertData,
      status: 'active',
      createdAt: new Date().toISOString()
    };

    this.alerts.push(alert);
    this.notifySecurityTeam(alert);
  }

  generateSecurityReport() {
    const report = {
      timestamp: new Date().toISOString(),
      metrics: this.metrics,
      alerts: {
        total: this.alerts.length,
        active: this.alerts.filter(a => a.status === 'active').length,
        critical: this.alerts.filter(a => a.severity === 'critical').length,
        high: this.alerts.filter(a => a.severity === 'high').length
      },
      trends: this.getTrendAnalysis(),
      recommendations: this.generateRecommendations()
    };

    return report;
  }

  generateRecommendations() {
    const recommendations = [];

    if (this.metrics.authenticationFailures > 100) {
      recommendations.push('Consider implementing stricter rate limiting or account lockout policies');
    }

    if (this.metrics.suspiciousActivities > 50) {
      recommendations.push('Review security logs for potential attack patterns');
    }

    const criticalAlerts = this.alerts.filter(a => a.severity === 'critical');
    if (criticalAlerts.length > 0) {
      recommendations.push('Immediate action required for critical security alerts');
    }

    return recommendations;
  }
}
```

This comprehensive security testing framework provides:

1. **Automated Testing**: Continuous security validation through CI/CD
2. **Manual Testing Procedures**: Structured penetration testing approach
3. **Tool Integration**: OWASP ZAP, Nuclei, and other security tools
4. **Monitoring Dashboard**: Real-time security metrics and alerting
5. **Comprehensive Coverage**: Authentication, API, network, and application security

The framework ensures that security is continuously validated and maintained throughout the development lifecycle.
