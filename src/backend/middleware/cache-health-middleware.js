/**
 * Cache Health Middleware
 * Health checks and fallback mechanisms for Redis caching layer
 * Week 5-6 Phase 2 - Redis Caching Layer
 */

import redisConfig from '../config/redis-config.js';
import cacheService from '../services/redis-cache-service.js';
import workflowCacheService from '../services/workflow-cache-service.js';
import sessionCacheService from './session-cache-service.js';
import cacheMonitoringService from '../services/cache-monitoring-service.js';

class CacheHealthMiddleware {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.fallbackMode = options.fallbackMode !== false;
    this.healthCheckInterval = options.healthCheckInterval || 30000; // 30 seconds
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000;

    // Health status tracking
    this.healthStatus = {
      redis: 'unknown',
      cacheService: 'unknown',
      workflowCache: 'unknown',
      sessionCache: 'unknown',
      monitoring: 'unknown',
      overall: 'unknown',
      lastCheck: null,
      consecutiveFailures: 0,
      lastError: null
    };

    // Fallback mechanisms
    this.fallbackMechanisms = {
      cacheService: this.fallbackToInMemory.bind(this),
      workflowCache: this.fallbackToDirectDatabase.bind(this),
      sessionCache: this.fallbackToJWTOnly.bind(this),
      apiResponses: this.fallbackToNoCache.bind(this)
    };

    // In-memory fallback storage
    this.inMemoryCache = new Map();
    this.inMemoryMaxSize = options.inMemoryMaxSize || 1000;
    this.inMemoryTTL = options.inMemoryTTL || 300000; // 5 minutes

    // Start health monitoring
    if (this.enabled) {
      this.startHealthMonitoring();
    }
  }

  /**
   * Express middleware for cache health checks
   */
  healthCheck() {
    return async (req, res, next) => {
      try {
        const healthData = await this.getComprehensiveHealth();

        // Set appropriate HTTP status based on health
        const statusCode = this.getStatusCodeFromHealth(healthData.overall.status);

        res.status(statusCode).json({
          service: 'cache-health',
          timestamp: new Date().toISOString(),
          ...healthData
        });

      } catch (error) {
        console.error('❌ Cache health check error:', error.message);
        res.status(503).json({
          service: 'cache-health',
          status: 'unhealthy',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    };
  }

  /**
   * Middleware for handling cache failures gracefully
   */
  cacheFailureHandler() {
    return (error, req, res, next) => {
      if (this.isCacheError(error)) {
        console.warn('⚠️ Cache error, falling back:', error.message);

        // Use fallback mechanism if available
        if (this.fallbackMode && req.cacheOperation) {
          return this.handleFallback(req, res, error);
        }

        // Continue without cache
        req.cacheEnabled = false;
        return next();
      }

      // Not a cache error, continue normal error handling
      next(error);
    };
  }

  /**
   * Middleware to add cache capabilities with fallback
   */
  cacheWithFallback(cacheOptions = {}) {
    return (req, res, next) => {
      if (!this.enabled) {
        req.cacheEnabled = false;
        return next();
      }

      // Check if cache is healthy
      if (this.healthStatus.overall !== 'healthy') {
        console.warn('⚠️ Cache unhealthy, disabling cache for this request');
        req.cacheEnabled = false;
        req.cacheFallback = true;
        return next();
      }

      // Enable cache with fallback capabilities
      req.cacheEnabled = true;
      req.cacheOperation = cacheOptions.operation || 'get';
      req.cacheNamespace = cacheOptions.namespace || 'default';
      req.cacheFallback = false;

      next();
    };
  }

  /**
   * Get comprehensive health status
   */
  async getComprehensiveHealth() {
    const startTime = Date.now();
    const health = {
      overall: { status: 'unknown', responseTime: 0 },
      components: {},
      details: {},
      timestamp: new Date().toISOString()
    };

    try {
      // Check Redis connection
      health.components.redis = await this.checkRedisHealth();

      // Check cache service
      health.components.cacheService = await this.checkCacheServiceHealth();

      // Check workflow cache
      health.components.workflowCache = await this.checkWorkflowCacheHealth();

      // Check session cache
      health.components.sessionCache = await this.checkSessionCacheHealth();

      // Check monitoring service
      health.components.monitoring = await this.checkMonitoringHealth();

      // Determine overall health
      health.overall = this.determineOverallHealth(health.components);
      health.overall.responseTime = Date.now() - startTime;

      // Add additional details
      health.details = {
        consecutiveFailures: this.healthStatus.consecutiveFailures,
        lastError: this.healthStatus.lastError,
        fallbackMode: this.fallbackMode,
        inMemoryCacheSize: this.inMemoryCache.size
      };

      // Update internal status
      this.healthStatus = {
        ...health.overall,
        components: health.components,
        lastCheck: Date.now()
      };

      return health;

    } catch (error) {
      console.error('❌ Error in comprehensive health check:', error.message);

      this.healthStatus.consecutiveFailures++;
      this.healthStatus.lastError = error.message;

      return {
        overall: { status: 'unhealthy', error: error.message },
        components: {},
        details: {
          consecutiveFailures: this.healthStatus.consecutiveFailures,
          lastError: this.healthStatus.lastError
        },
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Check Redis health
   */
  async checkRedisHealth() {
    try {
      const startTime = Date.now();
      const redisHealth = await redisConfig.getHealthStatus();

      if (redisHealth.status === 'healthy') {
        return {
          status: 'healthy',
          responseTime: Date.now() - startTime,
          memory: redisHealth.memory,
          metrics: redisHealth.metrics,
          uptime: redisHealth.uptime
        };
      } else {
        return {
          status: 'unhealthy',
          responseTime: Date.now() - startTime,
          error: redisHealth.error || 'Redis connection failed'
        };
      }

    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  /**
   * Check cache service health
   */
  async checkCacheServiceHealth() {
    try {
      const startTime = Date.now();

      // Test basic operations
      const testKey = `health-check-${Date.now()}`;
      const testData = { test: true, timestamp: Date.now() };

      // Test set
      await cacheService.set('health', testKey, testData, 60);

      // Test get
      const retrieved = await cacheService.get('health', testKey);

      // Test delete
      await cacheService.delete('health', testKey);

      const responseTime = Date.now() - startTime;

      if (retrieved && retrieved.test === true) {
        return {
          status: 'healthy',
          responseTime,
          stats: await cacheService.getStats()
        };
      } else {
        return {
          status: 'unhealthy',
          responseTime,
          error: 'Cache service operations failed'
        };
      }

    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  /**
   * Check workflow cache health
   */
  async checkWorkflowCacheHealth() {
    try {
      const startTime = Date.now();
      const stats = await workflowCacheService.getCacheStats();

      return {
        status: 'healthy',
        responseTime: Date.now() - startTime,
        stats,
        initialized: workflowCacheService.initialized
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        initialized: workflowCacheService.initialized
      };
    }
  }

  /**
   * Check session cache health
   */
  async checkSessionCacheHealth() {
    try {
      const startTime = Date.now();
      const health = await sessionCacheService.healthCheck();

      return {
        status: health.status,
        responseTime: Date.now() - startTime,
        testPassed: health.testPassed,
        initialized: sessionCacheService.initialized
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        initialized: sessionCacheService.initialized
      };
    }
  }

  /**
   * Check monitoring service health
   */
  async checkMonitoringHealth() {
    try {
      const startTime = Date.now();
      const health = await cacheMonitoringService.healthCheck();

      return {
        status: health.status,
        responseTime: Date.now() - startTime,
        initialized: health.initialized,
        dataCollection: health.dataCollection
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        initialized: false
      };
    }
  }

  /**
   * Determine overall health status
   */
  determineOverallHealth(components) {
    const statuses = Object.values(components).map(comp => comp.status);
    const hasCritical = statuses.some(status => status === 'unhealthy');

    if (hasCritical) {
      return {
        status: 'unhealthy',
        message: 'One or more cache components are unhealthy'
      };
    }

    const hasWarnings = statuses.some(status => status === 'degraded');

    if (hasWarnings) {
      return {
        status: 'degraded',
        message: 'Some cache components are experiencing issues'
      };
    }

    const avgResponseTime = Object.values(components)
      .filter(comp => comp.responseTime)
      .reduce((sum, comp, _, arr) => sum + comp.responseTime / arr.length, 0);

    return {
      status: 'healthy',
      message: 'All cache components are operating normally',
      averageResponseTime: Math.round(avgResponseTime)
    };
  }

  /**
   * Start continuous health monitoring
   */
  startHealthMonitoring() {
    setInterval(async () => {
      try {
        await this.getComprehensiveHealth();
      } catch (error) {
        console.error('❌ Error in health monitoring:', error.message);
      }
    }, this.healthCheckInterval);

    console.log('🏥 Cache health monitoring started');
  }

  /**
   * Handle cache failures with fallback mechanisms
   */
  async handleFallback(req, res, error) {
    try {
      console.log(`🔄 Using fallback for ${req.cacheOperation} operation`);

      const fallbackFunction = this.fallbackMechanisms[req.cacheNamespace];
      if (fallbackFunction) {
        const result = await fallbackFunction(req, error);
        if (result !== null) {
          return res.json(result);
        }
      }

      // If no fallback available, continue without cache
      req.cacheEnabled = false;
      req.cacheFallback = true;

    } catch (fallbackError) {
      console.error('❌ Fallback mechanism failed:', fallbackError.message);
      req.cacheEnabled = false;
      req.cacheFallback = true;
    }
  }

  /**
   * Fallback to in-memory cache
   */
  async fallbackToInMemory(req, error) {
    const key = `${req.cacheNamespace}:${req.originalUrl || req.path}`;
    const cached = this.inMemoryCache.get(key);

    if (cached && Date.now() - cached.timestamp < this.inMemoryTTL) {
      console.log('✅ Using in-memory cache fallback');
      return cached.data;
    }

    return null;
  }

  /**
   * Fallback to direct database access
   */
  async fallbackToDirectDatabase(req, error) {
    console.log('🔄 Using direct database fallback');

    // This would delegate to the original database logic
    // Implementation depends on specific use case
    return null;
  }

  /**
   * Fallback to JWT-only authentication
   */
  async fallbackToJWTOnly(req, error) {
    console.log('🔄 Using JWT-only authentication fallback');

    // This would use the original JWT middleware without caching
    // Implementation depends on existing auth system
    return null;
  }

  /**
   * Fallback to no caching
   */
  async fallbackToNoCache(req, error) {
    console.log('🔄 Proceeding without cache');
    return null;
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
      /ECONNREFUSED/i,
      /ENOTFOUND/i
    ];

    return cacheErrorPatterns.some(pattern => pattern.test(error.message));
  }

  /**
   * Get status code from health status
   */
  getStatusCodeFromHealth(status) {
    switch (status) {
      case 'healthy': return 200;
      case 'degraded': return 200; // Still functional
      case 'unhealthy': return 503;
      default: return 500;
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    try {
      console.log('🔄 Shutting down cache health middleware...');
      this.enabled = false;

      // Clear in-memory cache
      this.inMemoryCache.clear();

      console.log('✅ Cache health middleware shutdown complete');
    } catch (error) {
      console.error('❌ Error during shutdown:', error.message);
      throw error;
    }
  }

  /**
   * Get current health status
   */
  getCurrentHealth() {
    return {
      ...this.healthStatus,
      fallbackEnabled: this.fallbackMode,
      inMemoryCacheSize: this.inMemoryCache.size
    };
  }

  /**
   * Reset health status
   */
  resetHealthStatus() {
    this.healthStatus = {
      redis: 'unknown',
      cacheService: 'unknown',
      workflowCache: 'unknown',
      sessionCache: 'unknown',
      monitoring: 'unknown',
      overall: 'unknown',
      lastCheck: null,
      consecutiveFailures: 0,
      lastError: null
    };

    console.log('📊 Health status reset');
  }

  /**
   * Enable/disable fallback mode
   */
  setFallbackMode(enabled) {
    this.fallbackMode = enabled;
    console.log(`🔄 Cache fallback mode ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get in-memory cache statistics
   */
  getInMemoryStats() {
    const now = Date.now();
    let expiredCount = 0;

    for (const [key, value] of this.inMemoryCache.entries()) {
      if (now - value.timestamp > this.inMemoryTTL) {
        expiredCount++;
      }
    }

    return {
      total: this.inMemoryCache.size,
      expired: expiredCount,
      maxSize: this.inMemoryMaxSize,
      ttl: this.inMemoryTTL
    };
  }

  /**
   * Clean up expired in-memory cache entries
   */
  cleanupInMemoryCache() {
    const now = Date.now();
    const toDelete = [];

    for (const [key, value] of this.inMemoryCache.entries()) {
      if (now - value.timestamp > this.inMemoryTTL) {
        toDelete.push(key);
      }
    }

    for (const key of toDelete) {
      this.inMemoryCache.delete(key);
    }

    if (toDelete.length > 0) {
      console.log(`🧹 Cleaned up ${toDelete.length} expired in-memory cache entries`);
    }

    return toDelete.length;
  }
}

// Create singleton instance
const cacheHealthMiddleware = new CacheHealthMiddleware({
  enabled: true,
  fallbackMode: true,
  healthCheckInterval: 30000,
  inMemoryMaxSize: 1000,
  inMemoryTTL: 300000 // 5 minutes
});

// Clean up in-memory cache periodically
setInterval(() => {
  cacheHealthMiddleware.cleanupInMemoryCache();
}, 60000); // Every minute

export default cacheHealthMiddleware;
export { CacheHealthMiddleware };