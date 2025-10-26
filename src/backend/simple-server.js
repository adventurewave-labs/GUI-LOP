/**
 * GUI-LOP Server with Authentication
 * Production-ready server with JWT authentication and secure user management
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import authRoutes from './routes/auth.js';
import { authenticate, optionalAuth } from './middleware/auth.js';

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3001;

// Enhanced CORS configuration for authentication
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'Unknown';

  console.log(`[${timestamp}] ${req.method} ${req.path} - IP: ${ip} - User-Agent: ${userAgent}`);
  next();
});

// Basic storage for demo
const workflows = new Map();
const clients = new Set();
const userWorkflows = new Map(); // userId -> workflows

// Authentication routes
app.use('/api/auth', authRoutes);

// Enhanced health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    message: 'GUI-LOP Server with Authentication is running',
    version: '1.0.0',
    features: {
      authentication: true,
      websockets: true,
      rateLimiting: true,
      secureHeaders: true
    }
  });
});

// Public API routes (no authentication required)
app.get('/api/public/status', (req, res) => {
  res.json({
    message: 'Public API endpoint - accessible without authentication',
    serverTime: new Date().toISOString(),
    features: ['jwt-authentication', 'refresh-tokens', 'secure-passwords', 'rate-limiting']
  });
});

// Workflow templates (public endpoint - accessible without authentication)
app.get('/api/workflows/templates', optionalAuth, (req, res) => {
  const isAuthenticated = !!req.user;
  const userRole = req.user?.role || 'anonymous';

  res.json({
    templates: [
      {
        id: 'data-analysis',
        name: 'Data Analysis Workflow',
        description: 'Analyze data and generate insights with human approval',
        steps: ['Data Ingestion', 'Analysis', 'Insight Generation', 'Human Review', 'Final Report'],
        category: 'analytics',
        requiresAuth: false,
        complexity: 'intermediate'
      },
      {
        id: 'decision-making',
        name: 'Decision Making Workflow',
        description: 'Generate options and collect human input for decisions',
        steps: ['Context Analysis', 'Option Generation', 'Human Selection', 'Reasoning', 'Confidence Assessment'],
        category: 'decision',
        requiresAuth: true,
        complexity: 'advanced'
      },
      {
        id: 'content-creation',
        name: 'Content Creation Workflow',
        description: 'Create content with human review and revision',
        steps: ['Requirements', 'Content Generation', 'Human Review', 'Revision', 'Finalization'],
        category: 'content',
        requiresAuth: true,
        complexity: 'intermediate'
      },
      ...(isAuthenticated && userRole === 'admin' ? [{
        id: 'system-administration',
        name: 'System Administration Workflow',
        description: 'Administrative tasks with approval workflow',
        steps: ['Task Identification', 'Risk Assessment', 'Approval Required', 'Implementation', 'Verification'],
        category: 'admin',
        requiresAuth: true,
        complexity: 'advanced',
        restrictedTo: ['admin']
      }] : [])
    ],
    metadata: {
      isAuthenticated,
      userRole,
      totalTemplates: isAuthenticated && userRole === 'admin' ? 4 : 3,
      timestamp: new Date().toISOString()
    }
  });
});

// Create new workflow (requires authentication)
app.post('/api/workflows', authenticate, (req, res) => {
  const { template, context } = req.body;
  const userId = req.user.id;

  if (!template || !context) {
    return res.status(400).json({
      success: false,
      message: 'Template and context are required',
      code: 'MISSING_REQUIRED_FIELDS'
    });
  }

  const workflowId = uuidv4();

  const workflow = {
    id: workflowId,
    template,
    context,
    status: 'created',
    userId,
    createdBy: {
      id: req.user.id,
      email: req.user.email,
      name: `${req.user.firstName} ${req.user.lastName}`
    },
    createdAt: new Date().toISOString()
  };

  workflows.set(workflowId, workflow);

  // Add to user-specific workflows
  if (!userWorkflows.has(userId)) {
    userWorkflows.set(userId, new Set());
  }
  userWorkflows.get(userId).add(workflowId);

  console.log(`Workflow created: ${workflowId} by user ${req.user.email}`);

  res.status(201).json({
    success: true,
    message: 'Workflow created successfully',
    data: {
      workflow_id: workflowId,
      status: 'created',
      workflow
    },
    metadata: {
      timestamp: new Date().toISOString(),
      createdBy: req.user.email
    }
  });
});

// Execute workflow (requires authentication)
app.post('/api/workflows/:workflowId/execute', authenticate, (req, res) => {
  const { workflowId } = req.params;
  const workflow = workflows.get(workflowId);

  if (!workflow) {
    return res.status(404).json({
      success: false,
      message: 'Workflow not found',
      code: 'WORKFLOW_NOT_FOUND'
    });
  }

  // Check if user owns the workflow or is admin
  if (workflow.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. You can only execute your own workflows.',
      code: 'ACCESS_DENIED'
    });
  }

  workflow.status = 'running';
  workflow.startedAt = new Date().toISOString();
  workflow.executedBy = {
    id: req.user.id,
    email: req.user.email,
    name: `${req.user.firstName} ${req.user.lastName}`
  };

  // Simulate workflow execution with UI generation
  setTimeout(() => {
    const uiUrl = `http://localhost:8501/${workflowId}`;

    notifyClients({
      type: 'ui_generation',
      workflow_id: workflowId,
      userId: req.user.id,
      payload: {
        ui_url: uiUrl,
        components: ['dashboard', 'approval_form'],
        message: 'Interactive dashboard is ready for your review',
        executedBy: req.user.email
      }
    });

    workflow.status = 'waiting_for_human';
    workflow.ui_url = uiUrl;
    workflow.readyAt = new Date().toISOString();

    console.log(`Workflow ready: ${workflowId} for user ${req.user.email}`);
  }, 2000);

  res.json({
    success: true,
    message: 'Workflow execution started',
    data: {
      workflow_id: workflowId,
      status: 'executing',
      estimatedCompletionTime: new Date(Date.now() + 2000).toISOString()
    },
    metadata: {
      timestamp: new Date().toISOString(),
      executedBy: req.user.email
    }
  });
});

// Get workflow status (requires authentication)
app.get('/api/workflows/:workflowId', authenticate, (req, res) => {
  const { workflowId } = req.params;
  const workflow = workflows.get(workflowId);

  if (!workflow) {
    return res.status(404).json({
      success: false,
      message: 'Workflow not found',
      code: 'WORKFLOW_NOT_FOUND'
    });
  }

  // Check if user owns the workflow or is admin
  if (workflow.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. You can only view your own workflows.',
      code: 'ACCESS_DENIED'
    });
  }

  res.json({
    success: true,
    message: 'Workflow status retrieved successfully',
    data: {
      workflow
    },
    metadata: {
      timestamp: new Date().toISOString(),
      requestedBy: req.user.email
    }
  });
});

// Get user's workflows (requires authentication)
app.get('/api/workflows', authenticate, (req, res) => {
  const userId = req.user.id;
  const userWorkflowIds = userWorkflows.get(userId) || new Set();

  const userWorkflowsList = Array.from(userWorkflowIds)
    .map(workflowId => workflows.get(workflowId))
    .filter(workflow => workflow);

  res.json({
    success: true,
    message: 'User workflows retrieved successfully',
    data: {
      workflows: userWorkflowsList,
      total: userWorkflowsList.length
    },
    metadata: {
      timestamp: new Date().toISOString(),
      userId: req.user.id
    }
  });
});

// Handle human response (requires authentication)
app.post('/api/workflows/:workflowId/respond', authenticate, (req, res) => {
  const { workflowId } = req.params;
  const { action, data } = req.body;
  const workflow = workflows.get(workflowId);

  if (!workflow) {
    return res.status(404).json({
      success: false,
      message: 'Workflow not found',
      code: 'WORKFLOW_NOT_FOUND'
    });
  }

  // Check if user owns the workflow or is admin
  if (workflow.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. You can only respond to your own workflows.',
      code: 'ACCESS_DENIED'
    });
  }

  if (!action || !data) {
    return res.status(400).json({
      success: false,
      message: 'Action and data are required',
      code: 'MISSING_REQUIRED_FIELDS'
    });
  }

  workflow.status = 'completed';
  workflow.completedAt = new Date().toISOString();
  workflow.humanResponse = {
    action,
    data,
    respondedBy: {
      id: req.user.id,
      email: req.user.email,
      name: `${req.user.firstName} ${req.user.lastName}`
    }
  };

  notifyClients({
    type: 'workflow_completed',
    workflow_id: workflowId,
    userId: req.user.id,
    payload: {
      message: 'Workflow completed successfully',
      result: data,
      respondedBy: req.user.email,
      action
    }
  });

  console.log(`Workflow completed: ${workflowId} by user ${req.user.email} with action: ${action}`);

  res.json({
    success: true,
    message: 'Human response received and workflow completed',
    data: {
      workflow_id: workflowId,
      status: 'completed',
      response: {
        action,
        data,
        respondedAt: workflow.completedAt,
        respondedBy: req.user.email
      }
    },
    metadata: {
      timestamp: new Date().toISOString()
    }
  });
});

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);

  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';

  res.status(err.status || 500).json({
    success: false,
    message: isDevelopment ? err.message : 'Internal server error',
    code: 'INTERNAL_ERROR',
    ...(isDevelopment && { stack: err.stack })
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    code: 'ROUTE_NOT_FOUND',
    path: req.originalUrl
  });
});

// WebSocket server for real-time communication
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const sessionId = uuidv4();
  clients.add(ws);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      ws.send(JSON.stringify({
        type: 'echo',
        original: data,
        timestamp: new Date().toISOString()
      }));
    } catch (error) {
      // Silently handle invalid messages
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
  });

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
  console.log(`GUI-LOP Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  server.close(() => {
    process.exit(0);
  });
});

export default app;