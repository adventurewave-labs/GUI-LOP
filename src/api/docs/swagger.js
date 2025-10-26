/**
 * Interactive Swagger UI Documentation
 * Comprehensive API documentation with Swagger UI integration
 */

import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import YAML from 'yamljs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Swagger configuration
 */
export const swaggerOptions = {
  definition: {
    openapi: '3.1.0',
    info: {
      title: 'GUI-LOP API',
      version: '1.0.0',
      description: `
        ## Generative UI & Human-in-the-Loop Orchestration Platform API

        This comprehensive API provides endpoints for:
        - 🔐 **Authentication** - Secure JWT-based authentication with refresh tokens
        - 🔄 **Workflow Management** - Create, execute, and manage intelligent workflows
        - 👥 **User Management** - User profiles and preferences
        - 📊 **System Monitoring** - Health checks and performance metrics
        - 🔌 **WebSocket Support** - Real-time communication and updates

        ### Getting Started

        1. **Authentication**: Most endpoints require authentication. Use the \`/api/v1/auth/login\` endpoint to obtain access tokens.
        2. **Rate Limiting**: API endpoints are rate-limited. Check response headers for rate limit information.
        3. **Error Handling**: All errors follow a consistent format with error codes for programmatic handling.
        4. **Versioning**: This API supports versioning via URL paths, headers, and content negotiation.

        ### Authentication

        The API uses JWT (JSON Web Tokens) for authentication:

        \`\`\`bash
        # Login to get tokens
        curl -X POST http://localhost:3001/api/v1/auth/login \\
          -H "Content-Type: application/json" \\
          -d '{
            "email": "user@example.com",
            "password": "SecurePass123!"
          }'

        # Use access token for authenticated requests
        curl -X GET http://localhost:3001/api/v1/workflows \\
          -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
        \`\`\`

        ### WebSocket Connection

        For real-time updates, connect to the WebSocket endpoint:

        \`\`\`javascript
        const ws = new WebSocket('ws://localhost:3001/api/v1/ws');
        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          console.log('Received:', data);
        };
        \`\`\`

        ### Rate Limiting

        API endpoints have different rate limits:
        - **Authentication**: 5 requests per 15 minutes
        - **General API**: 1000 requests per 15 minutes
        - **Workflows**: 50 creations, 100 executions per hour

        Rate limit headers are included in responses:
        - \`X-RateLimit-Limit\`: Maximum requests per window
        - \`X-RateLimit-Remaining\`: Remaining requests
        - \`X-RateLimit-Reset\`: Reset time (Unix timestamp)

        ### Error Codes

        Common error codes:
        - \`VALIDATION_ERROR\`: Request validation failed
        - \`UNAUTHORIZED\`: Authentication required
        - \`FORBIDDEN\`: Access denied
        - \`RATE_LIMIT_EXCEEDED\`: Rate limit exceeded
        - \`WORKFLOW_NOT_FOUND\`: Workflow not found
        - \`INTERNAL_ERROR\`: Server error

        For detailed error information, see the individual endpoint documentation.
      `,
      termsOfService: 'https://gui-lop.example.com/terms',
      contact: {
        name: 'API Support',
        email: 'api-support@gui-lop.example.com',
        url: 'https://gui-lop.example.com/support'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: 'http://localhost:3001/api/v1',
        description: 'Development Server',
        variables: {
          port: {
            enum: ['3001', '8080'],
            default: '3001'
          }
        }
      },
      {
        url: 'https://api.gui-lop.example.com/v1',
        description: 'Production Server'
      },
      {
        url: 'https://staging-api.gui-lop.example.com/v1',
        description: 'Staging Server'
      }
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT access token obtained from authentication endpoints'
        },
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API key for service-to-service authentication'
        }
      },
      schemas: {
        StandardResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              description: 'Whether the request was successful'
            },
            message: {
              type: 'string',
              description: 'Human-readable message'
            },
            data: {
              type: 'object',
              description: 'Response data payload'
            },
            metadata: {
              $ref: '#/components/schemas/ResponseMetadata'
            }
          },
          required: ['success', 'message']
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              enum: [false],
              description: 'Always false for error responses'
            },
            message: {
              type: 'string',
              description: 'Human-readable error message'
            },
            code: {
              type: 'string',
              description: 'Machine-readable error code'
            },
            details: {
              oneOf: [
                {
                  type: 'array',
                  items: {
                    $ref: '#/components/schemas/ValidationError'
                  }
                },
                {
                  type: 'object',
                  additionalProperties: true
                }
              ],
              description: 'Additional error details'
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              description: 'Error timestamp'
            },
            requestId: {
              type: 'string',
              format: 'uuid',
              description: 'Request identifier'
            },
            path: {
              type: 'string',
              description: 'Request path'
            }
          },
          required: ['success', 'message', 'code', 'timestamp']
        },
        ValidationError: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              description: 'Field with validation error'
            },
            message: {
              type: 'string',
              description: 'Validation error message'
            },
            code: {
              type: 'string',
              description: 'Error code for the field'
            },
            value: {
              description: 'Invalid value'
            }
          },
          required: ['field', 'message']
        },
        ResponseMetadata: {
          type: 'object',
          properties: {
            timestamp: {
              type: 'string',
              format: 'date-time',
              description: 'Response timestamp'
            },
            requestId: {
              type: 'string',
              format: 'uuid',
              description: 'Unique request identifier'
            },
            version: {
              type: 'string',
              description: 'API version'
            },
            processingTime: {
              type: 'integer',
              description: 'Processing time in milliseconds'
            }
          },
          required: ['timestamp', 'requestId', 'version']
        },
        Pagination: {
          type: 'object',
          properties: {
            page: {
              type: 'integer',
              minimum: 1,
              description: 'Current page number'
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              description: 'Items per page'
            },
            total: {
              type: 'integer',
              minimum: 0,
              description: 'Total number of items'
            },
            totalPages: {
              type: 'integer',
              minimum: 0,
              description: 'Total number of pages'
            },
            hasNext: {
              type: 'boolean',
              description: 'Whether there is a next page'
            },
            hasPrev: {
              type: 'boolean',
              description: 'Whether there is a previous page'
            }
          },
          required: ['page', 'limit', 'total', 'totalPages', 'hasNext', 'hasPrev']
        },
        User: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Unique user identifier'
            },
            email: {
              type: 'string',
              format: 'email',
              description: 'User email address'
            },
            firstName: {
              type: 'string',
              description: 'First name'
            },
            lastName: {
              type: 'string',
              description: 'Last name'
            },
            role: {
              type: 'string',
              enum: ['user', 'admin'],
              description: 'User role'
            },
            isActive: {
              type: 'boolean',
              description: 'Whether the user account is active'
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'Account creation timestamp'
            },
            lastLogin: {
              type: 'string',
              format: 'date-time',
              description: 'Last login timestamp'
            }
          },
          required: ['id', 'email', 'firstName', 'lastName', 'role', 'isActive', 'createdAt']
        },
        Workflow: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              description: 'Unique workflow identifier'
            },
            template: {
              type: 'string',
              description: 'Workflow template identifier'
            },
            context: {
              type: 'object',
              description: 'Workflow context data'
            },
            status: {
              type: 'string',
              enum: ['draft', 'running', 'waiting_for_human', 'completed', 'failed', 'stopped'],
              description: 'Current workflow status'
            },
            userId: {
              type: 'string',
              description: 'Workflow owner ID'
            },
            settings: {
              type: 'object',
              description: 'Workflow settings'
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'Workflow creation timestamp'
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
              description: 'Last update timestamp'
            },
            startedAt: {
              type: 'string',
              format: 'date-time',
              description: 'Execution start timestamp'
            },
            completedAt: {
              type: 'string',
              format: 'date-time',
              description: 'Completion timestamp'
            }
          },
          required: ['id', 'template', 'context', 'status', 'userId', 'createdAt', 'updatedAt']
        }
      }
    },
    security: [
      {
        BearerAuth: []
      },
      {
        ApiKeyAuth: []
      }
    ],
    tags: [
      {
        name: 'Authentication',
        description: 'User authentication and authorization endpoints'
      },
      {
        name: 'Workflows',
        description: 'Workflow management and execution endpoints'
      },
      {
        name: 'Users',
        description: 'User profile and management endpoints'
      },
      {
        name: 'Public',
        description: 'Public endpoints accessible without authentication'
      },
      {
        name: 'System',
        description: 'System monitoring and health check endpoints'
      },
      {
        name: 'WebSocket',
        description: 'WebSocket connection and real-time communication'
      }
    ]
  },
  apis: [
    path.join(__dirname, 'openapi.yaml'),
    path.join(__dirname, '../../../routes/*.js'),
    path.join(__dirname, '../../../middleware/*.js')
  ]
};

/**
 * Custom Swagger UI options
 */
export const swaggerUiOptions = {
  customCss: `
    .swagger-ui .topbar {
      background-color: #1a1a1a;
      border-bottom: 2px solid #0066cc;
    }
    .swagger-ui .topbar .download-url-wrapper {
      display: none;
    }
    .swagger-ui .info .title {
      color: #0066cc;
      font-size: 32px;
    }
    .swagger-ui .scheme-container {
      background: #f8f9fa;
      border: 1px solid #e9ecef;
      border-radius: 4px;
      padding: 10px;
      margin: 10px 0;
    }
    .swagger-ui .opblock {
      border-radius: 4px;
      margin-bottom: 10px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .swagger-ui .opblock.get {
      border-color: #28a745;
    }
    .swagger-ui .opblock.post {
      border-color: #007bff;
    }
    .swagger-ui .opblock.put {
      border-color: #ffc107;
    }
    .swagger-ui .opblock.delete {
      border-color: #dc3545;
    }
    .swagger-ui .highlight-code {
      background: #f8f9fa;
      border: 1px solid #e9ecef;
    }
    .swagger-ui .btn.authorize {
      background: #007bff;
      border-color: #007bff;
    }
  `,
  customSiteTitle: 'GUI-LOP API Documentation',
  customfavIcon: '/favicon.ico',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    showExtensions: true,
    showCommonExtensions: true,
    docExpansion: 'none',
    defaultModelsExpandDepth: 2,
    defaultModelExpandDepth: 2,
    tryItOutEnabled: true,
    displayOperationId: false,
    showFiltered: true,
    supportedSubmitMethods: ['get', 'post', 'put', 'delete', 'patch']
  }
};

/**
 * Load OpenAPI specification from YAML file
 */
export const loadOpenAPISpec = () => {
  try {
    const specPath = path.join(__dirname, 'openapi.yaml');
    const spec = YAML.load(specPath);
    return spec;
  } catch (error) {
    console.error('Error loading OpenAPI spec:', error);
    return null;
  }
};

/**
 * Generate Swagger JS documentation from code comments
 */
export const generateSwaggerDocs = () => {
  try {
    const specs = swaggerJsdoc(swaggerOptions);
    return specs;
  } catch (error) {
    console.error('Error generating Swagger docs:', error);
    return null;
  }
};

/**
 * Enhanced Swagger UI middleware with additional features
 */
export const createSwaggerMiddleware = (options = {}) => {
  const {
    enableAuth = true,
    enableMetrics = true,
    enableFeedback = true,
    customLogo = null,
    customCss = null
  } = options;

  // Combine default options with custom options
  const mergedOptions = {
    ...swaggerUiOptions,
    customCss: swaggerUiOptions.customCss + (customCss || ''),
    ...(customLogo && { customLogo })
  };

  // Load OpenAPI specification
  const openApiSpec = loadOpenAPISpec();

  return [
    // Add custom middleware before Swagger UI
    (req, res, next) => {
      // Add API documentation headers
      res.setHeader('X-API-Documentation', 'https://api.gui-lop.example.com/docs');
      res.setHeader('X-API-Support', 'api-support@gui-lop.example.com');

      // Log documentation access
      console.log(`API documentation accessed: ${req.method} ${req.path} from ${req.ip}`);

      next();
    },

    // Serve enhanced Swagger UI
    swaggerUi.serve,

    // Setup Swagger UI with enhanced options
    ...enableAuth ? [setupSwaggerAuth()] : [],
    ...enableMetrics ? [setupSwaggerMetrics()] : [],
    ...enableFeedback ? [setupSwaggerFeedback()] : [],

    // Final Swagger UI setup
    swaggerUi.setup(openApiSpec || generateSwaggerDocs(), mergedOptions)
  ];
};

/**
 * Setup authentication for Swagger UI
 */
const setupSwaggerAuth = () => {
  return (req, res, next) => {
    // This could integrate with your authentication system
    // For now, we'll just add some security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
  };
};

/**
 * Setup metrics collection for Swagger UI
 */
const setupSwaggerMetrics = () => {
  const metrics = {
    documentationViews: 0,
    tryItOutRequests: 0,
    endpointsAccessed: new Map()
  };

  return (req, res, next) => {
    // Track documentation views
    metrics.documentationViews++;

    // Track which endpoints are being accessed
    if (req.query.url) {
      const endpoint = new URL(req.query.url, 'http://localhost').pathname;
      metrics.endpointsAccessed.set(endpoint, (metrics.endpointsAccessed.get(endpoint) || 0) + 1);
    }

    // Store metrics for analytics
    req.swaggerMetrics = metrics;

    next();
  };
};

/**
 * Setup feedback collection for API documentation
 */
const setupSwaggerFeedback = () => {
  return (req, res, next) => {
    // Add feedback widget to Swagger UI
    if (req.path.endsWith('.json')) {
      // Add feedback metadata to OpenAPI spec
      const originalSend = res.json;
      res.json = function(data) {
        if (data && typeof data === 'object') {
          data['x-feedback'] = {
            enabled: true,
            endpoint: '/api/v1/feedback',
            support: 'api-support@gui-lop.example.com'
          };
        }
        return originalSend.call(this, data);
      };
    }

    next();
  };
};

/**
 * API documentation routes
 */
export const createDocumentationRoutes = (app) => {
  // Main documentation endpoint
  app.get('/api/v1/docs', createSwaggerMiddleware({
    enableAuth: true,
    enableMetrics: true,
    enableFeedback: true
  }));

  // JSON specification endpoint
  app.get('/api/v1/docs/swagger.json', (req, res) => {
    const spec = loadOpenAPISpec() || generateSwaggerDocs();

    // Add dynamic information
    spec.info.version = process.env.API_VERSION || '1.0.0';
    spec.servers[0].url = `${req.protocol}://${req.get('host')}/api/v1`;

    res.json(spec);
  });

  // YAML specification endpoint
  app.get('/api/v1/docs/swagger.yaml', (req, res) => {
    const spec = loadOpenAPISpec() || generateSwaggerDocs();

    // Add dynamic information
    spec.info.version = process.env.API_VERSION || '1.0.0';
    spec.servers[0].url = `${req.protocol}://${req.get('host')}/api/v1`;

    res.setHeader('Content-Type', 'application/x-yaml');
    res.send(YAML.stringify(spec));
  });

  // OpenAPI specification in different formats
  app.get('/api/v1/docs/openapi.json', (req, res) => {
    const spec = loadOpenAPISpec();
    if (spec) {
      res.json(spec);
    } else {
      res.status(404).json({
        success: false,
        message: 'OpenAPI specification not found',
        code: 'SPEC_NOT_FOUND'
      });
    }
  });

  // Redirect root docs to Swagger UI
  app.get('/api/docs', (req, res) => {
    res.redirect('/api/v1/docs');
  });

  app.get('/docs', (req, res) => {
    res.redirect('/api/v1/docs');
  });

  // Documentation health check
  app.get('/api/v1/docs/health', (req, res) => {
    res.json({
      success: true,
      message: 'API documentation is healthy',
      data: {
        swaggerUi: true,
        openApiSpec: true,
        version: '1.0.0',
        endpoints: [
          '/api/v1/docs',
          '/api/v1/docs/swagger.json',
          '/api/v1/docs/swagger.yaml'
        ]
      },
      timestamp: new Date().toISOString()
    });
  });

  // Postman collection generation
  app.get('/api/v1/docs/postman', (req, res) => {
    const spec = loadOpenAPISpec() || generateSwaggerDocs();
    const postmanCollection = convertToPostmanCollection(spec);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="gui-lop-api.postman_collection.json"');
    res.json(postmanCollection);
  });
};

/**
 * Convert OpenAPI spec to Postman collection
 */
const convertToPostmanCollection = (openApiSpec) => {
  const collection = {
    info: {
      name: openApiSpec.info.title,
      description: openApiSpec.info.description,
      version: openApiSpec.info.version,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    item: []
  };

  // Convert OpenAPI paths to Postman items
  for (const [path, pathItem] of Object.entries(openApiSpec.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (['get', 'post', 'put', 'delete', 'patch'].includes(method)) {
        const item = {
          name: operation.summary || `${method.toUpperCase()} ${path}`,
          request: {
            method: method.toUpperCase(),
            header: [],
            url: {
              raw: '{{baseUrl}}' + path,
              host: ['{{baseUrl}}'],
              path: path.split('/').filter(Boolean)
            }
          },
          response: []
        };

        // Add headers
        if (operation.parameters) {
          for (const param of operation.parameters) {
            if (param.in === 'header') {
              item.request.header.push({
                key: param.name,
                value: '',
                description: param.description
              });
            }
          }
        }

        // Add authentication
        if (operation.security && operation.security.length > 0) {
          const authScheme = operation.security[0];
          if (authScheme.BearerAuth) {
            item.request.auth = {
              type: 'bearer',
              bearer: [
                {
                  key: 'token',
                  value: '{{accessToken}}',
                  type: 'string'
                }
              ]
            };
          }
        }

        // Add request body if present
        if (operation.requestBody) {
          item.request.body = {
            mode: 'raw',
            raw: JSON.stringify(operation.requestBody.content['application/json'].schema, null, 2),
            options: {
              raw: {
                language: 'json'
              }
            }
          };
        }

        collection.item.push(item);
      }
    }
  };

  // Add variables
  collection.variable = [
    {
      key: 'baseUrl',
      value: 'http://localhost:3001/api/v1',
      type: 'string'
    },
    {
      key: 'accessToken',
      value: '',
      type: 'string'
    }
  ];

  return collection;
};

export default {
  // Configuration
  swaggerOptions,
  swaggerUiOptions,

  // Core functions
  loadOpenAPISpec,
  generateSwaggerDocs,
  createSwaggerMiddleware,
  createDocumentationRoutes,

  // Utilities
  convertToPostmanCollection
};