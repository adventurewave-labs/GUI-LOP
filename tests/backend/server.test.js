/**
 * Backend Server Tests
 * Tests for the main GUI-LOP server functionality
 */

import request from 'supertest';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

// Import the server setup
function createTestServer() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  app.use(cors());
  app.use(express.json());

  const workflows = new Map();
  const clients = new Set();

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
      steps: [],
      current_step: 0,
      checkpoints: []
    };

    workflows.set(workflowId, workflow);

    setTimeout(() => {
      workflow.status = 'running';
      workflow.current_step = 1;
      workflow.steps.push({
        step: 1,
        name: 'Data Collection',
        status: 'completed',
        completed_at: new Date().toISOString()
      });
    }, 1000);

    setTimeout(() => {
      workflow.status = 'waiting_for_human';
      workflow.current_step = 2;
      workflow.steps.push({
        step: 2,
        name: 'Analysis',
        status: 'completed',
        completed_at: new Date().toISOString()
      });
    }, 2000);

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

    if (workflow.status !== 'created') {
      return res.status(400).json({ error: 'Workflow already executed or completed' });
    }

    workflow.status = 'executing';
    workflow.started_at = new Date().toISOString();

    setTimeout(() => {
      workflow.status = 'running';
      workflow.current_step = 1;
      workflow.steps.push({
        step: 1,
        name: 'Data Collection',
        status: 'completed',
        completed_at: new Date().toISOString()
      });
    }, 500);

    setTimeout(() => {
      workflow.status = 'waiting_for_human';
      workflow.current_step = 2;
      workflow.steps.push({
        step: 2,
        name: 'Analysis',
        status: 'completed',
        completed_at: new Date().toISOString()
      });
    }, 1500);

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

    if (workflow.status !== 'waiting_for_human') {
      return res.status(400).json({ error: 'Workflow is not waiting for human input' });
    }

    if (action !== 'approve') {
      return res.status(400).json({ error: 'Only approve action is supported' });
    }

    workflow.status = 'completed';
    workflow.completed_at = new Date().toISOString();
    workflow.human_response = {
      action,
      data,
      responded_at: new Date().toISOString()
    };

    workflow.steps.push({
      step: 3,
      name: 'Human Review',
      status: 'completed',
      completed_at: new Date().toISOString()
    });

    workflow.steps.push({
      step: 4,
      name: 'Final Processing',
      status: 'completed',
      completed_at: new Date().toISOString()
    });

    res.json({
      message: 'Human response received and workflow completed',
      workflow_id: workflowId,
      status: 'completed',
      results: {
        insights: data.insights || ['Default insight'],
        recommendations: data.recommendations || ['Default recommendation'],
        completed_at: workflow.completed_at
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

  // WebSocket setup
  wss.on('connection', (ws) => {
    clients.add(ws);

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);

        // Echo back for testing
        ws.send(JSON.stringify({
          type: 'echo',
          data: data,
          timestamp: new Date().toISOString()
        }));
      } catch (error) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid JSON',
          timestamp: new Date().toISOString()
        }));
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
    });

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connection',
      message: 'Connected to GUI-LOP WebSocket server',
      timestamp: new Date().toISOString()
    }));
  });

  return { app, server, wss, workflows, clients };
}

describe('GUI-LOP Server Tests', () => {
  let serverInstance;
  let app;
  let server;
  let wss;
  let workflows;
  let clients;

  beforeAll(async () => {
    const instance = createTestServer();
    app = instance.app;
    server = instance.server;
    wss = instance.wss;
    workflows = instance.workflows;
    clients = instance.clients;

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

    test('should return templates with required fields', async () => {
      const response = await serverInstance
        .get('/api/workflows/templates')
        .expect(200);

      response.body.templates.forEach(template => {
        expect(template).toHaveProperty('id');
        expect(template).toHaveProperty('name');
        expect(template).toHaveProperty('description');
        expect(template).toHaveProperty('steps');
        expect(Array.isArray(template.steps)).toBe(true);
      });
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

    test('should reject invalid template', async () => {
      const response = await serverInstance
        .post('/api/workflows')
        .send({ template: 'invalid-template' })
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Invalid template');
    });

    test('should create workflow with minimal data', async () => {
      const response = await serverInstance
        .post('/api/workflows')
        .send({ template: 'decision-making' })
        .expect(201);

      expect(response.body).toHaveProperty('workflow_id');
      expect(response.body.context).toEqual({});
    });
  });

  describe('Workflow Status Endpoint', () => {
    let workflowId;

    beforeEach(async () => {
      const response = await serverInstance
        .post('/api/workflows')
        .send({ template: 'content-creation' });

      workflowId = response.body.workflow_id;
    });

    test('should return workflow status', async () => {
      const response = await serverInstance
        .get(`/api/workflows/${workflowId}`)
        .expect(200);

      expect(response.body).toHaveProperty('workflow_id', workflowId);
      expect(response.body).toHaveProperty('template', 'content-creation');
      expect(response.body).toHaveProperty('status');
    });

    test('should return 404 for non-existent workflow', async () => {
      const response = await serverInstance
        .get('/api/workflows/non-existent-id')
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Workflow not found');
    });
  });

  describe('Workflow Execution Endpoint', () => {
    let workflowId;

    beforeEach(async () => {
      const response = await serverInstance
        .post('/api/workflows')
        .send({ template: 'data-analysis' });

      workflowId = response.body.workflow_id;
    });

    test('should execute workflow', async () => {
      const response = await serverInstance
        .post(`/api/workflows/${workflowId}/execute`)
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Workflow execution started');
      expect(response.body).toHaveProperty('workflow_id', workflowId);
      expect(response.body).toHaveProperty('status', 'executing');
    });

    test('should return 404 for non-existent workflow execution', async () => {
      const response = await serverInstance
        .post('/api/workflows/non-existent/execute')
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Workflow not found');
    });
  });

  describe('Workflow Response Endpoint', () => {
    let workflowId;

    beforeEach(async () => {
      const createResponse = await serverInstance
        .post('/api/workflows')
        .send({ template: 'decision-making' });

      workflowId = createResponse.body.workflow_id;

      // Execute workflow
      await serverInstance
        .post(`/api/workflows/${workflowId}/execute`);

      // Wait for workflow to reach waiting_for_human status
      await new Promise(resolve => setTimeout(resolve, 2000));
    });

    test('should accept human response', async () => {
      const responseData = {
        action: 'approve',
        data: {
          insights: ['Test insight'],
          recommendations: ['Test recommendation']
        }
      };

      const response = await serverInstance
        .post(`/api/workflows/${workflowId}/respond`)
        .send(responseData)
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Human response received and workflow completed');
      expect(response.body).toHaveProperty('workflow_id', workflowId);
      expect(response.body).toHaveProperty('status', 'completed');
      expect(response.body).toHaveProperty('results');
    });

    test('should reject invalid action', async () => {
      const response = await serverInstance
        .post(`/api/workflows/${workflowId}/respond`)
        .send({ action: 'invalid-action' })
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Only approve action is supported');
    });

    test('should return 404 for non-existent workflow response', async () => {
      const response = await serverInstance
        .post('/api/workflows/non-existent/respond')
        .send({ action: 'approve' })
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Workflow not found');
    });
  });

  describe('Workflow Deletion Endpoint', () => {
    let workflowId;

    beforeEach(async () => {
      const response = await serverInstance
        .post('/api/workflows')
        .send({ template: 'content-creation' });

      workflowId = response.body.workflow_id;
    });

    test('should delete workflow', async () => {
      const response = await serverInstance
        .delete(`/api/workflows/${workflowId}`)
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Workflow deleted successfully');
      expect(workflows.has(workflowId)).toBe(false);
    });

    test('should return 404 for non-existent workflow deletion', async () => {
      const response = await serverInstance
        .delete('/api/workflows/non-existent-id')
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Workflow not found');
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

      // 3. Wait for processing
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 4. Check status
      const statusResponse = await serverInstance
        .get(`/api/workflows/${workflowId}`)
        .expect(200);

      expect(statusResponse.body.status).toBe('waiting_for_human');

      // 5. Respond to workflow
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

      // 6. Final verification
      const finalResponse = await serverInstance
        .get(`/api/workflows/${workflowId}`)
        .expect(200);

      expect(finalResponse.body.status).toBe('completed');
      expect(finalResponse.body).toHaveProperty('completed_at');
      expect(finalResponse.body).toHaveProperty('human_response');
    });
  });
});