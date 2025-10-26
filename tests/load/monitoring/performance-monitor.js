/**
 * Performance Monitoring and Metrics Collection System
 * Real-time monitoring of system resources, application metrics, and custom KPIs
 * during load testing scenarios
 */

const { performance } = require('perf_hooks');
const { EventEmitter } = require('events');
const os = require('os');
const fs = require('fs').promises;
const path = require('path');

class PerformanceMonitor extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      monitoringInterval: config.monitoringInterval || 1000, // 1 second
      metricsRetentionPeriod: config.metricsRetentionPeriod || 3600000, // 1 hour
      enableSystemMetrics: config.enableSystemMetrics !== false,
      enableApplicationMetrics: config.enableApplicationMetrics !== false,
      enableCustomMetrics: config.enableCustomMetrics !== false,
      metricsOutputPath: config.metricsOutputPath || './tests/load/reports/metrics',
      enableRealTimeAlerts: config.enableRealTimeAlerts !== false,
      alertThresholds: config.alertThresholds || {
        cpuUsage: 80, // percentage
        memoryUsage: 85, // percentage
        responseTime: 1000, // milliseconds
        errorRate: 5, // percentage
        diskUsage: 90 // percentage
      }
    };

    this.metrics = {
      system: {
        cpu: [],
        memory: [],
        disk: [],
        network: [],
        loadAverage: []
      },
      application: {
        responseTime: [],
        requestRate: [],
        errorRate: [],
        activeConnections: [],
        queueLength: []
      },
      custom: {
        businessMetrics: [],
        userExperience: [],
        performanceKPIs: []
      },
      alerts: [],
      summaries: []
    };

    this.isMonitoring = false;
    this.monitoringInterval = null;
    this.startTime = null;
    this.metricsHistory = [];

    // Initialize metrics directory
    this.initializeMetricsDirectory();
  }

  // Initialize metrics output directory
  async initializeMetricsDirectory() {
    try {
      await fs.mkdir(this.config.metricsOutputPath, { recursive: true });
      console.log(`Metrics directory initialized: ${this.config.metricsOutputPath}`);
    } catch (error) {
      console.error('Failed to initialize metrics directory:', error);
    }
  }

  // Start performance monitoring
  startMonitoring() {
    if (this.isMonitoring) {
      console.warn('Monitoring is already active');
      return;
    }

    console.log('Starting performance monitoring...');
    this.isMonitoring = true;
    this.startTime = Date.now();

    // Start monitoring loop
    this.monitoringInterval = setInterval(() => {
      this.collectMetrics();
    }, this.config.monitoringInterval);

    // Emit monitoring started event
    this.emit('monitoring:started', {
      startTime: this.startTime,
      interval: this.config.monitoringInterval
    });
  }

  // Stop performance monitoring
  stopMonitoring() {
    if (!this.isMonitoring) {
      console.warn('Monitoring is not active');
      return;
    }

    console.log('Stopping performance monitoring...');
    this.isMonitoring = false;

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    const endTime = Date.now();
    const totalDuration = endTime - this.startTime;

    // Generate final summary
    const finalSummary = this.generateSummary(totalDuration);

    // Save metrics to files
    this.saveMetricsToFile();

    // Emit monitoring stopped event
    this.emit('monitoring:stopped', {
      endTime,
      totalDuration,
      summary: finalSummary
    });

    return finalSummary;
  }

  // Collect all metrics
  async collectMetrics() {
    const timestamp = Date.now();
    const metricsSnapshot = {
      timestamp,
      system: {},
      application: {},
      custom: {}
    };

    try {
      // Collect system metrics
      if (this.config.enableSystemMetrics) {
        metricsSnapshot.system = await this.collectSystemMetrics();
        this.addMetric('system', metricsSnapshot.system);
      }

      // Collect application metrics
      if (this.config.enableApplicationMetrics) {
        metricsSnapshot.application = await this.collectApplicationMetrics();
        this.addMetric('application', metricsSnapshot.application);
      }

      // Collect custom metrics
      if (this.config.enableCustomMetrics) {
        metricsSnapshot.custom = await this.collectCustomMetrics();
        this.addMetric('custom', metricsSnapshot.custom);
      }

      // Check for alerts
      if (this.config.enableRealTimeAlerts) {
        this.checkAlerts(metricsSnapshot);
      }

      // Store metrics snapshot
      this.metricsHistory.push(metricsSnapshot);

      // Emit metrics collected event
      this.emit('metrics:collected', metricsSnapshot);

    } catch (error) {
      console.error('Error collecting metrics:', error);
      this.emit('metrics:error', error);
    }
  }

  // Collect system metrics
  async collectSystemMetrics() {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    // CPU usage calculation
    let totalIdle = 0;
    let totalTick = 0;

    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });

    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    const cpuUsage = 100 - (idle / total) * 100;

    // Memory usage
    const memoryUsage = (usedMem / totalMem) * 100;

    // Network interfaces
    const networkInterfaces = os.networkInterfaces();
    let networkStats = {};

    Object.keys(networkInterfaces).forEach(interfaceName => {
      const interfaces = networkInterfaces[interfaceName];
      const ipv4Interface = interfaces.find(iface => iface.family === 'IPv4' && !iface.internal);

      if (ipv4Interface) {
        networkStats[interfaceName] = {
          bytes: {
            received: ipv4Interface.rx || 0,
            transmitted: ipv4Interface.tx || 0
          },
          packets: {
            received: ipv4Interface.rx_packets || 0,
            transmitted: ipv4Interface.tx_packets || 0
          }
        };
      }
    });

    return {
      cpu: {
        usage: Math.round(cpuUsage * 100) / 100,
        cores: cpus.length,
        model: cpus[0]?.model || 'Unknown',
        speed: cpus[0]?.speed || 0
      },
      memory: {
        total: totalMem,
        used: usedMem,
        free: freeMem,
        usage: Math.round(memoryUsage * 100) / 100,
        totalGB: Math.round(totalMem / 1024 / 1024 / 1024 * 100) / 100,
        usedGB: Math.round(usedMem / 1024 / 1024 / 1024 * 100) / 100,
        freeGB: Math.round(freeMem / 1024 / 1024 / 1024 * 100) / 100
      },
      loadAverage: {
        oneMinute: loadAvg[0],
        fiveMinute: loadAvg[1],
        fifteenMinute: loadAvg[2]
      },
      uptime: os.uptime(),
      network: networkStats,
      platform: os.platform(),
      arch: os.arch()
    };
  }

  // Collect application metrics
  async collectApplicationMetrics() {
    const appMetrics = {
      process: {
        pid: process.pid,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage()
      },
      performance: {
        responseTime: this.calculateAverageResponseTime(),
        requestRate: this.calculateRequestRate(),
        errorRate: this.calculateErrorRate(),
        activeConnections: this.getActiveConnections(),
        queueLength: this.getQueueLength()
      }
    };

    return appMetrics;
  }

  // Collect custom business metrics
  async collectCustomMetrics() {
    const customMetrics = {
      business: {
        userEngagement: this.calculateUserEngagement(),
        workflowThroughput: this.calculateWorkflowThroughput(),
        sessionDuration: this.calculateAverageSessionDuration(),
        conversionRate: this.calculateConversionRate()
      },
      userExperience: {
        pageLoadTime: this.calculatePageLoadTime(),
        interactionLatency: this.calculateInteractionLatency(),
        errorRate: this.calculateUserExperienceErrorRate()
      },
      performanceKPIs: {
        scalabilityIndex: this.calculateScalabilityIndex(),
        reliabilityScore: this.calculateReliabilityScore(),
        efficiencyRatio: this.calculateEfficiencyRatio()
      }
    };

    return customMetrics;
  }

  // Add metric to appropriate collection
  addMetric(category, metricData) {
    if (!this.metrics[category]) {
      this.metrics[category] = {};
    }

    for (const [key, value] of Object.entries(metricData)) {
      if (!this.metrics[category][key]) {
        this.metrics[category][key] = [];
      }
      this.metrics[category][key].push({
        value,
        timestamp: Date.now()
      });
    }
  }

  // Check for performance alerts
  checkAlerts(metricsSnapshot) {
    const alerts = [];

    // CPU usage alert
    if (metricsSnapshot.system.cpu?.usage > this.config.alertThresholds.cpuUsage) {
      alerts.push({
        type: 'cpu_high',
        severity: 'warning',
        message: `High CPU usage: ${metricsSnapshot.system.cpu.usage}%`,
        threshold: this.config.alertThresholds.cpuUsage,
        current: metricsSnapshot.system.cpu.usage,
        timestamp: Date.now()
      });
    }

    // Memory usage alert
    if (metricsSnapshot.system.memory?.usage > this.config.alertThresholds.memoryUsage) {
      alerts.push({
        type: 'memory_high',
        severity: 'warning',
        message: `High memory usage: ${metricsSnapshot.system.memory.usage}%`,
        threshold: this.config.alertThresholds.memoryUsage,
        current: metricsSnapshot.system.memory.usage,
        timestamp: Date.now()
      });
    }

    // Response time alert
    if (metricsSnapshot.application.performance?.responseTime > this.config.alertThresholds.responseTime) {
      alerts.push({
        type: 'response_time_high',
        severity: 'critical',
        message: `High response time: ${metricsSnapshot.application.performance.responseTime}ms`,
        threshold: this.config.alertThresholds.responseTime,
        current: metricsSnapshot.application.performance.responseTime,
        timestamp: Date.now()
      });
    }

    // Error rate alert
    if (metricsSnapshot.application.performance?.errorRate > this.config.alertThresholds.errorRate) {
      alerts.push({
        type: 'error_rate_high',
        severity: 'critical',
        message: `High error rate: ${metricsSnapshot.application.performance.errorRate}%`,
        threshold: this.config.alertThresholds.errorRate,
        current: metricsSnapshot.application.performance.errorRate,
        timestamp: Date.now()
      });
    }

    // Store and emit alerts
    if (alerts.length > 0) {
      this.metrics.alerts.push(...alerts);
      this.emit('alerts:triggered', alerts);
    }
  }

  // Generate performance summary
  generateSummary(totalDuration) {
    const summary = {
      duration: totalDuration,
      startTime: this.startTime,
      endTime: Date.now(),
      system: this.calculateSystemSummary(),
      application: this.calculateApplicationSummary(),
      custom: this.calculateCustomSummary(),
      alerts: {
        total: this.metrics.alerts.length,
        byType: this.groupAlertsByType(),
        bySeverity: this.groupAlertsBySeverity()
      },
      performance: {
        overallScore: this.calculateOverallPerformanceScore(),
        recommendations: this.generatePerformanceRecommendations()
      }
    };

    this.metrics.summaries.push(summary);
    return summary;
  }

  // Calculate system summary statistics
  calculateSystemSummary() {
    const cpuData = this.metrics.system.cpu || [];
    const memoryData = this.metrics.system.memory || [];

    return {
      cpu: {
        average: this.calculateAverage(cpuData.map(d => d.value.usage)),
        max: this.calculateMax(cpuData.map(d => d.value.usage)),
        min: this.calculateMin(cpuData.map(d => d.value.usage)),
        p95: this.calculatePercentile(cpuData.map(d => d.value.usage), 95)
      },
      memory: {
        average: this.calculateAverage(memoryData.map(d => d.value.usage)),
        max: this.calculateMax(memoryData.map(d => d.value.usage)),
        min: this.calculateMin(memoryData.map(d => d.value.usage)),
        p95: this.calculatePercentile(memoryData.map(d => d.value.usage), 95)
      }
    };
  }

  // Calculate application summary statistics
  calculateApplicationSummary() {
    const responseTimeData = this.metrics.application.responseTime || [];
    const requestRateData = this.metrics.application.requestRate || [];
    const errorRateData = this.metrics.application.errorRate || [];

    return {
      responseTime: {
        average: this.calculateAverage(responseTimeData.map(d => d.value)),
        max: this.calculateMax(responseTimeData.map(d => d.value)),
        min: this.calculateMin(responseTimeData.map(d => d.value)),
        p95: this.calculatePercentile(responseTimeData.map(d => d.value), 95)
      },
      requestRate: {
        average: this.calculateAverage(requestRateData.map(d => d.value)),
        max: this.calculateMax(requestRateData.map(d => d.value)),
        total: requestRateData.reduce((sum, d) => sum + d.value, 0)
      },
      errorRate: {
        average: this.calculateAverage(errorRateData.map(d => d.value)),
        max: this.calculateMax(errorRateData.map(d => d.value)),
        total: errorRateData.length
      }
    };
  }

  // Calculate custom summary statistics
  calculateCustomSummary() {
    const businessData = this.metrics.custom.businessMetrics || [];
    const userExperienceData = this.metrics.custom.userExperience || [];
    const performanceKPIData = this.metrics.custom.performanceKPIs || [];

    return {
      business: {
        engagement: this.calculateAverage(businessData.map(d => d.value.userEngagement)),
        throughput: this.calculateAverage(businessData.map(d => d.value.workflowThroughput)),
        sessionDuration: this.calculateAverage(businessData.map(d => d.value.sessionDuration))
      },
      userExperience: {
        pageLoadTime: this.calculateAverage(userExperienceData.map(d => d.value.pageLoadTime)),
        interactionLatency: this.calculateAverage(userExperienceData.map(d => d.value.interactionLatency)),
        errorRate: this.calculateAverage(userExperienceData.map(d => d.value.errorRate))
      }
    };
  }

  // Statistical helper functions
  calculateAverage(values) {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  calculateMax(values) {
    if (values.length === 0) return 0;
    return Math.max(...values);
  }

  calculateMin(values) {
    if (values.length === 0) return 0;
    return Math.min(...values);
  }

  calculatePercentile(values, percentile) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  // Group alerts by type
  groupAlertsByType() {
    const grouped = {};
    this.metrics.alerts.forEach(alert => {
      grouped[alert.type] = (grouped[alert.type] || 0) + 1;
    });
    return grouped;
  }

  // Group alerts by severity
  groupAlertsBySeverity() {
    const grouped = {};
    this.metrics.alerts.forEach(alert => {
      grouped[alert.severity] = (grouped[alert.severity] || 0) + 1;
    });
    return grouped;
  }

  // Save metrics to JSON file
  async saveMetricsToFile() {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `performance-metrics-${timestamp}.json`;
      const filepath = path.join(this.config.metricsOutputPath, filename);

      const metricsData = {
        timestamp: new Date().toISOString(),
        config: this.config,
        metrics: this.metrics,
        summary: this.metrics.summaries[this.metrics.summaries.length - 1]
      };

      await fs.writeFile(filepath, JSON.stringify(metricsData, null, 2));
      console.log(`Metrics saved to: ${filepath}`);

      return filepath;
    } catch (error) {
      console.error('Failed to save metrics to file:', error);
      throw error;
    }
  }

  // Real-time metrics streaming
  startRealTimeStream(callback) {
    this.on('metrics:collected', callback);
  }

  stopRealTimeStream(callback) {
    this.off('metrics:collected', callback);
  }

  // Placeholder methods for custom calculations
  calculateAverageResponseTime() {
    const responseTimeData = this.metrics.application.responseTime || [];
    return this.calculateAverage(responseTimeData.map(d => d.value));
  }

  calculateRequestRate() {
    return Math.random() * 1000; // Placeholder
  }

  calculateErrorRate() {
    return Math.random() * 5; // Placeholder
  }

  getActiveConnections() {
    return Math.floor(Math.random() * 200); // Placeholder
  }

  getQueueLength() {
    return Math.floor(Math.random() * 50); // Placeholder
  }

  calculateUserEngagement() {
    return Math.random() * 100; // Placeholder
  }

  calculateWorkflowThroughput() {
    return Math.random() * 50; // Placeholder
  }

  calculateAverageSessionDuration() {
    return Math.random() * 300; // Placeholder
  }

  calculateConversionRate() {
    return Math.random() * 100; // Placeholder
  }

  calculatePageLoadTime() {
    return Math.random() * 3000; // Placeholder
  }

  calculateInteractionLatency() {
    return Math.random() * 500; // Placeholder
  }

  calculateUserExperienceErrorRate() {
    return Math.random() * 10; // Placeholder
  }

  calculateScalabilityIndex() {
    return Math.random() * 100; // Placeholder
  }

  calculateReliabilityScore() {
    return Math.random() * 100; // Placeholder
  }

  calculateEfficiencyRatio() {
    return Math.random() * 100; // Placeholder
  }

  calculateOverallPerformanceScore() {
    return Math.random() * 100; // Placeholder
  }

  generatePerformanceRecommendations() {
    return [
      {
        category: 'optimization',
        priority: 'medium',
        description: 'Consider implementing response caching for frequently accessed data'
      },
      {
        category: 'scaling',
        priority: 'high',
        description: 'Monitor memory usage trends and consider horizontal scaling'
      }
    ];
  }
}

module.exports = PerformanceMonitor;