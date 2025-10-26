/**
 * Database Error Handler
 * Comprehensive error handling and logging for database operations
 */

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Custom database error classes
 */
class DatabaseError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'DatabaseError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      details: this.details,
      timestamp: this.timestamp,
      stack: this.stack
    };
  }
}

class ConnectionError extends DatabaseError {
  constructor(message, details = {}) {
    super(message, 'CONNECTION_ERROR', details);
    this.name = 'ConnectionError';
  }
}

class QueryError extends DatabaseError {
  constructor(message, query, params, details = {}) {
    super(message, 'QUERY_ERROR', {
      ...details,
      query: query.substring(0, 200), // Truncate long queries for logs
      paramsCount: params ? params.length : 0
    });
    this.name = 'QueryError';
    this.originalQuery = query;
    this.originalParams = params;
  }
}

class TransactionError extends DatabaseError {
  constructor(message, details = {}) {
    super(message, 'TRANSACTION_ERROR', details);
    this.name = 'TransactionError';
  }
}

class ConstraintViolationError extends DatabaseError {
  constructor(message, constraint, details = {}) {
    super(message, 'CONSTRAINT_VIOLATION', {
      ...details,
      constraint
    });
    this.name = 'ConstraintViolationError';
  }
}

class MigrationError extends DatabaseError {
  constructor(message, details = {}) {
    super(message, 'MIGRATION_ERROR', details);
    this.name = 'MigrationError';
  }
}

/**
 * Database error handler utility
 */
class DatabaseErrorHandler {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.enableStackTrace = options.enableStackTrace || false;
    this.sanitizeQueries = options.sanitizeQueries !== false; // Default to true
    this.maxQueryLength = options.maxQueryLength || 200;
    this.retryAttempts = options.retryAttempts || 3;
    this.retryDelay = options.retryDelay || 1000; // ms
  }

  /**
   * Handle and classify database errors
   */
  handleError(error, context = {}) {
    const { query, params, operation, table } = context;

    // PostgreSQL error codes mapping
    const errorClassification = this.classifyError(error);

    // Create appropriate error instance
    let dbError;

    switch (errorClassification.type) {
      case 'CONNECTION':
        dbError = new ConnectionError(errorClassification.message, {
          originalError: error.message,
          code: error.code,
          severity: error.severity,
          ...context
        });
        break;

      case 'CONSTRAINT':
        dbError = new ConstraintViolationError(errorClassification.message, errorClassification.constraint, {
          originalError: error.message,
          code: error.code,
          ...context
        });
        break;

      case 'TRANSACTION':
        dbError = new TransactionError(errorClassification.message, {
          originalError: error.message,
          code: error.code,
          ...context
        });
        break;

      case 'QUERY':
      default:
        dbError = new QueryError(errorClassification.message, query, params, {
          originalError: error.message,
          code: error.code,
          severity: error.severity,
          table,
          operation,
          ...context
        });
        break;
    }

    // Log the error
    this.logError(dbError, errorClassification.severity);

    return dbError;
  }

  /**
   * Classify PostgreSQL errors based on error codes
   */
  classifyError(error) {
    const code = error.code;
    const message = error.message;

    // Connection errors
    if (this.isConnectionError(code, message)) {
      return {
        type: 'CONNECTION',
        severity: 'critical',
        message: `Database connection error: ${message}`,
        retryable: true
      };
    }

    // Constraint violations
    if (this.isConstraintError(code)) {
      const constraint = this.extractConstraintName(message);
      return {
        type: 'CONSTRAINT',
        severity: 'warning',
        message: `Constraint violation: ${constraint}`,
        constraint,
        retryable: false
      };
    }

    // Transaction errors
    if (this.isTransactionError(code)) {
      return {
        type: 'TRANSACTION',
        severity: 'error',
        message: `Transaction error: ${message}`,
        retryable: true
      };
    }

    // Query errors
    return {
      type: 'QUERY',
      severity: 'error',
      message: `Query error: ${message}`,
      retryable: false
    };
  }

  /**
   * Check if error is a connection error
   */
  isConnectionError(code, message) {
    const connectionErrorCodes = [
      'ECONNREFUSED',
      'ENOTFOUND',
      'ETIMEDOUT',
      '08006', // connection_failure
      '08001', // sqlclient_unable_to_establish_sqlconnection
      '08004', // sqlserver_rejected_establishment_of_sqlconnection
      '08003', // connection_does_not_exist
      '57P01', // admin_shutdown
      '57P02', // crash_shutdown
      '57P03'  // cannot_connect_now
    ];

    return connectionErrorCodes.includes(code) ||
           message.toLowerCase().includes('connection') ||
           message.toLowerCase().includes('timeout') ||
           message.toLowerCase().includes('network');
  }

  /**
   * Check if error is a constraint violation
   */
  isConstraintError(code) {
    const constraintErrorCodes = [
      '23000', // integrity_constraint_violation
      '23502', // not_null_violation
      '23503', // foreign_key_violation
      '23505', // unique_violation
      '23514', // check_violation
      '23P01', // exclusion_violation
      '40001', // serialization_failure
      '40P01'  // deadlock_detected
    ];

    return constraintErrorCodes.includes(code);
  }

  /**
   * Check if error is a transaction error
   */
  isTransactionError(code) {
    const transactionErrorCodes = [
      '25P01', // no_active_sql_transaction
      '25P02', // in_failed_sql_transaction
      '25001', // no_sql_transaction_in_progress
      '25006', // read_only_sql_transaction
      '25008'  // idle_in_transaction_session_timeout
    ];

    return transactionErrorCodes.includes(code);
  }

  /**
   * Extract constraint name from error message
   */
  extractConstraintName(message) {
    const match = message.match(/constraint ["']([^"']+)["']/i);
    return match ? match[1] : 'unknown';
  }

  /**
   * Log error with appropriate level
   */
  logError(error, severity) {
    const logData = {
      timestamp: error.timestamp,
      type: error.name,
      code: error.code,
      message: error.message,
      details: error.details
    };

    if (this.enableStackTrace) {
      logData.stack = error.stack;
    }

    switch (severity) {
      case 'critical':
        this.logger.error('🚨 CRITICAL DATABASE ERROR:', logData);
        break;
      case 'error':
        this.logger.error('❌ DATABASE ERROR:', logData);
        break;
      case 'warning':
        this.logger.warn('⚠️  DATABASE WARNING:', logData);
        break;
      default:
        this.logger.info('ℹ️  DATABASE INFO:', logData);
    }
  }

  /**
   * Sanitize query for logging (remove sensitive data)
   */
  sanitizeQuery(query) {
    if (!this.sanitizeQueries) {
      return query;
    }

    return query
      .replace(/password\s*=\s*['"][^'"]*['"]/gi, "password = '***'")
      .replace(/token\s*=\s*['"][^'"]*['"]/gi, "token = '***'")
      .replace(/secret\s*=\s*['"][^'"]*['"]/gi, "secret = '***'")
      .replace(/key\s*=\s*['"][^'"]*['"]/gi, "key = '***'")
      .substring(0, this.maxQueryLength);
  }

  /**
   * Execute operation with retry logic
   */
  async withRetry(operation, context = {}) {
    let lastError;

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = this.handleError(error, context);

        if (attempt === this.retryAttempts || !lastError.details.retryable) {
          throw lastError;
        }

        const delay = this.retryDelay * attempt; // Exponential backoff
        this.logger.warn(`Retrying operation in ${delay}ms (attempt ${attempt}/${this.retryAttempts})`);

        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Create error response for API
   */
  createErrorResponse(error, includeDetails = false) {
    const response = {
      success: false,
      error: {
        type: error.name,
        code: error.code,
        message: error.message,
        timestamp: error.timestamp
      }
    };

    if (includeDetails && error.details) {
      response.error.details = { ...error.details };
      // Remove sensitive information from details
      delete response.error.details.originalParams;
      delete response.error.details.originalQuery;
    }

    return response;
  }

  /**
   * Wrap database operation with error handling
   */
  async wrapOperation(operation, context = {}) {
    try {
      return await operation();
    } catch (error) {
      throw this.handleError(error, context);
    }
  }

  /**
   * Health check for database
   */
  async healthCheck(db) {
    try {
      const result = await db.query('SELECT 1 as health_check');
      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        details: {
          queryTime: result.queryTime || 'unknown'
        }
      };
    } catch (error) {
      const dbError = this.handleError(error, { operation: 'health_check' });
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: {
          type: dbError.name,
          message: dbError.message
        }
      };
    }
  }
}

/**
 * Error middleware for Express.js
 */
function createErrorMiddleware(errorHandler) {
  return (error, req, res, next) => {
    // If it's already a database error, use it directly
    if (error instanceof DatabaseError) {
      const statusCode = getStatusCodeForError(error);
      const response = errorHandler.createErrorResponse(error, req.app.get('env') === 'development');

      return res.status(statusCode).json(response);
    }

    // Wrap other errors as database errors if they seem related
    if (isDatabaseRelatedError(error)) {
      const dbError = errorHandler.handleError(error, {
        operation: req.method,
        path: req.path,
        user: req.user?.id
      });

      const statusCode = getStatusCodeForError(dbError);
      const response = errorHandler.createErrorResponse(dbError, req.app.get('env') === 'development');

      return res.status(statusCode).json(response);
    }

    // Pass to next error handler
    next(error);
  };
}

function getStatusCodeForError(error) {
  switch (error.name) {
    case 'ConnectionError':
      return 503; // Service Unavailable
    case 'ConstraintViolationError':
      return 400; // Bad Request
    case 'TransactionError':
      return 409; // Conflict
    case 'QueryError':
      return 500; // Internal Server Error
    default:
      return 500;
  }
}

function isDatabaseRelatedError(error) {
  const databaseKeywords = [
    'database', 'sql', 'query', 'connection', 'pool',
    'pg', 'postgresql', 'timeout', 'constraint'
  ];

  const errorMessage = error.message.toLowerCase();
  return databaseKeywords.some(keyword => errorMessage.includes(keyword));
}

// Create default error handler instance
const defaultErrorHandler = new DatabaseErrorHandler({
  enableStackTrace: process.env.NODE_ENV === 'development',
  sanitizeQueries: true,
  maxQueryLength: 200,
  retryAttempts: 3,
  retryDelay: 1000
});

export {
  DatabaseError,
  ConnectionError,
  QueryError,
  TransactionError,
  ConstraintViolationError,
  MigrationError,
  DatabaseErrorHandler,
  createErrorMiddleware,
  defaultErrorHandler
};

export default defaultErrorHandler;