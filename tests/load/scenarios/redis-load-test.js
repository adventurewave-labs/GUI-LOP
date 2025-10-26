/**
 * Redis Cache Performance Validation
 * Tests Redis cache performance under concurrent load for session management,
 * workflow caching, and real-time data
 * Target: 200+ concurrent cache operations with <50ms response times (95th percentile)
 */

const Redis = require('redis');
const { performance } = require('perf_hooks');
const { v4: uuidv4 } = require('uuid');

class RedisLoadTest {
  constructor(config = {}) {
    this.redisConfig = {
      host: config.redisHost || process.env.REDIS_HOST || 'localhost',
      port: config.redisPort || process.env.REDIS_PORT || 6379,
      password: config.redisPassword || process.env.REDIS_PASSWORD || null,
      db: config.redisDB || process.env.REDIS_DB || 0,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3
    };

    this.concurrentConnections = config.concurrentConnections || 200;
    this.operationsPerConnection = config.operationsPerConnection || 100;
    this.testDuration = config.testDuration || 300000; // 5 minutes
    this.rampUpTime = config.rampUpTime || 30000;

    this.metrics = {
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      operationTimes: [],
      connectionTimes: [],
      errors: [],
      operations: {
        get: 0,
        set: 0,
        del: 0,
        hget: 0,
        hset: 0,
        expire: 0,
        pub: 0,
        sub: 0
      },
      cacheHitRate: {
        hits: 0,
        misses: 0
      },
      memoryUsage: [],
      throughputData: []
    };

    // Initialize Redis clients
    this.mainClient = null;
    this.subscribers = [];
  }

  // Initialize Redis connection
  async initializeRedis() {
    try {
      this.mainClient = Redis.createClient(this.redisConfig);

      this.mainClient.on('error', (error) => {
        console.error('Redis error:', error);
        this.metrics.errors.push({
          timestamp: new Date().toISOString(),
          type: 'redis_error',
          error: error.message
        });
      });

      this.mainClient.on('connect', () => {
        console.log('Redis connected successfully');
      });

      await this.mainClient.connect();

      // Test Redis connection
      await this.mainClient.ping();
      console.log('Redis connection verified');

      return true;
    } catch (error) {
      console.error('Failed to connect to Redis:', error);
      return false;
    }
  }

  // Generate test cache key
  generateCacheKey(type, id) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    return `${type}:${id}:${timestamp}:${random}`;
  }

  // Generate test session data
  generateSessionData(userId) {
    return {
      sessionId: uuidv4(),
      userId,
      email: `session-load-${userId}@gui-lop-load.com`,
      role: 'user',
      loginTime: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      permissions: ['read', 'write'],
      preferences: {
        theme: 'light',
        language: 'en',
        notifications: true
      },
      metadata: {
        loadTest: true,
        testRun: Date.now(),
        complexity: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)]
      }
    };
  }

  // Generate test workflow cache data
  generateWorkflowCacheData(workflowId, userId) {
    return {
      id: workflowId,
      userId,
      template: ['data-analysis', 'decision-making', 'content-creation'][Math.floor(Math.random() * 3)],
      status: 'running',
      progress: Math.floor(Math.random() * 100),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      cacheData: {
        lastAccessed: Date.now(),
        accessCount: Math.floor(Math.random() * 50) + 1,
        popular: Math.random() > 0.7,
        testRun: Date.now()
      }
    };
  }

  // Execute Redis operation with metrics
  async executeRedisOperation(operationFunction, operationType = 'unknown') {
    const startTime = performance.now();
    this.metrics.totalOperations++;

    try {
      const result = await operationFunction();
      const endTime = performance.now();
      const operationTime = endTime - startTime;

      this.metrics.operationTimes.push(operationTime);
      this.metrics.successfulOperations++;
      this.metrics.operations[operationType]++;

      // Record throughput data
      this.metrics.throughputData.push({
        timestamp: Date.now(),
        operationType,
        operationTime,
        success: true
      });

      return {
        result,
        operationTime,
        success: true,
        operationType,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      const endTime = performance.now();
      const operationTime = endTime - startTime;

      this.metrics.operationTimes.push(operationTime);
      this.metrics.failedOperations++;
      this.metrics.operations[operationType]++;
      this.metrics.errors.push({
        timestamp: new Date().toISOString(),
        operationType,
        error: error.message,
        operationTime
      });

      // Record failed operation
      this.metrics.throughputData.push({
        timestamp: Date.now(),
        operationType,
        operationTime,
        success: false,
        error: error.message
      });

      throw error;
    }
  }

  // Test SET operation
  async testCacheSet(key, data, ttl = 3600) {
    return this.executeRedisOperation(async () => {
      const serializedData = JSON.stringify(data);
      await this.mainClient.setEx(key, ttl, serializedData);
      return { key, data: serializedData, ttl };
    }, 'set');
  }

  // Test GET operation
  async testCacheGet(key) {
    return this.executeRedisOperation(async () => {
      const result = await this.mainClient.get(key);

      if (result) {
        this.metrics.cacheHitRate.hits++;
        return { key, data: JSON.parse(result), hit: true };
      } else {
        this.metrics.cacheHitRate.misses++;
        return { key, data: null, hit: false };
      }
    }, 'get');
  }

  // Test DEL operation
  async testCacheDel(key) {
    return this.executeRedisOperation(async () => {
      const result = await this.mainClient.del(key);
      return { key, deleted: result > 0 };
    }, 'del');
  }

  // Test HSET operation (for user sessions)
  async testHashSet(hashKey, field, data) {
    return this.executeRedisOperation(async () => {
      const serializedData = JSON.stringify(data);
      await this.mainClient.hSet(hashKey, field, serializedData);
      return { hashKey, field, data: serializedData };
    }, 'hset');
  }

  // Test HGET operation
  async testHashGet(hashKey, field) {
    return this.executeRedisOperation(async () => {
      const result = await this.mainClient.hGet(hashKey, field);

      if (result) {
        this.metrics.cacheHitRate.hits++;
        return { hashKey, field, data: JSON.parse(result), hit: true };
      } else {
        this.metrics.cacheHitRate.misses++;
        return { hashKey, field, data: null, hit: false };
      }
    }, 'hget');
  }

  // Test EXPIRE operation
  async testCacheExpire(key, ttl) {
    return this.executeRedisOperation(async () => {
      const result = await this.mainClient.expire(key, ttl);
      return { key, ttl, result };
    }, 'expire');
  }

  // Test PUB/SUB operations
  async testPublish(channel, message) {
    return this.executeRedisOperation(async () => {
      const serializedMessage = JSON.stringify(message);
      const result = await this.mainClient.publish(channel, serializedMessage);
      return { channel, message: serializedMessage, subscribers: result };
    }, 'pub');
  }

  // Create subscriber for testing
  async createSubscriber(channelName) {
    const subscriber = Redis.createClient(this.redisConfig);

    await subscriber.connect();
    this.subscribers.push(subscriber);

    const messages = [];

    await subscriber.subscribe(channelName, (message) => {
      try {
        const parsedMessage = JSON.parse(message);
        messages.push({
          timestamp: Date.now(),
          message: parsedMessage
        });
      } catch (error) {
        messages.push({
          timestamp: Date.now(),
          message: message,
          error: error.message
        });
      }
    });

    return { subscriber, messages };
  }

  // Test session caching pattern
  async testSessionCaching(userId) {
    const sessionKey = `session:user:${userId}`;
    const sessionData = this.generateSessionData(userId);

    // Set session
    await this.testCacheSet(sessionKey, sessionData, 1800); // 30 minutes TTL

    // Get session (should be cache hit)
    const getResult = await this.testCacheGet(sessionKey);

    // Update session activity
    sessionData.lastActivity = new Date().toISOString();
    await this.testCacheSet(sessionKey, sessionData, 1800);

    return getResult;
  }

  // Test workflow caching pattern
  async testWorkflowCaching(workflowId, userId) {
    const workflowKey = `workflow:${workflowId}`;
    const workflowData = this.generateWorkflowCacheData(workflowId, userId);

    // Cache workflow data
    await this.testCacheSet(workflowKey, workflowData, 600); // 10 minutes TTL

    // Retrieve workflow data (should be cache hit)
    const getResult = await this.testCacheGet(workflowKey);

    return getResult;
  }

  // Test hash-based user data storage
  async testUserHashStorage(userId) {
    const userHashKey = `user:${userId}`;
    const sessionData = this.generateSessionData(userId);

    // Store user data in hash fields
    await this.testHashSet(userHashKey, 'profile', {
      id: userId,
      email: sessionData.email,
      role: sessionData.role
    });

    await this.testHashSet(userHashKey, 'preferences', sessionData.preferences);
    await this.testHashSet(userHashKey, 'session', {
      sessionId: sessionData.sessionId,
      loginTime: sessionData.loginTime
    });

    // Retrieve hash fields
    const profileResult = await this.testHashGet(userHashKey, 'profile');
    const preferencesResult = await this.testHashGet(userHashKey, 'preferences');
    const sessionResult = await this.testHashGet(userHashKey, 'session');

    return { profileResult, preferencesResult, sessionResult };
  }

  // Test real-time data caching
  async testRealTimeDataCaching(dataId) {
    const realtimeKey = `realtime:${dataId}`;
    const realtimeData = {
      id: dataId,
      timestamp: Date.now(),
      type: 'workflow_update',
      data: {
        status: 'running',
        progress: Math.floor(Math.random() * 100),
        estimatedCompletion: Date.now() + Math.floor(Math.random() * 300000)
      },
      ttl: 60 // 1 minute TTL
    };

    // Set real-time data with short TTL
    await this.testCacheSet(realtimeKey, realtimeData, realtimeData.ttl);

    // Immediate retrieval (should be cache hit)
    const getResult = await this.testCacheGet(realtimeKey);

    return getResult;
  }

  // Simulate Redis load for single connection
  async simulateRedisLoad(connectionId) {
    const connectionMetrics = {
      connectionId,
      startTime: performance.now(),
      operationsCompleted: 0,
      operationsFailed: 0,
      totalOperationTime: 0,
      errors: []
    };

    try {
      // Record connection time
      const connectionStart = performance.now();
      const testClient = Redis.createClient(this.redisConfig);
      await testClient.connect();
      const connectionTime = performance.now() - connectionStart;
      this.metrics.connectionTimes.push(connectionTime);

      // Perform various Redis operations
      for (let i = 0; i < this.operationsPerConnection; i++) {
        const userId = `${connectionId}-${i}`;
        const workflowId = uuidv4();
        const dataId = uuidv4();

        try {
          // Mix of different cache operations
          const operationType = i % 8;

          switch (operationType) {
            case 0: // Session caching
              await this.testSessionCaching(userId);
              break;

            case 1: // Workflow caching
              await this.testWorkflowCaching(workflowId, userId);
              break;

            case 2: // User hash storage
              await this.testUserHashStorage(userId);
              break;

            case 3: // Real-time data caching
              await this.testRealTimeDataCaching(dataId);
              break;

            case 4: // Cache set with random data
              const randomKey = this.generateCacheKey('test', connectionId);
              const randomData = {
                id: uuidv4(),
                timestamp: Date.now(),
                data: `Random test data ${i}`,
                connectionId,
                testRun: Date.now()
              };
              await this.testCacheSet(randomKey, randomData, 300);
              break;

            case 5: // Cache get for existing data
              const existingKey = this.generateCacheKey('existing', connectionId);
              await this.testCacheGet(existingKey);
              break;

            case 6: // Cache expire
              const expireKey = this.generateCacheKey('expire', connectionId);
              await this.testCacheSet(expireKey, { temp: true }, 10);
              await this.testCacheExpire(expireKey, 5);
              break;

            case 7: // Cache delete
              const deleteKey = this.generateCacheKey('delete', connectionId);
              await this.testCacheSet(deleteKey, { toDelete: true }, 10);
              await this.testCacheDel(deleteKey);
              break;
          }

          connectionMetrics.operationsCompleted++;

        } catch (error) {
          connectionMetrics.operationsFailed++;
          connectionMetrics.errors.push(error.message);
        }

        // Small delay between operations
        await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
      }

      await testClient.quit();
      connectionMetrics.endTime = performance.now();
      connectionMetrics.totalDuration = connectionMetrics.endTime - connectionMetrics.startTime;

      return connectionMetrics;

    } catch (error) {
      connectionMetrics.endTime = performance.now();
      connectionMetrics.totalDuration = connectionMetrics.endTime - connectionMetrics.startTime;
      connectionMetrics.error = error.message;

      throw error;
    }
  }

  // Monitor Redis memory usage
  async monitorRedisMemory() {
    try {
      const info = await this.mainClient.info('memory');
      const memoryUsage = this.parseMemoryInfo(info);

      this.metrics.memoryUsage.push({
        timestamp: Date.now(),
        ...memoryUsage
      });

      return memoryUsage;
    } catch (error) {
      console.error('Failed to get Redis memory info:', error);
      return null;
    }
  }

  // Parse Redis memory info
  parseMemoryInfo(info) {
    const lines = info.split('\r\n');
    const memoryData = {};

    lines.forEach(line => {
      if (line.includes('used_memory_human:')) {
        memoryData.usedHuman = line.split(':')[1];
      } else if (line.includes('used_memory:')) {
        memoryData.usedBytes = parseInt(line.split(':')[1]);
      } else if (line.includes('used_memory_peak_human:')) {
        memoryData.peakHuman = line.split(':')[1];
      } else if (line.includes('used_memory_peak:')) {
        memoryData.peakBytes = parseInt(line.split(':')[1]);
      }
    });

    return memoryData;
  }

  // Run concurrent Redis load test
  async runConcurrentRedisTest() {
    console.log(`Starting Redis load test with ${this.concurrentConnections} concurrent connections`);
    console.log(`Operations per connection: ${this.operationsPerConnection}`);
    console.log(`Total expected operations: ${this.concurrentConnections * this.operationsPerConnection}`);

    // Initialize Redis connection
    const redisConnected = await this.initializeRedis();
    if (!redisConnected) {
      throw new Error('Failed to connect to Redis');
    }

    const startTime = performance.now();
    const connectionPromises = [];
    const monitoringInterval = setInterval(() => {
      this.monitorRedisMemory();
    }, 10000); // Monitor memory every 10 seconds

    // Ramp up connections gradually
    const rampUpInterval = this.rampUpTime / this.concurrentConnections;

    for (let i = 0; i < this.concurrentConnections; i++) {
      const delay = i * rampUpInterval;

      const connectionPromise = new Promise(async (resolve) => {
        await new Promise(r => setTimeout(r, delay));

        try {
          const result = await this.simulateRedisLoad(i);
          resolve({
            connectionId: i,
            success: true,
            metrics: result
          });
        } catch (error) {
          resolve({
            connectionId: i,
            success: false,
            error: error.message
          });
        }
      });

      connectionPromises.push(connectionPromise);
    }

    try {
      // Wait for all connections to complete
      const results = await Promise.all(connectionPromises);
      clearInterval(monitoringInterval);
      const endTime = performance.now();
      const totalTestTime = endTime - startTime;

      // Analyze results
      const analysis = this.analyzeResults(results, totalTestTime);

      console.log('\n=== Redis Load Test Results ===');
      console.log(`Total test time: ${(totalTestTime / 1000).toFixed(2)}s`);
      console.log(`Concurrent connections: ${this.concurrentConnections}`);
      console.log(`Successful connections: ${analysis.successfulConnections}/${this.concurrentConnections}`);
      console.log(`Total operations: ${this.metrics.totalOperations}`);
      console.log(`Successful operations: ${this.metrics.successfulOperations}`);
      console.log(`Failed operations: ${this.metrics.failedOperations}`);
      console.log(`Average operation time: ${analysis.averageOperationTime.toFixed(2)}ms`);
      console.log(`95th percentile operation time: ${analysis.p95OperationTime.toFixed(2)}ms`);
      console.log(`99th percentile operation time: ${analysis.p99OperationTime.toFixed(2)}ms`);
      console.log(`Cache hit rate: ${analysis.cacheHitRate.toFixed(2)}%`);
      console.log(`Operation throughput: ${analysis.operationThroughput.toFixed(2)} operations/second`);

      if (this.metrics.memoryUsage.length > 0) {
        const latestMemory = this.metrics.memoryUsage[this.metrics.memoryUsage.length - 1];
        console.log(`Redis memory usage: ${latestMemory.usedHuman || 'N/A'}`);
      }

      return analysis;

    } finally {
      // Clean up Redis connections
      if (this.mainClient) {
        await this.mainClient.quit();
      }
      for (const subscriber of this.subscribers) {
        await subscriber.quit();
      }
    }
  }

  // Analyze test results
  analyzeResults(results, totalTestTime) {
    const successfulConnections = results.filter(r => r.success).length;
    const failedConnections = results.length - successfulConnections;

    // Calculate operation time statistics
    const sortedOperationTimes = [...this.metrics.operationTimes].sort((a, b) => a - b);
    const totalOperationTime = this.metrics.operationTimes.reduce((sum, time) => sum + time, 0);

    const averageOperationTime = sortedOperationTimes.length > 0 ? totalOperationTime / sortedOperationTimes.length : 0;
    const p50OperationTime = sortedOperationTimes.length > 0 ? sortedOperationTimes[Math.floor(sortedOperationTimes.length * 0.5)] : 0;
    const p95OperationTime = sortedOperationTimes.length > 0 ? sortedOperationTimes[Math.floor(sortedOperationTimes.length * 0.95)] : 0;
    const p99OperationTime = sortedOperationTimes.length > 0 ? sortedOperationTimes[Math.floor(sortedOperationTimes.length * 0.99)] : 0;

    // Calculate throughput
    const operationThroughput = (this.metrics.successfulOperations / totalTestTime) * 1000;

    // Calculate cache hit rate
    const totalCacheAttempts = this.metrics.cacheHitRate.hits + this.metrics.cacheHitRate.misses;
    const cacheHitRate = totalCacheAttempts > 0 ? (this.metrics.cacheHitRate.hits / totalCacheAttempts) * 100 : 0;

    // Performance validation
    const performanceTargets = {
      p95OperationTimeTarget: 50, // 50ms for 95th percentile
      p99OperationTimeTarget: 100, // 100ms for 99th percentile
      connectionSuccessRateTarget: 0.95, // 95% connection success rate
      cacheHitRateTarget: 80, // 80% cache hit rate
      operationThroughputTarget: 5000 // 5000 operations per second
    };

    const performanceValidation = {
      p95OperationTimePassed: p95OperationTime <= performanceTargets.p95OperationTimeTarget,
      p99OperationTimePassed: p99OperationTime <= performanceTargets.p99OperationTimeTarget,
      connectionSuccessRatePassed: (successfulConnections / this.concurrentConnections) >= performanceTargets.connectionSuccessRateTarget,
      cacheHitRatePassed: cacheHitRate >= performanceTargets.cacheHitRateTarget,
      throughputPassed: operationThroughput >= performanceTargets.operationThroughputTarget,
      overallPassed: false
    };

    performanceValidation.overallPassed = performanceValidation.p95OperationTimePassed &&
                                        performanceValidation.p99OperationTimePassed &&
                                        performanceValidation.connectionSuccessRatePassed &&
                                        performanceValidation.cacheHitRatePassed;

    return {
      totalTestTime,
      totalConnections: this.concurrentConnections,
      successfulConnections,
      failedConnections,
      totalOperations: this.metrics.totalOperations,
      successfulOperations: this.metrics.successfulOperations,
      failedOperations: this.metrics.failedOperations,
      averageOperationTime,
      p50OperationTime,
      p95OperationTime,
      p99OperationTime,
      maxOperationTime: sortedOperationTimes.length > 0 ? Math.max(...sortedOperationTimes) : 0,
      minOperationTime: sortedOperationTimes.length > 0 ? Math.min(...sortedOperationTimes) : 0,
      operationThroughput,
      cacheHitRate,
      operations: this.metrics.operations,
      memoryUsage: this.metrics.memoryUsage,
      errors: this.metrics.errors,
      performanceValidation,
      performanceTargets,
      recommendations: this.generateRecommendations(performanceValidation, {
        p95OperationTime,
        p99OperationTime,
        successRate: successfulConnections / this.concurrentConnections,
        cacheHitRate,
        operationThroughput
      })
    };
  }

  // Generate performance recommendations
  generateRecommendations(validation, metrics) {
    const recommendations = [];

    if (!validation.p95OperationTimePassed) {
      recommendations.push({
        type: 'cache_performance',
        priority: 'high',
        message: `95th percentile operation time (${metrics.p95OperationTime.toFixed(2)}ms) exceeds target (50ms). Consider Redis optimization and connection pooling.`,
        metrics: {
          current: metrics.p95OperationTime,
          target: 50,
          variance: metrics.p95OperationTime - 50
        }
      });
    }

    if (!validation.cacheHitRatePassed) {
      recommendations.push({
        type: 'cache_efficiency',
        priority: 'medium',
        message: `Cache hit rate (${metrics.cacheHitRate.toFixed(2)}%) below target (80%). Review caching strategy and TTL settings.`,
        metrics: {
          current: metrics.cacheHitRate,
          target: 80,
          variance: 80 - metrics.cacheHitRate
        }
      });
    }

    if (!validation.throughputPassed) {
      recommendations.push({
        type: 'throughput',
        priority: 'high',
        message: `Operation throughput (${metrics.operationThroughput.toFixed(2)} ops/s) below target (5000 ops/s). Consider Redis clustering and optimization.`,
        metrics: {
          current: metrics.operationThroughput,
          target: 5000,
          variance: 5000 - metrics.operationThroughput
        }
      });
    }

    if (validation.overallPassed) {
      recommendations.push({
        type: 'success',
        priority: 'info',
        message: 'All Redis performance targets met. Cache system is performing excellently under load.',
        metrics: {
          allTargetsPassed: true
        }
      });
    }

    return recommendations;
  }

  // Generate detailed report
  generateReport(analysis) {
    return {
      testType: 'Redis Cache Performance Validation',
      timestamp: new Date().toISOString(),
      configuration: {
        redisConfig: {
          host: this.redisConfig.host,
          port: this.redisConfig.port,
          db: this.redisConfig.db
        },
        concurrentConnections: this.concurrentConnections,
        operationsPerConnection: this.operationsPerConnection,
        rampUpTime: this.rampUpTime,
        testDuration: this.testDuration
      },
      results: analysis,
      summary: {
        passed: analysis.performanceValidation.overallPassed,
        readyForProduction: analysis.performanceValidation.overallPassed && analysis.successfulConnections >= this.concurrentConnections * 0.95,
        bottlenecks: analysis.errors.length > 0 ? 'Yes' : 'No',
        performanceGrade: this.calculatePerformanceGrade(analysis),
        cacheEfficiency: analysis.cacheHitRate
      }
    };
  }

  // Calculate overall performance grade
  calculatePerformanceGrade(analysis) {
    const p95Score = Math.max(0, 100 - (analysis.p95OperationTime / 50) * 100);
    const hitRateScore = Math.min(100, (analysis.cacheHitRate / 80) * 100);
    const throughputScore = Math.min(100, (analysis.operationThroughput / 5000) * 100);
    const successRateScore = analysis.successfulConnections / this.concurrentConnections * 100;
    const overallScore = (p95Score + hitRateScore + throughputScore + successRateScore) / 4;

    if (overallScore >= 90) return 'A';
    if (overallScore >= 80) return 'B';
    if (overallScore >= 70) return 'C';
    if (overallScore >= 60) return 'D';
    return 'F';
  }
}

module.exports = RedisLoadTest;

// Export for direct execution
if (require.main === module) {
  const test = new RedisLoadTest({
    concurrentConnections: 50, // Reduced for demo
    operationsPerConnection: 20,
    testDuration: 60000 // 1 minute for demo
  });

  test.runConcurrentRedisTest()
    .then(results => {
      console.log('\nRedis load test completed successfully!');
      console.log('Report:', JSON.stringify(test.generateReport(results), null, 2));
    })
    .catch(error => {
      console.error('Redis load test failed:', error);
      process.exit(1);
    });
}