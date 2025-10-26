/**
 * Distributed Tracing System for GUI-LOP Platform
 * Implements OpenTelemetry tracing with Jaeger backend
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-otlp-grpc';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { ZipkinExporter } from '@opentelemetry/exporter-zipkin';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { trace, context, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb';
import { RedisInstrumentation } from '@opentelemetry/instrumentation-redis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { WebSocketInstrumentation } from '@opentelemetry/instrumentation-ws';

class DistributedTracing {
  constructor(config = {}) {
    this.config = {
      serviceName: config.serviceName || 'gui-lop-platform',
      serviceVersion: config.serviceVersion || process.env.APP_VERSION || '1.0.0',
      environment: config.environment || process.env.NODE_ENV || 'production',
      deployment: config.deployment || process.env.DEPLOYMENT || 'unknown',

      // Trace exporters
      exporters: {
        otlp: {
          enabled: config.exporters?.otlp?.enabled !== false,
          endpoint: config.exporters?.otlp?.endpoint || process.env.OTLP_ENDPOINT || 'http://localhost:4317',
          headers: config.exporters?.otlp?.headers || {},
          timeout: config.exporters?.otlp?.timeout || 30000
        },
        jaeger: {
          enabled: config.exporters?.jaeger?.enabled !== false,
          endpoint: config.exporters?.jaeger?.endpoint || process.env.JAEGER_ENDPOINT || 'http://localhost:14268/api/traces',
          host: config.exporters?.jaeger?.host || 'localhost',
          port: config.exporters?.jaeger?.port || 14268
        },
        zipkin: {
          enabled: config.exporters?.zipkin?.enabled || false,
          endpoint: config.exporters?.zipkin?.endpoint || process.env.ZIPKIN_ENDPOINT || 'http://localhost:9411/api/v2/spans'
        }
      },

      // Metrics
      metrics: {
        enabled: config.metrics?.enabled !== false,
        port: config.metrics?.port || 9464,
        endpoint: config.metrics?.endpoint || '/metrics'
      },

      // Sampling
      sampling: {
        type: config.sampling?.type || 'traceidratio',
        ratio: config.sampling?.ratio || 1.0,
        parentBased: config.sampling?.parentBased !== false
      },

      // Instrumentation
      instrumentations: {
        http: config.instrumentations?.http !== false,
        express: config.instrumentations?.express !== false,
        mongodb: config.instrumentations?.mongodb !== false,
        redis: config.instrumentations?.redis !== false,
        postgresql: config.instrumentations?.postgresql !== false,
        websocket: config.instrumentations?.websocket !== false,
        grpc: config.instrumentations?.grpc !== false
      },

      // Batching
      batch: {
        enabled: config.batch?.enabled !== false,
        maxExportBatchSize: config.batch?.maxExportBatchSize || 512,
        maxExportTimeoutMillis: config.batch?.maxExportTimeoutMillis || 30000,
        scheduledDelayMillis: config.batch?.scheduledDelayMillis || 5000
      }
    };

    this.sdk = null;
    this.meterProvider = null;
    this.initialized = false;
    this.customSpans = new Map();
    this.performanceMetrics = new Map();
  }

  async initialize() {
    try {
      // Create resource with service metadata
      const resource = new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: this.config.serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: this.config.serviceVersion,
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: this.config.environment,
        [SemanticResourceAttributes.PROCESS_PID]: process.pid,
        [SemanticResourceAttributes.HOST_NAME]: process.env.HOSTNAME || 'unknown',
        'service.instance.id': process.env.SERVICE_INSTANCE_ID || `${process.pid}`,
        'deployment.name': this.config.deployment
      });

      // Initialize trace exporters
      const traceExporters = await this.initializeTraceExporters();

      // Initialize metrics exporter
      const metricsExporter = await this.initializeMetricsExporter();

      // Create instrumentations
      const instrumentations = this.createInstrumentations();

      // Configure sampling
      const sampler = this.createSampler();

      // Initialize OpenTelemetry SDK
      this.sdk = new NodeSDK({
        resource,
        traceExporter: traceExporters.length > 0 ? traceExporters : undefined,
        meterProvider: metricsExporter,
        instrumentations,
        sampler,
        textMapPropagator: new W3CTraceContextPropagator(),
        spanLimits: {
          attributeCountLimit: 128,
          attributeValueLengthLimit: 1024,
          eventCountLimit: 128,
          linkCountLimit: 128,
          attributePerEventCountLimit: 128,
          attributePerLinkCountLimit: 128
        }
      });

      // Initialize SDK
      this.sdk.start();

      // Get tracer provider
      this.tracer = trace.getTracer(this.config.serviceName, this.config.serviceVersion);

      // Initialize custom metrics
      this.initializeCustomMetrics();

      this.initialized = true;

      // Log initialization
      console.log('Distributed tracing initialized', {
        serviceName: this.config.serviceName,
        environment: this.config.environment,
        exporters: Object.keys(this.config.exporters).filter(key => this.config.exporters[key].enabled),
        instrumentations: Object.keys(this.config.instrumentations).filter(key => this.config.instrumentations[key])
      });

    } catch (error) {
      console.error('Failed to initialize distributed tracing:', error);
      throw error;
    }
  }

  async initializeTraceExporters() {
    const exporters = [];

    // OTLP exporter
    if (this.config.exporters.otlp.enabled) {
      try {
        const otlpExporter = new OTLPTraceExporter({
          url: this.config.exporters.otlp.endpoint,
          headers: this.config.exporters.otlp.headers,
          timeoutMillis: this.config.exporters.otlp.timeout
        });
        exporters.push(otlpExporter);
      } catch (error) {
        console.warn('Failed to initialize OTLP exporter:', error.message);
      }
    }

    // Jaeger exporter
    if (this.config.exporters.jaeger.enabled) {
      try {
        const jaegerExporter = new JaegerExporter({
          endpoint: this.config.exporters.jaeger.endpoint,
          host: this.config.exporters.jaeger.host,
          port: this.config.exporters.jaeger.port,
          tags: {
            [SemanticResourceAttributes.SERVICE_NAME]: this.config.serviceName,
            environment: this.config.environment,
            version: this.config.serviceVersion
          }
        });
        exporters.push(jaegerExporter);
      } catch (error) {
        console.warn('Failed to initialize Jaeger exporter:', error.message);
      }
    }

    // Zipkin exporter
    if (this.config.exporters.zipkin.enabled) {
      try {
        const zipkinExporter = new ZipkinExporter({
          url: this.config.exporters.zipkin.endpoint,
          serviceName: this.config.serviceName
        });
        exporters.push(zipkinExporter);
      } catch (error) {
        console.warn('Failed to initialize Zipkin exporter:', error.message);
      }
    }

    return exporters;
  }

  async initializeMetricsExporter() {
    if (!this.config.metrics.enabled) {
      return undefined;
    }

    try {
      const prometheusExporter = new PrometheusExporter({
        port: this.config.metrics.port,
        endpoint: this.config.metrics.endpoint,
        preventServerStart: false
      });

      this.meterProvider = new MeterProvider();
      prometheusExporter.setMetricReader(this.meterProvider);

      return this.meterProvider;
    } catch (error) {
      console.warn('Failed to initialize metrics exporter:', error.message);
      return undefined;
    }
  }

  createInstrumentations() {
    const instrumentations = [];

    // Node.js auto-instrumentations
    instrumentations.push(...getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': {
        enabled: this.config.instrumentations.http
      }
    }));

    // Express instrumentation
    if (this.config.instrumentations.express) {
      instrumentations.push(new ExpressInstrumentation());
    }

    // MongoDB instrumentation
    if (this.config.instrumentations.mongodb) {
      instrumentations.push(new MongoDBInstrumentation());
    }

    // Redis instrumentation
    if (this.config.instrumentations.redis) {
      instrumentations.push(new RedisInstrumentation());
    }

    // PostgreSQL instrumentation
    if (this.config.instrumentations.postgresql) {
      instrumentations.push(new PgInstrumentation());
    }

    // WebSocket instrumentation
    if (this.config.instrumentations.websocket) {
      instrumentations.push(new WebSocketInstrumentation());
    }

    return instrumentations;
  }

  createSampler() {
    // Implement different sampling strategies
    switch (this.config.sampling.type) {
      case 'always_on':
        return { shouldSample: () => true };

      case 'always_off':
        return { shouldSample: () => false };

      case 'traceidratio':
      default:
        return {
          shouldSample: () => Math.random() < this.config.sampling.ratio
        };
    }
  }

  initializeCustomMetrics() {
    if (!this.meterProvider) return;

    const meter = this.meterProvider.getMeter(this.config.serviceName, this.config.serviceVersion);

    // Custom counters
    this.requestCounter = meter.createCounter('http_requests_total', {
      description: 'Total number of HTTP requests',
      unit: '1'
    });

    this.responseTimeHistogram = meter.createHistogram('http_request_duration_seconds', {
      description: 'HTTP request duration in seconds',
      unit: 's'
    });

    this.errorCounter = meter.createCounter('errors_total', {
      description: 'Total number of errors',
      unit: '1'
    });

    this.activeConnectionsGauge = meter.createUpDownCounter('active_connections', {
      description: 'Number of active connections',
      unit: '1'
    });

    // Custom application metrics
    this.userSessionCounter = meter.createCounter('user_sessions_total', {
      description: 'Total number of user sessions',
      unit: '1'
    });

    this.databaseQueryCounter = meter.createCounter('database_queries_total', {
      description: 'Total number of database queries',
      unit: '1'
    });

    this.cacheHitCounter = meter.createCounter('cache_hits_total', {
      description: 'Total number of cache hits',
      unit: '1'
    });

    this.webSocketConnectionGauge = meter.createUpDownCounter('websocket_connections', {
      description: 'Number of active WebSocket connections',
      unit: '1'
    });
  }

  // Tracing methods
  startSpan(name, options = {}) {
    if (!this.initialized) {
      return {
        setAttribute: () => {},
        addEvent: () => {},
        setStatus: () => {},
        end: () => {},
        isRecording: () => false
      };
    }

    return this.tracer.startSpan(name, {
      kind: options.kind || SpanKind.INTERNAL,
      attributes: options.attributes || {},
      startTime: options.startTime
    });
  }

  async runInSpan(name, fn, options = {}) {
    if (!this.initialized) {
      return await fn();
    }

    return await this.tracer.startActiveSpan(name, options, async (span) => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.recordException(error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message
        });
        throw error;
      }
    });
  }

  // HTTP request tracing
  traceHttpRequest(req, res, next) {
    if (!this.initialized) return next();

    const span = this.startSpan(`${req.method} ${req.path}`, {
      kind: SpanKind.SERVER,
      attributes: {
        'http.method': req.method,
        'http.url': req.url,
        'http.scheme': req.protocol,
        'http.host': req.headers.host,
        'http.user_agent': req.headers['user-agent'],
        'http.remote_addr': req.ip || req.connection?.remoteAddress,
        'user.id': req.user?.id
      }
    });

    // Record request start time
    const startTime = Date.now();

    // Add custom attributes from request
    if (req.user) {
      span.setAttribute('user.id', req.user.id);
      span.setAttribute('user.roles', req.user.roles?.join(',') || '');
    }

    // Intercept response
    const originalEnd = res.end;
    res.end = function(...args) {
      const duration = (Date.now() - startTime) / 1000;

      span.setAttribute('http.status_code', res.statusCode);
      span.setAttribute('http.response_content_length', res.get('content-length') || 0);
      span.setAttribute('http.response_duration_seconds', duration);

      // Set span status based on response code
      if (res.statusCode >= 400) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `HTTP ${res.statusCode}`
        });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }

      // Record metrics
      this.recordHttpMetrics(req, res, duration);

      span.end();
      originalEnd.apply(this, args);
    };

    next();
  }

  // Database query tracing
  async traceDatabaseQuery(query, parameters = [], operation = 'query') {
    if (!this.initialized) {
      return { query, parameters, operation };
    }

    return await this.runInSpan(`database.${operation}`, (span) => {
      span.setAttribute('db.system', 'postgresql');
      span.setAttribute('db.operation', operation);
      span.setAttribute('db.statement', this.sanitizeQuery(query));
      span.setAttribute('db.query.parameters_count', parameters.length);

      const startTime = Date.now();

      return new Promise((resolve, reject) => {
        // This would be integrated with actual database execution
        // For now, just return the query info
        const duration = Date.now() - startTime;

        span.setAttribute('db.query.duration_ms', duration);
        span.setStatus({ code: SpanStatusCode.OK });

        this.recordDatabaseMetrics(operation, duration);

        resolve({ query, parameters, operation, duration });
      });
    }, {
      attributes: {
        'component': 'database'
      }
    });
  }

  // Redis operation tracing
  async traceRedisOperation(operation, key, ...args) {
    if (!this.initialized) {
      return { operation, key, args };
    }

    return await this.runInSpan(`redis.${operation}`, (span) => {
      span.setAttribute('redis.command', operation);
      span.setAttribute('redis.key', key);
      span.setAttribute('redis.args_count', args.length);

      const startTime = Date.now();

      return new Promise((resolve, reject) => {
        // This would be integrated with actual Redis execution
        const duration = Date.now() - startTime;

        span.setAttribute('redis.duration_ms', duration);
        span.setStatus({ code: SpanStatusCode.OK });

        this.recordRedisMetrics(operation, duration);

        resolve({ operation, key, args, duration });
      });
    }, {
      attributes: {
        'component': 'redis'
      }
    });
  }

  // WebSocket event tracing
  traceWebSocketEvent(event, socketId, data = {}) {
    if (!this.initialized) return;

    const span = this.startSpan(`websocket.${event}`, {
      kind: SpanKind.SERVER,
      attributes: {
        'websocket.event': event,
        'websocket.socket_id': socketId,
        'component': 'websocket'
      }
    });

    // Add event-specific attributes
    Object.keys(data).forEach(key => {
      span.setAttribute(`websocket.${key}`, data[key]);
    });

    span.end();
  }

  // Authentication tracing
  async traceAuthentication(event, userId = null, details = {}) {
    if (!this.initialized) {
      return { event, userId, details };
    }

    return await this.runInSpan(`auth.${event}`, (span) => {
      span.setAttribute('auth.event', event);
      span.setAttribute('component', 'authentication');

      if (userId) {
        span.setAttribute('user.id', userId);
      }

      // Add authentication details
      Object.keys(details).forEach(key => {
        span.setAttribute(`auth.${key}`, details[key]);
      });

      const startTime = Date.now();

      return new Promise((resolve) => {
        const duration = Date.now() - startTime;

        span.setAttribute('auth.duration_ms', duration);
        span.setStatus({ code: SpanStatusCode.OK });

        this.recordAuthMetrics(event, duration);

        resolve({ event, userId, details, duration });
      });
    });
  }

  // Metrics recording
  recordHttpMetrics(req, res, duration) {
    if (!this.meterProvider) return;

    this.requestCounter.add(1, {
      method: req.method,
      route: req.route?.path || req.path,
      status_code: res.statusCode
    });

    this.responseTimeHistogram.record(duration, {
      method: req.method,
      route: req.route?.path || req.path
    });

    if (res.statusCode >= 400) {
      this.errorCounter.add(1, {
        type: 'http_error',
        status_code: res.statusCode
      });
    }
  }

  recordDatabaseMetrics(operation, duration) {
    if (!this.meterProvider) return;

    this.databaseQueryCounter.add(1, {
      operation: operation
    });

    if (duration > 1000) {
      this.errorCounter.add(1, {
        type: 'slow_query',
        operation: operation
      });
    }
  }

  recordRedisMetrics(operation, duration) {
    if (!this.meterProvider) return;

    // Redis metrics would be recorded here
  }

  recordAuthMetrics(event, duration) {
    if (!this.meterProvider) return;

    this.userSessionCounter.add(1, {
      event: event
    });

    if (event === 'login_success') {
      this.activeConnectionsGauge.add(1);
    } else if (event === 'logout') {
      this.activeConnectionsGauge.add(-1);
    }
  }

  // Utility methods
  sanitizeQuery(query) {
    // Remove sensitive data from SQL queries for tracing
    return query.replace(/(['"])(?:(?=(\\?))\2.)*?\1/g, '?');
  }

  getCurrentSpan() {
    if (!this.initialized) return null;
    return trace.getSpan(context.active());
  }

  addSpanAttribute(key, value) {
    const span = this.getCurrentSpan();
    if (span) {
      span.setAttribute(key, value);
    }
  }

  addSpanEvent(name, attributes = {}) {
    const span = this.getCurrentSpan();
    if (span) {
      span.addEvent(name, attributes);
    }
  }

  recordSpanException(error) {
    const span = this.getCurrentSpan();
    if (span) {
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message
      });
    }
  }

  // Health check for tracing system
  async healthCheck() {
    const health = {
      status: 'healthy',
      initialized: this.initialized,
      metrics: {
        enabled: !!this.meterProvider,
        port: this.config.metrics.port
      },
      exporters: {},
      instrumentations: {}
    };

    // Check exporter health
    Object.keys(this.config.exporters).forEach(exporter => {
      health.exporters[exporter] = this.config.exporters[exporter].enabled;
    });

    // Check instrumentation status
    Object.keys(this.config.instrumentations).forEach(instrumentation => {
      health.instrumentations[instrumentation] = this.config.instrumentations[instrumentation];
    });

    return health;
  }

  // Graceful shutdown
  async shutdown() {
    console.log('Shutting down distributed tracing system');

    if (this.sdk) {
      await this.sdk.shutdown();
    }

    if (this.meterProvider) {
      await this.meterProvider.shutdown();
    }

    this.initialized = false;
  }
}

export default DistributedTracing;