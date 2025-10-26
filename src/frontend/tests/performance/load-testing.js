/**
 * Load testing utilities for GUI-LOP Frontend performance validation
 * Tests application behavior under heavy user load
 */

import { chromium } from 'playwright';

class PerformanceLoadTester {
  constructor(options = {}) {
    this.baseURL = options.baseURL || 'http://localhost:3001';
    this.concurrentUsers = options.concurrentUsers || 50;
    this.testDuration = options.testDuration || 60000; // 1 minute
    this.scenarios = options.scenarios || ['dashboard', 'workflows', 'events'];
    this.metrics = {
      responseTimes: [],
      errorRates: {},
      throughput: 0,
      resourceUsage: []
    };
  }

  // Simulate realistic user behavior
  async simulateUserBehavior(userId, browser) {
    const page = await browser.newPage();
    const startTime = Date.now();

    try {
      // Monitor resource usage
      const client = await page.context().newCDPSession(page);
      await client.send('Performance.enable');

      // Navigate to application
      const navigationStart = Date.now();
      await page.goto(this.baseURL, { waitUntil: 'networkidle' });
      const navigationTime = Date.now() - navigationStart;

      this.metrics.responseTimes.push({
        userId,
        action: 'navigation',
        time: navigationTime,
        timestamp: Date.now()
      });

      // Login if needed
      if (await page.locator('[data-testid="login-form"]').isVisible()) {
        await page.fill('[data-testid="email"]', `testuser${userId}@example.com`);
        await page.fill('[data-testid="password"]', 'testpassword123');
        await page.click('[data-testid="login-button"]');
        await page.waitForLoadState('networkidle');
      }

      // Test different scenarios
      for (const scenario of this.scenarios) {
        await this.runScenario(scenario, page, userId);
      }

      // Monitor memory usage
      const memoryMetrics = await client.send('Performance.getMetrics');
      this.metrics.resourceUsage.push({
        userId,
        timestamp: Date.now(),
        jsHeapSize: memoryMetrics.metrics.find(m => m.name === 'JSHeapUsedSize')?.value || 0,
        domNodes: memoryMetrics.metrics.find(m => m.name === 'Nodes')?.value || 0
      });

    } catch (error) {
      console.error(`User ${userId} encountered error:`, error);
      this.incrementErrorRate('user_error');
    } finally {
      const totalTime = Date.now() - startTime;
      await page.close();
      return totalTime;
    }
  }

  // Run specific test scenario
  async runScenario(scenario, page, userId) {
    const scenarioStart = Date.now();

    try {
      switch (scenario) {
        case 'dashboard':
          await this.testDashboard(page, userId);
          break;
        case 'workflows':
          await this.testWorkflows(page, userId);
          break;
        case 'events':
          await this.testEvents(page, userId);
          break;
        default:
          console.warn(`Unknown scenario: ${scenario}`);
      }

      const scenarioTime = Date.now() - scenarioStart;
      this.metrics.responseTimes.push({
        userId,
        action: scenario,
        time: scenarioTime,
        timestamp: Date.now()
      });

    } catch (error) {
      console.error(`Scenario ${scenario} failed for user ${userId}:`, error);
      this.incrementErrorRate(`${scenario}_error`);
    }
  }

  // Test dashboard performance
  async testDashboard(page, userId) {
    await page.click('[data-testid="nav-dashboard"]');
    await page.waitForLoadState('networkidle');

    // Measure dashboard render time
    const renderStart = Date.now();
    await page.waitForSelector('[data-testid="dashboard-stats"]', { timeout: 5000 });
    const renderTime = Date.now() - renderStart;

    // Test quick actions
    if (await page.locator('[data-testid="quick-action-btn"]').first().isVisible()) {
      await page.click('[data-testid="quick-action-btn"]');
      await page.waitForTimeout(1000); // Allow for interaction
    }
  }

  // Test workflows performance
  async testWorkflows(page, userId) {
    await page.click('[data-testid="nav-workflows"]');
    await page.waitForLoadState('networkidle');

    // Test virtual scrolling with large dataset
    const listContainer = page.locator('[data-testid="workflows-list"]');
    if (await listContainer.isVisible()) {
      // Scroll through list
      for (let i = 0; i < 5; i++) {
        await listContainer.evaluate((el) => el.scrollTop += 500);
        await page.waitForTimeout(200);
      }
    }

    // Test search functionality
    const searchInput = page.locator('[data-testid="workflow-search"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill('test workflow');
      await page.waitForTimeout(500);
    }
  }

  // Test events performance
  async testEvents(page, userId) {
    await page.click('[data-testid="nav-events"]');
    await page.waitForLoadState('networkidle');

    // Test log scrolling
    const logsContainer = page.locator('[data-testid="logs-container"]');
    if (await logsContainer.isVisible()) {
      // Scroll to bottom
      await logsContainer.evaluate((el) => el.scrollTop = el.scrollHeight);
      await page.waitForTimeout(500);
    }

    // Test log filtering
    const filterSelect = page.locator('[data-testid="log-filter"]');
    if (await filterSelect.isVisible()) {
      await filterSelect.selectOption('error');
      await page.waitForTimeout(500);
    }
  }

  // Increment error rate tracking
  incrementErrorRate(errorType) {
    if (!this.metrics.errorRates[errorType]) {
      this.metrics.errorRates[errorType] = 0;
    }
    this.metrics.errorRates[errorType]++;
  }

  // Calculate performance statistics
  calculateStatistics() {
    const responseTimes = this.metrics.responseTimes;

    return {
      responseTime: {
        average: responseTimes.reduce((sum, r) => sum + r.time, 0) / responseTimes.length,
        median: this.calculateMedian(responseTimes.map(r => r.time)),
        p95: this.calculatePercentile(responseTimes.map(r => r.time), 95),
        p99: this.calculatePercentile(responseTimes.map(r => r.time), 99)
      },
      errorRate: {
        total: Object.values(this.metrics.errorRates).reduce((sum, count) => sum + count, 0),
        byType: this.metrics.errorRates
      },
      throughput: responseTimes.length / (this.testDuration / 1000), // requests per second
      resourceUsage: {
        averageMemory: this.metrics.resourceUsage.reduce((sum, r) => sum + r.jsHeapSize, 0) / this.metrics.resourceUsage.length,
        peakMemory: Math.max(...this.metrics.resourceUsage.map(r => r.jsHeapSize)),
        averageDOMNodes: this.metrics.resourceUsage.reduce((sum, r) => sum + r.domNodes, 0) / this.metrics.resourceUsage.length
      }
    };
  }

  // Calculate median value
  calculateMedian(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  // Calculate percentile
  calculatePercentile(values, percentile) {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  // Run load test
  async runLoadTest() {
    console.log(`Starting load test with ${this.concurrentUsers} concurrent users for ${this.testDuration}ms`);

    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });

    const startTime = Date.now();
    const userPromises = [];

    // Launch concurrent users
    for (let i = 0; i < this.concurrentUsers; i++) {
      userPromises.push(
        this.simulateUserBehavior(i + 1, browser)
          .then(time => ({ userId: i + 1, totalTime: time }))
          .catch(error => ({ userId: i + 1, error: error.message }))
      );

      // Stagger user starts to simulate realistic load
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Wait for all users to complete
    const results = await Promise.all(userPromises);
    const totalTime = Date.now() - startTime;

    await browser.close();

    const statistics = this.calculateStatistics();

    return {
      testConfig: {
        concurrentUsers: this.concurrentUsers,
        testDuration: this.testDuration,
        scenarios: this.scenarios,
        actualDuration: totalTime
      },
      userResults: results,
      statistics
    };
  }

  // Generate performance report
  generateReport(testResults) {
    const { testConfig, userResults, statistics } = testResults;

    const successfulUsers = userResults.filter(r => !r.error).length;
    const failedUsers = userResults.filter(r => r.error).length;

    return {
      summary: {
        totalUsers: testConfig.concurrentUsers,
        successfulUsers,
        failedUsers,
        successRate: (successfulUsers / testConfig.concurrentUsers * 100).toFixed(2) + '%',
        testDuration: `${(testConfig.actualDuration / 1000).toFixed(2)}s`
      },
      performance: {
        responseTime: {
          average: `${statistics.responseTime.average.toFixed(2)}ms`,
          median: `${statistics.responseTime.median.toFixed(2)}ms`,
          p95: `${statistics.responseTime.p95.toFixed(2)}ms`,
          p99: `${statistics.responseTime.p99.toFixed(2)}ms`
        },
        throughput: `${statistics.throughput.toFixed(2)} requests/second`,
        errorRate: {
          total: statistics.errorRate.total,
          byType: statistics.errorRate.byType
        }
      },
      resources: {
        averageMemory: `${(statistics.resourceUsage.averageMemory / 1024 / 1024).toFixed(2)}MB`,
        peakMemory: `${(statistics.resourceUsage.peakMemory / 1024 / 1024).toFixed(2)}MB`,
        averageDOMNodes: Math.round(statistics.resourceUsage.averageDOMNodes)
      },
      recommendations: this.generateRecommendations(statistics)
    };
  }

  // Generate performance recommendations
  generateRecommendations(statistics) {
    const recommendations = [];

    if (statistics.responseTime.average > 1000) {
      recommendations.push('Consider implementing additional optimizations to reduce average response time');
    }

    if (statistics.responseTime.p95 > 3000) {
      recommendations.push('Some users experience slow response times - investigate performance bottlenecks');
    }

    if (statistics.errorRate.total > testConfig.concurrentUsers * 0.05) {
      recommendations.push('High error rate detected - improve error handling and application stability');
    }

    if (statistics.resourceUsage.peakMemory > 100 * 1024 * 1024) { // 100MB
      recommendations.push('Memory usage is high - implement better memory management and cleanup');
    }

    if (statistics.throughput < 10) {
      recommendations.push('Low throughput detected - optimize application performance');
    }

    if (recommendations.length === 0) {
      recommendations.push('Performance metrics are within acceptable ranges');
    }

    return recommendations;
  }
}

// Export for use in tests
export default PerformanceLoadTester;

// Example usage
if (require.main === module) {
  const tester = new PerformanceLoadTester({
    baseURL: 'http://localhost:3001',
    concurrentUsers: 20,
    testDuration: 30000,
    scenarios: ['dashboard', 'workflows', 'events']
  });

  tester.runLoadTest()
    .then(results => {
      const report = tester.generateReport(results);
      console.log('Load Test Results:');
      console.log(JSON.stringify(report, null, 2));
    })
    .catch(error => {
      console.error('Load test failed:', error);
      process.exit(1);
    });
}