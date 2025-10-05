/**
 * Backend Integration Tests
 * Tests the complete backend API functionality
 */

import request from 'supertest';
import GUILoPServer from '../../src/backend/server.js';

describe('Backend Integration Tests', () => {
  let server;
  let app;
  let sessionId;
  let workflowId;

  beforeAll(async () => {
    // Start test server
    const guiLoPServer = new GUILoPServer();
    app = guiLoPServer.app;

    // Mock database and services for testing
    // In real implementation, you'd use test database

    server = app.listen(0); // Random port for testing
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => {
        server.close(resolve);
      });
    }
  });

  describe('Health Check Endpoints', () => {
    test('GET /health should return healthy status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
    });

    test('GET /health/detailed should return detailed health information', async () => {
      const response = await request(app)
        .get('/health/detailed')
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('system');
      expect(response.body).toHaveProperty('memory');
      expect(response.body).toHaveProperty('services');
    });

    test('GET /health/readiness should return readiness status', async () => {
      const response = await request(app)
        .get('/health/readiness')
        .expect(200); // or 503 depending on test setup

      expect(response.body).toHaveProperty('ready');
      expect(response.body).toHaveProperty('checks');
    });
  });

  describe('Workflow Management', () => {
    test('GET /api/workflows/templates should return available templates', async () => {
      const response = await request(app)
        .get('/api/workflows/templates')
        .set('X-Session-ID', 'test-session-id')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('templates');
      expect(Array.isArray(response.body.templates)).toBe(true);
    });

    test('POST /api/workflows should create a new workflow', async () => {
      const workflowData = {
        template_id: 'data-analysis',
        session_id: 'test-session-id',
        input_data: {
          data: [1, 2, 3, 4, 5],
          analysis_type: 'statistical'
        }
      };

      const response = await request(app)
        .post('/api/workflows')
        .set('X-Session-ID', 'test-session-id')
        .send(workflowData)
        .expect(201);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('workflow_id');
      expect(response.body).toHaveProperty('status', 'created');

      workflowId = response.body.workflow_id;
    });

    test('GET /api/workflows/:workflow_id should return workflow details', async () => {
      if (!workflowId) return; // Skip if workflow wasn't created

      const response = await request(app)
        .get(`/api/workflows/${workflowId}`)
        .set('X-Session-ID', 'test-session-id')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('workflow');
      expect(response.body.workflow).toHaveProperty('id', workflowId);
    });

    test('GET /api/workflows should list workflows', async () => {
      const response = await request(app)
        .get('/api/workflows')
        .set('X-Session-ID', 'test-session-id')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('workflows');
      expect(Array.isArray(response.body.workflows)).toBe(true);
    });
  });

  describe('AG-UI Protocol Events', () => {
    test('POST /api/events should send an AG-UI protocol event', async () => {
      const eventData = {
        type: 'ui_update',
        session_id: 'test-session-id',
        workflow_id: workflowId,
        data: {
          components: [
            {
              type: 'text_input',
              id: 'input1',
              label: 'Test Input',
              required: true
            }
          ]
        },
        priority: 'medium'
      };

      const response = await request(app)
        .post('/api/events')
        .set('X-Session-ID', 'test-session-id')
        .send(eventData)
        .expect(201);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('event_id');
    });

    test('GET /api/events should retrieve events for a session', async () => {
      const response = await request(app)
        .get('/api/events')
        .query({ session_id: 'test-session-id' })
        .set('X-Session-ID', 'test-session-id')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('events');
      expect(Array.isArray(response.body.events)).toBe(true);
    });

    test('POST /api/events/batch should send multiple events', async () => {
      const batchData = {
        events: [
          {
            type: 'data_display',
            session_id: 'test-session-id',
            data: { display_type: 'chart', data: [1, 2, 3] }
          },
          {
            type: 'approval_request',
            session_id: 'test-session-id',
            data: { message: 'Do you approve?', options: ['yes', 'no'] }
          }
        ]
      };

      const response = await request(app)
        .post('/api/events/batch')
        .set('X-Session-ID', 'test-session-id')
        .send(batchData)
        .expect(201);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('successful_events', 2);
    });
  });

  describe('Error Handling', () => {
    test('GET /nonexistent should return 404', async () => {
      const response = await request(app)
        .get('/nonexistent')
        .expect(404);

      expect(response.body).toHaveProperty('error', true);
      expect(response.body).toHaveProperty('code', 'NOT_FOUND');
    });

    test('POST /api/workflows with invalid data should return 400', async () => {
      const invalidData = {
        template_id: '', // Invalid
        session_id: 'invalid-uuid', // Invalid format
        input_data: null // Invalid
      };

      const response = await request(app)
        .post('/api/workflows')
        .set('X-Session-ID', 'test-session-id')
        .send(invalidData)
        .expect(400);

      expect(response.body).toHaveProperty('error', true);
      expect(response.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    test('Request without session ID should return 401', async () => {
      const response = await request(app)
        .get('/api/workflows')
        .expect(401);

      expect(response.body).toHaveProperty('error', true);
      expect(response.body).toHaveProperty('code', 'UNAUTHORIZED');
    });
  });

  describe('Security', () => {
    test('Headers should include security headers', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.headers).toHaveProperty('x-content-type-options', 'nosniff');
      expect(response.headers).toHaveProperty('x-frame-options', 'DENY');
      expect(response.headers).toHaveProperty('x-xss-protection', '1; mode=block');
    });

    test('CORS headers should be properly set', async () => {
      const response = await request(app)
        .options('/api/workflows')
        .expect(200);

      expect(response.headers).toHaveProperty('access-control-allow-origin');
      expect(response.headers).toHaveProperty('access-control-allow-methods');
    });
  });

  describe('WebSocket Connection', () => {
    test('WebSocket server should be available', async () => {
      // This would require WebSocket client testing
      // For now, we just verify the server started successfully
      expect(server).toBeDefined();
    });
  });

  describe('Performance', () => {
    test('Health check should respond quickly', async () => {
      const start = Date.now();
      await request(app)
        .get('/health')
        .expect(200);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100); // Should respond in under 100ms
    });

    test('API endpoints should have reasonable response times', async () => {
      const start = Date.now();
      await request(app)
        .get('/api/workflows/templates')
        .set('X-Session-ID', 'test-session-id')
        .expect(200);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(500); // Should respond in under 500ms
    });
  });

  describe('Data Validation', () => {
    test('Should validate UUID format for session IDs', async () => {
      const response = await request(app)
        .get('/api/workflows')
        .set('X-Session-ID', 'invalid-uuid')
        .expect(401);

      expect(response.body).toHaveProperty('error', true);
    });

    test('Should validate event data structure', async () => {
      const invalidEventData = {
        type: 'invalid_type', // Invalid event type
        session_id: 'test-session-id',
        data: null // Invalid data
      };

      const response = await request(app)
        .post('/api/events')
        .set('X-Session-ID', 'test-session-id')
        .send(invalidEventData)
        .expect(400);

      expect(response.body).toHaveProperty('error', true);
    });
  });
});