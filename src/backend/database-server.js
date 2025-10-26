/**
 * GUI-LOP Database-Integrated Server
 * Enhanced server with PostgreSQL database integration replacing in-memory Maps
 * Week 3, Phase 1 - Database Integration
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

// Import database components
import { db, dbHelpers } from '../database/config/database.js';
import defaultErrorHandler, { createErrorMiddleware } from '../database/utils/error-handler.js';
import { TransactionManager } from '../database/utils/transaction-manager.js';

// Load environment variables
dotenv.config();

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3001;

// Initialize database components
const transactionManager = new TransactionManager(db.pool);

// Middleware
app.use(cors());
app.use(express.json());

// Database health check middleware
app.use('/api/*', async (req, res, next) => {
  try {
    const health = await db.healthCheck();
    if (health.status === 'unhealthy') {
      return res.status(503).json({
        error: 'Database unavailable',
        status: health.status,
        timestamp: health.timestamp
      });
    }
    req.dbHealth = health;
    next();
  } catch (error) {
    return res.status(503).json({
      error: 'Database health check failed',
      message: error.message
    });
  }
});

// Enhanced health check endpoint
app.get('/health', async (req, res) => {
  try {
    const dbHealth = await db.healthCheck();
    const poolStats = db.getPoolStats();

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      message: 'GUI-LOP Server is running with database integration',
      database: dbHealth,
      connectionPool: poolStats,
      version: '1.0.0-database'
    });
  } catch (error) {
    res.status(503).json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      message: 'GUI-LOP Server running, database unavailable',
      error: error.message
    });
  }
});

// Workflow templates from database
app.get('/api/workflows/templates', async (req, res) => {
  try {
    const templates = await db.query(`
      SELECT
        id,
        name,
        description,
        template_key,
        steps,
        default_config,
        created_at,
        updated_at
      FROM workflow_templates
      WHERE is_active = true
      ORDER BY name
    `);

    res.json({
      templates: templates.rows,
      count: templates.rows.length
    });
  } catch (error) {
    const dbError = defaultErrorHandler.handleError(error, {
      operation: 'get_workflow_templates',
      table: 'workflow_templates'
    });

    res.status(500).json(defaultErrorHandler.createErrorResponse(dbError));
  }
});

// Create new workflow with database persistence
app.post('/api/workflows', async (req, res) => {
  const { template, template_id, context } = req.body;

  try {
    // Validate template exists
    let templateData;
    if (template_id) {
      templateData = await dbHelpers.findById('workflow_templates', template_id);
    } else if (template) {
      const result = await db.query(
        'SELECT * FROM workflow_templates WHERE template_key = $1 AND is_active = true',
        [template]
      );
      templateData = result.rows[0];
    }

    if (!templateData) {
      return res.status(400).json({
        error: 'Invalid template',
        message: 'Template not found or inactive'
      });
    }

    // Create workflow in database
    const workflowData = {
      template_id: templateData.id,
      template_key: templateData.template_key,
      title: context?.title || templateData.name,
      description: context?.description || templateData.description,
      status: 'created',
      context: context || {},
      config: templateData.default_config,
      created_by: null // TODO: Add authentication
    };

    const workflow = await dbHelpers.insert('workflows', workflowData);

    // Create workflow steps
    const steps = templateData.steps.map((step, index) => ({
      workflow_id: workflow.id,
      step_name: step.name,
      step_order: index + 1,
      status: 'created',
      input_data: {},
      output_data: {},
      metadata: { step_type: step.type, required: step.required }
    }));

    for (const stepData of steps) {
      await dbHelpers.insert('workflow_steps', stepData);
    }

    // Log event
    await dbHelpers.insert('events', {
      event_type: 'workflow_created',
      workflow_id: workflow.id,
      event_data: {
        template_key: templateData.template_key,
        context: context
      }
    });

    res.json({
      workflow_id: workflow.id,
      status: 'created',
      message: 'Workflow created successfully',
      template: templateData.template_key
    });

  } catch (error) {
    const dbError = defaultErrorHandler.handleError(error, {
      operation: 'create_workflow',
      table: 'workflows'
    });

    res.status(500).json(defaultErrorHandler.createErrorResponse(dbError));
  }
});

// Execute workflow with database integration
app.post('/api/workflows/:workflowId/execute', async (req, res) => {
  const { workflowId } = req.params;

  try {
    return await transactionManager.inTransaction(async (tx) => {
      // Get workflow with steps
      const workflowResult = await tx.query(
        'SELECT * FROM workflows WHERE id = $1',
        [workflowId]
      );

      if (workflowResult.rows.length === 0) {
        return res.status(404).json({ error: 'Workflow not found' });
      }

      const workflow = workflowResult.rows[0];

      // Update workflow status
      await tx.query(
        'UPDATE workflows SET status = $1, started_at = NOW() WHERE id = $2',
        ['running', workflowId]
      );

      // Get workflow steps
      const stepsResult = await tx.query(
        'SELECT * FROM workflow_steps WHERE workflow_id = $1 ORDER BY step_order',
        [workflowId]
      );

      // Update first step to running
      if (stepsResult.rows.length > 0) {
        await tx.query(
          'UPDATE workflow_steps SET status = $1, started_at = NOW() WHERE id = $2',
          ['running', stepsResult.rows[0].id]
        );
      }

      // Log execution start event
      await tx.query(
        'INSERT INTO events (event_type, workflow_id, event_data) VALUES ($1, $2, $3)',
        ['workflow_started', workflowId, { started_at: new Date().toISOString() }]
      );

      // Simulate workflow execution with UI generation
      setTimeout(async () => {
        try {
          const uiUrl = `http://localhost:8501/${workflowId}`;
          const uiComponents = ['dashboard', 'approval_form'];

          // Update workflow with UI information
          await db.query(
            'UPDATE workflows SET status = $1, ui_url = $2, ui_components = $3 WHERE id = $4',
            ['waiting_for_human', uiUrl, uiComponents, workflowId]
          );

          // Log UI generation event
          await db.query(
            'INSERT INTO events (event_type, workflow_id, event_data) VALUES ($1, $2, $3)',
            ['ui_generated', workflowId, { ui_url: uiUrl, components: uiComponents }]
          );

          // Notify WebSocket clients
          notifyClients({
            type: 'ui_generation',
            workflow_id: workflowId,
            payload: {
              ui_url: uiUrl,
              components: uiComponents,
              message: 'Interactive dashboard is ready for your review'
            }
          });

        } catch (error) {
          console.error('Error in workflow execution:', error);

          // Update workflow status to failed
          await db.query(
            'UPDATE workflows SET status = $1 WHERE id = $2',
            ['failed', workflowId]
          );
        }
      }, 2000);

      res.json({
        workflow_id: workflowId,
        status: 'executing',
        message: 'Workflow execution started',
        steps_count: stepsResult.rows.length
      });
    });

  } catch (error) {
    const dbError = defaultErrorHandler.handleError(error, {
      operation: 'execute_workflow',
      table: 'workflows'
    });

    res.status(500).json(defaultErrorHandler.createErrorResponse(dbError));
  }
});

// Get workflow status with database integration
app.get('/api/workflows/:workflowId', async (req, res) => {
  const { workflowId } = req.params;

  try {
    // Get workflow with related data
    const result = await db.query(`
      SELECT
        w.*,
        t.name as template_name,
        t.description as template_description,
        u.username as created_by_username,
        u.full_name as created_by_full_name
      FROM workflows w
      LEFT JOIN workflow_templates t ON w.template_id = t.id
      LEFT JOIN users u ON w.created_by = u.id
      WHERE w.id = $1
    `, [workflowId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    const workflow = result.rows[0];

    // Get workflow steps
    const stepsResult = await db.query(
      'SELECT * FROM workflow_steps WHERE workflow_id = $1 ORDER BY step_order',
      [workflowId]
    );

    // Get recent events
    const eventsResult = await db.query(
      'SELECT * FROM events WHERE workflow_id = $1 ORDER BY created_at DESC LIMIT 10',
      [workflowId]
    );

    // Calculate duration if running
    if (workflow.started_at) {
      const startTime = new Date(workflow.started_at);
      const currentTime = new Date();
      workflow.duration = Math.floor((currentTime - startTime) / 1000); // seconds
    }

    res.json({
      ...workflow,
      steps: stepsResult.rows,
      recent_events: eventsResult.rows,
      steps_count: stepsResult.rows.length
    });

  } catch (error) {
    const dbError = defaultErrorHandler.handleError(error, {
      operation: 'get_workflow',
      table: 'workflows'
    });

    res.status(500).json(defaultErrorHandler.createErrorResponse(dbError));
  }
});

// Handle human response with database persistence
app.post('/api/workflows/:workflowId/respond', async (req, res) => {
  const { workflowId } = req.params;
  const { action, data, confidence_score, reasoning } = req.body;

  try {
    return await transactionManager.inTransaction(async (tx) => {
      // Get workflow
      const workflowResult = await tx.query(
        'SELECT * FROM workflows WHERE id = $1',
        [workflowId]
      );

      if (workflowResult.rows.length === 0) {
        return res.status(404).json({ error: 'Workflow not found' });
      }

      const workflow = workflowResult.rows[0];

      // Update workflow status
      await tx.query(
        'UPDATE workflows SET status = $1, completed_at = NOW() WHERE id = $2',
        ['completed', workflowId]
      );

      // Get current running step
      const stepResult = await tx.query(
        'SELECT * FROM workflow_steps WHERE workflow_id = $1 AND status = $2 ORDER BY step_order DESC LIMIT 1',
        [workflowId, 'running']
      );

      let stepId = null;
      if (stepResult.rows.length > 0) {
        // Update step status
        await tx.query(
          'UPDATE workflow_steps SET status = $1, completed_at = NOW(), output_data = $2 WHERE id = $3',
          ['completed', JSON.stringify({ action, data }), stepResult.rows[0].id]
        );
        stepId = stepResult.rows[0].id;
      }

      // Store human response
      await tx.query(
        'INSERT INTO human_responses (workflow_id, step_id, action, response_data, confidence_score, reasoning) VALUES ($1, $2, $3, $4, $5, $6)',
        [workflowId, stepId, action, JSON.stringify(data), confidence_score, reasoning]
      );

      // Log human response event
      await tx.query(
        'INSERT INTO events (event_type, workflow_id, event_data) VALUES ($1, $2, $3)',
        ['human_response', workflowId, { action, confidence_score, data }]
      );

      // Log workflow completion event
      await tx.query(
        'INSERT INTO events (event_type, workflow_id, event_data) VALUES ($1, $2, $3)',
        ['workflow_completed', workflowId, { completed_at: new Date().toISOString() }]
      );

      // Notify WebSocket clients
      notifyClients({
        type: 'workflow_completed',
        workflow_id: workflowId,
        payload: {
          message: 'Workflow completed successfully',
          result: data,
          action,
          confidence_score
        }
      });

      res.json({
        workflow_id: workflowId,
        status: 'completed',
        message: 'Human response received and workflow completed',
        action,
        confidence_score
      });
    });

  } catch (error) {
    const dbError = defaultErrorHandler.handleError(error, {
      operation: 'handle_human_response',
      table: 'human_responses'
    });

    res.status(500).json(defaultErrorHandler.createErrorResponse(dbError));
  }
});

// New endpoints for database features

// List workflows with pagination and filtering
app.get('/api/workflows', async (req, res) => {
  try {
    const { page = 1, limit = 20, status, template_key } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = '';
    const params = [];
    let paramIndex = 1;

    if (status) {
      whereClause += ` WHERE w.status = $${paramIndex++}`;
      params.push(status);
    }

    if (template_key) {
      whereClause += whereClause ? ` AND w.template_key = $${paramIndex++}` : ` WHERE w.template_key = $${paramIndex++}`;
      params.push(template_key);
    }

    const query = `
      SELECT
        w.*,
        t.name as template_name,
        u.username as created_by_username
      FROM workflows w
      LEFT JOIN workflow_templates t ON w.template_id = t.id
      LEFT JOIN users u ON w.created_by = u.id
      ${whereClause}
      ORDER BY w.created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `;

    params.push(limit, offset);

    const result = await db.query(query, params);

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM workflows w ${whereClause}`;
    const countResult = await db.query(countQuery, params.slice(0, -2));

    res.json({
      workflows: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].total),
        pages: Math.ceil(countResult.rows[0].total / limit)
      }
    });

  } catch (error) {
    const dbError = defaultErrorHandler.handleError(error, {
      operation: 'list_workflows',
      table: 'workflows'
    });

    res.status(500).json(defaultErrorHandler.createErrorResponse(dbError));
  }
});

// Database statistics endpoint
app.get('/api/database/stats', async (req, res) => {
  try {
    const stats = {};

    // Get table counts
    const tables = ['users', 'workflows', 'workflow_templates', 'events', 'human_responses'];

    for (const table of tables) {
      try {
        const result = await db.query(`SELECT COUNT(*) as count FROM ${table}`);
        stats[table] = parseInt(result.rows[0].count);
      } catch (error) {
        stats[table] = 0;
      }
    }

    // Get workflow status breakdown
    const statusResult = await db.query(`
      SELECT status, COUNT(*) as count
      FROM workflows
      GROUP BY status
    `);
    stats.workflow_status_breakdown = statusResult.rows;

    // Get database health
    stats.health = await db.healthCheck();
    stats.pool = db.getPoolStats();

    res.json(stats);

  } catch (error) {
    const dbError = defaultErrorHandler.handleError(error, {
      operation: 'get_database_stats'
    });

    res.status(500).json(defaultErrorHandler.createErrorResponse(dbError));
  }
});

// WebSocket server for real-time communication (enhanced with database)
const wss = new WebSocketServer({ server });
const clients = new Map(); // Use Map instead of Set for better management

wss.on('connection', (ws, req) => {
  const sessionId = uuidv4();
  const clientInfo = {
    id: sessionId,
    ws,
    connectedAt: new Date(),
    ip: req.socket.remoteAddress,
    userAgent: req.headers['user-agent']
  };

  clients.set(sessionId, clientInfo);

  // Store session in database
  dbHelpers.insert('user_sessions', {
    session_id: sessionId,
    websocket_id: sessionId,
    ip_address: req.socket.remoteAddress,
    user_agent: req.headers['user-agent'],
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
  }).catch(error => {
    console.error('Failed to store session:', error);
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      // Log WebSocket message
      dbHelpers.insert('events', {
        event_type: 'websocket_message',
        session_id: sessionId,
        event_data: { type: data.type, timestamp: new Date().toISOString() }
      }).catch(() => {}); // Ignore errors for non-critical logging

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

    // Update session in database
    db.query(
      'UPDATE user_sessions SET is_active = false WHERE session_id = $1',
      [sessionId]
    ).catch(() => {}); // Ignore errors for non-critical updates
  });

  ws.send(JSON.stringify({
    type: 'connected',
    session_id: sessionId,
    message: 'Connected to GUI-LOP WebSocket with database integration'
  }));
});

function notifyClients(message) {
  const messageStr = JSON.stringify(message);

  clients.forEach(clientInfo => {
    const { ws, id } = clientInfo;
    if (ws.readyState === ws.OPEN) {
      ws.send(messageStr);
    }
  });

  // Log notification
  dbHelpers.insert('events', {
    event_type: 'websocket_notification',
    event_data: message
  }).catch(() => {}); // Ignore errors for non-critical logging
}

// Error handling middleware
app.use(createErrorMiddleware(defaultErrorHandler));

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} not found`,
    timestamp: new Date().toISOString()
  });
});

// Initialize database and start server
async function startServer() {
  try {
    console.log('🔄 Initializing database connection...');
    await db.initialize();
    console.log('✅ Database connected successfully');

    console.log('🚀 Starting GUI-LOP server with database integration...');
    server.listen(PORT, () => {
      console.log(`🌐 GUI-LOP Database Server running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`📈 Database stats: http://localhost:${PORT}/api/database/stats`);
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🔄 SIGTERM received, shutting down gracefully...');

  // Close WebSocket server
  wss.close();

  // Close database connections
  await db.close();

  // Close HTTP server
  server.close(() => {
    console.log('✅ Server shut down gracefully');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('🔄 SIGINT received, shutting down gracefully...');

  // Close WebSocket server
  wss.close();

  // Close database connections
  await db.close();

  // Close HTTP server
  server.close(() => {
    console.log('✅ Server shut down gracefully');
    process.exit(0);
  });
});

// Start the server
startServer();

export default app;