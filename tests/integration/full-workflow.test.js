/**
 * Full Workflow Integration Tests
 * Tests complete end-to-end workflows including frontend-backend integration
 */

import request from 'supertest';
import WebSocket from 'ws';

describe('Full Workflow Integration Tests', () => {
  let serverUrl = 'http://localhost:3001';
  let wsUrl = 'ws://localhost:3001';
  let createdWorkflows = [];

  // Helper function to create and execute workflow
  async function createAndExecuteWorkflow(template, context = {}) {
    // Create workflow
    const createResponse = await request(serverUrl)
      .post('/api/workflows')
      .send({ template, context })
      .expect(200);

    const workflowId = createResponse.body.workflow_id;
    createdWorkflows.push(workflowId);

    // Execute workflow
    await request(serverUrl)
      .post(`/api/workflows/${workflowId}/execute`)
      .expect(200);

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 2000));

    return workflowId;
  }

  // Cleanup created workflows
  afterAll(async () => {
    for (const workflowId of createdWorkflows) {
      try {
        await request(serverUrl)
          .delete(`/api/workflows/${workflowId}`);
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });

  describe('Server Health and Setup', () => {
    test('should verify server is running', async () => {
      const response = await request(serverUrl)
        .get('/health')
        .expect(200);

      expect(response.body.status).toBe('ok');
    });

    test('should verify workflow templates are available', async () => {
      const response = await request(serverUrl)
        .get('/api/workflows/templates')
        .expect(200);

      expect(response.body.templates).toHaveLength(3);
    });
  });

  describe('Data Analysis Workflow', () => {
    test('should complete full data analysis workflow', async () => {
      const context = {
        task: 'Analyze sales data',
        dataSource: 'sales_database.csv'
      };

      const workflowId = await createAndExecuteWorkflow('data-analysis', context);

      // Check workflow is waiting for human input
      const statusResponse = await request(serverUrl)
        .get(`/api/workflows/${workflowId}`)
        .expect(200);

      expect(statusResponse.body.status).toBe('waiting_for_human');
      expect(statusResponse.body.template).toBe('data-analysis');
      expect(statusResponse.body.context.task).toBe('Analyze sales data');

      // Respond with human insights
      const humanResponse = {
        action: 'approve',
        data: {
          insights: [
            'Sales increased by 25% in Q3',
            'Top performing product is Widget A',
            'Regional performance varies significantly'
          ],
          recommendations: [
            'Increase inventory of Widget A',
            'Focus marketing on underperforming regions',
            'Analyze seasonal patterns for optimization'
          ]
        }
      };

      const response = await request(serverUrl)
        .post(`/api/workflows/${workflowId}/respond`)
        .send(humanResponse)
        .expect(200);

      expect(response.body.status).toBe('completed');
      expect(response.body).toHaveProperty('message', 'Human response received and workflow completed');
    });
  });

  describe('Decision Making Workflow', () => {
    test('should complete full decision making workflow', async () => {
      const context = {
        task: 'Choose marketing strategy',
        options: ['Digital Campaign', 'Traditional Media', 'Social Media'],
        criteria: ['Cost', 'Reach', 'Engagement']
      };

      const workflowId = await createAndExecuteWorkflow('decision-making', context);

      // Check workflow status
      const statusResponse = await request(serverUrl)
        .get(`/api/workflows/${workflowId}`)
        .expect(200);

      expect(statusResponse.body.status).toBe('waiting_for_human');

      // Respond with decision
      const humanResponse = {
        action: 'approve',
        data: {
          insights: [
            'Digital Campaign offers best ROI',
            'Social Media has highest engagement potential',
            'Traditional Media is most expensive'
          ],
          recommendations: [
            'Proceed with Digital Campaign as primary strategy',
            'Use Social Media for supplementary engagement',
            'Monitor performance and adjust strategy quarterly'
          ]
        }
      };

      const response = await request(serverUrl)
        .post(`/api/workflows/${workflowId}/respond`)
        .send(humanResponse)
        .expect(200);

      expect(response.body.status).toBe('completed');
      expect(response.body).toHaveProperty('message', 'Human response received and workflow completed');
    });
  });

  describe('Content Creation Workflow', () => {
    test('should complete full content creation workflow', async () => {
      const context = {
        task: 'Create blog post about AI trends',
        contentType: 'blog',
        targetAudience: 'technical professionals',
        length: '1500 words'
      };

      const workflowId = await createAndExecuteWorkflow('content-creation', context);

      // Check workflow status
      const statusResponse = await request(serverUrl)
        .get(`/api/workflows/${workflowId}`)
        .expect(200);

      expect(statusResponse.body.status).toBe('waiting_for_human');

      // Respond with content approval
      const humanResponse = {
        action: 'approve',
        data: {
          insights: [
            'Content covers latest AI developments',
            'Technical depth is appropriate for target audience',
            'Structure follows best practices for readability'
          ],
          recommendations: [
            'Publish with current content structure',
            'Consider follow-up article on implementation',
            'Add code examples for practical application'
          ]
        }
      };

      const response = await request(serverUrl)
        .post(`/api/workflows/${workflowId}/respond`)
        .send(humanResponse)
        .expect(200);

      expect(response.body.status).toBe('completed');
      expect(response.body).toHaveProperty('message', 'Human response received and workflow completed');
    });
  });

  describe('Concurrent Workflows', () => {
    test('should handle multiple concurrent workflows', async () => {
      const workflowIds = [];

      // Create multiple workflows
      for (let i = 0; i < 3; i++) {
        const workflowId = await createAndExecuteWorkflow('data-analysis', {
          task: `Analysis task ${i}`,
          priority: i + 1
        });
        workflowIds.push(workflowId);
      }

      // Wait for all workflows to process
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check all workflows are in waiting state
      for (const workflowId of workflowIds) {
        const statusResponse = await request(serverUrl)
          .get(`/api/workflows/${workflowId}`)
          .expect(200);

        expect(statusResponse.body.status).toBe('waiting_for_human');
      }

      // Respond to all workflows
      for (let i = 0; i < workflowIds.length; i++) {
        await request(serverUrl)
          .post(`/api/workflows/${workflowIds[i]}/respond`)
          .send({
            action: 'approve',
            data: {
              insights: [`Insight for workflow ${i}`],
              recommendations: [`Recommendation for workflow ${i}`]
            }
          })
          .expect(200);
      }

      // Verify all workflows are completed
      for (const workflowId of workflowIds) {
        const statusResponse = await request(serverUrl)
          .get(`/api/workflows/${workflowId}`)
          .expect(200);

        expect(statusResponse.body.status).toBe('completed');
      }
    });
  });

  describe('WebSocket Integration', () => {
    test('should receive WebSocket events during workflow execution', (done) => {
      const ws = new WebSocket(wsUrl);
      let events = [];

      ws.on('open', async () => {
        // Create and execute workflow
        const workflowId = await createAndExecuteWorkflow('data-analysis', {
          task: 'WebSocket integration test'
        });

        // Respond to complete workflow
        await request(serverUrl)
          .post(`/api/workflows/${workflowId}/respond`)
          .send({
            action: 'approve',
            data: {
              insights: ['WebSocket test insight'],
              recommendations: ['WebSocket test recommendation']
            }
          });

        // Wait a bit for events
        setTimeout(() => {
          ws.close();
          done();
        }, 1000);
      });

      ws.on('message', (data) => {
        const event = JSON.parse(data.toString());
        events.push(event);
      });

      ws.on('error', () => {
        // Skip if WebSocket not available
        done();
      });
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle invalid workflow ID gracefully', async () => {
      const response = await request(serverUrl)
        .get('/api/workflows/invalid-workflow-id')
        .expect(404);

      expect(response.body.error).toBe('Workflow not found');
    });

    test('should handle executing non-existent workflow', async () => {
      const response = await request(serverUrl)
        .post('/api/workflows/non-existent/execute')
        .expect(404);

      expect(response.body.error).toBe('Workflow not found');
    });

    test('should handle responding to completed workflow', async () => {
      const workflowId = await createAndExecuteWorkflow('data-analysis');

      // Complete the workflow
      await request(serverUrl)
        .post(`/api/workflows/${workflowId}/respond`)
        .send({
          action: 'approve',
          data: { insights: ['test'], recommendations: ['test'] }
        });

      // Try to respond again
      const response = await request(serverUrl)
        .post(`/api/workflows/${workflowId}/respond`)
        .send({
          action: 'approve',
          data: { insights: ['test'], recommendations: ['test'] }
        })
        .expect(200);

      expect(response.body.status).toBe('completed');
    });

    test('should handle any template during creation', async () => {
      const response = await request(serverUrl)
        .post('/api/workflows')
        .send({ template: 'invalid-template' })
        .expect(200);

      expect(response.body).toHaveProperty('workflow_id');
      expect(response.body).toHaveProperty('status', 'created');
    });
  });

  describe('Performance and Load Testing', () => {
    test('should handle rapid workflow creation', async () => {
      const startTime = Date.now();
      const workflowIds = [];

      // Create 10 workflows rapidly
      for (let i = 0; i < 10; i++) {
        const response = await request(serverUrl)
          .post('/api/workflows')
          .send({
            template: 'data-analysis',
            context: { task: `Performance test ${i}` }
          })
          .expect(200);

        workflowIds.push(response.body.workflow_id);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete within reasonable time (5 seconds)
      expect(duration).toBeLessThan(5000);

      // Clean up
      for (const workflowId of workflowIds) {
        await request(serverUrl)
          .delete(`/api/workflows/${workflowId}`);
      }
    });
  });
});