/**
 * Authentication System Tests
 * Comprehensive test suite for JWT authentication, user management, and security features
 */

import request from 'supertest';
import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import app from '../simple-server.js';
import { userStore } from '../models/User.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  revokeToken,
  revokeAllRefreshTokens
} from '../utils/jwtUtils.js';

describe('Authentication System Tests', () => {
  let testUser;
  let accessToken;
  let refreshToken;

  beforeAll(async () => {
    // Create a test user for authentication tests
    testUser = await userStore.create({
      email: 'test@example.com',
      password: 'TestPass123',
      firstName: 'Test',
      lastName: 'User'
    });
  });

  beforeEach(() => {
    // Clean up any tokens before each test
    revokeAllRefreshTokens(testUser.id);
  });

  describe('User Registration', () => {
    test('should register a new user successfully', async () => {
      const userData = {
        email: 'newuser@example.com',
        password: 'NewPass123',
        firstName: 'New',
        lastName: 'User'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe(userData.email);
      expect(response.body.data.user.firstName).toBe(userData.firstName);
      expect(response.body.data.user.lastName).toBe(userData.lastName);
      expect(response.body.data.tokens.accessToken).toBeDefined();
      expect(response.body.data.tokens.refreshToken).toBeDefined();
      expect(response.body.data.tokens.tokenType).toBe('Bearer');
      expect(response.body.data.tokens.expiresIn).toBe(900);
    });

    test('should reject registration with invalid email', async () => {
      const userData = {
        email: 'invalid-email',
        password: 'ValidPass123',
        firstName: 'Test',
        lastName: 'User'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INVALID_EMAIL');
    });

    test('should reject registration with weak password', async () => {
      const userData = {
        email: 'weak@example.com',
        password: 'weak', // Too short and doesn't meet requirements
        firstName: 'Test',
        lastName: 'User'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('WEAK_PASSWORD');
    });

    test('should reject registration with duplicate email', async () => {
      const userData = {
        email: testUser.email, // Already exists
        password: 'AnotherPass123',
        firstName: 'Another',
        lastName: 'User'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('EMAIL_EXISTS');
    });

    test('should reject registration with missing fields', async () => {
      const userData = {
        email: 'incomplete@example.com',
        // Missing password, firstName, lastName
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('MISSING_FIELDS');
    });
  });

  describe('User Login', () => {
    test('should login with valid credentials', async () => {
      const loginData = {
        email: testUser.email,
        password: 'TestPass123'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe(testUser.email);
      expect(response.body.data.tokens.accessToken).toBeDefined();
      expect(response.body.data.tokens.refreshToken).toBeDefined();

      // Save tokens for other tests
      accessToken = response.body.data.tokens.accessToken;
      refreshToken = response.body.data.tokens.refreshToken;
    });

    test('should reject login with invalid email', async () => {
      const loginData = {
        email: 'wrong@example.com',
        password: 'TestPass123'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INVALID_CREDENTIALS');
    });

    test('should reject login with invalid password', async () => {
      const loginData = {
        email: testUser.email,
        password: 'wrongpassword'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INVALID_CREDENTIALS');
    });

    test('should reject login with missing credentials', async () => {
      const loginData = {
        email: testUser.email
        // Missing password
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('MISSING_CREDENTIALS');
    });
  });

  describe('Token Refresh', () => {
    beforeEach(async () => {
      // Login to get fresh tokens
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: 'TestPass123'
        });

      accessToken = loginResponse.body.data.tokens.accessToken;
      refreshToken = loginResponse.body.data.tokens.refreshToken;
    });

    test('should refresh access token with valid refresh token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.tokens.accessToken).toBeDefined();
      expect(response.body.data.tokens.refreshToken).toBeDefined();
      expect(response.body.data.tokens.accessToken).not.toBe(accessToken); // Should be different
      expect(response.body.data.tokens.refreshToken).not.toBe(refreshToken); // Should rotate
    });

    test('should reject refresh with invalid token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'invalid-token' })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('REFRESH_TOKEN_INVALID');
    });

    test('should reject refresh with missing token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('REFRESH_TOKEN_REQUIRED');
    });
  });

  describe('Logout', () => {
    beforeEach(async () => {
      // Login to get tokens
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: 'TestPass123'
        });

      accessToken = loginResponse.body.data.tokens.accessToken;
      refreshToken = loginResponse.body.data.tokens.refreshToken;
    });

    test('should logout successfully', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .send({ accessToken, refreshToken })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.loggedOut).toBe(true);

      // Try to use the access token - should be invalid
      const verifyResponse = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);

      expect(verifyResponse.body.code).toBe('TOKEN_REVOKED');
    });

    test('should logout with just access token', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .send({ accessToken })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    test('should logout without tokens (still succeeds)', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .send({})
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('Protected Routes', () => {
    beforeEach(async () => {
      // Login to get access token
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: 'TestPass123'
        });

      accessToken = loginResponse.body.data.tokens.accessToken;
    });

    test('should access protected route with valid token', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe(testUser.email);
    });

    test('should reject protected route without token', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('TOKEN_REQUIRED');
    });

    test('should reject protected route with invalid token', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('TOKEN_INVALID');
    });

    test('should reject protected route with malformed header', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'InvalidFormat token')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('TOKEN_REQUIRED');
    });
  });

  describe('Workflow API with Authentication', () => {
    beforeEach(async () => {
      // Login to get access token
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: 'TestPass123'
        });

      accessToken = loginResponse.body.data.tokens.accessToken;
    });

    test('should create workflow with authentication', async () => {
      const workflowData = {
        template: 'data-analysis',
        context: 'Test data analysis workflow'
      };

      const response = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(workflowData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.workflow.template).toBe(workflowData.template);
      expect(response.body.data.workflow.createdBy.email).toBe(testUser.email);
    });

    test('should reject workflow creation without authentication', async () => {
      const workflowData = {
        template: 'data-analysis',
        context: 'Test data analysis workflow'
      };

      const response = await request(app)
        .post('/api/workflows')
        .send(workflowData)
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    test('should get user workflows', async () => {
      // First create a workflow
      await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          template: 'decision-making',
          context: 'Test decision workflow'
        });

      // Then get user workflows
      const response = await request(app)
        .get('/api/workflows')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.workflows).toBeDefined();
      expect(response.body.data.total).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Password Change', () => {
    beforeEach(async () => {
      // Login to get access token
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: 'TestPass123'
        });

      accessToken = loginResponse.body.data.tokens.accessToken;
    });

    test('should change password with valid credentials', async () => {
      const passwordData = {
        currentPassword: 'TestPass123',
        newPassword: 'NewPass123'
      };

      const response = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(passwordData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.passwordChanged).toBe(true);

      // Try to login with new password
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: 'NewPass123'
        })
        .expect(200);

      expect(loginResponse.body.success).toBe(true);
    });

    test('should reject password change with wrong current password', async () => {
      const passwordData = {
        currentPassword: 'WrongPassword',
        newPassword: 'NewPass123'
      };

      const response = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(passwordData)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INVALID_CURRENT_PASSWORD');
    });

    test('should reject password change with weak new password', async () => {
      const passwordData = {
        currentPassword: 'TestPass123',
        newPassword: 'weak'
      };

      const response = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(passwordData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('WEAK_PASSWORD');
    });
  });

  describe('Public Endpoints', () => {
    test('should access health endpoint without authentication', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.features.authentication).toBe(true);
    });

    test('should access public status endpoint', async () => {
      const response = await request(app)
        .get('/api/public/status')
        .expect(200);

      expect(response.body.message).toContain('Public API endpoint');
      expect(response.body.features).toContain('jwt-authentication');
    });

    test('should access workflow templates without authentication', async () => {
      const response = await request(app)
        .get('/api/workflows/templates')
        .expect(200);

      expect(response.body.templates).toBeDefined();
      expect(response.body.templates.length).toBeGreaterThan(0);
      expect(response.body.metadata.isAuthenticated).toBe(false);
      expect(response.body.metadata.userRole).toBe('anonymous');
    });
  });

  describe('Rate Limiting', () => {
    test('should enforce rate limiting on login attempts', async () => {
      const loginData = {
        email: 'wrong@example.com',
        password: 'wrongpassword'
      };

      // Make multiple failed login attempts
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/auth/login')
          .send(loginData)
          .expect(401);
      }

      // Next attempt should be rate limited
      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(429);

      expect(response.body.code).toBe('IP_LOCKED');
    });
  });

  describe('JWT Utilities', () => {
    test('should generate and verify access token', () => {
      const token = generateAccessToken(testUser);
      expect(token).toBeDefined();

      const decoded = verifyAccessToken(token);
      expect(decoded.sub).toBe(testUser.id);
      expect(decoded.email).toBe(testUser.email);
      expect(decoded.type).toBe('access');
    });

    test('should generate and verify refresh token', () => {
      const token = generateRefreshToken(testUser);
      expect(token).toBeDefined();

      const decoded = verifyRefreshToken(token);
      expect(decoded.sub).toBe(testUser.id);
      expect(decoded.email).toBe(testUser.email);
      expect(decoded.type).toBe('refresh');
    });

    test('should reject expired access token', () => {
      // Create an expired token (set expiry to past)
      const expiredToken = jwt.sign(
        { sub: testUser.id, type: 'access' },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '-1s' }
      );

      expect(() => {
        verifyAccessToken(expiredToken);
      }).toThrow('Access token expired');
    });

    test('should revoke token successfully', () => {
      const token = generateAccessToken(testUser);

      // Token should be valid initially
      expect(() => {
        verifyAccessToken(token);
      }).not.toThrow();

      // Revoke the token
      const revokeResult = revokeToken(token);
      expect(revokeResult).toBe(true);
    });
  });

  afterAll(() => {
    // Clean up test data
    console.log('Authentication tests completed');
  });
});