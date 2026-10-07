/**
 * Jest config used by Stryker (roadmap #15): the fast per-context unit
 * suites only — no booted-app integration tests — so each mutant runs in
 * milliseconds. Inherits transform/setup from the backend config.
 */
import base from './jest.backend.config.js';

export default {
  ...base,
  testMatch: [
    '<rootDir>/src/backend/contexts/**/__tests__/**/*.test.js',
    '<rootDir>/tests/backend/contexts/**/*.test.js',
  ],
  collectCoverage: false,
  coverageThreshold: undefined,
  verbose: false,
};
