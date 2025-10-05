const { test, expect } = require('@playwright/test');

test.describe('GUI-LOP Frontend Integration Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Mock backend API responses
    await page.route('**/api/health', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', version: '1.0.0' })
      });
    });

    await page.route('**/api/sessions', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'integration-test-session',
          type: 'gui-lop',
          capabilities: ['streamlit', 'gradio', 'hitl'],
          createdAt: new Date().toISOString()
        })
      });
    });

    await page.route('**/api/sessions/*/workflows', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'test-workflow',
          status: 'running',
          steps: [
            { id: 'step1', name: 'Load Data', status: 'pending' },
            { id: 'step2', name: 'Analyze Data', status: 'pending' },
            { id: 'step3', name: 'Generate Insights', status: 'pending' }
          ],
          currentStep: 'step1'
        })
      });
    });

    // Mock WebSocket
    await page.addInitScript(() => {
      window.WebSocket = class MockWebSocket {
        constructor(url) {
          this.url = url;
          this.readyState = WebSocket.CONNECTING;

          // Simulate connection
          setTimeout(() => {
            this.readyState = WebSocket.OPEN;
            this.onopen?.();

            // Send initial state
            setTimeout(() => {
              this.onmessage?.({
                data: JSON.stringify({
                  type: 'workflow_state',
                  sessionId: 'integration-test-session',
                  payload: {
                    state: 'running',
                    step: 'step1',
                    metadata: { totalSteps: 3 }
                  }
                })
              });
            }, 100);
          }, 50);
        }

        send(data) {
          console.log('WebSocket send:', data);
          // Echo back the message for testing
          setTimeout(() => {
            this.onmessage?.({ data });
          }, 10);
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

      // Initialize mock services
      window.aguiEventService = {
        eventHistory: [],
        emit: function(event) {
          this.eventHistory.push(event);
          console.log('AGUI Event emitted:', event);

          // Notify any listeners
          if (this.listeners) {
            this.listeners.forEach(listener => {
              try {
                listener(event);
              } catch (error) {
                console.error('Event listener error:', error);
              }
            });
          }
        },
        registerEventHandler: function(eventType, handler) {
          if (!this.listeners) this.listeners = [];
          this.listeners.push(handler);
        }
      };
    });
  });

  test('full application initialization workflow', async ({ page }) => {
    // Navigate to application
    await page.goto('/');

    // Wait for loading state
    await expect(page.locator('.app-loading')).toBeVisible();
    await expect(page.locator('h2:has-text("Initializing GUI-LOP")')).toBeVisible();

    // Wait for successful initialization
    await expect(page.locator('.app')).toBeVisible();
    await expect(page.locator('.app-header')).toBeVisible();

    // Verify main components are present
    await expect(page.locator('.workflow-progress')).toBeVisible();
    await expect(page.locator('.ui-iframe')).toBeVisible();
    await expect(page.locator('.start-workflow-btn')).toBeVisible();

    // Check session initialization
    const sessionId = await page.evaluate(() => {
      return window.sessionId || 'unknown';
    });
    expect(sessionId).not.toBe('unknown');
  });

  test('complete HITL workflow simulation', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app');

    // Start workflow
    await page.click('.start-workflow-btn');

    // Wait for workflow to start
    await page.waitForTimeout(1000);

    // Verify workflow state changes
    const stateElement = page.locator('.workflow-state');
    await expect(stateElement).toBeVisible();

    // Simulate tool input request
    await page.evaluate(() => {
      const toolInputEvent = {
        type: 'tool_input_request',
        sessionId: 'integration-test-session',
        payload: {
          toolId: 'data-loader',
          inputSchema: {
            type: 'object',
            properties: {
              dataSource: { type: 'string' },
              format: { type: 'string' }
            }
          },
          requestId: 'req-123'
        }
      };

      window.aguiEventService.emit(toolInputEvent);
    });

    // Wait for event handling
    await page.waitForTimeout(500);

    // Simulate approval request
    await page.evaluate(() => {
      const approvalEvent = {
        type: 'approval_request',
        sessionId: 'integration-test-session',
        payload: {
          message: 'Please confirm the data analysis parameters',
          options: {
            timeout: 30000,
            requireReason: false
          },
          requestId: 'req-456'
        }
      };

      window.aguiEventService.emit(approvalEvent);
    });

    // Wait for approval handling
    await page.waitForTimeout(500);

    // Check debug overlay for pending requests (in development)
    const debugButton = page.locator('button[style*="background: #007bff"]');
    if (await debugButton.isVisible()) {
      await debugButton.click();

      // Verify debug overlay shows requests
      await expect(page.locator('.debug-overlay')).toBeVisible();
      await expect(page.locator('h4:has-text("Pending Approvals")')).toBeVisible();

      // Close debug overlay
      await page.click('button:has-text("×")');
    }

    // Complete the workflow
    await page.evaluate(() => {
      const completeEvent = {
        type: 'workflow_state',
        sessionId: 'integration-test-session',
        payload: {
          state: 'completed',
          step: null,
          metadata: {
            completedSteps: 3,
            totalSteps: 3,
            results: { success: true }
          }
        }
      };

      window.aguiEventService.emit(completeEvent);
    });

    // Verify completion
    await page.waitForTimeout(500);
    const completionState = await stateElement.textContent();
    expect(completionState || '').toContain('COMPLETED');
  });

  test('UI generation and display workflow', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app');

    // Mock UI generation endpoint
    await page.route('**/api/sessions/*/generate-ui', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          uiId: 'generated-ui-123',
          type: 'dashboard',
          url: '/streamlit/integration-test-session/dashboard',
          config: {
            title: 'Data Analysis Dashboard',
            components: ['chart', 'table', 'filters']
          }
        })
      });
    });

    // Trigger UI generation
    await page.evaluate(() => {
      const uiRequestEvent = {
        type: 'ui_update',
        sessionId: 'integration-test-session',
        payload: {
          generateUI: true,
          uiConfig: {
            type: 'dashboard',
            title: 'Test Dashboard'
          }
        }
      };

      window.aguiEventService.emit(uiRequestEvent);
    });

    // Wait for UI to load
    await page.waitForTimeout(1000);

    // Verify iframe updated
    const iframe = page.locator('.ui-iframe');
    await expect(iframe).toBeVisible();

    const iframeSrc = await iframe.getAttribute('src');
    expect(iframeSrc).toContain('integration-test-session');
  });

  test('error handling and recovery', async ({ page }) => {
    // Mock network error
    await page.route('**/api/health', (route) => {
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Service unavailable' })
      });
    });

    await page.goto('/');

    // Verify error state
    await expect(page.locator('.app-error')).toBeVisible();
    await expect(page.locator('h2:has-text("GUI-LOP Error")')).toBeVisible();

    // Test recovery
    await page.unroute('**/api/health');
    await page.route('**/api/health', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok' })
      });
    });

    // Click reset button
    await page.click('button:has-text("Reset Application")');

    // Verify recovery
    await expect(page.locator('.app')).toBeVisible();
    await expect(page.locator('.app-header')).toBeVisible();
  });

  test('WebSocket connection and event handling', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app');

    // Track WebSocket events
    const wsEvents = [];
    await page.addInitScript(() => {
      window.testWSEvents = [];

      // Monitor WebSocket messages
      const originalSend = window.WebSocket.prototype.send;
      window.WebSocket.prototype.send = function(data) {
        window.testWSEvents.push({ type: 'sent', data });
        return originalSend.call(this, data);
      };

      const originalOnMessage = window.WebSocket.prototype.onmessage;
      Object.defineProperty(window.WebSocket.prototype, 'onmessage', {
        set: function(value) {
          const handler = (event) => {
            window.testWSEvents.push({ type: 'received', data: event.data });
            value(event);
          };
          originalOnMessage.call(this, handler);
        },
        get: function() {
          return originalOnMessage;
        }
      });
    });

    // Wait for WebSocket to connect
    await page.waitForTimeout(500);

    // Send test event via WebSocket
    await page.evaluate(() => {
      const ws = new WebSocket('ws://localhost:3001/ws/integration-test-session');
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: 'test_event',
          sessionId: 'integration-test-session',
          payload: { message: 'Hello from test' }
        }));
      }, 100);
    });

    // Verify WebSocket activity
    await page.waitForTimeout(500);
    const events = await page.evaluate(() => window.testWSEvents || []);
    expect(events.length).toBeGreaterThan(0);
  });

  test('responsive design and mobile compatibility', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app');

    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Verify responsive elements
    await expect(page.locator('.app-header')).toBeVisible();
    await expect(page.locator('.workflow-progress')).toBeVisible();

    // Check header layout adapts
    const headerContent = page.locator('.header-content');
    await expect(headerContent).toBeVisible();

    // Test tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(page.locator('.app')).toBeVisible();

    // Test desktop viewport
    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect(page.locator('.app')).toBeVisible();
  });

  test('accessibility compliance', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app');

    // Test keyboard navigation
    await page.keyboard.press('Tab');
    const focusedElement = page.locator(':focus');
    expect(await focusedElement.count()).toBeGreaterThan(0);

    // Test ARIA labels
    await expect(page.locator('.ui-iframe')).toHaveAttribute('title');

    // Test semantic HTML
    await expect(page.locator('header')).toBeVisible();
    await expect(page.locator('main')).toBeVisible();

    // Test color contrast (basic check)
    const headerText = page.locator('.app-header h1');
    await expect(headerText).toBeVisible();

    // Test screen reader compatibility
    const loadingOverlay = page.locator('.ui-loading-overlay');
    if (await loadingOverlay.isVisible()) {
      await expect(loadingOverlay).toHaveAttribute('aria-live');
    }
  });

  test('performance and optimization', async ({ page }) => {
    const startTime = Date.now();

    await page.goto('/');
    await page.waitForSelector('.app');

    const loadTime = Date.now() - startTime;
    expect(loadTime).toBeLessThan(5000); // Should load within 5 seconds

    // Test memory usage
    const memoryUsage = await page.evaluate(() => {
      return performance.memory ? {
        used: performance.memory.usedJSHeapSize,
        total: performance.memory.totalJSHeapSize,
        limit: performance.memory.jsHeapSizeLimit
      } : null;
    });

    if (memoryUsage) {
      expect(memoryUsage.used).toBeGreaterThan(0);
      expect(memoryUsage.used).toBeLessThan(memoryUsage.limit);
    }

    // Test render performance during workflow
    await page.click('.start-workflow-btn');

    const renderStart = Date.now();
    await page.waitForSelector('.workflow-state');
    const renderTime = Date.now() - renderStart;

    expect(renderTime).toBeLessThan(1000); // Should render within 1 second
  });

  test('data persistence and session management', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app');

    // Get session information
    const sessionInfo = await page.evaluate(() => {
      return {
        sessionId: window.sessionId,
        isInitialized: window.isInitialized,
        eventHistoryLength: window.aguiEventService?.eventHistory?.length || 0
      };
    });

    expect(sessionInfo.sessionId).toBeTruthy();
    expect(sessionInfo.isInitialized).toBe(true);

    // Start workflow to generate data
    await page.click('.start-workflow-btn');
    await page.waitForTimeout(1000);

    // Check data accumulation
    const updatedInfo = await page.evaluate(() => {
      return {
        eventHistoryLength: window.aguiEventService?.eventHistory?.length || 0,
        workflowState: window.workflowState
      };
    });

    expect(updatedInfo.eventHistoryLength).toBeGreaterThan(sessionInfo.eventHistoryLength);
    expect(updatedInfo.workflowState).toBeTruthy();
  });
});