/**
 * Workflow CRUD Operations Load Testing
 * Tests workflow creation, execution, status checking, and management under concurrent load
 * Target: 200+ concurrent users with <500ms response times (95th percentile)
 */

const WebSocket = require('ws');
const fetch = require('node-fetch');
const { performance } = require('perf_hooks');
const { v4: uuidv4 } = require('uuid');

class WorkflowLoadTest {
  constructor(config = {}) {
    this.baseURL = config.baseURL || 'http://localhost:3001';
    this.wsURL = config.wsURL || 'ws://localhost:3001';
    this.concurrentUsers = config.concurrentUsers || 200;
    this.rampUpTime = config.rampUpTime || 30000;
    this.testDuration = config.testDuration || 300000;
    this.workflowsPerUser = config.workflowsPerUser || 5;
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      responseTimes: [],
      errors: [],
      workflowsCreated: 0,
      workflowsExecuted: 0,
      workflowsCompleted: 0,
      templateRequests: 0,
      statusChecks: 0
    };
  }

  // Generate test user credentials
  generateTestUser() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    return {
      email: `workflow-load-${timestamp}-${random}@gui-lop-load.com`,
      password: 'LoadTest123!',
      firstName: 'Workflow',
      lastName: `Load${random}`
    };
  }

  // Generate workflow test data
  generateWorkflowData(index = 0) {
    const templates = ['data-analysis', 'decision-making', 'content-creation'];
    const complexities = ['low', 'medium', 'high'];
    const template = templates[index % templates.length];
    const complexity = complexities[Math.floor(Math.random() * complexities.length)];

    return {
      template,
      context: `Load test workflow ${index} - ${complexity} complexity - ${Date.now()}`,
      metadata: {
        testRun: Date.now(),
        userId: 'load-test-user',
        priority: Math.floor(Math.random() * 10) + 1,
        estimatedDuration: Math.floor(Math.random() * 300) + 60 // 1-5 minutes
      },
      inputData: {
        dataSize: Math.floor(Math.random() * 10000) + 1000,
        analysisType: ['performance', 'security', 'usability', 'analytics'][Math.floor(Math.random() * 4)],
        iterations: Math.floor(Math.random() * 100) + 10
      }
    };
  }

  // Measure request performance
  async measureRequest(requestFunction, requestType = 'unknown') {
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
        success: true,
        requestType,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      const endTime = performance.now();
      const responseTime = endTime - startTime;

      this.metrics.responseTimes.push(responseTime);
      this.metrics.failedRequests++;
      this.metrics.errors.push({
        timestamp: new Date().toISOString(),
        requestType,
        error: error.message,
        responseTime,
        status: error.status || 'unknown'
      });

      throw error;
    }
  }

  // Authenticate user
  async authenticateUser(userData) {
    // First register the user
    await this.measureRequest(async () => {
      const response = await fetch(`${this.baseURL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userData)
      });

      if (!response.ok) {
        throw new Error(`Registration failed: ${response.status}`);
      }

      return response.json();
    }, 'user-registration');

    // Then login
    const loginResult = await this.measureRequest(async () => {
      const response = await fetch(`${this.baseURL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userData.email,
          password: userData.password
        })
      });

      if (!response.ok) {
        throw new Error(`Login failed: ${response.status}`);
      }

      return response.json();
    }, 'user-login');

    return {
      token: loginResult.data.token,
      refreshToken: loginResult.data.refreshToken,
      user: loginResult.data.user
    };
  }

  // Get workflow templates
  async getWorkflowTemplates(token) {
    const result = await this.measureRequest(async () => {
      const response = await fetch(`${this.baseURL}/api/workflows/templates`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to get templates: ${response.status}`);
      }

      return response.json();
    }, 'get-templates');

    this.metrics.templateRequests++;
    return result;
  }

  // Create workflow
  async createWorkflow(token, workflowData) {
    const result = await this.measureRequest(async () => {
      const response = await fetch(`${this.baseURL}/api/workflows`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          template: workflowData.template,
          context: workflowData.context
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to create workflow: ${response.status}`);
      }

      return response.json();
    }, 'create-workflow');

    this.metrics.workflowsCreated++;
    return result;
  }

  // Execute workflow
  async executeWorkflow(token, workflowId) {
    const result = await this.measureRequest(async () => {
      const response = await fetch(`${this.baseURL}/api/workflows/${workflowId}/execute`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to execute workflow: ${response.status}`);
      }

      return response.json();
    }, 'execute-workflow');

    this.metrics.workflowsExecuted++;
    return result;
  }

  // Check workflow status
  async getWorkflowStatus(token, workflowId) {
    const result = await this.measureRequest(async () => {
      const response = await fetch(`${this.baseURL}/api/workflows/${workflowId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to get workflow status: ${response.status}`);
      }

      return response.json();
    }, 'workflow-status');

    this.metrics.statusChecks++;
    return result;
  }

  // Submit human response to workflow
  async submitWorkflowResponse(token, workflowId, response = null) {
    const defaultResponse = {
      action: 'approve',
      data: {
        feedback: 'Load test approval',
        rating: 5,
        approvedAt: new Date().toISOString(),
        testContext: 'automated-load-test'
      }
    };

    const responseData = response || defaultResponse;

    const result = await this.measureRequest(async () => {
      const response = await fetch(`${this.baseURL}/api/workflows/${workflowId}/respond`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(responseData)
      });

      if (!response.ok) {
        throw new Error(`Failed to submit workflow response: ${response.status}`);
      }

      return response.json();
    }, 'workflow-response');

    this.metrics.workflowsCompleted++;
    return result;
  }

  // Get user workflows
  async getUserWorkflows(token) {
    const result = await this.measureRequest(async () => {
      const response = await fetch(`${this.baseURL}/api/workflows`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to get user workflows: ${response.status}`);
      }

      return response.json();
    }, 'get-user-workflows');

    return result;
  }

  // Simulate complete workflow lifecycle
  async simulateWorkflowLifecycle(token, workflowData, workflowIndex) {
    const workflowMetrics = {
      startTime: performance.now(),
      steps: [],
      totalTime: 0,
      success: false
    };

    try {
      // Step 1: Create workflow
      const createResult = await this.createWorkflow(token, workflowData);
      workflowMetrics.steps.push({
        step: 'create',
        responseTime: createResult.responseTime,
        success: true,
        workflowId: createResult.data.workflow_id
      });

      const workflowId = createResult.data.workflow_id;

      // Step 2: Execute workflow
      await new Promise(resolve => setTimeout(resolve, 1000)); // Small delay
      const executeResult = await this.executeWorkflow(token, workflowId);
      workflowMetrics.steps.push({
        step: 'execute',
        responseTime: executeResult.responseTime,
        success: true
      });

      // Step 3: Wait for workflow to be ready (simulated)
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Step 4: Check workflow status
      const statusResult = await this.getWorkflowStatus(token, workflowId);
      workflowMetrics.steps.push({
        step: 'status-check',
        responseTime: statusResult.responseTime,
        success: true,
        status: statusResult.data.workflow.status
      });

      // Step 5: Submit human response
      const responseResult = await this.submitWorkflowResponse(token, workflowId);
      workflowMetrics.steps.push({
        step: 'human-response',
        responseTime: responseResult.responseTime,
        success: true
      });

      workflowMetrics.endTime = performance.now();
      workflowMetrics.totalTime = workflowMetrics.endTime - workflowMetrics.startTime;
      workflowMetrics.success = true;

      return workflowMetrics;

    } catch (error) {
      workflowMetrics.endTime = performance.now();
      workflowMetrics.totalTime = workflowMetrics.endTime - workflowMetrics.startTime;
      workflowMetrics.success = false;
      workflowMetrics.error = error.message;

      throw error;
    }
  }

  // Simulate user session with multiple workflows
  async simulateUserSession(userData) {
    const sessionMetrics = {
      startTime: performance.now(),
      user: userData.email,
      workflowsCompleted: 0,
      workflowsFailed: 0,
      totalResponseTime: 0,
      workflowMetrics: []
    };

    try {
      // Authenticate user
      const authResult = await this.authenticateUser(userData);

      // Get workflow templates
      await this.getWorkflowTemplates(authResult.token);

      // Create and execute multiple workflows
      const workflowPromises = [];

      for (let i = 0; i < this.workflowsPerUser; i++) {
        const workflowData = this.generateWorkflowData(i);
        const workflowPromise = this.simulateWorkflowLifecycle(authResult.token, workflowData, i);
        workflowPromises.push(workflowPromise);
      }

      // Wait for all workflows to complete
      const workflowResults = await Promise.allSettled(workflowPromises);

      // Analyze results
      workflowResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          sessionMetrics.workflowsCompleted++;
          sessionMetrics.workflowMetrics.push(result.value);
          sessionMetrics.totalResponseTime += result.value.totalTime;
        } else {
          sessionMetrics.workflowsFailed++;
          console.warn(`Workflow ${index} failed for user ${userData.email}:`, result.reason);
        }
      });

      // Get user workflows list
      await this.getUserWorkflows(authResult.token);

      sessionMetrics.endTime = performance.now();
      sessionMetrics.totalDuration = sessionMetrics.endTime - sessionMetrics.startTime;

      return sessionMetrics;

    } catch (error) {
      sessionMetrics.endTime = performance.now();
      sessionMetrics.totalDuration = sessionMetrics.endTime - sessionMetrics.startTime;
      sessionMetrics.error = error.message;

      throw error;
    }
  }

  // Run concurrent workflow load test
  async runConcurrentWorkflowTest() {
    console.log(`Starting workflow load test with ${this.concurrentUsers} concurrent users`);
    console.log(`Workflows per user: ${this.workflowsPerUser}`);
    console.log(`Total expected workflows: ${this.concurrentUsers * this.workflowsPerUser}`);

    const startTime = performance.now();
    const users = [];

    // Ramp up users gradually
    const rampUpInterval = this.rampUpTime / this.concurrentUsers;
    const userPromises = [];

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

      userPromises.push(userPromise);
    }

    // Wait for all users to complete
    const results = await Promise.all(userPromises);
    const endTime = performance.now();
    const totalTestTime = endTime - startTime;

    // Analyze results
    const analysis = this.analyzeResults(results, totalTestTime);

    console.log('\n=== Workflow Load Test Results ===');
    console.log(`Total test time: ${(totalTestTime / 1000).toFixed(2)}s`);
    console.log(`Concurrent users: ${this.concurrentUsers}`);
    console.log(`Successful user sessions: ${analysis.successfulSessions}/${this.concurrentUsers}`);
    console.log(`Workflows completed: ${this.metrics.workflowsCompleted}`);
    console.log(`Workflows created: ${this.metrics.workflowsCreated}`);
    console.log(`Workflows executed: ${this.metrics.workflowsExecuted}`);
    console.log(`Average response time: ${analysis.averageResponseTime.toFixed(2)}ms`);
    console.log(`95th percentile response time: ${analysis.p95ResponseTime.toFixed(2)}ms`);
    console.log(`99th percentile response time: ${analysis.p99ResponseTime.toFixed(2)}ms`);
    console.log(`Success rate: ${((analysis.successfulSessions / this.concurrentUsers) * 100).toFixed(2)}%`);
    console.log(`Workflow throughput: ${analysis.workflowThroughput.toFixed(2)} workflows/second`);

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

    // Calculate throughput
    const requestsPerSecond = (this.metrics.totalRequests / totalTestTime) * 1000;
    const workflowThroughput = (this.metrics.workflowsCompleted / totalTestTime) * 1000;

    // Performance validation
    const performanceTargets = {
      p95Target: 500,
      p99Target: 1000,
      successRateTarget: 0.95,
      workflowThroughputTarget: 10 // workflows per second
    };

    const performanceValidation = {
      p95Passed: p95ResponseTime <= performanceTargets.p95Target,
      p99Passed: p99ResponseTime <= performanceTargets.p99Target,
      successRatePassed: (successfulSessions / this.concurrentUsers) >= performanceTargets.successRateTarget,
      throughputPassed: workflowThroughput >= performanceTargets.workflowThroughputTarget,
      overallPassed: false
    };

    performanceValidation.overallPassed = performanceValidation.p95Passed &&
                                        performanceValidation.p99Passed &&
                                        performanceValidation.successRatePassed &&
                                        performanceValidation.throughputPassed;

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
      workflowThroughput,
      workflowsCreated: this.metrics.workflowsCreated,
      workflowsExecuted: this.metrics.workflowsExecuted,
      workflowsCompleted: this.metrics.workflowsCompleted,
      templateRequests: this.metrics.templateRequests,
      statusChecks: this.metrics.statusChecks,
      errors: this.metrics.errors,
      performanceValidation,
      performanceTargets,
      recommendations: this.generateRecommendations(performanceValidation, {
        p95ResponseTime,
        p99ResponseTime,
        successRate: successfulSessions / this.concurrentUsers,
        workflowThroughput
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
        message: `95th percentile response time (${metrics.p95ResponseTime.toFixed(2)}ms) exceeds target (500ms). Consider optimizing workflow execution and database queries.`,
        metrics: {
          current: metrics.p95ResponseTime,
          target: 500,
          variance: metrics.p95ResponseTime - 500
        }
      });
    }

    if (!validation.throughputPassed) {
      recommendations.push({
        type: 'throughput',
        priority: 'high',
        message: `Workflow throughput (${metrics.workflowThroughput.toFixed(2)} workflows/s) below target (10 workflows/s). Consider workflow optimization and parallel processing.`,
        metrics: {
          current: metrics.workflowThroughput,
          target: 10,
          variance: 10 - metrics.workflowThroughput
        }
      });
    }

    if (this.metrics.workflowsExecuted > this.metrics.workflowsCompleted) {
      recommendations.push({
        type: 'reliability',
        priority: 'medium',
        message: `${this.metrics.workflowsExecuted - this.metrics.workflowsCompleted} workflows were executed but not completed. Review workflow execution logic and error handling.`,
        metrics: {
          executed: this.metrics.workflowsExecuted,
          completed: this.metrics.workflowsCompleted,
          variance: this.metrics.workflowsExecuted - this.metrics.workflowsCompleted
        }
      });
    }

    if (validation.overallPassed) {
      recommendations.push({
        type: 'success',
        priority: 'info',
        message: 'All workflow performance targets met. System is performing well under concurrent workflow load.',
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
      testType: 'Workflow CRUD Load Test',
      timestamp: new Date().toISOString(),
      configuration: {
        baseURL: this.baseURL,
        concurrentUsers: this.concurrentUsers,
        workflowsPerUser: this.workflowsPerUser,
        rampUpTime: this.rampUpTime,
        testDuration: this.testDuration
      },
      results: analysis,
      summary: {
        passed: analysis.performanceValidation.overallPassed,
        readyForProduction: analysis.performanceValidation.overallPassed && analysis.successfulSessions >= this.concurrentUsers * 0.95,
        bottlenecks: analysis.errors.length > 0 ? 'Yes' : 'No',
        performanceGrade: this.calculatePerformanceGrade(analysis),
        workflowEfficiency: (this.metrics.workflowsCompleted / this.metrics.workflowsCreated) * 100
      }
    };
  }

  // Calculate overall performance grade
  calculatePerformanceGrade(analysis) {
    const p95Score = Math.max(0, 100 - (analysis.p95ResponseTime / 500) * 100);
    const throughputScore = Math.min(100, (analysis.workflowThroughput / 10) * 100);
    const successRateScore = analysis.successfulSessions / this.concurrentUsers * 100;
    const overallScore = (p95Score + throughputScore + successRateScore) / 3;

    if (overallScore >= 90) return 'A';
    if (overallScore >= 80) return 'B';
    if (overallScore >= 70) return 'C';
    if (overallScore >= 60) return 'D';
    return 'F';
  }
}

module.exports = WorkflowLoadTest;

// Export for direct execution
if (require.main === module) {
  const test = new WorkflowLoadTest({
    concurrentUsers: 20, // Reduced for demo
    workflowsPerUser: 3,
    testDuration: 120000 // 2 minutes for demo
  });

  test.runConcurrentWorkflowTest()
    .then(results => {
      console.log('\nWorkflow load test completed successfully!');
      console.log('Report:', JSON.stringify(test.generateReport(results), null, 2));
    })
    .catch(error => {
      console.error('Workflow load test failed:', error);
      process.exit(1);
    });
}