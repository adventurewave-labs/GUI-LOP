# GUI-LOP Token Management and Security Policies

**Version:** 1.0.0
**Date:** October 26, 2025
**Classification:** Confidential - Security Policy
**Author:** Security Architecture Team

---

## Executive Summary

### Token Management Overview

This document defines comprehensive token management policies and procedures for the **Generative UI & Human-in-the-Loop Orchestration Platform (GUI-LOP)**. The policies ensure secure token lifecycle management, proper access control, and compliance with industry security standards.

### Policy Objectives

1. **Secure Token Lifecycle**: Implement end-to-end security for token creation, distribution, and revocation
2. **Access Control**: Enforce principle of least privilege through granular token permissions
3. **Compliance**: Meet regulatory requirements for authentication and authorization
4. **Operational Excellence**: Provide scalable and maintainable token management processes

---

## Token Architecture

### Token Types and Specifications

#### 1. JSON Web Tokens (JWT)

**Access Token:**
```javascript
// Access Token Structure
{
  "header": {
    "alg": "HS256",
    "typ": "JWT",
    "kid": "2023-key-id"
  },
  "payload": {
    "sub": "user-uuid",
    "email": "user@example.com",
    "role": "workflow-manager",
    "permissions": [
      "workflow:create",
      "workflow:read",
      "workflow:execute"
    ],
    "iat": 1698307200,
    "exp": 1698308100,
    "iss": "gui-lop",
    "aud": "gui-lop-users",
    "jti": "token-uuid",
    "sid": "session-uuid",
    "auth_time": 1698307200,
    "amr": ["pwd", "mfa"]
  }
}
```

**Refresh Token:**
```javascript
// Refresh Token Structure (Stored in Database)
{
  "id": "refresh-token-uuid",
  "userId": "user-uuid",
  "tokenHash": "sha256-hash",
  "sessionId": "session-uuid",
  "expiresAt": "2025-11-02T10:00:00.000Z",
  "createdAt": "2025-10-26T10:00:00.000Z",
  "lastUsedAt": "2025-10-26T10:30:00.000Z",
  "deviceInfo": {
    "userAgent": "Mozilla/5.0...",
    "ipAddress": "192.168.1.100",
    "deviceFingerprint": "device-hash"
  },
  "isRevoked": false,
  "revokeReason": null
}
```

#### 2. Session Tokens

**WebSocket Session Token:**
```javascript
// WebSocket Session Token
{
  "sessionId": "ws-session-uuid",
  "userId": "user-uuid",
  "createdAt": 1698307200,
  "expiresAt": 1698309000,
  "ipAddress": "192.168.1.100",
  "userAgent": "WebSocket-Client",
  "permissions": ["ws:connect", "ws:message", "ws:workflow"]
}
```

#### 3. API Keys (Future Implementation)

**Service-to-Service API Key:**
```javascript
// API Key Structure
{
  "keyId": "api-key-uuid",
  "serviceId": "service-uuid",
  "keyHash": "sha256-hash",
  "permissions": [
    "workflow:read",
    "workflow:execute"
  ],
  "rateLimit": {
    "requests": 1000,
    "window": 3600
  },
  "expiresAt": "2026-10-26T10:00:00.000Z",
  "createdAt": "2025-10-26T10:00:00.000Z",
  "isActive": true
}
```

### Token Security Specifications

#### Cryptographic Standards

**JWT Signing:**
```javascript
// Secure JWT Configuration
const jwtConfig = {
  algorithm: 'HS256', // HMAC with SHA-256
  secretKey: process.env.JWT_SECRET, // 256-bit minimum
  keyRotation: {
    enabled: true,
    interval: 90 * 24 * 60 * 60 * 1000, // 90 days
    gracePeriod: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
};

// Key Management
const keyManagement = {
  currentKey: {
    id: '2023-q4-key-1',
    version: 1,
    algorithm: 'HS256',
    secret: 'base64-encoded-secret',
    createdAt: '2025-10-01T00:00:00.000Z',
    isActive: true
  },
  previousKeys: [], // Retired keys for graceful rotation
  keyRotationSchedule: 'quarterly'
};
```

**Token Encryption:**
```javascript
// Sensitive Token Data Encryption
const tokenEncryption = {
  algorithm: 'AES-256-GCM',
  keyId: 'token-encryption-key',
  ivLength: 12, // bytes
  tagLength: 16, // bytes
  keyRotation: {
    enabled: true,
    interval: 30 * 24 * 60 * 60 * 1000 // 30 days
  }
};
```

### Token Lifecycle Management

#### Token Generation and Issuance

**Access Token Generation:**
```javascript
class TokenService {
  constructor() {
    this.jwtSecret = process.env.JWT_SECRET;
    this.tokenTTL = 15 * 60; // 15 minutes
    this.refreshTokenTTL = 7 * 24 * 60 * 60; // 7 days
  }

  async generateTokenPair(user, deviceInfo) {
    const sessionId = uuidv4();
    const jti = uuidv4();

    // Access Token
    const accessToken = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        permissions: user.permissions,
        sid: sessionId,
        jti: jti,
        auth_time: Math.floor(Date.now() / 1000),
        amr: user.authMethods
      },
      this.jwtSecret,
      {
        algorithm: 'HS256',
        expiresIn: this.tokenTTL,
        issuer: 'gui-lop',
        audience: 'gui-lop-users',
        header: {
          kid: getCurrentKeyId()
        }
      }
    );

    // Refresh Token
    const refreshToken = await this.generateRefreshToken(user, sessionId, deviceInfo);

    // Store session
    await this.storeSession(sessionId, user, deviceInfo);

    return {
      accessToken,
      refreshToken,
      expiresIn: this.tokenTTL,
      tokenType: 'Bearer'
    };
  }

  async generateRefreshToken(user, sessionId, deviceInfo) {
    const refreshToken = crypto.randomBytes(64).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    const tokenRecord = {
      id: uuidv4(),
      userId: user.id,
      tokenHash,
      sessionId,
      expiresAt: new Date(Date.now() + this.refreshTokenTTL * 1000),
      createdAt: new Date(),
      lastUsedAt: new Date(),
      deviceInfo: this.sanitizeDeviceInfo(deviceInfo),
      isRevoked: false
    };

    await this.refreshTokenRepository.create(tokenRecord);
    return refreshToken;
  }

  sanitizeDeviceInfo(deviceInfo) {
    return {
      userAgent: deviceInfo.userAgent?.substring(0, 500),
      ipAddress: deviceInfo.ipAddress,
      deviceFingerprint: this.generateDeviceFingerprint(deviceInfo),
      platform: deviceInfo.platform,
      browser: deviceInfo.browser?.name,
      browserVersion: deviceInfo.browser?.version
    };
  }
}
```

#### Token Validation and Verification

**Token Validation Middleware:**
```javascript
class TokenValidator {
  constructor() {
    this.blacklist = new Set();
    this.rateLimiter = new TokenRateLimiter();
  }

  async validateAccessToken(req, res, next) {
    try {
      const token = this.extractToken(req);

      if (!token) {
        return this.unauthorized(res, 'TOKEN_MISSING', 'Access token is required');
      }

      // Check token blacklist
      if (await this.isTokenBlacklisted(token)) {
        return this.forbidden(res, 'TOKEN_BLACKLISTED', 'Token has been revoked');
      }

      // Validate JWT structure and claims
      const decoded = await this.validateJWT(token);

      // Validate session
      const session = await this.validateSession(decoded.sid, decoded.sub);
      if (!session) {
        return this.forbidden(res, 'SESSION_INVALID', 'Session is invalid or expired');
      }

      // Check rate limiting
      if (await this.rateLimiter.isRateLimited(decoded.jti, decoded.sub)) {
        return this.tooManyRequests(res, 'TOKEN_RATE_LIMITED', 'Token usage rate limit exceeded');
      }

      // Update last activity
      await this.updateSessionActivity(decoded.sid);

      req.user = decoded;
      req.session = session;
      next();

    } catch (error) {
      this.handleValidationError(error, res);
    }
  }

  async validateJWT(token) {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'gui-lop',
      audience: 'gui-lop-users',
      clockTolerance: 30 // 30 seconds clock skew
    });

    // Additional claim validations
    this.validateClaims(decoded);

    return decoded;
  }

  validateClaims(decoded) {
    const now = Math.floor(Date.now() / 1000);

    // Validate issued at (iat)
    if (decoded.iat > now + 60) { // Allow 60 seconds clock skew
      throw new TokenValidationError('Token issued in the future');
    }

    // Validate authentication time
    if (decoded.auth_time && decoded.auth_time > now + 300) {
      throw new TokenValidationError('Authentication time in the future');
    }

    // Validate session ID
    if (!decoded.sid || typeof decoded.sid !== 'string') {
      throw new TokenValidationError('Invalid session ID');
    }

    // Validate token ID
    if (!decoded.jti || typeof decoded.jti !== 'string') {
      throw new TokenValidationError('Invalid token ID');
    }
  }

  async validateSession(sessionId, userId) {
    const session = await this.sessionRepository.findById(sessionId);

    if (!session) {
      return null;
    }

    if (session.userId !== userId) {
      throw new TokenValidationError('Session user mismatch');
    }

    if (session.expiresAt < new Date()) {
      await this.sessionRepository.delete(sessionId);
      return null;
    }

    if (!session.isActive) {
      return null;
    }

    return session;
  }
}
```

#### Token Refresh and Rotation

**Refresh Token Service:**
```javascript
class RefreshTokenService {
  async refreshToken(refreshToken, deviceInfo) {
    try {
      // Validate refresh token
      const tokenRecord = await this.validateRefreshToken(refreshToken);

      // Check if token is expired
      if (tokenRecord.expiresAt < new Date()) {
        throw new TokenError('REFRESH_TOKEN_EXPIRED', 'Refresh token has expired');
      }

      // Check if token is revoked
      if (tokenRecord.isRevoked) {
        throw new TokenError('REFRESH_TOKEN_REVOKED', 'Refresh token has been revoked');
      }

      // Get user
      const user = await this.userService.findById(tokenRecord.userId);
      if (!user || !user.isActive) {
        throw new TokenError('USER_INACTIVE', 'User account is inactive');
      }

      // Validate device continuity
      await this.validateDeviceContinuity(tokenRecord, deviceInfo);

      // Generate new token pair
      const tokenPair = await this.tokenService.generateTokenPair(user, deviceInfo);

      // Revoke old refresh token
      await this.revokeRefreshToken(tokenRecord.id, 'TOKEN_ROTATION');

      // Clean up old session
      await this.sessionService.delete(tokenRecord.sessionId);

      // Log token refresh
      await this.auditService.logTokenRefresh({
        userId: user.id,
        oldTokenId: tokenRecord.id,
        newSessionId: tokenPair.sessionId,
        deviceInfo
      });

      return tokenPair;

    } catch (error) {
      this.logRefreshAttempt(refreshToken, error);
      throw error;
    }
  }

  async validateRefreshToken(refreshToken) {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const tokenRecord = await this.refreshTokenRepository.findByHash(tokenHash);

    if (!tokenRecord) {
      throw new TokenError('REFRESH_TOKEN_INVALID', 'Invalid refresh token');
    }

    return tokenRecord;
  }

  async validateDeviceContinuity(tokenRecord, deviceInfo) {
    const currentFingerprint = this.generateDeviceFingerprint(deviceInfo);
    const storedFingerprint = tokenRecord.deviceInfo.deviceFingerprint;

    // Allow some flexibility for legitimate device changes
    if (!this.isDeviceSimilar(currentFingerprint, storedFingerprint)) {
      // Require MFA for device changes
      await this.requireAdditionalMFA(tokenRecord.userId);

      // Log suspicious activity
      await this.securityService.logSuspiciousActivity({
        type: 'DEVICE_CHANGE',
        userId: tokenRecord.userId,
        oldFingerprint: storedFingerprint,
        newFingerprint: currentFingerprint,
        ipAddress: deviceInfo.ipAddress
      });
    }

    // Update last used timestamp
    tokenRecord.lastUsedAt = new Date();
    await this.refreshTokenRepository.update(tokenRecord.id, tokenRecord);
  }

  async revokeRefreshToken(tokenId, reason) {
    await this.refreshTokenRepository.update(tokenId, {
      isRevoked: true,
      revokeReason: reason,
      revokedAt: new Date()
    });
  }
}
```

### Token Security Policies

#### 1. Access Control Policies

**Token-Based Authorization Matrix:**
```yaml
# Token Permission Matrix
permissions:
  workflow:
    create:
      roles: ["user", "admin", "super-admin"]
      conditions:
        - user.isActive == true
        - user.quotas.workflowsUsed < user.quotas.workflowsLimit
    read:
      roles: ["user", "admin", "super-admin"]
      conditions:
        - resource.ownerId == user.id OR user.role in ["admin", "super-admin"]
    update:
      roles: ["user", "admin", "super-admin"]
      conditions:
        - resource.ownerId == user.id OR user.role in ["admin", "super-admin"]
    delete:
      roles: ["admin", "super-admin"]
      conditions:
        - user.role in ["admin", "super-admin"]

  admin:
    users:
      read: ["admin", "super-admin"]
      update: ["admin", "super-admin"]
      delete: ["super-admin"]

    security:
      read: ["super-admin"]
      audit: ["super-admin"]
      config: ["super-admin"]

# Token Scopes
scopes:
  "read:workflow":
    description: "Read workflow information"
    permissions: ["workflow:read"]

  "write:workflow":
    description: "Create and modify workflows"
    permissions: ["workflow:create", "workflow:update"]

  "admin:user":
    description: "Manage user accounts"
    permissions: ["admin:users:read", "admin:users:update"]

  "admin:security":
    description: "Access security features"
    permissions: ["admin:security:read", "admin:security:audit"]
```

#### 2. Token Lifecycle Policies

**Token Expiration Policies:**
```javascript
const tokenPolicies = {
  accessToken: {
    defaultTTL: 15 * 60, // 15 minutes
    maxTTL: 60 * 60,     // 1 hour maximum
    idleTimeout: 30 * 60, // 30 minutes of inactivity
    absoluteTimeout: 8 * 60 * 60 // 8 hours absolute maximum
  },

  refreshToken: {
    defaultTTL: 7 * 24 * 60 * 60, // 7 days
    maxTTL: 30 * 24 * 60 * 60,    // 30 days maximum
    rotationInterval: 24 * 60 * 60, // Rotate every 24 hours
    maxActivePerUser: 5,            // Maximum 5 active refresh tokens
    deviceBinding: true             // Bind to specific device
  },

  sessionToken: {
    defaultTTL: 2 * 60 * 60, // 2 hours
    maxTTL: 8 * 60 * 60,     // 8 hours maximum
    renewalThreshold: 0.8,   // Renew when 80% expired
    maxConcurrentSessions: 3 // Maximum 3 concurrent sessions
  },

  apiKey: {
    defaultTTL: 365 * 24 * 60 * 60, // 1 year
    maxTTL: 2 * 365 * 24 * 60 * 60, // 2 years maximum
    rotationPolicy: "annual",         // Annual rotation required
    usageLimit: {
      requests: 1000000,              // 1 million requests
      window: 30 * 24 * 60 * 60      // per 30 days
    }
  }
};
```

#### 3. Security Monitoring Policies

**Token Anomaly Detection:**
```javascript
class TokenAnomalyDetector {
  constructor() {
    this.baselineMetrics = new Map();
    this.alertThresholds = {
      tokenReuse: 0.1,              // 10% unusual token reuse
      locationChange: 500,          // 500km location change
      deviceChange: 0.8,            // 80% device fingerprint change
      velocityCheck: {
        maxDistance: 1000,          // 1000km in 1 hour
        timeWindow: 60 * 60         // 1 hour
      },
      usagePattern: {
        deviationThreshold: 2.5,    // 2.5 standard deviations
        windowSize: 100              // Last 100 requests
      }
    };
  }

  async analyzeTokenUsage(token, request) {
    const anomalies = [];

    // Check for token reuse anomalies
    const reuseAnomaly = await this.detectTokenReuseAnomaly(token, request);
    if (reuseAnomaly) anomalies.push(reuseAnomaly);

    // Check for geographic anomalies
    const locationAnomaly = await this.detectLocationAnomaly(token, request);
    if (locationAnomaly) anomalies.push(locationAnomaly);

    // Check for device anomalies
    const deviceAnomaly = await this.detectDeviceAnomaly(token, request);
    if (deviceAnomaly) anomalies.push(deviceAnomaly);

    // Check for velocity anomalies
    const velocityAnomaly = await this.detectVelocityAnomaly(token, request);
    if (velocityAnomaly) anomalies.push(velocityAnomaly);

    // Check for usage pattern anomalies
    const patternAnomaly = await this.detectUsagePatternAnomaly(token, request);
    if (patternAnomaly) anomalies.push(patternAnomaly);

    if (anomalies.length > 0) {
      await this.handleAnomalies(token, anomalies);
    }

    return anomalies;
  }

  async detectLocationAnomaly(token, request) {
    const currentLocation = await this.getLocationFromIP(request.ip);
    const recentLocations = await this.getRecentTokenLocations(token.id);

    if (recentLocations.length > 0) {
      const lastLocation = recentLocations[0];
      const distance = this.calculateDistance(lastLocation, currentLocation);

      if (distance > this.alertThresholds.locationChange) {
        return {
          type: 'LOCATION_ANOMALY',
          severity: 'medium',
          details: {
            currentLocation,
            lastLocation,
            distance
          }
        };
      }
    }

    return null;
  }

  async detectVelocityAnomaly(token, request) {
    const recentRequests = await this.getRecentTokenRequests(
      token.id,
      this.alertThresholds.velocityCheck.timeWindow
    );

    for (const recentRequest of recentRequests) {
      const recentLocation = await this.getLocationFromIP(recentRequest.ip);
      const currentLocation = await this.getLocationFromIP(request.ip);
      const distance = this.calculateDistance(recentLocation, currentLocation);

      if (distance > this.alertThresholds.velocityCheck.maxDistance) {
        return {
          type: 'VELOCITY_ANOMALY',
          severity: 'high',
          details: {
            distance,
            timeDiff: Date.now() - recentRequest.timestamp,
            locations: [recentLocation, currentLocation]
          }
        };
      }
    }

    return null;
  }

  async handleAnomalies(token, anomalies) {
    // Log anomalies
    await this.auditService.logAnomalies(token.id, anomalies);

    // Determine response based on severity
    const maxSeverity = Math.max(...anomalies.map(a => this.getSeverityLevel(a.severity)));

    if (maxSeverity >= 3) { // High severity
      // Revoke token immediately
      await this.tokenService.revokeToken(token.id, 'SECURITY_ANOMALY');

      // Notify security team
      await this.notificationService.sendSecurityAlert({
        type: 'TOKEN_REVOKED',
        token: token.id,
        user: token.userId,
        anomalies
      });

      // Block further requests
      throw new TokenSecurityError('Token revoked due to security concerns');
    } else if (maxSeverity >= 2) { // Medium severity
      // Require additional authentication
      await this.requireAdditionalAuthentication(token, anomalies);
    } else { // Low severity
      // Log for monitoring
      await this.monitoringService.recordAnomaly(token, anomalies);
    }
  }
}
```

### Token Storage and Persistence

#### 1. Secure Token Storage Architecture

**Database Schema:**
```sql
-- Users table (simplified)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'user',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Sessions table
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ip_address INET NOT NULL,
    user_agent TEXT,
    device_fingerprint VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    INDEX idx_sessions_user_id (user_id),
    INDEX idx_sessions_expires_at (expires_at),
    INDEX idx_sessions_token (session_token)
);

-- Refresh tokens table
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_revoked BOOLEAN DEFAULT false,
    revoke_reason VARCHAR(100),
    revoked_at TIMESTAMP WITH TIME ZONE,
    device_info JSONB,
    INDEX idx_refresh_tokens_user_id (user_id),
    INDEX idx_refresh_tokens_hash (token_hash),
    INDEX idx_refresh_tokens_expires_at (expires_at)
);

-- Token blacklist table
CREATE TABLE token_blacklist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_id VARCHAR(255) NOT NULL,
    token_type VARCHAR(50) NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    reason VARCHAR(255),
    revoked_by_user_id UUID REFERENCES users(id),
    INDEX idx_token_blacklist_token_id (token_id),
    INDEX idx_token_blacklist_expires_at (expires_at)
);

-- API keys table (future implementation)
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID NOT NULL,
    key_hash VARCHAR(255) NOT NULL,
    permissions JSONB NOT NULL,
    rate_limit_config JSONB,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    INDEX idx_api_keys_service_id (service_id),
    INDEX idx_api_keys_hash (key_hash)
);
```

#### 2. Token Cleanup and Maintenance

**Automated Cleanup Service:**
```javascript
class TokenCleanupService {
  constructor() {
    this.cleanupInterval = 60 * 60 * 1000; // Run every hour
    this.retentionPeriods = {
      expiredSessions: 7 * 24 * 60 * 60 * 1000,  // 7 days
      revokedTokens: 30 * 24 * 60 * 60 * 1000,    // 30 days
      auditLogs: 90 * 24 * 60 * 60 * 1000,        // 90 days
      blacklistedTokens: 1 * 60 * 60 * 1000       // 1 hour after expiry
    };
  }

  async startCleanupProcess() {
    console.log('Starting token cleanup service...');

    setInterval(async () => {
      await this.performCleanup();
    }, this.cleanupInterval);

    // Run initial cleanup
    await this.performCleanup();
  }

  async performCleanup() {
    const startTime = Date.now();
    const cleanupResults = {
      expiredSessions: 0,
      revokedTokens: 0,
      blacklistedTokens: 0,
      auditLogs: 0,
      errors: []
    };

    try {
      // Clean up expired sessions
      cleanupResults.expiredSessions = await this.cleanupExpiredSessions();

      // Clean up revoked refresh tokens
      cleanupResults.revokedTokens = await this.cleanupRevokedTokens();

      // Clean up expired blacklisted tokens
      cleanupResults.blacklistedTokens = await this.cleanupBlacklistedTokens();

      // Clean up old audit logs
      cleanupResults.auditLogs = await this.cleanupAuditLogs();

      // Log cleanup results
      await this.logCleanupResults(cleanupResults);

    } catch (error) {
      console.error('Token cleanup failed:', error);
      cleanupResults.errors.push(error.message);
      await this.alertCleanupFailure(error);
    }

    const duration = Date.now() - startTime;
    console.log(`Token cleanup completed in ${duration}ms`, cleanupResults);
  }

  async cleanupExpiredSessions() {
    const cutoffDate = new Date(Date.now() - this.retentionPeriods.expiredSessions);

    const result = await this.db.query(`
      DELETE FROM sessions
      WHERE expires_at < $1 OR last_activity_at < $2
    `, [new Date(), cutoffDate]);

    return result.rowCount;
  }

  async cleanupRevokedTokens() {
    const cutoffDate = new Date(Date.now() - this.retentionPeriods.revokedTokens);

    const result = await this.db.query(`
      DELETE FROM refresh_tokens
      WHERE is_revoked = true AND revoked_at < $1
    `, [cutoffDate]);

    return result.rowCount;
  }

  async cleanupBlacklistedTokens() {
    const cutoffDate = new Date();

    const result = await this.db.query(`
      DELETE FROM token_blacklist
      WHERE expires_at < $1
    `, [cutoffDate]);

    return result.rowCount;
  }

  async cleanupAuditLogs() {
    const cutoffDate = new Date(Date.now() - this.retentionPeriods.auditLogs);

    const result = await this.db.query(`
      DELETE FROM audit_logs
      WHERE created_at < $1 AND level != 'critical'
    `, [cutoffDate]);

    return result.rowCount;
  }
}
```

### Token Security Monitoring and Analytics

#### 1. Token Usage Analytics

**Token Analytics Dashboard:**
```javascript
class TokenAnalyticsService {
  constructor() {
    this.metricsCollector = new MetricsCollector();
    this.realTimeMonitor = new RealTimeMonitor();
  }

  async generateTokenAnalytics(timeRange = '24h') {
    const analytics = {
      overview: await this.getOverviewMetrics(timeRange),
      tokenTypes: await this.getTokenTypeMetrics(timeRange),
      geography: await this.getGeographicMetrics(timeRange),
      devices: await this.getDeviceMetrics(timeRange),
      security: await this.getSecurityMetrics(timeRange),
      performance: await this.getPerformanceMetrics(timeRange)
    };

    return analytics;
  }

  async getOverviewMetrics(timeRange) {
    const { startDate, endDate } = this.parseTimeRange(timeRange);

    const [
      totalTokens,
      activeTokens,
      expiredTokens,
      revokedTokens,
      uniqueUsers
    ] = await Promise.all([
      this.db.query('SELECT COUNT(*) FROM token_usage WHERE created_at BETWEEN $1 AND $2', [startDate, endDate]),
      this.db.query('SELECT COUNT(DISTINCT token_id) FROM active_sessions WHERE last_activity_at > $1', [startDate]),
      this.db.query('SELECT COUNT(*) FROM expired_tokens WHERE expired_at BETWEEN $1 AND $2', [startDate, endDate]),
      this.db.query('SELECT COUNT(*) FROM revoked_tokens WHERE revoked_at BETWEEN $1 AND $2', [startDate, endDate]),
      this.db.query('SELECT COUNT(DISTINCT user_id) FROM token_usage WHERE created_at BETWEEN $1 AND $2', [startDate, endDate])
    ]);

    return {
      totalTokensIssued: parseInt(totalTokens.rows[0].count),
      activeTokens: parseInt(activeTokens.rows[0].count),
      expiredTokens: parseInt(expiredTokens.rows[0].count),
      revokedTokens: parseInt(revokedTokens.rows[0].count),
      uniqueActiveUsers: parseInt(uniqueUsers.rows[0].count),
      tokenRenewalRate: await this.calculateRenewalRate(timeRange)
    };
  }

  async getSecurityMetrics(timeRange) {
    const { startDate, endDate } = this.parseTimeRange(timeRange);

    const [
      failedAuths,
      suspiciousActivities,
      blockedRequests,
      anomalousLogins
    ] = await Promise.all([
      this.db.query('SELECT COUNT(*) FROM failed_authentications WHERE created_at BETWEEN $1 AND $2', [startDate, endDate]),
      this.db.query('SELECT COUNT(*) FROM security_events WHERE severity = \'suspicious\' AND created_at BETWEEN $1 AND $2', [startDate, endDate]),
      this.db.query('SELECT COUNT(*) FROM blocked_requests WHERE created_at BETWEEN $1 AND $2', [startDate, endDate]),
      this.db.query('SELECT COUNT(*) FROM anomalous_logins WHERE created_at BETWEEN $1 AND $2', [startDate, endDate])
    ]);

    return {
      failedAuthentications: parseInt(failedAuths.rows[0].count),
      suspiciousActivities: parseInt(suspiciousActivities.rows[0].count),
      blockedRequests: parseInt(blockedRequests.rows[0].count),
      anomalousLogins: parseInt(anomalousLogins.rows[0].count),
      securityIncidents: await this.getSecurityIncidents(timeRange)
    };
  }

  async getPerformanceMetrics(timeRange) {
    const { startDate, endDate } = this.parseTimeRange(timeRange);

    const [
      avgResponseTime,
      tokenValidationTime,
      refreshTokenTime,
      errorRate
    ] = await Promise.all([
      this.db.query('SELECT AVG(response_time) FROM api_metrics WHERE created_at BETWEEN $1 AND $2', [startDate, endDate]),
      this.db.query('SELECT AVG(validation_time) FROM token_validations WHERE created_at BETWEEN $1 AND $2', [startDate, endDate]),
      this.db.query('SELECT AVG(refresh_time) FROM token_refreshes WHERE created_at BETWEEN $1 AND $2', [startDate, endDate]),
      this.db.query('SELECT COUNT(*) FROM api_errors WHERE created_at BETWEEN $1 AND $2', [startDate, endDate])
    ]);

    const totalRequests = await this.getTotalRequests(timeRange);

    return {
      averageResponseTime: parseFloat(avgResponseTime.rows[0].avg) || 0,
      averageTokenValidationTime: parseFloat(tokenValidationTime.rows[0].avg) || 0,
      averageRefreshTime: parseFloat(refreshTokenTime.rows[0].avg) || 0,
      errorRate: totalRequests > 0 ? (parseInt(errorRate.rows[0].count) / totalRequests) * 100 : 0,
      throughput: await this.calculateThroughput(timeRange)
    };
  }
}
```

#### 2. Real-time Token Monitoring

**Real-time Monitoring Service:**
```javascript
class RealTimeTokenMonitor {
  constructor() {
    this.alertThresholds = {
      failureRate: 0.05,        // 5% failure rate
      responseTime: 1000,       // 1 second average response time
      tokenIssuanceRate: 100,   // 100 tokens per minute
      anomalyRate: 0.02         // 2% anomaly rate
    };

    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalResponseTime: 0,
      anomalies: 0,
      tokensIssued: 0
    };

    this.startMonitoring();
  }

  startMonitoring() {
    // Reset metrics every minute
    setInterval(() => {
      this.evaluateMetrics();
      this.resetMetrics();
    }, 60 * 1000);

    // Real-time alerts
    setInterval(() => {
      this.checkRealTimeAlerts();
    }, 10 * 1000); // Every 10 seconds
  }

  recordRequest(responseTime, success, isAnomaly = false) {
    this.metrics.totalRequests++;
    this.metrics.totalResponseTime += responseTime;

    if (success) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
    }

    if (isAnomaly) {
      this.metrics.anomalies++;
    }
  }

  recordTokenIssuance() {
    this.metrics.tokensIssued++;
  }

  evaluateMetrics() {
    const failureRate = this.metrics.totalRequests > 0 ?
      this.metrics.failedRequests / this.metrics.totalRequests : 0;

    const avgResponseTime = this.metrics.totalRequests > 0 ?
      this.metrics.totalResponseTime / this.metrics.totalRequests : 0;

    const anomalyRate = this.metrics.totalRequests > 0 ?
      this.metrics.anomalies / this.metrics.totalRequests : 0;

    const evaluation = {
      timestamp: new Date().toISOString(),
      metrics: {
        totalRequests: this.metrics.totalRequests,
        failureRate: failureRate * 100,
        averageResponseTime: avgResponseTime,
        anomalyRate: anomalyRate * 100,
        tokensIssued: this.metrics.tokensIssued
      },
      alerts: []
    };

    // Check for alerts
    if (failureRate > this.alertThresholds.failureRate) {
      evaluation.alerts.push({
        type: 'HIGH_FAILURE_RATE',
        severity: 'warning',
        value: failureRate * 100,
        threshold: this.alertThresholds.failureRate * 100
      });
    }

    if (avgResponseTime > this.alertThresholds.responseTime) {
      evaluation.alerts.push({
        type: 'HIGH_RESPONSE_TIME',
        severity: 'warning',
        value: avgResponseTime,
        threshold: this.alertThresholds.responseTime
      });
    }

    if (anomalyRate > this.alertThresholds.anomalyRate) {
      evaluation.alerts.push({
        type: 'HIGH_ANOMALY_RATE',
        severity: 'critical',
        value: anomalyRate * 100,
        threshold: this.alertThresholds.anomalyRate * 100
      });
    }

    if (evaluation.alerts.length > 0) {
      this.sendAlerts(evaluation.alerts);
    }

    // Store evaluation
    this.storeMetricsEvaluation(evaluation);
  }

  async sendAlerts(alerts) {
    for (const alert of alerts) {
      await this.alertService.send({
        type: alert.type,
        severity: alert.severity,
        message: `${alert.type}: Current value ${alert.value.toFixed(2)} exceeds threshold ${alert.threshold}`,
        metadata: alert,
        timestamp: new Date().toISOString()
      });
    }
  }
}
```

---

## Policy Compliance and Governance

### 1. Compliance Requirements

**Regulatory Compliance Matrix:**
```yaml
compliance_requirements:
  GDPR:
    data_protection:
      - encrypt_personal_data
      - implement_data_retention_policies
      - provide_data_export_capabilities
      - ensure_right_to_be_forgotten
    consent_management:
      - explicit_consent_for_token_usage
      - consent_revocation_mechanisms
      - audit_trail_for_consent_changes

  SOC_2:
    security:
      - secure_token_lifecycle_management
      - access_control_monitoring
      - incident_response_procedures
    availability:
      - high_availability_token_service
      - disaster_recovery_procedures
      - backup_and_recovery_testing

  ISO_27001:
    information_security:
      - token_security_policies
      - risk_assessment_procedures
      - security_training_programs
    access_control:
      - role_based_access_control
      - privileged_access_management
      - regular_access_reviews

  HIPAA:
    protected_health_information:
      - PHI_encryption_in_transit_and_rest
      - audit_logging_for_PHI_access
      - minimum_necessary_use_principle
    technical_safeguards:
      - access_control_mechanisms
      - audit_controls
      - transmission_security
```

### 2. Policy Enforcement

**Policy Compliance Checker:**
```javascript
class PolicyComplianceChecker {
  constructor() {
    this.policies = this.loadSecurityPolicies();
    this.complianceRules = this.loadComplianceRules();
  }

  async checkTokenCompliance(token, context) {
    const complianceResults = {
      timestamp: new Date().toISOString(),
      tokenId: token.jti,
      userId: token.sub,
      policies: [],
      overallCompliant: true,
      violations: [],
      recommendations: []
    };

    // Check each applicable policy
    for (const policy of this.policies) {
      const result = await this.evaluatePolicy(policy, token, context);
      complianceResults.policies.push(result);

      if (!result.compliant) {
        complianceResults.overallCompliant = false;
        complianceResults.violations.push(...result.violations);
      }

      complianceResults.recommendations.push(...result.recommendations);
    }

    // Log compliance check
    await this.logComplianceCheck(complianceResults);

    return complianceResults;
  }

  async evaluatePolicy(policy, token, context) {
    const result = {
      policyName: policy.name,
      policyId: policy.id,
      compliant: true,
      violations: [],
      recommendations: [],
      score: 100
    };

    switch (policy.type) {
      case 'TOKEN_LIFECYCLE':
        await this.checkTokenLifecyclePolicy(policy, token, context, result);
        break;
      case 'ACCESS_CONTROL':
        await this.checkAccessControlPolicy(policy, token, context, result);
        break;
      case 'DATA_PROTECTION':
        await this.checkDataProtectionPolicy(policy, token, context, result);
        break;
      case 'AUDIT_LOGGING':
        await this.checkAuditLoggingPolicy(policy, token, context, result);
        break;
    }

    return result;
  }

  async checkTokenLifecyclePolicy(policy, token, context, result) {
    const now = Math.floor(Date.now() / 1000);

    // Check token age
    const tokenAge = now - token.iat;
    const maxAge = policy.rules.maxTokenAge * 60; // Convert minutes to seconds

    if (tokenAge > maxAge) {
      result.compliant = false;
      result.violations.push({
        type: 'TOKEN_TOO_OLD',
        description: `Token age (${tokenAge}s) exceeds maximum allowed (${maxAge}s)`,
        severity: 'high'
      });
      result.score -= 20;
    }

    // Check token expiration
    const timeToExpiry = token.exp - now;
    const minTimeToExpiry = policy.rules.minTimeToExpiry * 60;

    if (timeToExpiry < minTimeToExpiry) {
      result.compliant = false;
      result.violations.push({
        type: 'TOKEN_EXPIRING_SOON',
        description: `Token expires in ${timeToExpiry}s, minimum required is ${minTimeToExpiry}s`,
        severity: 'medium'
      });
      result.score -= 10;
    }

    // Check session validity
    const session = await this.sessionRepository.findById(token.sid);
    if (!session || !session.isActive) {
      result.compliant = false;
      result.violations.push({
        type: 'INVALID_SESSION',
        description: 'Token references invalid or inactive session',
        severity: 'critical'
      });
      result.score -= 30;
    }
  }

  async checkAccessControlPolicy(policy, token, context, result) {
    // Check role-based access
    const requiredRoles = policy.rules.requiredRoles[context.endpoint];
    if (requiredRoles && !requiredRoles.includes(token.role)) {
      result.compliant = false;
      result.violations.push({
        type: 'INSUFFICIENT_ROLE',
        description: `User role '${token.role}' insufficient for endpoint '${context.endpoint}'`,
        severity: 'high'
      });
      result.score -= 25;
    }

    // Check permission-based access
    const requiredPermissions = policy.rules.requiredPermissions[context.action];
    if (requiredPermissions) {
      const hasPermissions = requiredPermissions.every(perm =>
        token.permissions.includes(perm)
      );

      if (!hasPermissions) {
        result.compliant = false;
        result.violations.push({
          type: 'INSUFFICIENT_PERMISSIONS',
          description: `User lacks required permissions for action '${context.action}'`,
          severity: 'high'
        });
        result.score -= 25;
      }
    }

    // Check time-based access restrictions
    if (policy.rules.timeRestrictions) {
      const currentTime = new Date().getHours();
      const allowedHours = policy.rules.timeRestrictions.allowedHours;

      if (!allowedHours.includes(currentTime)) {
        result.compliant = false;
        result.violations.push({
          type: 'TIME_RESTRICTION_VIOLATION',
          description: `Access attempted at restricted time (${currentTime}:00)`,
          severity: 'medium'
        });
        result.score -= 15;
      }
    }
  }

  async checkDataProtectionPolicy(policy, token, context, result) {
    // Check data encryption requirements
    if (policy.rules.encryptionRequired && !context.dataEncrypted) {
      result.compliant = false;
      result.violations.push({
        type: 'DATA_NOT_ENCRYPTED',
        description: 'Sensitive data transmitted without encryption',
        severity: 'critical'
      });
      result.score -= 30;
    }

    // Check data masking for logs
    if (policy.rules.maskSensitiveData && context.sensitiveDataInLogs) {
      result.compliant = false;
      result.violations.push({
        type: 'SENSITIVE_DATA_IN_LOGS',
        description: 'Sensitive data found in application logs',
        severity: 'high'
      });
      result.score -= 20;
    }

    // Check geographic restrictions
    if (policy.rules.geographicRestrictions) {
      const allowedRegions = policy.rules.geographicRestrictions.allowedRegions;
      const requestRegion = await this.getRegionFromIP(context.ipAddress);

      if (!allowedRegions.includes(requestRegion)) {
        result.compliant = false;
        result.violations.push({
          type: 'GEOGRAPHIC_RESTRICTION_VIOLATION',
          description: `Access from restricted region '${requestRegion}'`,
          severity: 'medium'
        });
        result.score -= 15;
      }
    }
  }
}
```

This comprehensive token management and security policies document provides:

1. **Complete Token Architecture**: JWT, refresh tokens, session tokens, and API keys
2. **Security Specifications**: Cryptographic standards and validation procedures
3. **Lifecycle Management**: Generation, validation, refresh, and revocation processes
4. **Security Policies**: Access control, expiration, and monitoring policies
5. **Storage Architecture**: Secure database schema and cleanup procedures
6. **Monitoring and Analytics**: Real-time monitoring and compliance checking
7. **Regulatory Compliance**: GDPR, SOC 2, ISO 27001, and HIPAA requirements

The policies ensure enterprise-grade security while maintaining operational efficiency and regulatory compliance.
