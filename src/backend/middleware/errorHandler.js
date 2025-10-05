/**
 * Error Handling Middleware
 * Centralized error handling for the GUI-LOP backend
 */

export const errorHandler = (error, req, res, next) => {
  console.error('Error occurred:', {
    message: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    sessionId: req.sessionId,
    timestamp: new Date().toISOString(),
  });

  // Default error response
  let status = 500;
  let message = 'Internal server error';
  let details = {};
  let code = 'INTERNAL_ERROR';

  // Handle specific error types
  if (error.name === 'ValidationError') {
    status = 400;
    message = 'Validation failed';
    code = 'VALIDATION_ERROR';
    details = error.details || {};
  } else if (error.name === 'UnauthorizedError') {
    status = 401;
    message = 'Unauthorized';
    code = 'UNAUTHORIZED';
  } else if (error.name === 'ForbiddenError') {
    status = 403;
    message = 'Forbidden';
    code = 'FORBIDDEN';
  } else if (error.name === 'NotFoundError') {
    status = 404;
    message = 'Resource not found';
    code = 'NOT_FOUND';
  } else if (error.name === 'ConflictError') {
    status = 409;
    message = 'Resource conflict';
    code = 'CONFLICT';
  } else if (error.name === 'TooManyRequestsError') {
    status = 429;
    message = 'Too many requests';
    code = 'RATE_LIMIT_EXCEEDED';
  } else if (error.code === '23505') { // PostgreSQL unique violation
    status = 409;
    message = 'Resource already exists';
    code = 'DUPLICATE_RESOURCE';
  } else if (error.code === '23503') { // PostgreSQL foreign key violation
    status = 400;
    message = 'Invalid reference';
    code = 'INVALID_REFERENCE';
  } else if (error.code === '23502') { // PostgreSQL not null violation
    status = 400;
    message = 'Required field missing';
    code = 'REQUIRED_FIELD_MISSING';
  } else if (error.code === 'ECONNREFUSED') {
    status = 503;
    message = 'Service unavailable';
    code = 'SERVICE_UNAVAILABLE';
  } else if (error.code === 'ETIMEDOUT') {
    status = 504;
    message = 'Request timeout';
    code = 'TIMEOUT';
  }

  // Custom error handling for specific GUI-LOP errors
  if (error.message.includes('Workflow paused')) {
    status = 202; // Accepted
    message = 'Workflow paused for human interaction';
    code = 'WORKFLOW_PAUSED';
    details = {
      requiresHumanInput: true,
      workflowId: error.workflowId,
      nodeId: error.nodeId,
    };
  } else if (error.message.includes('Session expired')) {
    status = 401;
    message = 'Session has expired';
    code = 'SESSION_EXPIRED';
  } else if (error.message.includes('Invalid AG-UI event')) {
    status = 400;
    message = 'Invalid AG-UI protocol event';
    code = 'INVALID_AGUI_EVENT';
    details = { eventType: error.eventType };
  } else if (error.message.includes('UI generation failed')) {
    status = 500;
    message = 'Failed to generate user interface';
    code = 'UI_GENERATION_FAILED';
    details = { componentType: error.componentType };
  }

  // Log detailed error for debugging
  if (status >= 500) {
    console.error('Server error details:', {
      error: error.message,
      stack: error.stack,
      request: {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: req.body,
        params: req.params,
        query: req.query,
      },
      session: req.session,
      user: req.user,
    });
  }

  // Prepare error response
  const errorResponse = {
    error: true,
    message,
    code,
    timestamp: new Date().toISOString(),
    requestId: req.id || generateRequestId(),
  };

  // Include details in development environment
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
    errorResponse.details = details;
    errorResponse.stack = error.stack;
    errorResponse.debug = {
      url: req.url,
      method: req.method,
      sessionId: req.sessionId,
      userId: req.user?.id,
    };
  } else {
    // In production, include safe details only
    if (Object.keys(details).length > 0) {
      errorResponse.details = sanitizeDetails(details);
    }
  }

  // Send error response
  res.status(status).json(errorResponse);
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
 * Create custom error classes
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'APP_ERROR', details = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message, details = {}) {
    super(message, 400, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409, 'CONFLICT');
    this.name = 'ConflictError';
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
    this.name = 'TooManyRequestsError';
  }
}

export class WorkflowError extends AppError {
  constructor(message, workflowId, nodeId, code = 'WORKFLOW_ERROR') {
    super(message, 500, code, { workflowId, nodeId });
    this.name = 'WorkflowError';
    this.workflowId = workflowId;
    this.nodeId = nodeId;
  }
}

export class SessionError extends AppError {
  constructor(message, sessionId, code = 'SESSION_ERROR') {
    super(message, 401, code, { sessionId });
    this.name = 'SessionError';
    this.sessionId = sessionId;
  }
}

export class AGUIProtocolError extends AppError {
  constructor(message, eventType, code = 'AGUI_PROTOCOL_ERROR') {
    super(message, 400, code, { eventType });
    this.name = 'AGUIProtocolError';
    this.eventType = eventType;
  }
}

export class UIGenerationError extends AppError {
  constructor(message, componentType, code = 'UI_GENERATION_ERROR') {
    super(message, 500, code, { componentType });
    this.name = 'UIGenerationError';
    this.componentType = componentType;
  }
}

/**
 * Utility functions
 */
function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function sanitizeDetails(details) {
  const sanitized = {};
  const allowedKeys = [
    'workflowId',
    'nodeId',
    'eventType',
    'componentType',
    'requiresHumanInput',
    'retryAfter',
    'limit',
  ];

  Object.keys(details).forEach(key => {
    if (allowedKeys.includes(key) || !key.includes('password') && !key.includes('secret') && !key.includes('token')) {
      sanitized[key] = details[key];
    }
  });

  return sanitized;
}

/**
 * 404 handler
 */
export const notFoundHandler = (req, res) => {
  res.status(404).json({
    error: true,
    message: 'Endpoint not found',
    code: 'NOT_FOUND',
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
  });
};

/**
 * Health check error handler
 */
export const healthCheckErrorHandler = (error, req, res, next) => {
  // For health check endpoints, return simple error responses
  if (req.path.startsWith('/health')) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // Use the main error handler for other endpoints
  next(error);
};

export default {
  errorHandler,
  asyncHandler,
  AppError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  TooManyRequestsError,
  WorkflowError,
  SessionError,
  AGUIProtocolError,
  UIGenerationError,
  notFoundHandler,
  healthCheckErrorHandler,
};