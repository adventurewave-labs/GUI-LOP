// @ts-check
/**
 * Mutation testing for the bounded-context domain layers (roadmap #15).
 *
 * Domain code is pure (no I/O), so it is where mutation score is the most
 * honest signal of test quality. `break` is the ratchet: set just under the
 * measured baseline; raise it as tests improve, never lower it.
 *
 *   npm run test:mutation                      # all domains
 *   npm run test:mutation -- --mutate 'src/backend/contexts/identity-and-access/domain/**\/*.js'
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
  testRunner: 'jest',
  jest: { configFile: 'jest.mutation.config.js', enableFindRelatedTests: true },
  coverageAnalysis: 'perTest',
  mutate: [
    'src/backend/contexts/*/domain/**/*.js',
    '!src/backend/contexts/*/domain/**/__tests__/**',
  ],
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  tempDirName: '.stryker-tmp',
  concurrency: 2,
  timeoutMS: 10000,
  // Baseline 2026-10-01: 57.4% → 65.2% after round-2 loops 6-7 (2175/3337;
  // audit-and-analytics has no domain layer). Per context: ui-generation 84.8,
  // workflow-orchestration 67.4, human-interaction 63.4, notification 61.3,
  // identity-and-access 57.4. Ratchet: raise `break`, never lower it.
  thresholds: { high: 80, low: 60, break: 63 },
};
