# GUI-LOP Load Testing Suite

## Overview

This comprehensive load testing suite is designed to validate the GUI-LOP platform's performance under concurrent user load, targeting 200+ simultaneous users with sub-500ms response times (95th percentile).

## 🎯 Objectives

- **Validate System Performance**: Ensure the platform can handle 200+ concurrent users
- **Identify Bottlenecks**: Detect performance issues under stress conditions
- **Measure Scalability**: Test system behavior as load increases
- **Ensure Production Readiness**: Provide confidence for production deployment
- **Generate Actionable Insights**: Deliver detailed performance reports and recommendations

## 📋 Test Scenarios

### 1. Authentication Flow Load Testing
- **File**: `scenarios/authentication-load-test.js`
- **Purpose**: Test user registration, login, token refresh, and session management
- **Metrics**: Registration/Login response times, token validation success rates
- **Target**: <500ms response time, 95%+ success rate

### 2. Workflow CRUD Operations Load Testing
- **File**: `scenarios/workflow-load-test.js`
- **Purpose**: Test workflow creation, execution, status checking, and management
- **Metrics**: Workflow throughput, CRUD operation performance
- **Target**: <500ms response time, 10+ workflows/second throughput

### 3. WebSocket Connection Stress Testing
- **File**: `scenarios/websocket-load-test.js`
- **Purpose**: Test real-time WebSocket communication under concurrent load
- **Metrics**: Connection success rates, message latency, throughput
- **Target**: <100ms message latency, 95%+ connection success

### 4. Database Performance Testing
- **File**: `scenarios/database-load-test.js`
- **Purpose**: Test PostgreSQL performance with concurrent queries and transactions
- **Metrics**: Query response times, connection pool efficiency, throughput
- **Target**: <200ms query time, 1000+ queries/second

### 5. Redis Cache Performance Validation
- **File**: `scenarios/redis-load-test.js`
- **Purpose**: Test Redis cache performance for session management and data caching
- **Metrics**: Cache hit rates, operation response times, memory efficiency
- **Target**: <50ms operation time, 80%+ cache hit rate

## 🚀 Quick Start

### Prerequisites

Ensure your GUI-LOP server is running and accessible:
```bash
npm start
```

Optional: Ensure PostgreSQL and Redis are available for comprehensive testing.

### Basic Usage

```bash
# Run quick authentication load test (20 users, 1 minute)
npm run test:load:quick

# Run full load test suite (200 users, all scenarios)
npm run test:load:full

# Run individual test scenarios
npm run test:load:auth        # Authentication testing
npm run test:load:workflows   # Workflow CRUD testing
npm run test:load:websocket   # WebSocket stress testing
npm run test:load:database    # Database performance testing
npm run test:load:redis       # Redis cache testing
```

### Advanced Configuration

```javascript
// Create custom test configuration
const AutomatedLoadTestSuite = require('./automated-load-test-suite');

const suite = new AutomatedLoadTestSuite({
  targetConcurrentUsers: 150,
  testScenarios: ['authentication', 'workflows'],
  parallelExecution: false,
  enableHTMLReports: true,
  enableCSVExport: true,

  testConfigurations: {
    authentication: {
      concurrentUsers: 50,
      testDuration: 120000, // 2 minutes
      rampUpTime: 30000     // 30 seconds
    },
    workflows: {
      concurrentUsers: 30,
      workflowsPerUser: 5,
      testDuration: 180000   // 3 minutes
    }
  }
});

// Run the test suite
suite.runTestSuite()
  .then(results => {
    console.log('Tests completed:', results.summary.readyForProduction);
  })
  .catch(error => {
    console.error('Test failed:', error);
  });
```

## 📊 Performance Monitoring

The suite includes real-time performance monitoring that tracks:

- **System Metrics**: CPU usage, memory consumption, disk I/O
- **Application Metrics**: Response times, request rates, error rates
- **Business Metrics**: User engagement, workflow throughput, session duration
- **Custom KPIs**: Scalability index, reliability score, efficiency ratio

### Monitoring Configuration

```javascript
const PerformanceMonitor = require('./monitoring/performance-monitor');

const monitor = new PerformanceMonitor({
  monitoringInterval: 1000,        // 1 second
  enableRealTimeAlerts: true,
  alertThresholds: {
    cpuUsage: 85,                 // Alert if CPU > 85%
    memoryUsage: 85,              // Alert if memory > 85%
    responseTime: 1000,           // Alert if response time > 1s
    errorRate: 10                 // Alert if error rate > 10%
  }
});

// Start monitoring
monitor.startMonitoring();

// Subscribe to real-time metrics
monitor.startRealTimeStream((metrics) => {
  console.log('Current metrics:', metrics);
});
```

## 📈 Reports and Analysis

### Report Generation

The suite automatically generates comprehensive reports in multiple formats:

- **JSON**: Machine-readable detailed results
- **HTML**: Interactive visual reports with charts
- **CSV**: Raw data for further analysis

### Report Location

All reports are saved to `./tests/load/reports/` with timestamps:
```
tests/load/reports/
├── metrics/
│   └── performance-metrics-2024-01-15T10-30-00-000Z.json
├── load-test-suite-2024-01-15T10-30-00-000Z-results.json
├── load-test-report-2024-01-15T10-30-00-000Z.html
└── suite-metrics-2024-01-15T10-30-00-000Z.csv
```

### Performance Grades

The system assigns performance grades based on metrics:

- **A (90-100)**: Excellent - Ready for production
- **B (80-89)**: Good - Minor optimizations recommended
- **C (70-79)**: Average - Performance improvements needed
- **D (60-69)**: Below Average - Significant improvements required
- **F (0-59)**: Poor - Not production-ready

### Key Performance Indicators

| KPI | Target | Measurement |
|-----|--------|-------------|
| Response Time (95th percentile) | <500ms | API endpoint latency |
| Success Rate | >95% | Request completion rate |
| Throughput | >100 req/s | Requests per second |
| Concurrent Users | 200+ | Simultaneous user capacity |
| WebSocket Latency | <100ms | Real-time message delay |
| Database Query Time | <200ms | Database operation latency |
| Cache Hit Rate | >80% | Redis cache efficiency |

## 🔧 Configuration Options

### Test Suite Configuration

```javascript
const config = {
  // Basic settings
  testSuiteName: 'GUI-LOP Load Test Suite',
  outputDirectory: './tests/load/reports',
  parallelExecution: false,           // Run tests in parallel
  continueOnFailure: true,             // Continue on individual test failures

  // Load targets
  targetConcurrentUsers: 200,
  targetResponseTime: 500,            // 95th percentile in ms
  targetSuccessRate: 0.95,           // 95%
  targetThroughput: 100,             // requests per second

  // Scenarios to run
  testScenarios: ['authentication', 'workflows', 'websocket', 'database', 'redis'],

  // Performance thresholds
  performanceThresholds: {
    authentication: {
      p95ResponseTime: 500,
      p99ResponseTime: 1000,
      successRate: 0.95
    },
    workflows: {
      p95ResponseTime: 500,
      p99ResponseTime: 1000,
      successRate: 0.95,
      throughput: 10
    },
    // ... other scenarios
  }
};
```

### Individual Test Configuration

Each test scenario can be customized:

```javascript
// Authentication test configuration
const authConfig = {
  concurrentUsers: 50,
  testDuration: 60000,              // 1 minute
  rampUpTime: 15000,                // 15 seconds
  baseURL: 'http://localhost:3001'
};

// Workflow test configuration
const workflowConfig = {
  concurrentUsers: 30,
  workflowsPerUser: 5,
  testDuration: 120000,             // 2 minutes
  rampUpTime: 20000                 // 20 seconds
};
```

## 🎯 Best Practices

### Test Planning

1. **Start Small**: Begin with fewer concurrent users and gradually increase
2. **Baseline First**: Establish baseline performance metrics
3. **Test Incrementally**: Add load in phases to identify breaking points
4. **Monitor Continuously**: Use real-time monitoring during tests
5. **Document Results**: Keep historical data for trend analysis

### Test Execution

1. **Warm-up Period**: Allow systems to stabilize before measuring
2. **Realistic Scenarios**: Simulate actual user behavior patterns
3. **Sufficient Duration**: Run tests long enough to capture steady-state behavior
4. **Multiple Runs**: Execute tests multiple times for consistent results
5. **Environment Isolation**: Use dedicated test environments

### Analysis and Optimization

1. **Identify Bottlenecks**: Focus on the slowest components first
2. **Prioritize Issues**: Address critical performance problems before minor ones
3. **Validate Fixes**: Re-run tests after optimizations to verify improvements
4. **Monitor Trends**: Track performance over time to detect regressions
5. **Set Alerts**: Configure monitoring alerts for production environments

## 🔍 Troubleshooting

### Common Issues

#### Test Failures

1. **Connection Refused**: Ensure the GUI-LOP server is running
2. **Database Errors**: Verify PostgreSQL is accessible and configured
3. **Redis Errors**: Check Redis connection and availability
4. **Memory Issues**: Reduce concurrent users or increase available memory
5. **Timeout Errors**: Increase timeout values or optimize performance

#### Performance Issues

1. **High Response Times**: Check database queries and application code
2. **Low Success Rates**: Investigate error logs and failure patterns
3. **Memory Leaks**: Monitor memory usage during extended tests
4. **Connection Limits**: Adjust database and connection pool settings
5. **Resource Contention**: Identify competing processes or resource bottlenecks

### Debug Mode

Enable detailed logging for troubleshooting:

```javascript
const suite = new AutomatedLoadTestSuite({
  enableMonitoring: true,
  enableHTMLReports: true,
  continueOnFailure: true,

  testConfigurations: {
    authentication: {
      concurrentUsers: 10,  // Reduce for debugging
      testDuration: 30000    // Shorter duration
    }
  }
});

// Enable console logging
console.log('Starting load test with debug configuration...');
```

## 📚 Additional Resources

### Documentation

- [Artillery Documentation](https://artillery.io/docs/) - Load testing framework
- [Node.js Performance Best Practices](https://nodejs.org/en/docs/guides/simple-profiling/)
- [PostgreSQL Performance Tuning](https://www.postgresql.org/docs/current/performance-tips.html)
- [Redis Performance Optimization](https://redis.io/topics/optimization)

### Tools and Utilities

- **Clinic.js**: Node.js performance profiling (`npm install -g clinic`)
- **Autocannon**: HTTP benchmarking tool
- **Artillery**: Load testing and configuration
- **Chart.js**: Performance visualization (included in HTML reports)

### Performance Monitoring

- **APM Tools**: Consider New Relic, DataDog, or AppDynamics for production
- **Logging**: Implement structured logging for performance analysis
- **Metrics**: Use Prometheus/Grafana for ongoing monitoring
- **Alerting**: Set up alerts for performance degradation

## 🤝 Contributing

When adding new test scenarios:

1. Follow the existing pattern in `/scenarios/`
2. Include comprehensive error handling
3. Add performance validation
4. Update documentation
5. Add npm scripts for easy execution
6. Test with various load configurations

## 📄 License

This load testing suite is part of the GUI-LOP project and follows the same license terms.