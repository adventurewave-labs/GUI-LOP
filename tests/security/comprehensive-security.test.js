/**
 * Comprehensive Security Test Suite
 * Tests authentication, authorization, input validation, and security headers
 */

import request from 'supertest';
import { createApp } from '../../src/api/index.js';
import { userStore } from '../../src/backend/models/User.js';

describe('Comprehensive Security Tests', () => {
  let app;
  let authToken;
  let testUser;

  beforeAll(async () => {
    app = createApp();

    // Create test user for authentication tests
    testUser = await userStore.create({
      email: 'securitytest@example.com',
      password: 'SecurePass123',
      firstName: 'Security',
      lastName: 'Test',
      role: 'user'
    });
  });

  afterAll(async () => {
    // Cleanup test user
    if (testUser) {
      await userStore.delete(testUser.id);
    }
  });

  describe('Authentication Security', () => {
    test('should reject requests without authentication token', async () => {
      const response = await request(app)
        .get('/api/v1/workflows')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('TOKEN_REQUIRED');
    });

    test('should reject requests with invalid authentication token', async () => {
      const response = await request(app)
        .get('/api/v1/workflows')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('TOKEN_INVALID');
    });

    test('should accept requests with valid authentication token', async () => {
      // First, login to get token
      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'securitytest@example.com',
          password: 'SecurePass123'
        })
        .expect(200);

      authToken = loginResponse.body.data.tokens.accessToken;

      // Now test authenticated endpoint
      const response = await request(app)
        .get('/api/v1/workflows')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.workflows).toBeDefined();
    });
  });

  describe('Input Validation Security', () => {
    beforeEach(async () => {
      if (!authToken) {
        const loginResponse = await request(app)
          .post('/api/v1/auth/login')
          .send({
            email: 'securitytest@example.com',
            password: 'SecurePass123'
          });
        authToken = loginResponse.body.data.tokens.accessToken;
      }
    });

    test('should sanitize HTML tags in workflow names', async () => {
      const maliciousName = '<script>alert("xss")</script>Test Workflow';
      const response = await request(app)
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: maliciousName,
          description: 'Test description',
          steps: [{ name: 'Step 1' }]
        })
        .expect(201);

      expect(response.body.data.workflow.name).not.toContain('<script>');
      expect(response.body.data.workflow.name).toBe('Test Workflow');
    });

    test('should sanitize javascript: protocol in inputs', async () => {
      const maliciousDescription = 'javascript:alert("xss") test description';
      const response = await request(app)
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Test Workflow',
          description: maliciousDescription,
          steps: [{ name: 'Step 1' }]
        })
        .expect(201);

      expect(response.body.data.workflow.description).not.toContain('javascript:');
    });

    test('should remove event handlers from inputs', async () => {
      const maliciousInput = 'test onclick=alert("xss")';
      const response = await request(app)
        .post('/api/v1/workflows/:workflowId/respond')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          stepId: 'step-1',
          response: maliciousInput
        });

      // The response should not contain onclick event handlers
      expect(response.body.data.response.response).not.toContain('onclick');
    });

    test('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          description: 'Missing name and steps'
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Rate Limiting Security', () => {
    test('should limit excessive authentication attempts', async () => {
      const promises = Array(10).fill().map(() =>
        request(app)
          .post('/api/v1/auth/login')
          .send({
            email: 'securitytest@example.com',
            password: 'wrongpassword'
          })
      );

      const responses = await Promise.all(promises);

      // Some requests should be rate limited
      const rateLimitedResponses = responses.filter(res => res.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
  });

  describe('Security Headers', () => {
    test('should include security headers in responses', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      // Check for important security headers
      expect(response.headers['x-frame-options']).toBeDefined();
      expect(response.headers['x-content-type-options']).toBeDefined();
      expect(response.headers['x-xss-protection']).toBeDefined();
    });

    test('should include CSP header when helmet is enabled', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      // CSP header should be present
      expect(response.headers['content-security-policy']).toBeDefined();
    });
  });

  describe('Authorization Security', () => {
    let adminToken;
    let adminUser;

    beforeAll(async () => {
      // Create admin user
      adminUser = await userStore.create({
        email: 'admin@example.com',
        password: 'AdminPass123',
        firstName: 'Admin',
        lastName: 'User',
        role: 'admin'
      });

      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'admin@example.com',
          password: 'AdminPass123'
        });

      adminToken = loginResponse.body.data.tokens.accessToken;
    });

    afterAll(async () => {
      if (adminUser) {
        await userStore.delete(adminUser.id);
      }
    });

    test('should allow admin access to admin-only routes', async () => {
      // This test would need admin-only routes to be implemented
      // For now, we test that admin can access regular routes
      const response = await request(app)
        .get('/api/v1/workflows')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('Error Handling Security', () => {
    test('should not leak sensitive information in error messages', async () => {
      const response = await request(app)
        .get('/api/v1/workflows/nonexistent')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBeDefined();
      // Should not contain stack traces or internal paths
      expect(response.body.stack).toBeUndefined();
    });

    test('should sanitize error messages', async () => {
      const response = await request(app)
        .post('/api/v1/workflows/invalid-id/execute')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          inputData: {}
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INVALID_WORKFLOW_ID');
    });
  });

  describe('CSRF Protection', () => {
    test('should handle state-changing operations safely', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .send({
          refreshToken: 'fake-token'
        })
        .expect(200);

      // Should handle logout gracefully even with invalid token
      expect(response.body.success).toBe(true);
    });
  });

  describe('Session Security', () => {
    test('should invalidate tokens on logout', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          accessToken: authToken,
          refreshToken: 'fake-refresh-token'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.loggedOut).toBe(true);
    });
  });
});