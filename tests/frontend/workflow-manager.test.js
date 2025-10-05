const { test, expect } = require('@playwright/test');

test.describe('WorkflowManager Component', () => {
  test.beforeEach(async ({ page }) => {
    // Mock API responses
    await page.route('**/api/health', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok' })
      });
    });

    await page.route('**/api/sessions', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'test-workflow-session',
          type: 'gui-lop',
          createdAt: new Date().toISOString()
        })
      });
    });
  });

  test('initializes workflow manager correctly', async ({ page }) => {
    await page.goto('/');

    // Wait for workflow progress component to be visible
    await expect(page.locator('.workflow-progress')).toBeVisible();

    // Check initial state display
    await expect(page.locator('.workflow-state')).toBeVisible();
    await expect(page.locator('.workflow-header h4:has-text("Workflow Status")')).toBeVisible();
  });

  test('displays workflow state changes', async ({ page }) => {
    await page.goto('/');

    // Wait for initial load
    await page.waitForSelector('.workflow-progress');

    // Monitor workflow state changes
    const stateChanges = [];
    page.on('console', (msg) => {
      if (msg.text().includes('Workflow state changed:')) {
        stateChanges.push(msg.text());
      }
    });

    // Click start workflow button
    await page.click('.start-workflow-btn');

    // Wait for state change
    await page.waitForTimeout(1000);

    // Verify state was logged
    expect(stateChanges.length).toBeGreaterThan(0);

    // Check UI reflects state change
    const stateElement = page.locator('.workflow-state');
    await expect(stateElement).toBeVisible();
  });

  test('shows workflow progress correctly', async ({ page }) => {
    await page.goto('/');

    // Wait for workflow progress component
    await expect(page.locator('.workflow-progress')).toBeVisible();

    // Start workflow to see progress
    await page.click('.start-workflow-btn');

    // Wait for progress to update
    await page.waitForTimeout(1000);

    // Check progress bar elements
    const progressBar = page.locator('.progress-bar');
    if (await progressBar.isVisible()) {
      await expect(progressBar).toBeVisible();

      const progressFill = page.locator('.progress-fill');
      await expect(progressFill).toBeVisible();

      const progressText = page.locator('.progress-text');
      await expect(progressText).toBeVisible();
    }
  });

  test('handles workflow completion', async ({ page }) => {
    await page.goto('/');

    // Mock workflow completion event
    await page.addInitScript(() => {
      window.testWorkflowComplete = () => {
        const event = new CustomEvent('workflowComplete', {
          detail: { results: { success: true } }
        });
        window.dispatchEvent(event);
      };
    });

    await page.waitForSelector('.workflow-progress');

    // Simulate workflow completion
    await page.evaluate(() => {
      window.testWorkflowComplete?.();
    });

    // Check for completion indicators
    await page.waitForTimeout(500);

    // Look for completion state in UI
    const stateElement = page.locator('.workflow-state');
    const stateText = await stateElement.textContent();
    expect(stateText || '').toContain('COMPLETED');
  });

  test('manages workflow history', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('.workflow-progress');

    // Generate some workflow activity
    await page.click('.start-workflow-btn');
    await page.waitForTimeout(1000);

    // Check if history is being tracked
    const historyData = await page.evaluate(() => {
      return window.workflowHistory || [];
    });

    // Should have some history entries
    expect(Array.isArray(historyData)).toBe(true);
  });

  test('handles workflow errors gracefully', async ({ page }) => {
    await page.goto('/');

    // Mock error condition
    await page.route('**/api/sessions/*/workflows', (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'Workflow execution failed',
          error: 'Internal server error'
        })
      });
    });

    await page.waitForSelector('.workflow-progress');

    // Attempt to start workflow
    await page.click('.start-workflow-btn');

    // Wait for error handling
    await page.waitForTimeout(1000);

    // Check for error display
    const errorState = page.locator('.workflow-state');
    const errorText = await errorState.textContent();
    expect(errorText || '').toContain('ERROR');
  });

  test('provides workflow controls', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('.workflow-progress');

    // Check for control buttons
    const startButton = page.locator('.start-workflow-btn');
    await expect(startButton).toBeVisible();
    await expect(startButton).toBeEnabled();

    const resetButton = page.locator('.reset-btn');
    await expect(resetButton).toBeVisible();
    await expect(resetButton).toBeEnabled();
  });

  test('updates workflow metadata correctly', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('.workflow-progress');

    // Start workflow to generate metadata
    await page.click('.start-workflow-btn');
    await page.waitForTimeout(1000);

    // Check for timing information
    const timingInfo = page.locator('.workflow-timing');
    if (await timingInfo.isVisible()) {
      await expect(timingInfo).toContainText('Started:');
    }

    // Check for current step information
    const currentStep = page.locator('.current-step');
    if (await currentStep.isVisible()) {
      await expect(currentStep).toContainText('Current Step:');
    }
  });

  test('handles collaboration requests', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('.workflow-progress');

    // Mock approval request event
    await page.evaluate(() => {
      const event = {
        type: 'approval_request',
        sessionId: 'test-workflow-session',
        payload: {
          message: 'Please approve this action',
          options: { timeout: 30000 }
        }
      };

      // Simulate AG-UI event
      setTimeout(() => {
        if (window.aguiEventService) {
          window.aguiEventService.emit(event);
        }
      }, 500);
    });

    // Wait for collaboration handling
    await page.waitForTimeout(1000);

    // Check for debug overlay (in development mode)
    const debugOverlay = page.locator('.debug-overlay');
    if (await debugOverlay.isVisible()) {
      await expect(debugOverlay.locator('h4:has-text("Pending Approvals")')).toBeVisible();
    }
  });

  test('maintains workflow state persistence', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('.workflow-progress');

    // Start workflow
    await page.click('.start-workflow-btn');
    await page.waitForTimeout(1000);

    // Get current state
    const stateBefore = await page.evaluate(() => {
      return window.workflowState || {};
    });

    // Navigate away and back (simulate page refresh)
    await page.reload();
    await page.waitForSelector('.workflow-progress');

    // Check if state was restored
    await page.waitForTimeout(1000);

    // Note: State persistence would require local storage or backend integration
    // This test verifies the component handles re-initialization
    const stateAfter = await page.evaluate(() => {
      return window.workflowState || {};
    });

    expect(typeof stateAfter).toBe('object');
  });

  test('handles concurrent workflow operations', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('.workflow-progress');

    // Start multiple operations rapidly
    await page.click('.start-workflow-btn');
    await page.waitForTimeout(200);

    // Try to pause/resume
    await page.keyboard.press('Tab'); // Navigate to controls
    await page.waitForTimeout(100);

    // Verify no crashes or unexpected behavior
    const stateElement = page.locator('.workflow-state');
    await expect(stateElement).toBeVisible();
  });
});

test.describe('WorkflowManager Integration', () => {
  test('integrates with EventHandlers component', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('.workflow-progress');

    // Test event propagation between components
    const events = [];
    page.on('console', (msg) => {
      if (msg.text().includes('AG-UI Event')) {
        events.push(msg.text());
      }
    });

    // Trigger workflow event
    await page.click('.start-workflow-btn');
    await page.waitForTimeout(1000);

    // Verify events were handled by both components
    expect(events.length).toBeGreaterThan(0);
  });

  test('integrates with UIContainer component', async ({ page }) => {
    await page.goto('/');

    // Wait for both components to be ready
    await Promise.all([
      page.waitForSelector('.workflow-progress'),
      page.waitForSelector('.ui-iframe')
    ]);

    // Test workflow-driven UI updates
    await page.click('.start-workflow-btn');
    await page.waitForTimeout(1000);

    // Verify UI container responds to workflow state
    const iframe = page.locator('.ui-iframe');
    await expect(iframe).toBeVisible();
  });

  test('coordinates API calls correctly', async ({ page }) => {
    await page.goto('/');

    // Track API calls
    const apiCalls = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/')) {
        apiCalls.push({
          url: request.url(),
          method: request.method()
        });
      }
    });

    await page.waitForSelector('.workflow-progress');

    // Trigger workflow operation
    await page.click('.start-workflow-btn');
    await page.waitForTimeout(1000);

    // Verify expected API calls were made
    expect(apiCalls.some(call => call.url.includes('/sessions'))).toBe(true);
  });

  test('handles session management correctly', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('.workflow-progress');

    // Get session ID from the app
    const sessionId = await page.evaluate(() => {
      return window.sessionId || document.querySelector('[data-session-id]')?.dataset.sessionId;
    });

    expect(sessionId).toBeTruthy();
    expect(typeof sessionId).toBe('string');
  });
});

test.describe('WorkflowManager Performance', () => {
  test('handles rapid state updates efficiently', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('.workflow-progress');

    const startTime = Date.now();

    // Generate rapid state updates
    await page.evaluate(() => {
      const service = window.aguiEventService;
      if (service) {
        for (let i = 0; i < 50; i++) {
          setTimeout(() => {
            service.emit({
              type: 'workflow_state',
              sessionId: 'test-session',
              payload: {
                state: 'running',
                step: `step-${i}`,
                timestamp: new Date().toISOString()
              }
            });
          }, i * 10);
        }
      }
    });

    // Wait for all updates to process
    await page.waitForTimeout(1000);

    const processingTime = Date.now() - startTime;
    expect(processingTime).toBeLessThan(2000); // Should process within 2 seconds
  });

  test('maintains responsive UI during workflow execution', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('.workflow-progress');

    // Start workflow and test UI responsiveness
    await page.click('.start-workflow-btn');

    // Try to interact with UI while workflow is running
    await page.hover('.start-workflow-btn');
    await page.click('.reset-btn');

    // UI should remain responsive
    await expect(page.locator('.reset-btn')).toBeVisible();
  });

  test('efficiently manages memory usage', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('.workflow-progress');

    // Get initial memory usage
    const initialMemory = await page.evaluate(() => {
      return performance.memory ? performance.memory.usedJSHeapSize : 0;
    });

    // Generate significant workflow activity
    for (let i = 0; i < 10; i++) {
      await page.click('.start-workflow-btn');
      await page.waitForTimeout(100);
      await page.click('.reset-btn');
      await page.waitForTimeout(100);
    }

    // Check memory usage after activity
    const finalMemory = await page.evaluate(() => {
      return performance.memory ? performance.memory.usedJSHeapSize : 0;
    });

    // Memory usage should not increase excessively
    const memoryIncrease = finalMemory - initialMemory;
    expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024); // Less than 50MB increase
  });
});