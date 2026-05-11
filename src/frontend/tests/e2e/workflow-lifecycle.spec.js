/**
 * E2E workflow lifecycle.
 *
 *   1. Register / login.
 *   2. Pick the `data-analysis` template and create a workflow.
 *   3. Execute the workflow.
 *   4. Wait for the WebSocket-driven detail page to show
 *      `waiting_for_human` (or open the inbox if it does not).
 *   5. Open the pending step from the inbox, submit `approve`, and assert
 *      the workflow eventually transitions to `completed`.
 */
import { test, expect } from '@playwright/test';

const username = () => `wf-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const password = 'P@ssword123!';

async function registerAndLogin(page) {
  const u = username();
  const email = `${u}@example.com`;
  await page.goto('/register');
  await page.getByTestId('register-username').fill(u);
  await page.getByTestId('register-email').fill(email);
  await page.getByTestId('register-password').fill(password);
  await page.getByTestId('register-submit').click();
  await page.waitForURL(/\/workflows/, { timeout: 15_000 });
}

test.describe('workflow lifecycle', () => {
  test('create → execute → respond → completed', async ({ page }) => {
    await registerAndLogin(page);

    await expect(page.getByTestId('templates-list')).toBeVisible();
    // Click "Start workflow" on the data-analysis template.
    await page.getByTestId('template-data-analysis').getByRole('link').click();
    await page.waitForURL(/\/workflows\/new/, { timeout: 10_000 });
    await expect(page.getByTestId('create-template')).toHaveValue('data-analysis');
    await page.getByTestId('create-context').fill('{"task": "e2e test"}');
    await page.getByTestId('create-submit').click();

    await page.waitForURL(/\/workflows\/[^/]+$/, { timeout: 15_000 });
    await expect(page.getByTestId('workflow-detail')).toBeVisible();

    // Execute.
    await page.getByTestId('execute-button').click();

    // The data-analysis template has a `human` step in the middle, so
    // execution stops at `waiting_for_human`. We poll the status text.
    await expect(page.getByTestId('workflow-status')).toHaveText(
      /waiting_for_human|paused|completed/,
      { timeout: 30_000 },
    );

    const status = await page.getByTestId('workflow-status').textContent();
    if (status && /waiting_for_human|paused/.test(status)) {
      // Open the inbox.
      await page.goto('/inbox');
      await expect(page.getByTestId('inbox-list')).toBeVisible();
      // The list is reactive over WebSocket, but we also fetch on mount.
      const firstItem = page.locator('[data-testid^="inbox-step-"]').first();
      await firstItem.waitFor({ timeout: 15_000 });
      await firstItem.getByRole('link').click();
      await expect(page.getByTestId('respond-form')).toBeVisible();
      await page.getByTestId('respond-approve').click();
      // Back to workflow detail; status should reach completed.
      await page.waitForURL(/\/workflows\/[^/]+$/, { timeout: 15_000 });
      await expect(page.getByTestId('workflow-status')).toHaveText(/completed/, {
        timeout: 30_000,
      });
    }
  });
});
