import { defineConfig, devices } from '@playwright/test';

/**
 * Root Playwright configuration for the repo-level `npm test` entry point.
 *
 * Scoped strictly to the frontend end-to-end specs. Without this, a bare
 * `playwright test` invoked from the repo root falls back to Playwright's
 * default discovery (`**\/*.@(spec|test).?(c|m)[jt]s?(x)`) and picks up the
 * hundreds of Jest `*.test.js` files under `src/backend/**\/__tests__/`,
 * which fail immediately with `ReferenceError: describe is not defined`
 * because they expect the Jest runtime, not Playwright.
 *
 * Pinning `testDir` to the e2e folder and `testMatch` to `*.spec.js` keeps the
 * two runners cleanly separated: Playwright owns `*.spec.js` e2e tests, Jest
 * owns `*.test.js` unit/integration tests.
 *
 * Web servers (v1 backend on :3001, CRA dev server on :3000) are booted with
 * cwd resolved relative to this config file (the repo root).
 */
export default defineConfig({
  testDir: './src/frontend/tests/e2e',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'test-results.xml' }],
  ],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      // v1 backend in dev mode (no DATABASE_URL/REDIS_URL → in-memory adapters;
      // default templates seeded automatically). cwd → repo root.
      command: 'node src/backend/bootstrap/index.js',
      env: { PORT: '3001', LOG_LEVEL: 'warn', NODE_ENV: 'test' },
      url: 'http://localhost:3001/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // CRA dev server; cwd pinned to the frontend package.
      command: 'npm start',
      cwd: 'src/frontend',
      port: 3000,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { BROWSER: 'none', PORT: '3000' },
    },
  ],
  timeout: 60_000,
  expect: { timeout: 10_000 },
});
