/**
 * Comprehensive Error Handling Middleware
 * Centralized error handling with proper HTTP status codes and detailed error responses
 */

import { createHash } from 'crypto';

/**
 * Error codes enumeration
 */
export const ERROR_CODES = {
  // Authentication & Authorization Errors
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_REVOKED: 'TOKEN_REVOKED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  SESSION_INVALID: 'SESSION_INVALID',
  AUTH_REQUIRED: 'AUTH_REQUIRED',

  // Validation Errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_FORMAT: 'INVALID_FORMAT',
  INVALID_EMAIL: 'INVALID_EMAIL',
  INVALID_PASSWORD: 'INVALID_PASSWORD',
  PASSWORD_MISMATCH: 'PASSWORD_MISMATCH',
  WEAK_PASSWORD: 'WEAK_PASSWORD',
  INVALID_FILE_TYPE: 'INVALID_FILE_TYPE',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',

  // Resource Errors
  NOT_FOUND: 'NOT_FOUND',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  WORKFLOW_NOT_FOUND: 'WORKFLOW_NOT_FOUND',
  TEMPLATE_NOT_FOUND: 'TEMPLATE_NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  USER_ALREADY_EXISTS: 'USER_ALREADY_EXISTS',
  CONFLICT: 'CONFLICT',
  DUPLICATE_RESOURCE: 'DUPLICATE_RESOURCE',

  // Workflow Errors
  WORKFLOW_ERROR: 'WORKFLOW_ERROR',
  WORKFLOW_EXECUTION_FAILED: 'WORKFLOW_EXECUTION_FAILED',
  WORKFLOW_TIMEOUT: 'WORKFLOW_TIMEOUT',
  WORKFLOW_CANCELLED: 'WORKFLOW_CANCELLED',
  INVALID_WORKFLOW_STATUS: 'INVALID_WORKFLOW_STATUS',
  WORKFLOW_NOT_RUNNING: 'WORKFLOW_NOT_RUNNING',
  WORKFLOW_ALREADY_RUNNING: 'WORKFLOW_ALREADY_RUNNING',
  EXECUTION_ERROR: 'EXECUTION_ERROR',
  HUMAN_INPUT_REQUIRED: 'HUMAN_INPUT_REQUIRED',
  HUMAN_INPUT_TIMEOUT: 'HUMAN_INPUT_TIMEOUT',

  // Rate Limiting & Throttling
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  RATE_LIMITED: 'RATE_LIMITED',
  THROTTLED: 'THROTTLED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  SUSPICIOUS_ACTIVITY: 'SUSPICIOUS_ACTIVITY',

  // System & Infrastructure Errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVER_ERROR: 'SERVER_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',
  UNAVAILABLE: 'UNAVAILABLE',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  MAINTENANCE_MODE: 'MAINTENANCE_MODE',
  OVERLOADED: 'OVERLOADED',

  // Cache & Performance
  CACHE_ERROR: 'CACHE_ERROR',
  CACHE_MISS: 'CACHE_MISS',
  PERFORMANCE_ISSUE: 'PERFORMANCE_ISSUE',
  SLOW_QUERY: 'SLOW_QUERY',

  // Business Logic Errors
  BUSINESS_RULE_VIOLATION: 'BUSINESS_RULE_VIOLATION',
  INVALID_OPERATION: 'INVALID_OPERATION',
  OPERATION_NOT_ALLOWED: 'OPERATION_NOT_ALLOWED',
  RESOURCE_LOCKED: 'RESOURCE_LOCKED',
  QUOTA_REACHED: 'QUOTA_REACHED',
  LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',

  // Configuration & Setup
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  SETUP_REQUIRED: 'SETUP_REQUIRED',
  DEPRECATED_API: 'DEPRECATED_API',
  UNSUPPORTED_API_VERSION: 'UNSUPPORTED_API_VERSION',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  PREMIUM_FEATURE: 'PREMIUM_FEATURE',

  // Data & Processing
  DATA_CORRUPTION: 'DATA_CORRUPTION',
  INVALID_DATA: 'INVALID_DATA',
  DATA_VALIDATION_FAILED: 'DATA_VALIDATION_FAILED',
  PROCESSING_ERROR: 'PROCESSING_ERROR',
  ENCODING_ERROR: 'ENCODING_ERROR',
  DECODING_ERROR: 'DECODING_ERROR',

  // Security
  SECURITY_VIOLATION: 'SECURITY_VIOLATION',
  MALICIOUS_REQUEST: 'MALICIOUS_REQUEST',
  BLOCKED_REQUEST: 'BLOCKED_REQUEST',
  SUSPICIOUS_REQUEST: 'SUSPICIOUS_REQUEST',
  XSS_ATTEMPT: 'XSS_ATTEMPT',
  SQL_INJECTION_ATTEMPT: 'SQL_INJECTION_ATTEMPT',

  // Generic Errors
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  UNEXPECTED_ERROR: 'UNEXPECTED_ERROR',
  GENERAL_ERROR: 'GENERAL_ERROR'
};

/**
 * HTTP Status Code Mapping
 */
export const HTTP_STATUS_CODES = {
  [ERROR_CODES.UNAUTHORIZED]: 401,
  [ERROR_CODES.FORBIDDEN]: 403,
  [ERROR_CODES.TOKEN_EXPIRED]: 401,
  [ERROR_CODES.TOKEN_REVOKED]: 401,
  [ERROR_CODES.TOKEN_INVALID]: 401,
  [ERROR_CODES.INSUFFICIENT_PERMISSIONS]: 403,
  [ERROR_CODES.ACCOUNT_LOCKED]: 423,
  [ERROR_CODES.ACCOUNT_INACTIVE]: 403,
  [ERROR_CODES.SESSION_INVALID]: 401,
  [ERROR_CODES.AUTH_REQUIRED]: 401,

  [ERROR_CODES.VALIDATION_ERROR]: 400,
  [ERROR_CODES.INVALID_INPUT]: 400,
  [ERROR_CODES.MISSING_REQUIRED_FIELD]: 400,
  [ERROR_CODES.INVALID_FORMAT]: 400,
  [ERROR_CODES.INVALID_EMAIL]: 400,
  [ERROR_CODES.INVALID_PASSWORD]: 400,
  [ERROR_CODES.PASSWORD_MISMATCH]: 400,
  [ERROR_CODES.WEAK_PASSWORD]: 400,
  [ERROR_CODES.INVALID_FILE_TYPE]: 400,
  [ERROR_CODES.FILE_TOO_LARGE]: 413,

  [ERROR_CODES.NOT_FOUND]: 404,
  [ERROR_CODES.RESOURCE_NOT_FOUND]: 404,
  [ERROR_CODES.USER_NOT_FOUND]: 404,
  [ERROR_CODES.WORKFLOW_NOT_FOUND]: 404,
  [ERROR_CODES.TEMPLATE_NOT_FOUND]: 404,
  [ERROR_CODES.ALREADY_EXISTS]: 409,
  [ERROR_CODES.USER_ALREADY_EXISTS]: 409,
  [ERROR_CODES.CONFLICT]: 409,
  [ERROR_CODES.DUPLICATE_RESOURCE]: 409,

  [ERROR_CODES.WORKFLOW_ERROR]: 422,
  [ERROR_CODES.WORKFLOW_EXECUTION_FAILED]: 422,
  [ERROR_CODES.WORKFLOW_TIMEOUT]: 408,
  [ERROR_CODES.WORKFLOW_CANCELLED]: 422,
  [ERROR_CODES.INVALID_WORKFLOW_STATUS]: 400,
  [ERROR_CODES.WORKFLOW_NOT_RUNNING]: 409,
  [ERROR_CODES.WORKFLOW_ALREADY_RUNNING]: 409,
  [ERROR_CODES.EXECUTION_ERROR]: 500,
  [ERROR_CODES.HUMAN_INPUT_REQUIRED]: 422,
  [ERROR_CODES.HUMAN_INPUT_TIMEOUT]: 408,

  [ERROR_CODES.RATE_LIMIT_EXCEEDED]: 429,
  [ERROR_CODES.TOO_MANY_REQUESTS]: 429,
  [ERROR_CODES.RATE_LIMITED]: 429,
  [ERROR_CODES.THROTTLED]: 429,
  [ERROR_CODES.QUOTA_EXCEEDED]: 429,
  [ERROR_CODES.SUSPICIOUS_ACTIVITY]: 403,

  [ERROR_CODES.INTERNAL_ERROR]: 500,
  [ERROR_CODES.SERVER_ERROR]: 500,
  [ERROR_CODES.DATABASE_ERROR]: 503,
  [ERROR_CODES.EXTERNAL_SERVICE_ERROR]: 502,
  [ERROR_CODES.NETWORK_ERROR]: 503,
  [ERROR_CODES.TIMEOUT_ERROR]: 408,
  [ERROR_CODES.UNAVAILABLE]: 503,
  [ERROR_CODES.SERVICE_UNAVAILABLE]: 503,
  [ERROR_CODES.MAINTENANCE_MODE]: 503,
  [ERROR_CODES.OVERLOADED]: 503,

  [ERROR_CODES.CACHE_ERROR]: 500,
  [ERROR_CODES.CACHE_MISS]: 404,
  [ERROR_CODES.PERFORMANCE_ISSUE]: 200, // Still successful, but with warning
  [ERROR_CODES.SLOW_QUERY]: 200,

  [ERROR_CODES.BUSINESS_RULE_VIOLATION]: 422,
  [ERROR_CODES.INVALID_OPERATION]: 400,
  [ERROR_CODES.OPERATION_NOT_ALLOWED]: 403,
  [ERROR_CODES.RESOURCE_LOCKED]: 423,
  [ERROR_CODES.QUOTA_REACHED]: 429,
  [ERROR_CODES.LIMIT_EXCEEDED]: 429,

  [ERROR_CODES.CONFIGURATION_ERROR]: 500,
  [ERROR_CODES.SETUP_REQUIRED]: 503,
  [ERROR_CODES.DEPRECATED_API]: 410,
  [ERROR_CODES.UNSUPPORTED_API_VERSION]: 400,
  [ERROR_CODES.FEATURE_DISABLED]: 403,
  [ERROR_CODES.PREMIUM_FEATURE]: 402,

  [ERROR_CODES.DATA_CORRUPTION]: 500,
  [ERROR_CODES.INVALID_DATA]: 400,
  [ERROR_CODES.DATA_VALIDATION_FAILED]: 422,
  [ERROR_CODES.PROCESSING_ERROR]: 500,
  [ERROR_CODES.ENCODING_ERROR]: 500,
  [ERROR_CODES.DECODING_ERROR]: 400,

  [ERROR_CODES.SECURITY_VIOLATION]: 403,
  [ERROR_CODES.MALICIOUS_REQUEST]: 400,
  [ERROR_CODES.BLOCKED_REQUEST]: 403,
  [ERROR_CODES.SUSPICIOUS_REQUEST]: 400,
  [ERROR_CODES.XSS_ATTEMPT]: 400,
  [ERROR_CODES.SQL_INJECTION_ATTEMPT]: 400,

  [ERROR_CODES.UNKNOWN_ERROR]: 500,
  [ERROR_CODES.UNEXPECTED_ERROR]: 500,
  [ERROR_CODES.GENERAL_ERROR]: 500
};

/**
 * Custom Error Classes
 */
export class ApiError extends Error {
  constructor(message, code = ERROR_CODES.INTERNAL_ERROR, statusCode = 500, details = null, cause = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.cause = cause;
    this.timestamp = new Date().toISOString();
    this.requestId = null;

    // Maintain stack trace for proper error reporting
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }

  /**
   * Convert to JSON response format
   */
  toJSON(requestId = null) {
    return {
      success: false,
      message: this.message,
      code: this.code,
      details: this.details,
      timestamp: this.timestamp,
      requestId: requestId || this.requestId,
      path: null, // Will be set by error handler
      ...(process.env.NODE_ENV === 'development' && {
        stack: this.stack,
        cause: this.cause?.message || this.cause
      })
    };
  }

  /**
   * Create specific error types
   */
  static validation(message, details = null) {
    return new ApiError(message, ERROR_CODES.VALIDATION_ERROR, 400, details);
  }

  static unauthorized(message = 'Authentication required') {
    return new ApiError(message, ERROR_CODES.UNAUTHORIZED, 401);
  }

  static forbidden(message = 'Access denied') {
    return new ApiError(message, ERROR_CODES.FORBIDDEN, 403);
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(message, ERROR_CODES.NOT_FOUND, 404);
  }

  static conflict(message = 'Resource conflict') {
    return new ApiError(message, ERROR_CODES.CONFLICT, 409);
  }

  static rateLimited(message = 'Rate limit exceeded') {
    return new ApiError(message, ERROR_CODES.RATE_LIMIT_EXCEEDED, 429);
  }

  static internal(message = 'Internal server error', cause = null) {
    return new ApiError(message, ERROR_CODES.INTERNAL_ERROR, 500, null, cause);
  }

  static serviceUnavailable(message = 'Service temporarily unavailable') {
    return new ApiError(message, ERROR_CODES.SERVICE_UNAVAILABLE, 503);
  }
}

/**
 * Specialized error classes
 */
export class ValidationError extends ApiError {
  constructor(message, field = null, value = null, constraint = null) {
    super(message, ERROR_CODES.VALIDATION_ERROR, 400, {
      field,
      value,
      constraint
    });
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends ApiError {
  constructor(message = 'Authentication failed') {
    super(message, ERROR_CODES.UNAUTHORIZED, 401);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends ApiError {
  constructor(message = 'Access denied') {
    super(message, ERROR_CODES.FORBIDDEN, 403);
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'Resource not found', resourceType = null, resourceId = null) {
    super(message, ERROR_CODES.NOT_FOUND, 404, {
      resourceType,
      resourceId
    });
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends ApiError {
  constructor(message = 'Resource conflict') {
    super(message, ERROR_CODES.CONFLICT, 409);
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends ApiError {
  constructor(message = 'Rate limit exceeded', retryAfter = null) {
    super(message, ERROR_CODES.RATE_LIMIT_EXCEEDED, 429, {
      retryAfter
    });
    this.name = 'RateLimitError';
  }
}

export class WorkflowError extends ApiError {
  constructor(message, workflowId = null, step = null) {
    super(message, ERROR_CODES.WORKFLOW_ERROR, 422, {
      workflowId,
      step
    });
    this.name = 'WorkflowError';
  }
}

/**
 * Error handler middleware factory
 */
export const createErrorHandler = (options = {}) => {
  const {
    logErrors = true,
    logLevel = 'error',
    includeStackTrace = process.env.NODE_ENV === 'development',
    sanitizeErrors = process.env.NODE_ENV === 'production',
    errorReporting = true,
    customHandlers = {}
  } = options;

  return (error, req, res, next) => {
    // Ensure error is an ApiError instance
    const apiError = normalizeError(error);

    // Set request ID if available
    if (req.id) {
      apiError.requestId = req.id;
    }

    // Log error if enabled
    if (logErrors) {
      logError(apiError, req, logLevel);
    }

    // Report error if enabled
    if (errorReporting) {
      reportError(apiError, req);
    }

    // Sanitize error in production
    const responseError = sanitizeErrors ? sanitizeError(apiError) : apiError;

    // Set response headers
    setResponseHeaders(res, responseError);

    // Check for custom handlers
    const customHandler = customHandlers[responseError.code];
    if (customHandler) {
      return customHandler(responseError, req, res, next);
    }

    // Handle specific error types
    if (responseError instanceof ValidationError) {
      return handleValidationError(responseError, req, res);
    }

    if (responseError instanceof RateLimitError) {
      return handleRateLimitError(responseError, req, res);
    }

    if (responseError instanceof AuthenticationError) {
      return handleAuthenticationError(responseError, req, res);
    }

    // Send error response
    const errorResponse = responseError.toJSON(req.id);
    errorResponse.path = req.originalUrl;

    res.status(responseError.statusCode).json(errorResponse);
  };
};

/**
 * Normalize error to ApiError instance
 */
const normalizeError = (error) => {
  if (error instanceof ApiError) {
    return error;
  }

  // Handle common Node.js errors
  if (error.name === 'ValidationError') {
    return new ValidationError(error.message, error.field, error.value);
  }

  if (error.name === 'CastError') {
    return new ApiError('Invalid data format', ERROR_CODES.INVALID_FORMAT, 400, {
      field: error.path,
      value: error.value,
      expectedType: error.kind
    });
  }

  if (error.code === 'ENOENT') {
    return new NotFoundError('File not found', 'file', error.path);
  }

  if (error.code === 'EACCES') {
    return new AuthorizationError('Permission denied');
  }

  if (error.code === 'ECONNREFUSED') {
    return new ApiError(
      'External service unavailable',
      ERROR_CODES.EXTERNAL_SERVICE_ERROR,
      502,
      { service: error.address }
    );
  }

  // Handle database errors
  if (error.code === '23505') { // PostgreSQL unique violation
    return new ConflictError('Resource already exists');
  }

  if (error.code === '23503') { // PostgreSQL foreign key violation
    return new ValidationError('Referenced resource does not exist');
  }

  // Handle JWT errors
  if (error.name === 'JsonWebTokenError') {
    return new AuthenticationError('Invalid authentication token');
  }

  if (error.name === 'TokenExpiredError') {
    return new ApiError(
      'Authentication token expired',
      ERROR_CODES.TOKEN_EXPIRED,
      401
    );
  }

  if (error.name === 'NotBeforeError') {
    return new AuthenticationError('Authentication token not yet valid');
  }

  // Handle Multer (file upload) errors
  if (error.code === 'LIMIT_FILE_SIZE') {
    return new ApiError(
      'File too large',
      ERROR_CODES.FILE_TOO_LARGE,
      413,
      { maxSize: error.limit }
    );
  }

  if (error.code === 'LIMIT_FILE_COUNT') {
    return new ValidationError('Too many files uploaded');
  }

  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return new ValidationError('Unexpected file field');
  }

  // Default error
  return new ApiError(
    error.message || 'An unexpected error occurred',
    ERROR_CODES.INTERNAL_ERROR,
    500,
    null,
    error
  );
};

/**
 * Log error with context
 */
const logError = (error, req, level = 'error') => {
  const logData = {
    message: error.message,
    code: error.code,
    statusCode: error.statusCode,
    requestId: error.requestId || req.id,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    userId: req.user?.id || null,
    timestamp: error.timestamp,
    stack: error.stack
  };

  if (level === 'error') {
    console.error('API Error:', logData);
  } else if (level === 'warn') {
    console.warn('API Warning:', logData);
  } else {
    console.info('API Info:', logData);
  }
};

/**
 * Report error to external monitoring service
 */
const reportError = (error, req) => {
  // This would integrate with error reporting services like Sentry, Bugsnag, etc.
  // For now, just log the error
  if (process.env.ERROR_REPORTING === 'true') {
    console.log('Error reported:', {
      errorId: generateErrorId(error),
      error: {
        name: error.name,
        message: error.message,
        code: error.code,
        stack: error.stack
      },
      request: {
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        userId: req.user?.id
      },
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Generate unique error ID
 */
const generateErrorId = (error) => {
  const errorData = `${error.code}:${error.message}:${Date.now()}`;
  return createHash('md5').update(errorData).digest('hex').substring(0, 8);
};

/**
 * Sanitize error for production
 */
const sanitizeError = (error) => {
  if (process.env.NODE_ENV !== 'production') {
    return error;
  }

  // Create a sanitized copy
  const sanitized = new ApiError(
    error.message,
    error.code,
    error.statusCode,
    error.details
  );

  // Remove sensitive information
  if (error.code === ERROR_CODES.INTERNAL_ERROR) {
    sanitized.message = 'An internal error occurred';
    sanitized.details = null;
  }

  // Remove stack trace
  sanitized.stack = undefined;

  return sanitized;
};

/**
 * Set response headers for errors
 */
const setResponseHeaders = (res, error) => {
  // Add error information headers
  res.setHeader('X-Error-Code', error.code);
  res.setHeader('X-Error-Status', error.statusCode);

  // Add cache control headers for errors
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  // Add security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
};

/**
 * Handle validation errors specifically
 */
const handleValidationError = (error, req, res) => {
  const response = error.toJSON(req.id);
  response.path = req.path;

  // If this is a single field validation error, format it differently
  if (error.details && error.details.field) {
    response.details = [{
      field: error.details.field,
      message: error.message,
      code: error.code,
      value: error.details.value
    }];
  }

  res.status(400).json(response);
};

/**
 * Handle rate limit errors specifically
 */
const handleRateLimitError = (error, req, res) => {
  const response = error.toJSON(req.id);
  response.path = req.path;

  // Add rate limit headers
  if (error.details && error.details.retryAfter) {
    res.setHeader('Retry-After', error.details.retryAfter);
  }

  res.status(429).json(response);
};

/**
 * Handle authentication errors specifically
 */
const handleAuthenticationError = (error, req, res) => {
  const response = error.toJSON(req.id);
  response.path = req.path;

  // Add authentication challenge header
  res.setHeader('WWW-Authenticate', 'Bearer');

  res.status(401).json(response);
};

/**
 * Async error wrapper for route handlers
 */
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Error recovery middleware
 */
export const errorRecovery = (options = {}) => {
  const {
    maxRetries = 3,
    retryableErrors = [
      ERROR_CODES.DATABASE_ERROR,
      ERROR_CODES.NETWORK_ERROR,
      ERROR_CODES.TIMEOUT_ERROR,
      ERROR_CODES.EXTERNAL_SERVICE_ERROR
    ],
    retryDelay = 1000 // Base delay in milliseconds
  } = options;

  return (error, req, res, next) => {
    if (!retryableErrors.includes(error.code)) {
      return next(error);
    }

    const retryCount = req.__retryCount || 0;

    if (retryCount >= maxRetries) {
      return next(error);
    }

    req.__retryCount = retryCount + 1;

    console.log(`Retrying request (attempt ${retryCount + 1}/${maxRetries}) for ${req.method} ${req.path}`);

    setTimeout(() => {
      next();
    }, retryDelay * Math.pow(2, retryCount)); // Exponential backoff
  };
};

/**
 * Circuit breaker pattern for error handling
 */
export class CircuitBreaker {
  constructor(options = {}) {
    this.options = {
      threshold: 5, // Number of failures before opening
      timeout: 60000, // Time in milliseconds before trying again
      resetTimeout: 30000, // Time in milliseconds for half-open state
      ...options
    };

    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failures = 0;
    this.lastFailureTime = null;
    this.successCount = 0;
  }

  async execute(operation) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.options.timeout) {
        this.state = 'HALF_OPEN';
        this.successCount = 0;
      } else {
        throw new ApiError(
          'Service temporarily unavailable (circuit breaker open)',
          ERROR_CODES.SERVICE_UNAVAILABLE,
          503
        );
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    this.successCount++;
    this.failures = 0;

    if (this.state === 'HALF_OPEN' && this.successCount >= 3) {
      this.state = 'CLOSED';
    }
  }

  onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.options.threshold) {
      this.state = 'OPEN';
    }
  }

  getStatus() {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime,
      successCount: this.successCount
    };
  }
}

/**
 * Default error handler export
 */
export const errorHandler = createErrorHandler({
  logErrors: true,
  logLevel: 'error',
  includeStackTrace: process.env.NODE_ENV === 'development',
  sanitizeErrors: process.env.NODE_ENV === 'production',
  errorReporting: process.env.NODE_ENV === 'production'
});

export default {
  // Error codes and status mapping
  ERROR_CODES,
  HTTP_STATUS_CODES,

  // Error classes
  ApiError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  WorkflowError,

  // Middleware and utilities
  createErrorHandler,
  errorHandler,
  asyncHandler,
  errorRecovery,
  CircuitBreaker
};