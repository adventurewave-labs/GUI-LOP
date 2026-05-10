export default {
  // Use Node environment for backend testing
  testEnvironment: 'node',

  // Transform ES modules
  transform: {
    '^.+\\.js$': 'babel-jest'
  },

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],

  // Test files: legacy explicit set + new bounded-context tests.
  testMatch: [
    '<rootDir>/tests/backend/server.test.js',
    '<rootDir>/tests/backend/simple-server.test.js',
    '<rootDir>/tests/integration/full-workflow.test.js',
    '<rootDir>/src/backend/contexts/**/__tests__/**/*.test.js'
  ],

  // Coverage configuration (disabled by default for the per-context
  // suite; enable with `--coverage` when needed).
  collectCoverage: false,
  collectCoverageFrom: [
    'src/backend/**/*.js',
    '!src/backend/**/__tests__/**',
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