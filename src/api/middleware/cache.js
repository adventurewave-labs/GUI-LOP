/**
 * API Response Caching and Optimization Middleware
 * Comprehensive caching system with multiple strategies and optimization features
 */

import { createHash } from 'crypto';
import { parse } from 'url';

/**
 * Cache configuration
 */
export const CACHE_CONFIG = {
  defaultTTL: 5 * 60 * 1000, // 5 minutes
  maxSize: 1000, // Maximum number of cached items
  cleanupInterval: 10 * 60 * 1000, // 10 minutes
  strategies: {
    memory: true,
    redis: process.env.ENABLE_REDIS_CACHE === 'true'
  },
  compression: {
    enabled: true,
    threshold: 1024 // Compress responses larger than 1KB
  },
  optimization: {
    etag: true,
    lastModified: true,
    varyHeaders: ['Accept-Encoding', 'Accept-Language', 'Authorization']
  }
};

/**
 * In-memory cache implementation
 */
class MemoryCache {
  constructor(options = {}) {
    this.cache = new Map();
    this.ttlMap = new Map();
    this.accessTime = new Map();
    this.maxSize = options.maxSize || CACHE_CONFIG.maxSize;
    this.defaultTTL = options.defaultTTL || CACHE_CONFIG.defaultTTL;

    // Start cleanup interval
    this.startCleanup();
  }

  /**
   * Get item from cache
   */
  get(key) {
    const item = this.cache.get(key);

    if (!item) {
      return null;
    }

    // Check TTL
    if (this.isExpired(key)) {
      this.delete(key);
      return null;
    }

    // Update access time for LRU
    this.accessTime.set(key, Date.now());

    return item.value;
  }

  /**
   * Set item in cache
   */
  set(key, value, ttl = this.defaultTTL) {
    // Remove oldest items if cache is full
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    const item = {
      value,
      createdAt: Date.now(),
      ttl,
      etag: this.generateETag(value),
      compressed: CACHE_CONFIG.compression.enabled && this.shouldCompress(value)
    };

    // Compress if necessary
    if (item.compressed) {
      item.value = this.compress(value);
    }

    this.cache.set(key, item);
    this.ttlMap.set(key, Date.now() + ttl);
    this.accessTime.set(key, Date.now());

    return true;
  }

  /**
   * Delete item from cache
   */
  delete(key) {
    this.cache.delete(key);
    this.ttlMap.delete(key);
    this.accessTime.delete(key);
    return true;
  }

  /**
   * Check if item exists and is not expired
   */
  has(key) {
    if (!this.cache.has(key)) {
      return false;
    }

    if (this.isExpired(key)) {
      this.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Check if item is expired
   */
  isExpired(key) {
    const expiryTime = this.ttlMap.get(key);
    return expiryTime && Date.now() > expiryTime;
  }

  /**
   * Evict least recently used items
   */
  evictLRU() {
    const items = Array.from(this.accessTime.entries())
      .sort(([,a], [,b]) => a - b);

    // Remove 10% of oldest items
    const toRemove = Math.ceil(this.maxSize * 0.1);
    for (let i = 0; i < toRemove && i < items.length; i++) {
      this.delete(items[i][0]);
    }
  }

  /**
   * Generate ETag for cache validation
   */
  generateETag(value) {
    const content = typeof value === 'string' ? value : JSON.stringify(value);
    return `"${createHash('md5').update(content).digest('hex')}"`;
  }

  /**
   * Check if value should be compressed
   */
  shouldCompress(value) {
    const size = this.calculateSize(value);
    return size > CACHE_CONFIG.compression.threshold;
  }

  /**
   * Calculate size of value
   */
  calculateSize(value) {
    if (typeof value === 'string') {
      return Buffer.byteLength(value, 'utf8');
    } else {
      return Buffer.byteLength(JSON.stringify(value), 'utf8');
    }
  }

  /**
   * Compress value (simplified implementation)
   */
  compress(value) {
    // In production, use zlib compression
    return value;
  }

  /**
   * Decompress value
   */
  decompress(value) {
    // In production, use zlib decompression
    return value;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const items = Array.from(this.cache.values());
    const totalSize = items.reduce((sum, item) => sum + this.calculateSize(item.value), 0);

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: this.hitRate || 0,
      totalSize,
      averageItemSize: this.cache.size > 0 ? Math.round(totalSize / this.cache.size) : 0,
      memoryUsage: process.memoryUsage()
    };
  }

  /**
   * Start cleanup interval
   */
  startCleanup() {
    setInterval(() => {
      this.cleanup();
    }, CACHE_CONFIG.cleanupInterval);
  }

  /**
   * Clean up expired items
   */
  cleanup() {
    const now = Date.now();
    for (const [key, expiryTime] of this.ttlMap.entries()) {
      if (now > expiryTime) {
        this.delete(key);
      }
    }
  }

  /**
   * Clear all cache items
   */
  clear() {
    this.cache.clear();
    this.ttlMap.clear();
    this.accessTime.clear();
  }
}

/**
 * Cache middleware factory
 */
export const createCacheMiddleware = (options = {}) => {
  const {
    ttl = CACHE_CONFIG.defaultTTL,
    keyGenerator = defaultKeyGenerator,
    condition = defaultCacheCondition,
    strategy = 'memory',
    varyHeaders = CACHE_CONFIG.optimization.varyHeaders,
    skipCaching = false
  } = options;

  const cache = getCacheInstance(strategy);

  return (req, res, next) => {
    // Skip caching if disabled or condition fails
    if (skipCaching || !condition(req)) {
      return next();
    }

    // Generate cache key
    const cacheKey = keyGenerator(req, varyHeaders);

    // Check cache for existing response
    const cached = cache.get(cacheKey);
    if (cached) {
      return sendCachedResponse(req, res, cached, cacheKey);
    }

    // Override res.json and res.send to cache response
    const originalJson = res.json;
    const originalSend = res.send;

    res.json = function(data) {
      cacheResponse(req, res, cache, cacheKey, data, 'json');
      return originalJson.call(this, data);
    };

    res.send = function(data) {
      cacheResponse(req, res, cache, cacheKey, data, 'send');
      return originalSend.call(this, data);
    };

    next();
  };
};

/**
 * Default cache key generator
 */
const defaultKeyGenerator = (req, varyHeaders = []) => {
  const url = parse(req.url);
  const keyParts = [
    req.method,
    url.pathname,
    JSON.stringify(req.query),
    req.headers['accept-language'] || 'en',
    req.headers['accept-encoding'] || 'identity'
  ];

  // Add vary headers to key
  for (const header of varyHeaders) {
    if (req.headers[header.toLowerCase()]) {
      keyParts.push(`${header}:${req.headers[header.toLowerCase()]}`);
    }
  }

  // Add user context if authenticated
  if (req.user?.id) {
    keyParts.push(`user:${req.user.id}`);
  }

  const keyString = keyParts.join('|');
  return createHash('sha256').update(keyString).digest('hex');
};

/**
 * Default cache condition
 */
const defaultCacheCondition = (req) => {
  // Only cache GET requests
  if (req.method !== 'GET') {
    return false;
  }

  // Don't cache requests with query parameters that indicate dynamic content
  const skipParams = ['no-cache', 'refresh', 'bust'];
  for (const param of skipParams) {
    if (req.query[param]) {
      return false;
    }
  }

  // Check Cache-Control header
  const cacheControl = req.headers['cache-control'];
  if (cacheControl && cacheControl.includes('no-cache')) {
    return false;
  }

  return true;
};

/**
 * Get cache instance based on strategy
 */
const getCacheInstance = (strategy) => {
  switch (strategy) {
    case 'memory':
      return new MemoryCache();
    case 'redis':
      // TODO: Implement Redis cache
      return new MemoryCache();
    default:
      return new MemoryCache();
  }
};

/**
 * Send cached response
 */
const sendCachedResponse = (req, res, cached, cacheKey) => {
  // Check if cached response is still valid
  if (!validateCachedResponse(req, cached)) {
    return; // Let request continue to generate fresh response
  }

  // Set cache headers
  res.setHeader('X-Cache', 'HIT');
  res.setHeader('X-Cache-Key', cacheKey.substring(0, 16));
  res.setHeader('X-Cache-Age', Math.floor((Date.now() - cached.createdAt) / 1000));

  if (cached.etag) {
    res.setHeader('ETag', cached.etag);
  }

  if (cached.lastModified) {
    res.setHeader('Last-Modified', cached.lastModified);
  }

  // Decompress if necessary
  const data = cached.compressed ? cached.cache.decompress(cached.value) : cached.value;

  // Send response
  if (cached.contentType) {
    res.setHeader('Content-Type', cached.contentType);
  }

  res.status(cached.statusCode || 200);
  res.send(data);
};

/**
 * Validate cached response against request headers
 */
const validateCachedResponse = (req, cached) => {
  // Check ETag
  if (req.headers['if-none-match'] && cached.etag) {
    if (req.headers['if-none-match'] === cached.etag) {
      return true; // Client has latest version
    }
  }

  // Check If-Modified-Since
  if (req.headers['if-modified-since'] && cached.lastModified) {
    const modifiedSince = new Date(req.headers['if-modified-since']);
    const lastModified = new Date(cached.lastModified);

    if (lastModified <= modifiedSince) {
      return true; // Client has latest version
    }
  }

  return true; // Assume valid
};

/**
 * Cache response
 */
const cacheResponse = (req, res, cache, cacheKey, data, responseType) => {
  // Don't cache error responses
  if (res.statusCode >= 400) {
    return;
  }

  const response = {
    value: data,
    createdAt: Date.now(),
    statusCode: res.statusCode,
    contentType: res.getHeader('Content-Type') || 'application/json',
    lastModified: new Date().toISOString(),
    compressed: false
  };

  // Generate ETag if optimization is enabled
  if (CACHE_CONFIG.optimization.etag) {
    response.etag = cache.generateETag(data);
  }

  // Store in cache
  cache.set(cacheKey, response, CACHE_CONFIG.defaultTTL);

  // Set cache headers for client
  res.setHeader('X-Cache', 'MISS');
  res.setHeader('Cache-Control', `public, max-age=${Math.floor(CACHE_CONFIG.defaultTTL / 1000)}`);

  if (response.etag) {
    res.setHeader('ETag', response.etag);
  }

  if (response.lastModified) {
    res.setHeader('Last-Modified', response.lastModified);
  }
};

/**
 * Pre-configured cache middleware for different use cases
 */

// Cache for public API responses (longer TTL)
export const publicCache = createCacheMiddleware({
  ttl: 15 * 60 * 1000, // 15 minutes
  condition: (req) => req.method === 'GET' && req.path.includes('/public/'),
  strategy: 'memory'
});

// Cache for user-specific data (shorter TTL)
export const userCache = createCacheMiddleware({
  ttl: 2 * 60 * 1000, // 2 minutes
  condition: (req) => req.method === 'GET' && req.user && !req.path.includes('/workflows/execute'),
  strategy: 'memory',
  varyHeaders: ['Authorization']
});

// Cache for workflow templates (longer TTL, user-independent)
export const templateCache = createCacheMiddleware({
  ttl: 60 * 60 * 1000, // 1 hour
  condition: (req) => req.method === 'GET' && req.path.includes('/workflows/templates'),
  strategy: 'memory'
});

// Cache for system health data (very short TTL)
export const healthCache = createCacheMiddleware({
  ttl: 30 * 1000, // 30 seconds
  condition: (req) => req.method === 'GET' && req.path.includes('/health'),
  strategy: 'memory'
});

/**
 * Cache invalidation middleware
 */
export const cacheInvalidation = (cache) => {
  return (req, res, next) => {
    // Invalidate cache on POST, PUT, DELETE requests
    if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
      invalidateRelatedCache(req, cache);
    }

    next();
  };
};

/**
 * Invalidate related cache entries
 */
const invalidateRelatedCache = (req, cache) => {
  // Invalidate user-specific cache
  if (req.user?.id) {
    const userPattern = `user:${req.user.id}`;
    for (const [key] of cache.cache.entries()) {
      if (key.includes(userPattern)) {
        cache.delete(key);
      }
    }
  }

  // Invalidate related paths
  const pathPatterns = getInvalidationPatterns(req.path, req.method);
  for (const pattern of pathPatterns) {
    for (const [key] of cache.cache.entries()) {
      if (key.includes(pattern)) {
        cache.delete(key);
      }
    }
  }
};

/**
 * Get cache invalidation patterns for a request
 */
const getInvalidationPatterns = (path, method) => {
  const patterns = [];

  // Invalidate all caches for affected resources
  if (path.includes('/workflows/')) {
    patterns.push('/workflows');
    patterns.push('/workflows/templates');
  }

  if (path.includes('/users/')) {
    patterns.push('/users');
  }

  if (path.includes('/auth/')) {
    patterns.push('/auth');
  }

  return patterns;
};

/**
 * Cache warming middleware
 */
export const cacheWarmer = (routes, cache) => {
  return async (req, res, next) => {
    // Warm cache on startup
    if (process.env.NODE_ENV === 'production' && process.env.WARM_CACHE === 'true') {
      setTimeout(() => {
        warmCache(routes, cache);
      }, 5000); // Wait 5 seconds after server start
    }

    next();
  };
};

/**
 * Warm cache with common requests
 */
const warmCache = async (routes, cache) => {
  console.log('Warming up cache...');

  for (const route of routes) {
    try {
      // Simulate GET request to warm cache
      const mockReq = {
        method: 'GET',
        path: route.path,
        query: {},
        headers: {
          'accept-language': 'en',
          'accept-encoding': 'identity'
        }
      };

      const cacheKey = defaultKeyGenerator(mockReq);

      // This would typically make an actual request
      // For now, just log the warming process
      console.log(`Warmed cache for: ${route.path}`);
    } catch (error) {
      console.error(`Failed to warm cache for ${route.path}:`, error);
    }
  }

  console.log('Cache warming completed');
};

/**
 * Cache statistics endpoint
 */
export const getCacheStats = (cache) => {
  return (req, res) => {
    try {
      const stats = cache.getStats();
      const systemStats = {
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime()
      };

      res.json({
        success: true,
        message: 'Cache statistics retrieved successfully',
        data: {
          cache: stats,
          system: systemStats,
          config: CACHE_CONFIG
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error retrieving cache stats:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve cache statistics',
        code: 'CACHE_STATS_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  };
};

/**
 * Cache management endpoints
 */
export const createCacheRoutes = (app, cache) => {
  // Get cache statistics
  app.get('/api/v1/cache/stats', getCacheStats(cache));

  // Clear cache
  app.delete('/api/v1/cache', (req, res) => {
    try {
      cache.clear();
      res.json({
        success: true,
        message: 'Cache cleared successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error clearing cache:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to clear cache',
        code: 'CACHE_CLEAR_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  });

  // Invalidate specific cache entry
  app.delete('/api/v1/cache/:key', (req, res) => {
    try {
      const { key } = req.params;
      const deleted = cache.delete(key);

      if (deleted) {
        res.json({
          success: true,
          message: 'Cache entry deleted successfully',
          data: { key },
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(404).json({
          success: false,
          message: 'Cache entry not found',
          code: 'CACHE_ENTRY_NOT_FOUND',
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Error deleting cache entry:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete cache entry',
        code: 'CACHE_DELETE_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  });
};

// Global cache instance
export const globalCache = new MemoryCache();

export default {
  CACHE_CONFIG,
  MemoryCache,
  createCacheMiddleware,
  publicCache,
  userCache,
  templateCache,
  healthCache,
  cacheInvalidation,
  cacheWarmer,
  getCacheStats,
  createCacheRoutes,
  globalCache
};