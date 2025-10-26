/**
 * Blacklist Service Security Tests
 * Comprehensive testing for token blacklist functionality
 */

import { BlacklistService } from '../../src/backend/services/blacklist-service.js';

describe('BlacklistService Security Tests', () => {
  let blacklistService;

  beforeEach(() => {
    blacklistService = new BlacklistService({
      defaultTTL: 60000, // 1 minute for testing
      maxTokens: 100,
      cleanupInterval: 1000 // 1 second for testing
    });
  });

  afterEach(() => {
    blacklistService.destroy();
  });

  describe('Token Blacklisting', () => {
    test('should add token to blacklist', () => {
      const jti = 'test-token-id';
      const result = blacklistService.addToBlacklist(jti);

      expect(result).toBe(true);
      expect(blacklistService.isBlacklisted(jti)).toBe(true);
    });

    test('should not blacklist non-existent tokens', () => {
      const result = blacklistService.isBlacklisted('non-existent-token');

      expect(result).toBe(false);
    });

    test('should automatically remove expired tokens', (done) => {
      const jti = 'test-token-id';
      const shortTTL = 100; // 100ms

      blacklistService.addToBlacklist(jti, { ttl: shortTTL });
      expect(blacklistService.isBlacklisted(jti)).toBe(true);

      setTimeout(() => {
        expect(blacklistService.isBlacklisted(jti)).toBe(false);
        done();
      }, 150);
    });

    test('should handle multiple tokens efficiently', () => {
      const tokenIds = Array.from({ length: 50 }, (_, i) => `token-${i}`);

      tokenIds.forEach(jti => {
        blacklistService.addToBlacklist(jti);
      });

      tokenIds.forEach(jti => {
        expect(blacklistService.isBlacklisted(jti)).toBe(true);
      });
    });

    test('should limit maximum number of blacklisted tokens', () => {
      const service = new BlacklistService({ maxTokens: 5 });

      // Add more tokens than the limit
      for (let i = 0; i < 10; i++) {
        service.addToBlacklist(`token-${i}`);
      }

      // Should not exceed the limit
      expect(service.blacklistedTokens.size).toBeLessThanOrEqual(5);

      service.destroy();
    });

    test('should store token metadata correctly', () => {
      const jti = 'test-token-id';
      const options = {
        ttl: 300000,
        reason: 'user_logout'
      };

      blacklistService.addToBlacklist(jti, options);

      const token = blacklistService.blacklistedTokens.get(jti);
      expect(token).toBeDefined();
      expect(token.reason).toBe('user_logout');
      expect(token.addedAt).toBeGreaterThan(0);
      expect(token.expiresAt).toBeGreaterThan(token.addedAt);
    });
  });

  describe('User Blacklisting', () => {
    test('should blacklist all tokens for a user', () => {
      const userId = 'user-123';
      const result = blacklistService.blacklistUserTokens(userId);

      expect(result).toBe(true);
      expect(blacklistService.areUserTokensBlacklisted(userId)).toBe(true);
    });

    test('should not blacklist tokens for non-blacklisted users', () => {
      const result = blacklistService.areUserTokensBlacklisted('non-existent-user');

      expect(result).toBe(false);
    });

    test('should automatically expire user blacklists', (done) => {
      const userId = 'user-123';
      const shortTTL = 100; // 100ms

      blacklistService.blacklistUserTokens(userId, { ttl: shortTTL });
      expect(blacklistService.areUserTokensBlacklisted(userId)).toBe(true);

      setTimeout(() => {
        expect(blacklistService.areUserTokensBlacklisted(userId)).toBe(false);
        done();
      }, 150);
    });

    test('should store user blacklist metadata', () => {
      const userId = 'user-123';
      const options = {
        ttl: 300000,
        reason: 'security_breach'
      };

      blacklistService.blacklistUserTokens(userId, options);

      const blacklist = blacklistService.userBlacklists.get(userId);
      expect(blacklist).toBeDefined();
      expect(blacklist.reason).toBe('security_breach');
      expect(blacklist.timestamp).toBeGreaterThan(0);
      expect(blacklist.expiresAt).toBeGreaterThan(blacklist.timestamp);
    });
  });

  describe('Cleanup Operations', () => {
    test('should clean up expired tokens', () => {
      const now = Date.now();

      // Add some tokens
      blacklistService.addToBlacklist('token-1', { ttl: 1000 });
      blacklistService.addToBlacklist('token-2', { ttl: 1000 });

      // Manually add an expired token
      blacklistService.blacklistedTokens.set('expired-token', {
        addedAt: now - 2000,
        expiresAt: now - 1000,
        reason: 'test'
      });

      const cleanedCount = blacklistService.cleanup();

      expect(cleanedCount).toBeGreaterThan(0);
      expect(blacklistService.isBlacklisted('expired-token')).toBe(false);
      expect(blacklistService.isBlacklisted('token-1')).toBe(true);
      expect(blacklistService.isBlacklisted('token-2')).toBe(true);
    });

    test('should clean up expired user blacklists', () => {
      const now = Date.now();

      // Add a user blacklist
      blacklistService.blacklistUserTokens('user-1', { ttl: 1000 });

      // Manually add an expired user blacklist
      blacklistService.userBlacklists.set('expired-user', {
        timestamp: now - 2000,
        expiresAt: now - 1000,
        reason: 'test'
      });

      const cleanedCount = blacklistService.cleanup();

      expect(cleanedCount).toBeGreaterThan(0);
      expect(blacklistService.areUserTokensBlacklisted('expired-user')).toBe(false);
      expect(blacklistService.areUserTokensBlacklisted('user-1')).toBe(true);
    });

    test('should start automatic cleanup', () => {
      const service = new BlacklistService({ cleanupInterval: 100 });

      expect(service.cleanupTimer).toBeDefined();

      service.destroy();
    });

    test('should stop automatic cleanup on destroy', () => {
      const service = new BlacklistService({ cleanupInterval: 100 });

      service.destroy();

      expect(service.cleanupTimer).toBeNull();
    });
  });

  describe('Statistics and Monitoring', () => {
    test('should provide accurate statistics', () => {
      // Add some tokens
      blacklistService.addToBlacklist('token-1');
      blacklistService.addToBlacklist('token-2');

      // Add a user blacklist
      blacklistService.blacklistUserTokens('user-1');

      const stats = blacklistService.getStats();

      expect(stats.totalBlacklisted).toBe(2);
      expect(stats.userBlacklists).toBe(1);
      expect(stats.oldestToken).toBeDefined();
      expect(stats.newestToken).toBeDefined();
    });

    test('should handle empty statistics', () => {
      const stats = blacklistService.getStats();

      expect(stats.totalBlacklisted).toBe(0);
      expect(stats.userBlacklists).toBe(0);
      expect(stats.oldestToken).toBeNull();
      expect(stats.newestToken).toBeNull();
    });

    test('should track token timestamps correctly', () => {
      const jti1 = 'token-1';
      const jti2 = 'token-2';

      blacklistService.addToBlacklist(jti1);

      // Wait a bit to ensure different timestamps
      setTimeout(() => {
        blacklistService.addToBlacklist(jti2);

        const stats = blacklistService.getStats();

        expect(stats.oldestToken).toBeLessThan(stats.newestToken);
      }, 10);
    });
  });

  describe('Data Persistence', () => {
    test('should export blacklist data correctly', () => {
      const jti1 = 'token-1';
      const jti2 = 'token-2';
      const userId = 'user-1';

      blacklistService.addToBlacklist(jti1);
      blacklistService.addToBlacklist(jti2);
      blacklistService.blacklistUserTokens(userId);

      const exported = blacklistService.export();

      expect(exported).toHaveProperty('tokens');
      expect(exported).toHaveProperty('userBlacklists');
      expect(exported).toHaveProperty('exportedAt');
      expect(exported.tokens).toHaveProperty(jti1);
      expect(exported.tokens).toHaveProperty(jti2);
      expect(exported.userBlacklists).toHaveProperty(userId);
    });

    test('should import blacklist data correctly', () => {
      const importData = {
        tokens: {
          'imported-token-1': {
            addedAt: Date.now(),
            expiresAt: Date.now() + 60000,
            reason: 'imported'
          }
        },
        userBlacklists: {
          'imported-user-1': {
            timestamp: Date.now(),
            expiresAt: Date.now() + 60000,
            reason: 'imported'
          }
        },
        exportedAt: Date.now()
      };

      const result = blacklistService.import(importData);

      expect(result.tokensImported).toBe(1);
      expect(result.userBlacklistsImported).toBe(1);
      expect(blacklistService.isBlacklisted('imported-token-1')).toBe(true);
      expect(blacklistService.areUserTokensBlacklisted('imported-user-1')).toBe(true);
    });

    test('should handle invalid import data', () => {
      expect(() => blacklistService.import(null))
        .toThrow('Invalid import data');

      expect(() => blacklistService.import('invalid'))
        .toThrow('Invalid import data');

      expect(() => blacklistService.import({}))
        .not.toThrow();
    });

    test('should skip expired tokens during import', () => {
      const pastTime = Date.now() - 60000;
      const importData = {
        tokens: {
          'expired-token': {
            addedAt: pastTime - 1000,
            expiresAt: pastTime,
            reason: 'expired'
          },
          'valid-token': {
            addedAt: Date.now() - 1000,
            expiresAt: Date.now() + 60000,
            reason: 'valid'
          }
        },
        userBlacklists: {},
        exportedAt: Date.now()
      };

      blacklistService.import(importData);

      expect(blacklistService.isBlacklisted('expired-token')).toBe(false);
      expect(blacklistService.isBlacklisted('valid-token')).toBe(true);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle null/undefined token IDs', () => {
      expect(() => blacklistService.addToBlacklist(null))
        .not.toThrow();

      expect(() => blacklistService.addToBlacklist(undefined))
        .not.toThrow();

      expect(blacklistService.isBlacklisted(null)).toBe(false);
      expect(blacklistService.isBlacklisted(undefined)).toBe(false);
    });

    test('should handle empty string token IDs', () => {
      const emptyJti = '';

      blacklistService.addToBlacklist(emptyJti);

      expect(blacklistService.isBlacklisted(emptyJti)).toBe(true);
    });

    test('should handle very long token IDs', () => {
      const longJti = 'a'.repeat(1000);

      blacklistService.addToBlacklist(longJti);

      expect(blacklistService.isBlacklisted(longJti)).toBe(true);
    });

    test('should handle special characters in token IDs', () => {
      const specialJti = 'token-!@#$%^&*()_+-=[]{}|;:,.<>?';

      blacklistService.addToBlacklist(specialJti);

      expect(blacklistService.isBlacklisted(specialJti)).toBe(true);
    });

    test('should handle cleanup with no tokens', () => {
      const cleanedCount = blacklistService.cleanup();

      expect(cleanedCount).toBe(0);
    });

    test('should handle removal of non-existent tokens', () => {
      const result = blacklistService.removeFromBlacklist('non-existent-token');

      expect(result).toBe(false);
    });

    test('should handle removal of existing tokens', () => {
      const jti = 'test-token';

      blacklistService.addToBlacklist(jti);
      expect(blacklistService.isBlacklisted(jti)).toBe(true);

      const result = blacklistService.removeFromBlacklist(jti);
      expect(result).toBe(true);
      expect(blacklistService.isBlacklisted(jti)).toBe(false);
    });

    test('should handle zero TTL', () => {
      const jti = 'test-token';

      blacklistService.addToBlacklist(jti, { ttl: 0 });

      // Token should be immediately expired
      expect(blacklistService.isBlacklisted(jti)).toBe(false);
    });

    test('should handle negative TTL', () => {
      const jti = 'test-token';

      blacklistService.addToBlacklist(jti, { ttl: -1000 });

      // Token should be immediately expired
      expect(blacklistService.isBlacklisted(jti)).toBe(false);
    });
  });

  describe('Performance and Scalability', () => {
    test('should handle large numbers of tokens efficiently', () => {
      const startTime = Date.now();
      const tokenCount = 1000;

      for (let i = 0; i < tokenCount; i++) {
        blacklistService.addToBlacklist(`token-${i}`);
      }

      const addTime = Date.now() - startTime;

      // Should add tokens quickly (less than 100ms for 1000 tokens)
      expect(addTime).toBeLessThan(100);

      // Check lookup performance
      const lookupStartTime = Date.now();

      for (let i = 0; i < tokenCount; i++) {
        blacklistService.isBlacklisted(`token-${i}`);
      }

      const lookupTime = Date.now() - lookupStartTime;

      // Should lookup tokens quickly (less than 50ms for 1000 lookups)
      expect(lookupTime).toBeLessThan(50);
    });

    test('should handle concurrent operations safely', async () => {
      const promises = [];
      const tokenCount = 100;

      // Concurrent additions
      for (let i = 0; i < tokenCount; i++) {
        promises.push(
          new Promise(resolve => {
            setTimeout(() => {
              blacklistService.addToBlacklist(`concurrent-token-${i}`);
              resolve();
            }, Math.random() * 10);
          })
        );
      }

      // Concurrent lookups
      for (let i = 0; i < tokenCount; i++) {
        promises.push(
          new Promise(resolve => {
            setTimeout(() => {
              blacklistService.isBlacklisted(`concurrent-token-${i}`);
              resolve();
            }, Math.random() * 10);
          })
        );
      }

      await Promise.all(promises);

      // Verify all tokens were added
      for (let i = 0; i < tokenCount; i++) {
        expect(blacklistService.isBlacklisted(`concurrent-token-${i}`)).toBe(true);
      }
    });
  });

  describe('Memory Management', () => {
    test('should not leak memory during cleanup', () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Add and remove many tokens
      for (let i = 0; i < 1000; i++) {
        blacklistService.addToBlacklist(`memory-test-${i}`);
        blacklistService.cleanup();
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be reasonable (less than 10MB)
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
    });

    test('should handle destroy operations correctly', () => {
      // Add some data
      blacklistService.addToBlacklist('token-1');
      blacklistService.blacklistUserTokens('user-1');

      // Destroy service
      blacklistService.destroy();

      // Verify cleanup
      expect(blacklistService.cleanupTimer).toBeNull();
      expect(blacklistService.blacklistedTokens.size).toBe(0);
      expect(blacklistService.userBlacklists.size).toBe(0);
    });
  });
});