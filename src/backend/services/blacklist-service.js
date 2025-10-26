/**
 * Token Blacklist Service
 * Manages revoked tokens to prevent reuse
 */

export class BlacklistService {
  constructor(options = {}) {
    this.blacklistedTokens = new Map();
    this.userBlacklists = new Map();
    this.defaultTTL = options.defaultTTL || 7 * 24 * 60 * 60 * 1000; // 7 days
    this.maxTokens = options.maxTokens || 10000;
    this.cleanupInterval = options.cleanupInterval || 60 * 60 * 1000; // 1 hour

    // Start cleanup interval
    this.startCleanup();
  }

  /**
   * Add token to blacklist
   */
  addToBlacklist(jti, options = {}) {
    const ttl = options.ttl || this.defaultTTL;
    const expiresAt = Date.now() + ttl;

    // Check if we're approaching the limit
    if (this.blacklistedTokens.size >= this.maxTokens) {
      this.cleanup();
    }

    this.blacklistedTokens.set(jti, {
      addedAt: Date.now(),
      expiresAt,
      reason: options.reason || 'logout'
    });

    return true;
  }

  /**
   * Check if token is blacklisted
   */
  isBlacklisted(jti) {
    const token = this.blacklistedTokens.get(jti);
    if (!token) {
      return false;
    }

    // Check if token has expired
    if (Date.now() > token.expiresAt) {
      this.blacklistedTokens.delete(jti);
      return false;
    }

    return true;
  }

  /**
   * Blacklist all tokens for a user
   */
  blacklistUserTokens(userId, options = {}) {
    const timestamp = Date.now();
    const ttl = options.ttl || this.defaultTTL;

    this.userBlacklists.set(userId, {
      timestamp,
      expiresAt: timestamp + ttl,
      reason: options.reason || 'security_action'
    });

    return true;
  }

  /**
   * Check if user's tokens should be blacklisted
   */
  areUserTokensBlacklisted(userId) {
    const blacklist = this.userBlacklists.get(userId);
    if (!blacklist) {
      return false;
    }

    // Check if blacklist has expired
    if (Date.now() > blacklist.expiresAt) {
      this.userBlacklists.delete(userId);
      return false;
    }

    return true;
  }

  /**
   * Remove token from blacklist
   */
  removeFromBlacklist(jti) {
    return this.blacklistedTokens.delete(jti);
  }

  /**
   * Get blacklist statistics
   */
  getStats() {
    return {
      totalBlacklisted: this.blacklistedTokens.size,
      userBlacklists: this.userBlacklists.size,
      oldestToken: this.getOldestToken(),
      newestToken: this.getNewestToken()
    };
  }

  /**
   * Clean up expired tokens
   */
  cleanup() {
    const now = Date.now();
    let cleanedCount = 0;

    // Clean individual tokens
    for (const [jti, token] of this.blacklistedTokens.entries()) {
      if (now > token.expiresAt) {
        this.blacklistedTokens.delete(jti);
        cleanedCount++;
      }
    }

    // Clean user blacklists
    for (const [userId, blacklist] of this.userBlacklists.entries()) {
      if (now > blacklist.expiresAt) {
        this.userBlacklists.delete(userId);
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
   * Get oldest token timestamp
   */
  getOldestToken() {
    let oldest = null;
    for (const token of this.blacklistedTokens.values()) {
      if (!oldest || token.addedAt < oldest) {
        oldest = token.addedAt;
      }
    }
    return oldest;
  }

  /**
   * Get newest token timestamp
   */
  getNewestToken() {
    let newest = null;
    for (const token of this.blacklistedTokens.values()) {
      if (!newest || token.addedAt > newest) {
        newest = token.addedAt;
      }
    }
    return newest;
  }

  /**
   * Clear all blacklisted tokens (for testing)
   */
  clear() {
    this.blacklistedTokens.clear();
    this.userBlacklists.clear();
  }

  /**
   * Export blacklist data (for backup/analysis)
   */
  export() {
    const now = Date.now();
    const activeTokens = {};

    for (const [jti, token] of this.blacklistedTokens.entries()) {
      if (now <= token.expiresAt) {
        activeTokens[jti] = token;
      }
    }

    const activeUserBlacklists = {};
    for (const [userId, blacklist] of this.userBlacklists.entries()) {
      if (now <= blacklist.expiresAt) {
        activeUserBlacklists[userId] = blacklist;
      }
    }

    return {
      tokens: activeTokens,
      userBlacklists: activeUserBlacklists,
      exportedAt: now
    };
  }

  /**
   * Import blacklist data (for restore)
   */
  import(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid import data');
    }

    if (data.tokens && typeof data.tokens === 'object') {
      for (const [jti, token] of Object.entries(data.tokens)) {
        if (token.expiresAt > Date.now()) {
          this.blacklistedTokens.set(jti, token);
        }
      }
    }

    if (data.userBlacklists && typeof data.userBlacklists === 'object') {
      for (const [userId, blacklist] of Object.entries(data.userBlacklists)) {
        if (blacklist.expiresAt > Date.now()) {
          this.userBlacklists.set(userId, blacklist);
        }
      }
    }

    return {
      tokensImported: Object.keys(data.tokens || {}).length,
      userBlacklistsImported: Object.keys(data.userBlacklists || {}).length
    };
  }

  /**
   * Destroy service and cleanup
   */
  destroy() {
    this.stopCleanup();
    this.clear();
  }
}

export default BlacklistService;