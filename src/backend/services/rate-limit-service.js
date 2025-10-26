/**
 * Rate Limiting Service
 * Protects authentication endpoints from abuse
 */

export class RateLimitService {
  constructor(options = {}) {
    this.windows = new Map(); // Map of windows for different endpoint types
    this.defaultWindowMs = options.windowMs || 15 * 60 * 1000; // 15 minutes
    this.defaultMax = options.max || 100; // Max requests per window
    this.cleanupInterval = options.cleanupInterval || 5 * 60 * 1000; // 5 minutes

    // Predefined limits for different endpoint types
    this.limits = {
      auth: {
        windowMs: options.authWindowMs || 15 * 60 * 1000, // 15 minutes
        max: options.authMax || 5 // 5 attempts per 15 minutes
      },
      login: {
        windowMs: options.loginWindowMs || 15 * 60 * 1000, // 15 minutes
        max: options.loginMax || 10 // 10 attempts per 15 minutes
      },
      register: {
        windowMs: options.registerWindowMs || 60 * 60 * 1000, // 1 hour
        max: options.registerMax || 3 // 3 registrations per hour
      },
      password: {
        windowMs: options.passwordWindowMs || 60 * 60 * 1000, // 1 hour
        max: options.passwordMax || 5 // 5 password resets per hour
      },
      token: {
        windowMs: options.tokenWindowMs || 15 * 60 * 1000, // 15 minutes
        max: options.tokenMax || 20 // 20 token requests per 15 minutes
      }
    };

    this.startCleanup();
  }

  /**
   * Check if rate limit is exceeded for a key
   */
  isExceeded(key, type = 'auth') {
    const limit = this.limits[type] || {
      windowMs: this.defaultWindowMs,
      max: this.defaultMax
    };

    const now = Date.now();
    const windowStart = now - limit.windowMs;

    // Get or create window for this key
    if (!this.windows.has(key)) {
      this.windows.set(key, []);
    }

    const requests = this.windows.get(key);

    // Remove old requests outside the window
    for (let i = requests.length - 1; i >= 0; i--) {
      if (requests[i] < windowStart) {
        requests.splice(i, 1);
      }
    }

    // Check if limit is exceeded
    if (requests.length >= limit.max) {
      return {
        exceeded: true,
        count: requests.length,
        limit: limit.max,
        windowMs: limit.windowMs,
        resetTime: Math.max(...requests) + limit.windowMs
      };
    }

    // Add current request
    requests.push(now);

    return {
      exceeded: false,
      count: requests.length,
      limit: limit.max,
      windowMs: limit.windowMs,
      remaining: limit.max - requests.length
    };
  }

  /**
   * Get rate limit status without incrementing
   */
  getStatus(key, type = 'auth') {
    const limit = this.limits[type] || {
      windowMs: this.defaultWindowMs,
      max: this.defaultMax
    };

    const now = Date.now();
    const windowStart = now - limit.windowMs;

    const requests = this.windows.get(key) || [];

    // Count requests in current window
    let count = 0;
    let oldestRequest = null;

    for (const timestamp of requests) {
      if (timestamp > windowStart) {
        count++;
        if (!oldestRequest || timestamp < oldestRequest) {
          oldestRequest = timestamp;
        }
      }
    }

    return {
      count,
      limit: limit.max,
      windowMs: limit.windowMs,
      remaining: Math.max(0, limit.max - count),
      resetTime: oldestRequest ? oldestRequest + limit.windowMs : now + limit.windowMs
    };
  }

  /**
   * Reset rate limit for a key
   */
  reset(key) {
    this.windows.delete(key);
    return true;
  }

  /**
   * Reset all rate limits (for testing)
   */
  resetAll() {
    this.windows.clear();
    return true;
  }

  /**
   * Clean up old windows
   */
  cleanup() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, requests] of this.windows.entries()) {
      const oldestAllowed = now - this.defaultWindowMs;

      // Remove old requests
      for (let i = requests.length - 1; i >= 0; i--) {
        if (requests[i] < oldestAllowed) {
          requests.splice(i, 1);
        }
      }

      // Remove empty windows
      if (requests.length === 0) {
        this.windows.delete(key);
        cleanedCount++;
      }
    }

    return cleanedCount;
  }

  /**
   * Start automatic cleanup
   */
  startCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);
  }

  /**
   * Stop automatic cleanup
   */
  stopCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    const stats = {
      totalWindows: this.windows.size,
      totalRequests: 0,
      windowsByType: {}
    };

    // Count total requests and categorize
    for (const [key, requests] of this.windows.entries()) {
      stats.totalRequests += requests.length;

      const type = key.split(':')[0];
      if (!stats.windowsByType[type]) {
        stats.windowsByType[type] = {
          windows: 0,
          requests: 0
        };
      }
      stats.windowsByType[type].windows++;
      stats.windowsByType[type].requests += requests.length;
    }

    return stats;
  }

  /**
   * Get detailed info for a specific key
   */
  getKeyInfo(key) {
    const requests = this.windows.get(key) || [];
    const now = Date.now();

    if (requests.length === 0) {
      return {
        key,
        requestCount: 0,
        firstRequest: null,
        lastRequest: null,
        rateLimited: false
      };
    }

    return {
      key,
      requestCount: requests.length,
      firstRequest: new Date(requests[0]),
      lastRequest: new Date(requests[requests.length - 1]),
      rateLimited: this.isExceeded(key).exceeded
    };
  }

  /**
   * Export rate limit data (for analysis)
   */
  export() {
    const data = {
      windows: {},
      limits: this.limits,
      exportedAt: Date.now()
    };

    for (const [key, requests] of this.windows.entries()) {
      data.windows[key] = [...requests];
    }

    return data;
  }

  /**
   * Import rate limit data (for testing/restore)
   */
  import(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid import data');
    }

    if (data.windows && typeof data.windows === 'object') {
      this.windows.clear();
      for (const [key, requests] of Object.entries(data.windows)) {
        if (Array.isArray(requests)) {
          this.windows.set(key, [...requests]);
        }
      }
    }

    return {
      windowsImported: Object.keys(data.windows || {}).length
    };
  }

  /**
   * Destroy service and cleanup
   */
  destroy() {
    this.stopCleanup();
    this.windows.clear();
  }
}

export default RateLimitService;