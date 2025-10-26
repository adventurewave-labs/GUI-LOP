/**
 * Authentication Middleware - Express.js Route Protection
 * Provides JWT authentication, authorization, and security features
 */

import { verifyAccessToken } from '../utils/jwtUtils.js';
import { userStore } from '../models/User.js';

/**
 * Authentication Middleware - Verify JWT access token
 */
export const authenticate = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access token required. Please provide Bearer token in Authorization header.',
        code: 'TOKEN_REQUIRED'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify the token
    const decoded = verifyAccessToken(token);

    // Get user from database
    const user = userStore.findById(decoded.sub);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'User account is deactivated',
        code: 'USER_DEACTIVATED'
      });
    }

    // Attach user info to request object
    req.user = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      isActive: user.isActive
    };

    // Attach token info for potential refresh token validation
    req.token = {
      jti: decoded.jti,
      iat: decoded.iat,
      exp: decoded.exp
    };

    next();
  } catch (error) {
    console.error('Authentication error:', error.message);

    if (error.message.includes('expired')) {
      return res.status(401).json({
        success: false,
        message: 'Access token expired. Please refresh your token.',
        code: 'TOKEN_EXPIRED'
      });
    } else if (error.message.includes('revoked')) {
      return res.status(401).json({
        success: false,
        message: 'Token has been revoked. Please login again.',
        code: 'TOKEN_REVOKED'
      });
    } else {
      return res.status(401).json({
        success: false,
        message: 'Invalid access token.',
        code: 'TOKEN_INVALID'
      });
    }
  }
};

/**
 * Optional Authentication - Try to authenticate but don't fail if no token
 */
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(); // No token, continue without authentication
    }

    // If token exists, verify it
    const token = authHeader.substring(7);
    const decoded = verifyAccessToken(token);

    const user = userStore.findById(decoded.sub);
    if (user && user.isActive) {
      req.user = {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        isActive: user.isActive
      };
      req.token = {
        jti: decoded.jti,
        iat: decoded.iat,
        exp: decoded.exp
      };
    }

    next();
  } catch (error) {
    // Log error but don't fail the request for optional auth
    console.log('Optional authentication failed:', error.message);
    next();
  }
};

/**
 * Role-based Authorization Middleware Factory
 * @param {string|array} roles - Required role(s) to access the route
 */
export const authorize = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    const requiredRoles = Array.isArray(roles) ? roles : [roles];
    const hasRole = requiredRoles.includes(req.user.role);

    if (!hasRole) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role(s): ${requiredRoles.join(', ')}`,
        code: 'INSUFFICIENT_PERMISSIONS',
        userRole: req.user.role,
        requiredRoles
      });
    }

    next();
  };
};

/**
 * Resource Owner Middleware - Check if user owns the resource
 * @param {string} resourceIdParam - Parameter name containing resource owner ID
 */
export const resourceOwner = (resourceIdParam = 'userId') => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    const resourceOwnerId = req.params[resourceIdParam];

    // Admin can access any resource
    if (req.user.role === 'admin') {
      return next();
    }

    // Check if user owns the resource
    if (req.user.id !== resourceOwnerId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only access your own resources.',
        code: 'RESOURCE_ACCESS_DENIED',
        userId: req.user.id,
        resourceOwnerId
      });
    }

    next();
  };
};

/**
 * Rate Limiting Middleware for Authentication Routes
 */
export const authRateLimit = (maxAttempts = 5, windowMs = 15 * 60 * 1000) => {
  const attempts = new Map(); // IP -> {count, lastAttempt, lockUntil}

  return (req, res, next) => {
    const clientIp = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const clientData = attempts.get(clientIp) || { count: 0, lastAttempt: 0, lockUntil: 0 };

    // Check if IP is locked
    if (clientData.lockUntil > now) {
      const remainingTime = Math.ceil((clientData.lockUntil - now) / 1000);
      return res.status(429).json({
        success: false,
        message: `Too many failed attempts. Please try again in ${remainingTime} seconds.`,
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: remainingTime
      });
    }

    // Reset count if window has expired
    if (now - clientData.lastAttempt > windowMs) {
      clientData.count = 0;
      clientData.lastAttempt = now;
    }

    // Increment attempt count
    clientData.count++;
    clientData.lastAttempt = now;

    // Lock IP if max attempts reached
    if (clientData.count >= maxAttempts) {
      clientData.lockUntil = now + windowMs;
      attempts.set(clientIp, clientData);

      return res.status(429).json({
        success: false,
        message: `Maximum ${maxAttempts} failed attempts reached. IP locked for ${Math.ceil(windowMs / 60000)} minutes.`,
        code: 'IP_LOCKED',
        lockDuration: Math.ceil(windowMs / 60000)
      });
    }

    attempts.set(clientIp, clientData);
    next();
  };
};

/**
 * Validate Email Domain Middleware
 * @param {array} allowedDomains - List of allowed email domains
 */
export const validateEmailDomain = (allowedDomains) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    const emailDomain = req.user.email.split('@')[1].toLowerCase();
    const isDomainAllowed = allowedDomains.some(domain =>
      emailDomain === domain.toLowerCase() || emailDomain.endsWith('.' + domain.toLowerCase())
    );

    if (!isDomainAllowed) {
      return res.status(403).json({
        success: false,
        message: 'Email domain not allowed',
        code: 'DOMAIN_NOT_ALLOWED',
        emailDomain,
        allowedDomains
      });
    }

    next();
  };
};

/**
 * Session Validation Middleware - Check if session is still valid
 */
export const validateSession = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
  }

  // Add session validation logic here
  // For now, just check if user account is still active
  if (!req.user.isActive) {
    return res.status(401).json({
      success: false,
      message: 'User session is no longer valid',
      code: 'SESSION_INVALID'
    });
  }

  next();
};

// Pre-built middleware combinations
export const requireAuth = [authenticate];
export const requireAdmin = [authenticate, authorize('admin')];
export const requireUserOrAdmin = [authenticate, authorize(['user', 'admin'])];
export const requireOwnerOrAdmin = (resourceIdParam) => [
  authenticate,
  resourceOwner(resourceIdParam),
  authorize(['user', 'admin'])
];

export default {
  authenticate,
  optionalAuth,
  authorize,
  resourceOwner,
  authRateLimit,
  validateEmailDomain,
  validateSession,
  requireAuth,
  requireAdmin,
  requireUserOrAdmin,
  requireOwnerOrAdmin
};