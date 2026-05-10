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
    '<rootDir>/tests/integration/bootstrap-smoke.test.js',
    // Per-context unit tests live next to the code (DDD layout).
    '<rootDir>/src/backend/**/__tests__/**/*.test.js',
    // Phase 4-6 placed test fixtures under tests/backend/contexts.
    '<rootDir>/tests/backend/contexts/**/*.test.js'
  ],

  // Coverage configuration (disabled by default; enable with `--coverage`).
  collectCoverage: false,
  collectCoverageFrom: [
    'src/backend/**/*.js',
    '!src/backend/**/__tests__/**',
    '!src/backend/**/*.test.js',
    '!src/backend/tests/**',
    '!src/frontend/**',
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json'],
  coverageThreshold: {
    // Phase 0 keeps a high bar for the new shared kernel only.
    // Legacy code is not yet covered by this suite.
    './src/backend/shared-kernel/': {
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
