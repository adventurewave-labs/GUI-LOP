/**
 * Enhanced GUI-LOP Server with Redis Caching Integration
 * Production-ready server with comprehensive Redis caching layer
 * Week 5-6 Phase 2 - Redis Caching Layer Integration Example
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';

// Import database components
import { db, dbHelpers } from '../database/config/database.js';
import defaultErrorHandler from '../database/utils/error-handler.js';

// Import enhanced cache services
import redisConfig from './config/redis-config.js';
import cacheService from './services/redis-cache-service.js';
import workflowCacheService from './services/workflow-cache-service.js';
import sessionCacheService from './services/session-cache-service.js';
import cacheMiddleware from './middleware/cache-middleware.js';
import cacheInvalidationService from './services/cache-invalidation-service.js';
import cacheWarmingService from './services/cache-warming-service.js';
import cacheMonitoringService from './services/cache-monitoring-service.js';
import cacheHealthMiddleware from './middleware/cache-health-middleware.js';
import enhancedAuthMiddleware from './enhanced-auth-middleware.js';

// Load environment variables
dotenv.config();

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3001;

// Global cache services for easy access
global.cacheServices = {
  redis: redisConfig,
  cache: cacheService,
  workflow: workflowCacheService,
  session: sessionCacheService,
  invalidation: cacheInvalidationService,
  warming: cacheWarmingService,
  monitoring: cacheMonitoringService,
  middleware: cacheMiddleware,
  health: cacheHealthMiddleware,
  auth: enhancedAuthMiddleware
};

// Enhanced middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging with cache tracking
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const ip = req.ip || req.connection.remoteAddress;

  console.log(`[${timestamp}] ${req.method} ${req.path} - IP: ${ip}`);

  // Track access for cache warming
  if (global.cacheServices.warming && global.cacheServices.warming.initialized) {
    global.cacheServices.warming.trackAccess('api', req.path, req.user?.id);
  }

  next();
});

// Cache health check endpoint
app.get('/health/cache', cacheHealthMiddleware.healthCheck());

// Comprehensive health check including cache
app.get('/health', async (req, res) => {
  try {
    // Database health
    const dbHealth = await db.healthCheck();

    // Cache health
    const cacheHealth = await cacheHealthMiddleware.getComprehensiveHealth();

    // Overall status
    const overallStatus = (dbHealth.status === 'ok' && cacheHealth.overall.status === 'healthy')
      ? 'healthy'
      : 'degraded';

    res.json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      message: 'GUI-LOP Enhanced Server with Redis Caching',
      version: '2.0.0-redis',
      features: {
        database: dbHealth.status === 'ok',
        redisCaching: cacheHealth.overall.status === 'healthy',
        sessionManagement: cacheHealth.components.sessionCache?.status === 'healthy',
        cacheMonitoring: cacheHealth.components.monitoring?.status === 'healthy',
        websockets: true,
        authentication: true,
        rateLimiting: true
      },
      components: {
        database: dbHealth,
        cache: cacheHealth
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Cache monitoring dashboard endpoint
app.get('/cache/metrics', async (req, res) => {
  try {
    if (!cacheMonitoringService.initialized) {
      return res.status(503).json({
        error: 'Cache monitoring not initialized',
        timestamp: new Date().toISOString()
      });
    }

    const dashboardData = cacheMonitoringService.getDashboardData();
    const performanceSummary = cacheMonitoringService.getPerformanceSummary();

    res.json({
      timestamp: new Date().toISOString(),
      ...dashboardData,
      performance: performanceSummary
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Cache statistics endpoint
app.get('/cache/stats', async (req, res) => {
  try {
    const stats = {
      redis: await redisConfig.getHealthStatus(),
      cache: await cacheService.getStats(),
      workflow: await workflowCacheService.getCacheStats(),
      session: await sessionCacheService.getSessionStats(),
      middleware: cacheMiddleware.getStats(),
      warming: cacheWarmingService.getWarmingStats()
    };

    res.json({
      timestamp: new Date().toISOString(),
      ...stats
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Workflow templates with caching
app.get('/api/workflows/templates',
  cacheMiddleware.cache({ namespace: 'workflow-templates' }),
  async (req, res) => {
    try {
      const templates = await workflowCacheService.getTemplates(req.query);

      res.json({
        success: true,
        data: templates,
        timestamp: new Date().toISOString(),
        cached: req.cacheHit || false
      });
    } catch (error) {
      const dbError = defaultErrorHandler.handleError(error, {
        operation: 'get_workflow_templates'
      });

      res.status(500).json(defaultErrorHandler.createErrorResponse(dbError));
    }
  }
);

// Create workflow with cache invalidation
app.post('/api/workflows',
  enhancedAuthMiddleware.authenticate(),
  async (req, res) => {
    const transactionManager = new (await import('../database/utils/transaction-manager.js')).TransactionManager(db.pool);

    try {
      return await transactionManager.inTransaction(async (tx) => {
        const { template, template_id, context } = req.body;
        const userId = req.user.id;

        // Validate template exists (with cache)
        let templateData;
        if (template_id) {
          templateData = await workflowCacheService.getTemplate(template_id);
          if (!templateData) {
            templateData = await dbHelpers.findById('workflow_templates', template_id);
          }
        } else if (template) {
          templateData = await workflowCacheService.getTemplateByKey(template);
          if (!templateData) {
            const result = await tx.query(
              'SELECT * FROM workflow_templates WHERE template_key = $1 AND is_active = true',
              [template]
            );
            templateData = result.rows[0];
          }
        }

        if (!templateData) {
          return res.status(400).json({
            success: false,
            message: 'Invalid template',
            code: 'INVALID_TEMPLATE'
          });
        }

        // Create workflow
        const workflowData = {
          template_id: templateData.id,
          template_key: templateData.template_key,
          title: context?.title || templateData.name,
          description: context?.description || templateData.description,
          status: 'created',
          context: context || {},
          config: templateData.default_config,
          created_by: userId
        };

        const workflow = await dbHelpers.insert('workflows', workflowData);

        // Cache workflow after creation
        await workflowCacheService.cacheWorkflowAfterCreation({
          ...workflow,
          created_by: userId,
          template: templateData
        });

        // Trigger cache invalidation
        await cacheInvalidationService.invalidate('workflow.created', {
          workflowId: workflow.id,
          userId,
          templateKey: templateData.template_key
        });

        // Trigger cache warming for user data
        await cacheWarmingService.triggerEventWarming('workflow.created', {
          userId,
          workflowId: workflow.id,
          event: 'workflow.created'
        });

        res.status(201).json({
          success: true,
          message: 'Workflow created successfully',
          data: {
            workflow_id: workflow.id,
            status: 'created',
            workflow
          },
          timestamp: new Date().toISOString()
        });
      });
    } catch (error) {
      const dbError = defaultErrorHandler.handleError(error, {
        operation: 'create_workflow'
      });

      res.status(500).json(defaultErrorHandler.createErrorResponse(dbError));
    }
  }
);

// Get user workflows with caching
app.get('/api/workflows',
  enhancedAuthMiddleware.authenticate(),
  cacheMiddleware.cache({ namespace: 'user-workflows' }),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const workflows = await workflowCacheService.getUserWorkflows(userId, req.query);

      res.json({
        success: true,
        data: workflows,
        timestamp: new Date().toISOString(),
        cached: req.cacheHit || false
      });
    } catch (error) {
      const dbError = defaultErrorHandler.handleError(error, {
        operation: 'get_user_workflows'
      });

      res.status(500).json(defaultErrorHandler.createErrorResponse(dbError));
    }
  }
);

// Get workflow with caching
app.get('/api/workflows/:workflowId',
  enhancedAuthMiddleware.authenticate(),
  cacheMiddleware.cache({ namespace: 'workflow-details' }),
  async (req, res) => {
    try {
      const { workflowId } = req.params;
      const workflow = await workflowCacheService.getWorkflow(workflowId, req.user.id);

      if (!workflow) {
        return res.status(404).json({
          success: false,
          message: 'Workflow not found',
          code: 'WORKFLOW_NOT_FOUND'
        });
      }

      // Check permissions
      if (workflow.created_by !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Access denied',
          code: 'ACCESS_DENIED'
        });
      }

      res.json({
        success: true,
        data: workflow,
        timestamp: new Date().toISOString(),
        cached: req.cacheHit || false
      });
    } catch (error) {
      const dbError = defaultErrorHandler.handleError(error, {
        operation: 'get_workflow'
      });

      res.status(500).json(defaultErrorHandler.createErrorResponse(dbError));
    }
  }
);

// Workflow statistics with caching
app.get('/api/workflows/stats',
  enhancedAuthMiddleware.authenticate(),
  cacheMiddleware.cache({ namespace: 'workflow-stats' }),
  async (req, res) => {
    try {
      const timeframe = req.query.timeframe || '24h';
      const stats = await workflowCacheService.getWorkflowStats(timeframe);

      res.json({
        success: true,
        data: stats,
        timestamp: new Date().toISOString(),
        cached: req.cacheHit || false
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
);

// Cache management endpoints (admin only)
app.post('/admin/cache/clear',
  enhancedAuthMiddleware.authenticate(),
  enhancedAuthMiddleware.authorize(['admin']),
  async (req, res) => {
    try {
      const { namespace } = req.body;
      const cleared = await cacheService.clear(namespace);

      res.json({
        success: true,
        message: `Cleared ${cleared} cache entries`,
        cleared,
        namespace: namespace || 'all',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
);

app.post('/admin/cache/warm',
  enhancedAuthMiddleware.authenticate(),
  enhancedAuthMiddleware.authorize(['admin']),
  async (req, res) => {
    try {
      const results = await cacheWarmingService.performStartupWarming();

      res.json({
        success: true,
        message: 'Cache warming completed',
        results,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
);

// Cache invalidation endpoint (admin only)
app.post('/admin/cache/invalidate',
  enhancedAuthMiddleware.authenticate(),
  enhancedAuthMiddleware.authorize(['admin']),
  async (req, res) => {
    try {
      const { event, data } = req.body;
      const result = await cacheInvalidationService.invalidate(event, data);

      res.json({
        success: true,
        message: 'Cache invalidation completed',
        result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
);

// WebSocket server with enhanced features
const wss = new WebSocketServer({ server });
const clients = new Map();

wss.on('connection', (ws, req) => {
  const sessionId = crypto.randomUUID();
  const clientInfo = {
    id: sessionId,
    ws,
    connectedAt: new Date(),
    ip: req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    userId: null,
    authenticated: false
  };

  clients.set(sessionId, clientInfo);

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      // Handle authentication
      if (data.type === 'auth') {
        try {
          const token = data.token;
          const validation = await sessionCacheService.validateJWT(token, 'access');

          if (validation.valid && validation.session) {
            clientInfo.userId = validation.userId;
            clientInfo.authenticated = true;

            ws.send(JSON.stringify({
              type: 'auth_success',
              sessionId,
              userId: validation.userId
            }));

            // Cache user session for WebSocket
            await cacheService.set('websocket-sessions', sessionId, {
              userId: validation.userId,
              connectedAt: clientInfo.connectedAt,
              ip: clientInfo.ip
            }, 3600);
          } else {
            ws.send(JSON.stringify({
              type: 'auth_error',
              message: 'Invalid token'
            }));
          }
        } catch (error) {
          ws.send(JSON.stringify({
            type: 'auth_error',
            message: 'Authentication failed'
          }));
        }
      }

      // Echo for other messages
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
    clients.delete(sessionId);

    // Clean up cache
    cacheService.delete('websocket-sessions', sessionId).catch(() => {});
  });

  ws.send(JSON.stringify({
    type: 'connected',
    sessionId,
    message: 'Connected to GUI-LOP Enhanced WebSocket with Redis Caching'
  }));
});

// Enhanced notification system with cache
function notifyClients(message) {
  const messageStr = JSON.stringify(message);

  clients.forEach(clientInfo => {
    const { ws, id } = clientInfo;
    if (ws.readyState === ws.OPEN) {
      ws.send(messageStr);
    }
  });

  // Cache notification for debugging
  cacheService.set('notifications', `notification-${Date.now()}`, {
    message,
    timestamp: new Date().toISOString(),
    clientCount: clients.size
  }, 300);
}

// Enhanced error handling with cache consideration
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);

  // Check if it's a cache-related error
  if (cacheHealthMiddleware.isCacheError(error)) {
    console.warn('⚠️ Cache error in request handler:', error.message);
    // Continue without cache
    req.cacheEnabled = false;
    return next();
  }

  const isDevelopment = process.env.NODE_ENV === 'development';

  res.status(error.status || 500).json({
    success: false,
    message: isDevelopment ? error.message : 'Internal server error',
    code: 'INTERNAL_ERROR',
    ...(isDevelopment && { stack: error.stack })
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

// Enhanced server initialization
async function startEnhancedServer() {
  try {
    console.log('🚀 Starting GUI-LOP Enhanced Server with Redis Caching...');

    // Initialize database
    console.log('🔄 Initializing database connection...');
    await db.initialize();
    console.log('✅ Database connected successfully');

    // Initialize Redis caching layer
    if (process.env.ENABLE_REDIS_CACHING !== 'false') {
      console.log('🔄 Initializing Redis caching layer...');

      await redisConfig.initialize();
      await cacheService.initialize();
      await workflowCacheService.initialize();
      await sessionCacheService.initialize();
      await cacheInvalidationService.initialize();
      await cacheWarmingService.initialize();
      await cacheMonitoringService.initialize();
      await enhancedAuthMiddleware.initializeServices();

      console.log('✅ Redis caching layer initialized successfully');
    } else {
      console.log('⚠️ Redis caching disabled');
    }

    // Start server
    server.listen(PORT, () => {
      console.log(`🌐 GUI-LOP Enhanced Server running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`💾 Cache metrics: http://localhost:${PORT}/cache/metrics`);
      console.log(`🔥 Cache stats: http://localhost:${PORT}/cache/stats`);

      if (process.env.ENABLE_REDIS_CACHING !== 'false') {
        console.log('✨ Redis caching features enabled:');
        console.log('  - Workflow template caching');
        console.log('  - User session management');
        console.log('  - API response caching');
        console.log('  - Intelligent cache invalidation');
        console.log('  - Predictive cache warming');
        console.log('  - Real-time cache monitoring');
        console.log('  - Health checks and fallbacks');
      }
    });

  } catch (error) {
    console.error('❌ Failed to start enhanced server:', error);
    process.exit(1);
  }
}

// Enhanced graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🔄 SIGTERM received, shutting down gracefully...');

  try {
    // Close WebSocket server
    wss.close();

    // Close cache services
    if (process.env.ENABLE_REDIS_CACHING !== 'false') {
      await cacheMonitoringService.close();
      await cacheWarmingService.close();
      await cacheInvalidationService.close();
      await sessionCacheService.close();
      await workflowCacheService.close();
      await cacheService.close();
      await redisConfig.close();
    }

    // Close database connections
    await db.close();

    // Close HTTP server
    server.close(() => {
      console.log('✅ Enhanced server shut down gracefully');
      process.exit(0);
    });
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  console.log('🔄 SIGINT received, shutting down gracefully...');

  try {
    // Close WebSocket server
    wss.close();

    // Close cache services
    if (process.env.ENABLE_REDIS_CACHING !== 'false') {
      await cacheMonitoringService.close();
      await cacheWarmingService.close();
      await cacheInvalidationService.close();
      await sessionCacheService.close();
      await workflowCacheService.close();
      await cacheService.close();
      await redisConfig.close();
    }

    // Close database connections
    await db.close();

    // Close HTTP server
    server.close(() => {
      console.log('✅ Enhanced server shut down gracefully');
      process.exit(0);
    });
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

// Start the enhanced server
startEnhancedServer();

export default app;