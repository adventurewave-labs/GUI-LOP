/**
 * Rate Limit Service Security Tests
 * Comprehensive testing for rate limiting functionality
 */

import { RateLimitService } from '../../src/backend/services/rate-limit-service.js';

describe('RateLimitService Security Tests', () => {
  let rateLimitService;

  beforeEach(() => {
    rateLimitService = new RateLimitService({
      defaultWindowMs: 60000, // 1 minute for testing
      defaultMax: 10,
      cleanupInterval: 1000 // 1 second for testing
    });
  });

  afterEach(() => {
    rateLimitService.destroy();
  });

  describe('Basic Rate Limiting', () => {
    test('should allow requests within limit', () => {
      const key = 'test-key';
      const result = rateLimitService.isExceeded(key);

      expect(result.exceeded).toBe(false);
      expect(result.count).toBe(1);
      expect(result.remaining).toBe(9);
    });

    test('should block requests exceeding limit', () => {
      const key = 'test-key';
      const limit = 3;

      // Make requests up to limit
      for (let i = 0; i < limit; i++) {
        const result = rateLimitService.isExceeded(key);
        expect(result.exceeded).toBe(false);
      }

      // Next request should be blocked
      const blockedResult = rateLimitService.isExceeded(key);
      expect(blockedResult.exceeded).toBe(true);
      expect(blockedResult.limit).toBe(10);
      expect(blockedResult.resetTime).toBeGreaterThan(Date.now());
    });

    test('should handle different keys independently', () => {
      const key1 = 'user-1';
      const key2 = 'user-2';

      // Exhaust limit for key1
      for (let i = 0; i < 10; i++) {
        rateLimitService.isExceeded(key1);
      }

      // key1 should be blocked
      expect(rateLimitService.isExceeded(key1).exceeded).toBe(true);

      // key2 should still be allowed
      expect(rateLimitService.isExceeded(key2).exceeded).toBe(false);
    });

    test('should reset rate limit for specific key', () => {
      const key = 'test-key';

      // Add some requests
      rateLimitService.isExceeded(key);
      rateLimitService.isExceeded(key);

      expect(rateLimitService.getStatus(key).count).toBe(2);

      // Reset the key
      const result = rateLimitService.reset(key);

      expect(result).toBe(true);
      expect(rateLimitService.getStatus(key).count).toBe(0);
    });

    test('should reset all rate limits', () => {
      const key1 = 'test-key-1';
      const key2 = 'test-key-2';

      // Add requests to both keys
      rateLimitService.isExceeded(key1);
      rateLimitService.isExceeded(key2);

      // Reset all
      const result = rateLimitService.resetAll();

      expect(result).toBe(true);
      expect(rateLimitService.getStatus(key1).count).toBe(0);
      expect(rateLimitService.getStatus(key2).count).toBe(0);
    });
  });

  describe('Endpoint-Specific Rate Limiting', () => {
    test('should use different limits for different endpoint types', () => {
      const authKey = 'auth:user-123';
      const loginKey = 'login:user-123';

      // Auth endpoint limit (5 requests)
      for (let i = 0; i < 5; i++) {
        const result = rateLimitService.isExceeded(authKey, 'auth');
        expect(result.exceeded).toBe(false);
      }

      // Should be blocked on 6th request
      expect(rateLimitService.isExceeded(authKey, 'auth').exceeded).toBe(true);

      // Login endpoint limit (10 requests)
      for (let i = 0; i < 10; i++) {
        const result = rateLimitService.isExceeded(loginKey, 'login');
        expect(result.exceeded).toBe(false);
      }

      // Should be blocked on 11th request
      expect(rateLimitService.isExceeded(loginKey, 'login').exceeded).toBe(true);
    });

    test('should use correct window sizes for different endpoint types', () => {
      const service = new RateLimitService({
        registerWindowMs: 3600000, // 1 hour
        registerMax: 3
      });

      const key = 'register:user-123';

      // Should allow 3 requests in 1 hour window
      for (let i = 0; i < 3; i++) {
        const result = service.isExceeded(key, 'register');
        expect(result.exceeded).toBe(false);
        expect(result.windowMs).toBe(3600000);
        expect(result.limit).toBe(3);
      }

      service.destroy();
    });

    test('should handle unknown endpoint types with default limits', () => {
      const key = 'test-key';
      const result = rateLimitService.isExceeded(key, 'unknown-type');

      expect(result.exceeded).toBe(false);
      expect(result.limit).toBe(10); // Default max
      expect(result.windowMs).toBe(60000); // Default window
    });
  });

  describe('Time Window Management', () => {
    test('should slide time window correctly', (done) => {
      const key = 'test-key';
      const shortWindow = 100; // 100ms

      const service = new RateLimitService({
        defaultWindowMs: shortWindow,
        defaultMax: 3
      });

      // Make requests up to limit
      for (let i = 0; i < 3; i++) {
        service.isExceeded(key);
      }

      expect(service.isExceeded(key).exceeded).toBe(true);

      // Wait for window to slide
      setTimeout(() => {
        const result = service.isExceeded(key);
        expect(result.exceeded).toBe(false);
        expect(result.count).toBe(1);

        service.destroy();
        done();
      }, 150);
    });

    test('should handle old requests outside window', (done) => {
      const key = 'test-key';
      const shortWindow = 100; // 100ms

      const service = new RateLimitService({
        defaultWindowMs: shortWindow,
        defaultMax: 5
      });

      // Make initial requests
      service.isExceeded(key);
      service.isExceeded(key);

      // Wait for window to expire
      setTimeout(() => {
        const status = service.getStatus(key);
        expect(status.count).toBe(0); // Should have cleaned up old requests

        service.destroy();
        done();
      }, 150);
    });
  });

  describe('Statistics and Monitoring', () => {
    test('should provide accurate statistics', () => {
      const key1 = 'auth:user-1';
      const key2 = 'login:user-1';
      const key3 = 'auth:user-2';

      // Make some requests
      rateLimitService.isExceeded(key1, 'auth');
      rateLimitService.isExceeded(key1, 'auth');
      rateLimitService.isExceeded(key2, 'login');
      rateLimitService.isExceeded(key3, 'auth');

      const stats = rateLimitService.getStats();

      expect(stats.totalWindows).toBe(3);
      expect(stats.totalRequests).toBe(4);
      expect(stats.windowsByType.auth).toBeDefined();
      expect(stats.windowsByType.auth.windows).toBe(2);
      expect(stats.windowsByType.auth.requests).toBe(3);
      expect(stats.windowsByType.login.windows).toBe(1);
      expect(stats.windowsByType.login.requests).toBe(1);
    });

    test('should handle empty statistics', () => {
      const stats = rateLimitService.getStats();

      expect(stats.totalWindows).toBe(0);
      expect(stats.totalRequests).toBe(0);
      expect(stats.windowsByType).toEqual({});
    });

    test('should provide detailed key information', () => {
      const key = 'test-key';

      rateLimitService.isExceeded(key);
      rateLimitService.isExceeded(key);

      const keyInfo = rateLimitService.getKeyInfo(key);

      expect(keyInfo.key).toBe(key);
      expect(keyInfo.requestCount).toBe(2);
      expect(keyInfo.firstRequest).toBeInstanceOf(Date);
      expect(keyInfo.lastRequest).toBeInstanceOf(Date);
      expect(keyInfo.rateLimited).toBe(false);
    });

    test('should handle non-existent key information', () => {
      const keyInfo = rateLimitService.getKeyInfo('non-existent-key');

      expect(keyInfo.key).toBe('non-existent-key');
      expect(keyInfo.requestCount).toBe(0);
      expect(keyInfo.firstRequest).toBeNull();
      expect(keyInfo.lastRequest).toBeNull());
      expect(keyInfo.rateLimited).toBe(false);
    });
  });

  describe('Cleanup Operations', () => {
    test('should clean up expired windows', (done) => {
      const key = 'test-key';
      const shortWindow = 100; // 100ms

      const service = new RateLimitService({
        defaultWindowMs: shortWindow,
        defaultMax: 5,
        cleanupInterval: 50 // 50ms
      });

      // Make requests
      service.isExceeded(key);
      service.isExceeded(key);

      expect(service.getStats().totalWindows).toBe(1);

      // Wait for cleanup
      setTimeout(() => {
        const stats = service.getStats();
        expect(stats.totalWindows).toBe(0); // Should be cleaned up

        service.destroy();
        done();
      }, 200);
    });

    test('should keep active windows during cleanup', () => {
      const key = 'test-key';

      // Make requests
      rateLimitService.isExceeded(key);

      const cleanedCount = rateLimitService.cleanup();

      expect(cleanedCount).toBe(0); // Should not clean active windows
      expect(rateLimitService.getStats().totalWindows).toBe(1);
    });

    test('should stop cleanup on destroy', () => {
      const service = new RateLimitService({ cleanupInterval: 100 });

      expect(service.cleanupTimer).toBeDefined();

      service.destroy();

      expect(service.cleanupTimer).toBeNull();
    });
  });

  describe('Data Persistence', () => {
    test('should export rate limit data correctly', () => {
      const key1 = 'test-key-1';
      const key2 = 'test-key-2';

      rateLimitService.isExceeded(key1);
      rateLimitService.isExceeded(key1);
      rateLimitService.isExceeded(key2);

      const exported = rateLimitService.export();

      expect(exported).toHaveProperty('windows');
      expect(exported).toHaveProperty('limits');
      expect(exported).toHaveProperty('exportedAt');
      expect(exported.windows).toHaveProperty(key1);
      expect(exported.windows).toHaveProperty(key2);
      expect(Array.isArray(exported.windows[key1])).toBe(true);
    });

    test('should import rate limit data correctly', () => {
      const importData = {
        windows: {
          'imported-key-1': [Date.now() - 1000],
          'imported-key-2': [Date.now() - 500, Date.now() - 200]
        },
        limits: {
          defaultWindowMs: 60000,
          defaultMax: 10
        },
        exportedAt: Date.now()
      };

      const result = rateLimitService.import(importData);

      expect(result.windowsImported).toBe(2);
      expect(rateLimitService.getStatus('imported-key-1').count).toBe(1);
      expect(rateLimitService.getStatus('imported-key-2').count).toBe(2);
    });

    test('should handle invalid import data', () => {
      expect(() => rateLimitService.import(null))
        .toThrow('Invalid import data');

      expect(() => rateLimitService.import('invalid'))
        .toThrow('Invalid import data');

      expect(() => rateLimitService.import({}))
        .not.toThrow();
    });

    test('should skip old requests during import', () => {
      const pastTime = Date.now() - 120000; // 2 minutes ago
      const importData = {
        windows: {
          'old-key': [pastTime],
          'recent-key': [Date.now() - 1000]
        },
        limits: {},
        exportedAt: Date.now()
      };

      rateLimitService.import(importData);

      expect(rateLimitService.getStatus('old-key').count).toBe(0);
      expect(rateLimitService.getStatus('recent-key').count).toBe(1);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle null/undefined keys', () => {
      expect(() => rateLimitService.isExceeded(null))
        .not.toThrow();

      expect(() => rateLimitService.isExceeded(undefined))
        .not.toThrow();

      const result1 = rateLimitService.isExceeded(null);
      const result2 = rateLimitService.isExceeded(undefined);

      expect(result1.exceeded).toBe(false);
      expect(result2.exceeded).toBe(false);
    });

    test('should handle empty string keys', () => {
      const emptyKey = '';

      const result = rateLimitService.isExceeded(emptyKey);

      expect(result.exceeded).toBe(false);
      expect(result.count).toBe(1);
    });

    test('should handle very long keys', () => {
      const longKey = 'a'.repeat(1000);

      const result = rateLimitService.isExceeded(longKey);

      expect(result.exceeded).toBe(false);
      expect(result.count).toBe(1);
    });

    test('should handle special characters in keys', () => {
      const specialKey = 'user:123@domain.com?param=value#fragment';

      const result = rateLimitService.isExceeded(specialKey);

      expect(result.exceeded).toBe(false);
      expect(result.count).toBe(1);
    });

    test('should handle zero window size', () => {
      const service = new RateLimitService({
        defaultWindowMs: 0,
        defaultMax: 10
      });

      const result = service.isExceeded('test-key');

      expect(result.exceeded).toBe(false);
      expect(result.windowMs).toBe(0);

      service.destroy();
    });

    test('should handle negative window size', () => {
      const service = new RateLimitService({
        defaultWindowMs: -1000,
        defaultMax: 10
      });

      const result = service.isExceeded('test-key');

      expect(result.exceeded).toBe(false);
      expect(result.windowMs).toBe(-1000);

      service.destroy();
    });

    test('should handle zero limit', () => {
      const service = new RateLimitService({
        defaultWindowMs: 60000,
        defaultMax: 0
      });

      const result = service.isExceeded('test-key');

      expect(result.exceeded).toBe(true);
      expect(result.limit).toBe(0);

      service.destroy();
    });

    test('should handle negative limit', () => {
      const service = new RateLimitService({
        defaultWindowMs: 60000,
        defaultMax: -5
      });

      const result = service.isExceeded('test-key');

      expect(result.exceeded).toBe(true);
      expect(result.limit).toBe(-5);

      service.destroy();
    });
  });

  describe('Performance and Scalability', () => {
    test('should handle high request volumes efficiently', () => {
      const startTime = Date.now();
      const requestCount = 10000;

      for (let i = 0; i < requestCount; i++) {
        rateLimitService.isExceeded(`user-${i % 100}`); // 100 different users
      }

      const duration = Date.now() - startTime;

      // Should process 10,000 requests quickly (less than 1 second)
      expect(duration).toBeLessThan(1000);
    });

    test('should handle memory usage efficiently', () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Create many rate limit windows
      for (let i = 0; i < 1000; i++) {
        rateLimitService.isExceeded(`user-${i}`);
      }

      const memoryAfterCreate = process.memoryUsage().heapUsed;
      const createMemoryIncrease = memoryAfterCreate - initialMemory;

      // Memory usage should be reasonable (less than 5MB for 1000 windows)
      expect(createMemoryIncrease).toBeLessThan(5 * 1024 * 1024);

      // Cleanup and check memory release
      rateLimitService.cleanup();

      if (global.gc) {
        global.gc();
      }

      const memoryAfterCleanup = process.memoryUsage().heapUsed;
      const cleanupMemoryReduction = memoryAfterCreate - memoryAfterCleanup;

      // Should release some memory after cleanup
      expect(cleanupMemoryReduction).toBeGreaterThan(0);
    });

    test('should handle concurrent operations safely', async () => {
      const promises = [];
      const userCount = 100;
      const requestsPerUser = 10;

      // Concurrent rate limit checks
      for (let user = 0; user < userCount; user++) {
        for (let request = 0; request < requestsPerUser; request++) {
          promises.push(
            new Promise(resolve => {
              setTimeout(() => {
                rateLimitService.isExceeded(`user-${user}`);
                resolve();
              }, Math.random() * 10);
            })
          );
        }
      }

      await Promise.all(promises);

      // Verify all requests were processed
      const stats = rateLimitService.getStats();
      expect(stats.totalRequests).toBe(userCount * requestsPerUser);
      expect(stats.totalWindows).toBe(userCount);
    });
  });

  describe('Status and Monitoring', () => {
    test('should provide status without incrementing counter', () => {
      const key = 'test-key';

      // Make some requests
      rateLimitService.isExceeded(key);
      rateLimitService.isExceeded(key);

      // Check status multiple times
      const status1 = rateLimitService.getStatus(key);
      const status2 = rateLimitService.getStatus(key);
      const status3 = rateLimitService.getStatus(key);

      // Count should remain the same
      expect(status1.count).toBe(2);
      expect(status2.count).toBe(2);
      expect(status3.count).toBe(2);
    });

    test('should calculate remaining requests correctly', () => {
      const key = 'test-key';
      const limit = 10;

      // Make some requests
      for (let i = 0; i < 3; i++) {
        rateLimitService.isExceeded(key);
      }

      const status = rateLimitService.getStatus(key);

      expect(status.count).toBe(3);
      expect(status.limit).toBe(limit);
      expect(status.remaining).toBe(limit - 3);
    });

    test('should provide reset time calculation', () => {
      const key = 'test-key';

      rateLimitService.isExceeded(key);

      const status = rateLimitService.getStatus(key);

      expect(status.resetTime).toBeGreaterThan(Date.now());
      expect(status.resetTime).toBeLessThan(Date.now() + 61000); // Slight buffer
    });
  });

  describe('Security Considerations', () => {
    test('should prevent key collision attacks', () => {
      const maliciousKeys = [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32',
        'null',
        'undefined',
        '__proto__',
        'constructor',
        'prototype'
      ];

      maliciousKeys.forEach(key => {
        const result = rateLimitService.isExceeded(key);
        expect(result.exceeded).toBe(false);
        expect(result.count).toBe(1);
      });
    });

    test('should handle malformed key inputs gracefully', () => {
      const malformedInputs = [
        0,
        -1,
        3.14,
        true,
        false,
        {},
        [],
        Symbol('test')
      ];

      malformedInputs.forEach(input => {
        expect(() => rateLimitService.isExceeded(input))
          .not.toThrow();
      });
    });

    test('should not expose sensitive information in errors', () => {
      const key = 'test-key';

      // This shouldn't throw any errors that expose internal state
      expect(() => {
        rateLimitService.isExceeded(key);
        rateLimitService.getStatus(key);
        rateLimitService.getKeyInfo(key);
        rateLimitService.reset(key);
      }).not.toThrow();
    });

    test('should handle rapid key creation and destruction', () => {
      // Create and destroy many keys rapidly
      for (let i = 0; i < 1000; i++) {
        const key = `rapid-key-${i}`;
        rateLimitService.isExceeded(key);
        rateLimitService.reset(key);
      }

      // Should not crash or leak memory
      const stats = rateLimitService.getStats();
      expect(stats.totalWindows).toBe(0);
    });
  });
});