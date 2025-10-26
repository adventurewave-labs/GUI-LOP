/**
 * JSON Schemas for API Request/Response Validation
 * Comprehensive validation schemas for all API endpoints
 */

// Common validation patterns
const patterns = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  password: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  userId: /^user_\d+_[a-z0-9]+$/,
  token: /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/
};

// User schemas
export const userRegistrationSchema = {
  type: 'object',
  required: ['email', 'password', 'confirmPassword', 'firstName', 'lastName'],
  properties: {
    email: {
      type: 'string',
      format: 'email',
      pattern: patterns.email.source,
      minLength: 5,
      maxLength: 255,
      errorMessage: {
        format: 'Please provide a valid email address',
        minLength: 'Email must be at least 5 characters long',
        maxLength: 'Email must not exceed 255 characters'
      }
    },
    password: {
      type: 'string',
      minLength: 8,
      maxLength: 128,
      pattern: patterns.password.source,
      errorMessage: {
        minLength: 'Password must be at least 8 characters long',
        maxLength: 'Password must not exceed 128 characters',
        pattern: 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&)'
      }
    },
    confirmPassword: {
      type: 'string',
      custom: {
        options: (value, { req }) => {
          if (value !== req.body.password) {
            throw new Error('Password confirmation does not match');
          }
          return true;
        }
      }
    },
    firstName: {
      type: 'string',
      minLength: 1,
      maxLength: 50,
      pattern: /^[a-zA-Z\s'-]+$/,
      trim: true,
      errorMessage: {
        minLength: 'First name is required',
        maxLength: 'First name must not exceed 50 characters',
        pattern: 'First name can only contain letters, spaces, hyphens, and apostrophes'
      }
    },
    lastName: {
      type: 'string',
      minLength: 1,
      maxLength: 50,
      pattern: /^[a-zA-Z\s'-]+$/,
      trim: true,
      errorMessage: {
        minLength: 'Last name is required',
        maxLength: 'Last name must not exceed 50 characters',
        pattern: 'Last name can only contain letters, spaces, hyphens, and apostrophes'
      }
    },
    role: {
      type: 'string',
      enum: ['user', 'admin'],
      default: 'user',
      errorMessage: {
        enum: 'Role must be either "user" or "admin"'
      }
    }
  },
  additionalProperties: false,
  errorMessage: {
    additionalProperties: 'Only specified fields are allowed'
  }
};

export const loginSchema = {
  type: 'object',
  required: ['email', 'password'],
  properties: {
    email: {
      type: 'string',
      format: 'email',
      pattern: patterns.email.source,
      normalizeEmail: true,
      errorMessage: {
        format: 'Please provide a valid email address'
      }
    },
    password: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
      errorMessage: {
        minLength: 'Password is required',
        maxLength: 'Password must not exceed 128 characters'
      }
    },
    rememberMe: {
      type: 'boolean',
      default: false
    }
  },
  additionalProperties: false
};

export const changePasswordSchema = {
  type: 'object',
  required: ['currentPassword', 'newPassword', 'confirmPassword'],
  properties: {
    currentPassword: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
      errorMessage: {
        minLength: 'Current password is required'
      }
    },
    newPassword: {
      type: 'string',
      minLength: 8,
      maxLength: 128,
      pattern: patterns.password.source,
      errorMessage: {
        minLength: 'New password must be at least 8 characters long',
        maxLength: 'New password must not exceed 128 characters',
        pattern: 'New password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&)'
      }
    },
    confirmPassword: {
      type: 'string',
      custom: {
        options: (value, { req }) => {
          if (value !== req.body.newPassword) {
            throw new Error('Password confirmation does not match');
          }
          return true;
        }
      }
    }
  },
  additionalProperties: false,
  custom: {
    options: (req) => {
      if (req.body.currentPassword === req.body.newPassword) {
        throw new Error('New password must be different from current password');
      }
      return true;
    }
  }
};

export const refreshTokenSchema = {
  type: 'object',
  required: ['refreshToken'],
  properties: {
    refreshToken: {
      type: 'string',
      pattern: patterns.token.source,
      minLength: 50,
      maxLength: 500,
      errorMessage: {
        pattern: 'Invalid refresh token format',
        minLength: 'Refresh token is too short',
        maxLength: 'Refresh token is too long'
      }
    }
  },
  additionalProperties: false
};

export const logoutSchema = {
  type: 'object',
  properties: {
    refreshToken: {
      type: 'string',
      pattern: patterns.token.source,
      minLength: 50,
      maxLength: 500,
      errorMessage: {
        pattern: 'Invalid refresh token format'
      }
    },
    revokeAll: {
      type: 'boolean',
      default: false
    }
  },
  additionalProperties: false
};

// Workflow schemas
export const workflowContextSchema = {
  type: 'object',
  required: ['title', 'description'],
  properties: {
    title: {
      type: 'string',
      minLength: 1,
      maxLength: 200,
      trim: true,
      errorMessage: {
        minLength: 'Workflow title is required',
        maxLength: 'Workflow title must not exceed 200 characters'
      }
    },
    description: {
      type: 'string',
      minLength: 1,
      maxLength: 1000,
      trim: true,
      errorMessage: {
        minLength: 'Workflow description is required',
        maxLength: 'Workflow description must not exceed 1000 characters'
      }
    },
    dataSource: {
      type: 'string',
      maxLength: 100
    },
    parameters: {
      type: 'object',
      additionalProperties: true,
      errorMessage: {
        additionalProperties: 'Parameters must be valid JSON object'
      }
    }
  },
  additionalProperties: false
};

export const workflowSettingsSchema = {
  type: 'object',
  properties: {
    priority: {
      type: 'string',
      enum: ['low', 'normal', 'high', 'urgent'],
      default: 'normal',
      errorMessage: {
        enum: 'Priority must be one of: low, normal, high, urgent'
      }
    },
    notifyOnComplete: {
      type: 'boolean',
      default: true
    },
    timeoutMinutes: {
      type: 'integer',
      minimum: 1,
      maximum: 1440,
      default: 60,
      errorMessage: {
        minimum: 'Timeout must be at least 1 minute',
        maximum: 'Timeout must not exceed 1440 minutes (24 hours)'
      }
    },
    retryAttempts: {
      type: 'integer',
      minimum: 0,
      maximum: 5,
      default: 0,
      errorMessage: {
        minimum: 'Retry attempts must be 0 or greater',
        maximum: 'Retry attempts cannot exceed 5'
      }
    }
  },
  additionalProperties: false
};

export const createWorkflowSchema = {
  type: 'object',
  required: ['template', 'context'],
  properties: {
    template: {
      type: 'string',
      minLength: 1,
      maxLength: 50,
      pattern: /^[a-z0-9_-]+$/,
      errorMessage: {
        minLength: 'Template identifier is required',
        maxLength: 'Template identifier must not exceed 50 characters',
        pattern: 'Template identifier can only contain lowercase letters, numbers, hyphens, and underscores'
      }
    },
    context: workflowContextSchema,
    settings: workflowSettingsSchema
  },
  additionalProperties: false
};

export const updateWorkflowSchema = {
  type: 'object',
  properties: {
    context: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
          trim: true,
          errorMessage: {
            minLength: 'Workflow title must be at least 1 character',
            maxLength: 'Workflow title must not exceed 200 characters'
          }
        },
        description: {
          type: 'string',
          minLength: 1,
          maxLength: 1000,
          trim: true,
          errorMessage: {
            minLength: 'Workflow description must be at least 1 character',
            maxLength: 'Workflow description must not exceed 1000 characters'
          }
        },
        parameters: {
          type: 'object',
          additionalProperties: true
        }
      },
      additionalProperties: false,
      minProperties: 1
    },
    settings: {
      type: 'object',
      properties: {
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high', 'urgent'],
          errorMessage: {
            enum: 'Priority must be one of: low, normal, high, urgent'
          }
        },
        notifyOnComplete: {
          type: 'boolean'
        },
        timeoutMinutes: {
          type: 'integer',
          minimum: 1,
          maximum: 1440,
          errorMessage: {
            minimum: 'Timeout must be at least 1 minute',
            maximum: 'Timeout must not exceed 1440 minutes'
          }
        }
      },
      additionalProperties: false,
      minProperties: 1
    }
  },
  additionalProperties: false,
  minProperties: 1
};

export const executeWorkflowSchema = {
  type: 'object',
  properties: {
    context: {
      type: 'object',
      additionalProperties: true,
      errorMessage: {
        additionalProperties: 'Context overrides must be valid JSON object'
      }
    },
    settings: {
      type: 'object',
      properties: {
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high', 'urgent'],
          errorMessage: {
            enum: 'Priority must be one of: low, normal, high, urgent'
          }
        },
        timeoutMinutes: {
          type: 'integer',
          minimum: 1,
          maximum: 1440,
          errorMessage: {
            minimum: 'Timeout must be at least 1 minute',
            maximum: 'Timeout must not exceed 1440 minutes'
          }
        }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
};

export const workflowResponseSchema = {
  type: 'object',
  required: ['action', 'data'],
  properties: {
    action: {
      type: 'string',
      enum: ['approve', 'reject', 'request_changes', 'provide_info'],
      errorMessage: {
        enum: 'Action must be one of: approve, reject, request_changes, provide_info'
      }
    },
    data: {
      type: 'object',
      required: ['message'],
      properties: {
        message: {
          type: 'string',
          minLength: 1,
          maxLength: 1000,
          trim: true,
          errorMessage: {
            minLength: 'Response message is required',
            maxLength: 'Response message must not exceed 1000 characters'
          }
        },
        parameters: {
          type: 'object',
          additionalProperties: true
        },
        attachments: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'url', 'type'],
            properties: {
              name: {
                type: 'string',
                minLength: 1,
                maxLength: 255,
                errorMessage: {
                  minLength: 'Attachment name is required',
                  maxLength: 'Attachment name must not exceed 255 characters'
                }
              },
              url: {
                type: 'string',
                format: 'uri',
                minLength: 1,
                maxLength: 2048,
                errorMessage: {
                  format: 'Attachment URL must be a valid URI',
                  minLength: 'Attachment URL is required',
                  maxLength: 'Attachment URL must not exceed 2048 characters'
                }
              },
              type: {
                type: 'string',
                minLength: 1,
                maxLength: 100,
                pattern: /^[a-zA-Z0-9][a-zA-Z0-9!#$&\-\^_]*\/[a-zA-Z0-9][a-zA-Z0-9!#$&\-\^_.]*$/,
                errorMessage: {
                  pattern: 'Attachment type must be a valid MIME type'
                }
              }
            },
            additionalProperties: false
          },
          maxItems: 10,
          errorMessage: {
            maxItems: 'Maximum 10 attachments allowed'
          }
        }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
};

// Query parameter schemas
export const paginationSchema = {
  page: {
    in: 'query',
    type: 'integer',
    minimum: 1,
    default: 1,
    errorMessage: {
      minimum: 'Page must be 1 or greater'
    }
  },
  limit: {
    in: 'query',
    type: 'integer',
    minimum: 1,
    maximum: 100,
    default: 20,
    errorMessage: {
      minimum: 'Limit must be at least 1',
      maximum: 'Limit cannot exceed 100'
    }
  }
};

export const workflowFilterSchema = {
  status: {
    in: 'query',
    type: 'string',
    enum: ['draft', 'running', 'waiting_for_human', 'completed', 'failed', 'stopped'],
    errorMessage: {
      enum: 'Status must be one of: draft, running, waiting_for_human, completed, failed, stopped'
    }
  },
  template: {
    in: 'query',
    type: 'string',
    maxLength: 50,
    errorMessage: {
      maxLength: 'Template filter must not exceed 50 characters'
    }
  },
  createdAfter: {
    in: 'query',
    type: 'string',
    format: 'date-time',
    errorMessage: {
      format: 'createdAfter must be a valid ISO 8601 date-time'
    }
  },
  createdBefore: {
    in: 'query',
    type: 'string',
    format: 'date-time',
    errorMessage: {
      format: 'createdBefore must be a valid ISO 8601 date-time'
    }
  },
  sortBy: {
    in: 'query',
    type: 'string',
    enum: ['createdAt', 'updatedAt', 'startedAt', 'completedAt', 'title', 'status'],
    default: 'createdAt',
    errorMessage: {
      enum: 'Sort field must be one of: createdAt, updatedAt, startedAt, completedAt, title, status'
    }
  },
  sortOrder: {
    in: 'query',
    type: 'string',
    enum: ['asc', 'desc'],
    default: 'desc',
    errorMessage: {
      enum: 'Sort order must be either asc or desc'
    }
  }
};

export const templateFilterSchema = {
  category: {
    in: 'query',
    type: 'string',
    enum: ['analytics', 'decision', 'content', 'admin', 'automation'],
    errorMessage: {
      enum: 'Category must be one of: analytics, decision, content, admin, automation'
    }
  },
  complexity: {
    in: 'query',
    type: 'string',
    enum: ['beginner', 'intermediate', 'advanced', 'expert'],
    errorMessage: {
      enum: 'Complexity must be one of: beginner, intermediate, advanced, expert'
    }
  }
};

export const metricsSchema = {
  timeframe: {
    in: 'query',
    type: 'string',
    enum: ['1h', '24h', '7d', '30d', '90d'],
    default: '24h',
    errorMessage: {
      enum: 'Timeframe must be one of: 1h, 24h, 7d, 30d, 90d'
    }
  },
  type: {
    in: 'query',
    type: 'string',
    enum: ['all', 'performance', 'usage', 'errors', 'workflows'],
    default: 'all',
    errorMessage: {
      enum: 'Type must be one of: all, performance, usage, errors, workflows'
    }
  }
};

// Response validation schemas
export const apiResponseSchema = {
  success: {
    type: 'boolean',
    required: true
  },
  message: {
    type: 'string',
    minLength: 1,
    maxLength: 500,
    required: true
  },
  data: {
    type: 'object',
    required: false
  },
  metadata: {
    type: 'object',
    properties: {
      timestamp: {
        type: 'string',
        format: 'date-time',
        required: true
      },
      requestId: {
        type: 'string',
        pattern: patterns.uuid.source,
        required: true
      },
      version: {
        type: 'string',
        required: true
      },
      processingTime: {
        type: 'integer',
        minimum: 0,
        required: false
      }
    },
    required: ['timestamp', 'requestId', 'version']
  }
};

export const errorResponseSchema = {
  success: {
    type: 'boolean',
    enum: [false],
    required: true
  },
  message: {
    type: 'string',
    minLength: 1,
    maxLength: 500,
    required: true
  },
  code: {
    type: 'string',
    minLength: 1,
    maxLength: 50,
    pattern: /^[A-Z_]+$/,
    required: true
  },
  details: {
    oneOf: [
      {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              required: true
            },
            message: {
              type: 'string',
              required: true
            },
            code: {
              type: 'string',
              required: false
            }
          },
          required: ['field', 'message']
        }
      },
      {
        type: 'object',
        additionalProperties: true
      }
    ],
    required: false
  },
  timestamp: {
    type: 'string',
    format: 'date-time',
    required: true
  },
  requestId: {
    type: 'string',
    pattern: patterns.uuid.source,
    required: true
  },
  path: {
    type: 'string',
    required: false
  },
  retryAfter: {
    type: 'integer',
    minimum: 1,
    required: false
  }
};

// Custom validation functions
export const customValidators = {
  // Validate that a workflow template exists
  workflowTemplateExists: async (template) => {
    const validTemplates = [
      'data-analysis',
      'decision-making',
      'content-creation',
      'system-administration',
      'automation',
      'reporting'
    ];
    return validTemplates.includes(template);
  },

  // Validate that a user owns a workflow
  workflowOwner: async (workflowId, userId) => {
    // This would typically query the database
    // For now, return true for demo purposes
    return true;
  },

  // Validate password strength
  passwordStrength: (password) => {
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[@$!%*?&]/.test(password)) score++;

    return {
      score,
      weak: score < 3,
      medium: score >= 3 && score < 5,
      strong: score >= 5
    };
  },

  // Validate email domain (if domain restrictions are enabled)
  emailDomain: (email, allowedDomains) => {
    if (!allowedDomains || allowedDomains.length === 0) {
      return true;
    }

    const domain = email.split('@')[1].toLowerCase();
    return allowedDomains.some(allowedDomain =>
      domain === allowedDomain.toLowerCase() ||
      domain.endsWith('.' + allowedDomain.toLowerCase())
    );
  },

  // Validate UUID format
  isValidUUID: (uuid) => {
    return patterns.uuid.test(uuid);
  },

  // Validate user ID format
  isValidUserId: (userId) => {
    return patterns.userId.test(userId);
  },

  // Validate date range
  dateRange: (startDate, endDate) => {
    if (!startDate || !endDate) return true;

    const start = new Date(startDate);
    const end = new Date(endDate);

    return start < end;
  },

  // Validate file attachment
  fileAttachment: (attachment) => {
    const maxSize = 10 * 1024 * 1024; // 10MB
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'application/pdf',
      'text/plain',
      'application/json',
      'text/csv'
    ];

    return {
      validSize: attachment.size <= maxSize,
      validType: allowedTypes.includes(attachment.type),
      maxSize,
      allowedTypes
    };
  }
};

// Validation error messages
export const validationMessages = {
  common: {
    required: 'This field is required',
    invalidFormat: 'Invalid format',
    invalidType: 'Invalid type',
    tooShort: 'Value is too short',
    tooLong: 'Value is too long',
    invalidEmail: 'Please provide a valid email address',
    invalidUUID: 'Please provide a valid UUID',
    invalidUserId: 'Please provide a valid user ID'
  },
  user: {
    passwordTooWeak: 'Password is too weak. Please use a stronger password.',
    passwordMismatch: 'Password confirmation does not match',
    emailInUse: 'Email address is already in use',
    userNotFound: 'User not found',
    invalidCredentials: 'Invalid email or password',
    accountLocked: 'Account is temporarily locked due to too many failed attempts',
    accountInactive: 'Account has been deactivated'
  },
  workflow: {
    notFound: 'Workflow not found',
    accessDenied: 'Access denied. You can only access your own workflows.',
    cannotDelete: 'Workflow cannot be deleted in current status',
    alreadyRunning: 'Workflow is already running',
    notRunning: 'Workflow is not currently running',
    templateNotFound: 'Workflow template not found',
    invalidStatus: 'Invalid workflow status',
    executionFailed: 'Workflow execution failed'
  },
  system: {
    rateLimitExceeded: 'Rate limit exceeded. Please try again later.',
    serverError: 'Internal server error',
    serviceUnavailable: 'Service temporarily unavailable',
    maintenanceMode: 'System is under maintenance'
  }
};

export default {
  // Request schemas
  userRegistrationSchema,
  loginSchema,
  changePasswordSchema,
  refreshTokenSchema,
  logoutSchema,
  createWorkflowSchema,
  updateWorkflowSchema,
  executeWorkflowSchema,
  workflowResponseSchema,

  // Query schemas
  paginationSchema,
  workflowFilterSchema,
  templateFilterSchema,
  metricsSchema,

  // Response schemas
  apiResponseSchema,
  errorResponseSchema,

  // Validation helpers
  customValidators,
  validationMessages,

  // Patterns
  patterns
};