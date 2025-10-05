import express from 'express';
import { TestDatabase } from './test-database.js';
import { MockLangGraphOrchestrator } from './mock-orchestrator.js';

export async function createTestApp(testDb?: TestDatabase, orchestrator?: MockLangGraphOrchestrator): Promise<express.Application> {
  const app = express();

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Enable CORS for testing
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  });

  // Workflow endpoints
  app.post('/api/workflows', async (req, res) => {
    try {
      if (!testDb || !orchestrator) {
        return res.status(503).json({ error: 'Test dependencies not available' });
      }

      const workflowConfig = req.body;

      // Validate workflow configuration
      if (!workflowConfig.name || !workflowConfig.steps || workflowConfig.steps.length === 0) {
        return res.status(400).json({ error: 'Invalid workflow configuration' });
      }

      const workflow = await orchestrator.initializeWorkflow(workflowConfig);
      const savedWorkflow = await testDb.saveWorkflow(workflow);

      res.status(201).json(savedWorkflow);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/api/workflows/:id/start', async (req, res) => {
    try {
      if (!orchestrator) {
        return res.status(503).json({ error: 'Orchestrator not available' });
      }

      const workflowId = req.params.id;
      const inputData = req.body.inputData;

      await orchestrator.startWorkflow(workflowId, inputData);

      res.json({ status: 'started', workflowId });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get('/api/workflows/:id/status', async (req, res) => {
    try {
      if (!orchestrator) {
        return res.status(503).json({ error: 'Orchestrator not available' });
      }

      const workflowId = req.params.id;
      const status = await orchestrator.getWorkflowStatus(workflowId);

      res.json(status);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/api/workflows/:id/feedback', async (req, res) => {
    try {
      if (!orchestrator) {
        return res.status(503).json({ error: 'Orchestrator not available' });
      }

      const workflowId = req.params.id;
      const feedback = req.body;

      const result = await orchestrator.resumeWithHumanInput(workflowId, feedback);

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/api/workflows/:id/retry', async (req, res) => {
    try {
      if (!orchestrator) {
        return res.status(503).json({ error: 'Orchestrator not available' });
      }

      const workflowId = req.params.id;

      // Reset failures and retry
      orchestrator.setStepToSucceed('failing-step');
      await orchestrator.startWorkflow(workflowId);

      res.json({ status: 'retrying', workflowId });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.delete('/api/workflows/:id', async (req, res) => {
    try {
      const workflowId = req.params.id;

      // Mock deletion
      res.json({ status: 'deleted', workflowId });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // UI generation endpoints
  app.get('/api/workflows/:id/ui', async (req, res) => {
    try {
      const workflowId = req.params.id;

      // Mock UI generation
      const uiComponent = {
        type: 'streamlit-dashboard',
        url: `http://localhost:8501/workflows/${workflowId}`,
        config: {
          theme: 'light',
          responsive: true,
          interactive: true
        }
      };

      res.json({ uiComponent });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // WebSocket endpoint for real-time updates
  app.get('/ws/workflows', (req, res) => {
    // Mock WebSocket endpoint info
    res.json({
      message: 'WebSocket endpoint for real-time workflow updates',
      url: 'ws://localhost:3000/ws/workflows'
    });
  });

  // AG-UI protocol endpoints
  app.post('/api/events', async (req, res) => {
    try {
      const event = req.body;

      // Validate event structure
      if (!event.id || !event.type) {
        return res.status(400).json({ error: 'Invalid event structure' });
      }

      // Mock event processing
      const processedEvent = {
        ...event,
        processed: true,
        timestamp: new Date().toISOString(),
        id: `processed-${event.id}`
      };

      res.json(processedEvent);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Session management endpoints
  app.post('/api/sessions', async (req, res) => {
    try {
      if (!testDb) {
        return res.status(503).json({ error: 'Database not available' });
      }

      const sessionConfig = req.body;
      const session = await testDb.createSession(sessionConfig);

      res.json(session);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get('/api/sessions/:id', async (req, res) => {
    try {
      if (!testDb) {
        return res.status(503).json({ error: 'Database not available' });
      }

      const sessionId = req.params.id;
      const session = await testDb.getSession(sessionId);

      res.json(session);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Metrics and monitoring endpoints
  app.get('/api/metrics/workflows/:id', async (req, res) => {
    try {
      if (!orchestrator) {
        return res.status(503).json({ error: 'Orchestrator not available' });
      }

      const workflowId = req.params.id;
      const metrics = await orchestrator.getWorkflowMetrics(workflowId);

      res.json(metrics);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Error handling middleware
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Test app error:', err);
    res.status(500).json({
      error: 'Internal server error',
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
  });

  return app;
}