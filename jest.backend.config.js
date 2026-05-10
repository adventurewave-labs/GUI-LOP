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
    '<rootDir>/tests/integration/full-workflow.test.js',
    '<rootDir>/tests/backend/contexts/**/*.test.js',
    '<rootDir>/src/backend/contexts/**/*.test.js'
  ],

  // Coverage configuration
  collectCoverage: false,
  collectCoverageFrom: [
    'src/backend/**/*.js',
    '!src/frontend/**',
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json'],

  
  // Verbose output
  verbose: true,

  // Test timeout
  testTimeout: 10000
};