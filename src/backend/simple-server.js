/**
 * Simple GUI-LOP Server Demo
 * Minimal working server to prove the concept
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Basic storage for demo (in production, use PostgreSQL)
const workflows = new Map();
const sessions = new Map();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    message: 'GUI-LOP Server is running'
  });
});

// Workflow templates
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
        description: 'Create content with human review and revision',
        steps: ['Requirements', 'Content Generation', 'Human Review', 'Revision', 'Finalization']
      }
    ]
  });
});

// Create new workflow
app.post('/api/workflows', (req, res) => {
  const { template, context } = req.body;
  const workflowId = uuidv4();

  const workflow = {
    id: workflowId,
    template,
    context,
    status: 'created',
    createdAt: new Date().toISOString(),
    steps: []
  };

  workflows.set(workflowId, workflow);

  res.json({
    workflow_id: workflowId,
    status: 'created',
    message: 'Workflow created successfully'
  });
});

// Execute workflow
app.post('/api/workflows/:workflowId/execute', (req, res) => {
  const { workflowId } = req.params;
  const workflow = workflows.get(workflowId);

  if (!workflow) {
    return res.status(404).json({ error: 'Workflow not found' });
  }

  workflow.status = 'running';
  workflow.startedAt = new Date().toISOString();

  // Simulate workflow execution with UI generation
  setTimeout(() => {
    // Generate a mock UI URL (in production, this would be Streamlit/Gradio)
    const uiUrl = `http://localhost:8501/${workflowId}`;

    // Notify via WebSocket that UI is ready
    notifyClients({
      type: 'ui_generation',
      workflow_id: workflowId,
      payload: {
        ui_url: uiUrl,
        components: ['dashboard', 'approval_form'],
        message: 'Interactive dashboard is ready for your review'
      }
    });

    workflow.status = 'waiting_for_human';
    workflow.ui_url = uiUrl;
  }, 2000);

  res.json({
    workflow_id: workflowId,
    status: 'executing',
    message: 'Workflow execution started'
  });
});

// Get workflow status
app.get('/api/workflows/:workflowId', (req, res) => {
  const { workflowId } = req.params;
  const workflow = workflows.get(workflowId);

  if (!workflow) {
    return res.status(404).json({ error: 'Workflow not found' });
  }

  res.json(workflow);
});

// Handle human response
app.post('/api/workflows/:workflowId/respond', (req, res) => {
  const { workflowId } = req.params;
  const { action, data } = req.body;
  const workflow = workflows.get(workflowId);

  if (!workflow) {
    return res.status(404).json({ error: 'Workflow not found' });
  }

  workflow.status = 'completed';
  workflow.completedAt = new Date().toISOString();
  workflow.humanResponse = { action, data };

  // Notify clients of completion
  notifyClients({
    type: 'workflow_completed',
    workflow_id: workflowId,
    payload: {
      message: 'Workflow completed successfully',
      result: data
    }
  });

  res.json({
    workflow_id: workflowId,
    status: 'completed',
    message: 'Human response received and workflow completed'
  });
});

// WebSocket server for real-time communication
const wss = new WebSocketServer({ server });
const clients = new Set();

wss.on('connection', (ws, req) => {
  const sessionId = uuidv4();
  clients.add(ws);
  sessions.set(sessionId, { ws, connected: new Date() });

  console.log(`New WebSocket connection: ${sessionId}`);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received:', data);

      // Echo back for demo
      ws.send(JSON.stringify({
        type: 'echo',
        original: data,
        timestamp: new Date().toISOString()
      }));
    } catch (error) {
      console.error('Invalid message:', error);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    sessions.delete(sessionId);
    console.log(`WebSocket disconnected: ${sessionId}`);
  });

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'connected',
    session_id: sessionId,
    message: 'Connected to GUI-LOP WebSocket'
  }));
});

function notifyClients(message) {
  const messageStr = JSON.stringify(message);
  clients.forEach(client => {
    if (client.readyState === client.OPEN) {
      client.send(messageStr);
    }
  });
}

// Start server
server.listen(PORT, () => {
  console.log(`🚀 GUI-LOP Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 WebSocket: ws://localhost:${PORT}`);
  console.log(`\n🎯 Try these commands:`);
  console.log(`curl http://localhost:${PORT}/health`);
  console.log(`curl http://localhost:${PORT}/api/workflows/templates`);
  console.log(`\n💡 GUI-LOP is ready for agent-human collaboration!`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default app;