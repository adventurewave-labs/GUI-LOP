/**
 * Advanced Rate Limiting Middleware
 * Comprehensive rate limiting with different strategies, Redis support, and detailed metrics
 */

import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import Redis from 'ioredis';
import { createHash } from 'crypto';

// Redis client for distributed rate limiting
let redisClient = null;

/**
 * Initialize Redis client for distributed rate limiting
 */
export const initializeRedis = (config = {}) => {
  try {
    redisClient = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      db: process.env.REDIS_DB || 0,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      ...config
    });

    redisClient.on('connect', () => {
      console.log('Rate limiter Redis client connected');
    });

    redisClient.on('error', (err) => {
      console.error('Rate limiter Redis client error:', err);
    });

    return redisClient;
  } catch (error) {
    console.warn('Failed to initialize Redis for rate limiting, falling back to memory store:', error.message);
    return null;
  }
};

// Initialize Redis if available
if (process.env.ENABLE_REDIS_RATE_LIMITING === 'true') {
  initializeRedis();
}

/**
 * Create rate limiter configuration
 */
export const createRateLimiterConfig = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    max = 100,
    message = 'Too many requests',
    standardHeaders = true,
    legacyHeaders = false,
    keyGenerator,
    skip,
    onLimitReached,
    handler,
    store
  } = options;

  return {
    windowMs,
    max,
    message: {
      success: false,
      message,
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: Math.ceil(windowMs / 1000),
      timestamp: new Date().toISOString()
    },
    standardHeaders,
    legacyHeaders,
    keyGenerator: keyGenerator || defaultKeyGenerator,
    skip: skip || defaultSkipFunction,
    onLimitReached: onLimitReached || defaultOnLimitReached,
    handler: handler || defaultRateLimitHandler,
    store: store || (redisClient ? new RedisStore({
      sendCommand: (...args) => redisClient.call(...args),
    }) : undefined)
  };
};

/**
 * Default key generator function
 */
const defaultKeyGenerator = (req) => {
  const ip = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'] || '';
  const userId = req.user?.id || '';

  // Create a hash of IP + user agent for better identification
  const keyData = `${ip}:${userAgent}:${userId}`;
  return createHash('sha256').update(keyData).digest('hex').substring(0, 16);
};

/**
 * Default skip function
 */
const defaultSkipFunction = (req) => {
  // Skip rate limiting for health checks and internal routes
  const skipPaths = ['/health', '/metrics', '/docs', '/api/v1/health'];
  return skipPaths.some(path => req.path.startsWith(path));
};

/**
 * Default handler for rate limit exceeded
 */
const defaultOnLimitReached = (req, res, options) => {
  console.log(`Rate limit exceeded for IP: ${req.ip}, Path: ${req.path}, User: ${req.user?.id || 'anonymous'}`);
};

/**
 * Default rate limit handler
 */
const defaultRateLimitHandler = (req, res, next, options) => {
  const retryAfter = Math.ceil(options.windowMs / 1000);

  res.status(429).json({
    success: false,
    message: options.message.message || 'Too many requests',
    code: 'RATE_LIMIT_EXCEEDED',
    details: {
      limit: options.max,
      windowMs: options.windowMs,
      retryAfter
    },
    timestamp: new Date().toISOString(),
    requestId: req.id || 'unknown'
  });

  // Set rate limit headers
  res.setHeader('Retry-After', retryAfter);
  res.setHeader('X-RateLimit-Limit', options.max);
  res.setHeader('X-RateLimit-Remaining', 0);
  res.setHeader('X-RateLimit-Reset', new Date(Date.now() + options.windowMs).toISOString());
};

/**
 * Pre-configured rate limiters for different use cases
 */

// Authentication endpoints - very strict
export const authRateLimiter = rateLimit(createRateLimiterConfig({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per 15 minutes
  message: 'Too many authentication attempts, please try again later',
  keyGenerator: (req) => {
    const ip = req.ip || req.connection.remoteAddress;
    const email = req.body?.email || '';
    return `auth:${ip}:${email}`;
  },
  onLimitReached: (req, res, options) => {
    console.warn(`Authentication rate limit exceeded for IP: ${req.ip}, Email: ${req.body?.email || 'unknown'}`);

    // Additional security measures can be added here
    // e.g., notify security team, log to security monitoring system
  }
}));

// Registration endpoint - very strict
export const registrationRateLimiter = rateLimit(createRateLimiterConfig({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 registrations per hour
  message: 'Too many registration attempts, please try again later',
  keyGenerator: (req) => {
    const ip = req.ip || req.connection.remoteAddress;
    const email = req.body?.email || '';
    return `register:${ip}:${email}`;
  }
}));

// Password change endpoint - strict
export const passwordChangeRateLimiter = rateLimit(createRateLimiterConfig({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 password changes per hour
  message: 'Too many password change attempts, please try again later',
  keyGenerator: (req) => {
    const userId = req.user?.id || '';
    const ip = req.ip || req.connection.remoteAddress;
    return `password:${userId}:${ip}`;
  }
}));

// Token refresh endpoint - moderate
export const tokenRefreshRateLimiter = rateLimit(createRateLimiterConfig({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 refreshes per 15 minutes
  message: 'Too many token refresh attempts, please try again later',
  keyGenerator: (req) => {
    const userId = req.user?.id || '';
    return `refresh:${userId}`;
  }
}));

// General API endpoints - moderate
export const generalApiRateLimiter = rateLimit(createRateLimiterConfig({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 1000 requests per 15 minutes
  message: 'Too many API requests, please slow down',
  keyGenerator: (req) => {
    const userId = req.user?.id || '';
    const ip = req.ip || req.connection.remoteAddress;
    return userId ? `api:user:${userId}` : `api:ip:${ip}`;
  }
}));

// Workflow creation - strict
export const workflowCreationRateLimiter = rateLimit(createRateLimiterConfig({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // 50 workflows per hour
  message: 'Too many workflows created, please try again later',
  keyGenerator: (req) => {
    const userId = req.user?.id || '';
    return `workflow:create:${userId}`;
  }
}));

// Workflow execution - strict
export const workflowExecutionRateLimiter = rateLimit(createRateLimiterConfig({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 100, // 100 executions per hour
  message: 'Too many workflow executions, please try again later',
  keyGenerator: (req) => {
    const userId = req.user?.id || '';
    return `workflow:execute:${userId}`;
  }
}));

// File upload - very strict
export const fileUploadRateLimiter = rateLimit(createRateLimiterConfig({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 uploads per hour
  message: 'Too many file uploads, please try again later',
  keyGenerator: (req) => {
    const userId = req.user?.id || '';
    const ip = req.ip || req.connection.remoteAddress;
    return `upload:${userId}:${ip}`;
  }
}));

// Public endpoints - lenient
export const publicApiRateLimiter = rateLimit(createRateLimiterConfig({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per 15 minutes
  message: 'Too many requests from this IP, please try again later',
  keyGenerator: (req) => {
    const ip = req.ip || req.connection.remoteAddress;
    return `public:${ip}`;
  }
}));

/**
 * Advanced rate limiting strategies
 */

/**
 * Progressive rate limiting - gets stricter with repeated violations
 */
export const createProgressiveRateLimiter = (baseConfig = {}) => {
  const violationStore = new Map(); // In production, use Redis

  return rateLimit({
    ...createRateLimiterConfig(baseConfig),
    keyGenerator: (req) => {
      const baseKey = defaultKeyGenerator(req);
      const violations = violationStore.get(baseKey) || 0;
      return `${baseKey}:${Math.min(violations, 5)}`; // Max 5 levels
    },
    handler: (req, res, next, options) => {
      const key = defaultKeyGenerator(req);
      const currentViolations = violationStore.get(key) || 0;

      // Increase violation count
      violationStore.set(key, currentViolations + 1);

      // Set expiration for violation count
      setTimeout(() => {
        const updatedViolations = violationStore.get(key) || 0;
        if (updatedViolations <= 1) {
          violationStore.delete(key);
        } else {
          violationStore.set(key, updatedViolations - 1);
        }
      }, options.windowMs * 2); // Reset after double the window

      // Calculate progressive penalty
      const penaltyMultiplier = Math.pow(2, Math.min(currentViolations, 5));
      const retryAfter = Math.ceil((options.windowMs / 1000) * penaltyMultiplier);

      res.status(429).json({
        success: false,
        message: `Rate limit exceeded. This is violation ${currentViolations + 1}. Penalty applied.`,
        code: 'PROGRESSIVE_RATE_LIMIT_EXCEEDED',
        details: {
          violations: currentViolations + 1,
          penaltyMultiplier,
          baseLimit: options.max,
          effectiveLimit: Math.floor(options.max / penaltyMultiplier),
          retryAfter
        },
        timestamp: new Date().toISOString(),
        requestId: req.id || 'unknown'
      });

      res.setHeader('Retry-After', retryAfter);
    }
  });
};

/**
 * Role-based rate limiting
 */
export const createRoleBasedRateLimiter = () => {
  return (req, res, next) => {
    const userRole = req.user?.role || 'anonymous';

    let limiter;
    switch (userRole) {
      case 'admin':
        limiter = generalApiRateLimiter;
        break;
      case 'premium':
        limiter = rateLimit(createRateLimiterConfig({
          windowMs: 15 * 60 * 1000,
          max: 2000, // Higher limit for premium users
          message: 'Premium rate limit exceeded'
        }));
        break;
      case 'user':
        limiter = generalApiRateLimiter;
        break;
      default:
        limiter = publicApiRateLimiter;
    }

    return limiter(req, res, next);
  };
};

/**
 * Sliding window rate limiter
 */
export const createSlidingWindowRateLimiter = (options = {}) => {
  const { windowMs = 60 * 1000, max = 100 } = options;

  if (!redisClient) {
    console.warn('Sliding window rate limiter requires Redis, falling back to fixed window');
    return rateLimit(createRateLimiterConfig(options));
  }

  return async (req, res, next) => {
    const key = `sliding:${defaultKeyGenerator(req)}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      // Use Redis sorted set for sliding window
      const pipeline = redisClient.pipeline();

      // Remove old entries
      pipeline.zremrangebyscore(key, 0, windowStart);

      // Count current entries
      pipeline.zcard(key);

      // Add current request
      pipeline.zadd(key, now, `${now}-${Math.random()}`);

      // Set expiration
      pipeline.expire(key, Math.ceil(windowMs / 1000));

      const results = await pipeline.exec();
      const currentCount = results[1][1];

      if (currentCount >= max) {
        const oldestRequest = await redisClient.zrange(key, 0, 0, 'WITHSCORES');
        const resetTime = oldestRequest.length > 0 ? parseInt(oldestRequest[1]) + windowMs : now + windowMs;
        const retryAfter = Math.ceil((resetTime - now) / 1000);

        return res.status(429).json({
          success: false,
          message: 'Sliding window rate limit exceeded',
          code: 'SLIDING_WINDOW_RATE_LIMIT_EXCEEDED',
          details: {
            currentCount,
            max,
            windowMs,
            resetTime: new Date(resetTime).toISOString(),
            retryAfter
          },
          timestamp: new Date().toISOString(),
          requestId: req.id || 'unknown'
        });
      }

      // Add rate limit headers
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - currentCount - 1));
      res.setHeader('X-RateLimit-Reset', new Date(now + windowMs).toISOString());

      next();
    } catch (error) {
      console.error('Sliding window rate limiter error:', error);
      next(); // Fail open
    }
  };
};

/**
 * Adaptive rate limiting based on system load
 */
export const createAdaptiveRateLimiter = (baseConfig = {}) => {
  const systemMetrics = {
    cpuUsage: 0,
    memoryUsage: 0,
    activeConnections: 0
  };

  return (req, res, next) => {
    // In a real implementation, you'd get actual system metrics
    const loadFactor = Math.max(
      systemMetrics.cpuUsage / 100,
      systemMetrics.memoryUsage / 100,
      systemMetrics.activeConnections / 1000
    );

    // Adjust rate limits based on load
    const adjustedMax = Math.max(10, Math.floor(baseConfig.max * (1 - loadFactor * 0.5)));
    const adjustedWindowMs = Math.floor(baseConfig.windowMs * (1 + loadFactor * 0.5));

    const adaptiveLimiter = rateLimit(createRateLimiterConfig({
      ...baseConfig,
      max: adjustedMax,
      windowMs: adjustedWindowMs,
      message: `Rate limit adjusted due to high system load. Current limit: ${adjustedMax} requests per ${Math.ceil(adjustedWindowMs / 1000 / 60)} minutes.`
    }));

    return adaptiveLimiter(req, res, next);
  };
};

/**
 * Rate limiting middleware factory with configuration
 */
export const createRateLimitMiddleware = (type, options = {}) => {
  const limiters = {
    auth: authRateLimiter,
    registration: registrationRateLimiter,
    password: passwordChangeRateLimiter,
    token: tokenRefreshRateLimiter,
    general: generalApiRateLimiter,
    workflowCreate: workflowCreationRateLimiter,
    workflowExecute: workflowExecutionRateLimiter,
    fileUpload: fileUploadRateLimiter,
    public: publicApiRateLimiter,
    progressive: createProgressiveRateLimiter(options),
    roleBased: createRoleBasedRateLimiter(),
    slidingWindow: createSlidingWindowRateLimiter(options),
    adaptive: createAdaptiveRateLimiter(options)
  };

  return limiters[type] || generalApiRateLimiter;
};

/**
 * Rate limiting middleware for specific routes
 */
export const applyRateLimiting = (type = 'general', options = {}) => {
  return createRateLimitMiddleware(type, options);
};

/**
 * Multi-tier rate limiting (apply multiple limiters)
 */
export const createMultiTierRateLimiter = (limiters) => {
  return (req, res, next) => {
    let index = 0;

    const runNextLimiter = () => {
      if (index >= limiters.length) {
        return next();
      }

      const limiter = limiters[index++];
      limiter(req, res, runNextLimiter);
    };

    runNextLimiter();
  };
};

/**
 * Rate limiting metrics and monitoring
 */
export class RateLimitMetrics {
  constructor() {
    this.metrics = {
      totalRequests: 0,
      blockedRequests: 0,
      violationsByType: new Map(),
      topViolators: new Map(),
      hourlyStats: new Map()
    };
  }

  recordRequest(req, blocked = false, limitType = 'general') {
    this.metrics.totalRequests++;

    if (blocked) {
      this.metrics.blockedRequests++;
      const key = `${req.user?.id || req.ip}:${limitType}`;
      this.metrics.violationsByType.set(limitType, (this.metrics.violationsByType.get(limitType) || 0) + 1);
      this.metrics.topViolators.set(key, (this.metrics.topViolators.get(key) || 0) + 1);
    }

    // Track hourly stats
    const hour = new Date().getHours();
    this.metrics.hourlyStats.set(hour, (this.metrics.hourlyStats.get(hour) || 0) + 1);
  }

  getMetrics() {
    return {
      ...this.metrics,
      violationRate: this.metrics.blockedRequests / this.metrics.totalRequests,
      topViolators: Array.from(this.metrics.topViolators.entries())
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .map(([violator, count]) => ({ violator, count })),
      violationsByType: Object.fromEntries(this.metrics.violationsByType),
      hourlyDistribution: Object.fromEntries(this.metrics.hourlyStats)
    };
  }

  reset() {
    this.metrics = {
      totalRequests: 0,
      blockedRequests: 0,
      violationsByType: new Map(),
      topViolators: new Map(),
      hourlyStats: new Map()
    };
  }
}

// Global metrics instance
export const rateLimitMetrics = new RateLimitMetrics();

/**
 * Metrics collection middleware
 */
export const collectRateLimitMetrics = (req, res, next) => {
  const originalStatus = res.status;

  res.status = function(code) {
    if (code === 429) {
      rateLimitMetrics.recordRequest(req, true, 'general');
    } else {
      rateLimitMetrics.recordRequest(req, false);
    }

    return originalStatus.call(this, code);
  };

  next();
};

/**
 * Rate limiting health check
 */
export const checkRateLimitHealth = async () => {
  const health = {
    status: 'healthy',
    redis: {
      connected: false,
      latency: null,
      error: null
    },
    metrics: {
      totalRequests: rateLimitMetrics.metrics.totalRequests,
      blockedRequests: rateLimitMetrics.metrics.blockedRequests,
      violationRate: rateLimitMetrics.metrics.blockedRequests / Math.max(rateLimitMetrics.metrics.totalRequests, 1)
    }
  };

  if (redisClient) {
    try {
      const start = Date.now();
      await redisClient.ping();
      const latency = Date.now() - start;

      health.redis = {
        connected: true,
        latency,
        error: null
      };
    } catch (error) {
      health.redis = {
        connected: false,
        latency: null,
        error: error.message
      };
      health.status = 'degraded';
    }
  }

  return health;
};

export default {
  // Core rate limiters
  authRateLimiter,
  registrationRateLimiter,
  passwordChangeRateLimiter,
  tokenRefreshRateLimiter,
  generalApiRateLimiter,
  workflowCreationRateLimiter,
  workflowExecutionRateLimiter,
  fileUploadRateLimiter,
  publicApiRateLimiter,

  // Advanced strategies
  createProgressiveRateLimiter,
  createRoleBasedRateLimiter,
  createSlidingWindowRateLimiter,
  createAdaptiveRateLimiter,

  // Middleware factory
  createRateLimitMiddleware,
  applyRateLimiting,
  createMultiTierRateLimiter,

  // Utilities
  initializeRedis,
  collectRateLimitMetrics,
  checkRateLimitHealth,
  rateLimitMetrics
};