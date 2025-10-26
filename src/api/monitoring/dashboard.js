/**
 * API Monitoring and Alerting Dashboard
 * Real-time monitoring dashboard with alerts and metrics visualization
 */

import { EventEmitter } from 'events';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Monitoring Dashboard Configuration
 */
const DASHBOARD_CONFIG = {
  port: process.env.DASHBOARD_PORT || 3003,
  refreshInterval: parseInt(process.env.DASHBOARD_REFRESH_INTERVAL) || 5000, // 5 seconds
  alertThresholds: {
    errorRate: 0.05, // 5% error rate
    responseTime: 2000, // 2 seconds average response time
    memoryUsage: 0.8, // 80% memory usage
    activeRequests: 100, // 100 active requests
    rateLimitHits: 10 // 10 rate limit hits per minute
  },
  retentionPeriod: 24 * 60 * 60 * 1000, // 24 hours
  maxDataPoints: 1000
};

/**
 * Monitoring Data Collector
 */
class MonitoringDataCollector extends EventEmitter {
  constructor() {
    super();
    this.metrics = {
      requests: {
        total: 0,
        successful: 0,
        failed: 0,
        byEndpoint: new Map(),
        byMethod: new Map(),
        byStatus: new Map(),
        responseTime: [],
        rateLimitHits: 0
      },
      users: {
        active: new Set(),
        total: 0,
        new: 0,
        byRole: new Map()
      },
      workflows: {
        total: 0,
        running: 0,
        completed: 0,
        failed: 0,
        byTemplate: new Map(),
        averageExecutionTime: 0
      },
      system: {
        memory: [],
        cpu: [],
        uptime: 0,
        errors: [],
        warnings: []
      },
      performance: {
        slowQueries: [],
        timeouts: 0,
        cacheHits: 0,
        cacheMisses: 0
      }
    };

    this.timeSeriesData = [];
    this.alerts = [];
    this.startTime = Date.now();

    // Start data collection
    this.startDataCollection();
  }

  /**
   * Record API request
   */
  recordRequest(req, res, responseTime) {
    const now = Date.now();

    // Update basic metrics
    this.metrics.requests.total++;
    this.metrics.requests.responseTime.push(responseTime);

    // Keep response time history manageable
    if (this.metrics.requests.responseTime.length > DASHBOARD_CONFIG.maxDataPoints) {
      this.metrics.requests.responseTime = this.metrics.requests.responseTime.slice(-DASHBOARD_CONFIG.maxDataPoints);
    }

    // Update method metrics
    const method = req.method;
    this.metrics.requests.byMethod.set(method, (this.metrics.requests.byMethod.get(method) || 0) + 1);

    // Update status metrics
    const status = res.statusCode;
    this.metrics.requests.byStatus.set(status, (this.metrics.requests.byStatus.get(status) || 0) + 1);

    // Update endpoint metrics
    const endpoint = req.route?.path || req.path;
    if (!this.metrics.requests.byEndpoint.has(endpoint)) {
      this.metrics.requests.byEndpoint.set(endpoint, {
        total: 0,
        successful: 0,
        failed: 0,
        averageResponseTime: 0,
        responseTimeSum: 0
      });
    }

    const endpointStats = this.metrics.requests.byEndpoint.get(endpoint);
    endpointStats.total++;
    endpointStats.responseTimeSum += responseTime;
    endpointStats.averageResponseTime = endpointStats.responseTimeSum / endpointStats.total;

    if (status >= 200 && status < 400) {
      this.metrics.requests.successful++;
      endpointStats.successful++;
    } else {
      this.metrics.requests.failed++;
      endpointStats.failed++;

      // Record error
      this.recordError({
        message: `HTTP ${status}: ${req.method} ${endpoint}`,
        code: `HTTP_${status}`,
        timestamp: new Date().toISOString(),
        context: {
          method: req.method,
          path: req.path,
          status,
          userId: req.user?.id,
          ip: req.ip
        }
      });
    }

    // Check for slow queries
    if (responseTime > 1000) {
      this.metrics.performance.slowQueries.push({
        method: req.method,
        path: req.path,
        responseTime,
        timestamp: new Date().toISOString(),
        userId: req.user?.id
      });

      // Keep slow queries history manageable
      if (this.metrics.performance.slowQueries.length > 100) {
        this.metrics.performance.slowQueries = this.metrics.performance.slowQueries.slice(-100);
      }
    }

    // Emit data update event
    this.emit('dataUpdate', this.getCurrentMetrics());
  }

  /**
   * Record user activity
   */
  recordUserActivity(userId, action, details = {}) {
    this.metrics.users.active.add(userId);
    this.metrics.users.total++;

    // Track by role if available
    if (details.role) {
      this.metrics.users.byRole.set(details.role, (this.metrics.users.byRole.get(details.role) || 0) + 1);
    }

    this.emit('dataUpdate', this.getCurrentMetrics());
  }

  /**
   * Record workflow event
   */
  recordWorkflowEvent(event, workflowData = {}) {
    switch (event) {
      case 'created':
        this.metrics.workflows.total++;
        break;
      case 'started':
        this.metrics.workflows.running++;
        break;
      case 'completed':
        this.metrics.workflows.running--;
        this.metrics.workflows.completed++;
        if (workflowData.executionTime) {
          this.updateWorkflowExecutionTime(workflowData.executionTime);
        }
        break;
      case 'failed':
        this.metrics.workflows.running--;
        this.metrics.workflows.failed++;
        break;
    }

    // Track by template
    if (workflowData.template) {
      this.metrics.workflows.byTemplate.set(
        workflowData.template,
        (this.metrics.workflows.byTemplate.get(workflowData.template) || 0) + 1
      );
    }

    this.emit('dataUpdate', this.getCurrentMetrics());
  }

  /**
   * Update workflow execution time
   */
  updateWorkflowExecutionTime(executionTime) {
    // Simple moving average
    this.metrics.workflows.averageExecutionTime = Math.round(
      (this.metrics.workflows.averageExecutionTime + executionTime) / 2
    );
  }

  /**
   * Record system metrics
   */
  recordSystemMetrics() {
    const memUsage = process.memoryUsage();
    const uptime = process.uptime();

    // Memory metrics
    this.metrics.system.memory.push({
      timestamp: new Date().toISOString(),
      rss: memUsage.rss,
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external
    });

    // Keep memory history manageable
    if (this.metrics.system.memory.length > DASHBOARD_CONFIG.maxDataPoints) {
      this.metrics.system.memory = this.metrics.system.memory.slice(-DASHBOARD_CONFIG.maxDataPoints);
    }

    this.metrics.system.uptime = uptime;

    // Check for alerts
    this.checkAlerts();
  }

  /**
   * Record error
   */
  recordError(error) {
    this.metrics.system.errors.push({
      ...error,
      id: Date.now().toString()
    });

    // Keep error history manageable
    if (this.metrics.system.errors.length > 100) {
      this.metrics.system.errors = this.metrics.system.errors.slice(-100);
    }

    this.emit('error', error);
  }

  /**
   * Record warning
   */
  recordWarning(warning) {
    this.metrics.system.warnings.push({
      ...warning,
      id: Date.now().toString()
    });

    // Keep warning history manageable
    if (this.metrics.system.warnings.length > 50) {
      this.metrics.system.warnings = this.metrics.system.warnings.slice(-50);
    }

    this.emit('warning', warning);
  }

  /**
   * Record rate limit hit
   */
  recordRateLimitHit(req) {
    this.metrics.requests.rateLimitHits++;
    this.recordWarning({
      message: `Rate limit exceeded for ${req.ip}`,
      code: 'RATE_LIMIT_EXCEEDED',
      timestamp: new Date().toISOString(),
      context: {
        ip: req.ip,
        path: req.path,
        method: req.method,
        userId: req.user?.id
      }
    });
  }

  /**
   * Record cache metrics
   */
  recordCacheHit() {
    this.metrics.performance.cacheHits++;
  }

  recordCacheMiss() {
    this.metrics.performance.cacheMisses++;
  }

  /**
   * Check for alerts based on thresholds
   */
  checkAlerts() {
    const currentMetrics = this.getCurrentMetrics();
    const alerts = [];

    // Error rate alert
    if (currentMetrics.errorRate > DASHBOARD_CONFIG.alertThresholds.errorRate) {
      alerts.push({
        type: 'error_rate',
        severity: 'critical',
        message: `High error rate: ${(currentMetrics.errorRate * 100).toFixed(2)}%`,
        value: currentMetrics.errorRate,
        threshold: DASHBOARD_CONFIG.alertThresholds.errorRate,
        timestamp: new Date().toISOString()
      });
    }

    // Response time alert
    if (currentMetrics.averageResponseTime > DASHBOARD_CONFIG.alertThresholds.responseTime) {
      alerts.push({
        type: 'response_time',
        severity: 'warning',
        message: `High average response time: ${currentMetrics.averageResponseTime}ms`,
        value: currentMetrics.averageResponseTime,
        threshold: DASHBOARD_CONFIG.alertThresholds.responseTime,
        timestamp: new Date().toISOString()
      });
    }

    // Memory usage alert
    const memUsage = process.memoryUsage();
    const memoryUsagePercent = memUsage.heapUsed / memUsage.heapTotal;
    if (memoryUsagePercent > DASHBOARD_CONFIG.alertThresholds.memoryUsage) {
      alerts.push({
        type: 'memory_usage',
        severity: 'warning',
        message: `High memory usage: ${(memoryUsagePercent * 100).toFixed(2)}%`,
        value: memoryUsagePercent,
        threshold: DASHBOARD_CONFIG.alertThresholds.memoryUsage,
        timestamp: new Date().toISOString()
      });
    }

    // Active requests alert
    if (currentMetrics.activeRequests > DASHBOARD_CONFIG.alertThresholds.activeRequests) {
      alerts.push({
        type: 'active_requests',
        severity: 'warning',
        message: `High number of active requests: ${currentMetrics.activeRequests}`,
        value: currentMetrics.activeRequests,
        threshold: DASHBOARD_CONFIG.alertThresholds.activeRequests,
        timestamp: new Date().toISOString()
      });
    }

    // Rate limit hits alert
    const rateLimitHitsPerMinute = this.metrics.requests.rateLimitHits;
    if (rateLimitHitsPerMinute > DASHBOARD_CONFIG.alertThresholds.rateLimitHits) {
      alerts.push({
        type: 'rate_limit',
        severity: 'info',
        message: `High rate limit activity: ${rateLimitHitsPerMinute} hits`,
        value: rateLimitHitsPerMinute,
        threshold: DASHBOARD_CONFIG.alertThresholds.rateLimitHits,
        timestamp: new Date().toISOString()
      });
    }

    // Emit alerts
    alerts.forEach(alert => {
      this.alerts.push(alert);
      this.emit('alert', alert);
    });

    // Keep alert history manageable
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-100);
    }
  }

  /**
   * Get current metrics
   */
  getCurrentMetrics() {
    const now = Date.now();
    const memUsage = process.memoryUsage();

    return {
      timestamp: new Date().toISOString(),
      uptime: Math.round((now - this.startTime) / 1000),
      requests: {
        total: this.metrics.requests.total,
        successful: this.metrics.requests.successful,
        failed: this.metrics.requests.failed,
        errorRate: this.metrics.requests.total > 0 ? this.metrics.requests.failed / this.metrics.requests.total : 0,
        averageResponseTime: this.metrics.requests.responseTime.length > 0
          ? Math.round(this.metrics.requests.responseTime.reduce((sum, time) => sum + time, 0) / this.metrics.requests.responseTime.length)
          : 0,
        rateLimitHits: this.metrics.requests.rateLimitHits,
        byMethod: Object.fromEntries(this.metrics.requests.byMethod),
        byStatus: Object.fromEntries(this.metrics.requests.byStatus),
        topEndpoints: Array.from(this.metrics.requests.byEndpoint.entries())
          .map(([path, stats]) => ({ path, ...stats }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 10)
      },
      users: {
        active: this.metrics.users.active.size,
        total: this.metrics.users.total,
        byRole: Object.fromEntries(this.metrics.users.byRole)
      },
      workflows: {
        total: this.metrics.workflows.total,
        running: this.metrics.workflows.running,
        completed: this.metrics.workflows.completed,
        failed: this.metrics.workflows.failed,
        averageExecutionTime: this.metrics.workflows.averageExecutionTime,
        byTemplate: Object.fromEntries(this.metrics.workflows.byTemplate)
      },
      system: {
        memory: {
          rss: memUsage.rss,
          heapUsed: memUsage.heapUsed,
          heapTotal: memUsage.heapTotal,
          external: memUsage.external,
          usagePercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100)
        },
        uptime: this.metrics.system.uptime,
        errors: this.metrics.system.errors.slice(-10),
        warnings: this.metrics.system.warnings.slice(-5)
      },
      performance: {
        slowQueries: this.metrics.performance.slowQueries.slice(-5),
        timeouts: this.metrics.performance.timeouts,
        cacheHits: this.metrics.performance.cacheHits,
        cacheMisses: this.metrics.performance.cacheMisses,
        cacheHitRate: this.metrics.performance.cacheHits + this.metrics.performance.cacheMisses > 0
          ? Math.round((this.metrics.performance.cacheHits / (this.metrics.performance.cacheHits + this.metrics.performance.cacheMisses)) * 100)
          : 0
      },
      alerts: this.alerts.slice(-10)
    };
  }

  /**
   * Get historical data
   */
  getHistoricalData(period = '1h') {
    const now = Date.now();
    let cutoffTime;

    switch (period) {
      case '1h':
        cutoffTime = now - (60 * 60 * 1000);
        break;
      case '24h':
        cutoffTime = now - (24 * 60 * 60 * 1000);
        break;
      case '7d':
        cutoffTime = now - (7 * 24 * 60 * 60 * 1000);
        break;
      default:
        cutoffTime = now - (60 * 60 * 1000);
    }

    return this.timeSeriesData.filter(point => point.timestamp > cutoffTime);
  }

  /**
   * Start data collection
   */
  startDataCollection() {
    // Collect system metrics every 5 seconds
    setInterval(() => {
      this.recordSystemMetrics();
    }, 5000);

    // Clean up old data every hour
    setInterval(() => {
      this.cleanupOldData();
    }, 60 * 60 * 1000);
  }

  /**
   * Clean up old data
   */
  cleanupOldData() {
    const cutoffTime = Date.now() - DASHBOARD_CONFIG.retentionPeriod;

    // Clean up time series data
    this.timeSeriesData = this.timeSeriesData.filter(point => point.timestamp > cutoffTime);

    // Clean up old alerts
    this.alerts = this.alerts.filter(alert => Date.now() - new Date(alert.timestamp).getTime() < DASHBOARD_CONFIG.retentionPeriod);
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.metrics = {
      requests: {
        total: 0,
        successful: 0,
        failed: 0,
        byEndpoint: new Map(),
        byMethod: new Map(),
        byStatus: new Map(),
        responseTime: [],
        rateLimitHits: 0
      },
      users: {
        active: new Set(),
        total: 0,
        new: 0,
        byRole: new Map()
      },
      workflows: {
        total: 0,
        running: 0,
        completed: 0,
        failed: 0,
        byTemplate: new Map(),
        averageExecutionTime: 0
      },
      system: {
        memory: [],
        cpu: [],
        uptime: 0,
        errors: [],
        warnings: []
      },
      performance: {
        slowQueries: [],
        timeouts: 0,
        cacheHits: 0,
        cacheMisses: 0
      }
    };

    this.timeSeriesData = [];
    this.alerts = [];
    this.startTime = Date.now();

    this.emit('reset');
  }
}

/**
 * Dashboard Server
 */
class DashboardServer {
  constructor(dataCollector) {
    this.dataCollector = dataCollector;
    this.server = null;
    this.io = null;
    this.connectedClients = new Set();
  }

  /**
   * Start the dashboard server
   */
  start() {
    const express = require('express');
    const app = express();
    const httpServer = createServer(app);
    const io = new SocketIOServer(httpServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    this.server = httpServer;
    this.io = io;

    // Setup routes
    this.setupRoutes(app);
    this.setupSocketIO(io);

    // Start listening
    this.server.listen(DASHBOARD_CONFIG.port, () => {
      console.log(`🚀 API Dashboard server running on http://localhost:${DASHBOARD_CONFIG.port}`);
    });

    // Handle server errors
    this.server.on('error', (error) => {
      console.error('Dashboard server error:', error);
    });
  }

  /**
   * Setup Express routes
   */
  setupRoutes(app) {
    // Serve static files
    app.use(express.static(path.join(__dirname, 'public')));

    // API routes
    app.get('/api/metrics', (req, res) => {
      res.json({
        success: true,
        data: this.dataCollector.getCurrentMetrics(),
        timestamp: new Date().toISOString()
      });
    });

    app.get('/api/historical', (req, res) => {
      const { period = '1h' } = req.query;
      res.json({
        success: true,
        data: this.dataCollector.getHistoricalData(period),
        timestamp: new Date().toISOString()
      });
    });

    app.get('/api/alerts', (req, res) => {
      const { limit = 50 } = req.query;
      const alerts = this.dataCollector.alerts.slice(-limit);
      res.json({
        success: true,
        data: alerts,
        timestamp: new Date().toISOString()
      });
    });

    app.post('/api/reset', (req, res) => {
      this.dataCollector.reset();
      res.json({
        success: true,
        message: 'Dashboard metrics reset',
        timestamp: new Date().toISOString()
      });
    });

    // Serve main dashboard page
    app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
  }

  /**
   * Setup Socket.IO for real-time updates
   */
  setupSocketIO(io) {
    io.on('connection', (socket) => {
      this.connectedClients.add(socket);
      console.log(`Dashboard client connected: ${socket.id}`);

      // Send initial data
      socket.emit('metrics', this.dataCollector.getCurrentMetrics());
      socket.emit('alerts', this.dataCollector.alerts);

      // Handle client disconnection
      socket.on('disconnect', () => {
        this.connectedClients.delete(socket);
        console.log(`Dashboard client disconnected: ${socket.id}`);
      });

      // Handle client requests
      socket.on('requestMetrics', () => {
        socket.emit('metrics', this.dataCollector.getCurrentMetrics());
      });

      socket.on('requestHistorical', (period) => {
        socket.emit('historical', this.dataCollector.getHistoricalData(period));
      });
    });

    // Listen to data collector events
    this.dataCollector.on('dataUpdate', (metrics) => {
      io.emit('metrics', metrics);
    });

    this.dataCollector.on('alert', (alert) => {
      io.emit('alert', alert);
    });

    this.dataCollector.on('error', (error) => {
      io.emit('error', error);
    });

    this.dataCollector.on('warning', (warning) => {
      io.emit('warning', warning);
    });

    this.dataCollector.on('reset', () => {
      io.emit('reset');
    });
  }

  /**
   * Stop the dashboard server
   */
  stop() {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(resolve);
      });
    }
    return Promise.resolve();
  }

  /**
   * Get connected clients count
   */
  getConnectedClientsCount() {
    return this.connectedClients.size;
  }
}

/**
 * Create HTML dashboard interface
 */
export const createDashboardHTML = () => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GUI-LOP API Monitoring Dashboard</title>
    <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1a1a1a;
            color: #ffffff;
            line-height: 1.6;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px;
        }

        header {
            background: #2a2a2a;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .logo {
            font-size: 24px;
            font-weight: bold;
            color: #00d4ff;
        }

        .status {
            display: flex;
            gap: 20px;
            align-items: center;
        }

        .status-indicator {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: #00ff00;
        }

        .dashboard {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 20px;
        }

        .card {
            background: #2a2a2a;
            border-radius: 8px;
            padding: 20px;
            border: 1px solid #3a3a3a;
        }

        .card h3 {
            margin-bottom: 15px;
            color: #00d4ff;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .metric-value {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 5px;
        }

        .metric-label {
            color: #888;
            font-size: 14px;
        }

        .metric-change {
            font-size: 12px;
            padding: 2px 6px;
            border-radius: 4px;
        }

        .metric-change.positive {
            background: #28a745;
            color: white;
        }

        .metric-change.negative {
            background: #dc3545;
            color: white;
        }

        .alerts {
            max-height: 300px;
            overflow-y: auto;
        }

        .alert {
            padding: 10px;
            margin-bottom: 10px;
            border-radius: 4px;
            border-left: 4px solid;
        }

        .alert.critical {
            border-left-color: #dc3545;
            background: #2d1b1b;
        }

        .alert.warning {
            border-left-color: #ffc107;
            background: #2b2a1b;
        }

        .alert.info {
            border-left-color: #17a2b8;
            background: #1b2a2d;
        }

        .chart-container {
            position: relative;
            height: 200px;
            margin-top: 15px;
        }

        .connection-status {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #2a2a2a;
            padding: 10px 15px;
            border-radius: 20px;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .connection-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #00ff00;
            animation: pulse 2s infinite;
        }

        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
        }

        .table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
        }

        .table th,
        .table td {
            padding: 8px 12px;
            text-align: left;
            border-bottom: 1px solid #3a3a3a;
        }

        .table th {
            background: #333;
            font-weight: 600;
        }

        .refresh-btn {
            background: #00d4ff;
            color: #1a1a1a;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 600;
        }

        .refresh-btn:hover {
            background: #00a8cc;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div class="logo">🚀 GUI-LOP API Dashboard</div>
            <div class="status">
                <div class="status-indicator"></div>
                <span id="connectionStatus">Connected</span>
                <button class="refresh-btn" onclick="requestRefresh()">Refresh</button>
            </div>
        </header>

        <div class="dashboard">
            <!-- Requests Card -->
            <div class="card">
                <h3>Requests</h3>
                <div class="metric-value" id="totalRequests">0</div>
                <div class="metric-label">Total Requests</div>
                <div class="metric-change positive" id="requestRate">0 req/min</div>
            </div>

            <!-- Success Rate Card -->
            <div class="card">
                <h3>Success Rate</h3>
                <div class="metric-value" id="successRate">100%</div>
                <div class="metric-label">Success Rate</div>
                <div class="metric-change" id="errorCount">0 errors</div>
            </div>

            <!-- Response Time Card -->
            <div class="card">
                <h3>Response Time</h3>
                <div class="metric-value" id="avgResponseTime">0ms</div>
                <div class="metric-label">Average</div>
                <div class="metric-change" id="slowQueries">0 slow queries</div>
            </div>

            <!-- Active Users Card -->
            <div class="card">
                <h3>Users</h3>
                <div class="metric-value" id="activeUsers">0</div>
                <div class="metric-label">Active Users</div>
                <div class="metric-change" id="totalUsers">0 total</div>
            </div>

            <!-- Workflows Card -->
            <div class="card">
                <h3>Workflows</h3>
                <div class="metric-value" id="runningWorkflows">0</div>
                <div class="metric-label">Running</div>
                <div class="metric-change" id="completedWorkflows">0 completed</div>
            </div>

            <!-- Memory Usage Card -->
            <div class="card">
                <h3>Memory</h3>
                <div class="metric-value" id="memoryUsage">0%</div>
                <div class="metric-label">Heap Usage</div>
                <div class="metric-change" id="memoryDetails">0 MB</div>
            </div>
        </div>

        <!-- Charts Row -->
        <div class="dashboard">
            <!-- Response Time Chart -->
            <div class="card" style="grid-column: span 2;">
                <h3>Response Time Trend</h3>
                <div class="chart-container">
                    <canvas id="responseTimeChart"></canvas>
                </div>
            </div>

            <!-- Request Volume Chart -->
            <div class="card" style="grid-column: span 2;">
                <h3>Request Volume</h3>
                <div class="chart-container">
                    <canvas id="requestVolumeChart"></canvas>
                </div>
            </div>
        </div>

        <!-- Alerts -->
        <div class="card">
            <h3>Recent Alerts</h3>
            <div class="alerts" id="alertsContainer">
                <div style="text-align: center; color: #888; padding: 20px;">
                    No alerts
                </div>
            </div>
        </div>

        <!-- Top Endpoints -->
        <div class="card">
            <h3>Top Endpoints</h3>
            <table class="table">
                <thead>
                    <tr>
                        <th>Endpoint</th>
                        <th>Requests</th>
                        <th>Avg Time</th>
                        <th>Success Rate</th>
                    </tr>
                </thead>
                <tbody id="topEndpointsTable">
                    <tr>
                        <td colspan="4" style="text-align: center; color: #888;">
                            No data available
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>

    <div class="connection-status">
        <div class="connection-dot"></div>
        <span id="connectionText">Connected</span>
    </div>

    <script>
        // Initialize Socket.IO connection
        const socket = io();
        let charts = {};

        // Socket.IO event handlers
        socket.on('connect', () => {
            updateConnectionStatus(true);
            console.log('Connected to dashboard server');
        });

        socket.on('disconnect', () => {
            updateConnectionStatus(false);
            console.log('Disconnected from dashboard server');
        });

        socket.on('metrics', updateMetrics);
        socket.on('alerts', updateAlerts);
        socket.on('error', (error) => {
            console.error('Dashboard error:', error);
        });

        // Update functions
        function updateMetrics(metrics) {
            // Update request metrics
            document.getElementById('totalRequests').textContent = metrics.requests.total.toLocaleString();
            document.getElementById('successRate').textContent = Math.round((1 - metrics.requests.errorRate) * 100) + '%';
            document.getElementById('errorCount').textContent = metrics.requests.failed + ' errors';
            document.getElementById('avgResponseTime').textContent = metrics.requests.averageResponseTime + 'ms';
            document.getElementById('slowQueries').textContent = metrics.performance.slowQueries.length + ' slow queries';

            // Update user metrics
            document.getElementById('activeUsers').textContent = metrics.users.active;
            document.getElementById('totalUsers').textContent = metrics.users.total + ' total';

            // Update workflow metrics
            document.getElementById('runningWorkflows').textContent = metrics.workflows.running;
            document.getElementById('completedWorkflows').textContent = metrics.workflows.completed;

            // Update memory metrics
            document.getElementById('memoryUsage').textContent = metrics.system.memory.usagePercent + '%';
            document.getElementById('memoryDetails').textContent = Math.round(metrics.system.memory.heapUsed / 1024 / 1024) + ' MB';

            // Update top endpoints
            updateTopEndpoints(metrics.requests.topEndpoints);

            // Update charts
            updateCharts(metrics);
        }

        function updateAlerts(alerts) {
            const container = document.getElementById('alertsContainer');

            if (alerts.length === 0) {
                container.innerHTML = '<div style="text-align: center; color: #888; padding: 20px;">No alerts</div>';
                return;
            }

            container.innerHTML = alerts.map(alert => {
                const alertClass = alert.severity;
                return \`
                    <div class="alert \${alertClass}">
                        <strong>\${alert.type.toUpperCase()}</strong> - \${alert.message}
                        <br><small>\${new Date(alert.timestamp).toLocaleString()}</small>
                    </div>
                \`;
            }).join('');
        }

        function updateTopEndpoints(endpoints) {
            const tbody = document.getElementById('topEndpointsTable');

            if (endpoints.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #888;">No data available</td></tr>';
                return;
            }

            tbody.innerHTML = endpoints.map(endpoint => {
                const successRate = endpoint.total > 0 ? Math.round((endpoint.successful / endpoint.total) * 100) : 0;
                return \`
                    <tr>
                        <td>\${endpoint.path}</td>
                        <td>\${endpoint.total.toLocaleString()}</td>
                        <td>\${Math.round(endpoint.averageResponseTime)}ms</td>
                        <td>\${successRate}%</td>
                    </tr>
                \`;
            }).join('');
        }

        function updateConnectionStatus(connected) {
            const dot = document.querySelector('.connection-dot');
            const text = document.getElementById('connectionText');
            const status = document.getElementById('connectionStatus');

            if (connected) {
                dot.style.background = '#00ff00';
                text.textContent = 'Connected';
                status.textContent = 'Connected';
            } else {
                dot.style.background = '#ff0000';
                text.textContent = 'Disconnected';
                status.textContent = 'Disconnected';
            }
        }

        function updateCharts(metrics) {
            // Initialize charts if not already done
            if (!charts.responseTime) {
                initializeCharts();
            }

            // Update response time chart
            if (charts.responseTime && metrics.requests.responseTime.length > 0) {
                const labels = metrics.requests.responseTime.map((_, i) => \`\${i}\`);
                updateChart(charts.responseTime, labels, metrics.requests.responseTime);
            }

            // Update request volume chart
            if (charts.requestVolume) {
                const volumeData = generateVolumeData();
                updateChart(charts.requestVolume, volumeData.labels, volumeData.values);
            }
        }

        function initializeCharts() {
            // Response time chart
            const responseTimeCtx = document.getElementById('responseTimeChart').getContext('2d');
            charts.responseTime = new Chart(responseTimeCtx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [{
                        label: 'Response Time (ms)',
                        data: [],
                        borderColor: '#00d4ff',
                        backgroundColor: 'rgba(0, 212, 255, 0.1)',
                        tension: 0.4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: { color: '#3a3a3a' },
                            ticks: { color: '#888' }
                        },
                        x: {
                            grid: { color: '#3a3a3a' },
                            ticks: { color: '#888' }
                        }
                    },
                    plugins: {
                        legend: {
                            labels: { color: '#888' }
                        }
                    }
                }
            });

            // Request volume chart
            const requestVolumeCtx = document.getElementById('requestVolumeChart').getContext('2d');
            charts.requestVolume = new Chart(requestVolumeCtx, {
                type: 'bar',
                data: {
                    labels: [],
                    datasets: [{
                        label: 'Requests',
                        data: [],
                        backgroundColor: '#28a745',
                        borderColor: '#28a745',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: { color: '#3a3a3a' },
                            ticks: { color: '#888' }
                        },
                        x: {
                            grid: { color: '#3a3a3a' },
                            ticks: { color: '#888' }
                        }
                    },
                    plugins: {
                        legend: {
                            labels: { color: '#888' }
                        }
                    }
                }
            });
        }

        function updateChart(chart, labels, data) {
            chart.data.labels = labels;
            chart.data.datasets[0].data = data;
            chart.update('none');
        }

        function generateVolumeData() {
            const now = new Date();
            const labels = [];
            const values = [];

            // Generate last 10 time intervals
            for (let i = 9; i >= 0; i--) {
                const time = new Date(now - i * 60000); // 1 minute intervals
                labels.push(time.toLocaleTimeString());
                values.push(Math.floor(Math.random() * 50)); // Mock data
            }

            return { labels, values };
        }

        function requestRefresh() {
            socket.emit('requestMetrics');
        }

        // Auto-refresh every 5 seconds
        setInterval(requestRefresh, 5000);

        // Handle visibility change to pause/resume updates
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log('Dashboard paused');
            } else {
                console.log('Dashboard resumed');
                requestRefresh();
            }
        });
    </script>
</body>
</html>
`;

/**
 * Public directory for dashboard
 */
export const createPublicFiles = () => {
  const fs = require('fs');
  const path = require('path');

  const publicDir = path.join(__dirname, 'public');

  // Create directory if it doesn't exist
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  // Write index.html
  fs.writeFileSync(
    path.join(publicDir, 'index.html'),
    createDashboardHTML()
  );

  return publicDir;
};

// Global data collector instance
export const monitoringDataCollector = new MonitoringDataCollector();

export default {
  MonitoringDataCollector,
  DashboardServer,
  createDashboardHTML,
  createPublicFiles,
  monitoringDataCollector
};