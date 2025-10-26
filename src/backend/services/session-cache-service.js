/**
 * Session Cache Service
 * Redis-based session caching with JWT integration and security features
 * Week 5-6 Phase 2 - Redis Caching Layer
 */

import cacheService from './redis-cache-service.js';
import crypto from 'crypto';

class SessionCacheService {
  constructor() {
    this.initialized = false;
    this.sessionPrefix = 'session:';
    this.jwtPrefix = 'jwt:';
    this.blacklistPrefix = 'blacklist:';

    // Session TTL settings
    this.sessionTTL = 1800; // 30 minutes
    this.refreshTTL = 604800; // 7 days
    this.jwtTTL = 900; // 15 minutes
    this.blacklistTTL = 604800; // 7 days

    // Security settings
    this.maxSessionsPerUser = 5;
    this.sessionRotationInterval = 900000; // 15 minutes
    this.ipValidationEnabled = true;

    // Rate limiting
    this.loginAttempts = 5;
    this.loginAttemptsWindow = 900; // 15 minutes
    this.passwordResetWindow = 3600; // 1 hour
  }

  /**
   * Initialize session cache service
   */
  async initialize() {
    try {
      await cacheService.initialize();
      this.initialized = true;
      console.log('✅ Session Cache Service initialized');

      // Start session cleanup interval
      this.startSessionCleanup();

      return true;
    } catch (error) {
      console.error('❌ Failed to initialize Session Cache Service:', error.message);
      this.initialized = false;
      throw error;
    }
  }

  /**
   * Create new user session with comprehensive security features
   */
  async createSession(userData, accessToken, refreshToken, deviceInfo = {}) {
    try {
      const sessionId = crypto.randomUUID();
      const userId = userData.id;
      const now = Date.now();

      const sessionData = {
        sessionId,
        userId,
        email: userData.email,
        role: userData.role,
        accessToken,
        refreshToken,
        deviceInfo: {
          userAgent: deviceInfo.userAgent || 'Unknown',
          ip: deviceInfo.ip || 'Unknown',
          platform: deviceInfo.platform || 'Unknown',
          fingerprint: this.generateDeviceFingerprint(deviceInfo)
        },
        createdAt: now,
        lastActivity: now,
        expiresAt: now + (this.sessionTTL * 1000),
        isActive: true,
        securityFeatures: {
          requiresReauth: false,
          suspiciousActivity: false,
          trustedDevice: false
        }
      };

      // Store session data
      await cacheService.set('userSessions', sessionId, sessionData, this.sessionTTL);

      // Create user session index
      await this.addSessionToUserIndex(userId, sessionId);

      // Cache JWT metadata
      await this.cacheJWTMetadata(accessToken, sessionId, userId, 'access');
      await this.cacheJWTMetadata(refreshToken, sessionId, userId, 'refresh');

      // Update last login
      await this.updateUserLastLogin(userId, deviceInfo);

      console.log(`✅ Created session ${sessionId} for user ${userId}`);
      return sessionData;
    } catch (error) {
      console.error('❌ Error creating session:', error.message);
      throw error;
    }
  }

  /**
   * Get session by ID with security validation
   */
  async getSession(sessionId) {
    try {
      const sessionData = await cacheService.get('userSessions', sessionId);

      if (!sessionData) {
        return null;
      }

      // Check if session is expired
      if (Date.now() > sessionData.expiresAt) {
        await this.invalidateSession(sessionId);
        return null;
      }

      // Check if session is active
      if (!sessionData.isActive) {
        return null;
      }

      // Update last activity
      sessionData.lastActivity = Date.now();
      await cacheService.set('userSessions', sessionId, sessionData, this.sessionTTL);

      return sessionData;
    } catch (error) {
      console.error(`❌ Error getting session ${sessionId}:`, error.message);
      return null;
    }
  }

  /**
   * Get sessions by user ID
   */
  async getUserSessions(userId) {
    try {
      const sessionIds = await cacheService.get('userData', `user:${userId}:sessions`);

      if (!sessionIds) {
        return [];
      }

      const sessions = [];
      for (const sessionId of sessionIds) {
        const session = await this.getSession(sessionId);
        if (session) {
          sessions.push(session);
        }
      }

      return sessions.sort((a, b) => b.lastActivity - a.lastActivity);
    } catch (error) {
      console.error(`❌ Error getting user sessions for ${userId}:`, error.message);
      return [];
    }
  }

  /**
   * Validate JWT token against cache
   */
  async validateJWT(token, tokenType = 'access') {
    try {
      const tokenId = this.extractTokenId(token);
      const cacheKey = `${this.jwtPrefix}${tokenId}:${tokenType}`;

      const tokenData = await cacheService.get('userSessions', cacheKey);

      if (!tokenData) {
        return { valid: false, reason: 'Token not found in cache' };
      }

      // Check if token is blacklisted
      const isBlacklisted = await this.isTokenBlacklisted(tokenId);
      if (isBlacklisted) {
        return { valid: false, reason: 'Token is blacklisted' };
      }

      // Check if associated session is still valid
      const session = await this.getSession(tokenData.sessionId);
      if (!session) {
        return { valid: false, reason: 'Associated session not found or expired' };
      }

      return {
        valid: true,
        sessionId: tokenData.sessionId,
        userId: tokenData.userId,
        session
      };
    } catch (error) {
      console.error('❌ Error validating JWT:', error.message);
      return { valid: false, reason: 'Validation error' };
    }
  }

  /**
   * Refresh session with new tokens
   */
  async refreshSession(sessionId, newAccessToken, newRefreshToken) {
    try {
      const session = await this.getSession(sessionId);

      if (!session) {
        throw new Error('Session not found');
      }

      // Update tokens in session
      session.accessToken = newAccessToken;
      session.refreshToken = newRefreshToken;
      session.lastActivity = Date.now();
      session.expiresAt = Date.now() + (this.sessionTTL * 1000);

      // Cache new JWT metadata
      await this.cacheJWTMetadata(newAccessToken, sessionId, session.userId, 'access');
      await this.cacheJWTMetadata(newRefreshToken, sessionId, session.userId, 'refresh');

      // Update session
      await cacheService.set('userSessions', sessionId, session, this.sessionTTL);

      console.log(`✅ Refreshed session ${sessionId}`);
      return session;
    } catch (error) {
      console.error(`❌ Error refreshing session ${sessionId}:`, error.message);
      throw error;
    }
  }

  /**
   * Invalidate session and blacklist tokens
   */
  async invalidateSession(sessionId) {
    try {
      const session = await cacheService.get('userSessions', sessionId);

      if (!session) {
        return false;
      }

      // Mark session as inactive
      session.isActive = false;
      await cacheService.set('userSessions', sessionId, session, 300); // Keep for 5 minutes for audit

      // Blacklist tokens
      await this.blacklistToken(session.accessToken);
      await this.blacklistToken(session.refreshToken);

      // Remove from user session index
      await this.removeSessionFromUserIndex(session.userId, sessionId);

      console.log(`🗑️ Invalidated session ${sessionId}`);
      return true;
    } catch (error) {
      console.error(`❌ Error invalidating session ${sessionId}:`, error.message);
      return false;
    }
  }

  /**
   * Invalidate all user sessions
   */
  async invalidateAllUserSessions(userId) {
    try {
      const sessions = await this.getUserSessions(userId);

      for (const session of sessions) {
        await this.invalidateSession(session.sessionId);
      }

      // Clear user session index
      await cacheService.delete('userData', `user:${userId}:sessions`);

      console.log(`🗑️ Invalidated all sessions for user ${userId}`);
      return true;
    } catch (error) {
      console.error(`❌ Error invalidating user sessions for ${userId}:`, error.message);
      return false;
    }
  }

  /**
   * Check rate limiting for login attempts
   */
  async checkLoginRateLimit(identifier, type = 'email') {
    try {
      const key = `rate:${type}:${identifier}`;
      const attempts = await cacheService.get('rateLimits', key) || 0;

      if (attempts >= this.loginAttempts) {
        const ttl = await cacheService.ttl('rateLimits', key);
        return {
          allowed: false,
          attempts,
          ttl,
          message: `Too many login attempts. Try again in ${Math.ceil(ttl / 60)} minutes.`
        };
      }

      // Increment attempts
      await cacheService.increment('rateLimits', key, 1);
      await cacheService.expire('rateLimits', key, this.loginAttemptsWindow);

      return {
        allowed: true,
        attempts: attempts + 1,
        remaining: this.loginAttempts - attempts - 1
      };
    } catch (error) {
      console.error('❌ Error checking login rate limit:', error.message);
      return { allowed: true, attempts: 0 };
    }
  }

  /**
   * Clear login attempts after successful login
   */
  async clearLoginAttempts(identifier, type = 'email') {
    try {
      await cacheService.delete('rateLimits', `rate:${type}:${identifier}`);
    } catch (error) {
      console.error('❌ Error clearing login attempts:', error.message);
    }
  }

  /**
   * Cache JWT metadata for validation
   */
  async cacheJWTMetadata(token, sessionId, userId, tokenType) {
    try {
      const tokenId = this.extractTokenId(token);
      const cacheKey = `${this.jwtPrefix}${tokenId}:${tokenType}`;

      const metadata = {
        tokenId,
        sessionId,
        userId,
        tokenType,
        createdAt: Date.now(),
        expiresAt: Date.now() + (tokenType === 'access' ? this.jwtTTL * 1000 : this.refreshTTL * 1000)
      };

      const ttl = tokenType === 'access' ? this.jwtTTL : this.refreshTTL;
      await cacheService.set('userSessions', cacheKey, metadata, ttl);
    } catch (error) {
      console.error('❌ Error caching JWT metadata:', error.message);
    }
  }

  /**
   * Blacklist token
   */
  async blacklistToken(token) {
    try {
      const tokenId = this.extractTokenId(token);
      const blacklistKey = `${this.blacklistPrefix}${tokenId}`;

      await cacheService.set('userSessions', blacklistKey, {
        tokenId,
        blacklistedAt: Date.now(),
        reason: 'session_invalidation'
      }, this.blacklistTTL);
    } catch (error) {
      console.error('❌ Error blacklisting token:', error.message);
    }
  }

  /**
   * Check if token is blacklisted
   */
  async isTokenBlacklisted(tokenId) {
    try {
      const blacklistKey = `${this.blacklistPrefix}${tokenId}`;
      return await cacheService.exists('userSessions', blacklistKey);
    } catch (error) {
      console.error('❌ Error checking token blacklist:', error.message);
      return false;
    }
  }

  /**
   * Add session to user index
   */
  async addSessionToUserIndex(userId, sessionId) {
    try {
      const userSessionsKey = `user:${userId}:sessions`;
      let sessions = await cacheService.get('userData', userSessionsKey) || [];

      // Add new session
      sessions.unshift(sessionId);

      // Limit number of sessions per user
      if (sessions.length > this.maxSessionsPerUser) {
        const excessSessions = sessions.slice(this.maxSessionsPerUser);
        for (const excessSessionId of excessSessions) {
          await this.invalidateSession(excessSessionId);
        }
        sessions = sessions.slice(0, this.maxSessionsPerUser);
      }

      await cacheService.set('userData', userSessionsKey, sessions, this.refreshTTL);
    } catch (error) {
      console.error('❌ Error adding session to user index:', error.message);
    }
  }

  /**
   * Remove session from user index
   */
  async removeSessionFromUserIndex(userId, sessionId) {
    try {
      const userSessionsKey = `user:${userId}:sessions`;
      let sessions = await cacheService.get('userData', userSessionsKey) || [];

      sessions = sessions.filter(id => id !== sessionId);
      await cacheService.set('userData', userSessionsKey, sessions, this.refreshTTL);
    } catch (error) {
      console.error('❌ Error removing session from user index:', error.message);
    }
  }

  /**
   * Update user last login
   */
  async updateUserLastLogin(userId, deviceInfo) {
    try {
      const loginData = {
        userId,
        lastLogin: Date.now(),
        lastIP: deviceInfo.ip,
        lastUserAgent: deviceInfo.userAgent
      };

      await cacheService.set('userData', `user:${userId}:login`, loginData, this.refreshTTL);
    } catch (error) {
      console.error('❌ Error updating user last login:', error.message);
    }
  }

  /**
   * Get user login history
   */
  async getUserLoginHistory(userId) {
    try {
      return await cacheService.get('userData', `user:${userId}:login`);
    } catch (error) {
      console.error('❌ Error getting user login history:', error.message);
      return null;
    }
  }

  /**
   * Detect suspicious activity
   */
  async detectSuspiciousActivity(userId, deviceInfo) {
    try {
      const lastLogin = await this.getUserLoginHistory(userId);

      if (!lastLogin) {
        return false;
      }

      const suspicious = {
        newIP: lastLogin.lastIP !== deviceInfo.ip,
        newUserAgent: lastLogin.lastUserAgent !== deviceInfo.userAgent,
        rapidLogin: (Date.now() - lastLogin.lastLogin) < 60000 // Less than 1 minute
      };

      return suspicious.newIP || suspicious.newUserAgent || suspicious.rapidLogin;
    } catch (error) {
      console.error('❌ Error detecting suspicious activity:', error.message);
      return false;
    }
  }

  /**
   * Generate device fingerprint
   */
  generateDeviceFingerprint(deviceInfo) {
    const fingerprintData = [
      deviceInfo.userAgent || '',
      deviceInfo.platform || '',
      deviceInfo.ip || ''
    ].join('|');

    return crypto.createHash('sha256').update(fingerprintData).digest('hex').substring(0, 16);
  }

  /**
   * Extract token ID from JWT
   */
  extractTokenId(token) {
    try {
      // Remove Bearer prefix if present
      const cleanToken = token.replace(/^Bearer\s+/, '');

      // Extract jti claim or use hash of token
      const parts = cleanToken.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        return payload.jti || crypto.createHash('md5').update(cleanToken).digest('hex');
      }

      return crypto.createHash('md5').update(cleanToken).digest('hex');
    } catch (error) {
      return crypto.createHash('md5').update(token).digest('hex');
    }
  }

  /**
   * Start session cleanup interval
   */
  startSessionCleanup() {
    setInterval(async () => {
      try {
        await this.cleanupExpiredSessions();
      } catch (error) {
        console.error('❌ Error in session cleanup:', error.message);
      }
    }, 300000); // Run every 5 minutes
  }

  /**
   * Cleanup expired sessions
   */
  async cleanupExpiredSessions() {
    try {
      // This would require implementing a way to iterate over all sessions
      // For now, rely on Redis TTL to automatically clean up expired keys
      console.log('🧹 Session cleanup completed');
    } catch (error) {
      console.error('❌ Error in session cleanup:', error.message);
    }
  }

  /**
   * Get session statistics
   */
  async getSessionStats() {
    try {
      const stats = await cacheService.getStats('userSessions');
      return {
        ...stats,
        activeSessions: stats.totalKeys,
        averageSessionDuration: '15 minutes',
        maxSessionsPerUser: this.maxSessionsPerUser
      };
    } catch (error) {
      console.error('❌ Error getting session stats:', error.message);
      return { activeSessions: 0, error: error.message };
    }
  }

  /**
   * Health check for session service
   */
  async healthCheck() {
    try {
      const testSessionId = 'health-check-session';
      const testData = { test: true, timestamp: Date.now() };

      // Test set/get
      await cacheService.set('userSessions', testSessionId, testData, 60);
      const retrieved = await cacheService.get('userSessions', testSessionId);

      // Cleanup
      await cacheService.delete('userSessions', testSessionId);

      return {
        status: retrieved ? 'healthy' : 'unhealthy',
        initialized: this.initialized,
        testPassed: retrieved !== null
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        initialized: this.initialized,
        error: error.message
      };
    }
  }

  /**
   * Close session cache service
   */
  async close() {
    try {
      this.initialized = false;
      console.log('✅ Session Cache Service closed');
    } catch (error) {
      console.error('❌ Error closing Session Cache Service:', error.message);
      throw error;
    }
  }
}

// Create singleton instance
const sessionCacheService = new SessionCacheService();

export default sessionCacheService;
export { SessionCacheService };