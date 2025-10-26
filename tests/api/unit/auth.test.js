/**
 * Authentication API Unit Tests
 * Comprehensive tests for authentication endpoints
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { TestEnvironment } from '../setup.js';
import { ApiError, ERROR_CODES } from '../../../src/api/middleware/error-handler.js';
import {
  validateUserRegistration,
  validateLogin,
  validateChangePassword,
  validateRefreshToken
} from '../../../src/api/validators/validation-middleware.js';
import {
  authRateLimiter,
  registrationRateLimiter,
  passwordChangeRateLimiter
} from '../../../src/api/middleware/rate-limiter.js';

describe('Authentication API', () => {
  let app;
  let testEnv;

  beforeEach(async () => {
    testEnv = TestEnvironment;
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

    // Mock in-memory user store
    const users = new Map();
    const refreshTokens = new Map();

    // Helper functions
    const hashPassword = async (password) => {
      // Mock password hashing
      return `hashed_${password}`;
    };

    const verifyPassword = async (password, hash) => {
      return hash === `hashed_${password}`;
    };

    const generateTokens = (user) => {
      return {
        accessToken: `access_token_${user.id}_${Date.now()}`,
        refreshToken: `refresh_token_${user.id}_${Date.now()}`,
        expiresIn: 3600
      };
    };

    // Authentication routes
    app.post('/api/v1/auth/register',
      registrationRateLimiter,
      validateUserRegistration,
      async (req, res, next) => {
        try {
          const { email, password, firstName, lastName, role = 'user' } = req.body;

          // Check if user already exists
          if (users.has(email)) {
            throw new ApiError('User already exists', ERROR_CODES.USER_ALREADY_EXISTS, 409);
          }

          // Create user
          const hashedPassword = await hashPassword(password);
          const user = {
            id: `user_${testEnv.utils.generateRandomId()}`,
            email,
            password: hashedPassword,
            firstName,
            lastName,
            role,
            isActive: true,
            createdAt: new Date().toISOString(),
            lastLogin: null
          };

          users.set(email, user);

          // Generate tokens
          const tokens = generateTokens(user);
          refreshTokens.set(tokens.refreshToken, {
            userId: user.id,
            email: user.email,
            createdAt: new Date().toISOString()
          });

          const { password: _, ...userWithoutPassword } = user;

          res.status(201).json({
            success: true,
            message: 'User registered successfully',
            data: {
              user: userWithoutPassword,
              tokens
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

    app.post('/api/v1/auth/login',
      authRateLimiter,
      validateLogin,
      async (req, res, next) => {
        try {
          const { email, password } = req.body;

          // Find user
          const user = users.get(email);
          if (!user) {
            throw new ApiError('Invalid email or password', ERROR_CODES.UNAUTHORIZED, 401);
          }

          // Check if account is active
          if (!user.isActive) {
            throw new ApiError('Account has been deactivated', ERROR_CODES.ACCOUNT_INACTIVE, 403);
          }

          // Verify password
          const isPasswordValid = await verifyPassword(password, user.password);
          if (!isPasswordValid) {
            throw new ApiError('Invalid email or password', ERROR_CODES.UNAUTHORIZED, 401);
          }

          // Update last login
          user.lastLogin = new Date().toISOString();

          // Generate tokens
          const tokens = generateTokens(user);
          refreshTokens.set(tokens.refreshToken, {
            userId: user.id,
            email: user.email,
            createdAt: new Date().toISOString()
          });

          const { password: _, ...userWithoutPassword } = user;

          res.json({
            success: true,
            message: 'Login successful',
            data: {
              user: userWithoutPassword,
              tokens
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

    app.post('/api/v1/auth/refresh',
      validateRefreshToken,
      async (req, res, next) => {
        try {
          const { refreshToken } = req.body;

          const tokenData = refreshTokens.get(refreshToken);
          if (!tokenData) {
            throw new ApiError('Invalid refresh token', ERROR_CODES.TOKEN_INVALID, 401);
          }

          // Find user
          const user = Array.from(users.values()).find(u => u.id === tokenData.userId);
          if (!user || !user.isActive) {
            refreshTokens.delete(refreshToken);
            throw new ApiError('User account not found or inactive', ERROR_CODES.USER_NOT_FOUND, 401);
          }

          // Generate new access token
          const newTokens = generateTokens(user);

          // Update refresh token
          refreshTokens.delete(refreshToken);
          refreshTokens.set(newTokens.refreshToken, {
            userId: user.id,
            email: user.email,
            createdAt: new Date().toISOString()
          });

          res.json({
            success: true,
            message: 'Token refreshed successfully',
            data: {
              tokens: {
                accessToken: newTokens.accessToken,
                expiresIn: newTokens.expiresIn
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

    app.post('/api/v1/auth/logout',
      async (req, res, next) => {
        try {
          const { refreshToken } = req.body;

          if (refreshToken && refreshTokens.has(refreshToken)) {
            refreshTokens.delete(refreshToken);
          }

          res.json({
            success: true,
            message: 'Logout successful',
            data: {
              revokedAt: new Date().toISOString()
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

    app.get('/api/v1/auth/me',
      async (req, res, next) => {
        try {
          // Mock authentication middleware
          const authHeader = req.headers.authorization;
          if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new ApiError('Access token required', ERROR_CODES.AUTH_REQUIRED, 401);
          }

          const token = authHeader.substring(7);

          // Mock token verification - in real implementation, this would verify JWT
          const user = Array.from(users.values()).find(u =>
            token.includes(u.id) && u.isActive
          );

          if (!user) {
            throw new ApiError('Invalid access token', ERROR_CODES.TOKEN_INVALID, 401);
          }

          const { password: _, ...userWithoutPassword } = user;

          res.json({
            success: true,
            message: 'User profile retrieved successfully',
            data: {
              user: userWithoutPassword
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

  describe('POST /api/v1/auth/register', () => {
    const validUserData = testEnv.data.users.valid;

    test('should register a new user successfully', async () => {
      const userData = {
        ...validUserData,
        email: testEnv.utils.generateRandomEmail()
      };

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(userData)
        .expect(201);

      testEnv.utils.expectSuccessResponse(response, 201);

      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data).toHaveProperty('tokens');

      expect(response.body.data.user).toMatchObject({
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        role: userData.role,
        isActive: true
      });

      expect(response.body.data.user).toHaveProperty('id');
      expect(response.body.data.user).toHaveProperty('createdAt');
      expect(response.body.data.user).not.toHaveProperty('password');

      expect(response.body.data.tokens).toHaveProperty('accessToken');
      expect(response.body.data.tokens).toHaveProperty('refreshToken');
      expect(response.body.data.tokens).toHaveProperty('expiresIn');
    });

    test('should reject registration with existing email', async () => {
      const userData = validUserData;

      // First registration should succeed
      await request(app)
        .post('/api/v1/auth/register')
        .send(userData)
        .expect(201);

      // Second registration with same email should fail
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(userData)
        .expect(409);

      testEnv.utils.expectErrorResponse(response, ERROR_CODES.USER_ALREADY_EXISTS, 409);
    });

    test('should reject registration with invalid email', async () => {
      const userData = {
        ...validUserData,
        email: 'invalid-email'
      };

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(userData)
        .expect(400);

      testEnv.utils.expectErrorResponse(response, ERROR_CODES.VALIDATION_ERROR, 400);
      expect(response.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'email',
            message: expect.stringContaining('Valid email is required')
          })
        ])
      );
    });

    test('should reject registration with weak password', async () => {
      const userData = {
        ...validUserData,
        password: '123',
        email: testEnv.utils.generateRandomEmail()
      };

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(userData)
        .expect(400);

      testEnv.utils.expectErrorResponse(response, ERROR_CODES.VALIDATION_ERROR, 400);
      expect(response.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'password',
            message: expect.stringContaining('Password must be at least 8 characters')
          })
        ])
      );
    });

    test('should reject registration with password confirmation mismatch', async () => {
      const userData = {
        ...validUserData,
        password: 'ValidPass123!',
        confirmPassword: 'DifferentPass123!',
        email: testEnv.utils.generateRandomEmail()
      };

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(userData)
        .expect(400);

      testEnv.utils.expectErrorResponse(response, ERROR_CODES.VALIDATION_ERROR, 400);
    });

    test('should reject registration with missing required fields', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({})
        .expect(400);

      testEnv.utils.expectErrorResponse(response, ERROR_CODES.VALIDATION_ERROR, 400);
      expect(response.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'email' }),
          expect.objectContaining({ field: 'password' }),
          expect.objectContaining({ field: 'firstName' }),
          expect.objectContaining({ field: 'lastName' })
        ])
      );
    });

    test('should enforce rate limiting on registration endpoint', async () => {
      const userData = {
        ...validUserData,
        email: testEnv.utils.generateRandomEmail()
      };

      // Make multiple rapid requests
      const requests = [];
      for (let i = 0; i < 5; i++) {
        requests.push(
          request(app)
            .post('/api/v1/auth/register')
            .send({
              ...userData,
              email: testEnv.utils.generateRandomEmail()
            })
        );
      }

      const responses = await Promise.allSettled(requests);

      // At least some requests should be rate limited
      const rateLimitedResponses = responses.filter(
        result => result.status === 'fulfilled' && result.value.status === 429
      );

      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    let testUser;

    beforeEach(async () => {
      // Create a test user for login tests
      testUser = {
        ...testEnv.data.users.valid,
        email: testEnv.utils.generateRandomEmail()
      };

      await request(app)
        .post('/api/v1/auth/register')
        .send(testUser);
    });

    test('should login successfully with valid credentials', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password
        })
        .expect(200);

      testEnv.utils.expectSuccessResponse(response, 200);

      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data).toHaveProperty('tokens');

      expect(response.body.data.user).toMatchObject({
        email: testUser.email,
        firstName: testUser.firstName,
        lastName: testUser.lastName
      });

      expect(response.body.data.tokens).toHaveProperty('accessToken');
      expect(response.body.data.tokens).toHaveProperty('refreshToken');
    });

    test('should reject login with invalid email', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: testUser.password
        })
        .expect(401);

      testEnv.utils.expectErrorResponse(response, ERROR_CODES.UNAUTHORIZED, 401);
    });

    test('should reject login with invalid password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUser.email,
          password: 'wrongpassword'
        })
        .expect(401);

      testEnv.utils.expectErrorResponse(response, ERROR_CODES.UNAUTHORIZED, 401);
    });

    test('should reject login with missing credentials', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({})
        .expect(400);

      testEnv.utils.expectErrorResponse(response, ERROR_CODES.VALIDATION_ERROR, 400);
    });

    test('should enforce rate limiting on login endpoint', async () => {
      // Make multiple failed login attempts
      const requests = [];
      for (let i = 0; i < 6; i++) {
        requests.push(
          request(app)
            .post('/api/v1/auth/login')
            .send({
              email: testUser.email,
              password: 'wrongpassword'
            })
        );
      }

      const responses = await Promise.allSettled(requests);

      // Should be rate limited after multiple failed attempts
      const rateLimitedResponse = responses.find(
        result => result.status === 'fulfilled' && result.value.status === 429
      );

      expect(rateLimitedResponse).toBeDefined();
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    let testUser, tokens;

    beforeEach(async () => {
      // Create and login a test user
      testUser = {
        ...testEnv.data.users.valid,
        email: testEnv.utils.generateRandomEmail()
      };

      const registerResponse = await request(app)
        .post('/api/v1/auth/register')
        .send(testUser);

      tokens = registerResponse.body.data.tokens;
    });

    test('should refresh access token successfully', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({
          refreshToken: tokens.refreshToken
        })
        .expect(200);

      testEnv.utils.expectSuccessResponse(response, 200);

      expect(response.body.data).toHaveProperty('tokens');
      expect(response.body.data.tokens).toHaveProperty('accessToken');
      expect(response.body.data.tokens).toHaveProperty('expiresIn');

      // New access token should be different from original
      expect(response.body.data.tokens.accessToken).not.toBe(tokens.accessToken);
    });

    test('should reject refresh with invalid token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({
          refreshToken: 'invalid_refresh_token'
        })
        .expect(401);

      testEnv.utils.expectErrorResponse(response, ERROR_CODES.TOKEN_INVALID, 401);
    });

    test('should reject refresh with missing token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({})
        .expect(400);

      testEnv.utils.expectErrorResponse(response, ERROR_CODES.VALIDATION_ERROR, 400);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    let testUser, tokens;

    beforeEach(async () => {
      // Create and login a test user
      testUser = {
        ...testEnv.data.users.valid,
        email: testEnv.utils.generateRandomEmail()
      };

      const registerResponse = await request(app)
        .post('/api/v1/auth/register')
        .send(testUser);

      tokens = registerResponse.body.data.tokens;
    });

    test('should get user profile successfully with valid token', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(200);

      testEnv.utils.expectSuccessResponse(response, 200);

      expect(response.body.data.user).toMatchObject({
        email: testUser.email,
        firstName: testUser.firstName,
        lastName: testUser.lastName,
        role: testUser.role,
        isActive: true
      });

      expect(response.body.data.user).not.toHaveProperty('password');
    });

    test('should reject profile request without token', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .expect(401);

      testEnv.utils.expectErrorResponse(response, ERROR_CODES.AUTH_REQUIRED, 401);
    });

    test('should reject profile request with invalid token', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid_token')
        .expect(401);

      testEnv.utils.expectErrorResponse(response, ERROR_CODES.TOKEN_INVALID, 401);
    });

    test('should reject profile request with malformed authorization header', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'InvalidFormat token')
        .expect(401);

      testEnv.utils.expectErrorResponse(response, ERROR_CODES.AUTH_REQUIRED, 401);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    let testUser, tokens;

    beforeEach(async () => {
      // Create and login a test user
      testUser = {
        ...testEnv.data.users.valid,
        email: testEnv.utils.generateRandomEmail()
      };

      const registerResponse = await request(app)
        .post('/api/v1/auth/register')
        .send(testUser);

      tokens = registerResponse.body.data.tokens;
    });

    test('should logout successfully with refresh token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .send({
          refreshToken: tokens.refreshToken
        })
        .expect(200);

      testEnv.utils.expectSuccessResponse(response, 200);

      expect(response.body.data).toHaveProperty('revokedAt');
      expect(response.body.data.revokedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

      // Refresh token should no longer work
      const refreshResponse = await request(app)
        .post('/api/v1/auth/refresh')
        .send({
          refreshToken: tokens.refreshToken
        })
        .expect(401);

      testEnv.utils.expectErrorResponse(refreshResponse, ERROR_CODES.TOKEN_INVALID, 401);
    });

    test('should logout successfully without refresh token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .send({})
        .expect(200);

      testEnv.utils.expectSuccessResponse(response, 200);
    });
  });
});