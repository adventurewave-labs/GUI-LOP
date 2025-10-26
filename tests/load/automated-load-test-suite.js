/**
 * Automated Load Testing Suite
 * Orchestrates all load testing scenarios with configurable parameters
 * and generates comprehensive reports
 */

const path = require('path');
const { performance } = require('perf_hooks');

// Import individual test scenarios
const AuthenticationLoadTest = require('./scenarios/authentication-load-test');
const WorkflowLoadTest = require('./scenarios/workflow-load-test');
const WebSocketLoadTest = require('./scenarios/websocket-load-test');
const DatabaseLoadTest = require('./scenarios/database-load-test');
const RedisLoadTest = require('./scenarios/redis-load-test');

// Import utilities and monitoring
const LoadTestUtils = require('./utils/load-test-utils');
const PerformanceMonitor = require('./monitoring/performance-monitor');

class AutomatedLoadTestSuite {
  constructor(config = {}) {
    this.config = {
      // Test suite configuration
      testSuiteName: config.testSuiteName || 'GUI-LOP Load Test Suite',
      outputDirectory: config.outputDirectory || './tests/load/reports',
      enableMonitoring: config.enableMonitoring !== false,
      enableHTMLReports: config.enableHTMLReports !== false,
      enableCSVExport: config.enableCSVExport !== false,

      // Test execution configuration
      parallelExecution: config.parallelExecution || false,
      continueOnFailure: config.continueOnFailure || false,
      cleanupAfterTest: config.cleanupAfterTest !== false,

      // Target load configuration
      targetConcurrentUsers: config.targetConcurrentUsers || 200,
      targetResponseTime: config.targetResponseTime || 500, // 95th percentile in ms
      targetSuccessRate: config.targetSuccessRate || 0.95, // 95%
      targetThroughput: config.targetThroughput || 100, // requests per second

      // Test scenarios to run
      testScenarios: config.testScenarios || [
        'authentication',
        'workflows',
        'websocket',
        'database',
        'redis'
      ],

      // Individual test configurations
      testConfigurations: {
        authentication: {
          concurrentUsers: config.authenticationUsers || 50,
          testDuration: config.authenticationDuration || 60000,
          rampUpTime: config.authenticationRampUpTime || 15000
        },
        workflows: {
          concurrentUsers: config.workflowUsers || 30,
          workflowsPerUser: config.workflowsPerUser || 5,
          testDuration: config.workflowDuration || 120000,
          rampUpTime: config.workflowRampUpTime || 20000
        },
        websocket: {
          concurrentConnections: config.websocketConnections || 100,
          messagesPerConnection: config.messagesPerConnection || 20,
          testDuration: config.websocketDuration || 90000,
          rampUpTime: config.websocketRampUpTime || 15000
        },
        database: {
          concurrentConnections: config.databaseConnections || 40,
          operationsPerConnection: config.databaseOperations || 25,
          testDuration: config.databaseDuration || 120000,
          rampUpTime: config.databaseRampUpTime || 20000
        },
        redis: {
          concurrentConnections: config.redisConnections || 80,
          operationsPerConnection: config.redisOperations || 50,
          testDuration: config.redisDuration || 60000,
          rampUpTime: config.redisRampUpTime || 15000
        }
      },

      // Performance thresholds
      performanceThresholds: {
        authentication: {
          p95ResponseTime: config.authP95ResponseTime || 500,
          p99ResponseTime: config.authP99ResponseTime || 1000,
          successRate: config.authSuccessRate || 0.95
        },
        workflows: {
          p95ResponseTime: config.workflowP95ResponseTime || 500,
          p99ResponseTime: config.workflowP99ResponseTime || 1000,
          successRate: config.workflowSuccessRate || 0.95,
          throughput: config.workflowThroughput || 10
        },
        websocket: {
          p95Latency: config.websocketP95Latency || 100,
          p99Latency: config.websocketP99Latency || 200,
          connectionSuccessRate: config.websocketSuccessRate || 0.95
        },
        database: {
          p95QueryTime: config.databaseP95QueryTime || 200,
          p99QueryTime: config.databaseP99QueryTime || 500,
          successRate: config.databaseSuccessRate || 0.95
        },
        redis: {
          p95OperationTime: config.redisP95OperationTime || 50,
          p99OperationTime: config.redisP99OperationTime || 100,
          successRate: config.redisSuccessRate || 0.95,
          cacheHitRate: config.redisCacheHitRate || 0.80
        }
      }
    };

    this.utils = new LoadTestUtils();
    this.monitor = null;
    this.testResults = new Map();
    this.suiteStartTime = null;
    this.suiteEndTime = null;
  }

  // Initialize the test suite
  async initialize() {
    console.log(`\n🚀 Initializing ${this.config.testSuiteName}`);
    console.log(`Target: ${this.config.targetConcurrentUsers} concurrent users`);
    console.log(`Performance targets: <${this.config.targetResponseTime}ms response time, ${this.config.targetSuccessRate * 100}% success rate`);

    // Create output directory
    await this.utils.createTestConfig('load-test-suite', {
      outputDirectory: this.config.outputDirectory,
      testScenarios: this.config.testScenarios,
      targetConcurrentUsers: this.config.targetConcurrentUsers
    });

    // Initialize performance monitor
    if (this.config.enableMonitoring) {
      this.monitor = new PerformanceMonitor({
        metricsOutputPath: path.join(this.config.outputDirectory, 'metrics'),
        enableRealTimeAlerts: true,
        alertThresholds: {
          cpuUsage: 85,
          memoryUsage: 85,
          responseTime: this.config.targetResponseTime * 2, // Allow 2x target for alerts
          errorRate: 10
        }
      });

      console.log('Performance monitoring enabled');
    }

    console.log('✅ Test suite initialized successfully\n');
  }

  // Run the complete test suite
  async runTestSuite() {
    this.suiteStartTime = Date.now();

    try {
      await this.initialize();

      console.log('📊 Starting load test suite execution...\n');

      // Start performance monitoring
      if (this.monitor) {
        this.monitor.startMonitoring();
      }

      // Run each test scenario
      const testPromises = [];
      const testExecutionOrder = [];

      for (const scenario of this.config.testScenarios) {
        if (this.config.testConfigurations[scenario]) {
          if (this.config.parallelExecution) {
            // Run tests in parallel
            testPromises.push(this.runTestScenario(scenario));
          } else {
            // Run tests sequentially
            await this.runTestScenario(scenario);
          }
          testExecutionOrder.push(scenario);
        }
      }

      // Wait for parallel tests to complete
      if (this.config.parallelExecution && testPromises.length > 0) {
        await Promise.all(testPromises);
      }

      this.suiteEndTime = Date.now();

      // Generate comprehensive report
      const suiteReport = await this.generateSuiteReport();

      console.log('\n🎉 Load test suite completed successfully!');
      console.log(`Total duration: ${this.utils.formatDuration(this.suiteEndTime - this.suiteStartTime)}`);

      return suiteReport;

    } catch (error) {
      this.suiteEndTime = Date.now();
      console.error('\n❌ Load test suite failed:', error);

      if (!this.config.continueOnFailure) {
        throw error;
      }

      // Generate partial report even on failure
      return await this.generateSuiteReport(true);
    } finally {
      // Stop performance monitoring
      if (this.monitor) {
        const monitoringSummary = this.monitor.stopMonitoring();
        if (monitoringSummary) {
          this.testResults.set('performance-monitoring', monitoringSummary);
        }
      }

      // Cleanup if enabled
      if (this.config.cleanupAfterTest) {
        await this.cleanup();
      }
    }
  }

  // Run individual test scenario
  async runTestScenario(scenarioName) {
    console.log(`\n🔄 Running ${scenarioName} load test...`);
    const scenarioStartTime = Date.now();

    try {
      let testInstance;
      let testConfig = this.config.testConfigurations[scenarioName];
      let thresholds = this.config.performanceThresholds[scenarioName];

      switch (scenarioName) {
        case 'authentication':
          testInstance = new AuthenticationLoadTest(testConfig);
          break;

        case 'workflows':
          testInstance = new WorkflowLoadTest(testConfig);
          break;

        case 'websocket':
          testInstance = new WebSocketLoadTest(testConfig);
          break;

        case 'database':
          testInstance = new DatabaseLoadTest(testConfig);
          break;

        case 'redis':
          testInstance = new RedisLoadTest(testConfig);
          break;

        default:
          throw new Error(`Unknown test scenario: ${scenarioName}`);
      }

      // Run the test
      let results;
      switch (scenarioName) {
        case 'authentication':
          results = await testInstance.runConcurrentUserTest();
          break;
        case 'workflows':
          results = await testInstance.runConcurrentWorkflowTest();
          break;
        case 'websocket':
          results = await testInstance.runConcurrentWebSocketTest(0.7); // 70% authenticated
          break;
        case 'database':
          results = await testInstance.runConcurrentDatabaseTest();
          break;
        case 'redis':
          results = await testInstance.runConcurrentRedisTest();
          break;
      }

      // Validate results against thresholds
      const validation = this.validateTestResults(results, thresholds, scenarioName);

      // Generate scenario report
      const scenarioReport = {
        scenarioName,
        startTime: scenarioStartTime,
        endTime: Date.now(),
        duration: Date.now() - scenarioStartTime,
        configuration: testConfig,
        results,
        validation,
        report: testInstance.generateReport(results)
      };

      // Store results
      this.testResults.set(scenarioName, scenarioReport);

      // Save individual test results
      await this.utils.saveTestResults(
        `${scenarioName}-${scenarioStartTime}`,
        scenarioReport,
        this.config.outputDirectory
      );

      console.log(`✅ ${scenarioName} test completed in ${this.utils.formatDuration(Date.now() - scenarioStartTime)}`);
      console.log(`   Success rate: ${validation.successRate}%`);
      console.log(`   Performance grade: ${validation.grade.grade} (${validation.grade.description})`);

      if (!validation.passed) {
        console.log(`   ⚠️  Performance thresholds not met`);
      }

      return scenarioReport;

    } catch (error) {
      const errorReport = {
        scenarioName,
        startTime: scenarioStartTime,
        endTime: Date.now(),
        duration: Date.now() - scenarioStartTime,
        error: error.message,
        stack: error.stack
      };

      this.testResults.set(scenarioName, errorReport);
      console.error(`❌ ${scenarioName} test failed:`, error.message);

      if (!this.config.continueOnFailure) {
        throw error;
      }

      return errorReport;
    }
  }

  // Validate test results against performance thresholds
  validateTestResults(results, thresholds, scenarioName) {
    if (!results || !thresholds) {
      return {
        passed: false,
        successRate: 0,
        grade: this.utils.generatePerformanceGrade(0),
        violations: ['No results or thresholds provided']
      };
    }

    const metrics = {};
    const violations = [];

    // Map results to metrics for validation
    switch (scenarioName) {
      case 'authentication':
      case 'workflows':
        metrics.p95ResponseTime = results.p95ResponseTime || 0;
        metrics.p99ResponseTime = results.p99ResponseTime || 0;
        metrics.successRate = (results.successfulSessions / results.totalUsers) || 0;
        if (scenarioName === 'workflows') {
          metrics.throughput = results.workflowThroughput || 0;
        }
        break;

      case 'websocket':
        metrics.p95Latency = results.p95MessageLatency || 0;
        metrics.p99Latency = results.p99MessageLatency || 0;
        metrics.connectionSuccessRate = (results.successfulConnections / results.totalConnections) || 0;
        break;

      case 'database':
        metrics.p95QueryTime = results.p95QueryTime || 0;
        metrics.p99QueryTime = results.p99QueryTime || 0;
        metrics.successRate = (results.successfulConnections / results.totalConnections) || 0;
        break;

      case 'redis':
        metrics.p95OperationTime = results.p95OperationTime || 0;
        metrics.p99OperationTime = results.p99OperationTime || 0;
        metrics.successRate = (results.successfulConnections / results.totalConnections) || 0;
        metrics.cacheHitRate = results.cacheHitRate || 0;
        break;
    }

    // Validate each metric
    for (const [metric, value] of Object.entries(metrics)) {
      const threshold = thresholds[metric];
      if (threshold !== undefined) {
        const passed = this.validateMetric(metric, value, threshold);
        if (!passed) {
          violations.push({
            metric,
            actual: value,
            threshold,
            severity: 'high'
          });
        }
      }
    }

    const overallPassed = violations.length === 0;
    const successRate = Math.round((results.successfulRequests / results.totalRequests) * 100) || 0;
    const grade = this.utils.generatePerformanceGrade(overallPassed ? 85 : 50);

    return {
      passed: overallPassed,
      successRate,
      grade,
      violations,
      metrics
    };
  }

  // Validate individual metric against threshold
  validateMetric(metric, value, threshold) {
    if (typeof threshold === 'number') {
      return value <= threshold;
    } else if (typeof threshold === 'object' && threshold.min !== undefined && threshold.max !== undefined) {
      return value >= threshold.min && value <= threshold.max;
    } else if (typeof threshold === 'object' && threshold.min !== undefined) {
      return value >= threshold.min;
    } else if (typeof threshold === 'object' && threshold.max !== undefined) {
      return value <= threshold.max;
    }
    return true;
  }

  // Generate comprehensive suite report
  async generateSuiteReport(hasErrors = false) {
    console.log('\n📈 Generating comprehensive test suite report...');

    const totalDuration = this.suiteEndTime - this.suiteStartTime;
    const successfulTests = Array.from(this.testResults.values()).filter(result => !result.error).length;
    const totalTests = this.testResults.size;

    // Calculate overall metrics
    const overallMetrics = this.calculateOverallMetrics();
    const overallValidation = this.validateOverallPerformance(overallMetrics);

    // Generate suite report
    const suiteReport = {
      suiteName: this.config.testSuiteName,
      timestamp: new Date().toISOString(),
      configuration: this.config,
      execution: {
        startTime: this.suiteStartTime,
        endTime: this.suiteEndTime,
        totalDuration,
        successfulTests,
        totalTests,
        hasErrors
      },
      results: Object.fromEntries(this.testResults),
      overallMetrics,
      overallValidation,
      recommendations: this.generateSuiteRecommendations(overallValidation, overallMetrics),
      summary: {
        readyForProduction: overallValidation.overallPassed && successfulTests === totalTests,
        performanceGrade: overallValidation.grade,
        bottlenecks: this.identifyBottlenecks(),
        keyMetrics: {
          totalRequests: overallMetrics.totalRequests,
          averageResponseTime: overallMetrics.averageResponseTime,
          successRate: overallMetrics.successRate,
          peakConcurrentUsers: this.config.targetConcurrentUsers
        }
      }
    };

    // Save suite report
    const reportPath = await this.utils.saveTestResults(
      `load-test-suite-${this.suiteStartTime}`,
      suiteReport,
      this.config.outputDirectory
    );

    // Generate HTML report
    if (this.config.enableHTMLReports) {
      await this.utils.createHTMLReport(suiteReport, this.config.outputDirectory);
    }

    // Export CSV data
    if (this.config.enableCSVExport) {
      await this.exportSuiteMetricsToCSV(overallMetrics);
    }

    console.log(`📊 Suite report generated: ${reportPath}`);
    return suiteReport;
  }

  // Calculate overall metrics across all tests
  calculateOverallMetrics() {
    const allResults = Array.from(this.testResults.values()).filter(result => !result.error);

    let totalRequests = 0;
    let successfulRequests = 0;
    let totalResponseTime = 0;
    let responseTimeCount = 0;
    const allResponseTimes = [];

    allResults.forEach(result => {
      if (result.results) {
        totalRequests += result.results.totalRequests || 0;
        successfulRequests += result.results.successfulRequests || 0;

        if (result.results.averageResponseTime) {
          totalResponseTime += result.results.averageResponseTime;
          responseTimeCount++;
        }

        if (result.results.p95ResponseTime) {
          allResponseTimes.push(result.results.p95ResponseTime);
        }
      }
    });

    const averageResponseTime = responseTimeCount > 0 ? totalResponseTime / responseTimeCount : 0;
    const successRate = totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 0;
    const overallP95ResponseTime = allResponseTimes.length > 0 ?
      Math.max(...allResponseTimes) : 0;

    return {
      totalRequests,
      successfulRequests,
      failedRequests: totalRequests - successfulRequests,
      averageResponseTime,
      p95ResponseTime: overallP95ResponseTime,
      successRate,
      testCount: allResults.length
    };
  }

  // Validate overall performance against targets
  validateOverallPerformance(metrics) {
    const validation = {
      overallPassed: true,
      violations: [],
      grade: { grade: 'A', color: 'green', description: 'Excellent' },
      score: 100
    };

    // Check response time target
    if (metrics.p95ResponseTime > this.config.targetResponseTime) {
      validation.overallPassed = false;
      validation.violations.push({
        type: 'response_time',
        actual: metrics.p95ResponseTime,
        target: this.config.targetResponseTime,
        severity: 'high'
      });
      validation.score -= 30;
    }

    // Check success rate target
    if (metrics.successRate < (this.config.targetSuccessRate * 100)) {
      validation.overallPassed = false;
      validation.violations.push({
        type: 'success_rate',
        actual: metrics.successRate,
        target: this.config.targetSuccessRate * 100,
        severity: 'critical'
      });
      validation.score -= 40;
    }

    validation.grade = this.utils.generatePerformanceGrade(validation.score);
    return validation;
  }

  // Generate suite-level recommendations
  generateSuiteRecommendations(validation, metrics) {
    const recommendations = [];

    if (validation.violations.length > 0) {
      validation.violations.forEach(violation => {
        switch (violation.type) {
          case 'response_time':
            recommendations.push({
              category: 'Performance',
              priority: 'High',
              description: `Response time (${violation.actual.toFixed(2)}ms) exceeds target (${violation.target}ms). Consider optimizing database queries, implementing caching, or scaling resources.`,
              action: 'Optimize performance-critical paths and implement caching strategies'
            });
            break;

          case 'success_rate':
            recommendations.push({
              category: 'Reliability',
              priority: 'Critical',
              description: `Success rate (${violation.actual.toFixed(2)}%) below target (${violation.target}%). Address error handling and system stability issues.`,
              action: 'Improve error handling, add retry logic, and investigate failure patterns'
            });
            break;

          case 'throughput':
            recommendations.push({
              category: 'Scalability',
              priority: 'High',
              description: `Throughput below target. Consider horizontal scaling and load balancing.`,
              action: 'Implement load balancing and consider auto-scaling solutions'
            });
            break;
        }
      });
    } else {
      recommendations.push({
        category: 'Success',
        priority: 'Info',
        description: 'All performance targets met. System is ready for production deployment with current load patterns.',
        action: 'Monitor performance in production and set up alerting for anomalies'
      });
    }

    // Add general recommendations
    recommendations.push({
      category: 'Monitoring',
      priority: 'Medium',
      description: 'Implement comprehensive monitoring and alerting for production environment.',
      action: 'Set up APM tools and establish performance baselines'
    });

    recommendations.push({
      category: 'Capacity Planning',
      priority: 'Medium',
      description: 'Plan for future growth based on current performance characteristics.',
      action: 'Document scaling thresholds and create capacity planning roadmap'
    });

    return recommendations;
  }

  // Identify system bottlenecks
  identifyBottlenecks() {
    const bottlenecks = [];
    const allResults = Array.from(this.testResults.values()).filter(result => !result.error);

    allResults.forEach(result => {
      if (result.results && result.results.errors && result.results.errors.length > 0) {
        const errorTypes = {};
        result.results.errors.forEach(error => {
          const errorType = error.type || 'unknown';
          errorTypes[errorType] = (errorTypes[errorType] || 0) + 1;
        });

        Object.entries(errorTypes).forEach(([type, count]) => {
          bottlenecks.push({
            component: result.scenarioName,
            type: 'error_pattern',
            description: `${count} ${type} errors in ${result.scenarioName}`,
            severity: count > 10 ? 'high' : 'medium'
          });
        });
      }
    });

    return bottlenecks;
  }

  // Export suite metrics to CSV
  async exportSuiteMetricsToCSV(metrics) {
    try {
      const csvContent = [
        'Metric,Value,Unit,Status',
        `Total Requests,${metrics.totalRequests},count,`,
        `Successful Requests,${metrics.successfulRequests},count,${metrics.successfulRequests === metrics.totalRequests ? '✓' : '✗'}`,
        `Failed Requests,${metrics.failedRequests},count,${metrics.failedRequests === 0 ? '✓' : '✗'}`,
        `Success Rate,${metrics.successRate.toFixed(2)},%,${metrics.successRate >= 95 ? '✓' : '✗'}`,
        `Average Response Time,${metrics.averageResponseTime.toFixed(2)},ms,${metrics.averageResponseTime <= 500 ? '✓' : '✗'}`,
        `95th Percentile Response Time,${metrics.p95ResponseTime.toFixed(2)},ms,${metrics.p95ResponseTime <= 500 ? '✓' : '✗'}`,
        `Test Count,${metrics.testCount},count,`
      ].join('\n');

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `suite-metrics-${timestamp}.csv`;
      const filepath = path.join(this.config.outputDirectory, filename);

      await require('fs').promises.writeFile(filepath, csvContent);
      console.log(`📊 Suite metrics exported to CSV: ${filepath}`);

      return filepath;
    } catch (error) {
      console.error('Failed to export suite metrics to CSV:', error);
    }
  }

  // Cleanup resources
  async cleanup() {
    console.log('\n🧹 Cleaning up test resources...');

    // Close database connections, etc.
    // This would be implemented based on specific test requirements

    console.log('✅ Cleanup completed');
  }

  // Quick health check before running tests
  async healthCheck() {
    console.log('🔍 Performing pre-test health check...');

    const health = {
      system: {
        memory: process.memoryUsage(),
        uptime: process.uptime()
      },
      dependencies: {
        database: 'unknown', // Would check actual DB connection
        redis: 'unknown',    // Would check actual Redis connection
        websocket: 'unknown' // Would check WebSocket server
      }
    };

    // Basic system checks
    const memoryUsage = process.memoryUsage();
    const memoryUsageMB = memoryUsage.heapUsed / 1024 / 1024;

    if (memoryUsageMB > 500) {
      console.warn(`⚠️ High memory usage: ${memoryUsageMB.toFixed(2)}MB`);
    }

    console.log('✅ Health check completed');
    return health;
  }
}

module.exports = AutomatedLoadTestSuite;

// Export for direct execution
if (require.main === module) {
  const suite = new AutomatedLoadTestSuite({
    targetConcurrentUsers: 100, // Reduced for demo
    testScenarios: ['authentication', 'workflows'], // Limited scenarios for demo
    parallelExecution: false,
    enableHTMLReports: true,
    enableCSVExport: true
  });

  suite.runTestSuite()
    .then(results => {
      console.log('\n🎊 Load test suite completed successfully!');
      console.log(`Overall grade: ${results.overallValidation.grade.grade}`);
      console.log(`Ready for production: ${results.summary.readyForProduction ? 'Yes ✅' : 'No ❌'}`);
    })
    .catch(error => {
      console.error('\n💥 Load test suite failed:', error);
      process.exit(1);
    });
}