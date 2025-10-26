/**
 * Synthetic Monitoring System for GUI-LOP Platform
 * Provides automated user experience validation and proactive monitoring
 */

import { EventEmitter } from 'events';
import puppeteer from 'puppeteer';
import axios from 'axios';
import { performance } from 'perf_hooks';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class SyntheticMonitoring extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      // Test configuration
      tests: {
        interval: config.tests?.interval || 300000, // 5 minutes
        timeout: config.tests?.timeout || 30000, // 30 seconds
        retries: config.tests?.retries || 2,
        locations: config.tests?.locations || ['us-east-1', 'us-west-2', 'eu-west-1'],
        browsers: config.tests?.browsers || ['chrome', 'firefox']
      },

      // URL endpoints to monitor
      endpoints: config.endpoints || [
        {
          name: 'Homepage',
          url: 'https://app.example.com',
          method: 'GET',
          expectedStatus: 200,
          expectedContent: ['Welcome', 'Login'],
          criticalPath: true
        },
        {
          name: 'Login Page',
          url: 'https://app.example.com/login',
          method: 'GET',
          expectedStatus: 200,
          expectedContent: ['Sign In', 'Email', 'Password'],
          criticalPath: true
        },
        {
          name: 'API Health',
          url: 'https://api.example.com/health',
          method: 'GET',
          expectedStatus: 200,
          expectedContent: ['status', 'healthy'],
          criticalPath: true
        },
        {
          name: 'Dashboard',
          url: 'https://app.example.com/dashboard',
          method: 'GET',
          expectedStatus: 200,
          expectedContent: ['Dashboard', 'Overview'],
          authentication: true,
          criticalPath: false
        },
        {
          name: 'User Profile',
          url: 'https://app.example.com/profile',
          method: 'GET',
          expectedStatus: 200,
          expectedContent: ['Profile', 'Settings'],
          authentication: true,
          criticalPath: false
        }
      ],

      // User journeys/scenarios
      journeys: config.journeys || [
        {
          name: 'User Registration',
          steps: [
            { action: 'navigate', url: 'https://app.example.com/register' },
            { action: 'type', selector: 'input[name="email"]', value: 'test@example.com' },
            { action: 'type', selector: 'input[name="password"]', value: 'TestPassword123!' },
            { action: 'type', selector: 'input[name="confirmPassword"]', value: 'TestPassword123!' },
            { action: 'click', selector: 'button[type="submit"]' },
            { action: 'waitFor', selector: '.success-message', timeout: 5000 }
          ],
          expectedOutcome: 'successful_registration',
          criticalPath: false
        },
        {
          name: 'User Login',
          steps: [
            { action: 'navigate', url: 'https://app.example.com/login' },
            { action: 'type', selector: 'input[name="email"]', value: 'user@example.com' },
            { action: 'type', selector: 'input[name="password"]', value: 'UserPassword123!' },
            { action: 'click', selector: 'button[type="submit"]' },
            { action: 'waitFor', selector: '.dashboard', timeout: 5000 }
          ],
          expectedOutcome: 'successful_login',
          criticalPath: true
        },
        {
          name: 'Create Workflow',
          steps: [
            { action: 'navigate', url: 'https://app.example.com/dashboard' },
            { action: 'click', selector: 'button[data-action="create-workflow"]' },
            { action: 'type', selector: 'input[name="name"]', value: 'Test Workflow' },
            { action: 'type', selector: 'textarea[name="description"]', value: 'Test Description' },
            { action: 'click', selector: 'button[data-action="save"]' },
            { action: 'waitFor', selector: '.workflow-created', timeout: 5000 }
          ],
          expectedOutcome: 'workflow_created',
          criticalPath: false,
          authentication: true
        }
      ],

      // Performance thresholds
      performance: {
        responseTime: {
          warning: config.performance?.responseTime?.warning || 2000, // 2 seconds
          critical: config.performance?.responseTime?.critical || 5000 // 5 seconds
        },
        pageLoad: {
          warning: config.performance?.pageLoad?.warning || 3000, // 3 seconds
          critical: config.performance?.pageLoad?.critical || 8000 // 8 seconds
        },
        domInteractive: {
          warning: config.performance?.domInteractive?.warning || 1500, // 1.5 seconds
          critical: config.performance?.domInteractive?.critical || 4000 // 4 seconds
        },
        firstPaint: {
          warning: config.performance?.firstPaint?.warning || 1000, // 1 second
          critical: config.performance?.firstPaint?.critical || 3000 // 3 seconds
        },
        availability: {
          warning: config.performance?.availability?.warning || 95, // 95%
          critical: config.performance?.availability?.critical || 90 // 90%
        }
      },

      // Browser configuration
      browser: {
        headless: config.browser?.headless !== false,
        viewport: config.browser?.viewport || { width: 1920, height: 1080 },
        userAgent: config.browser?.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ignoreHTTPSErrors: config.browser?.ignoreHTTPSErrors !== false,
        args: config.browser?.args || [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      },

      // Alerting configuration
      alerting: {
        enabled: config.alerting?.enabled !== false,
        channels: config.alerting?.channels || ['slack', 'email'],
        cooldown: config.alerting?.cooldown || 900000, // 15 minutes
        consecutiveFailures: config.alerting?.consecutiveFailures || 2
      },

      // Data storage
      storage: {
        dataDir: config.storage?.dataDir || './data/synthetic',
        retentionDays: config.storage?.retentionDays || 30,
        screenshots: config.storage?.screenshots !== false,
        harFiles: config.storage?.harFiles !== false
      }
    };

    this.browser = null;
    this.page = null;
    this.testResults = [];
    this.consecutiveFailures = new Map();
    this.testSchedule = new Map();
    this.activeTests = new Set();
    this.initialized = false;

    this.initialize();
  }

  async initialize() {
    try {
      // Create data directory
      await this.ensureDataDirectory();

      // Initialize browser
      await this.initializeBrowser();

      // Load historical data
      await this.loadHistoricalData();

      // Start monitoring scheduler
      this.startMonitoringScheduler();

      this.initialized = true;
      this.emit('initialized');

    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  async ensureDataDirectory() {
    const directories = [
      this.config.storage.dataDir,
      path.join(this.config.storage.dataDir, 'screenshots'),
      path.join(this.config.storage.dataDir, 'har'),
      path.join(this.config.storage.dataDir, 'results'),
      path.join(this.config.storage.dataDir, 'reports')
    ];

    for (const dir of directories) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  async initializeBrowser() {
    this.browser = await puppeteer.launch({
      headless: this.config.browser.headless,
      args: this.config.browser.args,
      ignoreHTTPSErrors: this.config.browser.ignoreHTTPSErrors,
      defaultViewport: this.config.browser.viewport
    });

    this.page = await this.browser.newPage();
    await this.page.setUserAgent(this.config.browser.userAgent);

    // Enable performance monitoring
    await this.page.coverage.startJSCoverage();
    await this.page.coverage.startCSSCoverage();

    // Set up performance metrics collection
    await this.page.evaluateOnNewDocument(() => {
      window.performanceMetrics = {
        navigationStart: performance.timing.navigationStart,
        domContentLoaded: 0,
        loadComplete: 0,
        firstPaint: 0,
        firstContentfulPaint: 0
      };

      // Track navigation timing
      window.addEventListener('load', () => {
        window.performanceMetrics.domContentLoaded = performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart;
        window.performanceMetrics.loadComplete = performance.timing.loadEventEnd - performance.timing.navigationStart;
      });

      // Track paint timing if available
      if (window.performance && window.performance.getEntriesByType) {
        const paintEntries = window.performance.getEntriesByType('paint');
        paintEntries.forEach(entry => {
          if (entry.name === 'first-paint') {
            window.performanceMetrics.firstPaint = entry.startTime;
          } else if (entry.name === 'first-contentful-paint') {
            window.performanceMetrics.firstContentfulPaint = entry.startTime;
          }
        });
      }
    });

    this.info('Browser initialized for synthetic monitoring');
  }

  async loadHistoricalData() {
    try {
      const resultsFile = path.join(this.config.storage.dataDir, 'results', 'test-results.json');

      if (await this.fileExists(resultsFile)) {
        const data = await fs.readFile(resultsFile, 'utf8');
        this.testResults = JSON.parse(data);
      }
    } catch (error) {
      this.warn('Failed to load historical test results', { error: error.message });
      this.testResults = [];
    }
  }

  startMonitoringScheduler() {
    // Schedule endpoint tests
    for (const endpoint of this.config.endpoints) {
      this.scheduleEndpointTest(endpoint);
    }

    // Schedule journey tests
    for (const journey of this.config.journeys) {
      this.scheduleJourneyTest(journey);
    }

    // Cleanup old data periodically
    setInterval(() => {
      this.cleanupOldData();
    }, 86400000); // Daily

    // Save results periodically
    setInterval(() => {
      this.saveTestResults();
    }, 300000); // Every 5 minutes
  }

  scheduleEndpointTest(endpoint) {
    const testId = `endpoint-${endpoint.name}`;

    const runTest = async () => {
      try {
        this.debug(`Running endpoint test: ${endpoint.name}`);
        const result = await this.runEndpointTest(endpoint);
        await this.processTestResult(testId, result);
      } catch (error) {
        this.warn(`Endpoint test failed: ${endpoint.name}`, { error: error.message });
        const result = this.createErrorResult(endpoint, error);
        await this.processTestResult(testId, result);
      }

      // Schedule next run
      this.testSchedule.set(testId, setTimeout(runTest, this.config.tests.interval));
    };

    // Start first test after a short delay
    this.testSchedule.set(testId, setTimeout(runTest, 5000));
  }

  scheduleJourneyTest(journey) {
    const testId = `journey-${journey.name}`;

    const runTest = async () => {
      try {
        this.debug(`Running journey test: ${journey.name}`);
        const result = await this.runJourneyTest(journey);
        await this.processTestResult(testId, result);
      } catch (error) {
        this.warn(`Journey test failed: ${journey.name}`, { error: error.message });
        const result = this.createErrorResult(journey, error);
        await this.processTestResult(testId, result);
      }

      // Schedule next run
      this.testSchedule.set(testId, setTimeout(runTest, this.config.tests.interval));
    };

    // Start first test after a short delay
    this.testSchedule.set(testId, setTimeout(runTest, 10000));
  }

  async runEndpointTest(endpoint) {
    const startTime = performance.now();
    const result = {
      type: 'endpoint',
      name: endpoint.name,
      url: endpoint.url,
      method: endpoint.method,
      timestamp: Date.now(),
      success: false,
      responseTime: 0,
      statusCode: null,
      contentMatch: false,
      performance: {},
      error: null
    };

    try {
      // Make HTTP request
      const response = await axios({
        method: endpoint.method,
        url: endpoint.url,
        timeout: this.config.tests.timeout,
        validateStatus: () => true, // Don't throw on error status codes
        maxRedirects: 5
      });

      const endTime = performance.now();
      result.responseTime = endTime - startTime;
      result.statusCode = response.status;

      // Check status code
      if (endpoint.expectedStatus) {
        result.statusMatch = response.status === endpoint.expectedStatus;
      } else {
        result.statusMatch = response.status >= 200 && response.status < 300;
      }

      // Check content
      if (endpoint.expectedContent && endpoint.expectedContent.length > 0) {
        const content = response.data;
        result.contentMatch = endpoint.expectedContent.every(expected =>
          typeof content === 'string' ? content.includes(expected) :
          JSON.stringify(content).includes(expected)
        );
      } else {
        result.contentMatch = true;
      }

      // Overall success
      result.success = result.statusMatch && result.contentMatch;

      // Collect performance metrics
      result.performance = {
        responseTime: result.responseTime,
        size: response.headers['content-length'] || 0,
        contentType: response.headers['content-type'] || 'unknown'
      };

    } catch (error) {
      const endTime = performance.now();
      result.responseTime = endTime - startTime;
      result.error = {
        message: error.message,
        code: error.code,
        type: error.constructor.name
      };
    }

    return result;
  }

  async runJourneyTest(journey) {
    const startTime = performance.now();
    const result = {
      type: 'journey',
      name: journey.name,
      timestamp: Date.now(),
      success: false,
      responseTime: 0,
      steps: [],
      performance: {},
      screenshots: [],
      error: null
    };

    try {
      // Create new page for journey test
      const page = await this.browser.newPage();
      await page.setViewport(this.config.browser.viewport);

      // Enable performance monitoring
      await page.coverage.startJSCoverage();
      await page.coverage.startCSSCoverage();

      const stepResults = [];

      for (let i = 0; i < journey.steps.length; i++) {
        const step = journey.steps[i];
        const stepStartTime = performance.now();

        try {
          const stepResult = await this.executeStep(page, step, i);
          stepResult.responseTime = performance.now() - stepStartTime;
          stepResults.push(stepResult);

          // Take screenshot if configured
          if (this.config.storage.screenshots) {
            const screenshotPath = path.join(
              this.config.storage.dataDir,
              'screenshots',
              `${journey.name}-step-${i}-${Date.now()}.png`
            );
            await page.screenshot({ path: screenshotPath, fullPage: true });
            result.screenshots.push(screenshotPath);
          }

        } catch (stepError) {
          const stepResult = {
            step: i,
            action: step.action,
            success: false,
            error: stepError.message,
            responseTime: performance.now() - stepStartTime
          };
          stepResults.push(stepResult);
          break; // Stop journey on first failed step
        }
      }

      result.steps = stepResults;
      result.responseTime = performance.now() - startTime;

      // Check if journey completed successfully
      const allStepsSuccessful = stepResults.every(step => step.success);
      result.success = allStepsSuccessful && stepResults.length === journey.steps.length;

      // Get performance metrics
      const performanceMetrics = await page.evaluate(() => window.performanceMetrics);
      result.performance = {
        ...performanceMetrics,
        jsCoverage: await page.coverage.stopJSCoverage(),
        cssCoverage: await page.coverage.stopCSSCoverage()
      };

      // Generate HAR file if configured
      if (this.config.storage.harFiles) {
        const har = await page.evaluate(() => {
          return new Promise((resolve) => {
            const observer = new PerformanceObserver((list) => {
              const entries = list.getEntries();
              resolve(entries);
            });
            observer.observe({ entryTypes: ['resource', 'navigation'] });
            setTimeout(() => observer.disconnect(), 1000);
          });
        });

        const harPath = path.join(
          this.config.storage.dataDir,
          'har',
          `${journey.name}-${Date.now()}.har`
        );
        await fs.writeFile(harPath, JSON.stringify(har, null, 2));
      }

      await page.close();

    } catch (error) {
      result.responseTime = performance.now() - startTime;
      result.error = {
        message: error.message,
        type: error.constructor.name
      };
    }

    return result;
  }

  async executeStep(page, step, stepIndex) {
    const stepResult = {
      step: stepIndex,
      action: step.action,
      success: false,
      details: null
    };

    switch (step.action) {
      case 'navigate':
        await page.goto(step.url, { waitUntil: 'networkidle2', timeout: this.config.tests.timeout });
        stepResult.details = { url: page.url(), title: await page.title() };
        stepResult.success = true;
        break;

      case 'click':
        await page.waitForSelector(step.selector, { timeout: 10000 });
        await page.click(step.selector);
        stepResult.details = { selector: step.selector };
        stepResult.success = true;
        break;

      case 'type':
        await page.waitForSelector(step.selector, { timeout: 10000 });
        await page.type(step.selector, step.value);
        stepResult.details = { selector: step.selector, value: step.value };
        stepResult.success = true;
        break;

      case 'waitFor':
        await page.waitForSelector(step.selector, { timeout: step.timeout || 30000 });
        stepResult.details = { selector: step.selector };
        stepResult.success = true;
        break;

      case 'waitForNavigation':
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: this.config.tests.timeout }),
          page.click(step.selector)
        ]);
        stepResult.details = { selector: step.selector };
        stepResult.success = true;
        break;

      case 'screenshot':
        const screenshotPath = path.join(
          this.config.storage.dataDir,
          'screenshots',
          `debug-${Date.now()}.png`
        );
        await page.screenshot({ path: screenshotPath, fullPage: true });
        stepResult.details = { path: screenshotPath };
        stepResult.success = true;
        break;

      default:
        throw new Error(`Unknown step action: ${step.action}`);
    }

    return stepResult;
  }

  async processTestResult(testId, result) {
    // Add to results history
    this.testResults.push(result);

    // Keep only recent results
    const retentionCutoff = Date.now() - (this.config.storage.retentionDays * 24 * 60 * 60 * 1000);
    this.testResults = this.testResults.filter(r => r.timestamp > retentionCutoff);

    // Update consecutive failures counter
    if (!result.success) {
      const currentFailures = this.consecutiveFailures.get(testId) || 0;
      this.consecutiveFailures.set(testId, currentFailures + 1);
    } else {
      this.consecutiveFailures.delete(testId);
    }

    // Check if alert should be triggered
    await this.checkAlertConditions(testId, result);

    // Emit event
    this.emit('testResult', result);

    // Log result
    if (result.success) {
      this.debug(`Test passed: ${result.name}`, {
        responseTime: result.responseTime,
        type: result.type
      });
    } else {
      this.warn(`Test failed: ${result.name}`, {
        error: result.error,
        responseTime: result.responseTime,
        type: result.type
      });
    }
  }

  async checkAlertConditions(testId, result) {
    if (!this.config.alerting.enabled) return;

    const consecutiveFailures = this.consecutiveFailures.get(testId) || 0;

    // Check consecutive failures threshold
    if (consecutiveFailures >= this.config.alerting.consecutiveFailures) {
      await this.triggerAlert(result, 'consecutive_failures', {
        failureCount: consecutiveFailures,
        threshold: this.config.alerting.consecutiveFailures
      });
      return;
    }

    // Check performance thresholds
    if (result.success) {
      await this.checkPerformanceThresholds(result);
    }

    // Check critical path failures
    const testConfig = this.config.endpoints.find(e => e.name === result.name) ||
                       this.config.journeys.find(j => j.name === result.name);

    if (testConfig && testConfig.criticalPath && !result.success) {
      await this.triggerAlert(result, 'critical_path_failure', {
        criticalPath: true,
        error: result.error
      });
    }
  }

  async checkPerformanceThresholds(result) {
    const thresholds = this.config.performance;

    // Check response time
    if (result.responseTime > thresholds.responseTime.critical) {
      await this.triggerAlert(result, 'slow_response', {
        responseTime: result.responseTime,
        threshold: thresholds.responseTime.critical,
        severity: 'critical'
      });
    } else if (result.responseTime > thresholds.responseTime.warning) {
      await this.triggerAlert(result, 'slow_response', {
        responseTime: result.responseTime,
        threshold: thresholds.responseTime.warning,
        severity: 'warning'
      });
    }

    // Check page load performance for journeys
    if (result.type === 'journey' && result.performance.loadComplete) {
      if (result.performance.loadComplete > thresholds.pageLoad.critical) {
        await this.triggerAlert(result, 'slow_page_load', {
          loadTime: result.performance.loadComplete,
          threshold: thresholds.pageLoad.critical,
          severity: 'critical'
        });
      }
    }
  }

  async triggerAlert(result, alertType, details) {
    const alert = {
      id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      testId: result.name,
      testType: result.type,
      alertType,
      severity: details.severity || 'warning',
      timestamp: Date.now(),
      result,
      details,
      acknowledged: false,
      resolved: false
    };

    this.emit('alert', alert);

    // Log alert
    this.warn(`Alert triggered: ${alertType} for ${result.name}`, {
      severity: alert.severity,
      details
    });

    // Here you would integrate with your notification system
    // (Slack, email, PagerDuty, etc.)
  }

  createErrorResult(config, error) {
    return {
      type: config.name ? 'endpoint' : 'journey',
      name: config.name || 'unknown',
      timestamp: Date.now(),
      success: false,
      responseTime: 0,
      error: {
        message: error.message,
        type: error.constructor.name
      }
    };
  }

  // Health and status methods
  async healthCheck() {
    const health = {
      status: 'healthy',
      initialized: this.initialized,
      browser: {
        connected: this.browser && this.browser.isConnected(),
        pages: this.browser ? this.browser.pages().length : 0
      },
      tests: {
        total: this.config.endpoints.length + this.config.journeys.length,
        active: this.activeTests.size,
        scheduled: this.testSchedule.size,
        consecutiveFailures: this.consecutiveFailures.size
      },
      results: {
        total: this.testResults.length,
        last24h: this.testResults.filter(r => r.timestamp > Date.now() - 86400000).length,
        successRate: this.calculateSuccessRate()
      }
    };

    return health;
  }

  calculateSuccessRate() {
    const recentResults = this.testResults.filter(r => r.timestamp > Date.now() - 86400000);
    if (recentResults.length === 0) return 100;

    const successfulResults = recentResults.filter(r => r.success);
    return (successfulResults.length / recentResults.length) * 100;
  }

  getTestMetrics(testName, timeRange = 86400000) { // Default: last 24 hours
    const cutoffTime = Date.now() - timeRange;
    const testResults = this.testResults.filter(r =>
      r.name === testName && r.timestamp > cutoffTime
    );

    if (testResults.length === 0) {
      return {
        totalTests: 0,
        successRate: 0,
        averageResponseTime: 0,
        availability: 0
      };
    }

    const successfulTests = testResults.filter(r => r.success);
    const totalResponseTime = testResults.reduce((sum, r) => sum + (r.responseTime || 0), 0);

    return {
      totalTests: testResults.length,
      successfulTests: successfulTests.length,
      successRate: (successfulTests.length / testResults.length) * 100,
      averageResponseTime: totalResponseTime / testResults.length,
      availability: (successfulTests.length / testResults.length) * 100,
      lastTest: testResults[testResults.length - 1]
    };
  }

  // Utility methods
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async saveTestResults() {
    try {
      const resultsFile = path.join(this.config.storage.dataDir, 'results', 'test-results.json');
      await fs.writeFile(resultsFile, JSON.stringify(this.testResults, null, 2));
    } catch (error) {
      this.warn('Failed to save test results', { error: error.message });
    }
  }

  async cleanupOldData() {
    const cutoffTime = Date.now() - (this.config.storage.retentionDays * 24 * 60 * 60 * 1000);

    // Clean up test results
    this.testResults = this.testResults.filter(r => r.timestamp > cutoffTime);

    // Clean up old screenshots
    try {
      const screenshotsDir = path.join(this.config.storage.dataDir, 'screenshots');
      const files = await fs.readdir(screenshotsDir);

      for (const file of files) {
        const filePath = path.join(screenshotsDir, file);
        const stats = await fs.stat(filePath);

        if (stats.mtime.getTime() < cutoffTime) {
          await fs.unlink(filePath);
        }
      }
    } catch (error) {
      this.warn('Failed to cleanup old screenshots', { error: error.message });
    }

    this.info('Old data cleanup completed');
  }

  // Logging methods
  info(message, metadata = {}) {
    console.log(`[SyntheticMonitoring] ${message}`, metadata);
    this.emit('log', { level: 'info', message, metadata });
  }

  warn(message, metadata = {}) {
    console.warn(`[SyntheticMonitoring] ${message}`, metadata);
    this.emit('log', { level: 'warn', message, metadata });
  }

  debug(message, metadata = {}) {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[SyntheticMonitoring] ${message}`, metadata);
      this.emit('log', { level: 'debug', message, metadata });
    }
  }

  // Graceful shutdown
  async shutdown() {
    this.info('Shutting down synthetic monitoring system');

    // Cancel scheduled tests
    for (const [testId, timer] of this.testSchedule) {
      clearTimeout(timer);
    }
    this.testSchedule.clear();

    // Close browser
    if (this.browser) {
      await this.browser.close();
    }

    // Save final results
    await this.saveTestResults();

    this.initialized = false;
    this.emit('shutdown');
  }
}

export default SyntheticMonitoring;