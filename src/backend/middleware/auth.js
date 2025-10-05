/**
 * Authentication and Authorization Middleware
 * Handles session validation and security checks
 */

import jwt from 'jsonwebtoken';
import { DatabaseService } from '../services/database.js';

const dbService = new DatabaseService();

/**
 * Validate session middleware
 */
export const validateSession = async (req, res, next) => {
  try {
    const sessionId = req.headers['x-session-id'];
    const authorization = req.headers.authorization;

    // Allow health check without authentication
    if (req.path.startsWith('/health')) {
      return next();
    }

    // Session ID validation
    if (!sessionId) {
      return res.status(401).json({
        error: 'Session ID required',
        message: 'X-Session-ID header is required',
      });
    }

    // Validate session format
    if (!isValidUUID(sessionId)) {
      return res.status(401).json({
        error: 'Invalid session format',
        message: 'Session ID must be a valid UUID',
      });
    }

    // Check if session exists and is active
    const session = await dbService.getSession(sessionId);
    if (!session) {
      return res.status(401).json({
        error: 'Session not found',
        message: 'Invalid or expired session',
      });
    }

    if (session.status !== 'active') {
      return res.status(401).json({
        error: 'Session inactive',
        message: 'Session is not active',
        status: session.status,
      });
    }

    // Check session expiration
    if (session.expires_at && new Date(session.expires_at) < new Date()) {
      return res.status(401).json({
        error: 'Session expired',
        message: 'Session has expired',
        expired_at: session.expires_at,
      });
    }

    // Update session last activity
    await dbService.updateSessionActivity(sessionId);

    // Attach session to request
    req.session = session;
    req.sessionId = sessionId;

    // Handle JWT token if provided
    if (authorization && authorization.startsWith('Bearer ')) {
      const token = authorization.substring(7);
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default-secret');
        req.user = decoded;
      } catch (tokenError) {
        // Token is optional, so we continue without it
        console.warn('Invalid JWT token provided:', tokenError.message);
      }
    }

    next();
  } catch (error) {
    console.error('Session validation error:', error);
    res.status(500).json({
      error: 'Authentication error',
      message: 'Failed to validate session',
    });
  }
};

/**
 * Require authentication middleware
 */
export const requireAuth = (req, res, next) => {
  if (!req.session) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'Valid session is required for this endpoint',
    });
  }
  next();
};

/**
 * Require user authentication middleware
 */
export const requireUser = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'User authentication required',
      message: 'Valid user token is required for this endpoint',
    });
  }
  next();
};

/**
 * Admin role middleware
 */
export const requireAdmin = (req, res, next) => {
  if (!req.user || !req.user.roles || !req.user.roles.includes('admin')) {
    return res.status(403).json({
      error: 'Admin access required',
      message: 'This endpoint requires admin privileges',
    });
  }
  next();
};

/**
 * Rate limiting middleware for specific users
 */
export const createUserRateLimit = (options = {}) => {
  const userRequests = new Map();
  const windowMs = options.windowMs || 15 * 60 * 1000; // 15 minutes
  const maxRequests = options.max || 1000;

  return (req, res, next) => {
    if (!req.sessionId) {
      return next();
    }

    const key = req.sessionId;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Get or create user request tracking
    if (!userRequests.has(key)) {
      userRequests.set(key, []);
    }

    const requests = userRequests.get(key);

    // Remove old requests outside the window
    const validRequests = requests.filter(timestamp => timestamp > windowStart);
    userRequests.set(key, validRequests);

    // Check if user exceeded limit
    if (validRequests.length >= maxRequests) {
      return res.status(429).json({
        error: 'Too many requests',
        message: `Rate limit exceeded. Maximum ${maxRequests} requests per ${windowMs / 1000} seconds.`,
        retry_after: Math.ceil((validRequests[0] + windowMs - now) / 1000),
      });
    }

    // Add current request
    validRequests.push(now);

    next();
  };
};

/**
 * CORS middleware for specific origins
 */
export const configureCORS = (allowedOrigins = []) => {
  return (req, res, next) => {
    const origin = req.headers.origin;

    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      res.header('Access-Control-Allow-Origin', origin);
    }

    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Session-ID');
    res.header('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    next();
  };
};

/**
 * Validate API key middleware
 */
export const validateApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
      return res.status(401).json({
        error: 'API key required',
        message: 'X-API-Key header is required',
      });
    }

    // Validate API key in database
    const keyData = await dbService.getApiKey(apiKey);
    if (!keyData) {
      return res.status(401).json({
        error: 'Invalid API key',
        message: 'The provided API key is invalid',
      });
    }

    if (!keyData.active) {
      return res.status(401).json({
        error: 'API key inactive',
        message: 'The API key has been deactivated',
      });
    }

    // Check if key has expired
    if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
      return res.status(401).json({
        error: 'API key expired',
        message: 'The API key has expired',
        expired_at: keyData.expires_at,
      });
    }

    // Attach API key info to request
    req.apiKey = keyData;

    next();
  } catch (error) {
    console.error('API key validation error:', error);
    res.status(500).json({
      error: 'Authentication error',
      message: 'Failed to validate API key',
    });
  }
};

/**
 * Create session middleware
 */
export const createSession = async (req, res, next) => {
  try {
    const { user_id, metadata = {} } = req.body;

    if (!user_id) {
      return res.status(400).json({
        error: 'User ID required',
        message: 'user_id is required to create a session',
      });
    }

    const sessionId = generateUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await dbService.createSession({
      id: sessionId,
      user_id,
      metadata,
      expires_at: expiresAt,
      status: 'active',
      created_at: new Date(),
      last_activity: new Date(),
    });

    res.status(201).json({
      success: true,
      session_id: sessionId,
      expires_at: expiresAt,
      message: 'Session created successfully',
    });
  } catch (error) {
    console.error('Session creation error:', error);
    res.status(500).json({
      error: 'Session creation failed',
      message: 'Failed to create session',
    });
  }
};

/**
 * Utility functions
 */
function isValidUUID(uuid) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * JWT token utilities
 */
export const generateToken = (payload, expiresIn = '24h') => {
  return jwt.sign(payload, process.env.JWT_SECRET || 'default-secret', { expiresIn });
};

export const verifyToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET || 'default-secret');
};

/**
 * Security headers middleware
 */
export const securityHeaders = (req, res, next) => {
  // Remove sensitive headers
  res.removeHeader('X-Powered-By');

  // Security headers
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');
  res.header('X-XSS-Protection', '1; mode=block');
  res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // Content Security Policy
  res.header('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    "connect-src 'self' ws: wss:; " +
    "font-src 'self'; " +
    "object-src 'none'; " +
    "media-src 'self'; " +
    "frame-src 'none';"
  );

  next();
};