import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the GUI-LOP frontend cut-over.
 *
 * Boots two web servers:
 *   - The DDD/v1 backend (in-memory adapters, default templates auto-seeded)
 *     on port 3001, via `node ../../src/backend/bootstrap/index.js`.
 *   - The CRA dev server on port 3000, via `npm start`.
 *
 * The legacy global-setup / global-teardown files are kept for backwards
 * compatibility with older smoke runs but are no-ops by default.
 */
export default defineConfig({
  testDir: './tests/e2e',
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
      // Boots the v1 server in dev mode (no DATABASE_URL/REDIS_URL → in-memory
      // adapters; default templates are seeded automatically). `cwd` is
      // resolved relative to this config file → repo root.
      command: 'node src/backend/bootstrap/index.js',
      cwd: '../../',
      env: { PORT: '3001', LOG_LEVEL: 'warn', NODE_ENV: 'test' },
      url: 'http://localhost:3001/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm start',
      port: 3000,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { BROWSER: 'none', PORT: '3000' },
    },
  ],
  timeout: 60_000,
  expect: { timeout: 10_000 },
});
