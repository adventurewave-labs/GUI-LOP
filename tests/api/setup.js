/**
 * API Test Setup
 * Test configuration and utilities for API testing
 */

import { beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';

// Test configuration
export const TEST_CONFIG = {
  baseURL: process.env.TEST_API_BASE_URL || 'http://localhost:3001',
  timeout: 30000,
  retries: 3,
  parallel: false,
  verbose: process.env.TEST_VERBOSE === 'true'
};

// Test data factory
export const createTestData = () => ({
  users: {
    valid: {
      email: 'testuser@example.com',
      password: 'TestPass123!',
      firstName: 'Test',
      lastName: 'User',
      role: 'user'
    },
    admin: {
      email: 'admin@example.com',
      password: 'AdminPass123!',
      firstName: 'Admin',
      lastName: 'User',
      role: 'admin'
    },
    invalid: {
      email: 'invalid-email',
      password: '123', // Too weak
      firstName: '',
      lastName: ''
    }
  },
  workflows: {
    valid: {
      template: 'data-analysis',
      context: {
        title: 'Test Workflow',
        description: 'A test workflow for testing purposes',
        dataSource: 'test_db'
      },
      settings: {
        priority: 'normal',
        notifyOnComplete: true,
        timeoutMinutes: 30
      }
    },
    invalid: {
      template: '', // Missing template
      context: {}, // Missing required fields
      settings: {}
    }
  }
});

// Test utilities
export const TestUtils = {
  /**
   * Generate random test data
   */
  generateRandomEmail() {
    return `test${Date.now()}@example.com`;
  },

  generateRandomId() {
    return Math.random().toString(36).substr(2, 9);
  },

  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  },

  /**
   * Wait for specified time
   */
  async wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  /**
   * Retry function with exponential backoff
   */
  async retry(fn, maxAttempts = 3, baseDelay = 1000) {
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (attempt < maxAttempts) {
          const delay = baseDelay * Math.pow(2, attempt - 1);
          await this.wait(delay);
        }
      }
    }

    throw lastError;
  },

  /**
   * Create test app instance
   */
  createTestApp() {
    const app = express();
    app.use(express.json());
    return app;
  },

  /**
   * Create authenticated request
   */
  async createAuthenticatedRequest(app, user = null) {
    if (!user) {
      user = createTestData().users.valid;
    }

    // First, register/login the user
    const registerResponse = await request(app)
      .post('/api/v1/auth/register')
      .send(user)
      .expect(201);

    const { accessToken } = registerResponse.body.data.tokens;

    return {
      request: request(app),
      token: accessToken,
      user: registerResponse.body.data.user
    };
  },

  /**
   * Expect API error response
   */
  expectErrorResponse(response, expectedCode, expectedStatus = 400) {
    expect(response.status).toBe(expectedStatus);
    expect(response.body).toMatchObject({
      success: false,
      code: expectedCode,
      timestamp: expect.any(String)
    });
    expect(response.body).toHaveProperty('message');
  },

  /**
   * Expect successful API response
   */
  expectSuccessResponse(response, expectedStatus = 200) {
    expect(response.status).toBe(expectedStatus);
    expect(response.body).toMatchObject({
      success: true,
      timestamp: expect.any(String)
    });
    expect(response.body).toHaveProperty('message');
    expect(response.body).toHaveProperty('data');
  },

  /**
   * Clean up test data
   */
  async cleanupTestData() {
    // This would clean up any test data created during tests
    // Implementation depends on your database setup
  }
};

// Test database utilities
export class TestDatabase {
  constructor() {
    this.isInitialized = false;
  }

  async setup() {
    if (this.isInitialized) return;

    // Setup test database
    // This would connect to a test database and run migrations
    this.isInitialized = true;
  }

  async teardown() {
    if (!this.isInitialized) return;

    // Clean up test database
    await this.cleanup();
    this.isInitialized = false;
  }

  async cleanup() {
    // Clean up all test data
    await TestUtils.cleanupTestData();
  }

  async createTestUser(userData = null) {
    const data = userData || createTestData().users.valid;
    // Create user in test database
    return data;
  }

  async createTestWorkflow(workflowData = null, userId = null) {
    const data = workflowData || createTestData().workflows.valid;
    // Create workflow in test database
    return { ...data, userId };
  }
}

export const testDb = new TestDatabase();

// Global test setup
beforeAll(async () => {
  if (TEST_CONFIG.verbose) {
    console.log('Setting up API test environment...');
  }

  await testDb.setup();

  // Wait for server to be ready
  await TestUtils.wait(2000);
});

afterAll(async () => {
  if (TEST_CONFIG.verbose) {
    console.log('Tearing down API test environment...');
  }

  await testDb.teardown();
});

beforeEach(async () => {
  // Clean up before each test
  await testDb.cleanup();
});

afterEach(async () => {
  // Clean up after each test
  await testDb.cleanup();
});

// Test reporters
export const createTestReporter = () => {
  const results = {
    passed: 0,
    failed: 0,
    errors: [],
    startTime: Date.now()
  };

  return {
    addResult(testName, passed, error = null) {
      if (passed) {
        results.passed++;
      } else {
        results.failed++;
        results.errors.push({
          test: testName,
          error: error?.message || 'Unknown error',
          stack: error?.stack
        });
      }
    },

    getResults() {
      return {
        ...results,
        endTime: Date.now(),
        duration: Date.now() - results.startTime,
        total: results.passed + results.failed
      };
    },

    printResults() {
      const results = this.getResults();
      console.log('\n=== API Test Results ===');
      console.log(`Total: ${results.total}`);
      console.log(`Passed: ${results.passed}`);
      console.log(`Failed: ${results.failed}`);
      console.log(`Duration: ${results.duration}ms`);

      if (results.errors.length > 0) {
        console.log('\nErrors:');
        results.errors.forEach(error => {
          console.log(`❌ ${error.test}: ${error.error}`);
        });
      }

      console.log('========================\n');
    }
  };
};

export const testReporter = createTestReporter();

// Export test environment
export const TestEnvironment = {
  config: TEST_CONFIG,
  utils: TestUtils,
  database: testDb,
  reporter: testReporter,
  data: createTestData()
};

export default TestEnvironment;