/**
 * Enhanced Authentication Middleware with Redis Integration
 * JWT-based authentication with Redis caching, session management, and security features
 * Week 5-6 Phase 2 - Redis Caching Layer
 */

import AuthMiddleware from './middleware/auth-middleware.js';
import sessionCacheService from './services/session-cache-service.js';
import cacheHealthMiddleware from './middleware/cache-health-middleware.js';
import cacheInvalidationService from './services/cache-invalidation-service.js';
import cacheWarmingService from './services/cache-warming-service.js';
import crypto from 'crypto';

class EnhancedAuthMiddleware extends AuthMiddleware {
  constructor(options = {}) {
    super(options);
    this.sessionCacheEnabled = options.sessionCache !== false;
    this.cacheFallbackEnabled = options.cacheFallback !== false;
    this.securityFeatures = {
      deviceTracking: options.deviceTracking !== false,
      ipValidation: options.ipValidation !== false,
      suspiciousActivityDetection: options.suspiciousActivityDetection !== false,
      sessionRotation: options.sessionRotation !== false
    };

    // Initialize services
    this.initializeServices();
  }

  /**
   * Initialize cache services
   */
  async initializeServices() {
    try {
      if (this.sessionCacheEnabled) {
        await sessionCacheService.initialize();
        console.log('✅ Session cache service initialized for authentication');
      }

      // Set up cache invalidation for auth events
      this.setupAuthInvalidationRules();

      // Set up cache warming for auth data
      this.setupAuthCacheWarming();

    } catch (error) {
      console.error('❌ Failed to initialize auth cache services:', error.message);
      if (!this.cacheFallbackEnabled) {
        throw error;
      }
    }
  }

  /**
   * Enhanced authentication middleware with Redis integration
   */
  authenticate() {
    return async (req, res, next) => {
      try {
        // Add security headers
        Object.entries(this.securityHeaders).forEach(([key, value]) => {
          res.setHeader(key, value);
        });

        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({
            error: 'Authentication required',
            message: 'Bearer token is required'
          });
        }

        const token = authHeader.substring(7);

        // Try to validate token with cache first
        let tokenValidation;
        if (this.sessionCacheEnabled && sessionCacheService.initialized) {
          tokenValidation = await sessionCacheService.validateJWT(token, 'access');
        } else {
          // Fallback to direct JWT validation
          try {
            const decoded = this.verifyToken(token, 'access');
            tokenValidation = { valid: true, userId: decoded.sub, session: null };
          } catch (error) {
            tokenValidation = { valid: false, reason: error.message };
          }
        }

        if (!tokenValidation.valid) {
          return res.status(401).json({
            error: 'Authentication failed',
            message: tokenValidation.reason
          });
        }

        // Get user data
        let userData;
        if (tokenValidation.session) {
          userData = await this.getUserFromSession(tokenValidation.session);
        } else {
          // Fallback to token-based user data
          userData = await this.getUserFromToken(token);
        }

        if (!userData) {
          return res.status(401).json({
            error: 'Authentication failed',
            message: 'Invalid user session'
          });
        }

        // Check rate limiting
        const rateLimitKey = `auth:${userData.id}`;
        if (this.rateLimitService.isExceeded(rateLimitKey)) {
          return res.status(429).json({
            error: 'Rate limit exceeded',
            message: 'Too many authentication attempts'
          });
        }

        // Security checks
        await this.performSecurityChecks(req, userData);

        // Add user info to request
        req.user = {
          id: userData.id,
          email: userData.email,
          role: userData.role,
          username: userData.username || userData.email,
          sessionId: tokenValidation.session?.sessionId,
          lastActivity: Date.now(),
          deviceInfo: tokenValidation.session?.deviceInfo
        };

        // Track access for cache warming
        if (this.sessionCacheEnabled) {
          cacheWarmingService.trackAccess('user', userData.id, userData.id);
        }

        next();

      } catch (error) {
        console.error('❌ Authentication middleware error:', error.message);

        // Handle cache errors gracefully
        if (this.cacheFallbackEnabled && this.isCacheError(error)) {
          console.warn('⚠️ Cache error in auth, falling back to token validation');
          return this.fallbackAuth(req, res, next);
        }

        return res.status(500).json({
          error: 'Authentication service error',
          message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
      }
    };
  }

  /**
   * Optional authentication middleware
   */
  optionalAuth() {
    return async (req, res, next) => {
      try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return next();
        }

        // Use the same authentication logic but don't fail if no auth
        const authMiddleware = this.authenticate();
        await authMiddleware(req, res, () => {
          // Continue even if auth fails for optional auth
          next();
        });

      } catch (error) {
        // For optional auth, continue even on errors
        next();
      }
    };
  }

  /**
   * Enhanced login with session caching
   */
  async authenticateUser(userData, deviceInfo = {}) {
    try {
      // Generate tokens
      const payload = {
        userId: userData.id,
        email: userData.email,
        role: userData.role
      };

      const accessToken = this.generateAccessToken(payload);
      const refreshToken = this.generateRefreshToken(payload);

      let sessionData = null;

      // Create session in cache if enabled
      if (this.sessionCacheEnabled && sessionCacheService.initialized) {
        sessionData = await sessionCacheService.createSession(
          userData,
          accessToken,
          refreshToken,
          deviceInfo
        );
      }

      // Trigger cache warming for user data
      if (this.sessionCacheEnabled) {
        await cacheWarmingService.triggerEventWarming('user.login', {
          userId: userData.id,
          event: 'user.login'
        });
      }

      // Clear login attempts
      await sessionCacheService.clearLoginAttempts(userData.email);

      const response = {
        success: true,
        message: 'Authentication successful',
        data: {
          user: {
            id: userData.id,
            email: userData.email,
            role: userData.role,
            username: userData.username || userData.email
          },
          tokens: {
            accessToken,
            refreshToken,
            expiresIn: this.parseExpiry(this.tokenExpiry)
          }
        }
      };

      // Add session info if available
      if (sessionData) {
        response.data.session = {
          sessionId: sessionData.sessionId,
          deviceInfo: sessionData.deviceInfo,
          expiresAt: sessionData.expiresAt
        };
      }

      return response;

    } catch (error) {
      console.error('❌ Error in user authentication:', error.message);
      throw error;
    }
  }

  /**
   * Enhanced logout with cache invalidation
   */
  async logoutUser(sessionId, userId = null) {
    try {
      let invalidated = false;

      // Invalidate session in cache
      if (this.sessionCacheEnabled && sessionId && sessionCacheService.initialized) {
        invalidated = await sessionCacheService.invalidateSession(sessionId);
      }

      // Trigger cache invalidation for user data
      if (userId) {
        await cacheInvalidationService.invalidate('user.logout', { userId });
      }

      // Clear rate limiting
      if (userId) {
        await sessionCacheService.clearLoginAttempts(userId);
      }

      return {
        success: true,
        message: 'Logout successful',
        invalidated
      };

    } catch (error) {
      console.error('❌ Error in user logout:', error.message);
      throw error;
    }
  }

  /**
   * Refresh tokens with session management
   */
  async refreshTokens(refreshToken, sessionId = null) {
    try {
      // Validate refresh token
      let tokenValidation;
      if (this.sessionCacheEnabled && sessionCacheService.initialized) {
        tokenValidation = await sessionCacheService.validateJWT(refreshToken, 'refresh');
      } else {
        try {
          const decoded = this.verifyToken(refreshToken, 'refresh');
          tokenValidation = { valid: true, userId: decoded.sub, session: null };
        } catch (error) {
          tokenValidation = { valid: false, reason: error.message };
        }
      }

      if (!tokenValidation.valid) {
        throw new Error('Invalid refresh token');
      }

      // Get user data
      const userData = await this.getUserFromToken(refreshToken);
      if (!userData) {
        throw new Error('User not found');
      }

      // Generate new tokens
      const payload = {
        userId: userData.id,
        email: userData.email,
        role: userData.role
      };

      const newAccessToken = this.generateAccessToken(payload);
      const newRefreshToken = this.generateRefreshToken(payload);

      // Update session if available
      if (tokenValidation.session && this.sessionCacheEnabled) {
        await sessionCacheService.refreshSession(
          tokenValidation.session.sessionId,
          newAccessToken,
          newRefreshToken
        );
      }

      return {
        success: true,
        data: {
          tokens: {
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            expiresIn: this.parseExpiry(this.tokenExpiry)
          }
        }
      };

    } catch (error) {
      console.error('❌ Error refreshing tokens:', error.message);
      throw error;
    }
  }

  /**
   * Get user from session cache
   */
  async getUserFromSession(session) {
    try {
      return {
        id: session.userId,
        email: session.email,
        role: session.role,
        sessionId: session.sessionId,
        deviceInfo: session.deviceInfo,
        lastActivity: session.lastActivity
      };
    } catch (error) {
      console.error('❌ Error getting user from session:', error.message);
      return null;
    }
  }

  /**
   * Get user from token (fallback)
   */
  async getUserFromToken(token) {
    try {
      const decoded = this.verifyToken(token, 'access');
      return {
        id: decoded.sub,
        email: decoded.email,
        role: decoded.role
      };
    } catch (error) {
      console.error('❌ Error getting user from token:', error.message);
      return null;
    }
  }

  /**
   * Perform security checks
   */
  async performSecurityChecks(req, userData) {
    if (!this.securityFeatures.enabled) return;

    const deviceInfo = {
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.headers['user-agent'] || 'Unknown'
    };

    // Detect suspicious activity
    if (this.securityFeatures.suspiciousActivityDetection && this.sessionCacheEnabled) {
      const isSuspicious = await sessionCacheService.detectSuspiciousActivity(userData.id, deviceInfo);

      if (isSuspicious) {
        console.warn(`🚨 Suspicious activity detected for user ${userData.id}`);
        // Could trigger additional verification steps here
      }
    }

    // IP validation
    if (this.securityFeatures.ipValidation && this.sessionCacheEnabled) {
      // Validate IP against previous sessions if needed
      // Implementation depends on specific security requirements
    }

    // Device tracking
    if (this.securityFeatures.deviceTracking) {
      // Track device for security monitoring
      // Implementation depends on specific tracking requirements
    }
  }

  /**
   * Fallback authentication without cache
   */
  async fallbackAuth(req, res, next) {
    try {
      console.log('🔄 Using fallback authentication');

      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          error: 'Authentication required',
          message: 'Bearer token is required'
        });
      }

      const token = authHeader.substring(7);
      const decoded = this.verifyToken(token, 'access');

      // Check rate limiting
      const rateLimitKey = `auth:${decoded.sub}`;
      if (this.rateLimitService.isExceeded(rateLimitKey)) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: 'Too many authentication attempts'
        });
      }

      // Add user info to request
      req.user = {
        id: decoded.sub,
        email: decoded.email,
        role: decoded.role,
        jti: decoded.jti,
        cacheFallback: true
      };

      next();

    } catch (error) {
      return res.status(401).json({
        error: 'Authentication failed',
        message: error.message
      });
    }
  }

  /**
   * Setup cache invalidation rules for auth events
   */
  setupAuthInvalidationRules() {
    if (!cacheInvalidationService.initialized) return;

    // User login invalidation
    cacheInvalidationService.addRule('user.login', async (data) => {
      await cacheInvalidationService.invalidateUserLoginHistory(data.userId);
      await cacheInvalidationService.invalidateUserSessions(data.userId);
    });

    // User logout invalidation
    cacheInvalidationService.addRule('user.logout', async (data) => {
      await cacheInvalidationService.invalidateUserSessions(data.userId);
      await cacheInvalidationService.invalidateUserLoginHistory(data.userId);
    });

    // Password change invalidation
    cacheInvalidationService.addRule('user.password.changed', async (data) => {
      await cacheInvalidationService.invalidateAllUserSessions(data.userId);
      await cacheInvalidationService.invalidateUserLoginHistory(data.userId);
    });

    console.log('✅ Auth cache invalidation rules configured');
  }

  /**
   * Setup cache warming for auth data
   */
  setupAuthCacheWarming() {
    if (!cacheWarmingService.initialized) return;

    console.log('✅ Auth cache warming configured');
  }

  /**
   * Check if error is cache-related
   */
  isCacheError(error) {
    const cacheErrorPatterns = [
      /redis/i,
      /cache/i,
      /connection.*refused/i,
      /timeout/i,
      /ECONNREFUSED/i
    ];

    return cacheErrorPatterns.some(pattern => pattern.test(error.message));
  }

  /**
   * Get authentication statistics
   */
  async getAuthStats() {
    try {
      const stats = {
        cacheEnabled: this.sessionCacheEnabled,
        sessionCacheHealth: 'unknown',
        activeSessions: 0,
        cacheHitRate: 0
      };

      if (this.sessionCacheEnabled && sessionCacheService.initialized) {
        const sessionStats = await sessionCacheService.getSessionStats();
        stats.sessionCacheHealth = sessionStats.status || 'unknown';
        stats.activeSessions = sessionStats.activeSessions || 0;
      }

      return stats;

    } catch (error) {
      console.error('❌ Error getting auth stats:', error.message);
      return {
        cacheEnabled: this.sessionCacheEnabled,
        error: error.message
      };
    }
  }

  /**
   * Health check for enhanced auth
   */
  async healthCheck() {
    try {
      const health = {
        status: 'healthy',
        cacheEnabled: this.sessionCacheEnabled,
        cacheFallback: this.cacheFallbackEnabled,
        components: {}
      };

      if (this.sessionCacheEnabled) {
        health.components.sessionCache = await sessionCacheService.healthCheck();
      }

      const hasUnhealthy = Object.values(health.components).some(comp => comp.status === 'unhealthy');
      health.status = hasUnhealthy ? 'degraded' : 'healthy';

      return health;

    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  /**
   * Close enhanced auth middleware
   */
  async close() {
    try {
      if (this.sessionCacheEnabled && sessionCacheService.initialized) {
        await sessionCacheService.close();
      }

      console.log('✅ Enhanced Authentication Middleware closed');
    } catch (error) {
      console.error('❌ Error closing enhanced auth middleware:', error.message);
      throw error;
    }
  }
}

// Create singleton instance
const enhancedAuthMiddleware = new EnhancedAuthMiddleware({
  sessionCache: true,
  cacheFallback: true,
  deviceTracking: true,
  ipValidation: false,
  suspiciousActivityDetection: true,
  sessionRotation: false
});

export default enhancedAuthMiddleware;
export { EnhancedAuthMiddleware };