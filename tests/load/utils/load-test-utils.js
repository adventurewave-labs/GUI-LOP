/**
 * Load Testing Utilities
 * Common utilities and helper functions for load testing scenarios
 */

const fs = require('fs').promises;
const path = require('path');
const { performance } = require('perf_hooks');

class LoadTestUtils {
  constructor() {
    this.testResults = [];
    this.activeTests = new Map();
    this.testConfigurations = new Map();
  }

  // Generate unique test ID
  generateTestId(testType) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    return `${testType}-${timestamp}-${random}`;
  }

  // Generate realistic test data
  generateRealisticTestData(type, count = 1) {
    const data = [];
    const firstNames = ['John', 'Jane', 'Michael', 'Sarah', 'David', 'Emily', 'Robert', 'Lisa', 'James', 'Mary'];
    const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'];
    const domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'company.com', 'test.com'];

    for (let i = 0; i < count; i++) {
      const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
      const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
      const domain = domains[Math.floor(Math.random() * domains.length)];

      switch (type) {
        case 'user':
          data.push({
            email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${Date.now()}@${domain}`,
            firstName,
            lastName,
            password: 'TestPassword123!',
            role: 'user',
            metadata: {
              source: 'load-test',
              testId: this.generateTestId('user'),
              timestamp: new Date().toISOString()
            }
          });
          break;

        case 'workflow':
          data.push({
            template: ['data-analysis', 'decision-making', 'content-creation', 'system-administration'][Math.floor(Math.random() * 4)],
            context: `Load test workflow ${i} - automated generation`,
            priority: Math.floor(Math.random() * 10) + 1,
            complexity: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)],
            metadata: {
              testId: this.generateTestId('workflow'),
              iteration: i,
              timestamp: new Date().toISOString()
            }
          });
          break;

        case 'session':
          data.push({
            sessionId: this.generateTestId('session'),
            userId: `user-${Math.floor(Math.random() * 10000)}`,
            deviceType: ['desktop', 'mobile', 'tablet'][Math.floor(Math.random() * 3)],
            browser: ['Chrome', 'Firefox', 'Safari', 'Edge'][Math.floor(Math.random() * 4)],
            ipAddress: this.generateRandomIP(),
            metadata: {
              testRun: Date.now(),
              loadTest: true
            }
          });
          break;

        default:
          data.push({
            id: this.generateTestId('generic'),
            type,
            timestamp: new Date().toISOString()
          });
      }
    }

    return count === 1 ? data[0] : data;
  }

  // Generate random IP address
  generateRandomIP() {
    return `${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
  }

  // Calculate statistics from array of numbers
  calculateStats(values) {
    if (!values || values.length === 0) {
      return {
        count: 0,
        min: 0,
        max: 0,
        average: 0,
        median: 0,
        p90: 0,
        p95: 0,
        p99: 0,
        standardDeviation: 0
      };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((acc, val) => acc + val, 0);
    const mean = sum / values.length;

    // Calculate standard deviation
    const squaredDifferences = values.map(value => Math.pow(value - mean, 2));
    const avgSquaredDiff = squaredDifferences.reduce((acc, val) => acc + val, 0) / values.length;
    const standardDeviation = Math.sqrt(avgSquaredDiff);

    return {
      count: values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      average: mean,
      median: sorted[Math.floor(sorted.length / 2)],
      p90: sorted[Math.floor(sorted.length * 0.9)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
      standardDeviation
    };
  }

  // Format duration in milliseconds to human readable format
  formatDuration(ms) {
    if (ms < 1000) {
      return `${ms}ms`;
    } else if (ms < 60000) {
      return `${(ms / 1000).toFixed(2)}s`;
    } else if (ms < 3600000) {
      return `${(ms / 60000).toFixed(2)}m`;
    } else {
      return `${(ms / 3600000).toFixed(2)}h`;
    }
  }

  // Format bytes to human readable format
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  // Calculate percentage with proper formatting
  calculatePercentage(value, total, decimals = 2) {
    if (total === 0) return '0%';
    return `${((value / total) * 100).toFixed(decimals)}%`;
  }

  // Validate performance against thresholds
  validatePerformance(metrics, thresholds) {
    const validation = {
      passed: true,
      violations: [],
      score: 100
    };

    for (const [metric, value] of Object.entries(metrics)) {
      const threshold = thresholds[metric];
      if (threshold !== undefined) {
        let passed = false;
        let violation = null;

        if (typeof threshold === 'object') {
          if (threshold.max && value <= threshold.max) {
            passed = true;
          } else if (threshold.min && value >= threshold.min) {
            passed = true;
          } else if (threshold.range && value >= threshold.range.min && value <= threshold.range.max) {
            passed = true;
          }

          if (!passed) {
            violation = {
              metric,
              actual: value,
              expected: threshold,
              severity: threshold.severity || 'medium'
            };
          }
        } else {
          passed = value <= threshold;
          if (!passed) {
            violation = {
              metric,
              actual: value,
              expected: threshold,
              severity: 'medium'
            };
          }
        }

        if (!passed) {
          validation.passed = false;
          validation.violations.push(violation);
          validation.score -= 10; // Deduct points for violations
        }
      }
    }

    validation.score = Math.max(0, validation.score);
    return validation;
  }

  // Generate performance grade
  generatePerformanceGrade(score) {
    if (score >= 90) return { grade: 'A', color: 'green', description: 'Excellent' };
    if (score >= 80) return { grade: 'B', color: 'blue', description: 'Good' };
    if (score >= 70) return { grade: 'C', color: 'yellow', description: 'Average' };
    if (score >= 60) return { grade: 'D', color: 'orange', description: 'Below Average' };
    return { grade: 'F', color: 'red', description: 'Poor' };
  }

  // Create test configuration
  createTestConfig(testName, config) {
    const defaultConfig = {
      name: testName,
      duration: 300000, // 5 minutes
      concurrentUsers: 100,
      rampUpTime: 30000, // 30 seconds
      thinkTime: 1000, // 1 second
      timeout: 30000, // 30 seconds
      retries: 3,
      enableMonitoring: true,
      saveResults: true,
      thresholds: {
        responseTime: { max: 500, severity: 'high' },
        errorRate: { max: 5, severity: 'critical' },
        throughput: { min: 10, severity: 'medium' }
      }
    };

    const finalConfig = { ...defaultConfig, ...config };
    finalConfig.id = this.generateTestId(testName);
    finalConfig.createdAt = new Date().toISOString();

    this.testConfigurations.set(finalConfig.id, finalConfig);
    return finalConfig;
  }

  // Save test results to file
  async saveTestResults(testId, results, outputDir = './tests/load/reports') {
    try {
      await fs.mkdir(outputDir, { recursive: true });

      const filename = `${testId}-results.json`;
      const filepath = path.join(outputDir, filename);

      const resultsData = {
        testId,
        timestamp: new Date().toISOString(),
        results,
        summary: this.generateTestSummary(results)
      };

      await fs.writeFile(filepath, JSON.stringify(resultsData, null, 2));
      console.log(`Test results saved to: ${filepath}`);

      return filepath;
    } catch (error) {
      console.error('Failed to save test results:', error);
      throw error;
    }
  }

  // Generate test summary
  generateTestSummary(results) {
    if (!results || !results.metrics) {
      return { error: 'Invalid results data' };
    }

    const summary = {
      overview: {
        testName: results.testName || 'Unknown Test',
        duration: results.duration || 0,
        participants: results.concurrentUsers || 0,
        successRate: results.successRate || 0
      },
      performance: {
        averageResponseTime: results.averageResponseTime || 0,
        p95ResponseTime: results.p95ResponseTime || 0,
        p99ResponseTime: results.p99ResponseTime || 0,
        throughput: results.throughput || 0
      },
      reliability: {
        totalRequests: results.totalRequests || 0,
        successfulRequests: results.successfulRequests || 0,
        failedRequests: results.failedRequests || 0,
        errors: results.errors || []
      },
      grade: this.generatePerformanceGrade(results.score || 0)
    };

    return summary;
  }

  // Merge multiple test results
  mergeTestResults(resultsArray) {
    if (!Array.isArray(resultsArray) || resultsArray.length === 0) {
      throw new Error('Invalid results array');
    }

    const merged = {
      testName: 'Merged Test Results',
      timestamp: new Date().toISOString(),
      totalTests: resultsArray.length,
      duration: Math.max(...resultsArray.map(r => r.duration || 0)),
      metrics: {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        responseTimes: [],
        errors: []
      }
    };

    resultsArray.forEach(results => {
      if (results.metrics) {
        merged.metrics.totalRequests += results.metrics.totalRequests || 0;
        merged.metrics.successfulRequests += results.metrics.successfulRequests || 0;
        merged.metrics.failedRequests += results.metrics.failedRequests || 0;

        if (results.metrics.responseTimes) {
          merged.metrics.responseTimes.push(...results.metrics.responseTimes);
        }

        if (results.metrics.errors) {
          merged.metrics.errors.push(...results.metrics.errors);
        }
      }
    });

    // Calculate merged statistics
    const responseTimeStats = this.calculateStats(merged.metrics.responseTimes);
    merged.averageResponseTime = responseTimeStats.average;
    merged.p95ResponseTime = responseTimeStats.p95;
    merged.p99ResponseTime = responseTimeStats.p99;
    merged.successRate = this.calculatePercentage(merged.metrics.successfulRequests, merged.metrics.totalRequests);

    return merged;
  }

  // Create HTML report
  async createHTMLReport(testResults, outputDir = './tests/load/reports') {
    try {
      await fs.mkdir(outputDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `load-test-report-${timestamp}.html`;
      const filepath = path.join(outputDir, filename);

      const html = this.generateHTMLContent(testResults);
      await fs.writeFile(filepath, html);

      console.log(`HTML report generated: ${filepath}`);
      return filepath;
    } catch (error) {
      console.error('Failed to create HTML report:', error);
      throw error;
    }
  }

  // Generate HTML content for report
  generateHTMLContent(results) {
    const summary = this.generateTestSummary(results);
    const grade = summary.grade;

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Load Test Report - ${summary.overview.testName}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background-color: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .grade { font-size: 48px; font-weight: bold; color: ${grade.color}; margin: 10px 0; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .metric-card { background: #f8f9fa; padding: 15px; border-radius: 6px; border-left: 4px solid #007bff; }
        .metric-value { font-size: 24px; font-weight: bold; color: #333; }
        .metric-label { font-size: 14px; color: #666; margin-top: 5px; }
        .section { margin: 30px 0; }
        .section h2 { border-bottom: 2px solid #007bff; padding-bottom: 10px; }
        .performance-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
        .error-list { max-height: 300px; overflow-y: auto; }
        .error-item { background: #fff3cd; border: 1px solid #ffeaa7; padding: 10px; margin: 5px 0; border-radius: 4px; }
        .status-passed { color: #28a745; }
        .status-failed { color: #dc3545; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        .chart-placeholder { background: #f8f9fa; border: 2px dashed #dee2e6; height: 200px; display: flex; align-items: center; justify-content: center; color: #6c757d; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Load Test Report</h1>
            <h2>${summary.overview.testName}</h2>
            <div class="grade">${grade.grade}</div>
            <p>${grade.description} Performance</p>
            <p>Generated on: ${new Date(results.timestamp || Date.now()).toLocaleString()}</p>
        </div>

        <div class="section">
            <h2>Test Overview</h2>
            <div class="summary">
                <div class="metric-card">
                    <div class="metric-value">${summary.overview.participants}</div>
                    <div class="metric-label">Concurrent Users</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${this.formatDuration(summary.overview.duration)}</div>
                    <div class="metric-label">Test Duration</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${summary.overview.successRate}</div>
                    <div class="metric-label">Success Rate</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value ${summary.reliability.successfulRequests === summary.reliability.totalRequests ? 'status-passed' : 'status-failed'}">
                        ${summary.reliability.successfulRequests}/${summary.reliability.totalRequests}
                    </div>
                    <div class="metric-label">Successful Requests</div>
                </div>
            </div>
        </div>

        <div class="section">
            <h2>Performance Metrics</h2>
            <div class="performance-grid">
                <div class="metric-card">
                    <div class="metric-value">${Math.round(summary.performance.averageResponseTime)}ms</div>
                    <div class="metric-label">Average Response Time</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${Math.round(summary.performance.p95ResponseTime)}ms</div>
                    <div class="metric-label">95th Percentile</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${Math.round(summary.performance.p99ResponseTime)}ms</div>
                    <div class="metric-label">99th Percentile</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${Math.round(summary.performance.throughput)}</div>
                    <div class="metric-label">Requests/Second</div>
                </div>
            </div>
        </div>

        <div class="section">
            <h2>Response Time Distribution</h2>
            <div class="chart-placeholder">
                Response Time Chart (Integration with charting library needed)
            </div>
        </div>

        <div class="section">
            <h2>Errors and Issues</h2>
            ${summary.reliability.errors.length > 0 ? `
                <div class="error-list">
                    ${summary.reliability.errors.slice(0, 10).map(error => `
                        <div class="error-item">
                            <strong>${error.timestamp}</strong>: ${error.error || error.message}
                        </div>
                    `).join('')}
                    ${summary.reliability.errors.length > 10 ? `<p>... and ${summary.reliability.errors.length - 10} more errors</p>` : ''}
                </div>
            ` : '<p style="color: #28a745;">No errors detected during the test.</p>'}
        </div>

        <div class="section">
            <h2>Detailed Metrics</h2>
            <table>
                <thead>
                    <tr>
                        <th>Metric</th>
                        <th>Value</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Total Requests</td>
                        <td>${summary.reliability.totalRequests}</td>
                        <td class="status-passed">✓</td>
                    </tr>
                    <tr>
                        <td>Successful Requests</td>
                        <td>${summary.reliability.successfulRequests}</td>
                        <td class="${summary.reliability.successfulRequests > 0 ? 'status-passed' : 'status-failed'}">${summary.reliability.successfulRequests > 0 ? '✓' : '✗'}</td>
                    </tr>
                    <tr>
                        <td>Failed Requests</td>
                        <td>${summary.reliability.failedRequests}</td>
                        <td class="${summary.reliability.failedRequests === 0 ? 'status-passed' : 'status-failed'}">${summary.reliability.failedRequests === 0 ? '✓' : '✗'}</td>
                    </tr>
                    <tr>
                        <td>Average Response Time</td>
                        <td>${Math.round(summary.performance.averageResponseTime)}ms</td>
                        <td class="${summary.performance.averageResponseTime <= 500 ? 'status-passed' : 'status-failed'}">${summary.performance.averageResponseTime <= 500 ? '✓' : '✗'}</td>
                    </tr>
                    <tr>
                        <td>95th Percentile Response Time</td>
                        <td>${Math.round(summary.performance.p95ResponseTime)}ms</td>
                        <td class="${summary.performance.p95ResponseTime <= 500 ? 'status-passed' : 'status-failed'}">${summary.performance.p95ResponseTime <= 500 ? '✓' : '✗'}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</body>
</html>`;
  }

  // Export results to CSV
  async exportToCSV(results, outputDir = './tests/load/reports') {
    try {
      await fs.mkdir(outputDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `load-test-results-${timestamp}.csv`;
      const filepath = path.join(outputDir, filename);

      const csvContent = this.generateCSVContent(results);
      await fs.writeFile(filepath, csvContent);

      console.log(`CSV results exported to: ${filepath}`);
      return filepath;
    } catch (error) {
      console.error('Failed to export CSV:', error);
      throw error;
    }
  }

  // Generate CSV content
  generateCSVContent(results) {
    const headers = ['Timestamp', 'Request Type', 'Response Time', 'Status', 'Error'];
    const rows = [headers.join(',')];

    if (results.metrics && results.metrics.responseTimes) {
      results.metrics.responseTimes.forEach((responseTime, index) => {
        const row = [
          new Date(Date.now() - (results.metrics.responseTimes.length - index) * 1000).toISOString(),
          results.requestType || 'API',
          responseTime,
          'Success',
          ''
        ];
        rows.push(row.join(','));
      });
    }

    return rows.join('\n');
  }
}

module.exports = LoadTestUtils;