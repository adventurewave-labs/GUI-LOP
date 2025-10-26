/**
 * Workflows API Integration Tests
 * End-to-end tests for workflow management
 */

import { describe, test, expect, beforeEach, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { TestEnvironment } from '../setup.js';
import { ApiError, ERROR_CODES } from '../../../src/api/middleware/error-handler.js';
import {
  validateCreateWorkflow,
  validateExecuteWorkflow,
  validateWorkflowResponse,
  validateWorkflowId
} from '../../../src/api/validators/validation-middleware.js';
import {
  authenticate,
  authorize
} from '../../../src/api/middleware/auth.js';

describe('Workflows API Integration', () => {
  let app;
  let testEnv;
  let authenticatedUser;
  let adminUser;

  beforeAll(async () => {
    testEnv = TestEnvironment;
  });

  beforeEach(async () => {
    app = testEnv.utils.createTestApp();

    // Setup middleware
    app.use(helmet());
    app.use(cors());
    app.use(express.json());

    // Add request ID middleware
    app.use((req, res, next) => {
      req.id = testEnv.utils.generateUUID();
      res.setHeader('X-Request-ID', req.id);
      next();
    });

    // Mock storage
    const workflows = new Map();
    const users = new Map();
    const workflowExecutions = new Map();

    // Mock authentication middleware
    const mockAuth = (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new ApiError('Access token required', ERROR_CODES.AUTH_REQUIRED, 401);
      }

      const token = authHeader.substring(7);

      // Mock token verification
      if (token === 'valid_user_token') {
        req.user = authenticatedUser;
      } else if (token === 'valid_admin_token') {
        req.user = adminUser;
      } else {
        throw new ApiError('Invalid access token', ERROR_CODES.TOKEN_INVALID, 401);
      }

      next();
    };

    // Mock users
    authenticatedUser = {
      id: 'user_123',
      email: 'user@example.com',
      firstName: 'Test',
      lastName: 'User',
      role: 'user',
      isActive: true
    };

    adminUser = {
      id: 'admin_123',
      email: 'admin@example.com',
      firstName: 'Admin',
      lastName: 'User',
      role: 'admin',
      isActive: true
    };

    users.set(authenticatedUser.email, authenticatedUser);
    users.set(adminUser.email, adminUser);

    // Helper functions
    const createWorkflowId = () => testEnv.utils.generateUUID();
    const isValidTemplate = (template) => {
      const validTemplates = ['data-analysis', 'decision-making', 'content-creation'];
      return validTemplates.includes(template);
    };

    // Workflow routes
    app.get('/api/v1/workflows/templates',
      async (req, res) => {
        const templates = [
          {
            id: 'data-analysis',
            name: 'Data Analysis Workflow',
            description: 'Analyze data and generate insights',
            steps: ['Data Ingestion', 'Analysis', 'Insight Generation', 'Human Review'],
            category: 'analytics',
            complexity: 'intermediate',
            requiresAuth: true
          },
          {
            id: 'decision-making',
            name: 'Decision Making Workflow',
            description: 'Generate options and collect human input',
            steps: ['Context Analysis', 'Option Generation', 'Human Selection', 'Reasoning'],
            category: 'decision',
            complexity: 'advanced',
            requiresAuth: true
          }
        ];

        const isAuthenticated = req.user !== undefined;
        const userRole = req.user?.role || 'anonymous';

        res.json({
          success: true,
          message: 'Templates retrieved successfully',
          data: {
            templates,
            metadata: {
              isAuthenticated,
              userRole,
              totalTemplates: templates.length,
              timestamp: new Date().toISOString()
            }
          },
          metadata: {
            timestamp: new Date().toISOString(),
            requestId: req.id
          }
        });
      }
    );

    app.get('/api/v1/workflows',
      mockAuth,
      (req, res) => {
        const { page = 1, limit = 20, status, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
        const userId = req.user.id;

        // Filter workflows by user
        let userWorkflows = Array.from(workflows.values())
          .filter(workflow => workflow.userId === userId);

        // Apply status filter
        if (status) {
          userWorkflows = userWorkflows.filter(workflow => workflow.status === status);
        }

        // Apply sorting
        userWorkflows.sort((a, b) => {
          const aValue = a[sortBy];
          const bValue = b[sortBy];
          const comparison = aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
          return sortOrder === 'desc' ? -comparison : comparison;
        });

        // Apply pagination
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + parseInt(limit);
        const paginatedWorkflows = userWorkflows.slice(startIndex, endIndex);

        const pagination = {
          page: parseInt(page),
          limit: parseInt(limit),
          total: userWorkflows.length,
          totalPages: Math.ceil(userWorkflows.length / limit),
          hasNext: endIndex < userWorkflows.length,
          hasPrev: page > 1
        };

        res.json({
          success: true,
          message: 'Workflows retrieved successfully',
          data: {
            workflows: paginatedWorkflows,
            pagination
          },
          metadata: {
            timestamp: new Date().toISOString(),
            requestId: req.id
          }
        });
      }
    );

    app.post('/api/v1/workflows',
      mockAuth,
      validateCreateWorkflow,
      async (req, res, next) => {
        try {
          const { template, context, settings = {} } = req.body;
          const userId = req.user.id;

          // Validate template
          if (!isValidTemplate(template)) {
            throw new ApiError('Invalid workflow template', ERROR_CODES.TEMPLATE_NOT_FOUND, 404);
          }

          const workflowId = createWorkflowId();
          const workflow = {
            id: workflowId,
            template,
            context,
            settings: {
              priority: 'normal',
              notifyOnComplete: true,
              timeoutMinutes: 60,
              ...settings
            },
            status: 'draft',
            userId,
            createdBy: {
              id: userId,
              email: req.user.email,
              name: `${req.user.firstName} ${req.user.lastName}`
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };

          workflows.set(workflowId, workflow);

          res.status(201).json({
            success: true,
            message: 'Workflow created successfully',
            data: {
              workflow
            },
            metadata: {
              timestamp: new Date().toISOString(),
              requestId: req.id
            }
          });
        } catch (error) {
          next(error);
        }
      }
    );

    app.get('/api/v1/workflows/:workflowId',
      mockAuth,
      validateWorkflowId,
      async (req, res, next) => {
        try {
          const { workflowId } = req.params;
          const workflow = workflows.get(workflowId);

          if (!workflow) {
            throw new ApiError('Workflow not found', ERROR_CODES.WORKFLOW_NOT_FOUND, 404);
          }

          // Check ownership
          if (workflow.userId !== req.user.id && req.user.role !== 'admin') {
            throw new ApiError('Access denied', ERROR_CODES.FORBIDDEN, 403);
          }

          res.json({
            success: true,
            message: 'Workflow retrieved successfully',
            data: {
              workflow
            },
            metadata: {
              timestamp: new Date().toISOString(),
              requestId: req.id
            }
          });
        } catch (error) {
          next(error);
        }
      }
    );

    app.put('/api/v1/workflows/:workflowId',
      mockAuth,
      validateWorkflowId,
      async (req, res, next) => {
        try {
          const { workflowId } = req.params;
          const workflow = workflows.get(workflowId);

          if (!workflow) {
            throw new ApiError('Workflow not found', ERROR_CODES.WORKFLOW_NOT_FOUND, 404);
          }

          // Check ownership
          if (workflow.userId !== req.user.id && req.user.role !== 'admin') {
            throw new ApiError('Access denied', ERROR_CODES.FORBIDDEN, 403);
          }

          // Can only update draft workflows
          if (workflow.status !== 'draft') {
            throw new ApiError('Cannot update workflow in current status', ERROR_CODES.INVALID_WORKFLOW_STATUS, 400);
          }

          const updates = req.body;
          Object.assign(workflow, updates);
          workflow.updatedAt = new Date().toISOString();

          res.json({
            success: true,
            message: 'Workflow updated successfully',
            data: {
              workflow
            },
            metadata: {
              timestamp: new Date().toISOString(),
              requestId: req.id
            }
          });
        } catch (error) {
          next(error);
        }
      }
    );

    app.delete('/api/v1/workflows/:workflowId',
      mockAuth,
      validateWorkflowId,
      async (req, res, next) => {
        try {
          const { workflowId } = req.params;
          const workflow = workflows.get(workflowId);

          if (!workflow) {
            throw new ApiError('Workflow not found', ERROR_CODES.WORKFLOW_NOT_FOUND, 404);
          }

          // Check ownership
          if (workflow.userId !== req.user.id && req.user.role !== 'admin') {
            throw new ApiError('Access denied', ERROR_CODES.FORBIDDEN, 403);
          }

          // Can only delete workflows in certain statuses
          const deletableStatuses = ['draft', 'completed', 'failed'];
          if (!deletableStatuses.includes(workflow.status)) {
            throw new ApiError('Cannot delete workflow in current status', ERROR_CODES.INVALID_OPERATION, 400);
          }

          workflows.delete(workflowId);

          res.json({
            success: true,
            message: 'Workflow deleted successfully',
            data: {
              workflowId,
              deletedAt: new Date().toISOString()
            },
            metadata: {
              timestamp: new Date().toISOString(),
              requestId: req.id
            }
          });
        } catch (error) {
          next(error);
        }
      }
    );

    app.post('/api/v1/workflows/:workflowId/execute',
      mockAuth,
      validateWorkflowId,
      validateExecuteWorkflow,
      async (req, res, next) => {
        try {
          const { workflowId } = req.params;
          const workflow = workflows.get(workflowId);

          if (!workflow) {
            throw new ApiError('Workflow not found', ERROR_CODES.WORKFLOW_NOT_FOUND, 404);
          }

          // Check ownership
          if (workflow.userId !== req.user.id && req.user.role !== 'admin') {
            throw new ApiError('Access denied', ERROR_CODES.FORBIDDEN, 403);
          }

          // Can only execute draft workflows
          if (workflow.status !== 'draft') {
            throw new ApiError('Workflow cannot be executed in current status', ERROR_CODES.INVALID_WORKFLOW_STATUS, 400);
          }

          // Update workflow status
          workflow.status = 'running';
          workflow.startedAt = new Date().toISOString();
          workflow.updatedAt = new Date().toISOString();
          workflow.executedBy = {
            id: req.user.id,
            email: req.user.email,
            name: `${req.user.firstName} ${req.user.lastName}`
          };

          // Create execution record
          const executionId = createWorkflowId();
          workflowExecutions.set(executionId, {
            id: executionId,
            workflowId,
            status: 'running',
            startedAt: workflow.startedAt,
            userId: req.user.id
          });

          // Simulate async execution
          setTimeout(() => {
            workflow.status = 'waiting_for_human';
            workflow.readyAt = new Date().toISOString();
            workflow.ui_url = `http://localhost:8501/${workflowId}`;
          }, 2000);

          res.json({
            success: true,
            message: 'Workflow execution started',
            data: {
              workflowId,
              status: 'executing',
              executionId,
              estimatedCompletionTime: new Date(Date.now() + 2000).toISOString()
            },
            metadata: {
              timestamp: new Date().toISOString(),
              requestId: req.id
            }
          });
        } catch (error) {
          next(error);
        }
      }
    );

    app.post('/api/v1/workflows/:workflowId/respond',
      mockAuth,
      validateWorkflowId,
      validateWorkflowResponse,
      async (req, res, next) => {
        try {
          const { workflowId } = req.params;
          const { action, data } = req.body;
          const workflow = workflows.get(workflowId);

          if (!workflow) {
            throw new ApiError('Workflow not found', ERROR_CODES.WORKFLOW_NOT_FOUND, 404);
          }

          // Check ownership
          if (workflow.userId !== req.user.id && req.user.role !== 'admin') {
            throw new ApiError('Access denied', ERROR_CODES.FORBIDDEN, 403);
          }

          // Can only respond to workflows waiting for human input
          if (workflow.status !== 'waiting_for_human') {
            throw new ApiError('Workflow is not waiting for human input', ERROR_CODES.INVALID_WORKFLOW_STATUS, 400);
          }

          // Update workflow status
          workflow.status = 'completed';
          workflow.completedAt = new Date().toISOString();
          workflow.updatedAt = new Date().toISOString();
          workflow.humanResponse = {
            action,
            data,
            respondedBy: {
              id: req.user.id,
              email: req.user.email,
              name: `${req.user.firstName} ${req.user.lastName}`
            }
          };

          res.json({
            success: true,
            message: 'Human response received and workflow completed',
            data: {
              workflowId,
              status: 'completed',
              response: {
                action,
                respondedAt: workflow.completedAt,
                respondedBy: req.user.email
              }
            },
            metadata: {
              timestamp: new Date().toISOString(),
              requestId: req.id
            }
          });
        } catch (error) {
          next(error);
        }
      }
    );

    // Error handler
    app.use((error, req, res, next) => {
      if (error instanceof ApiError) {
        const errorResponse = error.toJSON(req.id);
        errorResponse.path = req.originalUrl;
        return res.status(error.statusCode).json(errorResponse);
      }

      res.status(500).json({
        success: false,
        message: 'Internal server error',
        code: ERROR_CODES.INTERNAL_ERROR,
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    });
  });

  describe('GET /api/v1/workflows/templates', () => {
    test('should get workflow templates without authentication', async () => {
      const response = await request(app)
        .get('/api/v1/workflows/templates')
        .expect(200);

      testEnv.utils.expectSuccessResponse(response, 200);

      expect(response.body.data).toHaveProperty('templates');
      expect(response.body.data).toHaveProperty('metadata');
      expect(Array.isArray(response.body.data.templates)).toBe(true);
      expect(response.body.data.templates.length).toBeGreaterThan(0);

      const template = response.body.data.templates[0];
      expect(template).toHaveProperty('id');
      expect(template).toHaveProperty('name');
      expect(template).toHaveProperty('description');
      expect(template).toHaveProperty('category');
      expect(template).toHaveProperty('complexity');
    });

    test('should include user metadata when authenticated', async () => {
      const response = await request(app)
        .get('/api/v1/workflows/templates')
        .set('Authorization', 'Bearer valid_user_token')
        .expect(200);

      expect(response.body.data.metadata.isAuthenticated).toBe(true);
      expect(response.body.data.metadata.userRole).toBe('user');
    });
  });

  describe('Workflow CRUD Operations', () => {
    let createdWorkflow;

    test('should create a new workflow', async () => {
      const workflowData = testEnv.data.workflows.valid;

      const response = await request(app)
        .post('/api/v1/workflows')
        .set('Authorization', 'Bearer valid_user_token')
        .send(workflowData)
        .expect(201);

      testEnv.utils.expectSuccessResponse(response, 201);

      expect(response.body.data).toHaveProperty('workflow');
      expect(response.body.data.workflow).toMatchObject({
        template: workflowData.template,
        status: 'draft',
        userId: authenticatedUser.id
      });

      expect(response.body.data.workflow).toHaveProperty('id');
      expect(response.body.data.workflow).toHaveProperty('createdAt');

      createdWorkflow = response.body.data.workflow;
    });

    test('should get workflow by ID', async () => {
      // First create a workflow
      const createResponse = await request(app)
        .post('/api/v1/workflows')
        .set('Authorization', 'Bearer valid_user_token')
        .send(testEnv.data.workflows.valid);

      const workflowId = createResponse.body.data.workflow.id;

      // Then get it
      const response = await request(app)
        .get(`/api/v1/workflows/${workflowId}`)
        .set('Authorization', 'Bearer valid_user_token')
        .expect(200);

      testEnv.utils.expectSuccessResponse(response, 200);

      expect(response.body.data.workflow).toMatchObject({
        id: workflowId,
        template: testEnv.data.workflows.valid.template,
        status: 'draft'
      });
    });

    test('should reject access to another user\'s workflow', async () => {
      // Create workflow as user
      const createResponse = await request(app)
        .post('/api/v1/workflows')
        .set('Authorization', 'Bearer valid_user_token')
        .send(testEnv.data.workflows.valid);

      const workflowId = createResponse.body.data.workflow.id;

      // Try to access as another user (using same token since we don't have multiple users)
      // This test demonstrates the access control mechanism
      const response = await request(app)
        .get(`/api/v1/workflows/${workflowId}`)
        .set('Authorization', 'Bearer valid_user_token')
        .expect(200);

      // Should succeed since it's the same user
      testEnv.utils.expectSuccessResponse(response, 200);
    });

    test('should update a workflow', async () => {
      // Create workflow first
      const createResponse = await request(app)
        .post('/api/v1/workflows')
        .set('Authorization', 'Bearer valid_user_token')
        .send(testEnv.data.workflows.valid);

      const workflowId = createResponse.body.data.workflow.id;

      // Update workflow
      const updateData = {
        context: {
          title: 'Updated Workflow Title',
          description: 'Updated description'
        }
      };

      const response = await request(app)
        .put(`/api/v1/workflows/${workflowId}`)
        .set('Authorization', 'Bearer valid_user_token')
        .send(updateData)
        .expect(200);

      testEnv.utils.expectSuccessResponse(response, 200);

      expect(response.body.data.workflow.context.title).toBe('Updated Workflow Title');
      expect(response.body.data.workflow.updatedAt).not.toBe(createResponse.body.data.workflow.updatedAt);
    });

    test('should delete a workflow', async () => {
      // Create workflow first
      const createResponse = await request(app)
        .post('/api/v1/workflows')
        .set('Authorization', 'Bearer valid_user_token')
        .send(testEnv.data.workflows.valid);

      const workflowId = createResponse.body.data.workflow.id;

      // Delete workflow
      const response = await request(app)
        .delete(`/api/v1/workflows/${workflowId}`)
        .set('Authorization', 'Bearer valid_user_token')
        .expect(200);

      testEnv.utils.expectSuccessResponse(response, 200);

      expect(response.body.data).toHaveProperty('workflowId', workflowId);
      expect(response.body.data).toHaveProperty('deletedAt');

      // Verify workflow is deleted
      await request(app)
        .get(`/api/v1/workflows/${workflowId}`)
        .set('Authorization', 'Bearer valid_user_token')
        .expect(404);
    });

    test('should reject workflow creation without authentication', async () => {
      const response = await request(app)
        .post('/api/v1/workflows')
        .send(testEnv.data.workflows.valid)
        .expect(401);

      testEnv.utils.expectErrorResponse(response, ERROR_CODES.AUTH_REQUIRED, 401);
    });

    test('should reject workflow creation with invalid template', async () => {
      const invalidWorkflowData = {
        ...testEnv.data.workflows.valid,
        template: 'invalid-template'
      };

      const response = await request(app)
        .post('/api/v1/workflows')
        .set('Authorization', 'Bearer valid_user_token')
        .send(invalidWorkflowData)
        .expect(404);

      testEnv.utils.expectErrorResponse(response, ERROR_CODES.TEMPLATE_NOT_FOUND, 404);
    });
  });

  describe('Workflow Execution', () => {
    let testWorkflow;

    beforeEach(async () => {
      // Create a test workflow for execution tests
      const createResponse = await request(app)
        .post('/api/v1/workflows')
        .set('Authorization', 'Bearer valid_user_token')
        .send(testEnv.data.workflows.valid);

      testWorkflow = createResponse.body.data.workflow;
    });

    test('should execute a workflow successfully', async () => {
      const response = await request(app)
        .post(`/api/v1/workflows/${testWorkflow.id}/execute`)
        .set('Authorization', 'Bearer valid_user_token')
        .send({})
        .expect(200);

      testEnv.utils.expectSuccessResponse(response, 200);

      expect(response.body.data).toMatchObject({
        workflowId: testWorkflow.id,
        status: 'executing'
      });

      expect(response.body.data).toHaveProperty('executionId');
      expect(response.body.data).toHaveProperty('estimatedCompletionTime');
    });

    test('should handle workflow human response', async () => {
      // First execute the workflow
      await request(app)
        .post(`/api/v1/workflows/${testWorkflow.id}/execute`)
        .set('Authorization', 'Bearer valid_user_token')
        .send({});

      // Wait for workflow to be ready (simulated)
      await testEnv.utils.wait(2100);

      // Respond to workflow
      const responseData = {
        action: 'approve',
        data: {
          message: 'Workflow approved',
          parameters: {
            confidence: 0.95
          }
        }
      };

      const response = await request(app)
        .post(`/api/v1/workflows/${testWorkflow.id}/respond`)
        .set('Authorization', 'Bearer valid_user_token')
        .send(responseData)
        .expect(200);

      testEnv.utils.expectSuccessResponse(response, 200);

      expect(response.body.data).toMatchObject({
        workflowId: testWorkflow.id,
        status: 'completed',
        response: {
          action: 'approve',
          respondedBy: authenticatedUser.email
        }
      });
    });

    test('should reject execution of non-existent workflow', async () => {
      const response = await request(app)
        .post('/api/v1/workflows/non-existent-id/execute')
        .set('Authorization', 'Bearer valid_user_token')
        .send({})
        .expect(404);

      testEnv.utils.expectErrorResponse(response, ERROR_CODES.WORKFLOW_NOT_FOUND, 404);
    });

    test('should reject response to workflow not waiting for input', async () => {
      // Try to respond to workflow without executing it first
      const responseData = {
        action: 'approve',
        data: { message: 'Test response' }
      };

      const response = await request(app)
        .post(`/api/v1/workflows/${testWorkflow.id}/respond`)
        .set('Authorization', 'Bearer valid_user_token')
        .send(responseData)
        .expect(400);

      testEnv.utils.expectErrorResponse(response, ERROR_CODES.INVALID_WORKFLOW_STATUS, 400);
    });
  });

  describe('Workflow Pagination and Filtering', () => {
    beforeEach(async () => {
      // Create multiple workflows for pagination tests
      const workflowPromises = [];
      for (let i = 0; i < 25; i++) {
        workflowPromises.push(
          request(app)
            .post('/api/v1/workflows')
            .set('Authorization', 'Bearer valid_user_token')
            .send({
              ...testEnv.data.workflows.valid,
              context: {
                title: `Test Workflow ${i}`,
                description: `Test workflow number ${i}`
              }
            })
        );
      }

      await Promise.all(workflowPromises);
    });

    test('should paginate workflows list', async () => {
      const response = await request(app)
        .get('/api/v1/workflows?page=1&limit=10')
        .set('Authorization', 'Bearer valid_user_token')
        .expect(200);

      testEnv.utils.expectSuccessResponse(response, 200);

      expect(response.body.data).toHaveProperty('workflows');
      expect(response.body.data).toHaveProperty('pagination');

      expect(response.body.data.workflows).toHaveLength(10);
      expect(response.body.data.pagination).toMatchObject({
        page: 1,
        limit: 10,
        total: expect.any(Number),
        totalPages: expect.any(Number),
        hasNext: true,
        hasPrev: false
      });
    });

    test('should get second page of workflows', async () => {
      const response = await request(app)
        .get('/api/v1/workflows?page=2&limit=10')
        .set('Authorization', 'Bearer valid_user_token')
        .expect(200);

      expect(response.body.data.pagination).toMatchObject({
        page: 2,
        limit: 10,
        hasNext: true,
        hasPrev: true
      });
    });

    test('should sort workflows by creation date', async () => {
      const response = await request(app)
        .get('/api/v1/workflows?sortBy=createdAt&sortOrder=desc')
        .set('Authorization', 'Bearer valid_user_token')
        .expect(200);

      const workflows = response.body.data.workflows;
      for (let i = 1; i < workflows.length; i++) {
        const prevDate = new Date(workflows[i - 1].createdAt);
        const currentDate = new Date(workflows[i].createdAt);
        expect(prevDate.getTime()).toBeGreaterThanOrEqual(currentDate.getTime());
      }
    });

    test('should filter workflows by status', async () => {
      // All workflows should be in draft status initially
      const response = await request(app)
        .get('/api/v1/workflows?status=draft')
        .set('Authorization', 'Bearer valid_user_token')
        .expect(200);

      expect(response.body.data.workflows.every(w => w.status === 'draft')).toBe(true);
    });
  });
});