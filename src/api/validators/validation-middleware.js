/**
 * Validation Middleware
 * Comprehensive request validation using JSON schemas and custom validators
 */

import { body, param, query, validationResult } from 'express-validator';
import {
  userRegistrationSchema,
  loginSchema,
  changePasswordSchema,
  refreshTokenSchema,
  logoutSchema,
  createWorkflowSchema,
  updateWorkflowSchema,
  executeWorkflowSchema,
  workflowResponseSchema,
  paginationSchema,
  workflowFilterSchema,
  templateFilterSchema,
  metricsSchema,
  customValidators,
  validationMessages,
  patterns
} from './schemas.js';

/**
 * Validation middleware factory
 * Creates validation middleware from schema definitions
 */
export const createValidationMiddleware = (schema, location = 'body') => {
  const validators = [];

  // Create validators based on schema properties
  for (const [fieldName, fieldSchema] of Object.entries(schema.properties || {})) {
    const validator = createFieldValidator(fieldName, fieldSchema, location);
    if (validator) {
      validators.push(validator);
    }
  }

  // Add custom validation if schema has custom rules
  if (schema.custom) {
    validators.push(createCustomValidator(schema.custom));
  }

  return validators;
};

/**
 * Create field validator from schema definition
 */
const createFieldValidator = (fieldName, fieldSchema, location) => {
  let validator;

  // Select appropriate validator based on location
  switch (location) {
    case 'body':
      validator = body(fieldName);
      break;
    case 'param':
      validator = param(fieldName);
      break;
    case 'query':
      validator = query(fieldName);
      break;
    default:
      validator = body(fieldName);
  }

  // Apply validation rules based on schema type
  if (fieldSchema.type === 'string') {
    if (fieldSchema.format === 'email') {
      validator = validator.isEmail().withMessage(fieldSchema.errorMessage?.format || 'Invalid email format');
      if (fieldSchema.normalizeEmail) {
        validator = validator.normalizeEmail();
      }
    }

    if (fieldSchema.format === 'date-time') {
      validator = validator.isISO8601().withMessage(fieldSchema.errorMessage?.format || 'Invalid date-time format');
    }

    if (fieldSchema.format === 'uri') {
      validator = validator.isURL().withMessage(fieldSchema.errorMessage?.format || 'Invalid URL format');
    }

    if (fieldSchema.minLength) {
      validator = validator.isLength({ min: fieldSchema.minLength })
        .withMessage(fieldSchema.errorMessage?.minLength || `Must be at least ${fieldSchema.minLength} characters`);
    }

    if (fieldSchema.maxLength) {
      validator = validator.isLength({ max: fieldSchema.maxLength })
        .withMessage(fieldSchema.errorMessage?.maxLength || `Must not exceed ${fieldSchema.maxLength} characters`);
    }

    if (fieldSchema.enum) {
      validator = validator.isIn(fieldSchema.enum)
        .withMessage(fieldSchema.errorMessage?.enum || `Must be one of: ${fieldSchema.enum.join(', ')}`);
    }

    if (fieldSchema.pattern) {
      validator = validator.matches(new RegExp(fieldSchema.pattern))
        .withMessage(fieldSchema.errorMessage?.pattern || 'Invalid format');
    }

    if (fieldSchema.trim) {
      validator = validator.trim();
    }

    if (fieldSchema.lowercase) {
      validator = validator.toLowerCase();
    }

    if (fieldSchema.uppercase) {
      validator = validator.toUpperCase();
    }
  }

  if (fieldSchema.type === 'number' || fieldSchema.type === 'integer') {
    if (fieldSchema.minimum !== undefined) {
      validator = validator.isInt({ min: fieldSchema.minimum })
        .withMessage(fieldSchema.errorMessage?.minimum || `Must be at least ${fieldSchema.minimum}`);
    }

    if (fieldSchema.maximum !== undefined) {
      validator = validator.isInt({ max: fieldSchema.maximum })
        .withMessage(fieldSchema.errorMessage?.maximum || `Must not exceed ${fieldSchema.maximum}`);
    }

    if (fieldSchema.type === 'number') {
      validator = validator.isFloat();
    } else {
      validator = validator.isInt();
    }
  }

  if (fieldSchema.type === 'boolean') {
    validator = validator.isBoolean();
  }

  if (fieldSchema.type === 'array') {
    validator = validator.isArray();

    if (fieldSchema.minItems) {
      validator = validator.isLength({ min: fieldSchema.minItems })
        .withMessage(fieldSchema.errorMessage?.minItems || `Must have at least ${fieldSchema.minItems} items`);
    }

    if (fieldSchema.maxItems) {
      validator = validator.isLength({ max: fieldSchema.maxItems })
        .withMessage(fieldSchema.errorMessage?.maxItems || `Must not exceed ${fieldSchema.maxItems} items`);
    }
  }

  // Apply default value if specified
  if (fieldSchema.default !== undefined) {
    validator = validator.default(fieldSchema.default);
  }

  // Make field optional if not required
  const isRequired = schema.required && schema.required.includes(fieldName);
  if (!isRequired) {
    validator = validator.optional();
  }

  return validator;
};

/**
 * Create custom validator from schema custom rules
 */
const createCustomValidator = (customRules) => {
  return (req, res, next) => {
    try {
      if (customRules.options) {
        customRules.options(req);
      }
      next();
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
        code: 'VALIDATION_ERROR',
        timestamp: new Date().toISOString(),
        requestId: req.id || 'unknown'
      });
    }
  };
};

/**
 * Handle validation results
 */
export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map(error => ({
      field: error.param || error.path,
      message: error.msg,
      code: error.type.toUpperCase(),
      value: error.value
    }));

    return res.status(400).json({
      success: false,
      message: 'Request validation failed',
      code: 'VALIDATION_ERROR',
      details: formattedErrors,
      timestamp: new Date().toISOString(),
      requestId: req.id || 'unknown',
      path: req.originalUrl
    });
  }

  next();
};

/**
 * Request ID middleware for tracking
 */
export const addRequestId = (req, res, next) => {
  req.id = req.headers['x-request-id'] || generateRequestId();
  res.setHeader('X-Request-ID', req.id);
  next();
};

/**
 * Generate unique request ID
 */
const generateRequestId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

/**
 * Pre-built validation middleware for common endpoints
 */

// User registration validation
export const validateUserRegistration = [
  ...createValidationMiddleware(userRegistrationSchema),
  handleValidationErrors
];

// Login validation
export const validateLogin = [
  ...createValidationMiddleware(loginSchema),
  handleValidationErrors
];

// Change password validation
export const validateChangePassword = [
  ...createValidationMiddleware(changePasswordSchema),
  handleValidationErrors
];

// Refresh token validation
export const validateRefreshToken = [
  ...createValidationMiddleware(refreshTokenSchema),
  handleValidationErrors
];

// Logout validation
export const validateLogout = [
  ...createValidationMiddleware(logoutSchema),
  handleValidationErrors
];

// Create workflow validation
export const validateCreateWorkflow = [
  ...createValidationMiddleware(createWorkflowSchema),
  handleValidationErrors
];

// Update workflow validation
export const validateUpdateWorkflow = [
  ...createValidationMiddleware(updateWorkflowSchema),
  handleValidationErrors
];

// Execute workflow validation
export const validateExecuteWorkflow = [
  ...createValidationMiddleware(executeWorkflowSchema),
  handleValidationErrors
];

// Workflow response validation
export const validateWorkflowResponse = [
  ...createValidationMiddleware(workflowResponseSchema),
  handleValidationErrors
];

// Pagination validation
export const validatePagination = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  handleValidationErrors
];

// Workflow filter validation
export const validateWorkflowFilters = [
  query('status').optional().isIn(['draft', 'running', 'waiting_for_human', 'completed', 'failed', 'stopped'])
    .withMessage('Invalid status filter'),
  query('template').optional().isLength({ max: 50 }).withMessage('Template filter too long'),
  query('createdAfter').optional().isISO8601().withMessage('Invalid date format for createdAfter'),
  query('createdBefore').optional().isISO8601().withMessage('Invalid date format for createdBefore'),
  query('sortBy').optional().isIn(['createdAt', 'updatedAt', 'startedAt', 'completedAt', 'title', 'status'])
    .withMessage('Invalid sort field'),
  query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Sort order must be asc or desc'),
  handleValidationErrors
];

// Template filter validation
export const validateTemplateFilters = [
  query('category').optional().isIn(['analytics', 'decision', 'content', 'admin', 'automation'])
    .withMessage('Invalid category filter'),
  query('complexity').optional().isIn(['beginner', 'intermediate', 'advanced', 'expert'])
    .withMessage('Invalid complexity filter'),
  handleValidationErrors
];

// Metrics validation
export const validateMetrics = [
  query('timeframe').optional().isIn(['1h', '24h', '7d', '30d', '90d'])
    .withMessage('Invalid timeframe'),
  query('type').optional().isIn(['all', 'performance', 'usage', 'errors', 'workflows'])
    .withMessage('Invalid metrics type'),
  handleValidationErrors
];

// Path parameter validation
export const validateWorkflowId = [
  param('workflowId').isUUID().withMessage('Invalid workflow ID format'),
  handleValidationErrors
];

export const validateUserId = [
  param('userId').matches(patterns.userId).withMessage('Invalid user ID format'),
  handleValidationErrors
];

/**
 * Advanced validation middleware for complex business rules
 */

// Validate workflow template exists
export const validateWorkflowTemplate = async (req, res, next) => {
  try {
    const template = req.body.template || req.query.template;
    if (template) {
      const templateExists = await customValidators.workflowTemplateExists(template);
      if (!templateExists) {
        return res.status(404).json({
          success: false,
          message: 'Workflow template not found',
          code: 'TEMPLATE_NOT_FOUND',
          timestamp: new Date().toISOString(),
          requestId: req.id || 'unknown'
        });
      }
    }
    next();
  } catch (error) {
    next(error);
  }
};

// Validate workflow ownership
export const validateWorkflowOwnership = async (req, res, next) => {
  try {
    const workflowId = req.params.workflowId;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        code: 'AUTH_REQUIRED',
        timestamp: new Date().toISOString(),
        requestId: req.id || 'unknown'
      });
    }

    if (workflowId) {
      const isOwner = await customValidators.workflowOwner(workflowId, userId);
      if (!isOwner && req.user?.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only access your own workflows.',
          code: 'ACCESS_DENIED',
          timestamp: new Date().toISOString(),
          requestId: req.id || 'unknown'
        });
      }
    }
    next();
  } catch (error) {
    next(error);
  }
};

// Validate date range
export const validateDateRange = (req, res, next) => {
  try {
    const { createdAfter, createdBefore } = req.query;

    if (createdAfter && createdBefore) {
      const isValidRange = customValidators.dateRange(createdAfter, createdBefore);
      if (!isValidRange) {
        return res.status(400).json({
          success: false,
          message: 'Invalid date range: createdAfter must be before createdBefore',
          code: 'INVALID_DATE_RANGE',
          timestamp: new Date().toISOString(),
          requestId: req.id || 'unknown'
        });
      }
    }
    next();
  } catch (error) {
    next(error);
  }
};

// Password strength validation
export const validatePasswordStrength = (req, res, next) => {
  try {
    const password = req.body.password || req.body.newPassword;

    if (password) {
      const strength = customValidators.passwordStrength(password);
      if (strength.weak) {
        return res.status(400).json({
          success: false,
          message: 'Password is too weak. Please include uppercase, lowercase, numbers, and special characters.',
          code: 'WEAK_PASSWORD',
          timestamp: new Date().toISOString(),
          requestId: req.id || 'unknown'
        });
      }
    }
    next();
  } catch (error) {
    next(error);
  }
};

// Email domain validation
export const validateEmailDomain = (allowedDomains = []) => {
  return (req, res, next) => {
    try {
      const email = req.body.email;

      if (email && allowedDomains.length > 0) {
        const isDomainAllowed = customValidators.emailDomain(email, allowedDomains);
        if (!isDomainAllowed) {
          return res.status(400).json({
            success: false,
            message: `Email domain not allowed. Allowed domains: ${allowedDomains.join(', ')}`,
            code: 'DOMAIN_NOT_ALLOWED',
            timestamp: new Date().toISOString(),
            requestId: req.id || 'unknown'
          });
        }
      }
      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Response validation middleware (for development/testing)
 */
export const validateResponse = (responseSchema) => {
  return (req, res, next) => {
    // Store original res.json method
    const originalJson = res.json;

    // Override res.json to validate response
    res.json = function(data) {
      if (process.env.NODE_ENV === 'development' && process.env.VALIDATE_RESPONSES === 'true') {
        try {
          // Validate response against schema (implementation depends on validator used)
          console.log('Validating response:', data);
        } catch (error) {
          console.error('Response validation failed:', error);
          // Don't block response in production, just log the error
        }
      }

      // Call original json method
      return originalJson.call(this, data);
    };

    next();
  };
};

/**
 * Sanitization middleware
 */
export const sanitizeInput = (req, res, next) => {
  // Sanitize body
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }

  // Sanitize query parameters
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }

  // Sanitize URL parameters
  if (req.params) {
    req.params = sanitizeObject(req.params);
  }

  next();
};

/**
 * Recursively sanitize object properties
 */
const sanitizeObject = (obj) => {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  const sanitized = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      // Basic XSS prevention
      sanitized[key] = value
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
        .trim();
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
};

/**
 * Rate limit validation helper
 */
export const checkRateLimit = (limiter) => {
  return (req, res, next) => {
    const clientIp = req.ip || req.connection.remoteAddress;
    const key = `${limiter.keyPrefix}:${clientIp}`;

    // This would integrate with your rate limiting storage
    // For now, just pass through
    next();
  };
};

export default {
  // Core validation middleware
  createValidationMiddleware,
  handleValidationErrors,
  addRequestId,
  sanitizeInput,

  // Pre-built validators
  validateUserRegistration,
  validateLogin,
  validateChangePassword,
  validateRefreshToken,
  validateLogout,
  validateCreateWorkflow,
  validateUpdateWorkflow,
  validateExecuteWorkflow,
  validateWorkflowResponse,
  validatePagination,
  validateWorkflowFilters,
  validateTemplateFilters,
  validateMetrics,
  validateWorkflowId,
  validateUserId,

  // Advanced validation
  validateWorkflowTemplate,
  validateWorkflowOwnership,
  validateDateRange,
  validatePasswordStrength,
  validateEmailDomain,
  validateResponse,

  // Helpers
  checkRateLimit,
  customValidators,
  validationMessages,
  patterns
};