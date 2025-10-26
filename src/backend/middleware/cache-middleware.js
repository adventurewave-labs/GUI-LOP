/**
 * Cache Middleware
 * Express.js middleware for API response caching with intelligent invalidation
 * Week 5-6 Phase 2 - Redis Caching Layer
 */

import cacheService from '../services/redis-cache-service.js';
import crypto from 'crypto';

class CacheMiddleware {
  constructor(options = {}) {
    this.defaultTTL = options.defaultTTL || 600; // 10 minutes
    this.enabledRoutes = options.enabledRoutes || [];
    this.disabledRoutes = options.disabledRoutes || [];
    this.varyHeaders = options.varyHeaders || ['authorization', 'accept-language'];
    this.keyGenerator = options.keyGenerator || this.defaultKeyGenerator;

    // Route-specific cache configurations
    this.routeConfigs = new Map();

    // Performance tracking
    this.performance = {
      requests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cacheSets: 0,
      avgResponseTime: 0,
      totalResponseTime: 0
    };
  }

  /**
   * Configure cache for specific routes
   */
  configureRoute(pattern, config) {
    this.routeConfigs.set(pattern, {
      ttl: config.ttl || this.defaultTTL,
      vary: config.vary || this.varyHeaders,
      excludeHeaders: config.excludeHeaders || [],
      includeQuery: config.includeQuery !== false,
      includeBody: config.includeBody || false,
      condition: config.condition || null,
      invalidateOn: config.invalidateOn || []
    });
  }

  /**
   * Main caching middleware
   */
  cache(options = {}) {
    return async (req, res, next) => {
      const startTime = Date.now();
      this.performance.requests++;

      try {
        // Check if caching is enabled for this route
        if (!this.shouldCacheRoute(req)) {
          return next();
        }

        // Check if request is cacheable
        if (!this.isRequestCacheable(req)) {
          return next();
        }

        // Generate cache key
        const cacheKey = this.keyGenerator(req, options);

        // Try to get cached response
        const cachedResponse = await cacheService.get('apiResponses', cacheKey);

        if (cachedResponse) {
          // Cache hit - return cached response
          this.performance.cacheHits++;
          this.updateResponseTime(startTime);

          return this.sendCachedResponse(res, cachedResponse);
        }

        // Cache miss - intercept response
        this.performance.cacheMisses++;
        this.interceptResponse(req, res, cacheKey, startTime, options);

        next();

      } catch (error) {
        console.error('❌ Cache middleware error:', error.message);
        next(); // Continue without caching on error
      }
    };
  }

  /**
   * Middleware for cache invalidation
   */
  invalidate(patterns = []) {
    return async (req, res, next) => {
      try {
        const invalidationPromises = patterns.map(pattern => {
          if (typeof pattern === 'string') {
            return cacheService.deletePattern('apiResponses', pattern);
          } else if (typeof pattern === 'function') {
            const keys = pattern(req);
            return Promise.all(keys.map(key => cacheService.delete('apiResponses', key)));
          }
        });

        await Promise.all(invalidationPromises);

        // Log invalidation
        console.log(`🗑️ Cache invalidation triggered for ${req.method} ${req.path}`);

        next();
      } catch (error) {
        console.error('❌ Cache invalidation error:', error.message);
        next();
      }
    };
  }

  /**
   * Check if route should be cached
   */
  shouldCacheRoute(req) {
    const route = `${req.method}:${req.path}`;

    // Check disabled routes first
    for (const disabled of this.disabledRoutes) {
      if (this.matchRoute(route, disabled)) {
        return false;
      }
    }

    // Check enabled routes if specified
    if (this.enabledRoutes.length > 0) {
      for (const enabled of this.enabledRoutes) {
        if (this.matchRoute(route, enabled)) {
          return true;
        }
      }
      return false;
    }

    // Check route-specific configurations
    for (const [pattern, config] of this.routeConfigs) {
      if (this.matchRoute(route, pattern)) {
        if (config.condition && !config.condition(req)) {
          return false;
        }
        return true;
      }
    }

    // Default behavior - cache GET requests
    return req.method === 'GET';
  }

  /**
   * Check if request is cacheable
   */
  isRequestCacheable(req) {
    // Only cache GET and HEAD requests
    if (!['GET', 'HEAD'].includes(req.method)) {
      return false;
    }

    // Don't cache if authorization header is present (unless configured)
    if (req.headers.authorization && !this.shouldCacheAuthorizedRequests(req)) {
      return false;
    }

    // Don't cache if no-cache header is present
    if (req.headers['cache-control']?.includes('no-cache')) {
      return false;
    }

    // Don't cache if there are query parameters that indicate dynamic content
    const noCacheParams = ['_', 'nocache', 'refresh', 't'];
    const hasNoCacheParam = Object.keys(req.query).some(param =>
      noCacheParams.includes(param.toLowerCase())
    );

    if (hasNoCacheParam) {
      return false;
    }

    return true;
  }

  /**
   * Check if authorized requests should be cached
   */
  shouldCacheAuthorizedRequests(req) {
    const route = `${req.method}:${req.path}`;

    for (const [pattern, config] of this.routeConfigs) {
      if (this.matchRoute(route, pattern)) {
        return config.cacheAuthorized !== false;
      }
    }

    return false; // Default: don't cache authorized requests
  }

  /**
   * Default cache key generator
   */
  defaultKeyGenerator(req, options) {
    const parts = [
      req.method,
      req.path,
      this.generateQueryHash(req.query),
      this.generateHeaderHash(req.headers),
      this.generateBodyHash(req.body, options.includeBody)
    ];

    const key = parts.join(':');
    const hash = crypto.createHash('md5').update(key).digest('hex');

    return `api:${hash}`;
  }

  /**
   * Generate query hash
   */
  generateQueryHash(query) {
    const sortedQuery = Object.keys(query)
      .sort()
      .reduce((result, key) => {
        result[key] = query[key];
        return result;
      }, {});

    return JSON.stringify(sortedQuery);
  }

  /**
   * Generate header hash
   */
  generateHeaderHash(headers) {
    const routeConfig = this.getRouteConfig(`${headers['x-method'] || 'GET'}:${headers['x-path'] || ''}`);
    const varyHeaders = routeConfig?.vary || this.varyHeaders;

    const filteredHeaders = {};
    for (const header of varyHeaders) {
      if (headers[header]) {
        filteredHeaders[header] = headers[header];
      }
    }

    return JSON.stringify(filteredHeaders);
  }

  /**
   * Generate body hash for POST/PUT requests
   */
  generateBodyHash(body, include = false) {
    if (!include || !body) {
      return '';
    }

    return JSON.stringify(body);
  }

  /**
   * Get route configuration
   */
  getRouteConfig(route) {
    for (const [pattern, config] of this.routeConfigs) {
      if (this.matchRoute(route, pattern)) {
        return config;
      }
    }
    return null;
  }

  /**
   * Match route against pattern
   */
  matchRoute(route, pattern) {
    if (pattern instanceof RegExp) {
      return pattern.test(route);
    }

    if (pattern.includes('*')) {
      const regexPattern = pattern
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      return new RegExp(`^${regexPattern}$`).test(route);
    }

    return route === pattern;
  }

  /**
   * Intercept response to cache it
   */
  interceptResponse(req, res, cacheKey, startTime, options) {
    const originalWrite = res.write;
    const originalEnd = res.end;
    const originalJson = res.json;
    const chunks = [];

    res.write = function(chunk) {
      chunks.push(Buffer.from(chunk));
      return originalWrite.call(this, chunk);
    };

    res.end = function(chunk) {
      if (chunk) {
        chunks.push(Buffer.from(chunk));
      }

      const body = Buffer.concat(chunks).toString('utf8');
      this.cacheResponse(cacheKey, req, res, body, startTime, options);

      return originalEnd.call(this, chunk);
    };

    res.json = function(obj) {
      const body = JSON.stringify(obj);
      this.cacheResponse(cacheKey, req, res, body, startTime, options);
      return originalJson.call(this, obj);
    }.bind(this);
  }

  /**
   * Cache response
   */
  async cacheResponse(cacheKey, req, res, body, startTime, options) {
    try {
      // Only cache successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const response = {
          status: res.statusCode,
          headers: this.filterHeaders(res.getHeaders()),
          body: body,
          timestamp: Date.now(),
          requestInfo: {
            method: req.method,
            path: req.path,
            query: req.query
          }
        };

        const routeConfig = this.getRouteConfig(`${req.method}:${req.path}`);
        const ttl = routeConfig?.ttl || options.ttl || this.defaultTTL;

        await cacheService.set('apiResponses', cacheKey, response, ttl);

        this.performance.cacheSets++;
        this.updateResponseTime(startTime);

        console.log(`💾 Cached response for ${req.method} ${req.path} (${cacheKey})`);
      }
    } catch (error) {
      console.error('❌ Error caching response:', error.message);
    }
  }

  /**
   * Send cached response
   */
  sendCachedResponse(res, cachedResponse) {
    // Set cached headers
    Object.entries(cachedResponse.headers).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    // Add cache headers
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('X-Cache-Age', Math.floor((Date.now() - cachedResponse.timestamp) / 1000));
    res.setHeader('X-Cache-Expires', Math.floor((Date.now() - cachedResponse.timestamp) / 1000));

    res.status(cachedResponse.status);

    if (cachedResponse.body) {
      res.send(cachedResponse.body);
    } else {
      res.end();
    }
  }

  /**
   * Filter headers for caching
   */
  filterHeaders(headers) {
    const filtered = { ...headers };

    // Remove headers that shouldn't be cached
    const excludeHeaders = [
      'set-cookie',
      'date',
      'server',
      'connection',
      'transfer-encoding',
      'x-powered-by'
    ];

    for (const header of excludeHeaders) {
      delete filtered[header];
    }

    return filtered;
  }

  /**
   * Update response time metrics
   */
  updateResponseTime(startTime) {
    const responseTime = Date.now() - startTime;
    this.performance.totalResponseTime += responseTime;
    this.performance.avgResponseTime = this.performance.totalResponseTime / this.performance.requests;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const hitRate = this.performance.requests > 0 ?
      (this.performance.cacheHits / this.performance.requests) * 100 : 0;

    return {
      ...this.performance,
      hitRate: hitRate.toFixed(2) + '%',
      cacheEfficiency: hitRate > 50 ? 'good' : hitRate > 20 ? 'fair' : 'poor'
    };
  }

  /**
   * Clear cache for specific patterns
   */
  async clearCache(patterns = []) {
    try {
      const results = [];

      for (const pattern of patterns) {
        const deleted = await cacheService.deletePattern('apiResponses', pattern);
        results.push({ pattern, deleted });
      }

      return results;
    } catch (error) {
      console.error('❌ Error clearing cache:', error.message);
      throw error;
    }
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      const testKey = 'health-check';
      const testData = { status: 'ok', timestamp: Date.now() };

      // Test cache set/get
      await cacheService.set('apiResponses', testKey, testData, 60);
      const retrieved = await cacheService.get('apiResponses', testKey);

      // Cleanup
      await cacheService.delete('apiResponses', testKey);

      return {
        status: retrieved ? 'healthy' : 'unhealthy',
        testPassed: retrieved !== null,
        stats: this.getStats()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        stats: this.getStats()
      };
    }
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.performance = {
      requests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cacheSets: 0,
      avgResponseTime: 0,
      totalResponseTime: 0
    };
  }
}

// Create singleton instance with default configurations
const cacheMiddleware = new CacheMiddleware({
  defaultTTL: 600, // 10 minutes
  enabledRoutes: [
    'GET:/api/workflows/templates',
    'GET:/api/workflows',
    'GET:/api/public/*',
    'GET:/health'
  ],
  disabledRoutes: [
    'POST:/api/auth/*',
    'PUT:/api/auth/*',
    'DELETE:/api/auth/*',
    'POST:/api/workflows/*/execute',
    'POST:/api/workflows/*/respond'
  ]
});

// Configure specific routes
cacheMiddleware.configureRoute('GET:/api/workflows/templates', {
  ttl: 7200, // 2 hours
  vary: ['accept-language'],
  cacheAuthorized: true
});

cacheMiddleware.configureRoute('GET:/api/workflows', {
  ttl: 300, // 5 minutes
  vary: ['authorization'],
  cacheAuthorized: true,
  includeQuery: true
});

cacheMiddleware.configureRoute('GET:/api/public/*', {
  ttl: 3600, // 1 hour
  vary: ['accept-language']
});

cacheMiddleware.configureRoute('GET:/health', {
  ttl: 60, // 1 minute
  vary: []
});

export default cacheMiddleware;
export { CacheMiddleware };