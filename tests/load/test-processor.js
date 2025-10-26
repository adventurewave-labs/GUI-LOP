/**
 * Load Test Processor for GUI-LOP
 * Provides custom functions and variables for Artillery load testing
 */

const { randomBytes } = require('crypto');
const { promisify } = require('util');

const randomBytesAsync = promisify(randomBytes);

module.exports = {
  // Generate random email for load testing
  generateTestEmail: function(userContext, events, done) {
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(7);
    const email = `loadtest-${timestamp}-${randomSuffix}@gui-lop-load.com`;

    userContext.vars.testEmail = email;
    userContext.vars.testFirstName = 'Load';
    userContext.vars.testLastName = `Test${randomSuffix}`;

    return done();
  },

  // Generate random string for unique test data
  generateRandomString: function(userContext, events, done) {
    const randomString = Math.random().toString(36).substring(2, 15);
    userContext.vars.randomString = randomString;
    return done();
  },

  // Generate timestamp
  getCurrentTimestamp: function(userContext, events, done) {
    userContext.vars.timestamp = new Date().toISOString();
    return done();
  },

  // Generate realistic workflow context
  generateWorkflowContext: function(userContext, events, done) {
    const contexts = [
      'Performance testing scenario for data analysis workflow',
      'Load test validation for decision making process',
      'Stress test execution for content creation workflow',
      'Performance benchmark for analytics workflow',
      'Concurrent user simulation for approval workflow'
    ];

    const randomContext = contexts[Math.floor(Math.random() * contexts.length)];
    const timestamp = Date.now();
    const suffix = Math.random().toString(36).substring(7);

    userContext.vars.workflowContext = `${randomContext} - ${timestamp}-${suffix}`;
    return done();
  },

  // Generate complex workflow data
  generateComplexWorkflowData: function(userContext, events, done) {
    const data = {
      inputData: {
        datasetSize: Math.floor(Math.random() * 10000) + 1000,
        analysisType: ['performance', 'security', 'usability', 'analytics'][Math.floor(Math.random() * 4)],
        complexity: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)],
        priority: Math.floor(Math.random() * 10) + 1
      },
      metadata: {
        testRun: Date.now(),
        scenario: 'load-test',
        userId: userContext.vars.userId || 'anonymous'
      },
      expectations: {
        responseTime: Math.floor(Math.random() * 500) + 100,
        throughput: Math.floor(Math.random() * 1000) + 500,
        successRate: 95 + Math.random() * 5
      }
    };

    userContext.vars.complexWorkflowData = data;
    return done();
  },

  // Generate authentication payload
  generateAuthPayload: function(userContext, events, done) {
    const payload = {
      username: `loadtest-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      password: 'LoadTest123!',
      role: 'user',
      metadata: {
        testType: 'load',
        timestamp: Date.now(),
        sessionId: randomBytesAsync(16).toString('hex')
      }
    };

    userContext.vars.authPayload = payload;
    return done();
  },

  // Calculate think time based on scenario
  calculateThinkTime: function(userContext, events, done) {
    // Simulate realistic user think times
    const baseThinkTime = 1000; // 1 second
    const variance = Math.random() * 2000; // 0-2 seconds variance
    const thinkTime = baseThinkTime + variance;

    userContext.vars.thinkTime = Math.floor(thinkTime);
    return done();
  },

  // Generate WebSocket message
  generateWebSocketMessage: function(userContext, events, done) {
    const messageTypes = ['ping', 'status_update', 'workflow_query', 'heartbeat'];
    const messageType = messageTypes[Math.floor(Math.random() * messageTypes.length)];

    const message = {
      type: messageType,
      timestamp: new Date().toISOString(),
      sessionId: userContext.vars.sessionId || 'unknown',
      payload: {
        userId: userContext.vars.userId || 'anonymous',
        data: `Load test message ${Date.now()}`,
        priority: Math.floor(Math.random() * 10) + 1
      }
    };

    userContext.vars.webSocketMessage = JSON.stringify(message);
    return done();
  },

  // Generate bulk workflow operations
  generateBulkOperations: function(userContext, events, done) {
    const operationCount = Math.floor(Math.random() * 5) + 3; // 3-7 operations
    const operations = [];

    for (let i = 0; i < operationCount; i++) {
      operations.push({
        id: `op-${Date.now()}-${i}`,
        type: ['create', 'read', 'update', 'delete'][Math.floor(Math.random() * 4)],
        target: `workflow-${i}`,
        timestamp: Date.now() + (i * 100),
        payload: {
          size: Math.floor(Math.random() * 1000) + 100,
          complexity: Math.floor(Math.random() * 10) + 1
        }
      });
    }

    userContext.vars.bulkOperations = operations;
    userContext.vars.operationCount = operationCount;
    return done();
  },

  // Log custom metrics
  logCustomMetrics: function(requestParams, response, context, ee, events) {
    if (response && response.timings) {
      // Custom metrics for analysis
      events.emit('customStat', 'response_time_total', response.timings.total || 0);
      events.emit('customStat', 'response_time_phases', JSON.stringify(response.timings));

      // Log request details
      console.log(`Load Test Request: ${requestParams.method} ${requestParams.path} - ${response.statusCode} - ${response.timings.total}ms`);
    }
  },

  // Error handling and logging
  logError: function(requestParams, error, context, ee, events) {
    console.error(`Load Test Error: ${requestParams.method} ${requestParams.path}`, error);
    events.emit('customStat', 'error_count', 1);
    events.emit('customStat', 'error_type', error.code || 'unknown');
  },

  // Performance threshold validation
  validatePerformanceThresholds: function(requestParams, response, context, ee, events) {
    const thresholds = {
      p95: 500, // 95th percentile should be under 500ms
      p99: 1000, // 99th percentile should be under 1000ms
      errorRate: 0.01 // Error rate should be under 1%
    };

    if (response && response.timings && response.timings.total) {
      const responseTime = response.timings.total;

      // Check if response time exceeds thresholds
      if (responseTime > thresholds.p99) {
        events.emit('customStat', 'slow_request_p99', 1);
      } else if (responseTime > thresholds.p95) {
        events.emit('customStat', 'slow_request_p95', 1);
      }

      // Log performance bucket
      const bucket = getPerformanceBucket(responseTime);
      events.emit('customStat', `performance_bucket_${bucket}`, 1);
    }
  }
};

// Helper function to categorize performance
function getPerformanceBucket(responseTime) {
  if (responseTime < 100) return 'excellent';
  if (responseTime < 250) return 'good';
  if (responseTime < 500) return 'acceptable';
  if (responseTime < 1000) return 'slow';
  return 'very_slow';
}