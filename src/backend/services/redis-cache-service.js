/**
 * Redis Cache Service
 * Production-ready caching service with connection pooling, error handling, and cache strategies
 * Week 5-6 Phase 2 - Redis Caching Layer
 */

import redisConfig from '../config/redis-config.js';
import crypto from 'crypto';

class RedisCacheService {
  constructor(options = {}) {
    this.defaultTTL = options.defaultTTL || 3600; // 1 hour
    this.maxRetries = options.maxRetries || 3;
    this.keyPrefix = options.keyPrefix || 'gui-lop:';
    this.fallbackEnabled = options.fallbackEnabled !== false;

    // Cache strategies
    this.strategies = {
      workflowTemplates: { ttl: 7200, prefix: 'templates:' }, // 2 hours
      userSessions: { ttl: 1800, prefix: 'sessions:' }, // 30 minutes
      apiResponses: { ttl: 600, prefix: 'api:' }, // 10 minutes
      userData: { ttl: 900, prefix: 'user:' }, // 15 minutes
      workflowData: { ttl: 3600, prefix: 'workflow:' }, // 1 hour
      databaseQueries: { ttl: 300, prefix: 'db:' }, // 5 minutes
      rateLimits: { ttl: 60, prefix: 'rate:' }, // 1 minute
      configData: { ttl: 86400, prefix: 'config:' } // 24 hours
    };

    // Performance tracking
    this.performance = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
      totalOperations: 0
    };

    this.initialized = false;
  }

  /**
   * Initialize cache service
   */
  async initialize() {
    try {
      await redisConfig.initialize();
      this.client = redisConfig.getClient();
      this.initialized = true;
      console.log('✅ Redis Cache Service initialized');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize Redis Cache Service:', error.message);
      this.initialized = false;

      if (!this.fallbackEnabled) {
        throw error;
      }

      console.log('⚠️ Cache service running in fallback mode');
      return false;
    }
  }

  /**
   * Generate cache key with namespace and hashing for long keys
   */
  generateKey(namespace, identifier) {
    const key = `${this.keyPrefix}${this.strategies[namespace]?.prefix || ''}${identifier}`;

    // Hash long keys to avoid Redis key length limits
    if (key.length > 200) {
      const hash = crypto.createHash('md5').update(key).digest('hex');
      return `${this.keyPrefix}${this.strategies[namespace]?.prefix || ''}hash:${hash}`;
    }

    return key;
  }

  /**
   * Get value from cache with error handling
   */
  async get(namespace, identifier) {
    if (!this.initialized && !this.fallbackEnabled) {
      return null;
    }

    try {
      const key = this.generateKey(namespace, identifier);
      const value = await redisConfig.executeCommand('get', key);

      if (value) {
        this.performance.hits++;
        this.performance.totalOperations++;

        // Track cache hit for monitoring
        await this.trackCacheHit(namespace, 'hit');

        return JSON.parse(value);
      } else {
        this.performance.misses++;
        this.performance.totalOperations++;

        // Track cache miss for monitoring
        await this.trackCacheHit(namespace, 'miss');

        return null;
      }
    } catch (error) {
      this.performance.errors++;
      console.error(`❌ Cache get error for ${namespace}:${identifier}:`, error.message);
      return null;
    }
  }

  /**
   * Set value in cache with TTL and error handling
   */
  async set(namespace, identifier, value, customTTL = null) {
    if (!this.initialized && !this.fallbackEnabled) {
      return false;
    }

    try {
      const key = this.generateKey(namespace, identifier);
      const ttl = customTTL || this.strategies[namespace]?.ttl || this.defaultTTL;
      const serializedValue = JSON.stringify(value);

      await redisConfig.executeCommand('set', key, serializedValue, 'EX', ttl);

      this.performance.sets++;
      this.performance.totalOperations++;

      return true;
    } catch (error) {
      this.performance.errors++;
      console.error(`❌ Cache set error for ${namespace}:${identifier}:`, error.message);
      return false;
    }
  }

  /**
   * Delete value from cache
   */
  async delete(namespace, identifier) {
    if (!this.initialized) {
      return false;
    }

    try {
      const key = this.generateKey(namespace, identifier);
      const result = await redisConfig.executeCommand('del', key);

      this.performance.deletes++;
      this.performance.totalOperations++;

      return result > 0;
    } catch (error) {
      this.performance.errors++;
      console.error(`❌ Cache delete error for ${namespace}:${identifier}:`, error.message);
      return false;
    }
  }

  /**
   * Delete multiple keys by pattern
   */
  async deletePattern(namespace, pattern) {
    if (!this.initialized) {
      return 0;
    }

    try {
      const keyPattern = this.generateKey(namespace, pattern);
      const keys = await redisConfig.executeCommand('keys', keyPattern);

      if (keys.length > 0) {
        const deleted = await redisConfig.executeCommand('del', ...keys);
        this.performance.deletes += deleted;
        this.performance.totalOperations++;
        return deleted;
      }

      return 0;
    } catch (error) {
      this.performance.errors++;
      console.error(`❌ Cache delete pattern error for ${namespace}:${pattern}:`, error.message);
      return 0;
    }
  }

  /**
   * Check if key exists
   */
  async exists(namespace, identifier) {
    if (!this.initialized) {
      return false;
    }

    try {
      const key = this.generateKey(namespace, identifier);
      const result = await redisConfig.executeCommand('exists', key);
      return result === 1;
    } catch (error) {
      this.performance.errors++;
      console.error(`❌ Cache exists error for ${namespace}:${identifier}:`, error.message);
      return false;
    }
  }

  /**
   * Set TTL for existing key
   */
  async expire(namespace, identifier, ttl) {
    if (!this.initialized) {
      return false;
    }

    try {
      const key = this.generateKey(namespace, identifier);
      const result = await redisConfig.executeCommand('expire', key, ttl);
      return result === 1;
    } catch (error) {
      this.performance.errors++;
      console.error(`❌ Cache expire error for ${namespace}:${identifier}:`, error.message);
      return false;
    }
  }

  /**
   * Get TTL for key
   */
  async ttl(namespace, identifier) {
    if (!this.initialized) {
      return -1;
    }

    try {
      const key = this.generateKey(namespace, identifier);
      return await redisConfig.executeCommand('ttl', key);
    } catch (error) {
      this.performance.errors++;
      console.error(`❌ Cache TTL error for ${namespace}:${identifier}:`, error.message);
      return -1;
    }
  }

  /**
   * Increment counter
   */
  async increment(namespace, identifier, amount = 1) {
    if (!this.initialized) {
      return 0;
    }

    try {
      const key = this.generateKey(namespace, identifier);
      return await redisConfig.executeCommand('incrby', key, amount);
    } catch (error) {
      this.performance.errors++;
      console.error(`❌ Cache increment error for ${namespace}:${identifier}:`, error.message);
      return 0;
    }
  }

  /**
   * Set with NX (only if not exists) - useful for distributed locks
   */
  async setIfNotExists(namespace, identifier, value, ttl = 60) {
    if (!this.initialized) {
      return false;
    }

    try {
      const key = this.generateKey(namespace, identifier);
      const serializedValue = JSON.stringify(value);
      const result = await redisConfig.executeCommand('set', key, serializedValue, 'EX', ttl, 'NX');

      if (result === 'OK') {
        this.performance.sets++;
        this.performance.totalOperations++;
        return true;
      }

      return false;
    } catch (error) {
      this.performance.errors++;
      console.error(`❌ Cache setIfNotExists error for ${namespace}:${identifier}:`, error.message);
      return false;
    }
  }

  /**
   * Get or set pattern - fetch from cache or execute function and cache result
   */
  async getOrSet(namespace, identifier, fetchFunction, customTTL = null) {
    // Try to get from cache first
    let cached = await this.get(namespace, identifier);

    if (cached !== null) {
      return cached;
    }

    // Cache miss - execute function
    try {
      const result = await fetchFunction();

      // Cache the result
      if (result !== null && result !== undefined) {
        await this.set(namespace, identifier, result, customTTL);
      }

      return result;
    } catch (error) {
      console.error(`❌ Error in fetch function for ${namespace}:${identifier}:`, error.message);
      throw error;
    }
  }

  /**
   * Cache warming - pre-populate frequently accessed data
   */
  async warmCache(warmupData) {
    if (!this.initialized) {
      return { success: false, reason: 'Cache not initialized' };
    }

    const results = {
      total: warmupData.length,
      successful: 0,
      failed: 0,
      errors: []
    };

    for (const item of warmupData) {
      try {
        const success = await this.set(
          item.namespace,
          item.identifier,
          item.data,
          item.ttl
        );

        if (success) {
          results.successful++;
        } else {
          results.failed++;
        }
      } catch (error) {
        results.failed++;
        results.errors.push({
          namespace: item.namespace,
          identifier: item.identifier,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Track cache hits/misses for monitoring
   */
  async trackCacheHit(namespace, type) {
    if (!this.initialized) {
      return;
    }

    try {
      const trackingKey = this.generateKey('cache-metrics', namespace);
      const field = type === 'hit' ? 'hits' : 'misses';

      // Use Redis hash for efficient tracking
      await redisConfig.executeCommand('hincrby', trackingKey, field, 1);
      await redisConfig.executeCommand('expire', trackingKey, 3600); // 1 hour
    } catch (error) {
      // Silently ignore tracking errors
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(namespace = null) {
    const stats = {
      performance: this.performance,
      hitRate: 0,
      totalKeys: 0,
      memoryUsage: 0
    };

    if (this.performance.totalOperations > 0) {
      stats.hitRate = (this.performance.hits / this.performance.totalOperations) * 100;
    }

    if (this.initialized) {
      try {
        // Get Redis info
        const info = await this.client.info('memory');
        const memoryInfo = redisConfig.parseRedisInfo(info);

        stats.memoryUsage = memoryInfo.used_memory_human;

        // Count keys in specific namespace
        if (namespace) {
          const pattern = this.generateKey(namespace, '*');
          const keys = await this.client.keys(pattern);
          stats.totalKeys = keys.length;
        } else {
          // Count all GUI-LOP keys
          const allKeys = await this.client.keys(`${this.keyPrefix}*`);
          stats.totalKeys = allKeys.length;
        }

        // Get namespace-specific metrics
        if (namespace) {
          const trackingKey = this.generateKey('cache-metrics', namespace);
          const metrics = await this.client.hgetall(trackingKey);
          stats.namespaceMetrics = {
            hits: parseInt(metrics.hits || 0),
            misses: parseInt(metrics.misses || 0)
          };
        }
      } catch (error) {
        console.error('❌ Error getting cache stats:', error.message);
      }
    }

    return stats;
  }

  /**
   * Clear all cache or specific namespace
   */
  async clear(namespace = null) {
    if (!this.initialized) {
      return false;
    }

    try {
      if (namespace) {
        // Clear specific namespace
        const pattern = this.generateKey(namespace, '*');
        const keys = await this.client.keys(pattern);

        if (keys.length > 0) {
          await this.client.del(...keys);
          console.log(`🗑️ Cleared ${keys.length} keys from ${namespace} namespace`);
        }

        return keys.length;
      } else {
        // Clear all GUI-LOP keys
        const allKeys = await this.client.keys(`${this.keyPrefix}*`);

        if (allKeys.length > 0) {
          await this.client.del(...allKeys);
          console.log(`🗑️ Cleared ${allKeys.length} keys from cache`);
        }

        return allKeys.length;
      }
    } catch (error) {
      console.error('❌ Error clearing cache:', error.message);
      return false;
    }
  }

  /**
   * Health check for cache service
   */
  async healthCheck() {
    const health = {
      status: 'healthy',
      initialized: this.initialized,
      connected: false,
      responseTime: 0,
      error: null
    };

    if (!this.initialized) {
      health.status = this.fallbackEnabled ? 'degraded' : 'unhealthy';
      health.error = 'Cache service not initialized';
      return health;
    }

    try {
      const startTime = Date.now();
      await this.client.ping();
      health.responseTime = Date.now() - startTime;
      health.connected = true;
      health.status = 'healthy';
    } catch (error) {
      health.status = 'unhealthy';
      health.connected = false;
      health.error = error.message;
    }

    return health;
  }

  /**
   * Close cache service
   */
  async close() {
    try {
      if (this.client) {
        await redisConfig.close();
        this.initialized = false;
        console.log('✅ Redis Cache Service closed');
      }
    } catch (error) {
      console.error('❌ Error closing Redis Cache Service:', error.message);
      throw error;
    }
  }
}

// Create singleton instance
const cacheService = new RedisCacheService();

export default cacheService;
export { RedisCacheService };