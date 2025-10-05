/**
 * Health Check Routes
 * Provides health status and system information
 */

import express from 'express';
import { DatabaseService } from '../services/database.js';
import { getWebSocketService } from '../services/websocketService.js';

const router = express.Router();
const dbService = new DatabaseService();

/**
 * GET /health
 * Basic health check
 */
router.get('/', async (req, res) => {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      memory: process.memoryUsage(),
      services: {
        database: 'unknown',
        websocket: 'unknown',
      },
    };

    // Check database connectivity
    try {
      await dbService.query('SELECT 1');
      health.services.database = 'healthy';
    } catch (dbError) {
      health.services.database = 'unhealthy';
      health.status = 'degraded';
    }

    // Check WebSocket service
    try {
      const wsService = getWebSocketService();
      const stats = wsService.getConnectionStats();
      health.services.websocket = 'healthy';
      health.websocket_connections = stats;
    } catch (wsError) {
      health.services.websocket = 'unhealthy';
      health.status = 'degraded';
    }

    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);

  } catch (error) {
    console.error('Health check error:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message,
    });
  }
});

/**
 * GET /health/detailed
 * Detailed health check with system metrics
 */
router.get('/detailed', async (req, res) => {
  try {
    const detailed = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',

      // System information
      system: {
        platform: process.platform,
        arch: process.arch,
        node_version: process.version,
        pid: process.pid,
      },

      // Memory usage
      memory: {
        rss: process.memoryUsage().rss,
        heap_total: process.memoryUsage().heapTotal,
        heap_used: process.memoryUsage().heapUsed,
        external: process.memoryUsage().external,
        array_buffers: process.memoryUsage().arrayBuffers,
      },

      // CPU usage
      cpu: {
        usage: process.cpuUsage(),
      },

      // Service status
      services: {
        database: 'unknown',
        websocket: 'unknown',
      },
    };

    // Database health check with metrics
    try {
      const dbStart = Date.now();
      await dbService.query('SELECT 1');
      const dbResponseTime = Date.now() - dbStart;

      detailed.services.database = {
        status: 'healthy',
        response_time_ms: dbResponseTime,
      };

      // Get database statistics
      const dbStats = await dbService.getDatabaseStats();
      detailed.database_stats = dbStats;

    } catch (dbError) {
      detailed.services.database = {
        status: 'unhealthy',
        error: dbError.message,
      };
      detailed.status = 'degraded';
    }

    // WebSocket service health check
    try {
      const wsService = getWebSocketService();
      const wsStats = wsService.getConnectionStats();

      detailed.services.websocket = {
        status: 'healthy',
        stats: wsStats,
      };

    } catch (wsError) {
      detailed.services.websocket = {
        status: 'unhealthy',
        error: wsError.message,
      };
      detailed.status = 'degraded';
    }

    // Environment variables (sanitized)
    detailed.environment_vars = {
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT,
      DB_HOST: process.env.DB_HOST ? 'configured' : 'not_set',
      JWT_SECRET: process.env.JWT_SECRET ? 'configured' : 'not_set',
    };

    const statusCode = detailed.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(detailed);

  } catch (error) {
    console.error('Detailed health check error:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message,
    });
  }
});

/**
 * GET /health/readiness
 * Readiness probe for Kubernetes/container orchestration
 */
router.get('/readiness', async (req, res) => {
  try {
    // Check if all critical services are ready
    const checks = {
      database: false,
      websocket: false,
    };

    // Database connectivity check
    try {
      await dbService.query('SELECT 1');
      checks.database = true;
    } catch (error) {
      console.error('Database readiness check failed:', error);
    }

    // WebSocket service check
    try {
      const wsService = getWebSocketService();
      checks.websocket = wsService.wsServer !== null;
    } catch (error) {
      console.error('WebSocket readiness check failed:', error);
    }

    const allReady = Object.values(checks).every(check => check === true);
    const statusCode = allReady ? 200 : 503;

    res.status(statusCode).json({
      ready: allReady,
      checks,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Readiness check error:', error);
    res.status(503).json({
      ready: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /health/liveness
 * Liveness probe for Kubernetes/container orchestration
 */
router.get('/liveness', (req, res) => {
  try {
    // Basic liveness check - if we can respond, we're alive
    res.status(200).json({
      alive: true,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  } catch (error) {
    console.error('Liveness check error:', error);
    res.status(503).json({
      alive: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /health/metrics
 * Application metrics for monitoring
 */
router.get('/metrics', async (req, res) => {
  try {
    const metrics = {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),

      // Memory metrics
      memory: {
        rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heap_total_mb: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        heap_used_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        heap_usage_percent: Math.round((process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100),
      },

      // Process metrics
      process: {
        cpu_usage_user: process.cpuUsage().user,
        cpu_usage_system: process.cpuUsage().system,
        pid: process.pid,
        uptime_seconds: process.uptime(),
      },
    };

    // Database metrics
    try {
      const dbStats = await dbService.getDatabaseStats();
      metrics.database = dbStats;
    } catch (error) {
      metrics.database = { error: error.message };
    }

    // WebSocket metrics
    try {
      const wsService = getWebSocketService();
      const wsStats = wsService.getConnectionStats();
      metrics.websocket = wsStats;
    } catch (error) {
      metrics.websocket = { error: error.message };
    }

    res.json(metrics);

  } catch (error) {
    console.error('Metrics error:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;