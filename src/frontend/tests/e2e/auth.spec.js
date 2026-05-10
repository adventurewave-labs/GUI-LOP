/**
 * E2E auth flow against the v1 backend.
 *
 *   1. Register a new user and land on /workflows.
 *   2. Logout, then log back in with the same credentials.
 *   3. Force a token refresh by clearing localStorage's accessToken and
 *      kicking off another protected fetch — the API client must
 *      transparently use the refresh token to recover.
 */
import { test, expect } from '@playwright/test';

const username = () => `cutover-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const password = 'P@ssword123!';

test.describe('auth', () => {
  test('register, logout, login, refresh', async ({ page }) => {
    const u = username();
    const email = `${u}@example.com`;

    // --- register ---
    await page.goto('/register');
    await expect(page.getByTestId('register-page')).toBeVisible();
    await page.getByTestId('register-username').fill(u);
    await page.getByTestId('register-email').fill(email);
    await page.getByTestId('register-password').fill(password);
    await page.getByTestId('register-submit').click();

    await page.waitForURL(/\/workflows/, { timeout: 15_000 });
    await expect(page.getByTestId('templates-list')).toBeVisible();

    // --- logout ---
    await page.getByTestId('logout-button').click();
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    await expect(page.getByTestId('login-page')).toBeVisible();

    // --- login again ---
    await page.getByTestId('login-identifier').fill(email);
    await page.getByTestId('login-password').fill(password);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/workflows/, { timeout: 15_000 });
    await expect(page.getByTestId('templates-list')).toBeVisible();

    // --- force refresh: drop access token then trigger a protected fetch ---
    await page.evaluate(() => window.localStorage.removeItem('accessToken'));
    // Reload — TemplatesList will re-fetch and the client must refresh transparently.
    await page.reload();
    await expect(page.getByTestId('templates-list')).toBeVisible({ timeout: 10_000 });
  });

  test('protected route redirects unauthenticated user to login with next=', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/workflows/abc');
    await page.waitForURL(/\/login\?next=/, { timeout: 10_000 });
    const url = new URL(page.url());
    expect(url.searchParams.get('next')).toContain('/workflows/abc');
  });
});
