/**
 * Full Workflow Integration Tests
 * Tests complete end-to-end workflows including frontend-backend integration
 */

import request from 'supertest';

describe('Full Workflow Integration Tests', () => {
  let serverUrl = 'http://localhost:3001';
  let createdWorkflows = [];

  // Helper function to create and execute workflow
  async function createAndExecuteWorkflow(template, context = {}) {
    // Create workflow
    const createResponse = await request(serverUrl)
      .post('/api/workflows')
      .send({ template, context })
      .expect(201);

    const workflowId = createResponse.body.workflow_id;
    createdWorkflows.push(workflowId);

    // Execute workflow
    await request(serverUrl)
      .post(`/api/workflows/${workflowId}/execute`)
      .expect(200);

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

      // Check workflow is executing
      const statusResponse = await request(serverUrl)
        .get(`/api/workflows/${workflowId}`)
        .expect(200);

      expect(statusResponse.body.status).toBe('executing');
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
      expect(response.body.results.insights).toEqual(humanResponse.data.insights);
      expect(response.body.results.recommendations).toEqual(humanResponse.data.recommendations);
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

      expect(statusResponse.body.status).toBe('executing');

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
      expect(response.body.results).toBeDefined();
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

      expect(statusResponse.body.status).toBe('executing');

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
      expect(response.body.results).toBeDefined();
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

    test('should handle invalid template during creation', async () => {
      const response = await request(serverUrl)
        .post('/api/workflows')
        .send({ template: 'invalid-template' })
        .expect(400);

      expect(response.body.error).toBe('Invalid template');
    });
  });

  describe('Performance and Load Testing', () => {
    test('should handle rapid workflow creation', async () => {
      const startTime = Date.now();
      const workflowIds = [];

      // Create 5 workflows rapidly
      for (let i = 0; i < 5; i++) {
        const response = await request(serverUrl)
          .post('/api/workflows')
          .send({
            template: 'data-analysis',
            context: { task: `Performance test ${i}` }
          })
          .expect(201);

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
