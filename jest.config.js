export default {
  // Use Node environment for backend testing
  testEnvironment: 'node',

  // Transform ESM source via babel-jest so `import`/`export` and the `jest`
  // global (used in tests/setup.js) work under Jest's CommonJS sandbox.
  transform: {
    '^.+\\.js$': 'babel-jest'
  },

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],

  // Test files: bounded-context tests (DDD layout, next to the code) plus the
  // system-level backend + integration suites.
  testMatch: [
    '<rootDir>/tests/backend/**/*.test.js',
    '<rootDir>/tests/integration/**/*.test.js',
    '<rootDir>/src/backend/**/__tests__/**/*.test.js'
  ],

  // Ignore patterns
  testPathIgnorePatterns: [
    '<rootDir>/src/frontend/',
    '<rootDir>/node_modules/'
  ],

  // Coverage configuration (disabled by default; enable with `--coverage`).
  // Enforcing a global threshold on legacy code that is not yet covered would
  // fail otherwise-green runs, so the bar is scoped to the shared kernel.
  collectCoverage: false,
  collectCoverageFrom: [
    'src/backend/**/*.js',
    '!src/backend/**/__tests__/**',
    '!src/backend/**/*.test.js',
    '!src/frontend/**',
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json'],
  coverageThreshold: {
    './src/backend/shared-kernel/': {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },

  // Map extensionless ESM-style relative imports (`./foo.js`) for resolution.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },

  // Verbose output
  verbose: true,

  // Test timeout
  testTimeout: 10000
};
