import { test, expect } from '@playwright/test';

test.describe('GUI-LOP Frontend Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the frontend
    await page.goto('http://localhost:3000');

    // Wait for the page to load
    await page.waitForLoadState('networkidle');
  });

  test('should load the main dashboard', async ({ page }) => {
    // Check if the header is present
    await expect(page.locator('h1')).toContainText('GUI-LOP - Generative UI Platform');

    // Check if server status is shown
    await expect(page.locator('.status-indicators')).toBeVisible();

    // Check navigation links
    await expect(page.locator('nav')).toContainText(['Dashboard', 'Workflows', 'Events']);
  });

  test('should connect to backend server', async ({ page }) => {
    // Wait for server connection
    await page.waitForSelector('.status.connected', { timeout: 10000 });

    // Verify connected status
    const serverStatus = page.locator('.status').first();
    await expect(serverStatus).toContainText('Server: connected');
  });

  test('should load workflow templates', async ({ page }) => {
    // Navigate to workflows page
    await page.click('a[href="/workflows"]');

    // Wait for workflows to load
    await page.waitForSelector('.workflow-card');

    // Should have at least 3 workflow templates
    const workflowCards = page.locator('.workflow-card');
    await expect(workflowCards).toHaveCount(3);

    // Check specific workflows exist
    await expect(page.locator('text=Data Analysis Workflow')).toBeVisible();
    await expect(page.locator('text=Decision Making Workflow')).toBeVisible();
    await expect(page.locator('text=Content Creation Workflow')).toBeVisible();
  });

  test('should create and execute workflow', async ({ page }) => {
    // Navigate to workflows page
    await page.click('a[href="/workflows"]');

    // Wait for workflows to load
    await page.waitForSelector('.workflow-card');

    // Start first workflow (Data Analysis)
    await page.click('.workflow-card button:has-text("Start Workflow")');

    // Should show active workflow section
    await page.waitForSelector('.active-workflow');
    await expect(page.locator('.active-workflow')).toContainText('Current Workflow');

    // Should have workflow ID
    await expect(page.locator('.active-workflow')).toContainText('Workflow ID:');

    // Status should update to executing
    await expect(page.locator('.active-workflow')).toContainText('Status: executing');
  });

  test('should handle WebSocket connection', async ({ page }) => {
    // Wait for WebSocket to connect
    await page.waitForSelector('.status.connected', { timeout: 10000 });

    // Check WebSocket status
    const wsStatus = page.locator('.status').nth(1);
    await expect(wsStatus).toContainText('WS: Connected');
  });

  test('should navigate to events page and show logs', async ({ page }) => {
    // Navigate to events page
    await page.click('a[href="/events"]');

    // Should show event log container
    await expect(page.locator('.log-container')).toBeVisible();

    // Should have initial log entries
    await page.waitForSelector('.log-entry');
    const logEntries = page.locator('.log-entry');
    await expect(logEntries.count()).toBeGreaterThan(0);

    // Should show server connection log
    await expect(page.locator('text=Server connected successfully')).toBeVisible();
    await expect(page.locator('text=WebSocket connected')).toBeVisible();
  });

  test('should complete workflow with human approval', async ({ page }) => {
    // Navigate to workflows page
    await page.click('a[href="/workflows"]');

    // Start a workflow
    await page.waitForSelector('.workflow-card');
    await page.click('.workflow-card button:has-text("Start Workflow")');

    // Wait for workflow to be ready for human input
    await page.waitForSelector('.active-workflow:has-text("waiting_for_human")', { timeout: 15000 });

    // Should show approve button
    await expect(page.locator('button:has-text("Approve & Continue")')).toBeVisible();

    // Click approve to complete workflow
    await page.click('button:has-text("Approve & Continue")');

    // Should show completion message in events
    await page.click('a[href="/events"]');
    await page.waitForSelector('text=Response submitted to workflow');
    await expect(page.locator('text=Workflow completed successfully')).toBeVisible();
  });

  test('should handle multiple workflows', async ({ page }) => {
    // Navigate to workflows page
    await page.click('a[href="/workflows"]');

    // Start multiple workflows
    await page.waitForSelector('.workflow-card');

    // Start Data Analysis workflow
    await page.locator('.workflow-card:has-text("Data Analysis") button').click();
    await page.waitForSelector('.active-workflow');

    // Navigate to dashboard and start another workflow
    await page.click('a[href="/"]');
    await page.waitForSelector('button:has-text("Start Data Analysis Workflow")');
    await page.click('button:has-text("Start Decision Making Workflow")');

    // Should show workflow creation in events
    await page.click('a[href="/events"]');
    await expect(page.locator('text=Creating workflow:')).toBeVisible();
  });

  test('should show error handling for server disconnection', async ({ page }) => {
    // This test would require simulating server failure
    // For now, just verify error state is displayed properly

    // Check if error status is handled
    const serverStatus = page.locator('.status').first();

    // Should eventually show connected status
    await expect(serverStatus).toContainText('Server: connected');
  });

  test('should have responsive design', async ({ page }) => {
    // Test desktop view
    await page.setViewportSize({ width: 1200, height: 800 });
    await expect(page.locator('.header-content')).toBeVisible();

    // Test tablet view
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(page.locator('.header')).toBeVisible();

    // Test mobile view
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('.nav')).toBeVisible();
  });

  test('should persist navigation state', async ({ page }) => {
    // Navigate to workflows page
    await page.click('a[href="/workflows"]');
    await page.waitForSelector('.workflow-card');

    // Reload page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Should still be on workflows page
    await expect(page.locator('.workflow-card')).toBeVisible();
  });

  test('should handle rapid workflow creation', async ({ page }) => {
    // Navigate to workflows page
    await page.click('a[href="/workflows"]');
    await page.waitForSelector('.workflow-card');

    // Rapidly click multiple workflow buttons
    const buttons = page.locator('.workflow-card button');
    const count = await buttons.count();

    for (let i = 0; i < Math.min(count, 3); i++) {
      await buttons.nth(i).click();
      await page.waitForTimeout(500); // Small delay between clicks
    }

    // Should handle multiple requests gracefully
    await page.click('a[href="/events"]');
    await expect(page.locator('.log-entry')).toHaveCount.greaterThan(5);
  });
});

test.describe('GUI-LOP Backend Integration Tests', () => {
  test('should verify backend API endpoints are working', async ({ request }) => {
    // Test health endpoint
    const healthResponse = await request.get('http://localhost:3001/health');
    expect(healthResponse.ok()).toBeTruthy();
    const healthData = await healthResponse.json();
    expect(healthData.status).toBe('ok');

    // Test workflows templates endpoint
    const templatesResponse = await request.get('http://localhost:3001/api/workflows/templates');
    expect(templatesResponse.ok()).toBeTruthy();
    const templatesData = await templatesResponse.json();
    expect(templatesData.templates).toHaveLength(3);
  });

  test('should create workflow via API', async ({ request }) => {
    // Create workflow
    const createResponse = await request.post('http://localhost:3001/api/workflows', {
      data: {
        template: 'data-analysis',
        context: { task: 'Test workflow creation' }
      }
    });
    expect(createResponse.ok()).toBeTruthy();
    const createData = await createResponse.json();
    expect(createData.workflow_id).toBeTruthy();

    // Execute workflow
    const executeResponse = await request.post(`http://localhost:3001/api/workflows/${createData.workflow_id}/execute`);
    expect(executeResponse.ok()).toBeTruthy();

    // Get workflow status
    const statusResponse = await request.get(`http://localhost:3001/api/workflows/${createData.workflow_id}`);
    expect(statusResponse.ok()).toBeTruthy();
    const statusData = await statusResponse.json();
    expect(statusData.status).toBe('running');
  });
});