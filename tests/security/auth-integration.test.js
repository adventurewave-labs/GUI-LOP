/**
 * Authentication Integration Tests
 * End-to-end security testing for authentication flows
 */

import request from 'supertest';
import express from 'express';
import cors from 'cors';
import authRoutes from '../../src/backend/routes/auth-routes.js';

// Mock dependencies
jest.mock('express-validator');
jest.mock('express-rate-limit');
jest.mock('helmet');

const mockValidation = require('express-validator');
const mockRateLimit = require('express-rate-limit');
const mockHelmet = require('helmet');

describe('Authentication Integration Security Tests', () => {
  let app;
  let server;

  beforeAll(async () => {
    // Setup test app
    app = express();
    app.use(cors());
    app.use(express.json());

    // Mock validation middleware
    mockValidation.validationResult.mockReturnValue({
      isEmpty: () => true,
      array: () => []
    });

    // Mock rate limiting
    mockRateLimit.mockImplementation((options) => (req, res, next) => {
      // Simulate rate limiting by tracking requests in memory
      const key = req.ip + req.path;
      if (!req.rateLimitStore) req.rateLimitStore = new Map();

      const count = req.rateLimitStore.get(key) || 0;
      if (count >= options.max) {
        return res.status(429).json({
          error: 'Too many requests',
          message: options.message
        });
      }

      req.rateLimitStore.set(key, count + 1);
      next();
    });

    // Mock helmet
    mockHelmet.mockImplementation(() => (req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      next();
    });

    // Use auth routes
    app.use('/api/auth', authRoutes);

    // Start server
    server = app.listen(0);
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => {
        server.close(resolve);
      });
    }
  });

  beforeEach(() => {
    // Clear rate limit store
    if (app && app._router && app._router.stack) {
      app._router.stack.forEach(layer => {
        if (layer.handle && layer.handle.rateLimitStore) {
          layer.handle.rateLimitStore.clear();
        }
      });
    }
  });

  describe('Registration Flow Security', () => {
    test('should register user with strong password requirements', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'SecurePass123!',
        confirmPassword: 'SecurePass123!'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body).toHaveProperty('message', 'User registered successfully');
      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('tokens');
      expect(response.body.user).toHaveProperty('email', 'test@example.com');
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user).not.toHaveProperty('password');
      expect(response.body.tokens).toHaveProperty('accessToken');
      expect(response.body.tokens).toHaveProperty('refreshToken');
      expect(response.body.tokens).toHaveProperty('expiresIn');
    });

    test('should reject registration with weak password', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'weak',
        confirmPassword: 'weak'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Validation failed');
    });

    test('should reject registration with mismatched passwords', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'SecurePass123!',
        confirmPassword: 'DifferentPass123!'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Validation failed');
    });

    test('should reject registration with invalid email', async () => {
      const userData = {
        email: 'invalid-email',
        password: 'SecurePass123!',
        confirmPassword: 'SecurePass123!'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Validation failed');
    });

    test('should reject duplicate email registration', async () => {
      const userData = {
        email: 'duplicate@example.com',
        password: 'SecurePass123!',
        confirmPassword: 'SecurePass123!'
      };

      // First registration
      await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);

      // Second registration with same email
      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(409);

      expect(response.body).toHaveProperty('error', 'User already exists');
    });

    test('should enforce rate limiting on registration endpoint', async () => {
      const userData = {
        email: `ratelimit${Date.now()}@example.com`,
        password: 'SecurePass123!',
        confirmPassword: 'SecurePass123!'
      };

      // Make multiple rapid requests
      const requests = [];
      for (let i = 0; i < 5; i++) {
        requests.push(
          request(app)
            .post('/api/auth/register')
            .send({
              ...userData,
              email: `ratelimit${i}${Date.now()}@example.com`
            })
        );
      }

      const responses = await Promise.all(requests);

      // First few should succeed
      expect(responses[0].status).toBe(201);
      expect(responses[1].status).toBe(201);
      expect(responses[2].status).toBe(201);

      // Later ones should be rate limited
      expect(responses[3].status).toBe(429);
      expect(responses[4].status).toBe(429);
    });
  });

  describe('Login Flow Security', () => {
    beforeEach(async () => {
      // Create a test user for login tests
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'logintest@example.com',
          password: 'LoginTest123!',
          confirmPassword: 'LoginTest123!'
        });
    });

    test('should login with valid credentials', async () => {
      const loginData = {
        email: 'logintest@example.com',
        password: 'LoginTest123!'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Login successful');
      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('tokens');
      expect(response.body.user).toHaveProperty('email', 'logintest@example.com');
      expect(response.body.user).toHaveProperty('lastLogin');
      expect(response.body.tokens).toHaveProperty('accessToken');
      expect(response.body.tokens).toHaveProperty('refreshToken');
    });

    test('should reject login with invalid credentials', async () => {
      const loginData = {
        email: 'logintest@example.com',
        password: 'WrongPassword123!'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Authentication failed');
      expect(response.body).toHaveProperty('message', 'Invalid email or password');
    });

    test('should reject login with non-existent user', async () => {
      const loginData = {
        email: 'nonexistent@example.com',
        password: 'SomePassword123!'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Authentication failed');
    });

    test('should enforce rate limiting on login endpoint', async () => {
      const loginData = {
        email: 'logintest@example.com',
        password: 'WrongPassword123!'
      };

      // Make multiple failed login attempts
      const requests = [];
      for (let i = 0; i < 10; i++) {
        requests.push(
          request(app)
            .post('/api/auth/login')
            .send(loginData)
        );
      }

      const responses = await Promise.all(requests);

      // Should hit rate limit
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });

    test('should return security headers', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'logintest@example.com',
          password: 'LoginTest123!'
        })
        .expect(200);

      expect(response.headers).toHaveProperty('x-content-type-options', 'nosniff');
      expect(response.headers).toHaveProperty('x-frame-options', 'DENY');
      expect(response.headers).toHaveProperty('x-xss-protection', '1; mode=block');
    });
  });

  describe('Token Refresh Flow Security', () => {
    let accessToken;
    let refreshToken;

    beforeEach(async () => {
      // Register and login to get tokens
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'refreshtest@example.com',
          password: 'RefreshTest123!',
          confirmPassword: 'RefreshTest123!'
        });

      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'refreshtest@example.com',
          password: 'RefreshTest123!'
        });

      accessToken = loginResponse.body.tokens.accessToken;
      refreshToken = loginResponse.body.tokens.refreshToken;
    });

    test('should refresh tokens with valid refresh token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Token refreshed successfully');
      expect(response.body).toHaveProperty('tokens');
      expect(response.body.tokens).toHaveProperty('accessToken');
      expect(response.body.tokens).toHaveProperty('expiresIn');
      expect(response.body.tokens.accessToken).not.toBe(accessToken); // Should be new token
    });

    test('should reject token refresh with invalid refresh token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'invalid-refresh-token' })
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Invalid refresh token');
    });

    test('should reject token refresh without refresh token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Validation failed');
    });

    test('should enforce rate limiting on refresh endpoint', async () => {
      const requests = [];
      for (let i = 0; i < 25; i++) {
        requests.push(
          request(app)
            .post('/api/auth/refresh')
            .send({ refreshToken })
        );
      }

      const responses = await Promise.all(requests);

      // Should hit rate limit
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
  });

  describe('Logout Flow Security', () => {
    let accessToken;
    let refreshToken;

    beforeEach(async () => {
      // Register and login to get tokens
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'logouttest@example.com',
          password: 'LogoutTest123!',
          confirmPassword: 'LogoutTest123!'
        });

      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'logouttest@example.com',
          password: 'LogoutTest123!'
        });

      accessToken = loginResponse.body.tokens.accessToken;
      refreshToken = loginResponse.body.tokens.refreshToken;
    });

    test('should logout successfully and revoke tokens', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ refreshToken })
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Logout successful');
      expect(response.body).toHaveProperty('revokedAt');
    });

    test('should reject logout without authentication', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .send({ refreshToken })
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Authentication required');
    });

    test('should logout even without refresh token', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Logout successful');
    });
  });

  describe('Protected Routes Security', () => {
    let accessToken;
    let refreshToken;

    beforeEach(async () => {
      // Register and login to get tokens
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'protectedtest@example.com',
          password: 'ProtectedTest123!',
          confirmPassword: 'ProtectedTest123!'
        });

      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'protectedtest@example.com',
          password: 'ProtectedTest123!'
        });

      accessToken = loginResponse.body.tokens.accessToken;
      refreshToken = loginResponse.body.tokens.refreshToken;
    });

    test('should access protected route with valid token', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('authenticatedAt');
      expect(response.body.user).toHaveProperty('email', 'protectedtest@example.com');
      expect(response.body.user).not.toHaveProperty('password');
    });

    test('should reject access to protected route without token', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Authentication required');
    });

    test('should reject access to protected route with invalid token', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Authentication failed');
    });

    test('should reject access with malformed authorization header', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'InvalidFormat token')
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Authentication required');
    });
  });

  describe('Password Change Security', () => {
    let accessToken;

    beforeEach(async () => {
      // Register and login to get tokens
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'passwordtest@example.com',
          password: 'PasswordTest123!',
          confirmPassword: 'PasswordTest123!'
        });

      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'passwordtest@example.com',
          password: 'PasswordTest123!'
        });

      accessToken = loginResponse.body.tokens.accessToken;
    });

    test('should change password with valid credentials', async () => {
      const passwordData = {
        currentPassword: 'PasswordTest123!',
        newPassword: 'NewPasswordTest123!',
        confirmPassword: 'NewPasswordTest123!'
      };

      const response = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(passwordData)
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Password changed successfully');
      expect(response.body).toHaveProperty('changedAt');
    });

    test('should reject password change with wrong current password', async () => {
      const passwordData = {
        currentPassword: 'WrongPassword123!',
        newPassword: 'NewPasswordTest123!',
        confirmPassword: 'NewPasswordTest123!'
      };

      const response = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(passwordData)
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Authentication failed');
    });

    test('should reject password change with weak new password', async () => {
      const passwordData = {
        currentPassword: 'PasswordTest123!',
        newPassword: 'weak',
        confirmPassword: 'weak'
      };

      const response = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(passwordData)
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Validation failed');
    });

    test('should reject password change with mismatched confirmation', async () => {
      const passwordData = {
        currentPassword: 'PasswordTest123!',
        newPassword: 'NewPasswordTest123!',
        confirmPassword: 'DifferentPassword123!'
      };

      const response = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(passwordData)
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Validation failed');
    });

    test('should reject password change without authentication', async () => {
      const passwordData = {
        currentPassword: 'PasswordTest123!',
        newPassword: 'NewPasswordTest123!',
        confirmPassword: 'NewPasswordTest123!'
      };

      const response = await request(app)
        .post('/api/auth/change-password')
        .send(passwordData)
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Authentication required');
    });

    test('should enforce rate limiting on password change endpoint', async () => {
      const passwordData = {
        currentPassword: 'PasswordTest123!',
        newPassword: 'NewPasswordTest123!',
        confirmPassword: 'NewPasswordTest123!'
      };

      // Make multiple rapid requests
      const requests = [];
      for (let i = 0; i < 10; i++) {
        requests.push(
          request(app)
            .post('/api/auth/change-password')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
              ...passwordData,
              newPassword: `NewPasswordTest${i}!`
            })
        );
      }

      const responses = await Promise.all(requests);

      // Should hit rate limit
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
  });

  describe('Input Validation Security', () => {
    test('should handle malicious input in registration', async () => {
      const maliciousData = {
        email: '<script>alert("xss")</script>@example.com',
        password: 'SecurePass123!',
        confirmPassword: 'SecurePass123!'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(maliciousData)
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Validation failed');
    });

    test('should handle large payloads gracefully', async () => {
      const largePayload = {
        email: 'test@example.com',
        password: 'SecurePass123!',
        confirmPassword: 'SecurePass123!',
        extraData: 'x'.repeat(1000000) // 1MB of extra data
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(largePayload);

      // Should either succeed or fail gracefully, not crash
      expect([200, 201, 400, 413]).toContain(response.status);
    });

    test('should handle JSON parsing errors', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .set('Content-Type', 'application/json')
        .send('invalid json{')
        .expect(400);

      // Should handle malformed JSON gracefully
      expect(response.status).toBe(400);
    });
  });

  describe('Concurrent Request Security', () => {
    test('should handle concurrent login attempts safely', async () => {
      // Create user
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'concurrent@example.com',
          password: 'ConcurrentTest123!',
          confirmPassword: 'ConcurrentTest123!'
        });

      // Make multiple concurrent login attempts
      const loginData = {
        email: 'concurrent@example.com',
        password: 'ConcurrentTest123!'
      };

      const requests = Array(10).fill(null).map(() =>
        request(app)
          .post('/api/auth/login')
          .send(loginData)
      );

      const responses = await Promise.all(requests);

      // All requests should complete without errors
      responses.forEach(response => {
        expect([200, 401, 429]).toContain(response.status);
      });

      // At least some should succeed
      const successfulLogins = responses.filter(r => r.status === 200);
      expect(successfulLogins.length).toBeGreaterThan(0);
    });

    test('should handle concurrent registration attempts safely', async () => {
      const requests = Array(5).fill(null).map((_, i) =>
        request(app)
          .post('/api/auth/register')
          .send({
            email: `concurrent${i}@example.com`,
            password: 'ConcurrentTest123!',
            confirmPassword: 'ConcurrentTest123!'
          })
      );

      const responses = await Promise.all(requests);

      // All requests should complete without errors
      responses.forEach(response => {
        expect([201, 409, 429]).toContain(response.status);
      });
    });
  });
});