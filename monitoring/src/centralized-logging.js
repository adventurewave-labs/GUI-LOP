/**
 * Centralized Logging System for GUI-LOP Platform
 * Implements structured logging with ELK stack integration
 */

import winston from 'winston';
import { ElasticsearchTransport } from 'winston-elasticsearch';
import { createClient } from '@elastic/elasticsearch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class CentralizedLogger {
  constructor(config = {}) {
    this.config = {
      level: config.level || 'info',
      environment: config.environment || process.env.NODE_ENV || 'production',
      serviceName: config.serviceName || 'gui-lop-platform',
      version: config.version || process.env.APP_VERSION || '1.0.0',
      cluster: config.cluster || process.env.CLUSTER_NAME || 'gui-lop',
      datacenter: config.datacenter || process.env.DATACENTER || 'default',
      elasticsearch: {
        url: config.elasticsearch?.url || process.env.ELASTICSEARCH_URL || 'https://localhost:9200',
        username: config.elasticsearch?.username || process.env.ELASTICSEARCH_USERNAME || 'elastic',
        password: config.elasticsearch?.password || process.env.ELASTICSEARCH_PASSWORD || '',
        caCert: config.elasticsearch?.caCert || '/etc/ssl/certs/ca.crt',
        indexPrefix: config.elasticsearch?.indexPrefix || 'gui-lop-logs'
      },
      logstash: {
        enabled: config.logstash?.enabled !== false,
        host: config.logstash?.host || process.env.LOGSTASH_HOST || 'localhost',
        port: config.logstash?.port || 5044,
        ssl: config.logstash?.ssl !== false
      },
      file: {
        enabled: config.file?.enabled !== false,
        logDir: config.file?.logDir || './logs',
        maxSize: config.file?.maxSize || '100m',
        maxFiles: config.file?.maxFiles || 10,
        datePattern: config.file?.datePattern || 'YYYY-MM-DD'
      },
      console: {
        enabled: config.console?.enabled !== false,
        colorize: config.console?.colorize !== false
      }
    };

    this.elasticsearchClient = null;
    this.logger = null;
    this.initialized = false;

    this.initialize();
  }

  async initialize() {
    try {
      // Create log directory if it doesn't exist
      if (this.config.file.enabled && !fs.existsSync(this.config.file.logDir)) {
        fs.mkdirSync(this.config.file.logDir, { recursive: true });
      }

      // Initialize Elasticsearch client
      await this.initializeElasticsearchClient();

      // Create winston logger with custom format
      this.logger = winston.createLogger({
        level: this.config.level,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.errors({ stack: true }),
          winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp'] }),
          winston.format.json(),
          this.createCustomFormat()
        ),
        defaultMeta: this.getDefaultMetadata(),
        transports: this.createTransports(),
        exitOnError: false
      });

      // Add exception handling
      this.handleExceptions();

      // Add request logging middleware
      this.setupRequestLogging();

      this.initialized = true;
      this.info('Centralized logging system initialized', {
        serviceName: this.config.serviceName,
        environment: this.config.environment
      });

    } catch (error) {
      console.error('Failed to initialize centralized logging system:', error);
      throw error;
    }
  }

  async initializeElasticsearchClient() {
    try {
      const esConfig = {
        node: this.config.elasticsearch.url,
        auth: {
          username: this.config.elasticsearch.username,
          password: this.config.elasticsearch.password
        },
        tls: {
          ca: fs.existsSync(this.config.elasticsearch.caCert)
            ? fs.readFileSync(this.config.elasticsearch.caCert)
            : undefined,
          rejectUnauthorized: true
        },
        maxRetries: 3,
        requestTimeout: 30000,
        sniffOnStart: true
      };

      this.elasticsearchClient = createClient(esConfig);

      // Test connection
      await this.elasticsearchClient.ping();
      this.info('Elasticsearch client initialized successfully');

    } catch (error) {
      this.warn('Failed to initialize Elasticsearch client', { error: error.message });
      // Continue without Elasticsearch if connection fails
    }
  }

  getDefaultMetadata() {
    return {
      service: this.config.serviceName,
      version: this.config.version,
      environment: this.config.environment,
      cluster: this.config.cluster,
      datacenter: this.config.datacenter,
      hostname: process.env.HOSTNAME || 'unknown',
      pid: process.pid,
      platform: process.platform,
      nodeVersion: process.version
    };
  }

  createCustomFormat() {
    return winston.format.printf(({ timestamp, level, message, metadata, ...rest }) => {
      const logEntry = {
        timestamp,
        level,
        message,
        ...metadata,
        ...rest
      };

      // Add structured fields for specific log types
      if (metadata.error) {
        logEntry.error = {
          name: metadata.error.name,
          message: metadata.error.message,
          stack: metadata.error.stack
        };
      }

      if (metadata.request) {
        logEntry.request = {
          method: metadata.request.method,
          url: metadata.request.url,
          headers: this.sanitizeHeaders(metadata.request.headers),
          userAgent: metadata.request.headers['user-agent'],
          ip: metadata.request.ip || metadata.request.connection?.remoteAddress
        };
      }

      if (metadata.response) {
        logEntry.response = {
          statusCode: metadata.response.statusCode,
          responseTime: metadata.response.responseTime,
          contentLength: metadata.response.contentLength
        };
      }

      if (metadata.user) {
        logEntry.user = {
          id: metadata.user.id,
          email: metadata.user.email,
          roles: metadata.user.roles
        };
      }

      if (metadata.performance) {
        logEntry.performance = {
          memoryUsage: metadata.performance.memoryUsage,
          cpuUsage: metadata.performance.cpuUsage,
          eventLoopLag: metadata.performance.eventLoopLag
        };
      }

      return JSON.stringify(logEntry);
    });
  }

  createTransports() {
    const transports = [];

    // Console transport for development
    if (this.config.console.enabled) {
      transports.push(
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple(),
            winston.format.printf(({ timestamp, level, message, ...rest }) => {
              return `${timestamp} [${level}]: ${message} ${
                Object.keys(rest).length ? JSON.stringify(rest, null, 2) : ''
              }`;
            })
          )
        })
      );
    }

    // File transports for persistence
    if (this.config.file.enabled) {
      // Application logs
      transports.push(
        new winston.transports.File({
          filename: path.join(this.config.file.logDir, 'application.log'),
          level: 'info',
          maxsize: this.parseSize(this.config.file.maxSize),
          maxFiles: this.config.file.maxFiles,
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          )
        })
      );

      // Error logs
      transports.push(
        new winston.transports.File({
          filename: path.join(this.config.file.logDir, 'error.log'),
          level: 'error',
          maxsize: this.parseSize(this.config.file.maxSize),
          maxFiles: this.config.file.maxFiles,
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          )
        })
      );

      // Daily rotating logs
      transports.push(
        new winston.transports.File({
          filename: path.join(this.config.file.logDir, 'combined-%DATE%.log'),
          datePattern: this.config.file.datePattern,
          zippedArchive: true,
          maxSize: this.parseSize(this.config.file.maxSize),
          maxFiles: this.config.file.maxFiles,
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          )
        })
      );
    }

    // Elasticsearch transport for centralized logging
    if (this.elasticsearchClient) {
      transports.push(
        new ElasticsearchTransport({
          level: this.config.level,
          client: this.elasticsearchClient,
          index: `${this.config.elasticsearch.indexPrefix}-%{yyyy.MM.dd}`,
          transformer: (logEntry) => this.transformLogEntry(logEntry),
          sourceType: 'gui-lop-app',
          template: {
            index_patterns: [`${this.config.elasticsearch.indexPrefix}-*`],
            settings: {
              number_of_shards: 3,
              number_of_replicas: 1,
              'index.lifecycle.name': 'gui-lop-logs-policy',
              'index.lifecycle.rollover_alias': this.config.elasticsearch.indexPrefix
            },
            mappings: {
              properties: {
                timestamp: { type: 'date' },
                level: { type: 'keyword' },
                service: { type: 'keyword' },
                environment: { type: 'keyword' },
                cluster: { type: 'keyword' },
                datacenter: { type: 'keyword' },
                message: { type: 'text', analyzer: 'standard' },
                request: {
                  properties: {
                    method: { type: 'keyword' },
                    url: { type: 'text' },
                    userAgent: { type: 'text' },
                    ip: { type: 'ip' }
                  }
                },
                response: {
                  properties: {
                    statusCode: { type: 'integer' },
                    responseTime: { type: 'float' },
                    contentLength: { type: 'long' }
                  }
                },
                error: {
                  properties: {
                    name: { type: 'keyword' },
                    message: { type: 'text' },
                    stack: { type: 'text' }
                  }
                },
                performance: {
                  properties: {
                    memoryUsage: { type: 'long' },
                    cpuUsage: { type: 'float' },
                    eventLoopLag: { type: 'float' }
                  }
                }
              }
            }
          }
        })
      );
    }

    return transports;
  }

  transformLogEntry(logEntry) {
    const transformed = {
      ...logEntry,
      '@timestamp': logEntry.timestamp,
      fields: {
        logtype: 'application',
        service: this.config.serviceName,
        environment: this.config.environment,
        cluster: this.config.cluster,
        datacenter: this.config.datacenter
      }
    };

    // Add structured data for different log types
    if (logEntry.metadata?.error) {
      transformed.fields.logtype = 'error';
    }

    if (logEntry.metadata?.request) {
      transformed.fields.logtype = 'access';
    }

    if (logEntry.metadata?.security) {
      transformed.fields.logtype = 'security';
    }

    if (logEntry.metadata?.performance) {
      transformed.fields.logtype = 'performance';
    }

    return transformed;
  }

  handleExceptions() {
    // Handle uncaught exceptions
    this.logger.exceptions.handle(
      new winston.transports.File({
        filename: path.join(this.config.file.logDir, 'exceptions.log'),
        maxsize: this.parseSize(this.config.file.maxSize),
        maxFiles: this.config.file.maxFiles
      })
    );

    // Handle unhandled promise rejections
    this.logger.rejections.handle(
      new winston.transports.File({
        filename: path.join(this.config.file.logDir, 'rejections.log'),
        maxsize: this.parseSize(this.config.file.maxSize),
        maxFiles: this.config.file.maxFiles
      })
    );

    process.on('uncaughtException', (error) => {
      this.error('Uncaught exception', {
        error: error.message,
        stack: error.stack
      });
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      this.error('Unhandled promise rejection', {
        reason: reason.toString(),
        promise: promise.toString()
      });
    });
  }

  setupRequestLogging() {
    // This would typically be used with Express middleware
    this.requestLogger = (req, res, next) => {
      const startTime = Date.now();

      res.on('finish', () => {
        const responseTime = Date.now() - startTime;

        const logLevel = res.statusCode >= 400 ? 'warn' : 'info';

        this.logger.log(logLevel, 'HTTP Request', {
          request: {
            method: req.method,
            url: req.originalUrl || req.url,
            headers: req.headers,
            ip: req.ip || req.connection?.remoteAddress,
            userAgent: req.headers['user-agent']
          },
          response: {
            statusCode: res.statusCode,
            responseTime: responseTime,
            contentLength: res.get('content-length')
          },
          user: req.user ? {
            id: req.user.id,
            email: req.user.email,
            roles: req.user.roles
          } : undefined
        });
      });

      next();
    };
  }

  sanitizeHeaders(headers) {
    const sensitiveHeaders = ['authorization', 'cookie', 'set-cookie', 'x-api-key'];
    const sanitized = { ...headers };

    for (const header of sensitiveHeaders) {
      if (sanitized[header]) {
        sanitized[header] = '[REDACTED]';
      }
    }

    return sanitized;
  }

  parseSize(size) {
    const units = { b: 1, kb: 1024, mb: 1024 * 1024, gb: 1024 * 1024 * 1024 };
    const match = size.toLowerCase().match(/^(\d+)(b|kb|mb|gb)$/);

    if (match) {
      return parseInt(match[1]) * units[match[2]];
    }

    return parseInt(size) || 100 * 1024 * 1024; // Default 100MB
  }

  // Logging methods
  error(message, metadata = {}) {
    if (!this.initialized) return;
    this.logger.error(message, metadata);
  }

  warn(message, metadata = {}) {
    if (!this.initialized) return;
    this.logger.warn(message, metadata);
  }

  info(message, metadata = {}) {
    if (!this.initialized) return;
    this.logger.info(message, metadata);
  }

  debug(message, metadata = {}) {
    if (!this.initialized) return;
    this.logger.debug(message, metadata);
  }

  // Specialized logging methods
  security(message, metadata = {}) {
    this.warn(message, { ...metadata, security: true });
  }

  performance(message, metrics = {}) {
    this.info(message, {
      performance: {
        ...metrics,
        timestamp: Date.now(),
        service: this.config.serviceName
      }
    });
  }

  audit(action, details = {}) {
    this.info(`Audit: ${action}`, {
      audit: {
        action,
        ...details,
        timestamp: Date.now(),
        service: this.config.serviceName
      }
    });
  }

  // Structured logging for specific events
  logAuth(event, details = {}) {
    this.info(`Authentication: ${event}`, {
      security: true,
      auth: {
        event,
        ...details,
        timestamp: Date.now()
      }
    });
  }

  logApiRequest(req, res, responseTime) {
    const logLevel = res.statusCode >= 400 ? 'warn' : 'info';

    this.logger.log(logLevel, 'API Request', {
      request: {
        method: req.method,
        url: req.originalUrl || req.url,
        headers: this.sanitizeHeaders(req.headers),
        ip: req.ip || req.connection?.remoteAddress,
        userAgent: req.headers['user-agent']
      },
      response: {
        statusCode: res.statusCode,
        responseTime: responseTime,
        contentLength: res.get('content-length')
      },
      user: req.user ? {
        id: req.user.id,
        email: req.user.email
      } : undefined
    });
  }

  logDatabaseQuery(query, duration, error = null) {
    const metadata = {
      database: {
        query: this.sanitizeQuery(query),
        duration: duration,
        timestamp: Date.now()
      }
    };

    if (error) {
      metadata.error = {
        message: error.message,
        stack: error.stack
      };
      this.error('Database query failed', metadata);
    } else {
      this.debug('Database query executed', metadata);
    }
  }

  logWebSocketEvent(event, socketId, details = {}) {
    this.debug(`WebSocket: ${event}`, {
      websocket: {
        event,
        socketId,
        ...details,
        timestamp: Date.now()
      }
    });
  }

  sanitizeQuery(query) {
    // Remove sensitive data from SQL queries
    return query.replace(/(['"])(?:(?=(\\?))\2.)*?\1/g, '?');
  }

  // Health check for logging system
  async healthCheck() {
    const health = {
      status: 'healthy',
      initialized: this.initialized,
      elasticsearch: false,
      transports: {}
    };

    try {
      if (this.elasticsearchClient) {
        await this.elasticsearchClient.ping();
        health.elasticsearch = true;
      }
    } catch (error) {
      health.elasticsearch = false;
      health.status = 'degraded';
    }

    // Check transport health
    this.logger.transports.forEach((transport, index) => {
      const transportName = transport.constructor.name;
      health.transports[transportName] = transport.level !== 'error';
    });

    return health;
  }

  // Graceful shutdown
  async shutdown() {
    this.info('Shutting down centralized logging system');

    if (this.elasticsearchClient) {
      await this.elasticsearchClient.close();
    }

    if (this.logger) {
      this.logger.end();
    }

    this.initialized = false;
  }
}

export default CentralizedLogger;