/**
 * Jest configuration for adapter contract suites.
 *
 * These suites stand up real Postgres + Redis testcontainers and
 * exercise both the in-memory and the production adapter against the
 * same assertions. They are slow relative to unit tests (container
 * boot ≈ 3-5 s/file) so they live in their own config with a longer
 * timeout and a separate npm script (`npm run test:contracts`).
 *
 * When Docker is unavailable, every suite auto-skips via
 * `describeIfDocker` (see tests/contracts/_helpers/docker-available.js)
 * so a `test:contracts` run on a sandbox without Docker reports
 * "passed, all skipped" rather than blowing up on container startup.
 */
export default {
  testEnvironment: 'node',
  transform: {
    '^.+\\.js$': 'babel-jest',
  },
  // Deliberately NOT inheriting setupFilesAfterEach from the backend
  // config: that file mutes `console.*`, which would also swallow the
  // `[contracts] Docker unavailable …` notice we want operators to see.
  testMatch: ['<rootDir>/tests/contracts/**/*.contract.test.js'],
  // Container start is the slow path. Most individual assertions take
  // < 50 ms once the container is up; 60 s is the per-test budget.
  testTimeout: 60_000,
  // Per-file container lifetime — see _fixtures/postgres.js. Running
  // workers in parallel would spawn one Postgres container per worker
  // per file simultaneously, which over-subscribes typical dev
  // machines and the GitHub-Actions runners. Keep it at 1; CI matrix
  // already parallelises across OS / Node versions.
  maxWorkers: 1,
  verbose: true,
  collectCoverage: false,
  // Don't trip the global `coverageThreshold` from the backend config
  // when this config is invoked stand-alone.
  forceExit: true,
};
