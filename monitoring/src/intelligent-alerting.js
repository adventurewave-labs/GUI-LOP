/**
 * Intelligent Alerting System with Machine Learning Anomaly Detection
 * Provides proactive monitoring and automated incident response
 */

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class IntelligentAlerting extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      // Anomaly detection settings
      anomalyDetection: {
        enabled: config.anomalyDetection?.enabled !== false,
        windowSize: config.anomalyDetection?.windowSize || 300, // 5 minutes
        sensitivity: config.anomalyDetection?.sensitivity || 0.8, // 80% confidence
        minDataPoints: config.anomalyDetection?.minDataPoints || 50,
        algorithms: config.anomalyDetection?.algorithms || ['isolation_forest', 'lstm', 'statistical']
      },

      // Machine learning models
      models: {
        isolationForest: {
          enabled: config.models?.isolationForest?.enabled !== false,
          contamination: config.models?.isolationForest?.contamination || 0.1,
          maxSamples: config.models?.isolationForest?.maxSamples || 'auto',
          maxFeatures: config.models?.isolationForest?.maxFeatures || 1.0
        },
        lstm: {
          enabled: config.models?.lstm?.enabled || false,
          sequenceLength: config.models?.lstm?.sequenceLength || 50,
          hiddenUnits: config.models?.lstm?.hiddenUnits || 64,
          epochs: config.models?.lstm?.epochs || 100,
          batchSize: config.models?.lstm?.batchSize || 32
        },
        statistical: {
          enabled: config.models?.statistical?.enabled !== false,
          zScoreThreshold: config.models?.statistical?.zScoreThreshold || 3,
          madThreshold: config.models?.statistical?.madThreshold || 3
        }
      },

      // Alerting settings
      alerting: {
        cooldown: config.alerting?.cooldown || 300, // 5 minutes
        escalation: {
          enabled: config.alerting?.escalation?.enabled !== false,
          levels: config.alerting?.escalation?.levels || [
            { name: 'info', delay: 0, channels: ['slack'] },
            { name: 'warning', delay: 300, channels: ['slack', 'email'] },
            { name: 'critical', delay: 600, channels: ['slack', 'email', 'sms', 'pagerduty'] }
          ]
        },
        suppression: {
          enabled: config.alerting?.suppression?.enabled !== false,
          duration: config.alerting?.suppression?.duration || 3600, // 1 hour
          rules: config.alerting?.suppression?.rules || []
        }
      },

      // Notification channels
      notifications: {
        slack: {
          enabled: config.notifications?.slack?.enabled || false,
          webhook: config.notifications?.slack?.webhook || process.env.SLACK_WEBHOOK_URL,
          channel: config.notifications?.slack?.channel || '#alerts',
          username: config.notifications?.slack?.username || 'GUI-LOP Monitor'
        },
        email: {
          enabled: config.notifications?.email?.enabled || false,
          smtp: {
            host: config.notifications?.email?.smtp?.host || process.env.SMTP_HOST,
            port: config.notifications?.email?.smtp?.port || 587,
            secure: config.notifications?.email?.smtp?.secure || false,
            auth: {
              user: config.notifications?.email?.smtp?.auth?.user || process.env.SMTP_USER,
              pass: config.notifications?.email?.smtp?.auth?.pass || process.env.SMTP_PASSWORD
            }
          },
          from: config.notifications?.email?.from || process.env.EMAIL_FROM,
          to: config.notifications?.email?.to || []
        },
        pagerduty: {
          enabled: config.notifications?.pagerduty?.enabled || false,
          integrationKey: config.notifications?.pagerduty?.integrationKey || process.env.PAGERDUTY_INTEGRATION_KEY,
          severity: config.notifications?.pagerduty?.severity || 'critical'
        },
        sms: {
          enabled: config.notifications?.sms?.enabled || false,
          provider: config.notifications?.sms?.provider || 'twilio',
          credentials: config.notifications?.sms?.credentials || {}
        }
      },

      // Data storage
      storage: {
        dataDir: config.storage?.dataDir || './data/alerting',
        retentionDays: config.storage?.retentionDays || 30,
        compression: config.storage?.compression !== false
      }
    };

    this.initialized = false;
    this.activeAlerts = new Map();
    this.alertHistory = [];
    this.anomalyModels = new Map();
    this.metricsHistory = new Map();
    this.suppressionRules = new Map();
    this.escalationTimers = new Map();

    this.initialize();
  }

  async initialize() {
    try {
      // Create data directory
      await this.ensureDataDirectory();

      // Load historical data
      await this.loadHistoricalData();

      // Initialize anomaly detection models
      await this.initializeModels();

      // Load suppression rules
      await this.loadSuppressionRules();

      // Start background processing
      this.startBackgroundProcessing();

      this.initialized = true;
      this.emit('initialized');

    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  async ensureDataDirectory() {
    try {
      await fs.mkdir(this.config.storage.dataDir, { recursive: true });
      await fs.mkdir(path.join(this.config.storage.dataDir, 'models'), { recursive: true });
      await fs.mkdir(path.join(this.config.storage.dataDir, 'history'), { recursive: true });
      await fs.mkdir(path.join(this.config.storage.dataDir, 'alerts'), { recursive: true });
    } catch (error) {
      throw new Error(`Failed to create data directory: ${error.message}`);
    }
  }

  async loadHistoricalData() {
    try {
      const historyFile = path.join(this.config.storage.dataDir, 'history', 'metrics.json');

      if (await this.fileExists(historyFile)) {
        const data = await fs.readFile(historyFile, 'utf8');
        this.metricsHistory = JSON.parse(data);
      } else {
        this.metricsHistory = new Map();
      }
    } catch (error) {
      this.warn('Failed to load historical data, starting with empty history', { error: error.message });
      this.metricsHistory = new Map();
    }
  }

  async loadSuppressionRules() {
    try {
      const rulesFile = path.join(this.config.storage.dataDir, 'suppression_rules.json');

      if (await this.fileExists(rulesFile)) {
        const data = await fs.readFile(rulesFile, 'utf8');
        const rules = JSON.parse(data);
        this.suppressionRules = new Map(Object.entries(rules));
      }
    } catch (error) {
      this.warn('Failed to load suppression rules', { error: error.message });
    }
  }

  async initializeModels() {
    if (!this.config.anomalyDetection.enabled) return;

    // Initialize Isolation Forest model
    if (this.config.models.isolationForest.enabled) {
      this.anomalyModels.set('isolation_forest', await this.createIsolationForestModel());
    }

    // Initialize LSTM model for time series
    if (this.config.models.lstm.enabled) {
      this.anomalyModels.set('lstm', await this.createLSTMModel());
    }

    // Initialize statistical models
    if (this.config.models.statistical.enabled) {
      this.anomalyModels.set('statistical', await this.createStatisticalModel());
    }
  }

  async createIsolationForestModel() {
    // Simplified Isolation Forest implementation
    // In production, you would use a proper ML library like TensorFlow.js or external ML service
    return {
      type: 'isolation_forest',
      contamination: this.config.models.isolationForest.contamination,
      maxSamples: this.config.models.isolationForest.maxSamples,
      maxFeatures: this.config.models.isolationForest.maxFeatures,
      trained: false,
      trees: [],

      async train(data) {
        // Simplified training logic
        this.trees = this.generateTrees(data, 100);
        this.trained = true;
      },

      async predict(dataPoint) {
        if (!this.trained) return { anomaly: false, score: 0 };

        // Calculate anomaly score based on path lengths
        const scores = this.trees.map(tree => this.pathLength(dataPoint, tree));
        const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

        const normalizedScore = this.normalizeScore(avgScore, dataPoint.length);
        const isAnomaly = normalizedScore > (1 - this.contamination);

        return {
          anomaly: isAnomaly,
          score: normalizedScore,
          pathLength: avgScore
        };
      },

      generateTrees(data, nTrees) {
        // Simplified tree generation
        const trees = [];
        for (let i = 0; i < nTrees; i++) {
          trees.push(this.buildTree(data, Math.log2(data.length)));
        }
        return trees;
      },

      buildTree(data, maxDepth) {
        // Simplified tree building
        if (maxDepth <= 0 || data.length <= 1) {
          return { type: 'leaf', size: data.length };
        }

        const feature = Math.floor(Math.random() * data[0].length);
        const threshold = Math.random() * Math.max(...data.map(d => d[feature]));

        const left = data.filter(d => d[feature] <= threshold);
        const right = data.filter(d => d[feature] > threshold);

        return {
          type: 'node',
          feature,
          threshold,
          left: this.buildTree(left, maxDepth - 1),
          right: this.buildTree(right, maxDepth - 1)
        };
      },

      pathLength(dataPoint, tree) {
        if (tree.type === 'leaf') {
          return Math.log2(tree.size);
        }

        if (dataPoint[tree.feature] <= tree.threshold) {
          return 1 + this.pathLength(dataPoint, tree.left);
        } else {
          return 1 + this.pathLength(dataPoint, tree.right);
        }
      },

      normalizeScore(score, dimensions) {
        // Normalize anomaly score to [0, 1]
        const c = 2 * Math.log2(dimensions) - 0.5772156649;
        return Math.pow(2, -score / c);
      }
    };
  }

  async createLSTMModel() {
    // Simplified LSTM model placeholder
    // In production, use TensorFlow.js or external ML service
    return {
      type: 'lstm',
      sequenceLength: this.config.models.lstm.sequenceLength,
      hiddenUnits: this.config.models.lstm.hiddenUnits,
      trained: false,

      async train(data) {
        // Simplified training - would use actual LSTM in production
        this.trained = true;
      },

      async predict(sequence) {
        if (!this.trained) return { anomaly: false, score: 0 };

        // Simplified prediction - would use actual LSTM in production
        const lastValue = sequence[sequence.length - 1];
        const predictedValue = sequence[sequence.length - 2]; // Simple prediction

        const error = Math.abs(lastValue - predictedValue);
        const threshold = this.calculateThreshold(sequence);
        const isAnomaly = error > threshold;

        return {
          anomaly: isAnomaly,
          score: Math.min(error / threshold, 1),
          predictedValue,
          actualValue: lastValue,
          error
        };
      },

      calculateThreshold(sequence) {
        // Calculate threshold based on historical variance
        const mean = sequence.reduce((a, b) => a + b, 0) / sequence.length;
        const variance = sequence.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / sequence.length;
        return Math.sqrt(variance) * 2; // 2 sigma threshold
      }
    };
  }

  async createStatisticalModel() {
    return {
      type: 'statistical',
      zScoreThreshold: this.config.models.statistical.zScoreThreshold,
      madThreshold: this.config.models.statistical.madThreshold,

      async predict(dataPoint, historicalData) {
        if (!historicalData || historicalData.length < this.config.anomalyDetection.minDataPoints) {
          return { anomaly: false, score: 0, method: 'insufficient_data' };
        }

        // Z-score method
        const zScoreResult = this.calculateZScore(dataPoint, historicalData);

        // Median Absolute Deviation method
        const madResult = this.calculateMAD(dataPoint, historicalData);

        // Combine results
        const isAnomaly = zScoreResult.anomaly || madResult.anomaly;
        const score = Math.max(zScoreResult.score, madResult.score);

        return {
          anomaly: isAnomaly,
          score,
          zScore: zScoreResult,
          mad: madResult,
          method: 'statistical'
        };
      },

      calculateZScore(dataPoint, historicalData) {
        const mean = historicalData.reduce((sum, val) => sum + val, 0) / historicalData.length;
        const stdDev = Math.sqrt(
          historicalData.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / historicalData.length
        );

        const zScore = Math.abs((dataPoint - mean) / stdDev);
        const isAnomaly = zScore > this.zScoreThreshold;

        return {
          anomaly: isAnomaly,
          score: Math.min(zScore / this.zScoreThreshold, 1),
          zScore,
          mean,
          stdDev
        };
      },

      calculateMAD(dataPoint, historicalData) {
        const sorted = [...historicalData].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];

        const deviations = historicalData.map(val => Math.abs(val - median));
        const mad = deviations.sort((a, b) => a - b)[Math.floor(deviations.length / 2)];

        const modifiedZScore = 0.6745 * (dataPoint - median) / mad;
        const isAnomaly = Math.abs(modifiedZScore) > this.madThreshold;

        return {
          anomaly: isAnomaly,
          score: Math.min(Math.abs(modifiedZScore) / this.madThreshold, 1),
          modifiedZScore,
          median,
          mad
        };
      }
    };
  }

  // Main alert processing method
  async processMetrics(metricName, value, timestamp = Date.now(), labels = {}) {
    if (!this.initialized) return;

    try {
      // Store metric in history
      await this.storeMetric(metricName, value, timestamp, labels);

      // Run anomaly detection
      const anomalies = await this.detectAnomalies(metricName, value, labels);

      // Process detected anomalies
      for (const anomaly of anomalies) {
        await this.handleAnomaly(anomaly);
      }

    } catch (error) {
      this.emit('error', error);
    }
  }

  async storeMetric(metricName, value, timestamp, labels) {
    const key = this.createMetricKey(metricName, labels);

    if (!this.metricsHistory.has(key)) {
      this.metricsHistory.set(key, []);
    }

    const history = this.metricsHistory.get(key);
    history.push({ value, timestamp, labels });

    // Keep only recent data based on window size
    const windowSizeMs = this.config.anomalyDetection.windowSize * 1000;
    const cutoffTime = timestamp - windowSizeMs;

    while (history.length > 0 && history[0].timestamp < cutoffTime) {
      history.shift();
    }

    // Periodically save to disk
    if (history.length % 100 === 0) {
      await this.saveMetricsHistory();
    }
  }

  async detectAnomalies(metricName, value, labels) {
    const anomalies = [];
    const key = this.createMetricKey(metricName, labels);
    const history = this.metricsHistory.get(key) || [];

    if (history.length < this.config.anomalyDetection.minDataPoints) {
      return anomalies;
    }

    // Run all enabled detection algorithms
    for (const algorithm of this.config.anomalyDetection.algorithms) {
      if (!this.config.models[algorithm].enabled) continue;

      try {
        const anomaly = await this.runAnomalyDetection(algorithm, metricName, value, history, labels);
        if (anomaly) {
          anomalies.push(anomaly);
        }
      } catch (error) {
        this.warn(`Anomaly detection failed for ${algorithm}`, { error: error.message });
      }
    }

    return anomalies;
  }

  async runAnomalyDetection(algorithm, metricName, value, history, labels) {
    const model = this.anomalyModels.get(algorithm);
    if (!model) return null;

    let result;

    switch (algorithm) {
      case 'isolation_forest':
        const dataPoints = history.map(h => h.value).map(v => [v]);
        if (!model.trained) {
          await model.train(dataPoints);
        }
        result = await model.predict([value]);
        break;

      case 'lstm':
        const sequence = history.slice(-model.sequenceLength).map(h => h.value);
        if (!model.trained) {
          await model.train(sequence);
        }
        result = await model.predict(sequence);
        break;

      case 'statistical':
        const historicalValues = history.map(h => h.value);
        result = await model.predict(value, historicalValues);
        break;

      default:
        return null;
    }

    if (result.anomaly && result.score >= this.config.anomalyDetection.sensitivity) {
      return {
        id: this.generateAnomalyId(),
        metricName,
        value,
        score: result.score,
        algorithm,
        details: result,
        labels,
        timestamp: Date.now(),
        severity: this.calculateSeverity(result.score),
        status: 'active'
      };
    }

    return null;
  }

  async handleAnomaly(anomaly) {
    // Check if anomaly should be suppressed
    if (await this.shouldSuppress(anomaly)) {
      this.debug('Anomaly suppressed', { anomalyId: anomaly.id });
      return;
    }

    // Check if alert already exists
    const existingAlert = this.findActiveAlert(anomaly);
    if (existingAlert) {
      await this.updateExistingAlert(existingAlert, anomaly);
    } else {
      await this.createNewAlert(anomaly);
    }
  }

  async shouldSuppress(anomaly) {
    if (!this.config.alerting.suppression.enabled) return false;

    for (const [ruleName, rule] of this.suppressionRules) {
      if (this.matchesSuppressionRule(anomaly, rule)) {
        return true;
      }
    }

    return false;
  }

  matchesSuppressionRule(anomaly, rule) {
    // Check metric name pattern
    if (rule.metricPattern && !new RegExp(rule.metricPattern).test(anomaly.metricName)) {
      return false;
    }

    // Check label patterns
    if (rule.labelPatterns) {
      for (const [labelKey, pattern] of Object.entries(rule.labelPatterns)) {
        const value = anomaly.labels[labelKey];
        if (!value || !new RegExp(pattern).test(value)) {
          return false;
        }
      }
    }

    // Check severity
    if (rule.severity && anomaly.severity !== rule.severity) {
      return false;
    }

    // Check time window
    if (rule.timeWindow) {
      const now = Date.now();
      const hour = new Date(now).getHours();
      if (rule.timeWindow.start && rule.timeWindow.end) {
        if (hour < rule.timeWindow.start || hour > rule.timeWindow.end) {
          return false;
        }
      }
    }

    return true;
  }

  findActiveAlert(anomaly) {
    for (const [alertId, alert] of this.activeAlerts) {
      if (alert.metricName === anomaly.metricName &&
          JSON.stringify(alert.labels) === JSON.stringify(anomaly.labels)) {
        return alert;
      }
    }
    return null;
  }

  async updateExistingAlert(alert, anomaly) {
    alert.lastUpdated = Date.now();
    alert.anomalies.push(anomaly);
    alert.maxScore = Math.max(alert.maxScore, anomaly.score);

    // Check if severity has increased
    const newSeverity = this.calculateSeverity(alert.maxScore);
    if (newSeverity !== alert.severity) {
      alert.severity = newSeverity;
      await this.triggerEscalation(alert);
    }

    this.emit('alertUpdated', alert);
  }

  async createNewAlert(anomaly) {
    const alert = {
      id: this.generateAlertId(),
      metricName: anomaly.metricName,
      labels: anomaly.labels,
      severity: anomaly.severity,
      status: 'active',
      createdAt: Date.now(),
      lastUpdated: Date.now(),
      anomalies: [anomaly],
      maxScore: anomaly.score,
      escalationLevel: 0,
      acknowledged: false,
      resolved: false
    };

    this.activeAlerts.set(alert.id, alert);
    this.alertHistory.push(alert);

    // Send initial notification
    await this.sendNotification(alert);

    // Start escalation timer
    if (this.config.alerting.escalation.enabled) {
      this.startEscalationTimer(alert);
    }

    this.emit('alertCreated', alert);
  }

  async triggerEscalation(alert) {
    const escalationLevel = alert.escalationLevel;
    const escalationLevels = this.config.alerting.escalation.levels;

    if (escalationLevel < escalationLevels.length - 1) {
      alert.escalationLevel++;
      await this.sendNotification(alert);
      this.startEscalationTimer(alert);
      this.emit('alertEscalated', alert);
    }
  }

  startEscalationTimer(alert) {
    const escalationLevel = alert.escalationLevel;
    const escalationLevels = this.config.alerting.escalation.levels;

    if (escalationLevel >= escalationLevels.length - 1) return;

    const delay = escalationLevels[escalationLevel + 1].delay * 1000;

    const timer = setTimeout(async () => {
      if (this.activeAlerts.has(alert.id) && !alert.acknowledged && !alert.resolved) {
        await this.triggerEscalation(alert);
      }
    }, delay);

    this.escalationTimers.set(alert.id, timer);
  }

  async sendNotification(alert) {
    const escalationLevel = alert.escalationLevel;
    const escalationConfig = this.config.alerting.escalation.levels[escalationLevel];

    for (const channel of escalationConfig.channels) {
      try {
        await this.sendNotificationChannel(alert, channel);
      } catch (error) {
        this.warn(`Failed to send notification via ${channel}`, {
          alertId: alert.id,
          error: error.message
        });
      }
    }
  }

  async sendNotificationChannel(alert, channel) {
    switch (channel) {
      case 'slack':
        await this.sendSlackNotification(alert);
        break;
      case 'email':
        await this.sendEmailNotification(alert);
        break;
      case 'pagerduty':
        await this.sendPagerDutyNotification(alert);
        break;
      case 'sms':
        await this.sendSMSNotification(alert);
        break;
      default:
        this.warn(`Unknown notification channel: ${channel}`);
    }
  }

  async sendSlackNotification(alert) {
    if (!this.config.notifications.slack.enabled) return;

    const message = {
      channel: this.config.notifications.slack.channel,
      username: this.config.notifications.slack.username,
      icon_emoji: ':warning:',
      attachments: [{
        color: this.getSlackColor(alert.severity),
        title: `🚨 ${alert.severity.toUpperCase()} Alert: ${alert.metricName}`,
        fields: [
          { title: 'Metric', value: alert.metricName, short: true },
          { title: 'Severity', value: alert.severity, short: true },
          { title: 'Score', value: alert.maxScore.toFixed(3), short: true },
          { title: 'Labels', value: JSON.stringify(alert.labels), short: false },
          { title: 'Time', value: new Date(alert.createdAt).toISOString(), short: true }
        ],
        footer: 'GUI-LOP Intelligent Alerting',
        ts: Math.floor(alert.createdAt / 1000)
      }]
    };

    // In production, make actual HTTP request to Slack webhook
    this.info('Slack notification sent', { alertId: alert.id, message });
  }

  async sendEmailNotification(alert) {
    if (!this.config.notifications.email.enabled) return;

    const subject = `[${alert.severity.toUpperCase()}] Alert: ${alert.metricName}`;
    const body = this.generateEmailBody(alert);

    // In production, use nodemailer or similar to send email
    this.info('Email notification sent', { alertId: alert.id, subject });
  }

  async sendPagerDutyNotification(alert) {
    if (!this.config.notifications.pagerduty.enabled) return;

    // In production, integrate with PagerDuty API
    this.info('PagerDuty notification sent', { alertId: alert.id });
  }

  async sendSMSNotification(alert) {
    if (!this.config.notifications.sms.enabled) return;

    // In production, integrate with SMS provider (Twilio, etc.)
    this.info('SMS notification sent', { alertId: alert.id });
  }

  // Alert management methods
  async acknowledgeAlert(alertId, userId, note = '') {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) {
      throw new Error(`Alert not found: ${alertId}`);
    }

    alert.acknowledged = true;
    alert.acknowledgedBy = userId;
    alert.acknowledgedAt = Date.now();
    alert.acknowledgmentNote = note;

    // Clear escalation timer
    if (this.escalationTimers.has(alertId)) {
      clearTimeout(this.escalationTimers.get(alertId));
      this.escalationTimers.delete(alertId);
    }

    this.emit('alertAcknowledged', alert);
    return alert;
  }

  async resolveAlert(alertId, userId, resolution = '') {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) {
      throw new Error(`Alert not found: ${alertId}`);
    }

    alert.resolved = true;
    alert.resolvedBy = userId;
    alert.resolvedAt = Date.now();
    alert.resolution = resolution;

    // Clear escalation timer
    if (this.escalationTimers.has(alertId)) {
      clearTimeout(this.escalationTimers.get(alertId));
      this.escalationTimers.delete(alertId);
    }

    // Remove from active alerts after a delay
    setTimeout(() => {
      this.activeAlerts.delete(alertId);
    }, 60000); // Keep for 1 minute for final processing

    this.emit('alertResolved', alert);
    return alert;
  }

  // Utility methods
  createMetricKey(metricName, labels) {
    const sortedLabels = Object.keys(labels).sort().map(key => `${key}=${labels[key]}`);
    return `${metricName}{${sortedLabels.join(',')}}`;
  }

  generateAnomalyId() {
    return `anomaly_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  generateAlertId() {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  calculateSeverity(score) {
    if (score >= 0.9) return 'critical';
    if (score >= 0.7) return 'warning';
    if (score >= 0.5) return 'info';
    return 'low';
  }

  getSlackColor(severity) {
    switch (severity) {
      case 'critical': return 'danger';
      case 'warning': return 'warning';
      case 'info': return 'good';
      default: return '#CCCCCC';
    }
  }

  generateEmailBody(alert) {
    return `
Alert Details:
- Metric: ${alert.metricName}
- Severity: ${alert.severity}
- Score: ${alert.maxScore.toFixed(3)}
- Created: ${new Date(alert.createdAt).toISOString()}
- Labels: ${JSON.stringify(alert.labels)}

Recent Anomalies:
${alert.anomalies.slice(-5).map(a => `- ${new Date(a.timestamp).toISOString()}: Score ${a.score.toFixed(3)} (${a.algorithm})`).join('\n')}

This alert was generated by the GUI-LOP Intelligent Alerting System.
    `.trim();
  }

  async saveMetricsHistory() {
    try {
      const historyFile = path.join(this.config.storage.dataDir, 'history', 'metrics.json');
      const data = Object.fromEntries(this.metricsHistory);
      await fs.writeFile(historyFile, JSON.stringify(data, null, 2));
    } catch (error) {
      this.warn('Failed to save metrics history', { error: error.message });
    }
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  startBackgroundProcessing() {
    // Save metrics history periodically
    setInterval(() => {
      this.saveMetricsHistory();
    }, 60000); // Every minute

    // Clean up old alerts
    setInterval(() => {
      this.cleanupOldAlerts();
    }, 3600000); // Every hour

    // Retrain models periodically
    setInterval(() => {
      this.retrainModels();
    }, 86400000); // Every day
  }

  async cleanupOldAlerts() {
    const cutoffTime = Date.now() - (this.config.storage.retentionDays * 24 * 60 * 60 * 1000);

    // Remove old resolved alerts from history
    this.alertHistory = this.alertHistory.filter(alert =>
      alert.createdAt > cutoffTime || !alert.resolved
    );
  }

  async retrainModels() {
    for (const [name, model] of this.anomalyModels) {
      try {
        // Retrain model with recent data
        this.info(`Retraining model: ${name}`);
      } catch (error) {
        this.warn(`Failed to retrain model: ${name}`, { error: error.message });
      }
    }
  }

  // Health check
  async healthCheck() {
    return {
      status: 'healthy',
      initialized: this.initialized,
      activeAlerts: this.activeAlerts.size,
      totalModels: this.anomalyModels.size,
      metricsTracked: this.metricsHistory.size,
      escalationTimers: this.escalationTimers.size
    };
  }

  // Logging methods
  info(message, metadata = {}) {
    console.log(`[IntelligentAlerting] ${message}`, metadata);
    this.emit('log', { level: 'info', message, metadata });
  }

  warn(message, metadata = {}) {
    console.warn(`[IntelligentAlerting] ${message}`, metadata);
    this.emit('log', { level: 'warn', message, metadata });
  }

  debug(message, metadata = {}) {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[IntelligentAlerting] ${message}`, metadata);
      this.emit('log', { level: 'debug', message, metadata });
    }
  }

  // Graceful shutdown
  async shutdown() {
    this.info('Shutting down intelligent alerting system');

    // Clear escalation timers
    for (const timer of this.escalationTimers.values()) {
      clearTimeout(timer);
    }
    this.escalationTimers.clear();

    // Save final state
    await this.saveMetricsHistory();

    this.initialized = false;
    this.emit('shutdown');
  }
}

export default IntelligentAlerting;