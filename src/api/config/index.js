/**
 * API Configuration
 * Centralized configuration for the enhanced API system
 */

import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * API Configuration
 */
export const API_CONFIG = {
  // Server configuration
  server: {
    port: process.env.API_PORT || 3001,
    host: process.env.API_HOST || 'localhost',
    env: process.env.NODE_ENV || 'development',
    trustProxy: process.env.TRUST_PROXY === 'true',
    maxRequestSize: process.env.MAX_REQUEST_SIZE || '10mb'
  },

  // CORS configuration
  cors: {
    origin: process.env.FRONTEND_URLS?.split(',') || ['http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-Request-ID',
      'Accept-Version',
      'Accept-Language'
    ],
    exposedHeaders: [
      'X-Request-ID',
      'X-Response-Time',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'API-Version',
      'API-Supported-Versions'
    ]
  },

  // Authentication configuration
  auth: {
    jwtSecret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    jwtExpiry: process.env.JWT_EXPIRY || '15m',
    refreshSecret: process.env.REFRESH_SECRET || 'your-refresh-secret-key',
    refreshExpiry: process.env.REFRESH_EXPIRY || '7d',
    issuer: process.env.JWT_ISSUER || 'gui-lop-api',
    audience: process.env.JWT_AUDIENCE || 'gui-lop-users',
    algorithm: 'HS256',
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5,
    lockoutDuration: parseInt(process.env.LOCKOUT_DURATION) || 30 * 60 * 1000, // 30 minutes
    passwordMinLength: parseInt(process.env.PASSWORD_MIN_LENGTH) || 8,
    requireStrongPassword: process.env.REQUIRE_STRONG_PASSWORD !== 'false'
  },

  // Rate limiting configuration
  rateLimiting: {
    enabled: process.env.ENABLE_RATE_LIMITING !== 'false',
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 minutes
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX) || 1000,
    redis: {
      enabled: process.env.ENABLE_REDIS_RATE_LIMITING === 'true',
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB) || 0
    },
    endpoints: {
      auth: {
        windowMs: 15 * 60 * 1000,
        max: 5 // 5 login attempts per 15 minutes
      },
      registration: {
        windowMs: 60 * 60 * 1000,
        max: 3 // 3 registrations per hour
      },
      password: {
        windowMs: 60 * 60 * 1000,
        max: 5 // 5 password changes per hour
      },
      workflows: {
        create: {
          windowMs: 60 * 60 * 1000,
          max: 50 // 50 workflows per hour
        },
        execute: {
          windowMs: 60 * 60 * 1000,
          max: 100 // 100 executions per hour
        }
      },
      fileUpload: {
        windowMs: 60 * 60 * 1000,
        max: 20 // 20 uploads per hour
      }
    }
  },

  // Caching configuration
  cache: {
    enabled: process.env.ENABLE_CACHE !== 'false',
    strategy: process.env.CACHE_STRATEGY || 'memory',
    defaultTTL: parseInt(process.env.CACHE_DEFAULT_TTL) || 5 * 60 * 1000, // 5 minutes
    maxSize: parseInt(process.env.CACHE_MAX_SIZE) || 1000,
    compression: {
      enabled: process.env.ENABLE_CACHE_COMPRESSION !== 'false',
      threshold: parseInt(process.env.CACHE_COMPRESSION_THRESHOLD) || 1024
    },
    redis: {
      enabled: process.env.ENABLE_REDIS_CACHE === 'true',
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB) || 1
    }
  },

  // Database configuration
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    name: process.env.DB_NAME || 'gui_lop',
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true',
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS) || 20,
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000,
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 2000
  },

  // WebSocket configuration
  websocket: {
    enabled: process.env.ENABLE_WEBSOCKET !== 'false',
    port: process.env.WS_PORT || 3002,
    maxConnections: parseInt(process.env.WS_MAX_CONNECTIONS) || 1000,
    heartbeatInterval: parseInt(process.env.WS_HEARTBEAT_INTERVAL) || 30000,
    pingTimeout: parseInt(process.env.WS_PING_TIMEOUT) || 5000
  },

  // File upload configuration
  fileUpload: {
    enabled: process.env.ENABLE_FILE_UPLOAD !== 'false',
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB
    allowedMimeTypes: process.env.ALLOWED_MIME_TYPES?.split(',') || [
      'image/jpeg',
      'image/png',
      'image/gif',
      'application/pdf',
      'text/plain',
      'application/json',
      'text/csv'
    ],
    storage: {
      type: process.env.FILE_STORAGE_TYPE || 'local', // 'local', 's3', 'gcs'
      path: process.env.FILE_STORAGE_PATH || './uploads',
      bucket: process.env.AWS_S3_BUCKET,
      region: process.env.AWS_S3_REGION,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  },

  // Monitoring and logging
  monitoring: {
    enabled: process.env.ENABLE_MONITORING !== 'false',
    metrics: {
      enabled: process.env.ENABLE_METRICS !== 'false',
      endpoint: '/metrics',
      prometheus: process.env.ENABLE_PROMETHEUS === 'true'
    },
    logging: {
      level: process.env.LOG_LEVEL || 'info',
      format: process.env.LOG_FORMAT || 'json',
      file: process.env.LOG_FILE,
      maxFileSize: process.env.LOG_MAX_FILE_SIZE || '10m',
      maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5
    },
    tracing: {
      enabled: process.env.ENABLE_TRACING === 'true',
      serviceName: process.env.TRACING_SERVICE_NAME || 'gui-lop-api',
      jaegerEndpoint: process.env.JAEGER_ENDPOINT
    }
  },

  // Security configuration
  security: {
    helmet: {
      enabled: process.env.ENABLE_HELMET !== 'false',
      contentSecurityPolicy: process.env.CSP_ENABLED !== 'false'
    },
    compression: {
      enabled: process.env.ENABLE_COMPRESSION !== 'false',
      threshold: parseInt(process.env.COMPRESSION_THRESHOLD) || 1024
    },
    requestValidation: {
      enabled: process.env.ENABLE_REQUEST_VALIDATION !== 'false',
      strictMode: process.env.STRICT_VALIDATION === 'true'
    },
    ipWhitelist: process.env.IP_WHITELIST?.split(',') || [],
    ipBlacklist: process.env.IP_BLACKLIST?.split(',') || []
  },

  // API versioning
  versioning: {
    enabled: process.env.ENABLE_VERSIONING !== 'false',
    defaultVersion: process.env.DEFAULT_API_VERSION || 'v1',
    supportedVersions: process.env.SUPPORTED_API_VERSIONS?.split(',') || ['v1'],
    deprecatedVersions: process.env.DEPRECATED_API_VERSIONS?.split(',') || [],
    strictMode: process.env.VERSIONING_STRICT_MODE === 'true'
  },

  // Documentation
  documentation: {
    enabled: process.env.ENABLE_API_DOCS !== 'false',
    swaggerPath: '/docs',
    openApiPath: '/docs/swagger.json',
    redocPath: '/redoc',
    customCss: process.env.DOCS_CUSTOM_CSS,
    customLogo: process.env.DOCS_CUSTOM_LOGO
  },

  // Health checks
  health: {
    enabled: process.env.ENABLE_HEALTH_CHECK !== 'false',
    path: '/health',
    detailed: process.env.HEALTH_CHECK_DETAILED === 'true',
    checks: {
      database: process.env.HEALTH_CHECK_DB !== 'false',
      redis: process.env.HEALTH_CHECK_REDIS !== 'false',
      externalServices: process.env.HEALTH_CHECK_EXTERNAL !== 'false'
    }
  },

  // Environment-specific settings
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test'
};

/**
 * Validate configuration
 */
export const validateConfig = () => {
  const errors = [];

  // Validate required fields
  if (!API_CONFIG.auth.jwtSecret || API_CONFIG.auth.jwtSecret === 'your-secret-key-change-in-production') {
    if (API_CONFIG.isProduction) {
      errors.push('JWT_SECRET must be set in production');
    }
  }

  // Validate numeric values
  const numericFields = [
    { path: 'server.port', min: 1, max: 65535 },
    { path: 'auth.jwtExpiryMs', min: 60000, max: 86400000 }, // 1 minute to 1 day
    { path: 'rateLimiting.maxRequests', min: 1, max: 10000 },
    { path: 'cache.defaultTTL', min: 1000, max: 86400000 }, // 1 second to 1 day
    { path: 'fileUpload.maxFileSize', min: 1024, max: 1024 * 1024 * 1024 } // 1KB to 1GB
  ];

  for (const field of numericFields) {
    const value = getNestedValue(API_CONFIG, field.path);
    if (typeof value !== 'number' || value < field.min || value > field.max) {
      errors.push(`${field.path} must be a number between ${field.min} and ${field.max}`);
    }
  }

  // Validate URLs
  const urlFields = [
    'cors.origin[0]',
    'documentation.customLogo'
  ];

  for (const field of urlFields) {
    const value = getNestedValue(API_CONFIG, field);
    if (value && !isValidUrl(value)) {
      errors.push(`${field} must be a valid URL`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

/**
 * Validate URL format
 */
function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Get database URL from configuration
 */
export const getDatabaseUrl = () => {
  const { database } = API_CONFIG;
  const useSsl = database.ssl ? '?ssl=true' : '';

  return `postgresql://${database.username}:${database.password}@${database.host}:${database.port}/${database.name}${useSsl}`;
};

/**
 * Get Redis connection options
 */
export const getRedisOptions = () => {
  const { redis } = API_CONFIG.rateLimiting;
  const { redis: cacheRedis } = API_CONFIG.cache;

  return {
    host: redis.host || cacheRedis.host || 'localhost',
    port: redis.port || cacheRedis.port || 6379,
    password: redis.password || cacheRedis.password,
    db: redis.db || cacheRedis.db || 0,
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3,
    lazyConnect: true
  };
};

/**
 * Get CORS options for express
 */
export const getCorsOptions = () => {
  return {
    origin: API_CONFIG.cors.origin,
    credentials: API_CONFIG.cors.credentials,
    methods: API_CONFIG.cors.methods,
    allowedHeaders: API_CONFIG.cors.allowedHeaders,
    exposedHeaders: API_CONFIG.cors.exposedHeaders
  };
};

/**
 * Get rate limiting options
 */
export const getRateLimitOptions = (endpoint = 'general') => {
  const baseOptions = {
    windowMs: API_CONFIG.rateLimiting.windowMs,
    max: API_CONFIG.rateLimiting.maxRequests,
    message: {
      success: false,
      message: 'Too many requests',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: Math.ceil(API_CONFIG.rateLimiting.windowMs / 1000),
      timestamp: new Date().toISOString()
    },
    standardHeaders: true,
    legacyHeaders: false
  };

  const endpointOptions = API_CONFIG.rateLimiting.endpoints[endpoint];
  if (endpointOptions) {
    return {
      ...baseOptions,
      windowMs: endpointOptions.windowMs,
      max: endpointOptions.max
    };
  }

  return baseOptions;
};

/**
 * Get file upload options
 */
export const getFileUploadOptions = () => {
  return {
    limits: {
      fileSize: API_CONFIG.fileUpload.maxFileSize,
      files: 10 // Maximum 10 files per request
    },
    fileFilter: (req, file, cb) => {
      const allowedMimeTypes = API_CONFIG.fileUpload.allowedMimeTypes;
      if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`File type ${file.mimetype} is not allowed`), false);
      }
    }
  };
};

/**
 * Configuration validation and startup
 */
export const initializeConfig = () => {
  const validation = validateConfig();

  if (!validation.isValid) {
    console.error('Configuration validation failed:');
    validation.errors.forEach(error => console.error(`  - ${error}`));

    if (API_CONFIG.isProduction) {
      process.exit(1);
    } else {
      console.warn('Continuing with invalid configuration in development mode');
    }
  }

  // Log configuration summary
  console.log('API Configuration:');
  console.log(`  Environment: ${API_CONFIG.server.env}`);
  console.log(`  Server: ${API_CONFIG.server.host}:${API_CONFIG.server.port}`);
  console.log(`  Rate Limiting: ${API_CONFIG.rateLimiting.enabled ? 'Enabled' : 'Disabled'}`);
  console.log(`  Caching: ${API_CONFIG.cache.enabled ? 'Enabled' : 'Disabled'}`);
  console.log(`  Monitoring: ${API_CONFIG.monitoring.enabled ? 'Enabled' : 'Disabled'}`);
  console.log(`  Documentation: ${API_CONFIG.documentation.enabled ? 'Enabled' : 'Disabled'}`);

  return validation;
};

export default API_CONFIG;