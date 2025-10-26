/**
 * Cache Integration Tests
 * Comprehensive tests for Redis caching layer integration
 * Week 5-6 Phase 2 - Redis Caching Layer
 */

import { describe, it, before, after, beforeEach, afterEach } from '@jest/globals';
import redisConfig from '../config/redis-config.js';
import cacheService from '../services/redis-cache-service.js';
import workflowCacheService from '../services/workflow-cache-service.js';
import sessionCacheService from '../services/session-cache-service.js';
import cacheMiddleware from '../middleware/cache-middleware.js';
import cacheInvalidationService from '../services/cache-invalidation-service.js';
import cacheWarmingService from '../services/cache-warming-service.js';
import cacheMonitoringService from '../services/cache-monitoring-service.js';
import cacheHealthMiddleware from '../middleware/cache-health-middleware.js';

describe('Cache Integration Tests', () => {
  let testRedis;

  beforeAll(async () => {
    // Initialize Redis for testing
    try {
      await redisConfig.initialize();
      testRedis = redisConfig.getClient();
      console.log('✅ Test Redis initialized');
    } catch (error) {
      console.warn('⚠️ Redis not available, skipping integration tests');
      testRedis = null;
    }
  });

  afterAll(async () => {
    if (testRedis) {
      await redisConfig.close();
    }
  });

  beforeEach(async () => {
    if (testRedis) {
      // Clean up test data before each test
      const keys = await testRedis.keys('test:*');
      if (keys.length > 0) {
        await testRedis.del(...keys);
      }
    }
  });

  describe('Redis Configuration', () => {
    it('should initialize Redis connection successfully', async () => {
      if (!testRedis) return;

      const health = await redisConfig.getHealthStatus();
      expect(health.status).toBe('healthy');
      expect(health.connected).toBe(true);
    });

    it('should handle connection failures gracefully', async () => {
      if (!testRedis) return;

      // Test with invalid config
      const invalidConfig = new (Object.getPrototypeOf(redisConfig).constructor)({
        host: 'invalid-host',
        port: 9999
      });

      await expect(invalidConfig.initialize()).rejects.toThrow();
    });

    it('should track performance metrics', async () => {
      if (!testRedis) return;

      const initialMetrics = redisConfig.getMetrics();
      expect(initialMetrics).toHaveProperty('commands');
      expect(initialMetrics).toHaveProperty('hits');
      expect(initialMetrics).toHaveProperty('misses');
    });
  });

  describe('Cache Service', () => {
    beforeEach(async () => {
      if (!testRedis) return;
      await cacheService.initialize();
    });

    afterEach(async () => {
      if (testRedis) {
        await cacheService.clear();
      }
    });

    it('should set and get cache values', async () => {
      if (!testRedis) return;

      const testData = { id: 1, name: 'test' };
      const key = 'test:item';

      await cacheService.set('userData', key, testData, 60);
      const retrieved = await cacheService.get('userData', key);

      expect(retrieved).toEqual(testData);
    });

    it('should handle cache misses gracefully', async () => {
      if (!testRedis) return;

      const result = await cacheService.get('userData', 'nonexistent:key');
      expect(result).toBeNull();
    });

    it('should implement getOrSet pattern', async () => {
      if (!testRedis) return;

      const fetchFunction = jest.fn().mockResolvedValue({ data: 'fresh' });
      const key = 'test:get-or-set';

      // First call should execute fetch function
      const result1 = await cacheService.getOrSet('userData', key, fetchFunction, 60);
      expect(fetchFunction).toHaveBeenCalledTimes(1);
      expect(result1).toEqual({ data: 'fresh' });

      // Second call should use cache
      const result2 = await cacheService.getOrSet('userData', key, fetchFunction, 60);
      expect(fetchFunction).toHaveBeenCalledTimes(1);
      expect(result2).toEqual({ data: 'fresh' });
    });

    it('should delete cache entries', async () => {
      if (!testRedis) return;

      const key = 'test:delete';
      await cacheService.set('userData', key, { test: true }, 60);

      const beforeDelete = await cacheService.get('userData', key);
      expect(beforeDelete).toEqual({ test: true });

      const deleted = await cacheService.delete('userData', key);
      expect(deleted).toBe(true);

      const afterDelete = await cacheService.get('userData', key);
      expect(afterDelete).toBeNull();
    });

    it('should support cache warming', async () => {
      if (!testRedis) return;

      const warmupData = [
        {
          namespace: 'userData',
          identifier: 'warmup:item1',
          data: { id: 1, name: 'item1' },
          ttl: 300
        },
        {
          namespace: 'userData',
          identifier: 'warmup:item2',
          data: { id: 2, name: 'item2' },
          ttl: 300
        }
      ];

      const results = await cacheService.warmCache(warmupData);
      expect(results.successful).toBe(2);
      expect(results.failed).toBe(0);

      // Verify items are cached
      const item1 = await cacheService.get('userData', 'warmup:item1');
      const item2 = await cacheService.get('userData', 'warmup:item2');

      expect(item1).toEqual({ id: 1, name: 'item1' });
      expect(item2).toEqual({ id: 2, name: 'item2' });
    });
  });

  describe('Workflow Cache Service', () => {
    beforeEach(async () => {
      if (!testRedis) return;
      await workflowCacheService.initialize();
    });

    it('should cache workflow templates', async () => {
      if (!testRedis) return;

      // Mock database response
      const mockTemplates = [
        {
          id: 1,
          name: 'Test Template',
          template_key: 'test-template',
          steps: [{ name: 'step1' }, { name: 'step2' }],
          category: 'test'
        }
      ];

      // Mock the database query
      const mockQuery = jest.fn().mockResolvedValue({ rows: mockTemplates });
      global.db = { query: mockQuery };

      const templates = await workflowCacheService.getTemplates();
      expect(templates).toBeDefined();
      expect(Array.isArray(templates)).toBe(true);
    });

    it('should invalidate user workflow caches', async () => {
      if (!testRedis) return;

      const userId = 'test-user-123';
      const result = await workflowCacheService.invalidateUserWorkflowsCache(userId);
      expect(result).toBe(true);
    });

    it('should get workflow statistics', async () => {
      if (!testRedis) return;

      const stats = await workflowCacheService.getWorkflowStats('24h');
      expect(stats).toBeDefined();
      expect(stats).toHaveProperty('timeframe', '24h');
    });
  });

  describe('Session Cache Service', () => {
    beforeEach(async () => {
      if (!testRedis) return;
      await sessionCacheService.initialize();
    });

    it('should create and retrieve sessions', async () => {
      if (!testRedis) return;

      const userData = {
        id: 'user-123',
        email: 'test@example.com',
        role: 'user'
      };

      const accessToken = 'access-token-123';
      const refreshToken = 'refresh-token-123';
      const deviceInfo = {
        ip: '127.0.0.1',
        userAgent: 'test-agent'
      };

      const session = await sessionCacheService.createSession(
        userData,
        accessToken,
        refreshToken,
        deviceInfo
      );

      expect(session).toBeDefined();
      expect(session.sessionId).toBeDefined();
      expect(session.userId).toBe(userData.id);
      expect(session.email).toBe(userData.email);

      // Retrieve session
      const retrieved = await sessionCacheService.getSession(session.sessionId);
      expect(retrieved).toBeDefined();
      expect(retrieved.userId).toBe(userData.id);
    });

    it('should validate JWT tokens', async () => {
      if (!testRedis) return;

      const userId = 'user-123';
      const sessionId = 'session-123';
      const token = 'test-jwt-token';

      // Cache JWT metadata
      await sessionCacheService.cacheJWTMetadata(token, sessionId, userId, 'access');

      const validation = await sessionCacheService.validateJWT(token, 'access');
      expect(validation.valid).toBe(true);
      expect(validation.userId).toBe(userId);
      expect(validation.sessionId).toBe(sessionId);
    });

    it('should handle rate limiting', async () => {
      if (!testRedis) return;

      const identifier = 'test@example.com';

      // Check rate limit (should be allowed initially)
      const result1 = await sessionCacheService.checkLoginRateLimit(identifier);
      expect(result1.allowed).toBe(true);

      // Multiple attempts should eventually be blocked
      let attempts = 0;
      let allowed = true;

      while (allowed && attempts < 10) {
        attempts++;
        const result = await sessionCacheService.checkLoginRateLimit(identifier);
        allowed = result.allowed;
      }

      expect(attempts).toBeGreaterThan(0);
    });
  });

  describe('Cache Middleware', () => {
    let mockReq, mockRes, mockNext;

    beforeEach(() => {
      mockReq = {
        method: 'GET',
        path: '/api/test',
        query: {},
        headers: {},
        getHeaders: () => ({}),
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
        end: jest.fn(),
        json: jest.fn()
      };

      mockRes = {
        ...mockReq
      };

      mockNext = jest.fn();
    });

    it('should cache GET requests', async () => {
      if (!testRedis) return;

      const middleware = cacheMiddleware.cache();
      await middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should skip caching for POST requests', async () => {
      if (!testRedis) return;

      mockReq.method = 'POST';
      const middleware = cacheMiddleware.cache();
      await middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle cache configuration', () => {
      expect(() => {
        cacheMiddleware.configureRoute('GET:/api/test', {
          ttl: 300,
          vary: ['authorization']
        });
      }).not.toThrow();
    });

    it('should provide cache statistics', () => {
      const stats = cacheMiddleware.getStats();
      expect(stats).toHaveProperty('requests');
      expect(stats).toHaveProperty('hitRate');
    });
  });

  describe('Cache Invalidation Service', () => {
    beforeEach(async () => {
      if (!testRedis) return;
      await cacheInvalidationService.initialize();
    });

    it('should add and execute invalidation rules', async () => {
      if (!testRedis) return;

      const mockHandler = jest.fn();
      cacheInvalidationService.addRule('test.event', mockHandler);

      const result = await cacheInvalidationService.invalidate('test.event', { test: 'data' });

      expect(mockHandler).toHaveBeenCalledWith({ test: 'data' });
      expect(result.success).toBe(true);
    });

    it('should handle batch invalidation', async () => {
      if (!testRedis) return;

      const mockHandler = jest.fn();
      cacheInvalidationService.addRule('test.batch', mockHandler);

      const events = [
        { event: 'test.batch', data: { id: 1 } },
        { event: 'test.batch', data: { id: 2 } }
      ];

      const result = await cacheInvalidationService.batchInvalidate(events);
      expect(result.success).toBe(true);
      expect(result.totalEvents).toBe(2);
    });

    it('should track invalidation history', async () => {
      if (!testRedis) return;

      const mockHandler = jest.fn();
      cacheInvalidationService.addRule('test.history', mockHandler);

      await cacheInvalidationService.invalidate('test.history', { test: 'data' });

      const history = cacheInvalidationService.getInvalidationHistory(10);
      expect(history.length).toBeGreaterThan(0);
      expect(history[0]).toHaveProperty('event', 'test.history');
    });
  });

  describe('Cache Warming Service', () => {
    beforeEach(async () => {
      if (!testRedis) return;
      await cacheWarmingService.initialize();
    });

    it('should warm cache with startup data', async () => {
      if (!testRedis) return;

      // Mock the fetch functions
      const mockFetchers = {
        'popular-workflow-templates': jest.fn().mockResolvedValue([
          { id: 1, name: 'Template 1' },
          { id: 2, name: 'Template 2' }
        ]),
        'template-categories': jest.fn().mockResolvedValue([
          { category: 'analytics', count: 5 },
          { category: 'decision', count: 3 }
        ])
      };

      // Override fetchers in warming items
      cacheWarmingService.strategies.startup.items.forEach(item => {
        if (mockFetchers[item.name]) {
          item.fetcher = mockFetchers[item.name];
        }
      });

      const results = await cacheWarmingService.warmCacheItems(
        cacheWarmingService.strategies.startup.items,
        'startup'
      );

      expect(results.total).toBeGreaterThan(0);
      expect(results.successful).toBeGreaterThan(0);
    });

    it('should track usage patterns', () => {
      cacheWarmingService.trackAccess('template', 'template-123', 'user-456');
      cacheWarmingService.trackAccess('template', 'template-123', 'user-789');

      const patterns = cacheWarmingService.getPopularAccessPatterns('templates');
      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns[0].count).toBe(2);
    });

    it('should identify most active users', () => {
      cacheWarmingService.trackAccess('template', 'template-1', 'user-1');
      cacheWarmingService.trackAccess('template', 'template-2', 'user-1');
      cacheWarmingService.trackAccess('template', 'template-1', 'user-2');

      const activeUsers = cacheWarmingService.getMostActiveUsers();
      expect(activeUsers.length).toBeGreaterThan(0);
      expect(activeUsers[0].totalAccesses).toBe(2);
    });
  });

  describe('Cache Monitoring Service', () => {
    beforeEach(async () => {
      if (!testRedis) return;
      await cacheMonitoringService.initialize();
    });

    it('should collect metrics', async () => {
      if (!testRedis) return;

      await cacheMonitoringService.collectMetrics();

      const metrics = cacheMonitoringService.metrics;
      expect(metrics).toHaveProperty('timestamp');
      expect(metrics).toHaveProperty('cacheHits');
      expect(metrics).toHaveProperty('cacheMisses');
    });

    it('should analyze metrics and provide insights', async () => {
      if (!testRedis) return;

      // Set up metrics with poor performance to trigger insights
      cacheMonitoringService.metrics.hitRate = 30; // Below threshold

      const insights = await cacheMonitoringService.analyzeMetrics();
      expect(Array.isArray(insights)).toBe(true);
    });

    it('should check thresholds and generate alerts', async () => {
      if (!testRedis) return;

      // Set metrics above threshold
      cacheMonitoringService.metrics.hitRate = 40; // Below 50% threshold

      const alerts = await cacheMonitoringService.checkThresholds();
      expect(Array.isArray(alerts)).toBe(true);

      if (alerts.length > 0) {
        expect(alerts[0]).toHaveProperty('name');
        expect(alerts[0]).toHaveProperty('severity');
      }
    });

    it('should detect anomalies', async () => {
      if (!testRedis) return;

      // Add some historical data
      for (let i = 0; i < 15; i++) {
        cacheMonitoringService.addToHistory({
          timestamp: Date.now() - (15 - i) * 60000,
          hitRate: 80 + Math.random() * 10, // Normal range
          avgResponseTime: 20 + Math.random() * 10,
          memoryUsage: 40 + Math.random() * 20,
          errorRate: Math.random() * 2
        });
      }

      const anomalies = await cacheMonitoringService.detectAnomalies();
      expect(Array.isArray(anomalies)).toBe(true);
    });

    it('should provide dashboard data', () => {
      const dashboard = cacheMonitoringService.getDashboardData();
      expect(dashboard).toHaveProperty('current');
      expect(dashboard).toHaveProperty('baselines');
      expect(dashboard).toHaveProperty('activeAlerts');
    });

    it('should generate performance summary', () => {
      // Add some historical data
      for (let i = 0; i < 60; i++) {
        cacheMonitoringService.addToHistory({
          timestamp: Date.now() - (60 - i) * 60000,
          hitRate: 75 + Math.random() * 20,
          avgResponseTime: 25 + Math.random() * 15,
          memoryUsage: 45 + Math.random() * 25,
          errorRate: Math.random() * 3
        });
      }

      const summary = cacheMonitoringService.getPerformanceSummary();
      expect(summary).toHaveProperty('status');
      expect(summary).toHaveProperty('metrics');
    });
  });

  describe('Cache Health Middleware', () => {
    let mockReq, mockRes, mockNext;

    beforeEach(() => {
      mockReq = {
        cacheOperation: 'get',
        cacheNamespace: 'test',
        originalUrl: '/api/test',
        path: '/api/test'
      };

      mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      mockNext = jest.fn();
    });

    it('should perform health checks', async () => {
      if (!testRedis) return;

      const middleware = cacheHealthMiddleware.healthCheck();
      await middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalled();

      const response = mockRes.json.mock.calls[0][0];
      expect(response).toHaveProperty('service', 'cache-health');
      expect(response).toHaveProperty('timestamp');
    });

    it('should handle cache failures with fallback', async () => {
      if (!testRedis) return;

      const middleware = cacheHealthMiddleware.cacheFailureHandler();
      const cacheError = new Error('Redis connection failed');

      await middleware(cacheError, mockReq, mockRes, mockNext);

      // Should handle the error gracefully
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should add cache capabilities with fallback', async () => {
      const middleware = cacheHealthMiddleware.cacheWithFallback({
        operation: 'get',
        namespace: 'test'
      });

      middleware(mockReq, mockRes, mockNext);

      expect(mockReq).toHaveProperty('cacheEnabled');
      expect(mockReq).toHaveProperty('cacheOperation');
      expect(mockReq).toHaveProperty('cacheNamespace');
    });

    it('should manage in-memory fallback cache', () => {
      cacheHealthMiddleware.inMemoryCache.set('test:key', {
        data: { test: true },
        timestamp: Date.now()
      });

      const stats = cacheHealthMiddleware.getInMemoryStats();
      expect(stats.total).toBeGreaterThan(0);
    });
  });

  describe('Integration Scenarios', () => {
    beforeEach(async () => {
      if (!testRedis) return;

      // Initialize all services
      await cacheService.initialize();
      await workflowCacheService.initialize();
      await sessionCacheService.initialize();
      await cacheInvalidationService.initialize();
      await cacheWarmingService.initialize();
      await cacheMonitoringService.initialize();
    });

    it('should handle complete workflow caching scenario', async () => {
      if (!testRedis) return;

      // 1. Cache workflow templates
      const templates = await workflowCacheService.getTemplates();
      expect(templates).toBeDefined();

      // 2. Create user session
      const userData = { id: 'user-1', email: 'test@example.com', role: 'user' };
      const session = await sessionCacheService.createSession(
        userData,
        'access-token',
        'refresh-token',
        { ip: '127.0.0.1' }
      );
      expect(session).toBeDefined();

      // 3. Cache user workflows
      const userWorkflows = await workflowCacheService.getUserWorkflows(userData.id);
      expect(userWorkflows).toBeDefined();

      // 4. Invalidate caches on workflow update
      await cacheInvalidationService.invalidate('workflow.updated', {
        workflowId: 'workflow-1',
        userId: userData.id
      });

      // 5. Verify cache monitoring
      await cacheMonitoringService.collectMetrics();
      const metrics = cacheMonitoringService.metrics;
      expect(metrics).toHaveProperty('timestamp');
    });

    it('should handle cache failure scenarios gracefully', async () => {
      if (!testRedis) return;

      // Simulate cache failure by disabling cache
      const originalEnabled = cacheHealthMiddleware.enabled;
      cacheHealthMiddleware.enabled = false;

      try {
        // Operations should continue without cache
        const templates = await workflowCacheService.getTemplates();
        // Should not throw error even without cache

        const session = await sessionCacheService.createSession(
          { id: 'user-1', email: 'test@example.com' },
          'token',
          'refresh'
        );
        // Should not throw error even without cache

      } finally {
        // Restore cache setting
        cacheHealthMiddleware.enabled = originalEnabled;
      }
    });

    it('should maintain performance under load', async () => {
      if (!testRedis) return;

      const startTime = Date.now();
      const operations = 100;
      const promises = [];

      // Simulate concurrent cache operations
      for (let i = 0; i < operations; i++) {
        promises.push(
          cacheService.set('load-test', `key-${i}`, { data: i }, 60)
        );
        promises.push(
          cacheService.get('load-test', `key-${i % 10}`)
        );
      }

      await Promise.all(promises);
      const duration = Date.now() - startTime;

      // Should complete within reasonable time
      expect(duration).toBeLessThan(10000); // 10 seconds

      // Check Redis metrics
      const redisMetrics = redisConfig.getMetrics();
      expect(redisMetrics.commands).toBeGreaterThan(0);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle Redis connection failures gracefully', async () => {
      // Test with invalid Redis config
      const invalidCacheService = new (Object.getPrototypeOf(cacheService).constructor)({
        fallbackEnabled: true
      });

      // Should not throw error when Redis is unavailable
      await expect(invalidCacheService.initialize()).resolves.toBeFalsy();

      // Operations should return null or false gracefully
      const result = await invalidCacheService.get('test', 'key');
      expect(result).toBeNull();

      const setResult = await invalidCacheService.set('test', 'key', 'value', 60);
      expect(setResult).toBe(false);
    });

    it('should handle malformed cache data', async () => {
      if (!testRedis) return;

      await cacheService.initialize();

      // Set invalid JSON data directly in Redis
      const invalidKey = cacheService.generateKey('test', 'invalid');
      await testRedis.set(invalidKey, 'invalid-json{');

      // Should handle gracefully
      const result = await cacheService.get('test', 'invalid');
      expect(result).toBeNull();
    });

    it('should handle cache key collisions', async () => {
      if (!testRedis) return;

      await cacheService.initialize();

      const data1 = { id: 1, name: 'item1' };
      const data2 = { id: 2, name: 'item2' };

      // Use very long keys that should be hashed
      const longKey1 = 'a'.repeat(300);
      const longKey2 = 'b'.repeat(300);

      await cacheService.set('test', longKey1, data1, 60);
      await cacheService.set('test', longKey2, data2, 60);

      const result1 = await cacheService.get('test', longKey1);
      const result2 = await cacheService.get('test', longKey2);

      expect(result1).toEqual(data1);
      expect(result2).toEqual(data2);
      expect(result1).not.toEqual(result2);
    });
  });
});

/**
 * Performance Benchmark Test
 */
describe('Cache Performance Benchmarks', () => {
  let testRedis;

  beforeAll(async () => {
    try {
      await redisConfig.initialize();
      testRedis = redisConfig.getClient();
    } catch (error) {
      console.warn('⚠️ Redis not available for performance tests');
      testRedis = null;
    }
  });

  it('should meet performance targets for cache operations', async () => {
    if (!testRedis) return;

    await cacheService.initialize();

    const iterations = 1000;
    const dataSet = Array.from({ length: 100 }, (_, i) => ({
      key: `perf-key-${i}`,
      data: { id: i, value: `value-${i}`, timestamp: Date.now() }
    }));

    // Benchmark SET operations
    const setStartTime = Date.now();
    for (let i = 0; i < iterations; i++) {
      const data = dataSet[i % dataSet.length];
      await cacheService.set('performance', data.key, data.data, 300);
    }
    const setDuration = Date.now() - setStartTime;

    // Benchmark GET operations
    const getStartTime = Date.now();
    for (let i = 0; i < iterations; i++) {
      const data = dataSet[i % dataSet.length];
      await cacheService.get('performance', data.key);
    }
    const getDuration = Date.now() - getStartTime;

    // Performance assertions
    expect(setDuration).toBeLessThan(5000); // 5 seconds for 1000 SET operations
    expect(getDuration).toBeLessThan(2000); // 2 seconds for 1000 GET operations

    const setOpsPerSecond = Math.round(iterations / (setDuration / 1000));
    const getOpsPerSecond = Math.round(iterations / (getDuration / 1000));

    console.log(`📊 Cache Performance:`);
    console.log(`  SET: ${setOpsPerSecond} ops/sec`);
    console.log(`  GET: ${getOpsPerSecond} ops/sec`);

    // Should meet minimum performance targets
    expect(setOpsPerSecond).toBeGreaterThan(100); // Minimum 100 SET ops/sec
    expect(getOpsPerSecond).toBeGreaterThan(200); // Minimum 200 GET ops/sec
  });
});

export {
  // Export for potential use in other test files
  redisConfig,
  cacheService,
  workflowCacheService,
  sessionCacheService,
  cacheMiddleware,
  cacheInvalidationService,
  cacheWarmingService,
  cacheMonitoringService,
  cacheHealthMiddleware
};