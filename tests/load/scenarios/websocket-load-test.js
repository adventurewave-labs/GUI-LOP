/**
 * WebSocket Connection Stress Testing
 * Tests real-time WebSocket communication under concurrent load
 * Target: 200+ concurrent WebSocket connections with <100ms message latency
 */

const WebSocket = require('ws');
const fetch = require('node-fetch');
const { performance } = require('perf_hooks');
const { v4: uuidv4 } = require('uuid');

class WebSocketLoadTest {
  constructor(config = {}) {
    this.baseURL = config.baseURL || 'http://localhost:3001';
    this.wsURL = config.wsURL || 'ws://localhost:3001';
    this.concurrentConnections = config.concurrentConnections || 200;
    this.rampUpTime = config.rampUpTime || 30000;
    this.testDuration = config.testDuration || 300000;
    this.messagesPerConnection = config.messagesPerConnection || 50;
    this.messageInterval = config.messageInterval || 1000; // 1 second between messages
    this.metrics = {
      totalConnections: 0,
      successfulConnections: 0,
      failedConnections: 0,
      totalMessages: 0,
      successfulMessages: 0,
      failedMessages: 0,
      messageLatencies: [],
      connectionTimes: [],
      disconnections: 0,
      errors: [],
      messageTypes: {},
      throughputData: []
    };
  }

  // Generate WebSocket message
  generateMessage(type = 'ping', sessionId = null) {
    const messageTypes = {
      ping: { type: 'ping', timestamp: Date.now() },
      status_update: { type: 'status_update', status: 'active', timestamp: Date.now() },
      workflow_status: { type: 'workflow_status', workflowId: uuidv4(), timestamp: Date.now() },
      heartbeat: { type: 'heartbeat', timestamp: Date.now(), interval: 5000 },
      user_activity: { type: 'user_activity', activity: 'workflow_interaction', timestamp: Date.now() }
    };

    const message = messageTypes[type] || messageTypes.ping;
    message.sessionId = sessionId || uuidv4();
    message.messageId = uuidv4();

    return JSON.stringify(message);
  }

  // Parse WebSocket message and calculate latency
  parseMessage(message, sentTime) {
    try {
      const parsed = JSON.parse(message);
      const receivedTime = Date.now();
      const latency = receivedTime - sentTime;

      return {
        ...parsed,
        receivedTime,
        latency,
        success: true
      };
    } catch (error) {
      return {
        error: error.message,
        success: false,
        latency: null
      };
    }
  }

  // Create WebSocket connection with monitoring
  async createWebSocketConnection(connectionId, testUser = null) {
    return new Promise((resolve, reject) => {
      const connectionMetrics = {
        connectionId,
        startTime: performance.now(),
        endTime: null,
        connected: false,
        messagesSent: 0,
        messagesReceived: 0,
        latencies: [],
        errors: []
      };

      const ws = new WebSocket(this.wsURL);
      const connectionTimeout = setTimeout(() => {
        if (!connectionMetrics.connected) {
          ws.terminate();
          reject(new Error(`Connection ${connectionId} timeout`));
        }
      }, 10000); // 10 second connection timeout

      ws.on('open', () => {
        connectionMetrics.connected = true;
        connectionMetrics.endTime = performance.now();
        connectionMetrics.connectionTime = connectionMetrics.endTime - connectionMetrics.startTime;

        this.metrics.totalConnections++;
        this.metrics.successfulConnections++;
        this.metrics.connectionTimes.push(connectionMetrics.connectionTime);

        clearTimeout(connectionTimeout);

        // Send initial message
        const initialMessage = this.generateMessage('connection_established', `conn-${connectionId}`);
        ws.send(initialMessage);
        connectionMetrics.messagesSent++;

        resolve({ ws, connectionMetrics });
      });

      ws.on('message', (data) => {
        connectionMetrics.messagesReceived++;
        this.metrics.successfulMessages++;

        try {
          const parsed = JSON.parse(data);

          // Track message types
          const messageType = parsed.type || 'unknown';
          this.metrics.messageTypes[messageType] = (this.metrics.messageTypes[messageType] || 0) + 1;

          // Calculate latency for echo messages
          if (parsed.type === 'echo' && parsed.original && parsed.original.timestamp) {
            const latency = Date.now() - parsed.original.timestamp;
            connectionMetrics.latencies.push(latency);
            this.metrics.messageLatencies.push(latency);
          }
        } catch (error) {
          connectionMetrics.errors.push(error.message);
        }
      });

      ws.on('error', (error) => {
        clearTimeout(connectionTimeout);
        connectionMetrics.connected = false;
        connectionMetrics.endTime = performance.now();

        this.metrics.totalConnections++;
        this.metrics.failedConnections++;
        this.metrics.errors.push({
          connectionId,
          timestamp: new Date().toISOString(),
          error: error.message
        });

        reject(error);
      });

      ws.on('close', (code, reason) => {
        clearTimeout(connectionTimeout);
        connectionMetrics.connected = false;
        connectionMetrics.endTime = performance.now();
        this.metrics.disconnections++;
      });
    });
  }

  // Simulate WebSocket message exchange
  async simulateMessageExchange(ws, connectionMetrics, connectionId) {
    const messageTypes = ['ping', 'status_update', 'workflow_status', 'heartbeat', 'user_activity'];
    const totalMessages = this.messagesPerConnection;
    const startTime = Date.now();
    const endTime = startTime + this.testDuration;

    for (let i = 0; i < totalMessages && Date.now() < endTime; i++) {
      try {
        // Select random message type
        const messageType = messageTypes[Math.floor(Math.random() * messageTypes.length)];
        const message = this.generateMessage(messageType, `conn-${connectionId}`);

        const sendTime = Date.now();
        ws.send(message);

        connectionMetrics.messagesSent++;
        this.metrics.totalMessages++;

        // Wait for message interval
        await new Promise(resolve => setTimeout(resolve, this.messageInterval));

        // Record throughput data point
        const currentTime = Date.now();
        this.metrics.throughputData.push({
          timestamp: currentTime,
          connectionId,
          messageId: i,
          messageType,
          sentAt: sendTime
        });

      } catch (error) {
        connectionMetrics.errors.push(error.message);
        this.metrics.failedMessages++;
        this.metrics.errors.push({
          connectionId,
          messageId: i,
          timestamp: new Date().toISOString(),
          error: error.message
        });
      }
    }

    return connectionMetrics;
  }

  // Simulate authenticated WebSocket session
  async simulateAuthenticatedWebSocketSession(connectionId) {
    let connection = null;
    let authResult = null;

    try {
      // First, authenticate user
      const userData = {
        email: `ws-load-${connectionId}-${Date.now()}@gui-lop-load.com`,
        password: 'LoadTest123!',
        firstName: 'WebSocket',
        lastName: `Load${connectionId}`
      };

      // Register user
      const registerResponse = await fetch(`${this.baseURL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userData)
      });

      if (!registerResponse.ok) {
        throw new Error(`Registration failed: ${registerResponse.status}`);
      }

      // Login user
      const loginResponse = await fetch(`${this.baseURL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userData.email,
          password: userData.password
        })
      });

      if (!loginResponse.ok) {
        throw new Error(`Login failed: ${loginResponse.status}`);
      }

      authResult = await loginResponse.json();

      // Create WebSocket connection
      connection = await this.createWebSocketConnection(connectionId, userData);

      // Send authenticated messages
      const authMessage = {
        type: 'authenticated_connection',
        userId: authResult.data.user.id,
        token: authResult.data.token,
        timestamp: Date.now()
      };

      connection.ws.send(JSON.stringify(authMessage));
      connection.connectionMetrics.messagesSent++;

      // Simulate message exchange
      await this.simulateMessageExchange(connection.ws, connection.connectionMetrics, connectionId);

      // Close connection gracefully
      connection.ws.close(1000, 'Test completed');

      return {
        connectionId,
        success: true,
        user: userData,
        authResult,
        connectionMetrics: connection.connectionMetrics
      };

    } catch (error) {
      if (connection && connection.ws) {
        connection.ws.terminate();
      }

      return {
        connectionId,
        success: false,
        error: error.message,
        user: authResult ? userData : null
      };
    }
  }

  // Simulate anonymous WebSocket session
  async simulateAnonymousWebSocketSession(connectionId) {
    let connection = null;

    try {
      // Create WebSocket connection without authentication
      connection = await this.createWebSocketConnection(connectionId);

      // Simulate message exchange
      await this.simulateMessageExchange(connection.ws, connection.connectionMetrics, connectionId);

      // Close connection gracefully
      connection.ws.close(1000, 'Test completed');

      return {
        connectionId,
        success: true,
        authenticated: false,
        connectionMetrics: connection.connectionMetrics
      };

    } catch (error) {
      if (connection && connection.ws) {
        connection.ws.terminate();
      }

      return {
        connectionId,
        success: false,
        error: error.message,
        authenticated: false
      };
    }
  }

  // Run concurrent WebSocket stress test
  async runConcurrentWebSocketTest(authenticatedRatio = 0.7) {
    console.log(`Starting WebSocket load test with ${this.concurrentConnections} concurrent connections`);
    console.log(`Authenticated connections: ${Math.floor(this.concurrentConnections * authenticatedRatio)} (${(authenticatedRatio * 100)}%)`);
    console.log(`Anonymous connections: ${Math.ceil(this.concurrentConnections * (1 - authenticatedRatio)) (${((1 - authenticatedRatio) * 100)}%)`);

    const startTime = performance.now();
    const authenticatedConnections = Math.floor(this.concurrentConnections * authenticatedRatio);
    const anonymousConnections = Math.ceil(this.concurrentConnections * (1 - authenticatedRatio));
    const connectionPromises = [];

    // Ramp up connections gradually
    const rampUpInterval = this.rampUpTime / this.concurrentConnections;
    let connectionId = 0;

    // Create authenticated connections
    for (let i = 0; i < authenticatedConnections; i++) {
      const delay = i * rampUpInterval;

      const connectionPromise = new Promise(async (resolve) => {
        await new Promise(r => setTimeout(r, delay));
        const result = await this.simulateAuthenticatedWebSocketSession(connectionId++);
        resolve(result);
      });

      connectionPromises.push(connectionPromise);
    }

    // Create anonymous connections
    for (let i = 0; i < anonymousConnections; i++) {
      const delay = (authenticatedConnections + i) * rampUpInterval;

      const connectionPromise = new Promise(async (resolve) => {
        await new Promise(r => setTimeout(r, delay));
        const result = await this.simulateAnonymousWebSocketSession(connectionId++);
        resolve(result);
      });

      connectionPromises.push(connectionPromise);
    }

    // Wait for all connections to complete
    const results = await Promise.all(connectionPromises);
    const endTime = performance.now();
    const totalTestTime = endTime - startTime;

    // Analyze results
    const analysis = this.analyzeResults(results, totalTestTime);

    console.log('\n=== WebSocket Load Test Results ===');
    console.log(`Total test time: ${(totalTestTime / 1000).toFixed(2)}s`);
    console.log(`Total connections: ${this.concurrentConnections}`);
    console.log(`Successful connections: ${this.metrics.successfulConnections}/${this.metrics.totalConnections}`);
    console.log(`Failed connections: ${this.metrics.failedConnections}`);
    console.log(`Total messages sent: ${this.metrics.totalMessages}`);
    console.log(`Total messages received: ${this.metrics.successfulMessages}`);
    console.log(`Average message latency: ${analysis.averageMessageLatency.toFixed(2)}ms`);
    console.log(`95th percentile latency: ${analysis.p95MessageLatency.toFixed(2)}ms`);
    console.log(`99th percentile latency: ${analysis.p99MessageLatency.toFixed(2)}ms`);
    console.log(`Message throughput: ${analysis.messageThroughput.toFixed(2)} messages/second`);
    console.log(`Connection success rate: ${((this.metrics.successfulConnections / this.metrics.totalConnections) * 100).toFixed(2)}%`);

    return analysis;
  }

  // Analyze test results
  analyzeResults(results, totalTestTime) {
    const successfulConnections = results.filter(r => r.success).length;
    const failedConnections = results.length - successfulConnections;

    // Calculate latency statistics
    const sortedLatencies = [...this.metrics.messageLatencies].sort((a, b) => a - b);

    let averageMessageLatency = 0;
    let p50MessageLatency = 0;
    let p95MessageLatency = 0;
    let p99MessageLatency = 0;

    if (sortedLatencies.length > 0) {
      const totalLatency = sortedLatencies.reduce((sum, latency) => sum + latency, 0);
      averageMessageLatency = totalLatency / sortedLatencies.length;
      p50MessageLatency = sortedLatencies[Math.floor(sortedLatencies.length * 0.5)];
      p95MessageLatency = sortedLatencies[Math.floor(sortedLatencies.length * 0.95)];
      p99MessageLatency = sortedLatencies[Math.floor(sortedLatencies.length * 0.99)];
    }

    // Calculate connection time statistics
    const averageConnectionTime = this.metrics.connectionTimes.length > 0 ?
      this.metrics.connectionTimes.reduce((sum, time) => sum + time, 0) / this.metrics.connectionTimes.length : 0;

    // Calculate throughput
    const messageThroughput = (this.metrics.successfulMessages / totalTestTime) * 1000;
    const connectionThroughput = (this.metrics.successfulConnections / totalTestTime) * 1000;

    // Performance validation
    const performanceTargets = {
      p95LatencyTarget: 100, // 100ms for 95th percentile
      p99LatencyTarget: 200, // 200ms for 99th percentile
      connectionSuccessRateTarget: 0.95, // 95% connection success rate
      messageThroughputTarget: 100 // 100 messages per second
    };

    const performanceValidation = {
      p95LatencyPassed: p95MessageLatency <= performanceTargets.p95LatencyTarget,
      p99LatencyPassed: p99MessageLatency <= performanceTargets.p99LatencyTarget,
      connectionSuccessRatePassed: (successfulConnections / this.concurrentConnections) >= performanceTargets.connectionSuccessRateTarget,
      throughputPassed: messageThroughput >= performanceTargets.messageThroughputTarget,
      overallPassed: false
    };

    performanceValidation.overallPassed = performanceValidation.p95LatencyPassed &&
                                        performanceValidation.p99LatencyPassed &&
                                        performanceValidation.connectionSuccessRatePassed;

    return {
      totalTestTime,
      totalConnections: this.concurrentConnections,
      successfulConnections,
      failedConnections,
      totalMessages: this.metrics.totalMessages,
      successfulMessages: this.metrics.successfulMessages,
      failedMessages: this.metrics.failedMessages,
      averageMessageLatency,
      p50MessageLatency,
      p95MessageLatency,
      p99MessageLatency,
      maxMessageLatency: sortedLatencies.length > 0 ? Math.max(...sortedLatencies) : 0,
      minMessageLatency: sortedLatencies.length > 0 ? Math.min(...sortedLatencies) : 0,
      averageConnectionTime,
      messageThroughput,
      connectionThroughput,
      disconnections: this.metrics.disconnections,
      messageTypes: this.metrics.messageTypes,
      errors: this.metrics.errors,
      performanceValidation,
      performanceTargets,
      recommendations: this.generateRecommendations(performanceValidation, {
        p95MessageLatency,
        p99MessageLatency,
        successRate: successfulConnections / this.concurrentConnections,
        messageThroughput
      })
    };
  }

  // Generate performance recommendations
  generateRecommendations(validation, metrics) {
    const recommendations = [];

    if (!validation.p95LatencyPassed) {
      recommendations.push({
        type: 'latency',
        priority: 'high',
        message: `95th percentile message latency (${metrics.p95MessageLatency.toFixed(2)}ms) exceeds target (100ms). Consider optimizing WebSocket message processing.`,
        metrics: {
          current: metrics.p95MessageLatency,
          target: 100,
          variance: metrics.p95MessageLatency - 100
        }
      });
    }

    if (!validation.connectionSuccessRatePassed) {
      recommendations.push({
        type: 'reliability',
        priority: 'high',
        message: `Connection success rate (${(metrics.successRate * 100).toFixed(2)}%) below target (95%). Review WebSocket server capacity and connection handling.`,
        metrics: {
          current: metrics.successRate,
          target: 0.95,
          variance: 0.95 - metrics.successRate
        }
      });
    }

    if (this.metrics.disconnections > this.metrics.totalConnections * 0.1) {
      recommendations.push({
        type: 'stability',
        priority: 'medium',
        message: `High disconnection rate detected (${this.metrics.disconnections}/${this.metrics.totalConnections}). Investigate connection stability and timeout settings.`,
        metrics: {
          disconnections: this.metrics.disconnections,
          totalConnections: this.metrics.totalConnections,
          disconnectionRate: this.metrics.disconnections / this.metrics.totalConnections
        }
      });
    }

    if (validation.overallPassed) {
      recommendations.push({
        type: 'success',
        priority: 'info',
        message: 'All WebSocket performance targets met. Real-time communication system is performing well under load.',
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
      testType: 'WebSocket Connection Stress Test',
      timestamp: new Date().toISOString(),
      configuration: {
        wsURL: this.wsURL,
        concurrentConnections: this.concurrentConnections,
        messagesPerConnection: this.messagesPerConnection,
        messageInterval: this.messageInterval,
        rampUpTime: this.rampUpTime,
        testDuration: this.testDuration
      },
      results: analysis,
      summary: {
        passed: analysis.performanceValidation.overallPassed,
        readyForProduction: analysis.performanceValidation.overallPassed && analysis.successfulConnections >= this.concurrentConnections * 0.95,
        bottlenecks: analysis.errors.length > 0 ? 'Yes' : 'No',
        performanceGrade: this.calculatePerformanceGrade(analysis),
        messageDeliveryRate: (this.metrics.successfulMessages / this.metrics.totalMessages) * 100
      }
    };
  }

  // Calculate overall performance grade
  calculatePerformanceGrade(analysis) {
    const p95LatencyScore = Math.max(0, 100 - (analysis.p95MessageLatency / 100) * 100);
    const connectionScore = (analysis.successfulConnections / this.concurrentConnections) * 100;
    const throughputScore = Math.min(100, (analysis.messageThroughput / 100) * 100);
    const overallScore = (p95LatencyScore + connectionScore + throughputScore) / 3;

    if (overallScore >= 90) return 'A';
    if (overallScore >= 80) return 'B';
    if (overallScore >= 70) return 'C';
    if (overallScore >= 60) return 'D';
    return 'F';
  }
}

module.exports = WebSocketLoadTest;

// Export for direct execution
if (require.main === module) {
  const test = new WebSocketLoadTest({
    concurrentConnections: 50, // Reduced for demo
    messagesPerConnection: 20,
    testDuration: 60000 // 1 minute for demo
  });

  test.runConcurrentWebSocketTest(0.7) // 70% authenticated connections
    .then(results => {
      console.log('\nWebSocket load test completed successfully!');
      console.log('Report:', JSON.stringify(test.generateReport(results), null, 2));
    })
    .catch(error => {
      console.error('WebSocket load test failed:', error);
      process.exit(1);
    });
}