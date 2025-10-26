/**
 * Security Test Runner
 * Orchestrates all security tests and generates comprehensive reports
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class SecurityTestRunner {
  constructor(options = {}) {
    this.testDir = __dirname;
    this.outputDir = options.outputDir || path.join(__dirname, '../../coverage');
    this.coverageThreshold = options.coverageThreshold || 80;
    this.testFiles = [
      'auth-middleware.test.js',
      'auth-integration.test.js',
      'vulnerability-tests.test.js',
      'blacklist-service.test.js',
      'rate-limit-service.test.js',
      'auth-errors.test.js'
    ];
  }

  /**
   * Run all security tests
   */
  async runAllTests() {
    console.log('🔐 Starting Security Test Suite\n');

    const results = {
      startTime: new Date(),
      testSuites: [],
      totalTests: 0,
      totalPassed: 0,
      totalFailed: 0,
      totalSkipped: 0,
      coverage: {},
      vulnerabilities: [],
      securityIssues: [],
      endTime: null,
      duration: null
    };

    try {
      // Run individual test suites
      for (const testFile of this.testFiles) {
        console.log(`📋 Running ${testFile}...`);
        const suiteResult = await this.runTestSuite(testFile);
        results.testSuites.push(suiteResult);

        results.totalTests += suiteResult.totalTests;
        results.totalPassed += suiteResult.passed;
        results.totalFailed += suiteResult.failed;
        results.totalSkipped += suiteResult.skipped;

        console.log(`✅ ${testFile}: ${suiteResult.passed}/${suiteResult.totalTests} passed\n`);
      }

      // Generate coverage report
      console.log('📊 Generating coverage report...');
      results.coverage = await this.generateCoverageReport();

      // Analyze security issues
      console.log('🔍 Analyzing security issues...');
      results.securityIssues = await this.analyzeSecurityIssues();

      // Generate final report
      results.endTime = new Date();
      results.duration = results.endTime - results.startTime;

      await this.generateSecurityReport(results);

      console.log('\n🎯 Security Test Summary:');
      console.log(`   Total Tests: ${results.totalTests}`);
      console.log(`   Passed: ${results.totalPassed}`);
      console.log(`   Failed: ${results.totalFailed}`);
      console.log(`   Skipped: ${results.totalSkipped}`);
      console.log(`   Duration: ${results.duration}ms`);
      console.log(`   Coverage: ${results.coverage.percentage}%`);

      if (results.securityIssues.length > 0) {
        console.log(`   Security Issues Found: ${results.securityIssues.length}`);
      }

      return results;
    } catch (error) {
      console.error('❌ Security test execution failed:', error.message);
      throw error;
    }
  }

  /**
   * Run individual test suite
   */
  async runTestSuite(testFile) {
    const testPath = path.join(this.testDir, testFile);
    const suiteResult = {
      name: testFile,
      startTime: new Date(),
      endTime: null,
      duration: null,
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      testResults: []
    };

    try {
      // Run Jest with JSON output for parsing
      const jestOutput = execSync(
        `npx jest "${testPath}" --json --verbose --detectOpenHandles`,
        {
          encoding: 'utf8',
          cwd: path.join(__dirname, '../..'),
          timeout: 30000
        }
      );

      const jestResults = JSON.parse(jestOutput);

      suiteResult.totalTests = jestResults.numTotalTests;
      suiteResult.passed = jestResults.numPassedTests;
      suiteResult.failed = jestResults.numFailedTests;
      suiteResult.skipped = jestResults.numPendingTests;

      // Parse individual test results
      jestResults.testResults.forEach(testResult => {
        testResult.assertionResults.forEach(assertion => {
          suiteResult.testResults.push({
            title: assertion.title,
            status: assertion.status,
            failureMessages: assertion.failureMessages || [],
            duration: assertion.duration || 0
          });
        });
      });

      suiteResult.endTime = new Date();
      suiteResult.duration = suiteResult.endTime - suiteResult.startTime;

      return suiteResult;
    } catch (error) {
      suiteResult.endTime = new Date();
      suiteResult.duration = suiteResult.endTime - suiteResult.startTime;
      suiteResult.error = error.message;

      // Try to extract partial results from stderr
      if (error.stdout) {
        try {
          const partialResults = JSON.parse(error.stdout);
          suiteResult.totalTests = partialResults.numTotalTests || 0;
          suiteResult.passed = partialResults.numPassedTests || 0;
          suiteResult.failed = partialResults.numFailedTests || 0;
          suiteResult.skipped = partialResults.numPendingTests || 0;
        } catch (parseError) {
          // Could not parse partial results
        }
      }

      return suiteResult;
    }
  }

  /**
   * Generate coverage report
   */
  async generateCoverageReport() {
    try {
      // Run Jest with coverage
      const coverageOutput = execSync(
        'npx jest "tests/security/**/*.test.js" --coverage --coverageReporters=json --coverageReporters=text',
        {
          encoding: 'utf8',
          cwd: path.join(__dirname, '../..'),
          timeout: 30000
        }
      );

      // Extract JSON coverage data
      const coverageDir = path.join(__dirname, '../../coverage');
      const coverageJsonPath = path.join(coverageDir, 'coverage-final.json');

      if (fs.existsSync(coverageJsonPath)) {
        const coverageData = JSON.parse(fs.readFileSync(coverageJsonPath, 'utf8'));

        return this.calculateCoverageMetrics(coverageData);
      }

      return {
        percentage: 0,
        lines: { covered: 0, total: 0 },
        functions: { covered: 0, total: 0 },
        branches: { covered: 0, total: 0 },
        statements: { covered: 0, total: 0 }
      };
    } catch (error) {
      console.warn('Could not generate coverage report:', error.message);
      return {
        percentage: 0,
        lines: { covered: 0, total: 0 },
        functions: { covered: 0, total: 0 },
        branches: { covered: 0, total: 0 },
        statements: { covered: 0, total: 0 }
      };
    }
  }

  /**
   * Calculate coverage metrics from Jest coverage data
   */
  calculateCoverageMetrics(coverageData) {
    let totalLines = 0, coveredLines = 0;
    let totalFunctions = 0, coveredFunctions = 0;
    let totalBranches = 0, coveredBranches = 0;
    let totalStatements = 0, coveredStatements = 0;

    Object.values(coverageData).forEach(fileData => {
      // Lines coverage
      totalLines += Object.keys(fileData.l || {}).length;
      coveredLines += Object.values(fileData.l || {}).filter(line => line > 0).length;

      // Functions coverage
      totalFunctions += Object.keys(fileData.f || {}).length;
      coveredFunctions += Object.values(fileData.f || {}).filter(fn => fn > 0).length;

      // Branches coverage
      totalBranches += Object.keys(fileData.b || {}).length;
      coveredBranches += Object.values(fileData.b || {})
        .filter(branches => branches.some(coverage => coverage > 0)).length;

      // Statements coverage
      totalStatements += Object.keys(fileData.s || {}).length;
      coveredStatements += Object.values(fileData.s || {})
        .filter(stmt => stmt > 0).length;
    });

    const percentage = totalStatements > 0
      ? Math.round((coveredStatements / totalStatements) * 100)
      : 0;

    return {
      percentage,
      lines: {
        total: totalLines,
        covered: coveredLines,
        percentage: totalLines > 0 ? Math.round((coveredLines / totalLines) * 100) : 0
      },
      functions: {
        total: totalFunctions,
        covered: coveredFunctions,
        percentage: totalFunctions > 0 ? Math.round((coveredFunctions / totalFunctions) * 100) : 0
      },
      branches: {
        total: totalBranches,
        covered: coveredBranches,
        percentage: totalBranches > 0 ? Math.round((coveredBranches / totalBranches) * 100) : 0
      },
      statements: {
        total: totalStatements,
        covered: coveredStatements,
        percentage
      }
    };
  }

  /**
   * Analyze security issues from test results
   */
  async analyzeSecurityIssues() {
    const issues = [];

    // Check for failed tests that indicate security issues
    const testResults = await this.collectAllTestResults();

    testResults.forEach(result => {
      if (result.status === 'failed') {
        const securityIssue = this.categorizeSecurityIssue(result);
        if (securityIssue) {
          issues.push(securityIssue);
        }
      }
    });

    // Check coverage gaps
    if (this.coverage && this.coverage.percentage < this.coverageThreshold) {
      issues.push({
        type: 'coverage',
        severity: 'medium',
        title: 'Insufficient Test Coverage',
        description: `Security test coverage is ${this.coverage.percentage}%, below the ${this.coverageThreshold}% threshold`,
        recommendation: 'Add more comprehensive security tests to improve coverage'
      });
    }

    return issues;
  }

  /**
   * Collect all test results for analysis
   */
  async collectAllTestResults() {
    const allResults = [];

    for (const testFile of this.testFiles) {
      try {
        const suiteResult = await this.runTestSuite(testFile);
        allResults.push(...suiteResult.testResults);
      } catch (error) {
        console.warn(`Could not collect results from ${testFile}:`, error.message);
      }
    }

    return allResults;
  }

  /**
   * Categorize security issues based on test failures
   */
  categorizeSecurityIssue(testResult) {
    const title = testResult.title;
    const messages = testResult.failureMessages;

    if (title.includes('XSS') || messages.some(m => m.includes('XSS'))) {
      return {
        type: 'xss',
        severity: 'high',
        title: 'Cross-Site Scripting Vulnerability',
        description: `Test failed: ${title}`,
        failureMessages: messages,
        recommendation: 'Implement proper input sanitization and output encoding'
      };
    }

    if (title.includes('SQL') || messages.some(m => m.includes('SQL'))) {
      return {
        type: 'sql-injection',
        severity: 'high',
        title: 'SQL Injection Vulnerability',
        description: `Test failed: ${title}`,
        failureMessages: messages,
        recommendation: 'Use parameterized queries and input validation'
      };
    }

    if (title.includes('CSRF') || messages.some(m => m.includes('CSRF'))) {
      return {
        type: 'csrf',
        severity: 'medium',
        title: 'Cross-Site Request Forgery Vulnerability',
        description: `Test failed: ${title}`,
        failureMessages: messages,
        recommendation: 'Implement CSRF tokens and same-site cookie policies'
      };
    }

    if (title.includes('auth') || title.includes('password') || title.includes('token')) {
      return {
        type: 'authentication',
        severity: 'high',
        title: 'Authentication Security Issue',
        description: `Test failed: ${title}`,
        failureMessages: messages,
        recommendation: 'Review authentication implementation for security weaknesses'
      };
    }

    if (title.includes('rate limit') || title.includes('brute')) {
      return {
        type: 'rate-limiting',
        severity: 'medium',
        title: 'Rate Limiting Issue',
        description: `Test failed: ${title}`,
        failureMessages: messages,
        recommendation: 'Implement proper rate limiting to prevent abuse'
      };
    }

    return null;
  }

  /**
   * Generate comprehensive security report
   */
  async generateSecurityReport(results) {
    const reportDir = path.join(this.outputDir, 'security-reports');

    // Ensure directory exists
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(reportDir, `security-report-${timestamp}.json`);
    const htmlReportPath = path.join(reportDir, `security-report-${timestamp}.html`);

    // JSON Report
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));

    // HTML Report
    const htmlReport = this.generateHTMLReport(results);
    fs.writeFileSync(htmlReportPath, htmlReport);

    console.log(`📄 Security reports generated:`);
    console.log(`   JSON: ${reportPath}`);
    console.log(`   HTML: ${htmlReportPath}`);

    return { jsonPath: reportPath, htmlPath: htmlReportPath };
  }

  /**
   * Generate HTML security report
   */
  generateHTMLReport(results) {
    const { testSuites, coverage, securityIssues } = results;

    const severityColors = {
      high: '#dc3545',
      medium: '#ffc107',
      low: '#28a745'
    };

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Security Test Report - ${new Date().toISOString()}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; padding: 30px; }
        .metric { text-align: center; padding: 20px; border-radius: 8px; background: #f8f9fa; border-left: 4px solid #007bff; }
        .metric h3 { margin: 0 0 10px 0; color: #495057; }
        .metric .value { font-size: 2em; font-weight: bold; color: #007bff; }
        .coverage-bar { width: 100%; height: 20px; background: #e9ecef; border-radius: 10px; overflow: hidden; margin-top: 10px; }
        .coverage-fill { height: 100%; background: linear-gradient(90deg, #28a745, #20c997); transition: width 0.3s ease; }
        .test-suites { padding: 0 30px 30px; }
        .test-suite { margin-bottom: 20px; border: 1px solid #dee2e6; border-radius: 8px; overflow: hidden; }
        .suite-header { background: #f8f9fa; padding: 15px 20px; border-bottom: 1px solid #dee2e6; font-weight: 600; }
        .suite-details { padding: 20px; }
        .security-issues { padding: 0 30px 30px; }
        .issue { margin-bottom: 15px; padding: 15px; border-radius: 8px; border-left: 4px solid; }
        .issue.high { border-left-color: ${severityColors.high}; background: #fff5f5; }
        .issue.medium { border-left-color: ${severityColors.medium}; background: #fffbf0; }
        .issue.low { border-left-color: ${severityColors.low}; background: #f0fff4; }
        .severity { display: inline-block; padding: 4px 8px; border-radius: 4px; color: white; font-size: 0.8em; font-weight: bold; margin-right: 10px; }
        .severity.high { background: ${severityColors.high}; }
        .severity.medium { background: ${severityColors.medium}; color: #000; }
        .severity.low { background: ${severityColors.low}; }
        .pass-rate { color: #28a745; font-weight: bold; }
        .fail-rate { color: #dc3545; font-weight: bold; }
        .timestamp { color: #6c757d; font-size: 0.9em; }
        .recommendation { margin-top: 10px; padding: 10px; background: #e7f3ff; border-radius: 4px; font-style: italic; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔐 Security Test Report</h1>
            <p class="timestamp">Generated on ${results.startTime}</p>
            <p>Duration: ${results.duration}ms | Total Tests: ${results.totalTests}</p>
        </div>

        <div class="summary">
            <div class="metric">
                <h3>Tests Passed</h3>
                <div class="value pass-rate">${results.totalPassed}</div>
            </div>
            <div class="metric">
                <h3>Tests Failed</h3>
                <div class="value fail-rate">${results.totalFailed}</div>
            </div>
            <div class="metric">
                <h3>Test Coverage</h3>
                <div class="value">${coverage.percentage}%</div>
                <div class="coverage-bar">
                    <div class="coverage-fill" style="width: ${coverage.percentage}%"></div>
                </div>
            </div>
            <div class="metric">
                <h3>Security Issues</h3>
                <div class="value fail-rate">${securityIssues.length}</div>
            </div>
        </div>

        <div class="test-suites">
            <h2>Test Suite Results</h2>
            ${testSuites.map(suite => `
                <div class="test-suite">
                    <div class="suite-header">
                        ${suite.name}
                        <span style="float: right;">
                            ${suite.passed}/${suite.totalTests} passed
                            (${Math.round((suite.passed / suite.totalTests) * 100)}%)
                        </span>
                    </div>
                    <div class="suite-details">
                        <div>Duration: ${suite.duration}ms</div>
                        <div>Passed: <span class="pass-rate">${suite.passed}</span></div>
                        <div>Failed: <span class="fail-rate">${suite.failed}</span></div>
                        <div>Skipped: ${suite.skipped}</div>
                    </div>
                </div>
            `).join('')}
        </div>

        ${securityIssues.length > 0 ? `
            <div class="security-issues">
                <h2>🚨 Security Issues Found</h2>
                ${securityIssues.map(issue => `
                    <div class="issue ${issue.severity}">
                        <span class="severity ${issue.severity}">${issue.severity.toUpperCase()}</span>
                        <strong>${issue.title}</strong>
                        <p>${issue.description}</p>
                        ${issue.recommendation ? `<div class="recommendation"><strong>Recommendation:</strong> ${issue.recommendation}</div>` : ''}
                    </div>
                `).join('')}
            </div>
        ` : `
            <div class="security-issues">
                <h2>✅ Security Assessment</h2>
                <div class="issue low">
                    <span class="severity low">PASSED</span>
                    <strong>No security vulnerabilities detected</strong>
                    <p>All security tests passed successfully.</p>
                </div>
            </div>
        `}

        <div style="padding: 30px; border-top: 1px solid #dee2e6; margin-top: 30px; text-align: center; color: #6c757d;">
            <p>Security Test Report generated by GUI-LOP Security Test Suite</p>
        </div>
    </div>
</body>
</html>`;

    return html;
  }

  /**
   * Run security tests with CI/CD integration
   */
  async runForCI() {
    const results = await this.runAllTests();

    // Exit with appropriate code for CI systems
    const hasFailures = results.totalFailed > 0;
    const hasSecurityIssues = results.securityIssues.some(issue => issue.severity === 'high');
    const hasLowCoverage = results.coverage.percentage < this.coverageThreshold;

    if (hasFailures || hasSecurityIssues || hasLowCoverage) {
      console.error('\n❌ Security tests failed or issues detected!');
      process.exit(1);
    } else {
      console.log('\n✅ All security tests passed!');
      process.exit(0);
    }
  }
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const runner = new SecurityTestRunner();

  if (process.argv.includes('--ci')) {
    runner.runForCI().catch(error => {
      console.error('CI execution failed:', error);
      process.exit(1);
    });
  } else {
    runner.runAllTests().catch(error => {
      console.error('Test execution failed:', error);
      process.exit(1);
    });
  }
}

export default SecurityTestRunner;