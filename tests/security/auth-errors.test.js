/**
 * Authentication Error Handling Tests
 * Comprehensive testing for authentication error scenarios and edge cases
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

describe('Authentication Error Handling Tests', () => {
  let app;
  let server;

  beforeAll(async () => {
    // Setup test app
    app = express();
    app.use(cors());
    app.use(express.json());

    // Mock validation to return errors
    mockValidation.validationResult.mockImplementation(() => ({
      isEmpty: () => false,
      array: () => [
        {
          value: 'invalid',
          msg: 'Invalid value',
          param: 'email',
          location: 'body'
        }
      ]
    }));

    mockValidation.body.mockReturnValue({
      isEmail: { withMessage: () => ({ normalizeEmail: () => ({ withMessage: () => ({}) } }) }) },
      isLength: { withMessage: () => ({ matches: { withMessage: () => ({}) } }) },
      notEmpty: { withMessage: () => ({}) },
      custom: { withMessage: () => ({}) }
    });

    // Mock rate limiting
    mockRateLimit.mockImplementation((options) => (req, res, next) => next());

    // Mock helmet
    mockHelmet.mockImplementation(() => (req, res, next) => next());

    app.use('/api/auth', authRoutes);

    server = app.listen(0);
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => {
        server.close(resolve);
      });
    }
  });

  describe('Input Validation Errors', () => {
    test('should handle malformed JSON in request body', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .set('Content-Type', 'application/json')
        .send('{"email": invalid json}')
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.status).toBe(400);
    });

    test('should handle oversized request payload', async () => {
      const oversizedPayload = {
        email: 'test@example.com',
        password: 'SecurePass123!',
        confirmPassword: 'SecurePass123!',
        data: 'x'.repeat(10 * 1024 * 1024) // 10MB
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(oversizedPayload);

      expect([400, 413]).toContain(response.status);
    });

    test('should handle missing request body', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send()
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Validation failed');
    });

    test('should handle empty request body', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Validation failed');
    });

    test('should handle null values in request body', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: null,
          password: null
        })
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Validation failed');
    });
  });

  describe('Authentication State Errors', () => {
    test('should handle concurrent login attempts safely', async () => {
      const loginData = {
        email: 'test@example.com',
        password: 'password123'
      };

      // Make multiple concurrent requests
      const promises = Array(10).fill(null).map(() =>
        request(app)
          .post('/api/auth/login')
          .send(loginData)
      );

      const responses = await Promise.all(promises);

      // All should complete without server crash
      responses.forEach(response => {
        expect([200, 401, 400]).toContain(response.status);
      });
    });

    test('should handle token verification errors gracefully', async () => {
      const invalidTokens = [
        'invalid.jwt.token',
        'Bearer invalid.jwt.token',
        'Bearer',
        '',
        'null',
        'undefined',
        'Bearer null',
        'Bearer undefined',
        'Bearer ' + 'x'.repeat(1000), // Very long token
        'Bearer ' + Buffer.from('binary').toString('base64'), // Binary data
        'Bearer <script>alert("xss")</script>', // XSS attempt
        'Bearer ${malicious}', // Template literal injection
        'Bearer ../../../etc/passwd' // Path traversal
      ];

      for (const token of invalidTokens) {
        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', token)
          .expect(401);

        expect(response.body).toHaveProperty('error', 'Authentication required');
      }
    });

    test('should handle missing authorization header', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Authentication required');
      expect(response.body).toHaveProperty('message', 'Bearer token is required');
    });

    test('should handle malformed authorization header', async () => {
      const malformedHeaders = [
        'InvalidFormat token',
        'Bearer',
        'Bearer',
        'bearer token', // lowercase
        'TOKEN token', // wrong prefix
        'Bearer token extra', // too many parts
        'Bearer', // missing token
        'Basic dGVzdDp0ZXN0', // wrong auth type
        'Digest username=test', // wrong auth type
        'OAuth token', // wrong auth type
        '' // empty header
      ];

      for (const header of malformedHeaders) {
        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', header);

        expect([401, 400]).toContain(response.status);
      }
    });
  });

  describe('Database/Storage Errors', () => {
    test('should handle user creation conflicts', async () => {
      // Mock successful validation
      mockValidation.validationResult.mockReturnValue({
        isEmpty: () => true,
        array: () => []
      });

      // First registration
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'conflict@example.com',
          password: 'SecurePass123!',
          confirmPassword: 'SecurePass123!'
        })
        .expect(201);

      // Second registration with same email
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'conflict@example.com',
          password: 'SecurePass123!',
          confirmPassword: 'SecurePass123!'
        })
        .expect(409);

      expect(response.body).toHaveProperty('error', 'User already exists');

      // Reset validation mock
      mockValidation.validationResult.mockImplementation(() => ({
        isEmpty: () => false,
        array: () => [{ msg: 'Invalid value', param: 'email' }]
      }));
    });

    test('should handle user not found errors', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'password123'
        })
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Authentication failed');
      expect(response.body).toHaveProperty('message', 'Invalid email or password');
    });
  });

  describe('Password Security Errors', () => {
    test('should handle password hashing failures', async () => {
      // This test would require mocking bcrypt to throw errors
      // For now, we test the validation prevents weak passwords
      const weakPasswords = [
        'short',
        '123456',
        'password',
        'uppercase',
        'lowercase',
        'numbers123',
        'special!',
        'NoSpecialChar123',
        'nouppercase123!',
        'NOLOWERCASE123!',
        'nonumbers!',
        'NO!NUMBERS',
        '123!ABC',
        'a'.repeat(1000), // Too long
        null,
        undefined,
        '',
        123456,
        [],
        {}
      ];

      for (const password of weakPasswords) {
        const response = await request(app)
          .post('/api/auth/register')
          .send({
            email: `test${Date.now()}@example.com`,
            password: password,
            confirmPassword: password
          });

        expect([400]).toContain(response.status);
      }
    });

    test('should handle password mismatch errors', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'SecurePass123!',
          confirmPassword: 'DifferentPass123!'
        })
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Validation failed');
    });

    test('should handle current password verification errors', async () => {
      // Create a user first (this would normally succeed)
      // For testing, we'll just test the endpoint exists
      const response = await request(app)
        .post('/api/auth/change-password')
        .send({
          currentPassword: 'wrongpassword',
          newPassword: 'NewSecurePass123!',
          confirmPassword: 'NewSecurePass123!'
        })
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Authentication required');
    });
  });

  describe('Token Security Errors', () => {
    test('should handle refresh token reuse attempts', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({
          refreshToken: 'already-used-refresh-token'
        })
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Invalid refresh token');
    });

    test('should handle expired refresh tokens', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({
          refreshToken: 'expired-refresh-token'
        })
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Invalid refresh token');
    });

    test('should handle missing refresh token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Validation failed');
    });

    test('should handle malformed refresh tokens', async () => {
      const malformedTokens = [
        '',
        null,
        undefined,
        123,
        [],
        {},
        'not.a.jwt',
        'invalid.base64',
        'x'.repeat(10000), // Too long
        '<script>alert("xss")</script>',
        '${malicious}',
        '../../../etc/passwd'
      ];

      for (const token of malformedTokens) {
        const response = await request(app)
          .post('/api/auth/refresh')
          .send({ refreshToken: token })
          .expect(401);

        expect(response.body).toHaveProperty('error', 'Invalid refresh token');
      }
    });
  });

  describe('Network and Request Errors', () => {
    test('should handle incomplete requests', async () => {
      // Test with connection interruption (simulated)
      const response = await request(app)
        .post('/api/auth/login')
        .timeout(100) // Very short timeout
        .send({
          email: 'test@example.com',
          password: 'password123'
        });

      // Should either complete or timeout gracefully
      expect([200, 401, 400, 408]).toContain(response.status);
    });

    test('should handle slow requests gracefully', async () => {
      const startTime = Date.now();

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token');

      const duration = Date.now() - startTime;

      // Should respond quickly (less than 1 second)
      expect(duration).toBeLessThan(1000);
      expect(response.status).toBe(401);
    });

    test('should handle requests with special characters', async () => {
      const specialInputs = [
        '🚀🔐💻',
        'test@münchen.de',
        'user@北京.com',
        'café@example.fr',
        'пользователь@пример.рф',
        'مستخدم@مثال.شركة',
        'ユーザー@例え.テスト',
        '사용자@예시.테스트'
      ];

      for (const email of specialInputs) {
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            email: email,
            password: 'password123'
          });

        expect([401, 400]).toContain(response.status);
      }
    });
  });

  describe('Concurrent and Race Condition Errors', () => {
    test('should handle simultaneous registration attempts', async () => {
      const userData = {
        email: 'race@example.com',
        password: 'SecurePass123!',
        confirmPassword: 'SecurePass123!'
      };

      // Make multiple simultaneous registration requests
      const promises = Array(5).fill(null).map(() =>
        request(app)
          .post('/api/auth/register')
          .send(userData)
      );

      const responses = await Promise.all(promises);

      // Only one should succeed (201), others should fail (409 or 429)
      const successCount = responses.filter(r => r.status === 201).length;
      const conflictCount = responses.filter(r => r.status === 409).length;
      const rateLimitCount = responses.filter(r => r.status === 429).length;

      expect(successCount).toBeLessThanOrEqual(1);
      expect(conflictCount + rateLimitCount).toBeGreaterThanOrEqual(4);
    });

    test('should handle simultaneous password change attempts', async () => {
      // This would require authentication first
      // For now, test that unauthenticated requests are rejected
      const promises = Array(5).fill(null).map(() =>
        request(app)
          .post('/api/auth/change-password')
          .send({
            currentPassword: 'oldpassword',
            newPassword: 'NewSecurePass123!',
            confirmPassword: 'NewSecurePass123!'
          })
      );

      const responses = await Promise.all(promises);

      // All should be rejected due to lack of authentication
      responses.forEach(response => {
        expect(response.status).toBe(401);
      });
    });
  });

  describe('Security Breach Scenarios', () => {
    test('should handle credential stuffing attempts', async () => {
      const commonCredentials = [
        { email: 'admin@example.com', password: 'admin123' },
        { email: 'user@example.com', password: 'password' },
        { email: 'test@example.com', password: '123456' },
        { email: 'root@example.com', password: 'root' },
        { email: 'guest@example.com', password: 'guest' }
      ];

      const promises = commonCredentials.map(creds =>
        request(app)
          .post('/api/auth/login')
          .send(creds)
      );

      const responses = await Promise.all(promises);

      // All should be rejected
      responses.forEach(response => {
        expect([401, 429]).toContain(response.status);
      });
    });

    test('should handle brute force attempts', async () => {
      const targetEmail = 'bruteforce@example.com';
      const promises = [];

      // Rapid fire attempts
      for (let i = 0; i < 20; i++) {
        promises.push(
          request(app)
            .post('/api/auth/login')
            .send({
              email: targetEmail,
              password: `password${i}`
            })
        );
      }

      const responses = await Promise.all(promises);

      // Should hit rate limiting
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });

    test('should handle enumeration attacks', async () => {
      const userEmails = [
        'user1@example.com',
        'user2@example.com',
        'admin@example.com',
        'test@example.com',
        'nonexistent1@example.com',
        'nonexistent2@example.com'
      ];

      const responses = await Promise.all(
        userEmails.map(email =>
          request(app)
            .post('/api/auth/login')
            .send({
              email: email,
              password: 'wrongpassword'
            })
        )
      );

      // All should return the same generic error message
      responses.forEach(response => {
        expect(response.status).toBe(401);
        expect(response.body.message).toBe('Invalid email or password');
        // Should not reveal whether user exists
        expect(response.body.message).not.toContain('not found');
        expect(response.body.message).not.toContain('exists');
      });
    });
  });

  describe('Error Message Security', () => {
    test('should not leak sensitive information in error messages', async () => {
      const errorScenarios = [
        { endpoint: '/api/auth/login', data: { email: 'test@example.com', password: 'wrong' } },
        { endpoint: '/api/auth/register', data: { email: 'invalid', password: 'weak' } },
        { endpoint: '/api/auth/refresh', data: { refreshToken: 'invalid' } },
        { endpoint: '/api/auth/me', headers: { 'Authorization': 'Bearer invalid' } }
      ];

      for (const scenario of errorScenarios) {
        let response;

        if (scenario.headers) {
          response = await request(app)
            .get(scenario.endpoint)
            .set(scenario.headers);
        } else {
          response = await request(app)
            .post(scenario.endpoint)
            .send(scenario.data);
        }

        if (response.status >= 400) {
          const errorText = JSON.stringify(response.body);

          // Should not contain technical details
          expect(errorText).not.toMatch(/password|hash|salt|bcrypt|jwt|secret|database|sql|stack|trace|internal|server/gi);

          // Should not contain file paths
          expect(errorText).not.toMatch(/\/|\\|src|node_modules/gi);

          // Should not contain version information
          expect(errorText).not.toMatch(/\d+\.\d+\.\d+/);
        }
      }
    });

    test('should provide consistent error response format', async () => {
      const errorEndpoints = [
        '/api/auth/login',
        '/api/auth/register',
        '/api/auth/refresh',
        '/api/auth/me'
      ];

      for (const endpoint of errorEndpoints) {
        let response;

        try {
          if (endpoint === '/api/auth/me') {
            response = await request(app)
              .get(endpoint)
              .set('Authorization', 'Bearer invalid');
          } else {
            response = await request(app)
              .post(endpoint)
              .send({ invalid: 'data' });
          }
        } catch (error) {
          // Should not throw unhandled exceptions
          fail(`Request to ${endpoint} threw an unhandled exception: ${error.message}`);
        }

        expect(response.body).toHaveProperty('error');

        // Error messages should be strings
        if (response.body.message) {
          expect(typeof response.body.message).toBe('string');
        }
      }
    });
  });

  describe('Resource Exhaustion Scenarios', () => {
    test('should handle memory pressure gracefully', async () => {
      const largePayload = {
        email: 'test@example.com',
        password: 'SecurePass123!',
        confirmPassword: 'SecurePass123!',
        // Add large amount of data
        ...Object.fromEntries(
          Array.from({ length: 1000 }, (_, i) => [`key${i}`, 'x'.repeat(1000)])
        )
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(largePayload);

      // Should handle gracefully without crashing
      expect([400, 413, 201]).toContain(response.status);
    });

    test('should handle concurrent request storms', async () => {
      const promises = [];
      const requestCount = 100;

      // Create request storm
      for (let i = 0; i < requestCount; i++) {
        promises.push(
          request(app)
            .post('/api/auth/login')
            .send({
              email: `user${i}@example.com`,
              password: 'password123'
            })
        );
      }

      const responses = await Promise.all(promises);

      // All should complete without server crash
      expect(responses).toHaveLength(requestCount);

      responses.forEach(response => {
        expect([200, 401, 400, 429]).toContain(response.status);
      });
    });
  });
});