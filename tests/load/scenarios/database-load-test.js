/**
 * Database Performance Testing Under Concurrent Load
 * Tests PostgreSQL database performance with concurrent queries, transactions, and data operations
 * Target: 200+ concurrent database operations with <200ms query response times (95th percentile)
 */

const { Pool } = require('pg');
const { performance } = require('perf_hooks');
const { v4: uuidv4 } = require('uuid');

class DatabaseLoadTest {
  constructor(config = {}) {
    this.dbConfig = {
      host: config.dbHost || process.env.DB_HOST || 'localhost',
      port: config.dbPort || process.env.DB_PORT || 5432,
      database: config.database || process.env.DB_NAME || 'gui_lop',
      user: config.dbUser || process.env.DB_USER || 'postgres',
      password: config.dbPassword || process.env.DB_PASSWORD || 'password',
      max: config.maxConnections || 50,
      idleTimeoutMillis: config.idleTimeout || 30000,
      connectionTimeoutMillis: config.connectionTimeout || 2000,
    };

    this.concurrentConnections = config.concurrentConnections || 200;
    this.operationsPerConnection = config.operationsPerConnection || 50;
    this.testDuration = config.testDuration || 300000; // 5 minutes
    this.rampUpTime = config.rampUpTime || 30000;

    this.metrics = {
      totalQueries: 0,
      successfulQueries: 0,
      failedQueries: 0,
      queryTimes: [],
      connectionTimes: [],
      errors: [],
      operations: {
        select: 0,
        insert: 0,
        update: 0,
        delete: 0,
        transaction: 0
      },
      poolMetrics: {
        totalConnections: 0,
        activeConnections: 0,
        idleConnections: 0,
        waitingClients: 0
      }
    };

    // Initialize connection pool
    this.pool = new Pool(this.dbConfig);
  }

  // Initialize test database schema and data
  async initializeTestDatabase() {
    const client = await this.pool.connect();
    try {
      // Create test tables if they don't exist
      await client.query(`
        CREATE TABLE IF NOT EXISTS load_test_users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          email VARCHAR(255) UNIQUE NOT NULL,
          first_name VARCHAR(100) NOT NULL,
          last_name VARCHAR(100) NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          role VARCHAR(50) DEFAULT 'user',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          test_data JSONB
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS load_test_workflows (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES load_test_users(id),
          template VARCHAR(100) NOT NULL,
          context TEXT NOT NULL,
          status VARCHAR(50) DEFAULT 'created',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          executed_at TIMESTAMP,
          completed_at TIMESTAMP,
          test_data JSONB,
          INDEX idx_user_id (user_id),
          INDEX idx_status (status),
          INDEX idx_created_at (created_at)
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS load_test_sessions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES load_test_users(id),
          token_hash VARCHAR(255) NOT NULL,
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          test_data JSONB,
          INDEX idx_user_id (user_id),
          INDEX idx_token_hash (token_hash),
          INDEX idx_expires_at (expires_at)
        );
      `);

      // Create indexes for performance
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_load_test_users_email ON load_test_users(email);
        CREATE INDEX IF NOT EXISTS idx_load_test_workflows_user_status ON load_test_workflows(user_id, status);
        CREATE INDEX IF NOT EXISTS idx_load_test_sessions_expires ON load_test_sessions(expires_at);
      `);

      console.log('Test database initialized successfully');
    } finally {
      client.release();
    }
  }

  // Clean up test data
  async cleanupTestData() {
    const client = await this.pool.connect();
    try {
      await client.query('DELETE FROM load_test_sessions WHERE test_data IS NOT NULL');
      await client.query('DELETE FROM load_test_workflows WHERE test_data IS NOT NULL');
      await client.query('DELETE FROM load_test_users WHERE test_data IS NOT NULL');
      console.log('Test data cleaned up');
    } finally {
      client.release();
    }
  }

  // Generate test user data
  generateTestUserData(userId) {
    return {
      email: `db-load-${userId}-${Date.now()}@gui-lop-load.com`,
      firstName: `DBLoad${userId}`,
      lastName: `Test${Math.random().toString(36).substring(7)}`,
      passwordHash: '$2b$10$example.hash.for.load.test',
      role: 'user',
      testData: {
        testRun: Date.now(),
        userId,
        loadTest: true,
        metadata: {
          complexity: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)],
          priority: Math.floor(Math.random() * 10) + 1,
          estimatedLoad: Math.floor(Math.random() * 1000) + 100
        }
      }
    };
  }

  // Generate test workflow data
  generateTestWorkflowData(userId, workflowIndex) {
    const templates = ['data-analysis', 'decision-making', 'content-creation', 'system-administration'];
    const statuses = ['created', 'running', 'waiting_for_human', 'completed'];

    return {
      userId,
      template: templates[workflowIndex % templates.length],
      context: `Database load test workflow ${workflowIndex} for user ${userId}`,
      status: statuses[Math.floor(Math.random() * statuses.length)],
      testData: {
        testRun: Date.now(),
        workflowIndex,
        loadTest: true,
        metadata: {
          dataSize: Math.floor(Math.random() * 10000) + 1000,
          iterations: Math.floor(Math.random() * 100) + 10,
          estimatedDuration: Math.floor(Math.random() * 300) + 60
        }
      }
    };
  }

  // Execute query with performance measurement
  async executeQueryWithMetrics(queryFunction, operationType = 'unknown') {
    const startTime = performance.now();
    this.metrics.totalQueries++;

    try {
      const result = await queryFunction();
      const endTime = performance.now();
      const queryTime = endTime - startTime;

      this.metrics.queryTimes.push(queryTime);
      this.metrics.successfulQueries++;
      this.metrics.operations[operationType]++;

      return {
        ...result,
        queryTime,
        success: true,
        operationType,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      const endTime = performance.now();
      const queryTime = endTime - startTime;

      this.metrics.queryTimes.push(queryTime);
      this.metrics.failedQueries++;
      this.metrics.errors.push({
        timestamp: new Date().toISOString(),
        operationType,
        error: error.message,
        queryTime,
        severity: error.severity || 'error'
      });

      throw error;
    }
  }

  // Test user insert operations
  async testUserInsert(userData) {
    return this.executeQueryWithMetrics(async () => {
      const client = await this.pool.connect();
      try {
        const result = await client.query(
          `INSERT INTO load_test_users (email, first_name, last_name, password_hash, role, test_data)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, email, created_at`,
          [
            userData.email,
            userData.firstName,
            userData.lastName,
            userData.passwordHash,
            userData.role,
            JSON.stringify(userData.testData)
          ]
        );
        return result.rows[0];
      } finally {
        client.release();
      }
    }, 'insert');
  }

  // Test user select operations
  async testUserSelect(userId) {
    return this.executeQueryWithMetrics(async () => {
      const client = await this.pool.connect();
      try {
        const result = await client.query(
          `SELECT id, email, first_name, last_name, role, created_at, test_data
           FROM load_test_users
           WHERE test_data->>'userId' = $1
           ORDER BY created_at DESC
           LIMIT 10`,
          [userId]
        );
        return result.rows;
      } finally {
        client.release();
      }
    }, 'select');
  }

  // Test workflow insert operations
  async testWorkflowInsert(workflowData) {
    return this.executeQueryWithMetrics(async () => {
      const client = await this.pool.connect();
      try {
        const result = await client.query(
          `INSERT INTO load_test_workflows (user_id, template, context, status, test_data)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, template, status, created_at`,
          [
            workflowData.userId,
            workflowData.template,
            workflowData.context,
            workflowData.status,
            JSON.stringify(workflowData.testData)
          ]
        );
        return result.rows[0];
      } finally {
        client.release();
      }
    }, 'insert');
  }

  // Test complex workflow queries
  async testWorkflowComplexQuery(userId) {
    return this.executeQueryWithMetrics(async () => {
      const client = await this.pool.connect();
      try {
        const result = await client.query(
          `SELECT
              w.id, w.template, w.status, w.created_at, w.updated_at,
              u.email as user_email,
              COUNT(*) OVER() as total_count
           FROM load_test_workflows w
           JOIN load_test_users u ON w.user_id = u.id
           WHERE w.test_data->>'userId' = $1
             AND w.created_at > NOW() - INTERVAL '1 hour'
           ORDER BY w.created_at DESC
           LIMIT 20
           OFFSET 0`,
          [userId]
        );
        return result.rows;
      } finally {
        client.release();
      }
    }, 'select');
  }

  // Test update operations
  async testWorkflowUpdate(workflowId, statusUpdate) {
    return this.executeQueryWithMetrics(async () => {
      const client = await this.pool.connect();
      try {
        const result = await client.query(
          `UPDATE load_test_workflows
           SET status = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2
           RETURNING id, status, updated_at`,
          [statusUpdate, workflowId]
        );
        return result.rows[0];
      } finally {
        client.release();
      }
    }, 'update');
  }

  // Test transaction operations
  async testTransaction(userId, workflowData) {
    return this.executeQueryWithMetrics(async () => {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');

        // Insert user
        const userResult = await client.query(
          `INSERT INTO load_test_users (email, first_name, last_name, password_hash, role, test_data)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [
            workflowData.email,
            workflowData.firstName,
            workflowData.lastName,
            workflowData.passwordHash,
            workflowData.role,
            JSON.stringify(workflowData.testData)
          ]
        );

        const newUserId = userResult.rows[0].id;

        // Insert workflow
        const workflowResult = await client.query(
          `INSERT INTO load_test_workflows (user_id, template, context, status, test_data)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [
            newUserId,
            workflowData.template,
            workflowData.context,
            workflowData.status,
            JSON.stringify(workflowData.testData)
          ]
        );

        await client.query('COMMIT');

        return {
          userId: newUserId,
          workflowId: workflowResult.rows[0].id,
          transactionId: uuidv4()
        };

      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }, 'transaction');
  }

  // Test join query performance
  async testJoinQuery() {
    return this.executeQueryWithMetrics(async () => {
      const client = await this.pool.connect();
      try {
        const result = await client.query(
          `SELECT
              u.id as user_id,
              u.email,
              COUNT(w.id) as workflow_count,
              MAX(w.created_at) as last_workflow_date,
              AVG(CASE WHEN w.status = 'completed' THEN 1 ELSE 0 END) as completion_rate
           FROM load_test_users u
           LEFT JOIN load_test_workflows w ON u.id = w.user_id
           WHERE u.test_data IS NOT NULL
           GROUP BY u.id, u.email
           HAVING COUNT(w.id) > 0
           ORDER BY workflow_count DESC
           LIMIT 100`
        );
        return result.rows;
      } finally {
        client.release();
      }
    }, 'select');
  }

  // Simulate database connection load
  async simulateDatabaseLoad(connectionId) {
    const connectionMetrics = {
      connectionId,
      startTime: performance.now(),
      operationsCompleted: 0,
      operationsFailed: 0,
      totalQueryTime: 0,
      errors: []
    };

    try {
      // Record connection time
      const connectionStart = performance.now();
      const client = await this.pool.connect();
      const connectionTime = performance.now() - connectionStart;
      this.metrics.connectionTimes.push(connectionTime);

      // Perform various database operations
      for (let i = 0; i < this.operationsPerConnection; i++) {
        const userId = `${connectionId}-${i}`;
        const userData = this.generateTestUserData(userId);
        const workflowData = this.generateTestWorkflowData(userId, i);

        try {
          // Mix of different operations
          const operationType = i % 6;

          switch (operationType) {
            case 0: // Insert user
              await this.testUserInsert(userData);
              break;

            case 1: // Select user
              await this.testUserSelect(connectionId.toString());
              break;

            case 2: // Insert workflow
              await this.testWorkflowInsert(workflowData);
              break;

            case 3: // Complex query
              await this.testWorkflowComplexQuery(userId);
              break;

            case 4: // Update workflow
              if (i > 0) {
                const statuses = ['running', 'waiting_for_human', 'completed'];
                const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];
                await this.testWorkflowUpdate(uuidv4(), randomStatus);
              }
              break;

            case 5: // Join query
              await this.testJoinQuery();
              break;
          }

          connectionMetrics.operationsCompleted++;

        } catch (error) {
          connectionMetrics.operationsFailed++;
          connectionMetrics.errors.push(error.message);
        }

        // Small delay between operations
        await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
      }

      client.release();
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

  // Monitor connection pool metrics
  monitorPoolMetrics() {
    const poolStats = {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount
    };

    this.metrics.poolMetrics = {
      ...this.metrics.poolMetrics,
      ...poolStats
    };

    return poolStats;
  }

  // Run concurrent database load test
  async runConcurrentDatabaseTest() {
    console.log(`Starting database load test with ${this.concurrentConnections} concurrent connections`);
    console.log(`Operations per connection: ${this.operationsPerConnection}`);
    console.log(`Total expected operations: ${this.concurrentConnections * this.operationsPerConnection}`);

    // Initialize test database
    await this.initializeTestDatabase();

    const startTime = performance.now();
    const connectionPromises = [];
    const monitoringInterval = setInterval(() => {
      this.monitorPoolMetrics();
    }, 5000); // Monitor every 5 seconds

    // Ramp up connections gradually
    const rampUpInterval = this.rampUpTime / this.concurrentConnections;

    for (let i = 0; i < this.concurrentConnections; i++) {
      const delay = i * rampUpInterval;

      const connectionPromise = new Promise(async (resolve) => {
        await new Promise(r => setTimeout(r, delay));

        try {
          const result = await this.simulateDatabaseLoad(i);
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

      console.log('\n=== Database Load Test Results ===');
      console.log(`Total test time: ${(totalTestTime / 1000).toFixed(2)}s`);
      console.log(`Concurrent connections: ${this.concurrentConnections}`);
      console.log(`Successful connections: ${analysis.successfulConnections}/${this.concurrentConnections}`);
      console.log(`Total queries: ${this.metrics.totalQueries}`);
      console.log(`Successful queries: ${this.metrics.successfulQueries}`);
      console.log(`Failed queries: ${this.metrics.failedQueries}`);
      console.log(`Average query time: ${analysis.averageQueryTime.toFixed(2)}ms`);
      console.log(`95th percentile query time: ${analysis.p95QueryTime.toFixed(2)}ms`);
      console.log(`99th percentile query time: ${analysis.p99QueryTime.toFixed(2)}ms`);
      console.log(`Query throughput: ${analysis.queryThroughput.toFixed(2)} queries/second`);
      console.log(`Connection pool max: ${this.metrics.poolMetrics.totalConnections}`);

      return analysis;

    } finally {
      // Clean up test data
      await this.cleanupTestData();
    }
  }

  // Analyze test results
  analyzeResults(results, totalTestTime) {
    const successfulConnections = results.filter(r => r.success).length;
    const failedConnections = results.length - successfulConnections;

    // Calculate query time statistics
    const sortedQueryTimes = [...this.metrics.queryTimes].sort((a, b) => a - b);
    const totalQueryTime = this.metrics.queryTimes.reduce((sum, time) => sum + time, 0);

    const averageQueryTime = sortedQueryTimes.length > 0 ? totalQueryTime / sortedQueryTimes.length : 0;
    const p50QueryTime = sortedQueryTimes.length > 0 ? sortedQueryTimes[Math.floor(sortedQueryTimes.length * 0.5)] : 0;
    const p95QueryTime = sortedQueryTimes.length > 0 ? sortedQueryTimes[Math.floor(sortedQueryTimes.length * 0.95)] : 0;
    const p99QueryTime = sortedQueryTimes.length > 0 ? sortedQueryTimes[Math.floor(sortedQueryTimes.length * 0.99)] : 0;

    // Calculate throughput
    const queryThroughput = (this.metrics.successfulQueries / totalTestTime) * 1000;

    // Performance validation
    const performanceTargets = {
      p95QueryTimeTarget: 200, // 200ms for 95th percentile
      p99QueryTimeTarget: 500, // 500ms for 99th percentile
      connectionSuccessRateTarget: 0.95, // 95% connection success rate
      queryThroughputTarget: 1000 // 1000 queries per second
    };

    const performanceValidation = {
      p95QueryTimePassed: p95QueryTime <= performanceTargets.p95QueryTimeTarget,
      p99QueryTimePassed: p99QueryTime <= performanceTargets.p99QueryTimeTarget,
      connectionSuccessRatePassed: (successfulConnections / this.concurrentConnections) >= performanceTargets.connectionSuccessRateTarget,
      throughputPassed: queryThroughput >= performanceTargets.queryThroughputTarget,
      overallPassed: false
    };

    performanceValidation.overallPassed = performanceValidation.p95QueryTimePassed &&
                                        performanceValidation.p99QueryTimePassed &&
                                        performanceValidation.connectionSuccessRatePassed;

    return {
      totalTestTime,
      totalConnections: this.concurrentConnections,
      successfulConnections,
      failedConnections,
      totalQueries: this.metrics.totalQueries,
      successfulQueries: this.metrics.successfulQueries,
      failedQueries: this.metrics.failedQueries,
      averageQueryTime,
      p50QueryTime,
      p95QueryTime,
      p99QueryTime,
      maxQueryTime: sortedQueryTimes.length > 0 ? Math.max(...sortedQueryTimes) : 0,
      minQueryTime: sortedQueryTimes.length > 0 ? Math.min(...sortedQueryTimes) : 0,
      queryThroughput,
      operations: this.metrics.operations,
      poolMetrics: this.metrics.poolMetrics,
      errors: this.metrics.errors,
      performanceValidation,
      performanceTargets,
      recommendations: this.generateRecommendations(performanceValidation, {
        p95QueryTime,
        p99QueryTime,
        successRate: successfulConnections / this.concurrentConnections,
        queryThroughput
      })
    };
  }

  // Generate performance recommendations
  generateRecommendations(validation, metrics) {
    const recommendations = [];

    if (!validation.p95QueryTimePassed) {
      recommendations.push({
        type: 'query_performance',
        priority: 'high',
        message: `95th percentile query time (${metrics.p95QueryTime.toFixed(2)}ms) exceeds target (200ms). Consider query optimization and indexing.`,
        metrics: {
          current: metrics.p95QueryTime,
          target: 200,
          variance: metrics.p95QueryTime - 200
        }
      });
    }

    if (!validation.throughputPassed) {
      recommendations.push({
        type: 'throughput',
        priority: 'high',
        message: `Query throughput (${metrics.queryThroughput.toFixed(2)} queries/s) below target (1000 queries/s). Consider connection pool tuning and database optimization.`,
        metrics: {
          current: metrics.queryThroughput,
          target: 1000,
          variance: 1000 - metrics.queryThroughput
        }
      });
    }

    if (this.metrics.poolMetrics.totalConnections >= this.dbConfig.max * 0.9) {
      recommendations.push({
        type: 'connection_pool',
        priority: 'medium',
        message: `Connection pool near capacity (${this.metrics.poolMetrics.totalConnections}/${this.dbConfig.max}). Consider increasing pool size or optimizing connection usage.`,
        metrics: {
          currentConnections: this.metrics.poolMetrics.totalConnections,
          maxConnections: this.dbConfig.max,
          utilization: (this.metrics.poolMetrics.totalConnections / this.dbConfig.max) * 100
        }
      });
    }

    if (validation.overallPassed) {
      recommendations.push({
        type: 'success',
        priority: 'info',
        message: 'All database performance targets met. Database is performing well under concurrent load.',
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
      testType: 'Database Performance Load Test',
      timestamp: new Date().toISOString(),
      configuration: {
        dbConfig: {
          host: this.dbConfig.host,
          port: this.dbConfig.port,
          database: this.dbConfig.database,
          maxConnections: this.dbConfig.max
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
        databaseEfficiency: (this.metrics.successfulQueries / this.metrics.totalQueries) * 100
      }
    };
  }

  // Calculate overall performance grade
  calculatePerformanceGrade(analysis) {
    const p95Score = Math.max(0, 100 - (analysis.p95QueryTime / 200) * 100);
    const throughputScore = Math.min(100, (analysis.queryThroughput / 1000) * 100);
    const successRateScore = analysis.successfulConnections / this.concurrentConnections * 100;
    const overallScore = (p95Score + throughputScore + successRateScore) / 3;

    if (overallScore >= 90) return 'A';
    if (overallScore >= 80) return 'B';
    if (overallScore >= 70) return 'C';
    if (overallScore >= 60) return 'D';
    return 'F';
  }

  // Close database connections
  async close() {
    await this.pool.end();
  }
}

module.exports = DatabaseLoadTest;

// Export for direct execution
if (require.main === module) {
  const test = new DatabaseLoadTest({
    concurrentConnections: 20, // Reduced for demo
    operationsPerConnection: 10,
    testDuration: 60000 // 1 minute for demo
  });

  test.runConcurrentDatabaseTest()
    .then(results => {
      console.log('\nDatabase load test completed successfully!');
      console.log('Report:', JSON.stringify(test.generateReport(results), null, 2));
    })
    .catch(error => {
      console.error('Database load test failed:', error);
    })
    .finally(() => {
      test.close();
    });
}