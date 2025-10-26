/**
 * API Metrics Collection and Performance Monitoring Middleware
 * Comprehensive metrics collection for API performance, usage, and health monitoring
 */

import { performance } from 'perf_hooks';
import { createHash } from 'crypto';

/**
 * Metrics collector class
 */
export class MetricsCollector {
  constructor() {
    this.metrics = {
      requests: {
        total: 0,
        successful: 0,
        failed: 0,
        byMethod: {},
        byPath: {},
        byStatus: {},
        byUser: {},
        byHour: {},
        byDay: {}
      },
      performance: {
        averageResponseTime: 0,
        minResponseTime: Infinity,
        maxResponseTime: 0,
        responseTimes: [],
        slowQueries: [],
        timeouts: 0
      },
      users: {
        active: 0,
        total: 0,
        new: 0,
        byRole: {},
        online: new Set()
      },
      workflows: {
        total: 0,
        running: 0,
        completed: 0,
        failed: 0,
        averageExecutionTime: 0,
        byTemplate: {},
        byStatus: {}
      },
      system: {
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime(),
        cpuUsage: 0,
        errors: [],
        warnings: []
      },
      rateLimit: {
        totalBlocked: 0,
        blockedByType: {},
        topViolators: {}
      },
      cache: {
        hits: 0,
        misses: 0,
        hitRate: 0,
        size: 0
      }
    };

    this.startTime = Date.now();
    this.requestTimes = new Map();
    this.activeRequests = new Map();
  }

  /**
   * Record request start
   */
  startRequest(req) {
    const requestId = req.id || this.generateRequestId();
    const startTime = performance.now();

    this.requestTimes.set(requestId, {
      startTime,
      method: req.method,
      path: req.path,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      userId: req.user?.id || null,
      apiVersion: req.apiVersion || 'unknown'
    });

    this.activeRequests.set(requestId, {
      ...this.requestTimes.get(requestId),
      timestamp: Date.now()
    });

    return requestId;
  }

  /**
   * Record request completion
   */
  endRequest(req, res, requestId) {
    const requestData = this.requestTimes.get(requestId);
    if (!requestData) return;

    const endTime = performance.now();
    const responseTime = Math.round(endTime - requestData.startTime);

    // Update request metrics
    this.metrics.requests.total++;
    this.metrics.requests.byMethod[requestData.method] = (this.metrics.requests.byMethod[requestData.method] || 0) + 1;
    this.metrics.requests.byPath[requestData.path] = (this.metrics.requests.byPath[requestData.path] || 0) + 1;
    this.metrics.requests.byStatus[res.statusCode] = (this.metrics.requests.byStatus[res.statusCode] || 0) + 1;

    if (requestData.userId) {
      this.metrics.requests.byUser[requestData.userId] = (this.metrics.requests.byUser[requestData.userId] || 0) + 1;
    }

    // Time-based metrics
    const now = new Date();
    const hour = now.getHours();
    const day = now.toISOString().split('T')[0];

    this.metrics.requests.byHour[hour] = (this.metrics.requests.byHour[hour] || 0) + 1;
    this.metrics.requests.byDay[day] = (this.metrics.requests.byDay[day] || 0) + 1;

    // Performance metrics
    this.updatePerformanceMetrics(responseTime, req, res);

    // Success/failure tracking
    if (res.statusCode >= 200 && res.statusCode < 400) {
      this.metrics.requests.successful++;
    } else {
      this.metrics.requests.failed++;
    }

    // Clean up
    this.requestTimes.delete(requestId);
    this.activeRequests.delete(requestId);

    return {
      requestId,
      responseTime,
      method: requestData.method,
      path: requestData.path,
      statusCode: res.statusCode
    };
  }

  /**
   * Update performance metrics
   */
  updatePerformanceMetrics(responseTime, req, res) {
    const { performance } = this.metrics;

    // Update response time statistics
    performance.responseTimes.push(responseTime);

    // Keep only last 1000 response times for memory efficiency
    if (performance.responseTimes.length > 1000) {
      performance.responseTimes = performance.responseTimes.slice(-1000);
    }

    performance.minResponseTime = Math.min(performance.minResponseTime, responseTime);
    performance.maxResponseTime = Math.max(performance.maxResponseTime, responseTime);

    // Calculate average
    const sum = performance.responseTimes.reduce((a, b) => a + b, 0);
    performance.averageResponseTime = Math.round(sum / performance.responseTimes.length);

    // Track slow queries (> 1 second)
    if (responseTime > 1000) {
      performance.slowQueries.push({
        path: req.path,
        method: req.method,
        responseTime,
        timestamp: new Date().toISOString(),
        userId: req.user?.id || null
      });

      // Keep only last 100 slow queries
      if (performance.slowQueries.length > 100) {
        performance.slowQueries = performance.slowQueries.slice(-100);
      }
    }

    // Track timeouts (> 30 seconds)
    if (responseTime > 30000) {
      performance.timeouts++;
    }
  }

  /**
   * Record user activity
   */
  recordUserActivity(userId, action, details = {}) {
    if (!userId) return;

    // Update user metrics
    this.metrics.users.total++;
    this.metrics.users.online.add(userId);

    // Remove user from online set after 30 minutes of inactivity
    setTimeout(() => {
      this.metrics.users.online.delete(userId);
    }, 30 * 60 * 1000);

    this.metrics.users.active = this.metrics.users.online.size;
  }

  /**
   * Record workflow metrics
   */
  recordWorkflowEvent(event, workflowData = {}) {
    const { workflows } = this.metrics;

    switch (event) {
      case 'created':
        workflows.total++;
        break;
      case 'started':
        workflows.running++;
        break;
      case 'completed':
        workflows.running--;
        workflows.completed++;
        if (workflowData.executionTime) {
          this.updateWorkflowExecutionTime(workflowData.executionTime);
        }
        break;
      case 'failed':
        workflows.running--;
        workflows.failed++;
        break;
    }

    // Track by template
    if (workflowData.template) {
      workflows.byTemplate[workflowData.template] = (workflows.byTemplate[workflowData.template] || 0) + 1;
    }

    // Track by status
    if (workflowData.status) {
      workflows.byStatus[workflowData.status] = (workflows.byStatus[workflowData.status] || 0) + 1;
    }
  }

  /**
   * Update workflow execution time
   */
  updateWorkflowExecutionTime(executionTime) {
    const { workflows } = this.metrics;

    // Simple moving average
    workflows.averageExecutionTime = Math.round(
      (workflows.averageExecutionTime + executionTime) / 2
    );
  }

  /**
   * Record rate limit violation
   */
  recordRateLimitViolation(req, limitType) {
    const { rateLimit } = this.metrics;

    rateLimit.totalBlocked++;
    rateLimit.blockedByType[limitType] = (rateLimit.blockedByType[limitType] || 0) + 1;

    const violatorKey = req.user?.id || req.ip;
    rateLimit.topViolators[violatorKey] = (rateLimit.topViolators[violatorKey] || 0) + 1;
  }

  /**
   * Record cache metrics
   */
  recordCacheHit() {
    this.metrics.cache.hits++;
    this.updateCacheHitRate();
  }

  recordCacheMiss() {
    this.metrics.cache.misses++;
    this.updateCacheHitRate();
  }

  updateCacheHitRate() {
    const total = this.metrics.cache.hits + this.metrics.cache.misses;
    this.metrics.cache.hitRate = total > 0 ? Math.round((this.metrics.cache.hits / total) * 100) / 100 : 0;
  }

  /**
   * Record system error
   */
  recordError(error, context = {}) {
    this.metrics.system.errors.push({
      message: error.message,
      stack: error.stack,
      context,
      timestamp: new Date().toISOString()
    });

    // Keep only last 100 errors
    if (this.metrics.system.errors.length > 100) {
      this.metrics.system.errors = this.metrics.system.errors.slice(-100);
    }
  }

  /**
   * Get comprehensive metrics
   */
  getMetrics(timeframe = 'all') => {
    const now = Date.now();
    const filteredMetrics = this.filterMetricsByTimeframe(timeframe, now);

    return {
      timestamp: new Date().toISOString(),
      uptime: Math.round(now - this.startTime),
      ...filteredMetrics,
      activeRequests: this.activeRequests.size,
      topEndpoints: this.getTopEndpoints(),
      topUsers: this.getTopUsers(),
      systemHealth: this.getSystemHealth()
    };
  }

  /**
   * Filter metrics by timeframe
   */
  filterMetricsByTimeframe(timeframe, now) {
    // This is a simplified implementation
    // In production, you'd store time-series data and filter properly
    return this.metrics;
  }

  /**
   * Get top endpoints by request count
   */
  getTopEndpoints(limit = 10) {
    return Object.entries(this.metrics.requests.byPath)
      .sort(([,a], [,b]) => b - a)
      .slice(0, limit)
      .map(([path, count]) => ({ path, count }));
  }

  /**
   * Get top users by request count
   */
  getTopUsers(limit = 10) {
    return Object.entries(this.metrics.requests.byUser)
      .sort(([,a], [,b]) => b - a)
      .slice(0, limit)
      .map(([userId, count]) => ({ userId, count }));
  }

  /**
   * Get system health status
   */
  getSystemHealth() {
    const memUsage = process.memoryUsage();
    const uptime = process.uptime();

    return {
      status: this.getHealthStatus(),
      memory: {
        rss: Math.round(memUsage.rss / 1024 / 1024), // MB
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
        external: Math.round(memUsage.external / 1024 / 1024) // MB
      },
      uptime: Math.round(uptime),
      activeRequests: this.activeRequests.size,
      errorRate: this.calculateErrorRate(),
      averageResponseTime: this.metrics.performance.averageResponseTime
    };
  }

  /**
   * Get overall health status
   */
  getHealthStatus() {
    const errorRate = this.calculateErrorRate();
    const avgResponseTime = this.metrics.performance.averageResponseTime;
    const activeRequests = this.activeRequests.size;

    if (errorRate > 0.1 || avgResponseTime > 5000) {
      return 'unhealthy';
    } else if (errorRate > 0.05 || avgResponseTime > 2000 || activeRequests > 100) {
      return 'degraded';
    } else {
      return 'healthy';
    }
  }

  /**
   * Calculate error rate
   */
  calculateErrorRate() {
    const total = this.metrics.requests.total;
    return total > 0 ? this.metrics.requests.failed / total : 0;
  }

  /**
   * Generate unique request ID
   */
  generateRequestId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  /**
   * Reset metrics
   */
  reset() {
    this.metrics = {
      requests: {
        total: 0,
        successful: 0,
        failed: 0,
        byMethod: {},
        byPath: {},
        byStatus: {},
        byUser: {},
        byHour: {},
        byDay: {}
      },
      performance: {
        averageResponseTime: 0,
        minResponseTime: Infinity,
        maxResponseTime: 0,
        responseTimes: [],
        slowQueries: [],
        timeouts: 0
      },
      users: {
        active: 0,
        total: 0,
        new: 0,
        byRole: {},
        online: new Set()
      },
      workflows: {
        total: 0,
        running: 0,
        completed: 0,
        failed: 0,
        averageExecutionTime: 0,
        byTemplate: {},
        byStatus: {}
      },
      system: {
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime(),
        cpuUsage: 0,
        errors: [],
        warnings: []
      },
      rateLimit: {
        totalBlocked: 0,
        blockedByType: {},
        topViolators: {}
      },
      cache: {
        hits: 0,
        misses: 0,
        hitRate: 0,
        size: 0
      }
    };

    this.startTime = Date.now();
    this.requestTimes.clear();
    this.activeRequests.clear();
  }
}

// Global metrics collector instance
export const metricsCollector = new MetricsCollector();

/**
 * Metrics collection middleware
 */
export const metricsMiddleware = (options = {}) => {
  const {
    trackResponseTime = true,
    trackErrors = true,
    trackUserActivity = true,
    excludePaths = ['/health', '/metrics', '/favicon.ico']
  } = options;

  return (req, res, next) => {
    // Skip metrics for excluded paths
    if (excludePaths.some(path => req.path.startsWith(path))) {
      return next();
    }

    // Start timing
    const requestId = metricsCollector.startRequest(req);
    req.requestId = requestId;

    // Track response
    const originalSend = res.send;
    res.send = function(data) {
      // Record metrics before sending response
      metricsCollector.endRequest(req, res, requestId);

      // Track user activity if authenticated
      if (trackUserActivity && req.user?.id) {
        metricsCollector.recordUserActivity(req.user.id, 'api_request', {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode
        });
      }

      return originalSend.call(this, data);
    };

    // Track errors
    if (trackErrors) {
      const originalStatus = res.status;
      res.status = function(code) {
        if (code >= 400) {
          metricsCollector.recordError(new Error(`HTTP ${code}`), {
            method: req.method,
            path: req.path,
            statusCode: code,
            userId: req.user?.id || null,
            ip: req.ip
          });
        }
        return originalStatus.call(this, code);
      };
    }

    // Add metrics headers
    res.setHeader('X-Metrics-Enabled', 'true');
    res.setHeader('X-Request-ID', requestId);

    next();
  };
};

/**
 * Performance monitoring middleware
 */
export const performanceMonitoring = (options = {}) => {
  const {
    slowQueryThreshold = 1000, // ms
    timeoutThreshold = 30000, // ms
    enableProfiling = process.env.NODE_ENV === 'development'
  } = options;

  return (req, res, next) => {
    const startTime = process.hrtime.bigint();

    // Monitor response time
    res.on('finish', () => {
      const endTime = process.hrtime.bigint();
      const responseTime = Number(endTime - startTime) / 1000000; // Convert to milliseconds

      if (responseTime > slowQueryThreshold) {
        console.warn(`Slow query detected: ${req.method} ${req.path} took ${responseTime.toFixed(2)}ms`);
      }

      if (responseTime > timeoutThreshold) {
        console.error(`Request timeout: ${req.method} ${req.path} took ${responseTime.toFixed(2)}ms`);
      }
    });

    // Enable CPU profiling in development
    if (enableProfiling && req.query.profile === 'true') {
      const startCpuUsage = process.cpuUsage();

      res.on('finish', () => {
        const cpuUsage = process.cpuUsage(startCpuUsage);
        console.log(`CPU usage for ${req.method} ${req.path}:`, cpuUsage);
      });
    }

    next();
  };
};

/**
 * System metrics collector
 */
export const systemMetricsCollector = () => {
  return {
    /**
     * Get current system metrics
     */
    getSystemMetrics() {
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();

      return {
        timestamp: new Date().toISOString(),
        process: {
          pid: process.pid,
          uptime: process.uptime(),
          memory: {
            rss: Math.round(memUsage.rss / 1024 / 1024), // MB
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
            external: Math.round(memUsage.external / 1024 / 1024), // MB
            arrayBuffers: Math.round((memUsage.arrayBuffers || 0) / 1024 / 1024) // MB
          },
          cpu: {
            user: cpuUsage.user,
            system: cpuUsage.system
          }
        },
        api: metricsCollector.getMetrics()
      };
    },

    /**
     * Get Prometheus-formatted metrics
     */
    getPrometheusMetrics() {
      const metrics = metricsCollector.getMetrics();
      const systemMetrics = this.getSystemMetrics();

      let prometheusMetrics = '';

      // Request metrics
      prometheusMetrics += `# HELP api_requests_total Total number of API requests\n`;
      prometheusMetrics += `# TYPE api_requests_total counter\n`;
      prometheusMetrics += `api_requests_total ${metrics.requests.total}\n\n`;

      prometheusMetrics += `# HELP api_request_duration_seconds API request duration\n`;
      prometheusMetrics += `# TYPE api_request_duration_seconds histogram\n`;
      prometheusMetrics += `api_request_duration_seconds_sum ${metrics.performance.averageResponseTime / 1000}\n`;
      prometheusMetrics += `api_request_duration_seconds_count ${metrics.requests.total}\n\n`;

      // Memory metrics
      prometheusMetrics += `# HELP process_memory_bytes Process memory usage\n`;
      prometheusMetrics += `# TYPE process_memory_bytes gauge\n`;
      prometheusMetrics += `process_memory_bytes{type="rss"} ${systemMetrics.process.memory.rss * 1024 * 1024}\n`;
      prometheusMetrics += `process_memory_bytes{type="heap_used"} ${systemMetrics.process.memory.heapUsed * 1024 * 1024}\n`;
      prometheusMetrics += `process_memory_bytes{type="heap_total"} ${systemMetrics.process.memory.heapTotal * 1024 * 1024}\n\n`;

      // User metrics
      prometheusMetrics += `# HELP api_users_active Active users\n`;
      prometheusMetrics += `# TYPE api_users_active gauge\n`;
      prometheusMetrics += `api_users_active ${metrics.users.active}\n\n`;

      // Workflow metrics
      prometheusMetrics += `# HELP api_workflows_total Total workflows\n`;
      prometheusMetrics += `# TYPE api_workflows_total counter\n`;
      prometheusMetrics += `api_workflows_total ${metrics.workflows.total}\n`;

      prometheusMetrics += `# HELP api_workflows_running Running workflows\n`;
      prometheusMetrics += `# TYPE api_workflows_running gauge\n`;
      prometheusMetrics += `api_workflows_running ${metrics.workflows.running}\n\n`;

      return prometheusMetrics;
    }
  };
};

/**
 * Metrics API routes
 */
export const createMetricsRoutes = (app) => {
  const systemCollector = systemMetricsCollector();

  // Get comprehensive metrics
  app.get('/api/v1/metrics', (req, res) => {
    const { timeframe = 'all', format = 'json' } = req.query;

    try {
      if (format === 'prometheus') {
        const prometheusMetrics = systemCollector.getPrometheusMetrics();
        res.setHeader('Content-Type', 'text/plain');
        res.send(prometheusMetrics);
      } else {
        const metrics = metricsCollector.getMetrics(timeframe);
        res.json({
          success: true,
          message: 'Metrics retrieved successfully',
          data: metrics,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Error retrieving metrics:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve metrics',
        code: 'METRICS_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  });

  // Get system health
  app.get('/api/v1/metrics/health', (req, res) => {
    try {
      const health = metricsCollector.getSystemHealth();
      const systemMetrics = systemCollector.getSystemMetrics();

      res.json({
        success: true,
        message: 'System health retrieved successfully',
        data: {
          ...health,
          system: systemMetrics.process,
          uptime: systemMetrics.process.uptime
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error retrieving health metrics:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve health metrics',
        code: 'HEALTH_METRICS_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  });

  // Reset metrics (admin only)
  app.post('/api/v1/metrics/reset', (req, res) => {
    // Add authorization check here
    try {
      metricsCollector.reset();
      res.json({
        success: true,
        message: 'Metrics reset successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error resetting metrics:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to reset metrics',
        code: 'METRICS_RESET_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  });
};

export default {
  MetricsCollector,
  metricsCollector,
  metricsMiddleware,
  performanceMonitoring,
  systemMetricsCollector,
  createMetricsRoutes
};