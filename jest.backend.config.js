export default {
  // Use Node environment for backend testing
  testEnvironment: 'node',

  // Transform ES modules
  transform: {
    '^.+\\.js$': 'babel-jest'
  },

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],

  // Only test specific files
  testMatch: [
    '<rootDir>/tests/backend/server.test.js',
    '<rootDir>/tests/backend/simple-server.test.js',
    '<rootDir>/tests/integration/full-workflow.test.js'
  ],

  // Coverage configuration
  collectCoverage: true,
  collectCoverageFrom: [
    'src/backend/**/*.js',
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

  
  // Verbose output
  verbose: true,

  // Test timeout
  testTimeout: 10000
};