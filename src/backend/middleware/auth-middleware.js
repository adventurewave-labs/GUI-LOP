/**
 * Authentication Middleware
 * JWT-based authentication with security features
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { BlacklistService } from '../services/blacklist-service.js';
import { RateLimitService } from '../services/rate-limit-service.js';

export class AuthMiddleware {
  constructor(options = {}) {
    this.jwtSecret = options.jwtSecret || process.env.JWT_SECRET || 'fallback-secret-key';
    this.jwtRefreshSecret = options.jwtRefreshSecret || process.env.JWT_REFRESH_SECRET || 'fallback-refresh-secret';
    this.tokenExpiry = options.tokenExpiry || '15m';
    this.refreshTokenExpiry = options.refreshTokenExpiry || '7d';
    this.saltRounds = options.saltRounds || 12;
    this.blacklistService = new BlacklistService();
    this.rateLimitService = new RateLimitService();

    // Security headers
    this.securityHeaders = {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
    };
  }

  /**
   * Hash password with secure salt
   */
  async hashPassword(password) {
    if (!password || typeof password !== 'string') {
      throw new Error('Password must be a non-empty string');
    }

    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters long');
    }

    try {
      return await bcrypt.hash(password, this.saltRounds);
    } catch (error) {
      throw new Error('Password hashing failed');
    }
  }

  /**
   * Verify password against hash
   */
  async verifyPassword(password, hash) {
    if (!password || !hash) {
      return false;
    }

    try {
      return await bcrypt.compare(password, hash);
    } catch (error) {
      return false;
    }
  }

  /**
   * Generate JWT access token
   */
  generateAccessToken(payload) {
    const now = Math.floor(Date.now() / 1000);
    const tokenPayload = {
      sub: payload.userId,
      email: payload.email,
      role: payload.role || 'user',
      iat: now,
      exp: now + this.parseExpiry(this.tokenExpiry),
      jti: crypto.randomUUID(),
      type: 'access'
    };

    return jwt.sign(tokenPayload, this.jwtSecret, {
      algorithm: 'HS256',
      issuer: 'gui-lop',
      audience: 'gui-lop-users'
    });
  }

  /**
   * Generate JWT refresh token
   */
  generateRefreshToken(payload) {
    const now = Math.floor(Date.now() / 1000);
    const tokenPayload = {
      sub: payload.userId,
      email: payload.email,
      iat: now,
      exp: now + this.parseExpiry(this.refreshTokenExpiry),
      jti: crypto.randomUUID(),
      type: 'refresh'
    };

    return jwt.sign(tokenPayload, this.jwtRefreshSecret, {
      algorithm: 'HS256',
      issuer: 'gui-lop',
      audience: 'gui-lop-refresh'
    });
  }

  /**
   * Verify JWT token
   */
  verifyToken(token, tokenType = 'access') {
    if (!token) {
      throw new Error('Token is required');
    }

    try {
      // Remove Bearer prefix if present
      const cleanToken = token.replace(/^Bearer\s+/, '');

      // Check if token is blacklisted
      const decoded = jwt.decode(cleanToken);
      if (decoded && decoded.jti) {
        if (this.blacklistService.isBlacklisted(decoded.jti)) {
          throw new Error('Token has been revoked');
        }
      }

      const secret = tokenType === 'refresh' ? this.jwtRefreshSecret : this.jwtSecret;
      const audience = tokenType === 'refresh' ? 'gui-lop-refresh' : 'gui-lop-users';

      return jwt.verify(cleanToken, secret, {
        algorithms: ['HS256'],
        issuer: 'gui-lop',
        audience: audience
      });
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new Error('Token has expired');
      } else if (error.name === 'JsonWebTokenError') {
        throw new Error('Invalid token');
      } else {
        throw error;
      }
    }
  }

  /**
   * Middleware to authenticate requests
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
          jti: decoded.jti
        };

        next();
      } catch (error) {
        return res.status(401).json({
          error: 'Authentication failed',
          message: error.message
        });
      }
    };
  }

  /**
   * Middleware for role-based authorization
   */
  authorize(allowedRoles) {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          error: 'Authentication required',
          message: 'User not authenticated'
        });
      }

      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          error: 'Insufficient permissions',
          message: 'Role not authorized for this resource'
        });
      }

      next();
    };
  }

  /**
   * Revoke token (add to blacklist)
   */
  async revokeToken(jti) {
    return this.blacklistService.addToBlacklist(jti);
  }

  /**
   * Revoke all user tokens
   */
  async revokeAllUserTokens(userId) {
    return this.blacklistService.blacklistUserTokens(userId);
  }

  /**
   * Parse expiry time string to seconds
   */
  parseExpiry(expiry) {
    const unit = expiry.slice(-1);
    const value = parseInt(expiry.slice(0, -1));

    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 3600;
      case 'd': return value * 86400;
      default: return 900; // 15 minutes default
    }
  }

  /**
   * Generate secure CSRF token
   */
  generateCSRFToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Verify CSRF token
   */
  verifyCSRFToken(token, sessionToken) {
    return crypto.timingSafeEqual(
      Buffer.from(token, 'hex'),
      Buffer.from(sessionToken, 'hex')
    );
  }
}

export default AuthMiddleware;