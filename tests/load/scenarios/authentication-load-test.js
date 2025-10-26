/**
 * Authentication Load Testing Scenario
 * Tests user registration, login, token refresh, and session management
 * Target: 200+ concurrent users with <500ms response times (95th percentile)
 */

const WebSocket = require('ws');
const fetch = require('node-fetch');
const { performance } = require('perf_hooks');

class AuthenticationLoadTest {
  constructor(config = {}) {
    this.baseURL = config.baseURL || 'http://localhost:3001';
    this.wsURL = config.wsURL || 'ws://localhost:3001';
    this.concurrentUsers = config.concurrentUsers || 200;
    this.rampUpTime = config.rampUpTime || 30000; // 30 seconds
    this.testDuration = config.testDuration || 300000; // 5 minutes
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      responseTimes: [],
      errors: [],
      usersCreated: 0,
      loginAttempts: 0,
      tokenRefreshes: 0
    };
  }

  // Generate unique test user data
  generateTestUser() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    return {
      email: `loadtest-${timestamp}-${random}@gui-lop-load.com`,
      password: 'LoadTest123!',
      firstName: 'Load',
      lastName: `Test${random}`,
      role: 'user'
    };
  }

  // Measure response time for a request
  async measureRequest(requestFunction) {
    const startTime = performance.now();
    this.metrics.totalRequests++;

    try {
      const result = await requestFunction();
      const endTime = performance.now();
      const responseTime = endTime - startTime;

      this.metrics.responseTimes.push(responseTime);
      this.metrics.successfulRequests++;

      return {
        ...result,
        responseTime,
        success: true
      };
    } catch (error) {
      const endTime = performance.now();
      const responseTime = endTime - startTime;

      this.metrics.responseTimes.push(responseTime);
      this.metrics.failedRequests++;
      this.metrics.errors.push({
        timestamp: new Date().toISOString(),
        error: error.message,
        responseTime,
        status: error.status || 'unknown'
      });

      throw error;
    }
  }

  // User registration test
  async testUserRegistration(userData) {
    return this.measureRequest(async () => {
      const response = await fetch(`${this.baseURL}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(userData)
      });

      if (!response.ok) {
        throw new Error(`Registration failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      this.metrics.usersCreated++;

      return {
        status: response.status,
        data,
        userCreated: true
      };
    });
  }

  // User login test
  async testUserLogin(email, password) {
    return this.measureRequest(async () => {
      const response = await fetch(`${this.baseURL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        throw new Error(`Login failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      this.metrics.loginAttempts++;

      return {
        status: response.status,
        data,
        token: data.token,
        refreshToken: data.refreshToken
      };
    });
  }

  // Token refresh test
  async testTokenRefresh(token, refreshToken) {
    return this.measureRequest(async () => {
      const response = await fetch(`${this.baseURL}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ refreshToken })
      });

      if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      this.metrics.tokenRefreshes++;

      return {
        status: response.status,
        data,
        newToken: data.token
      };
    });
  }

  // Simulate user session with periodic activity
  async simulateUserSession(userData) {
    const sessionMetrics = {
      startTime: performance.now(),
      requests: 0,
      errors: 0,
      maxResponseTime: 0,
      minResponseTime: Infinity
    };

    try {
      // Register user
      const registrationResult = await this.testUserRegistration(userData);
      sessionMetrics.requests++;

      // Login
      const loginResult = await this.testUserLogin(userData.email, userData.password);
      sessionMetrics.requests++;

      let currentToken = loginResult.token;
      let currentRefreshToken = loginResult.refreshToken;

      // Simulate user activity over time
      const sessionDuration = Math.min(this.testDuration, 60000); // Max 1 minute per user
      const activityInterval = 5000; // Activity every 5 seconds
      const endTime = Date.now() + sessionDuration;

      while (Date.now() < endTime) {
        await new Promise(resolve => setTimeout(resolve, activityInterval));

        try {
          // Refresh token periodically
          if (Math.random() < 0.3) { // 30% chance to refresh token
            const refreshResult = await this.testTokenRefresh(currentToken, currentRefreshToken);
            currentToken = refreshResult.newToken;
            sessionMetrics.requests++;
          }

          // Simulate API call with current token
          const apiResponse = await this.measureRequest(async () => {
            const response = await fetch(`${this.baseURL}/api/workflows/templates`, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${currentToken}`
              }
            });

            if (!response.ok) {
              throw new Error(`API call failed: ${response.status}`);
            }

            return response.json();
          });

          sessionMetrics.requests++;
          sessionMetrics.maxResponseTime = Math.max(sessionMetrics.maxResponseTime, apiResponse.responseTime);
          sessionMetrics.minResponseTime = Math.min(sessionMetrics.minResponseTime, apiResponse.responseTime);

        } catch (error) {
          sessionMetrics.errors++;
          console.warn(`User session error for ${userData.email}:`, error.message);
        }
      }

      sessionMetrics.endTime = performance.now();
      sessionMetrics.duration = sessionMetrics.endTime - sessionMetrics.startTime;

      return sessionMetrics;

    } catch (error) {
      sessionMetrics.errors++;
      sessionMetrics.endTime = performance.now();
      sessionMetrics.duration = sessionMetrics.endTime - sessionMetrics.startTime;
      throw error;
    }
  }

  // Run concurrent user simulation
  async runConcurrentUserTest() {
    console.log(`Starting authentication load test with ${this.concurrentUsers} concurrent users`);
    console.log(`Ramp up time: ${this.rampUpTime}ms, Test duration: ${this.testDuration}ms`);

    const startTime = performance.now();
    const users = [];

    // Ramp up users gradually
    const rampUpInterval = this.rampUpTime / this.concurrentUsers;
    let userCount = 0;

    const rampUpPromises = [];

    for (let i = 0; i < this.concurrentUsers; i++) {
      const rampUpDelay = i * rampUpInterval;

      const userPromise = new Promise(async (resolve) => {
        await new Promise(delay => setTimeout(delay, rampUpDelay));

        const userData = this.generateTestUser();
        try {
          const sessionResult = await this.simulateUserSession(userData);
          resolve({
            userId: userData.email,
            success: true,
            metrics: sessionResult
          });
        } catch (error) {
          resolve({
            userId: userData.email,
            success: false,
            error: error.message
          });
        }
      });

      rampUpPromises.push(userPromise);
    }

    // Wait for all users to complete
    const results = await Promise.all(rampUpPromises);
    const endTime = performance.now();
    const totalTestTime = endTime - startTime;

    // Analyze results
    const analysis = this.analyzeResults(results, totalTestTime);

    console.log('\n=== Authentication Load Test Results ===');
    console.log(`Total test time: ${(totalTestTime / 1000).toFixed(2)}s`);
    console.log(`Concurrent users: ${this.concurrentUsers}`);
    console.log(`Successful user sessions: ${analysis.successfulSessions}/${this.concurrentUsers}`);
    console.log(`Average response time: ${analysis.averageResponseTime.toFixed(2)}ms`);
    console.log(`95th percentile response time: ${analysis.p95ResponseTime.toFixed(2)}ms`);
    console.log(`99th percentile response time: ${analysis.p99ResponseTime.toFixed(2)}ms`);
    console.log(`Success rate: ${((analysis.successfulSessions / this.concurrentUsers) * 100).toFixed(2)}%`);
    console.log(`Total requests: ${this.metrics.totalRequests}`);
    console.log(`Failed requests: ${this.metrics.failedRequests}`);
    console.log(`Users created: ${this.metrics.usersCreated}`);
    console.log(`Login attempts: ${this.metrics.loginAttempts}`);
    console.log(`Token refreshes: ${this.metrics.tokenRefreshes}`);

    return analysis;
  }

  // Analyze test results
  analyzeResults(results, totalTestTime) {
    const successfulSessions = results.filter(r => r.success).length;
    const failedSessions = results.length - successfulSessions;

    // Calculate response time statistics
    const sortedResponseTimes = [...this.metrics.responseTimes].sort((a, b) => a - b);
    const totalResponseTime = this.metrics.responseTimes.reduce((sum, time) => sum + time, 0);

    const averageResponseTime = totalResponseTime / this.metrics.responseTimes.length;
    const p50ResponseTime = sortedResponseTimes[Math.floor(sortedResponseTimes.length * 0.5)];
    const p95ResponseTime = sortedResponseTimes[Math.floor(sortedResponseTimes.length * 0.95)];
    const p99ResponseTime = sortedResponseTimes[Math.floor(sortedResponseTimes.length * 0.99)];

    // Calculate requests per second
    const requestsPerSecond = (this.metrics.totalRequests / totalTestTime) * 1000;

    // Performance validation
    const performanceTargets = {
      p95Target: 500, // 500ms target for 95th percentile
      p99Target: 1000, // 1000ms target for 99th percentile
      successRateTarget: 0.95 // 95% success rate target
    };

    const performanceValidation = {
      p95Passed: p95ResponseTime <= performanceTargets.p95Target,
      p99Passed: p99ResponseTime <= performanceTargets.p99Target,
      successRatePassed: (successfulSessions / this.concurrentUsers) >= performanceTargets.successRateTarget,
      overallPassed: false
    };

    performanceValidation.overallPassed = performanceValidation.p95Passed &&
                                        performanceValidation.p99Passed &&
                                        performanceValidation.successRatePassed;

    return {
      totalTestTime,
      totalUsers: this.concurrentUsers,
      successfulSessions,
      failedSessions,
      totalRequests: this.metrics.totalRequests,
      successfulRequests: this.metrics.successfulRequests,
      failedRequests: this.metrics.failedRequests,
      averageResponseTime,
      p50ResponseTime,
      p95ResponseTime,
      p99ResponseTime,
      maxResponseTime: Math.max(...this.metrics.responseTimes),
      minResponseTime: Math.min(...this.metrics.responseTimes),
      requestsPerSecond,
      usersCreated: this.metrics.usersCreated,
      loginAttempts: this.metrics.loginAttempts,
      tokenRefreshes: this.metrics.tokenRefreshes,
      errors: this.metrics.errors,
      performanceValidation,
      performanceTargets,
      recommendations: this.generateRecommendations(performanceValidation, {
        p95ResponseTime,
        p99ResponseTime,
        successRate: successfulSessions / this.concurrentUsers
      })
    };
  }

  // Generate performance recommendations
  generateRecommendations(validation, metrics) {
    const recommendations = [];

    if (!validation.p95Passed) {
      recommendations.push({
        type: 'performance',
        priority: 'high',
        message: `95th percentile response time (${metrics.p95ResponseTime.toFixed(2)}ms) exceeds target (500ms). Consider optimizing database queries and implementing caching.`,
        metrics: {
          current: metrics.p95ResponseTime,
          target: 500,
          variance: metrics.p95ResponseTime - 500
        }
      });
    }

    if (!validation.p99Passed) {
      recommendations.push({
        type: 'performance',
        priority: 'medium',
        message: `99th percentile response time (${metrics.p99ResponseTime.toFixed(2)}ms) exceeds target (1000ms). Review slowest requests and optimize bottlenecks.`,
        metrics: {
          current: metrics.p99ResponseTime,
          target: 1000,
          variance: metrics.p99ResponseTime - 1000
        }
      });
    }

    if (!validation.successRatePassed) {
      recommendations.push({
        type: 'reliability',
        priority: 'high',
        message: `Success rate (${(metrics.successRate * 100).toFixed(2)}%) below target (95%). Address error handling and improve system stability.`,
        metrics: {
          current: metrics.successRate,
          target: 0.95,
          variance: 0.95 - metrics.successRate
        }
      });
    }

    if (validation.overallPassed) {
      recommendations.push({
        type: 'success',
        priority: 'info',
        message: 'All performance targets met. System is ready for production deployment with current load.',
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
      testType: 'Authentication Load Test',
      timestamp: new Date().toISOString(),
      configuration: {
        baseURL: this.baseURL,
        concurrentUsers: this.concurrentUsers,
        rampUpTime: this.rampUpTime,
        testDuration: this.testDuration
      },
      results: analysis,
      summary: {
        passed: analysis.performanceValidation.overallPassed,
        readyForProduction: analysis.performanceValidation.overallPassed && analysis.successfulSessions >= this.concurrentUsers * 0.95,
        bottlenecks: analysis.errors.length > 0 ? 'Yes' : 'No',
        performanceGrade: this.calculatePerformanceGrade(analysis)
      }
    };
  }

  // Calculate overall performance grade
  calculatePerformanceGrade(analysis) {
    const p95Score = Math.max(0, 100 - (analysis.p95ResponseTime / 500) * 100);
    const successRateScore = analysis.successfulSessions / this.concurrentUsers * 100;
    const overallScore = (p95Score + successRateScore) / 2;

    if (overallScore >= 90) return 'A';
    if (overallScore >= 80) return 'B';
    if (overallScore >= 70) return 'C';
    if (overallScore >= 60) return 'D';
    return 'F';
  }
}

module.exports = AuthenticationLoadTest;

// Export for direct execution
if (require.main === module) {
  const test = new AuthenticationLoadTest({
    concurrentUsers: 50, // Reduced for demo
    testDuration: 60000 // 1 minute for demo
  });

  test.runConcurrentUserTest()
    .then(results => {
      console.log('\nTest completed successfully!');
      console.log('Report:', JSON.stringify(test.generateReport(results), null, 2));
    })
    .catch(error => {
      console.error('Test failed:', error);
      process.exit(1);
    });
}