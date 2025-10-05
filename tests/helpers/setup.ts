import { jest } from '@jest/globals';

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/gui-lop-test';

// Global test setup
beforeAll(() => {
  // Setup global mocks
  jest.setTimeout(10000);
});

beforeEach(() => {
  // Clear all mocks before each test
  jest.clearAllMocks();
});

afterAll(() => {
  // Cleanup after all tests
});

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};