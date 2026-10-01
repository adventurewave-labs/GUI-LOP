export default {
  // Use Node environment for backend testing
  testEnvironment: 'node',

  // Transform ES modules
  transform: {
    '^.+\\.js$': 'babel-jest'
  },

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],

  // Test files: bounded-context tests + system-level integration tests.
  testMatch: [
    '<rootDir>/tests/integration/bootstrap-smoke.test.js',
    '<rootDir>/tests/integration/human-interaction-routes.test.js',
    '<rootDir>/tests/integration/health-endpoint.test.js',
    '<rootDir>/tests/integration/inmemory-event-forwarding.test.js',
    '<rootDir>/tests/integration/workflow-completion.test.js',
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
  coverageReporters: ['text-summary', 'lcov', 'json-summary'],
  // Ratchet (roadmap #15): per-area floors set 1 point under the measured
  // baseline on 2026-10-01. Raise them as coverage improves; never lower.
  // Pg adapters are exercised by the contract suite (separate run), so
  // these floors cover the unit/integration gate only.
  coverageThreshold: {
    './src/backend/bootstrap/': { branches: 56, functions: 75, lines: 78, statements: 75 },
    './src/backend/contexts/audit-and-analytics/': { branches: 42, functions: 72, lines: 61, statements: 59 },
    './src/backend/contexts/human-interaction/': { branches: 59, functions: 60, lines: 73, statements: 69 },
    './src/backend/contexts/identity-and-access/': { branches: 69, functions: 77, lines: 80, statements: 78 },
    './src/backend/contexts/notification/': { branches: 59, functions: 60, lines: 74, statements: 72 },
    './src/backend/contexts/ui-generation/': { branches: 70, functions: 78, lines: 86, statements: 81 },
    './src/backend/contexts/workflow-orchestration/': { branches: 63, functions: 84, lines: 81, statements: 78 },
    './src/backend/shared-kernel/': { branches: 79, functions: 88, lines: 91, statements: 90 },
  },

  // Verbose output
  verbose: true,

  // Test timeout
  testTimeout: 10000
};
