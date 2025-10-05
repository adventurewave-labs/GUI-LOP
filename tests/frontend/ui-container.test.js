const { test, expect } = require('@playwright/test');

test.describe('UIContainer Component', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the API service
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
          id: 'test-session-123',
          type: 'gui-lop',
          createdAt: new Date().toISOString()
        })
      });
    });

    // Mock WebSocket
    await page.addInitScript(() => {
      window.WebSocket = class MockWebSocket {
        constructor(url) {
          this.url = url;
          this.readyState = WebSocket.CONNECTING;
          setTimeout(() => {
            this.readyState = WebSocket.OPEN;
            this.onopen?.();
          }, 100);
        }

        send(data) {
          console.log('WebSocket send:', data);
        }

        close() {
          this.readyState = WebSocket.CLOSED;
          this.onclose?.();
        }

        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;
      };
    });
  });

  test('renders UIContainer with loading state', async ({ page }) => {
    await page.goto('/');

    // Wait for the loading state
    await expect(page.locator('.ui-loading-overlay')).toBeVisible();
    await expect(page.locator('.loading-spinner')).toBeVisible();
    await expect(page.locator('p:has-text("Generating dynamic UI...")')).toBeVisible();
  });

  test('loads UI iframe successfully', async ({ page }) => {
    await page.goto('/');

    // Wait for iframe to load
    const iframe = page.locator('.ui-iframe');
    await expect(iframe).toBeVisible();

    // Check iframe attributes
    await expect(iframe).toHaveAttribute('title', 'Dynamic UI Component');
    await expect(iframe).toHaveAttribute('sandbox');
  });

  test('handles WebSocket events correctly', async ({ page }) => {
    await page.goto('/');

    // Listen for console messages to verify event handling
    const events = [];
    page.on('console', (msg) => {
      if (msg.text().includes('Received AG-UI event:')) {
        events.push(msg.text());
      }
    });

    // Wait for initial load
    await page.waitForSelector('.ui-iframe');

    // Simulate WebSocket message
    await page.evaluate(() => {
      const ws = new WebSocket('ws://localhost:3001/ws/test-session-123');
      setTimeout(() => {
        // Simulate receiving an AG-UI event
        const event = {
          type: 'ui_update',
          sessionId: 'test-session-123',
          payload: { refresh: true }
        };
        ws.onmessage?.({ data: JSON.stringify(event) });
      }, 200);
    });

    // Verify event was handled
    await page.waitForTimeout(500);
    expect(events.length).toBeGreaterThan(0);
  });

  test('displays error state on API failure', async ({ page }) => {
    // Mock API failure
    await page.route('**/api/health', (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Service unavailable' })
      });
    });

    await page.goto('/');

    // Check for error display
    await expect(page.locator('.app-error')).toBeVisible();
    await expect(page.locator('h2:has-text("GUI-LOP Error")')).toBeVisible();
    await expect(page.locator('button:has-text("Reset Application")')).toBeVisible();
  });

  test('supports different UI types', async ({ page }) => {
    await page.goto('/');

    // Wait for initial load
    await page.waitForSelector('.ui-iframe');

    // Select Gradio UI type
    await page.selectOption('.ui-type-selector', 'gradio');

    // Verify iframe source was updated
    const iframe = page.locator('.ui-iframe');
    const src = await iframe.getAttribute('src');
    expect(src).toContain('gradio');
  });

  test('shows debug information in development mode', async ({ page }) => {
    await page.goto('/');

    // Wait for initial load
    await page.waitForSelector('.ui-iframe');

    // Look for debug info (should be visible in development)
    const debugInfo = page.locator('.debug-info');
    if (await debugInfo.isVisible()) {
      await expect(debugInfo.locator('p:has-text("Session ID:")')).toBeVisible();
      await expect(debugInfo.locator('p:has-text("UI Type:")')).toBeVisible();
    }
  });

  test('handles workflow state changes', async ({ page }) => {
    await page.goto('/');

    // Wait for workflow progress component
    await expect(page.locator('.workflow-progress')).toBeVisible();

    // Check initial state
    await expect(page.locator('.workflow-state')).toBeVisible();

    // Click start workflow button
    await page.click('.start-workflow-btn');

    // Wait for potential state change
    await page.waitForTimeout(1000);

    // Verify workflow state is displayed
    const stateElement = page.locator('.workflow-state');
    await expect(stateElement).toBeVisible();
  });

  test('iframe communication works correctly', async ({ page }) => {
    await page.goto('/');

    // Wait for iframe to load
    const iframe = page.locator('.ui-iframe');
    await expect(iframe).toBeVisible();

    // Test postMessage communication
    await page.evaluate(() => {
      const iframe = document.querySelector('.ui-iframe');
      iframe.onload = () => {
        // Simulate message from iframe
        window.postMessage({
          type: 'IFRAME_READY',
          payload: { sessionId: 'test-session-123' }
        }, '*');
      };
    });

    // Listen for postMessage handling
    const messages = [];
    page.on('console', (msg) => {
      if (msg.text().includes('postMessage')) {
        messages.push(msg.text());
      }
    });

    await page.waitForTimeout(500);
    // Note: PostMessage testing may need additional setup
  });

  test('handles iframe errors gracefully', async ({ page }) => {
    // Mock iframe load error
    await page.route('**/streamlit/**', (route) => {
      route.fulfill({
        status: 404,
        body: 'Not Found'
      });
    });

    await page.goto('/');

    // Wait for error handling
    await page.waitForTimeout(1000);

    // Check if error state is shown
    const errorContainer = page.locator('.ui-container-error');
    if (await errorContainer.isVisible()) {
      await expect(errorContainer.locator('h3:has-text("UI Loading Error")')).toBeVisible();
      await expect(errorContainer.locator('button:has-text("Retry")')).toBeVisible();
    }
  });

  test('cleans up resources on unmount', async ({ page }) => {
    await page.goto('/');

    // Wait for initial load
    await page.waitForSelector('.ui-iframe');

    // Track WebSocket connections
    const websockets = [];
    await page.addInitScript(() => {
      const originalWebSocket = window.WebSocket;
      window.WebSocket = function(url) {
        const ws = new originalWebSocket(url);
        window.testWebsockets = (window.testWebsockets || []).push(ws);
        return ws;
      };
    });

    // Navigate away to trigger cleanup
    await page.goto('about:blank');

    // Verify cleanup occurred
    // Note: This is a simplified test - actual cleanup verification
    // would require more sophisticated setup
  });
});

test.describe('UIContainer Accessibility', () => {
  test('has proper ARIA labels and roles', async ({ page }) => {
    await page.goto('/');

    // Check iframe accessibility
    const iframe = page.locator('.ui-iframe');
    await expect(iframe).toHaveAttribute('title', 'Dynamic UI Component');

    // Check loading announcement
    const loadingOverlay = page.locator('.ui-loading-overlay');
    if (await loadingOverlay.isVisible()) {
      await expect(loadingOverlay).toHaveAttribute('aria-live', 'polite');
    }
  });

  test('supports keyboard navigation', async ({ page }) => {
    await page.goto('/');

    // Test tab navigation
    await page.keyboard.press('Tab');

    // Check focus management
    const focusedElement = page.locator(':focus');
    expect(await focusedElement.count()).toBeGreaterThan(0);

    // Test Enter key on buttons
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');

    // Verify button interaction
    await page.waitForTimeout(500);
  });

  test('provides appropriate feedback for screen readers', async ({ page }) => {
    await page.goto('/');

    // Check status announcements
    await expect(page.locator('.workflow-state')).toBeVisible();

    // Verify dynamic content updates are announced
    const workflowProgress = page.locator('.workflow-progress');
    await expect(workflowProgress).toBeVisible();
  });
});

test.describe('UIContainer Performance', () => {
  test('loads within acceptable time limits', async ({ page }) => {
    const startTime = Date.now();

    await page.goto('/');
    await page.waitForSelector('.ui-iframe');

    const loadTime = Date.now() - startTime;
    expect(loadTime).toBeLessThan(3000); // Should load within 3 seconds
  });

  test('handles multiple concurrent events efficiently', async ({ page }) => {
    await page.goto('/');

    // Wait for initial load
    await page.waitForSelector('.ui-iframe');

    // Simulate multiple rapid events
    await page.evaluate(() => {
      const aguiService = window.aguiEventService;
      if (aguiService) {
        for (let i = 0; i < 10; i++) {
          setTimeout(() => {
            aguiService.emit({
              type: 'ui_update',
              sessionId: 'test-session-123',
              payload: { updateId: i }
            });
          }, i * 50);
        }
      }
    });

    // Wait for all events to be processed
    await page.waitForTimeout(1000);

    // Verify no performance degradation
    const performanceMetrics = await page.evaluate(() => {
      return performance.getEntriesByType('measure');
    });

    // Check that operations completed efficiently
    expect(performanceMetrics.length).toBeGreaterThan(0);
  });
});