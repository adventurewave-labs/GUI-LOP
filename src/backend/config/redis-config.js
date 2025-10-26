/**
 * Redis Configuration and Connection Management
 * Production-ready Redis setup with connection pooling, retry logic, and error handling
 * Week 5-6 Phase 2 - Redis Caching Layer
 */

import Redis from 'ioredis';
import { promisify } from 'util';

class RedisConfig {
  constructor(options = {}) {
    this.config = {
      host: options.host || process.env.REDIS_HOST || 'localhost',
      port: options.port || process.env.REDIS_PORT || 6379,
      password: options.password || process.env.REDIS_PASSWORD || null,
      db: options.db || process.env.REDIS_DB || 0,

      // Connection pool settings
      family: 4,
      keepAlive: true,
      connectTimeout: 10000,
      commandTimeout: 5000,

      // Retry configuration
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,

      // Connection pool
      connectionName: 'gui-lop-cache',
      maxConnections: options.maxConnections || 10,
      minConnections: options.minConnections || 2,

      // Performance settings
      enableOfflineQueue: false,
      enableReadyCheck: true,

      // Cluster support (for future scaling)
      enableAutoPipelining: true,
      maxMemoryPolicy: options.maxMemoryPolicy || 'allkeys-lru',

      // Monitoring
      showFriendlyErrorStack: process.env.NODE_ENV === 'development'
    };

    this.client = null;
    this.healthStatus = {
      connected: false,
      lastCheck: null,
      errorCount: 0,
      connectionAttempts: 0
    };

    // Performance metrics
    this.metrics = {
      commands: 0,
      hits: 0,
      misses: 0,
      errors: 0,
      avgResponseTime: 0,
      totalResponseTime: 0,
      startTime: Date.now()
    };

    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
  }

  /**
   * Initialize Redis connection with comprehensive error handling
   */
  async initialize() {
    try {
      console.log('🔄 Initializing Redis connection...');

      this.client = new Redis(this.config);

      // Event listeners for comprehensive monitoring
      this.client.on('connect', () => {
        console.log('✅ Redis connected successfully');
        this.healthStatus.connected = true;
        this.healthStatus.lastCheck = new Date();
        this.reconnectAttempts = 0;
      });

      this.client.on('ready', () => {
        console.log('🚀 Redis ready for commands');
        this.healthStatus.connected = true;
        this.healthStatus.lastCheck = new Date();
      });

      this.client.on('error', (error) => {
        console.error('❌ Redis error:', error.message);
        this.healthStatus.connected = false;
        this.healthStatus.errorCount++;
        this.metrics.errors++;
      });

      this.client.on('close', () => {
        console.log('🔌 Redis connection closed');
        this.healthStatus.connected = false;
      });

      this.client.on('reconnecting', (delay) => {
        this.reconnectAttempts++;
        console.log(`🔄 Redis reconnecting... Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

        if (this.reconnectAttempts > this.maxReconnectAttempts) {
          console.error('❌ Max reconnection attempts reached');
          this.client.disconnect();
        }
      });

      this.client.on('end', () => {
        console.log('🔚 Redis connection ended');
        this.healthStatus.connected = false;
      });

      // Test connection
      await this.client.ping();

      console.log('✅ Redis initialized successfully');
      return true;

    } catch (error) {
      console.error('❌ Failed to initialize Redis:', error.message);
      this.healthStatus.connected = false;
      this.healthStatus.errorCount++;
      throw error;
    }
  }

  /**
   * Get Redis client instance
   */
  getClient() {
    if (!this.client) {
      throw new Error('Redis client not initialized. Call initialize() first.');
    }
    return this.client;
  }

  /**
   * Execute command with metrics tracking
   */
  async executeCommand(command, ...args) {
    const startTime = Date.now();

    try {
      this.metrics.commands++;
      const result = await this.client[command](...args);

      // Update metrics
      const responseTime = Date.now() - startTime;
      this.metrics.totalResponseTime += responseTime;
      this.metrics.avgResponseTime = this.metrics.totalResponseTime / this.metrics.commands;

      // Track cache hits/misses for GET commands
      if (command === 'get') {
        if (result !== null) {
          this.metrics.hits++;
        } else {
          this.metrics.misses++;
        }
      }

      return result;

    } catch (error) {
      this.metrics.errors++;
      this.healthStatus.errorCount++;
      throw error;
    }
  }

  /**
   * Get connection health status
   */
  async getHealthStatus() {
    try {
      if (!this.client) {
        return {
          status: 'unhealthy',
          message: 'Redis client not initialized',
          connected: false
        };
      }

      // Ping Redis to check connectivity
      const startTime = Date.now();
      await this.client.ping();
      const responseTime = Date.now() - startTime;

      this.healthStatus.connected = true;
      this.healthStatus.lastCheck = new Date();

      // Get Redis info
      const info = await this.client.info('memory');
      const memoryInfo = this.parseRedisInfo(info);

      return {
        status: 'healthy',
        connected: true,
        responseTime: `${responseTime}ms`,
        memory: {
          used: memoryInfo.used_memory_human,
          peak: memoryInfo.used_memory_peak_human,
          rss: memoryInfo.used_memory_rss_human
        },
        uptime: await this.client.info('uptime'),
        healthStatus: this.healthStatus,
        metrics: this.metrics
      };

    } catch (error) {
      this.healthStatus.connected = false;
      return {
        status: 'unhealthy',
        connected: false,
        error: error.message,
        healthStatus: this.healthStatus,
        metrics: this.metrics
      };
    }
  }

  /**
   * Parse Redis INFO response
   */
  parseRedisInfo(info) {
    const lines = info.split('\r\n');
    const result = {};

    for (const line of lines) {
      if (line && !line.startsWith('#')) {
        const [key, value] = line.split(':');
        if (key && value) {
          result[key] = value;
        }
      }
    }

    return result;
  }

  /**
   * Get performance metrics
   */
  getMetrics() {
    const uptime = Date.now() - this.metrics.startTime;
    const hitRate = this.metrics.commands > 0 ? (this.metrics.hits / this.metrics.commands) * 100 : 0;

    return {
      ...this.metrics,
      uptime: `${Math.floor(uptime / 1000)}s`,
      hitRate: `${hitRate.toFixed(2)}%`,
      commandsPerSecond: Math.round(this.metrics.commands / (uptime / 1000)),
      errorRate: this.metrics.commands > 0 ? (this.metrics.errors / this.metrics.commands) * 100 : 0
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      commands: 0,
      hits: 0,
      misses: 0,
      errors: 0,
      avgResponseTime: 0,
      totalResponseTime: 0,
      startTime: Date.now()
    };
  }

  /**
   * Close Redis connection
   */
  async close() {
    try {
      if (this.client) {
        console.log('🔄 Closing Redis connection...');
        await this.client.quit();
        this.client = null;
        this.healthStatus.connected = false;
        console.log('✅ Redis connection closed');
      }
    } catch (error) {
      console.error('❌ Error closing Redis connection:', error.message);
      throw error;
    }
  }

  /**
   * Create Redis client for specific use case
   */
  createClient(name, options = {}) {
    const clientConfig = {
      ...this.config,
      ...options,
      connectionName: name
    };

    const client = new Redis(clientConfig);

    client.on('error', (error) => {
      console.error(`❌ Redis client ${name} error:`, error.message);
    });

    return client;
  }

  /**
   * Test Redis connection with comprehensive checks
   */
  async testConnection() {
    try {
      const tests = [];

      // Basic connectivity test
      const pingStart = Date.now();
      await this.client.ping();
      tests.push({ name: 'ping', status: 'passed', responseTime: Date.now() - pingStart });

      // Set/Get test
      const testKey = `test:${Date.now()}`;
      const testValue = 'test-value';

      const setStart = Date.now();
      await this.client.set(testKey, testValue, 'EX', 60);
      tests.push({ name: 'set', status: 'passed', responseTime: Date.now() - setStart });

      const getStart = Date.now();
      const retrieved = await this.client.get(testKey);
      tests.push({
        name: 'get',
        status: retrieved === testValue ? 'passed' : 'failed',
        responseTime: Date.now() - getStart
      });

      // Cleanup
      await this.client.del(testKey);

      return {
        status: 'healthy',
        tests,
        totalTests: tests.length,
        passedTests: tests.filter(t => t.status === 'passed').length
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        tests: []
      };
    }
  }
}

// Create singleton instance
const redisConfig = new RedisConfig();

export default redisConfig;
export { RedisConfig };