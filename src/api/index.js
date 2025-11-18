/**
 * Enhanced API Entry Point
 * Week 7 Phase 2 API Enhancement Implementation
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { WebSocketServer } from 'ws';

// Import middleware
import { apiVersioning, DEFAULT_API_VERSION } from './middleware/versioning.js';
import {
  validateUserRegistration,
  validateLogin,
  validateChangePassword,
  validateCreateWorkflow,
  validateExecuteWorkflow,
  validateWorkflowResponse,
  addRequestId,
  sanitizeInput
} from './validators/validation-middleware.js';
import {
  authRateLimiter,
  registrationRateLimiter,
  passwordChangeRateLimiter,
  generalApiRateLimiter,
  workflowCreationRateLimiter,
  workflowExecutionRateLimiter
} from './middleware/rate-limiter.js';

// Import authentication middleware and routes
import { authenticate, authorize, optionalAuth } from '../backend/middleware/auth.js';
import authRoutes from '../backend/routes/auth.js';
import {
  metricsMiddleware,
  performanceMonitoring,
  createMetricsRoutes
} from './middleware/metrics.js';
import {
  publicCache,
  userCache,
  templateCache,
  cacheInvalidation
} from './middleware/cache.js';
import {
  errorHandler,
  asyncHandler
} from './middleware/error-handler.js';

// Import monitoring
import { monitoringDataCollector, DashboardServer, createPublicFiles } from './monitoring/dashboard.js';
import { createDocumentationRoutes } from './docs/swagger.js';

// Import configuration
import {
  API_CONFIG,
  initializeConfig,
  getCorsOptions,
  getRateLimitOptions
} from './config/index.js';

// Dashboard configuration
const DASHBOARD_CONFIG = {
  port: process.env.DASHBOARD_PORT || 3003
};

/**
 * Create enhanced Express app
 */
function createApp() {
  const app = express();

  // Validate configuration
  const configValidation = initializeConfig();
  if (!configValidation.isValid && API_CONFIG.isProduction) {
    throw new Error('Configuration validation failed. Please check your environment variables.');
  }

  // Core middleware
  app.use(helmet({
    contentSecurityPolicy: API_CONFIG.security.helmet.enabled ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
      }
    } : false
  }));

  app.use(compression({
    threshold: API_CONFIG.security.compression.threshold
  }));

  app.use(cors(getCorsOptions()));

  app.use(express.json({
    limit: API_CONFIG.server.maxRequestSize,
    strict: true
  }));

  app.use(express.urlencoded({
    extended: true,
    limit: API_CONFIG.server.maxRequestSize
  }));

  // Request tracking and sanitization
  app.use(addRequestId);
  app.use(sanitizeInput);

  // API versioning
  app.use('/api', apiVersioning({
    defaultVersion: DEFAULT_API_VERSION,
    validVersions: API_CONFIG.versioning.supportedVersions
  }));

  // Metrics and performance monitoring
  if (API_CONFIG.monitoring.enabled) {
    app.use(metricsMiddleware({
      trackResponseTime: true,
      trackErrors: true,
      trackUserActivity: true
    }));
    app.use(performanceMonitoring());
  }

  // Rate limiting
  if (API_CONFIG.rateLimiting.enabled) {
    app.use('/api/v1/auth/register', registrationRateLimiter);
    app.use('/api/v1/auth/login', authRateLimiter);
    app.use('/api/v1/auth/change-password', passwordChangeRateLimiter);
    app.use('/api/v1/workflows', workflowCreationRateLimiter);
    app.use('/api/v1/workflows/*/execute', workflowExecutionRateLimiter);
    app.use('/api/v1', generalApiRateLimiter);
  }

  // Caching
  if (API_CONFIG.cache.enabled) {
    app.use('/api/v1/workflows/templates', templateCache);
    app.use('/api/v1/health', publicCache);
  }

  // Authentication routes
  app.use('/api/v1/auth', authRoutes);

  // API Routes
  setupRoutes(app);

  // Documentation routes
  if (API_CONFIG.documentation.enabled) {
    createDocumentationRoutes(app);
  }

  // Metrics routes
  if (API_CONFIG.monitoring.metrics.enabled) {
    createMetricsRoutes(app);
  }

  // Cache invalidation
  if (API_CONFIG.cache.enabled) {
    app.use(cacheInvalidation(monitoringDataCollector));
  }

  // Health check
  app.get('/health', (req, res) => {
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: API_CONFIG.server.env,
      features: {
        authentication: true,
        rateLimiting: API_CONFIG.rateLimiting.enabled,
        caching: API_CONFIG.cache.enabled,
        monitoring: API_CONFIG.monitoring.enabled,
        documentation: API_CONFIG.documentation.enabled,
        versioning: API_CONFIG.versioning.enabled
      },
      uptime: Math.round(process.uptime()),
      memory: process.memoryUsage(),
      metrics: monitoringDataCollector.getCurrentMetrics()
    };

    res.json(health);
  });

  // Public status endpoint
  app.get('/api/public/status', (req, res) => {
    res.json({
      success: true,
      message: 'Public API endpoint - accessible without authentication',
      data: {
        serverTime: new Date().toISOString(),
        features: [
          'jwt-authentication',
          'refresh-tokens',
          'secure-passwords',
          'rate-limiting',
          'api-versioning',
          'caching',
          'monitoring',
          'documentation'
        ],
        version: '1.0.0'
      },
      timestamp: new Date().toISOString()
    });
  });

  // 404 handler
  app.use('*', (req, res) => {
    res.status(404).json({
      success: false,
      message: 'Route not found',
      code: 'ROUTE_NOT_FOUND',
      path: req.originalUrl,
      timestamp: new Date().toISOString(),
      requestId: req.id || 'unknown'
    });
  });

  // Error handling
  app.use(errorHandler);

  return app;
}

/**
 * Input sanitization helper function
 */
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input.trim()
    .replace(/[<>]/g, '') // Remove HTML tags
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, ''); // Remove event handlers
}

/**
 * Setup API routes
 */
function setupRoutes(app) {
  // Auth routes are now handled by the authRoutes middleware

  // Workflow routes
  app.get('/api/v1/workflows/templates',
    asyncHandler(async (req, res) => {
      const templates = [
        {
          id: 'data-analysis',
          name: 'Data Analysis Workflow',
          description: 'Analyze data and generate insights with human approval',
          steps: ['Data Ingestion', 'Analysis', 'Insight Generation', 'Human Review', 'Final Report'],
          category: 'analytics',
          complexity: 'intermediate',
          requiresAuth: false
        },
        {
          id: 'decision-making',
          name: 'Decision Making Workflow',
          description: 'Generate options and collect human input for decisions',
          steps: ['Context Analysis', 'Option Generation', 'Human Selection', 'Reasoning', 'Confidence Assessment'],
          category: 'decision',
          complexity: 'advanced',
          requiresAuth: true
        }
      ];

      res.json({
        success: true,
        message: 'Workflow templates retrieved successfully',
        data: {
          templates,
          metadata: {
            isAuthenticated: !!req.user,
            userRole: req.user?.role || 'anonymous',
            totalTemplates: templates.length,
            timestamp: new Date().toISOString()
          }
        },
        timestamp: new Date().toISOString()
      });
    })
  );

  app.get('/api/v1/workflows',
    authenticate,
    asyncHandler(async (req, res) => {
      try {
        const { page = 1, limit = 20, status, category } = req.query;
        const offset = (page - 1) * limit;

        // Mock workflow data - in production, this would come from database
        const workflows = [
          {
            id: 'workflow-1',
            name: 'Data Analysis Pipeline',
            description: 'Automated data analysis with human validation steps',
            status: 'active',
            category: 'analytics',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            owner: req.user.id,
            steps: ['Data Collection', 'Preprocessing', 'Analysis', 'Review', 'Report Generation']
          },
          {
            id: 'workflow-2',
            name: 'Content Approval Workflow',
            description: 'Multi-stage content approval process',
            status: 'draft',
            category: 'content',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            owner: req.user.id,
            steps: ['Create', 'Review', 'Approve', 'Publish']
          }
        ];

        // Apply filters
        let filteredWorkflows = workflows;
        if (status) {
          filteredWorkflows = filteredWorkflows.filter(w => w.status === status);
        }
        if (category) {
          filteredWorkflows = filteredWorkflows.filter(w => w.category === category);
        }

        const total = filteredWorkflows.length;
        const paginatedWorkflows = filteredWorkflows.slice(offset, offset + parseInt(limit));

        res.json({
          success: true,
          message: 'Workflows retrieved successfully',
          data: {
            workflows: paginatedWorkflows,
            pagination: {
              page: parseInt(page),
              limit: parseInt(limit),
              total,
              totalPages: Math.ceil(total / limit),
              hasNext: offset + parseInt(limit) < total,
              hasPrev: page > 1
            }
          },
          metadata: {
            timestamp: new Date().toISOString(),
            user: req.user.email,
            filters: { status, category }
          }
        });
      } catch (error) {
        console.error('Get workflows error:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to retrieve workflows',
          code: 'WORKFLOWS_ERROR'
        });
      }
    })
  );

  app.post('/api/v1/workflows',
    authenticate,
    validateCreateWorkflow,
    asyncHandler(async (req, res) => {
      try {
        const { name, description, steps, category = 'general' } = req.body;

        // Input validation
        if (!name || !description || !steps || !Array.isArray(steps)) {
          return res.status(400).json({
            success: false,
            message: 'Name, description, and steps array are required',
            code: 'VALIDATION_ERROR'
          });
        }

        // Create workflow object
        const workflow = {
          id: `workflow-${Date.now()}`,
          name: sanitizeInput(name),
          description: sanitizeInput(description),
          steps: steps.map(step => ({
            id: `step-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: sanitizeInput(step.name || step),
            type: step.type || 'manual',
            description: sanitizeInput(step.description || ''),
            required: step.required !== false
          })),
          category: sanitizeInput(category),
          status: 'draft',
          owner: req.user.id,
          ownerEmail: req.user.email,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        console.log(`Workflow created: ${workflow.name} by ${req.user.email}`);

        res.status(201).json({
          success: true,
          message: 'Workflow created successfully',
          data: { workflow },
          metadata: {
            timestamp: new Date().toISOString(),
            createdBy: req.user.email
          }
        });
      } catch (error) {
        console.error('Create workflow error:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to create workflow',
          code: 'WORKFLOW_CREATE_ERROR'
        });
      }
    })
  );

  app.post('/api/v1/workflows/:workflowId/execute',
    authenticate,
    validateExecuteWorkflow,
    asyncHandler(async (req, res) => {
      try {
        const { workflowId } = req.params;
        const { inputData, options = {} } = req.body;

        // Validate workflow ID format
        if (!workflowId || workflowId.length < 3) {
          return res.status(400).json({
            success: false,
            message: 'Invalid workflow ID',
            code: 'INVALID_WORKFLOW_ID'
          });
        }

        // Create execution record
        const execution = {
          id: `exec-${Date.now()}`,
          workflowId,
          status: 'running',
          startedAt: new Date().toISOString(),
          initiatedBy: req.user.id,
          initiatedByEmail: req.user.email,
          inputData: inputData || {},
          options,
          steps: [
            {
              id: 'step-1',
              name: 'Initialization',
              status: 'completed',
              startedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
              output: 'Workflow execution started successfully'
            },
            {
              id: 'step-2',
              name: 'Processing',
              status: 'running',
              startedAt: new Date().toISOString()
            }
          ]
        };

        console.log(`Workflow execution started: ${workflowId} by ${req.user.email}`);

        res.json({
          success: true,
          message: 'Workflow execution started',
          data: { execution },
          metadata: {
            timestamp: new Date().toISOString(),
            estimatedDuration: '5-10 minutes'
          }
        });
      } catch (error) {
        console.error('Execute workflow error:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to execute workflow',
          code: 'WORKFLOW_EXECUTION_ERROR'
        });
      }
    })
  );

  app.post('/api/v1/workflows/:workflowId/respond',
    authenticate,
    validateWorkflowResponse,
    asyncHandler(async (req, res) => {
      try {
        const { workflowId } = req.params;
        const { stepId, response, action } = req.body;

        // Validate required fields
        if (!stepId || !response) {
          return res.status(400).json({
            success: false,
            message: 'Step ID and response are required',
            code: 'VALIDATION_ERROR'
          });
        }

        // Process the response
        const processedResponse = {
          id: `response-${Date.now()}`,
          workflowId,
          stepId,
          response: sanitizeInput(response),
          action: sanitizeInput(action || 'continue'),
          respondedBy: req.user.id,
          respondedByEmail: req.user.email,
          respondedAt: new Date().toISOString(),
          status: 'processed'
        };

        console.log(`Workflow response processed: ${workflowId}/${stepId} by ${req.user.email}`);

        res.json({
          success: true,
          message: 'Workflow response processed successfully',
          data: { response: processedResponse },
          metadata: {
            timestamp: new Date().toISOString(),
            nextStep: action === 'continue' ? 'Proceeding to next step' : 'Workflow paused'
          }
        });
      } catch (error) {
        console.error('Workflow response error:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to process workflow response',
          code: 'WORKFLOW_RESPONSE_ERROR'
        });
      }
    })
  );
}

/**
 * Create HTTP server
 */
function createServer(app) {
  const server = app.listen(API_CONFIG.server.port, API_CONFIG.server.host, () => {
    console.log(`🚀 Enhanced GUI-LOP API Server running on http://${API_CONFIG.server.host}:${API_CONFIG.server.port}`);
    console.log(`📊 API Documentation: http://${API_CONFIG.server.host}:${API_CONFIG.server.port}/docs`);
    console.log(`📈 Monitoring Dashboard: http://${API_CONFIG.server.host}:${DASHBOARD_CONFIG.port}`);
    console.log(`🔧 Environment: ${API_CONFIG.server.env}`);

    console.log('\n📋 API Features:');
    console.log(`  ✅ Authentication with JWT`);
    console.log(`  ✅ Rate limiting and throttling`);
    console.log(`  ✅ API versioning`);
    console.log(`  ✅ Request/response validation`);
    console.log(`  ✅ Response caching`);
    console.log(`  ✅ Metrics collection`);
    console.log(`  ✅ Error handling`);
    console.log(`  ✅ Interactive documentation`);
    console.log(`  ✅ Real-time monitoring`);
  });

  // Handle server errors
  server.on('error', (error) => {
    if (error.syscall !== 'listen') {
      throw error;
    }
  });

  // Handle server close
  server.on('close', () => {
    console.log('API server closed');
  });

  return server;
}

/**
 * Create WebSocket server for real-time communication
 */
function createWebSocketServer(httpServer) {
  if (!API_CONFIG.websocket.enabled) {
    return null;
  }

  const wss = new WebSocketServer({
    server: httpServer,
    path: '/api/v1/ws'
  });

  const clients = new Set();

  wss.on('connection', (ws, req) => {
    clients.add(ws);
    console.log(`WebSocket client connected: ${req.socket.remoteAddress}`);

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      sessionId: generateSessionId(),
      message: 'Connected to GUI-LOP WebSocket',
      timestamp: new Date().toISOString()
    }));

    // Handle messages
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        handleWebSocketMessage(ws, data, req);
      } catch (error) {
        console.error('Invalid WebSocket message:', error);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid message format',
          timestamp: new Date().toISOString()
        }));
      }
    });

    // Handle disconnection
    ws.on('close', () => {
      clients.delete(ws);
      console.log(`WebSocket client disconnected: ${req.socket.remoteAddress}`);
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  function handleWebSocketMessage(ws, data, req) {
    // Route message based on type
    switch (data.type) {
      case 'ping':
        ws.send(JSON.stringify({
          type: 'pong',
          timestamp: new Date().toISOString()
        }));
        break;

      case 'subscribe':
        // Handle subscription to events
        handleSubscription(ws, data, req);
        break;

      case 'unsubscribe':
        // Handle unsubscription from events
        handleUnsubscription(ws, data, req);
        break;

      default:
        // Echo back unknown messages
        ws.send(JSON.stringify({
          type: 'echo',
          original: data,
          timestamp: new Date().toISOString()
        }));
    }
  }

  function handleSubscription(ws, data, req) {
    // Implement subscription logic
    console.log(`Client ${req.socket.remoteAddress} subscribed to: ${data.event}`);

    ws.send(JSON.stringify({
      type: 'subscribed',
      event: data.event,
      timestamp: new Date().toISOString()
    }));
  }

  function handleUnsubscription(ws, data, req) {
    // Implement unsubscription logic
    console.log(`Client ${req.socket.remoteAddress} unsubscribed from: ${data.event}`);

    ws.send(JSON.stringify({
      type: 'unsubscribed',
      event: data.event,
      timestamp: new Date().toISOString()
    }));
  }

  function notifyClients(message) {
    const messageStr = JSON.stringify({
      ...message,
      timestamp: new Date().toISOString()
    });

    clients.forEach(client => {
      if (client.readyState === client.OPEN) {
        client.send(messageStr);
      }
    });
  }

  return {
    server: wss,
    notifyClients,
    getClientCount: () => clients.size
  };
}

/**
 * Generate unique session ID
 */
function generateSessionId() {
  return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

/**
 * Start monitoring dashboard
 */
async function startDashboard() {
  try {
    // Create public files for dashboard
    createPublicFiles();

    // Create and start dashboard server
    const dashboard = new DashboardServer(monitoringDataCollector);
    dashboard.start();

    return dashboard;
  } catch (error) {
    console.error('Failed to start dashboard:', error);
    return null;
  }
}

/**
 * Graceful shutdown handler
 */
function setupGracefulShutdown(server, wsServer, dashboard) {
  const shutdown = (signal) => {
    console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);

    // Stop accepting new connections
    server.close(async () => {
      console.log('📡 HTTP server closed');

      // Close WebSocket server
      if (wsServer) {
        wsServer.close(() => {
          console.log('🔌 WebSocket server closed');
        });
      }

      // Close dashboard server
      if (dashboard) {
        await dashboard.stop();
        console.log('📊 Dashboard server closed');
      }

      console.log('✅ Graceful shutdown complete');
      process.exit(0);
    });

    // Force shutdown after 30 seconds
    setTimeout(() => {
      console.error('❌ Forced shutdown due to timeout');
      process.exit(1);
    }, 30000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

/**
 * Main entry point
 */
async function main() {
  try {
    // Create Express app
    const app = createApp();

    // Create HTTP server
    const server = createServer(app);

    // Create WebSocket server
    const wsServer = createWebSocketServer(server);

    // Start monitoring dashboard
    const dashboard = await startDashboard();

    // Setup graceful shutdown
    setupGracefulShutdown(server, wsServer, dashboard);

    return { server, app, wsServer, dashboard };

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export {
  createApp,
  createServer,
  createWebSocketServer,
  startDashboard,
  monitoringDataCollector
};