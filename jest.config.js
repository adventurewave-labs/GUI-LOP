export default {
  // Use Node environment for backend testing
  testEnvironment: 'node',

  // Transform ES modules
  transform: {},
  extensionsToTreatAsEsm: ['.js'],

  // Globals for ES modules
  globals: {
    'ts-jest': {
      useESM: true
    }
  },

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],

  // Test file patterns - only include backend tests
  testMatch: [
    '<rootDir>/tests/backend/**/*.test.js',
    '<rootDir>/tests/integration/**/*.test.js'
  ],

  // Ignore patterns
  testPathIgnorePatterns: [
    '<rootDir>/src/frontend/',
    '<rootDir>/node_modules/'
  ],

  // Coverage configuration
  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/frontend/**',
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },

  // Module name mapping for ES modules
  moduleNameMapping: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },

  // Verbose output
  verbose: true,

  // Test timeout
  testTimeout: 10000
};