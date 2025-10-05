/**
 * GUI-LOP Backend Server
 * Main Express server with WebSocket support for AG-UI protocol
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Import routes
import eventsRouter from './routes/events.js';
import workflowsRouter from './routes/workflows.js';
import healthRouter from './routes/health.js';

// Import middleware
import { errorHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { validateSession } from './middleware/auth.js';

// Import services
import { initializeWebSocketService } from './services/websocketService.js';
import { AGUIProtocolService } from './services/agui-protocol.js';
import { DatabaseService } from './services/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class GUILoPServer {
  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    this.wsServer = null;
    this.dbService = null;
    this.aguiService = null;
    this.port = process.env.PORT || 3001;

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  setupMiddleware() {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "blob:"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'", "ws:", "wss:"],
        },
      },
    }));

    // CORS configuration
    this.app.use(cors({
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-ID'],
    }));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 1000, // Limit each IP to 1000 requests per windowMs
      message: {
        error: 'Too many requests from this IP, please try again later.',
      },
      standardHeaders: true,
      legacyHeaders: false,
    });
    this.app.use(limiter);

    // Body parsing
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    // Request logging
    this.app.use(requestLogger);

    // Session validation for protected routes
    this.app.use('/api', validateSession);
  }

  setupRoutes() {
    // Health check
    this.app.use('/health', healthRouter);

    // API routes
    this.app.use('/api/events', eventsRouter);
    this.app.use('/api/workflows', workflowsRouter);

    // Serve static files for generated UIs
    this.app.use('/generated-ui', express.static(join(__dirname, '../generated-ui')));

    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        name: 'GUI-LOP Backend',
        version: '1.0.0',
        status: 'running',
        timestamp: new Date().toISOString(),
        endpoints: {
          health: '/health',
          events: '/api/events',
          workflows: '/api/workflows',
          websocket: 'ws://localhost:' + this.port,
        },
      });
    });

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Endpoint not found',
        path: req.originalUrl,
        method: req.method,
      });
    });
  }

  setupErrorHandling() {
    this.app.use(errorHandler);

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      this.gracefulShutdown('SIGTERM');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });

    // Handle shutdown signals
    process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
  }

  async initializeWebSocket() {
    this.wsServer = new WebSocketServer({
      server: this.server,
      path: '/ws',
    });

    await initializeWebSocketService(this.wsServer, this.aguiService);

    console.log('WebSocket server initialized on ws://localhost:' + this.port + '/ws');
  }

  async initializeServices() {
    try {
      // Initialize database service
      this.dbService = new DatabaseService();
      await this.dbService.connect();
      console.log('Database service initialized');

      // Initialize AG-UI protocol service
      this.aguiService = new AGUIProtocolService(this.dbService);
      await this.aguiService.initialize();
      console.log('AG-UI protocol service initialized');

      // Initialize WebSocket service
      await this.initializeWebSocket();

    } catch (error) {
      console.error('Failed to initialize services:', error);
      throw error;
    }
  }

  async start() {
    try {
      await this.initializeServices();

      this.server.listen(this.port, () => {
        console.log(`🚀 GUI-LOP Backend Server running on port ${this.port}`);
        console.log(`📊 Health: http://localhost:${this.port}/health`);
        console.log(`🔌 WebSocket: ws://localhost:${this.port}/ws`);
        console.log(`📡 Events API: http://localhost:${this.port}/api/events`);
        console.log(`⚡ Workflows API: http://localhost:${this.port}/api/workflows`);
      });

    } catch (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
  }

  async gracefulShutdown(signal) {
    console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);

    try {
      // Close HTTP server
      if (this.server) {
        this.server.close();
      }

      // Close WebSocket server
      if (this.wsServer) {
        this.wsServer.close();
      }

      // Close database connections
      if (this.dbService) {
        await this.dbService.disconnect();
      }

      console.log('✅ Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during graceful shutdown:', error);
      process.exit(1);
    }
  }
}

// Start server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new GUILoPServer();
  server.start().catch(console.error);
}

export default GUILoPServer;