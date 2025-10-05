/**
 * Backend Server Tests
 * Tests for the main GUI-LOP server functionality
 */

import request from 'supertest';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { v4 as uuidv4 } from 'uuid';

// Mock server for testing
function createTestServer() {
  const app = express();
  const server = createServer(app);

  app.use(cors());
  app.use(express.json());

  const workflows = new Map();

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      message: 'GUI-LOP Server is running'
    });
  });

  app.get('/api/workflows/templates', (req, res) => {
    res.json({
      templates: [
        {
          id: 'data-analysis',
          name: 'Data Analysis Workflow',
          description: 'Analyze data and generate insights with human approval',
          steps: ['Data Ingestion', 'Analysis', 'Insight Generation', 'Human Review', 'Final Report']
        },
        {
          id: 'decision-making',
          name: 'Decision Making Workflow',
          description: 'Generate options and collect human input for decisions',
          steps: ['Context Analysis', 'Option Generation', 'Human Selection', 'Reasoning', 'Confidence Assessment']
        },
        {
          id: 'content-creation',
          name: 'Content Creation Workflow',
          description: 'Create content with human feedback and iteration',
          steps: ['Content Planning', 'Draft Creation', 'Human Review', 'Revision', 'Final Output']
        }
      ]
    });
  });

  app.post('/api/workflows', (req, res) => {
    const { template, context } = req.body;

    if (!template) {
      return res.status(400).json({ error: 'Template is required' });
    }

    const validTemplates = ['data-analysis', 'decision-making', 'content-creation'];
    if (!validTemplates.includes(template)) {
      return res.status(400).json({ error: 'Invalid template' });
    }

    const workflowId = uuidv4();
    const workflow = {
      id: workflowId,
      workflow_id: workflowId,
      template,
      context: context || {},
      status: 'created',
      created_at: new Date().toISOString(),
      steps: []
    };

    workflows.set(workflowId, workflow);
    res.status(201).json(workflow);
  });

  app.get('/api/workflows/:workflowId', (req, res) => {
    const { workflowId } = req.params;
    const workflow = workflows.get(workflowId);

    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    res.json(workflow);
  });

  app.post('/api/workflows/:workflowId/execute', (req, res) => {
    const { workflowId } = req.params;
    const workflow = workflows.get(workflowId);

    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    workflow.status = 'executing';
    workflow.started_at = new Date().toISOString();

    res.json({
      message: 'Workflow execution started',
      workflow_id: workflowId,
      status: 'executing'
    });
  });

  app.post('/api/workflows/:workflowId/respond', (req, res) => {
    const { workflowId } = req.params;
    const { action, data } = req.body;

    const workflow = workflows.get(workflowId);

    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    if (workflow.status !== 'executing') {
      return res.status(400).json({ error: 'Workflow is not waiting for human input' });
    }

    workflow.status = 'completed';
    workflow.completed_at = new Date().toISOString();
    workflow.human_response = {
      action,
      data,
      responded_at: new Date().toISOString()
    };

    res.json({
      message: 'Human response received and workflow completed',
      workflow_id: workflowId,
      status: 'completed',
      results: {
        insights: data.insights || ['Default insight'],
        recommendations: data.recommendations || ['Default recommendation']
      }
    });
  });

  app.delete('/api/workflows/:workflowId', (req, res) => {
    const { workflowId } = req.params;
    const workflow = workflows.get(workflowId);

    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    workflows.delete(workflowId);
    res.json({ message: 'Workflow deleted successfully' });
  });

  return { app, server, workflows };
}

describe('GUI-LOP Server Tests', () => {
  let serverInstance;
  let app;
  let server;
  let workflows;

  beforeAll(async () => {
    const instance = createTestServer();
    app = instance.app;
    server = instance.server;
    workflows = instance.workflows;

    await new Promise((resolve) => {
      server.listen(0, () => {
        const port = server.address().port;
        serverInstance = request(app);
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => {
        server.close(resolve);
      });
    }
  });

  describe('Health Check Endpoint', () => {
    test('should return health status', async () => {
      const response = await serverInstance
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('message', 'GUI-LOP Server is running');
    });
  });

  describe('Workflow Templates Endpoint', () => {
    test('should return all workflow templates', async () => {
      const response = await serverInstance
        .get('/api/workflows/templates')
        .expect(200);

      expect(response.body).toHaveProperty('templates');
      expect(response.body.templates).toHaveLength(3);

      const templateIds = response.body.templates.map(t => t.id);
      expect(templateIds).toContain('data-analysis');
      expect(templateIds).toContain('decision-making');
      expect(templateIds).toContain('content-creation');
    });
  });

  describe('Workflow Creation Endpoint', () => {
    test('should create a new workflow', async () => {
      const workflowData = {
        template: 'data-analysis',
        context: { task: 'Test analysis' }
      };

      const response = await serverInstance
        .post('/api/workflows')
        .send(workflowData)
        .expect(201);

      expect(response.body).toHaveProperty('workflow_id');
      expect(response.body).toHaveProperty('template', 'data-analysis');
      expect(response.body).toHaveProperty('status', 'created');
      expect(response.body).toHaveProperty('created_at');
      expect(workflows.has(response.body.workflow_id)).toBe(true);
    });

    test('should reject workflow creation without template', async () => {
      const response = await serverInstance
        .post('/api/workflows')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Template is required');
    });
  });

  describe('Complete Workflow Lifecycle', () => {
    test('should complete full workflow from creation to completion', async () => {
      // 1. Create workflow
      const createResponse = await serverInstance
        .post('/api/workflows')
        .send({
          template: 'data-analysis',
          context: { task: 'Complete workflow test' }
        })
        .expect(201);

      const workflowId = createResponse.body.workflow_id;
      expect(createResponse.body.status).toBe('created');

      // 2. Execute workflow
      const executeResponse = await serverInstance
        .post(`/api/workflows/${workflowId}/execute`)
        .expect(200);

      expect(executeResponse.body.status).toBe('executing');

      // 3. Respond to workflow
      const respondResponse = await serverInstance
        .post(`/api/workflows/${workflowId}/respond`)
        .send({
          action: 'approve',
          data: {
            insights: ['Data patterns identified'],
            recommendations: ['Proceed with implementation']
          }
        })
        .expect(200);

      expect(respondResponse.body.status).toBe('completed');

      // 4. Final verification
      const finalResponse = await serverInstance
        .get(`/api/workflows/${workflowId}`)
        .expect(200);

      expect(finalResponse.body.status).toBe('completed');
      expect(finalResponse.body).toHaveProperty('completed_at');
      expect(finalResponse.body).toHaveProperty('human_response');
    });
  });
});
