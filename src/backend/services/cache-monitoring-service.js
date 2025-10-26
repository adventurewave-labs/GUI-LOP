/**
 * Cache Monitoring Service
 * Comprehensive cache monitoring with performance metrics and health checks
 * Week 5-6 Phase 2 - Redis Caching Layer
 */

import cacheService from './redis-cache-service.js';
import workflowCacheService from './workflow-cache-service.js';
import sessionCacheService from './session-cache-service.js';
import redisConfig from '../config/redis-config.js';
import { EventEmitter } from 'events';

class CacheMonitoringService extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.monitoringInterval = null;
    this.alertThresholds = {
      memoryUsage: 80, // 80%
      hitRate: 50, // 50%
      responseTime: 100, // 100ms
      errorRate: 5, // 5%
      connectionCount: 80 // 80% of max connections
    };

    // Metrics collection
    this.metrics = {
      timestamp: Date.now(),
      uptime: 0,
      cacheHits: 0,
      cacheMisses: 0,
      totalRequests: 0,
      avgResponseTime: 0,
      memoryUsage: 0,
      connectedClients: 0,
      errors: 0,
      warnings: 0
    };

    // Historical data for trending
    this.historicalData = [];
    this.maxHistorySize = 1440; // 24 hours of 1-minute intervals

    // Alert tracking
    this.activeAlerts = new Map();
    this.alertHistory = [];

    // Performance baselines
    this.baselines = {
      hitRate: 0,
      avgResponseTime: 0,
      memoryUsage: 0
    };

    // Anomaly detection
    this.anomalyDetector = {
      enabled: true,
      sensitivity: 2, // Standard deviations
      windowSize: 10 // Last 10 data points
    };
  }

  /**
   * Initialize cache monitoring service
   */
  async initialize() {
    try {
      await cacheService.initialize();
      this.initialized = true;
      console.log('✅ Cache Monitoring Service initialized');

      // Start monitoring
      this.startMonitoring();

      // Establish baselines
      await this.establishBaselines();

      return true;
    } catch (error) {
      console.error('❌ Failed to initialize Cache Monitoring Service:', error.message);
      this.initialized = false;
      throw error;
    }
  }

  /**
   * Start continuous monitoring
   */
  startMonitoring() {
    // Collect metrics every minute
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.collectMetrics();
        await this.analyzeMetrics();
        await this.checkThresholds();
        await this.detectAnomalies();
      } catch (error) {
        console.error('❌ Error in monitoring cycle:', error.message);
        this.metrics.errors++;
      }
    }, 60000); // 1 minute

    console.log('📊 Cache monitoring started');
  }

  /**
   * Collect comprehensive metrics
   */
  async collectMetrics() {
    try {
      const startTime = Date.now();

      // Get Redis health and metrics
      const redisHealth = await redisConfig.getHealthStatus();
      const redisMetrics = redisConfig.getMetrics();

      // Get cache service statistics
      const generalStats = await cacheService.getStats();
      const workflowStats = await workflowCacheService.getCacheStats();
      const sessionStats = await sessionCacheService.getSessionStats();

      // Update current metrics
      this.metrics = {
        timestamp: Date.now(),
        uptime: Date.now() - this.metrics.timestamp,
        cacheHits: generalStats.performance.hits + workflowStats.performance?.hits + sessionStats.hits,
        cacheMisses: generalStats.performance.misses + workflowStats.performance?.misses,
        totalRequests: generalStats.performance.totalOperations + workflowStats.performance?.totalOperations + sessionStats.activeSessions,
        avgResponseTime: redisMetrics.avgResponseTime,
        memoryUsage: this.parseMemoryUsage(redisHealth.memory?.used),
        connectedClients: redisHealth.connected ? 1 : 0,
        errors: generalStats.performance.errors + (workflowStats.performance?.errors || 0),
        warnings: 0
      };

      // Calculate derived metrics
      this.metrics.hitRate = this.metrics.totalRequests > 0 ?
        (this.metrics.cacheHits / this.metrics.totalRequests) * 100 : 0;

      this.metrics.errorRate = this.metrics.totalRequests > 0 ?
        (this.metrics.errors / this.metrics.totalRequests) * 100 : 0;

      // Add to historical data
      this.addToHistory(this.metrics);

      // Emit metrics event
      this.emit('metrics', this.metrics);

    } catch (error) {
      console.error('❌ Error collecting metrics:', error.message);
      this.metrics.errors++;
    }
  }

  /**
   * Analyze metrics and generate insights
   */
  async analyzeMetrics() {
    try {
      const insights = [];

      // Hit rate analysis
      if (this.metrics.hitRate < this.alertThresholds.hitRate) {
        insights.push({
          type: 'performance',
          severity: 'warning',
          message: `Cache hit rate is ${this.metrics.hitRate.toFixed(1)}% (threshold: ${this.alertThresholds.hitRate}%)`,
          recommendation: 'Consider increasing cache TTL or warming strategies'
        });
      }

      // Response time analysis
      if (this.metrics.avgResponseTime > this.alertThresholds.responseTime) {
        insights.push({
          type: 'performance',
          severity: 'warning',
          message: `Average response time is ${this.metrics.avgResponseTime}ms (threshold: ${this.alertThresholds.responseTime}ms)`,
          recommendation: 'Check Redis performance and network latency'
        });
      }

      // Memory usage analysis
      if (this.metrics.memoryUsage > this.alertThresholds.memoryUsage) {
        insights.push({
          type: 'capacity',
          severity: 'critical',
          message: `Memory usage is ${this.metrics.memoryUsage}% (threshold: ${this.alertThresholds.memoryUsage}%)`,
          recommendation: 'Consider increasing memory or implementing cache eviction policies'
        });
      }

      // Error rate analysis
      if (this.metrics.errorRate > this.alertThresholds.errorRate) {
        insights.push({
          type: 'reliability',
          severity: 'warning',
          message: `Error rate is ${this.metrics.errorRate.toFixed(1)}% (threshold: ${this.alertThresholds.errorRate}%)`,
          recommendation: 'Investigate cache service errors and Redis connectivity'
        });
      }

      // Trend analysis
      const trendAnalysis = this.analyzeTrends();
      if (trendAnalysis.length > 0) {
        insights.push(...trendAnalysis);
      }

      // Emit insights event
      this.emit('insights', insights);

      return insights;

    } catch (error) {
      console.error('❌ Error analyzing metrics:', error.message);
      return [];
    }
  }

  /**
   * Check thresholds and trigger alerts
   */
  async checkThresholds() {
    try {
      const alerts = [];

      // Check each threshold
      const checks = [
        {
          name: 'hit_rate',
          current: this.metrics.hitRate,
          threshold: this.alertThresholds.hitRate,
          operator: '<',
          severity: 'warning'
        },
        {
          name: 'response_time',
          current: this.metrics.avgResponseTime,
          threshold: this.alertThresholds.responseTime,
          operator: '>',
          severity: 'warning'
        },
        {
          name: 'memory_usage',
          current: this.metrics.memoryUsage,
          threshold: this.alertThresholds.memoryUsage,
          operator: '>',
          severity: 'critical'
        },
        {
          name: 'error_rate',
          current: this.metrics.errorRate,
          threshold: this.alertThresholds.errorRate,
          operator: '>',
          severity: 'warning'
        }
      ];

      for (const check of checks) {
        const isTriggered = this.evaluateThreshold(check.current, check.threshold, check.operator);

        if (isTriggered && !this.activeAlerts.has(check.name)) {
          // New alert
          const alert = {
            id: crypto.randomUUID(),
            name: check.name,
            severity: check.severity,
            current: check.current,
            threshold: check.threshold,
            triggeredAt: Date.now(),
            message: `${check.name.replace('_', ' ')} is ${check.current.toFixed(1)} (threshold: ${check.threshold})`
          };

          this.activeAlerts.set(check.name, alert);
          this.alertHistory.unshift(alert);
          alerts.push(alert);

          console.log(`🚨 Cache alert triggered: ${alert.message}`);

          // Emit alert event
          this.emit('alert', alert);

        } else if (!isTriggered && this.activeAlerts.has(check.name)) {
          // Alert resolved
          const resolvedAlert = this.activeAlerts.get(check.name);
          resolvedAlert.resolvedAt = Date.now();
          resolvedAlert.duration = resolvedAlert.resolvedAt - resolvedAlert.triggeredAt;

          this.activeAlerts.delete(check.name);
          console.log(`✅ Cache alert resolved: ${resolvedAlert.name}`);

          // Emit resolution event
          this.emit('alert-resolved', resolvedAlert);
        }
      }

      return alerts;

    } catch (error) {
      console.error('❌ Error checking thresholds:', error.message);
      return [];
    }
  }

  /**
   * Detect anomalies using statistical methods
   */
  async detectAnomalies() {
    if (!this.anomalyDetector.enabled || this.historicalData.length < this.anomalyDetector.windowSize) {
      return [];
    }

    try {
      const anomalies = [];
      const window = this.historicalData.slice(-this.anomalyDetector.windowSize);
      const sensitivity = this.anomalyDetector.sensitivity;

      // Detect anomalies in key metrics
      const metricsToCheck = ['hitRate', 'avgResponseTime', 'memoryUsage', 'errorRate'];

      for (const metric of metricsToCheck) {
        const values = window.map(data => data[metric]).filter(val => val !== undefined && val !== null);

        if (values.length < 3) continue;

        const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
        const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
        const stdDev = Math.sqrt(variance);

        const currentValue = this.metrics[metric];
        const zScore = Math.abs((currentValue - mean) / stdDev);

        if (zScore > sensitivity) {
          const anomaly = {
            metric,
            currentValue,
            mean,
            stdDev,
            zScore,
            severity: zScore > sensitivity * 2 ? 'critical' : 'warning',
            detectedAt: Date.now(),
            message: `${metric} anomaly detected: ${currentValue.toFixed(2)} (mean: ${mean.toFixed(2)}, stdDev: ${stdDev.toFixed(2)})`
          };

          anomalies.push(anomaly);
          console.log(`🔍 Cache anomaly detected: ${anomaly.message}`);

          // Emit anomaly event
          this.emit('anomaly', anomaly);
        }
      }

      return anomalies;

    } catch (error) {
      console.error('❌ Error detecting anomalies:', error.message);
      return [];
    }
  }

  /**
   * Analyze trends in historical data
   */
  analyzeTrends() {
    if (this.historicalData.length < 10) {
      return [];
    }

    const trends = [];
    const recent = this.historicalData.slice(-10);
    const older = this.historicalData.slice(-20, -10);

    if (older.length === 0) return trends;

    // Analyze hit rate trend
    const recentHitRate = recent.reduce((sum, data) => sum + data.hitRate, 0) / recent.length;
    const olderHitRate = older.reduce((sum, data) => sum + data.hitRate, 0) / older.length;
    const hitRateChange = ((recentHitRate - olderHitRate) / olderHitRate) * 100;

    if (Math.abs(hitRateChange) > 10) {
      trends.push({
        type: 'trend',
        metric: 'hitRate',
        change: hitRateChange,
        direction: hitRateChange > 0 ? 'improving' : 'degrading',
        message: `Hit rate ${hitRateChange > 0 ? 'improved' : 'degraded'} by ${Math.abs(hitRateChange).toFixed(1)}%`
      });
    }

    // Analyze response time trend
    const recentResponseTime = recent.reduce((sum, data) => sum + data.avgResponseTime, 0) / recent.length;
    const olderResponseTime = older.reduce((sum, data) => sum + data.avgResponseTime, 0) / older.length;
    const responseTimeChange = ((recentResponseTime - olderResponseTime) / olderResponseTime) * 100;

    if (Math.abs(responseTimeChange) > 20) {
      trends.push({
        type: 'trend',
        metric: 'avgResponseTime',
        change: responseTimeChange,
        direction: responseTimeChange > 0 ? 'degrading' : 'improving',
        message: `Response time ${responseTimeChange > 0 ? 'increased' : 'decreased'} by ${Math.abs(responseTimeChange).toFixed(1)}%`
      });
    }

    return trends;
  }

  /**
   * Establish performance baselines
   */
  async establishBaselines() {
    try {
      console.log('📊 Establishing cache performance baselines...');

      // Collect baseline data over 5 minutes
      const baselineData = [];
      const samples = 5;
      const interval = 60000; // 1 minute

      for (let i = 0; i < samples; i++) {
        await this.collectMetrics();
        baselineData.push({ ...this.metrics });

        if (i < samples - 1) {
          await new Promise(resolve => setTimeout(resolve, interval));
        }
      }

      // Calculate baselines
      this.baselines.hitRate = baselineData.reduce((sum, data) => sum + data.hitRate, 0) / baselineData.length;
      this.baselines.avgResponseTime = baselineData.reduce((sum, data) => sum + data.avgResponseTime, 0) / baselineData.length;
      this.baselines.memoryUsage = baselineData.reduce((sum, data) => sum + data.memoryUsage, 0) / baselineData.length;

      console.log('✅ Cache performance baselines established:', {
        hitRate: `${this.baselines.hitRate.toFixed(1)}%`,
        avgResponseTime: `${this.baselines.avgResponseTime.toFixed(1)}ms`,
        memoryUsage: `${this.baselines.memoryUsage.toFixed(1)}%`
      });

    } catch (error) {
      console.error('❌ Error establishing baselines:', error.message);
    }
  }

  /**
   * Add metrics to historical data
   */
  addToHistory(metrics) {
    this.historicalData.unshift({ ...metrics });

    // Keep only the most recent data points
    if (this.historicalData.length > this.maxHistorySize) {
      this.historicalData = this.historicalData.slice(0, this.maxHistorySize);
    }
  }

  /**
   * Parse memory usage from Redis info
   */
  parseMemoryUsage(memoryString) {
    if (!memoryString) return 0;

    // Parse memory string like "1.5M" or "2G"
    const value = parseFloat(memoryString);
    const unit = memoryString.slice(-1).toUpperCase();

    switch (unit) {
      case 'B': return value / (1024 * 1024); // Convert to MB
      case 'K': return value / 1024; // Convert to MB
      case 'M': return value; // Already in MB
      case 'G': return value * 1024; // Convert to MB
      default: return value;
    }
  }

  /**
   * Evaluate threshold condition
   */
  evaluateThreshold(current, threshold, operator) {
    switch (operator) {
      case '>': return current > threshold;
      case '<': return current < threshold;
      case '>=': return current >= threshold;
      case '<=': return current <= threshold;
      case '==': return current === threshold;
      default: return false;
    }
  }

  /**
   * Get comprehensive monitoring dashboard data
   */
  getDashboardData() {
    return {
      current: this.metrics,
      baselines: this.baselines,
      activeAlerts: Array.from(this.activeAlerts.values()),
      recentAlerts: this.alertHistory.slice(0, 10),
      historicalData: this.historicalData.slice(0, 60), // Last hour
      thresholds: this.alertThresholds,
      uptime: this.initialized ? Date.now() - this.metrics.timestamp : 0
    };
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary() {
    const recent = this.historicalData.slice(0, 60); // Last hour
    if (recent.length === 0) {
      return { status: 'insufficient_data' };
    }

    const avgHitRate = recent.reduce((sum, data) => sum + data.hitRate, 0) / recent.length;
    const avgResponseTime = recent.reduce((sum, data) => sum + data.avgResponseTime, 0) / recent.length;
    const avgMemoryUsage = recent.reduce((sum, data) => sum + data.memoryUsage, 0) / recent.length;

    let status = 'excellent';
    if (avgHitRate < 50 || avgResponseTime > 100 || avgMemoryUsage > 80) {
      status = 'poor';
    } else if (avgHitRate < 70 || avgResponseTime > 50 || avgMemoryUsage > 60) {
      status = 'fair';
    } else if (avgHitRate < 85 || avgResponseTime > 25 || avgMemoryUsage > 40) {
      status = 'good';
    }

    return {
      status,
      metrics: {
        avgHitRate: avgHitRate.toFixed(1),
        avgResponseTime: avgResponseTime.toFixed(1),
        avgMemoryUsage: avgMemoryUsage.toFixed(1)
      },
      alerts: {
        active: this.activeAlerts.size,
        recent: this.alertHistory.filter(alert => Date.now() - alert.triggeredAt < 3600000).length // Last hour
      }
    };
  }

  /**
   * Update alert thresholds
   */
  updateThresholds(newThresholds) {
    this.alertThresholds = { ...this.alertThresholds, ...newThresholds };
    console.log('📊 Alert thresholds updated:', this.alertThresholds);
  }

  /**
   * Reset monitoring data
   */
  resetMonitoring() {
    this.metrics = {
      timestamp: Date.now(),
      uptime: 0,
      cacheHits: 0,
      cacheMisses: 0,
      totalRequests: 0,
      avgResponseTime: 0,
      memoryUsage: 0,
      connectedClients: 0,
      errors: 0,
      warnings: 0
    };

    this.historicalData = [];
    this.activeAlerts.clear();
    this.alertHistory = [];

    console.log('📊 Monitoring data reset');
  }

  /**
   * Health check for monitoring service
   */
  async healthCheck() {
    try {
      const health = {
        status: 'healthy',
        initialized: this.initialized,
        monitoring: this.monitoringInterval !== null,
        metrics: this.getPerformanceSummary()
      };

      // Test data collection
      await this.collectMetrics();
      health.dataCollection = 'working';

      return health;

    } catch (error) {
      return {
        status: 'unhealthy',
        initialized: this.initialized,
        error: error.message
      };
    }
  }

  /**
   * Close cache monitoring service
   */
  async close() {
    try {
      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = null;
      }

      this.initialized = false;
      console.log('✅ Cache Monitoring Service closed');
    } catch (error) {
      console.error('❌ Error closing Cache Monitoring Service:', error.message);
      throw error;
    }
  }
}

// Create singleton instance
const cacheMonitoringService = new CacheMonitoringService();

export default cacheMonitoringService;
export { CacheMonitoringService };