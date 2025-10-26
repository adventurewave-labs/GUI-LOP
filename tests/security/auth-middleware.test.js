/**
 * Authentication Middleware Security Tests
 * Comprehensive security testing for authentication middleware
 */

import { AuthMiddleware } from '../../src/backend/middleware/auth-middleware.js';
import { BlacklistService } from '../../src/backend/services/blacklist-service.js';
import { RateLimitService } from '../../src/backend/services/rate-limit-service.js';

// Mock dependencies
jest.mock('jsonwebtoken');
jest.mock('bcrypt');
jest.mock('crypto');

const mockJwt = require('jsonwebtoken');
const mockBcrypt = require('bcrypt');
const mockCrypto = require('crypto');

describe('AuthMiddleware Security Tests', () => {
  let authMiddleware;
  let mockBlacklistService;
  let mockRateLimitService;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock BlacklistService
    mockBlacklistService = {
      isBlacklisted: jest.fn(),
      addToBlacklist: jest.fn(),
      blacklistUserTokens: jest.fn()
    };

    // Mock RateLimitService
    mockRateLimitService = {
      isExceeded: jest.fn()
    };

    authMiddleware = new AuthMiddleware({
      jwtSecret: 'test-secret',
      jwtRefreshSecret: 'test-refresh-secret',
      tokenExpiry: '15m',
      refreshTokenExpiry: '7d'
    });

    // Replace services with mocks
    authMiddleware.blacklistService = mockBlacklistService;
    authMiddleware.rateLimitService = mockRateLimitService;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('Password Security', () => {
    describe('hashPassword', () => {
      test('should hash password with proper security measures', async () => {
        const password = 'SecurePass123!';
        const hashedPassword = 'hashed-password';

        mockBcrypt.hash.mockResolvedValue(hashedPassword);

        const result = await authMiddleware.hashPassword(password);

        expect(mockBcrypt.hash).toHaveBeenCalledWith(password, 12);
        expect(result).toBe(hashedPassword);
      });

      test('should reject empty password', async () => {
        await expect(authMiddleware.hashPassword(''))
          .rejects.toThrow('Password must be a non-empty string');
      });

      test('should reject null password', async () => {
        await expect(authMiddleware.hashPassword(null))
          .rejects.toThrow('Password must be a non-empty string');
      });

      test('should reject short passwords', async () => {
        await expect(authMiddleware.hashPassword('short'))
          .rejects.toThrow('Password must be at least 8 characters long');
      });

      test('should reject non-string passwords', async () => {
        await expect(authMiddleware.hashPassword(123456))
          .rejects.toThrow('Password must be a non-empty string');
      });

      test('should handle hashing failures gracefully', async () => {
        mockBcrypt.hash.mockRejectedValue(new Error('Hashing failed'));

        await expect(authMiddleware.hashPassword('ValidPass123!'))
          .rejects.toThrow('Password hashing failed');
      });
    });

    describe('verifyPassword', () => {
      test('should verify correct password', async () => {
        const password = 'CorrectPass123!';
        const hash = 'hashed-password';

        mockBcrypt.compare.mockResolvedValue(true);

        const result = await authMiddleware.verifyPassword(password, hash);

        expect(mockBcrypt.compare).toHaveBeenCalledWith(password, hash);
        expect(result).toBe(true);
      });

      test('should reject incorrect password', async () => {
        const password = 'WrongPass123!';
        const hash = 'hashed-password';

        mockBcrypt.compare.mockResolvedValue(false);

        const result = await authMiddleware.verifyPassword(password, hash);

        expect(result).toBe(false);
      });

      test('should handle null inputs gracefully', async () => {
        const result1 = await authMiddleware.verifyPassword(null, 'hash');
        const result2 = await authMiddleware.verifyPassword('password', null);
        const result3 = await authMiddleware.verifyPassword(null, null);

        expect(result1).toBe(false);
        expect(result2).toBe(false);
        expect(result3).toBe(false);
      });

      test('should handle verification errors gracefully', async () => {
        mockBcrypt.compare.mockRejectedValue(new Error('Verification failed'));

        const result = await authMiddleware.verifyPassword('password', 'hash');

        expect(result).toBe(false);
      });
    });
  });

  describe('Token Security', () => {
    describe('generateAccessToken', () => {
      test('should generate secure JWT with required claims', () => {
        const payload = {
          userId: 'user123',
          email: 'test@example.com',
          role: 'user'
        };

        const expectedTokenPayload = expect.objectContaining({
          sub: 'user123',
          email: 'test@example.com',
          role: 'user',
          iat: expect.any(Number),
          exp: expect.any(Number),
          jti: expect.any(String),
          type: 'access'
        });

        mockJwt.sign.mockReturnValue('mock-jwt-token');
        mockCrypto.randomUUID.mockReturnValue('mock-uuid');

        const token = authMiddleware.generateAccessToken(payload);

        expect(mockJwt.sign).toHaveBeenCalledWith(
          expectedTokenPayload,
          'test-secret',
          {
            algorithm: 'HS256',
            issuer: 'gui-lop',
            audience: 'gui-lop-users'
          }
        );
        expect(token).toBe('mock-jwt-token');
      });

      test('should include unique JTI for each token', () => {
        const payload = { userId: 'user123', email: 'test@example.com' };

        mockJwt.sign.mockReturnValue('mock-jwt-token');
        mockCrypto.randomUUID
          .mockReturnValueOnce('uuid-1')
          .mockReturnValueOnce('uuid-2');

        const token1 = authMiddleware.generateAccessToken(payload);
        const token2 = authMiddleware.generateAccessToken(payload);

        expect(mockCrypto.randomUUID).toHaveBeenCalledTimes(2);
        expect(mockJwt.sign).toHaveBeenCalledTimes(2);
      });
    });

    describe('generateRefreshToken', () => {
      test('should generate secure refresh token with proper claims', () => {
        const payload = {
          userId: 'user123',
          email: 'test@example.com'
        };

        const expectedTokenPayload = expect.objectContaining({
          sub: 'user123',
          email: 'test@example.com',
          iat: expect.any(Number),
          exp: expect.any(Number),
          jti: expect.any(String),
          type: 'refresh'
        });

        mockJwt.sign.mockReturnValue('mock-refresh-token');
        mockCrypto.randomUUID.mockReturnValue('mock-uuid');

        const token = authMiddleware.generateRefreshToken(payload);

        expect(mockJwt.sign).toHaveBeenCalledWith(
          expectedTokenPayload,
          'test-refresh-secret',
          {
            algorithm: 'HS256',
            issuer: 'gui-lop',
            audience: 'gui-lop-refresh'
          }
        );
        expect(token).toBe('mock-refresh-token');
      });
    });

    describe('verifyToken', () => {
      test('should verify valid access token', () => {
        const token = 'Bearer valid-token';
        const decodedToken = {
          sub: 'user123',
          email: 'test@example.com',
          jti: 'token-id'
        };

        mockBlacklistService.isBlacklisted.mockReturnValue(false);
        mockJwt.decode.mockReturnValue(decodedToken);
        mockJwt.verify.mockReturnValue(decodedToken);

        const result = authMiddleware.verifyToken(token, 'access');

        expect(mockBlacklistService.isBlacklisted).toHaveBeenCalledWith('token-id');
        expect(mockJwt.verify).toHaveBeenCalledWith(
          'valid-token',
          'test-secret',
          {
            algorithms: ['HS256'],
            issuer: 'gui-lop',
            audience: 'gui-lop-users'
          }
        );
        expect(result).toBe(decodedToken);
      });

      test('should reject blacklisted tokens', () => {
        const token = 'Bearer blacklisted-token';
        const decodedToken = { jti: 'blacklisted-id' };

        mockJwt.decode.mockReturnValue(decodedToken);
        mockBlacklistService.isBlacklisted.mockReturnValue(true);

        expect(() => authMiddleware.verifyToken(token))
          .toThrow('Token has been revoked');
      });

      test('should reject expired tokens', () => {
        const token = 'expired-token';

        mockBlacklistService.isBlacklisted.mockReturnValue(false);
        mockJwt.decode.mockReturnValue({ jti: 'token-id' });
        mockJwt.verify.mockImplementation(() => {
          const error = new Error('Token expired');
          error.name = 'TokenExpiredError';
          throw error;
        });

        expect(() => authMiddleware.verifyToken(token))
          .toThrow('Token has expired');
      });

      test('should reject invalid tokens', () => {
        const token = 'invalid-token';

        mockBlacklistService.isBlacklisted.mockReturnValue(false);
        mockJwt.decode.mockReturnValue({ jti: 'token-id' });
        mockJwt.verify.mockImplementation(() => {
          const error = new Error('Invalid token');
          error.name = 'JsonWebTokenError';
          throw error;
        });

        expect(() => authMiddleware.verifyToken(token))
          .toThrow('Invalid token');
      });

      test('should reject tokens without bearer prefix', () => {
        expect(() => authMiddleware.verifyToken('invalid-format'))
          .toThrow('Token is required');
      });

      test('should reject null/undefined tokens', () => {
        expect(() => authMiddleware.verifyToken(null))
          .toThrow('Token is required');
        expect(() => authMiddleware.verifyToken(undefined))
          .toThrow('Token is required');
      });
    });
  });

  describe('CSRF Security', () => {
    describe('generateCSRFToken', () => {
      test('should generate cryptographically secure CSRF token', () => {
        const mockToken = 'a1b2c3d4e5f6789012345678901234567890abcdef12345678901234567890abcd';
        mockCrypto.randomBytes.mockReturnValue({
          toString: jest.fn().mockReturnValue(mockToken)
        });

        const token = authMiddleware.generateCSRFToken();

        expect(mockCrypto.randomBytes).toHaveBeenCalledWith(32);
        expect(token).toBe(mockToken);
      });
    });

    describe('verifyCSRFToken', () => {
      test('should verify CSRF tokens using timing-safe comparison', () => {
        const token = 'valid-csrf-token';
        const sessionToken = 'valid-csrf-token';

        mockCrypto.timingSafeEqual.mockReturnValue(true);

        const result = authMiddleware.verifyCSRFToken(token, sessionToken);

        expect(mockCrypto.timingSafeEqual).toHaveBeenCalledWith(
          Buffer.from(token, 'hex'),
          Buffer.from(sessionToken, 'hex')
        );
        expect(result).toBe(true);
      });

      test('should reject mismatched CSRF tokens', () => {
        const token = 'token1';
        const sessionToken = 'token2';

        mockCrypto.timingSafeEqual.mockReturnValue(false);

        const result = authMiddleware.verifyCSRFToken(token, sessionToken);

        expect(result).toBe(false);
      });
    });
  });

  describe('Token Revocation', () => {
    describe('revokeToken', () => {
      test('should add token to blacklist', async () => {
        const jti = 'token-to-revoke';

        mockBlacklistService.addToBlacklist.mockResolvedValue(true);

        await authMiddleware.revokeToken(jti);

        expect(mockBlacklistService.addToBlacklist).toHaveBeenCalledWith(jti);
      });
    });

    describe('revokeAllUserTokens', () => {
      test('should blacklist all user tokens', async () => {
        const userId = 'user123';

        mockBlacklistService.blacklistUserTokens.mockResolvedValue(true);

        await authMiddleware.revokeAllUserTokens(userId);

        expect(mockBlacklistService.blacklistUserTokens).toHaveBeenCalledWith(userId);
      });
    });
  });

  describe('Security Headers', () => {
    test('should include comprehensive security headers', () => {
      const expectedHeaders = {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-XSS-Protection': '1; mode=block',
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
      };

      expect(authMiddleware.securityHeaders).toEqual(expectedHeaders);
    });
  });

  describe('Rate Limiting Integration', () => {
    describe('authenticate middleware', () => {
      test('should check rate limits during authentication', async () => {
        const mockReq = {
          headers: { authorization: 'Bearer valid-token' }
        };
        const mockRes = {
          setHeader: jest.fn(),
          status: jest.fn().mockReturnThis(),
          json: jest.fn()
        };
        const mockNext = jest.fn();

        const decodedToken = {
          sub: 'user123',
          email: 'test@example.com',
          jti: 'token-id',
          role: 'user'
        };

        mockBlacklistService.isBlacklisted.mockReturnValue(false);
        mockJwt.decode.mockReturnValue(decodedToken);
        mockJwt.verify.mockReturnValue(decodedToken);
        mockRateLimitService.isExceeded.mockReturnValue({ exceeded: false });

        const middleware = authMiddleware.authenticate();
        await middleware(mockReq, mockRes, mockNext);

        expect(mockRateLimitService.isExceeded).toHaveBeenCalledWith('auth:user123');
        expect(mockNext).toHaveBeenCalled();
      });

      test('should reject requests when rate limit exceeded', async () => {
        const mockReq = {
          headers: { authorization: 'Bearer valid-token' }
        };
        const mockRes = {
          setHeader: jest.fn(),
          status: jest.fn().mockReturnThis(),
          json: jest.fn()
        };
        const mockNext = jest.fn();

        const decodedToken = {
          sub: 'user123',
          email: 'test@example.com',
          jti: 'token-id',
          role: 'user'
        };

        mockBlacklistService.isBlacklisted.mockReturnValue(false);
        mockJwt.decode.mockReturnValue(decodedToken);
        mockJwt.verify.mockReturnValue(decodedToken);
        mockRateLimitService.isExceeded.mockReturnValue({
          exceeded: true,
          message: 'Rate limit exceeded'
        });

        const middleware = authMiddleware.authenticate();
        await middleware(mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(429);
        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'Rate limit exceeded',
          message: 'Too many authentication attempts'
        });
        expect(mockNext).not.toHaveBeenCalled();
      });
    });
  });

  describe('Authorization Security', () => {
    describe('authorize middleware', () => {
      test('should allow authorized roles', () => {
        const mockReq = {
          user: { id: 'user123', role: 'admin' }
        };
        const mockRes = {
          status: jest.fn().mockReturnThis(),
          json: jest.fn()
        };
        const mockNext = jest.fn();

        const middleware = authMiddleware.authorize(['admin', 'moderator']);
        middleware(mockReq, mockRes, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });

      test('should reject unauthorized roles', () => {
        const mockReq = {
          user: { id: 'user123', role: 'user' }
        };
        const mockRes = {
          status: jest.fn().mockReturnThis(),
          json: jest.fn()
        };
        const mockNext = jest.fn();

        const middleware = authMiddleware.authorize(['admin', 'moderator']);
        middleware(mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'Insufficient permissions',
          message: 'Role not authorized for this resource'
        });
        expect(mockNext).not.toHaveBeenCalled();
      });

      test('should reject unauthenticated users', () => {
        const mockReq = {};
        const mockRes = {
          status: jest.fn().mockReturnThis(),
          json: jest.fn()
        };
        const mockNext = jest.fn();

        const middleware = authMiddleware.authorize(['admin']);
        middleware(mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(401);
        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'Authentication required',
          message: 'User not authenticated'
        });
        expect(mockNext).not.toHaveBeenCalled();
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle malformed JWT payload', () => {
      const token = 'Bearer malformed-token';

      mockBlacklistService.isBlacklisted.mockReturnValue(false);
      mockJwt.decode.mockReturnValue(null);

      expect(() => authMiddleware.verifyToken(token))
        .toThrow('Invalid token');
    });

    test('should handle JWT verification errors', () => {
      const token = 'Bearer error-token';

      mockBlacklistService.isBlacklisted.mockReturnValue(false);
      mockJwt.decode.mockReturnValue({ jti: 'token-id' });
      mockJwt.verify.mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      expect(() => authMiddleware.verifyToken(token))
        .toThrow('Unexpected error');
    });

    test('should parse various expiry formats', () => {
      expect(authMiddleware.parseExpiry('15m')).toBe(900);
      expect(authMiddleware.parseExpiry('1h')).toBe(3600);
      expect(authMiddleware.parseExpiry('1d')).toBe(86400);
      expect(authMiddleware.parseExpiry('30s')).toBe(30);
      expect(authMiddleware.parseExpiry('invalid')).toBe(900); // default
    });
  });
});