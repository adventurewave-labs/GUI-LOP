/**
 * Authentication Routes
 * Secure authentication endpoints with comprehensive security measures
 */

import express from 'express';
import { body, validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { AuthMiddleware } from '../middleware/auth-middleware.js';

const router = express.Router();

// Initialize auth middleware
const auth = new AuthMiddleware();

// Security middleware
router.use(helmet());

// Rate limiting middleware
const createRateLimiter = (windowMs, max, message) => rateLimit({
  windowMs,
  max,
  message: {
    error: 'Too many requests',
    message,
    retryAfter: Math.ceil(windowMs / 1000)
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false
});

// Rate limiters for different endpoints
const loginLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  5, // 5 attempts
  'Too many login attempts, please try again later'
);

const registerLimiter = createRateLimiter(
  60 * 60 * 1000, // 1 hour
  3, // 3 registrations
  'Too many registration attempts, please try again later'
);

const passwordLimiter = createRateLimiter(
  60 * 60 * 1000, // 1 hour
  5, // 5 password resets
  'Too many password reset attempts, please try again later'
);

const tokenLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  20, // 20 token refreshes
  'Too many token requests, please try again later'
);

// In-memory user store (in production, use a proper database)
const users = new Map();
const refreshTokens = new Map();

// Validation rules
const registerValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),
  body('password')
    .isLength({ min: 8 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must be at least 8 characters with uppercase, lowercase, number, and special character'),
  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Password confirmation does not match');
      }
      return true;
    })
];

const loginValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
];

const refreshTokenValidation = [
  body('refreshToken')
    .notEmpty()
    .withMessage('Refresh token is required')
];

/**
 * POST /api/auth/register
 * Register a new user
 */
router.post('/register', registerLimiter, registerValidation, async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { email, password, role = 'user' } = req.body;

    // Check if user already exists
    if (users.has(email)) {
      return res.status(409).json({
        error: 'User already exists',
        message: 'An account with this email already exists'
      });
    }

    // Hash password
    const hashedPassword = await auth.hashPassword(password);

    // Create user
    const user = {
      id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      email,
      password: hashedPassword,
      role,
      createdAt: new Date().toISOString(),
      lastLogin: null,
      isActive: true,
      loginAttempts: 0,
      lockedUntil: null
    };

    users.set(email, user);

    // Generate tokens
    const accessToken = auth.generateAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role
    });

    const refreshToken = auth.generateRefreshToken({
      userId: user.id,
      email: user.email
    });

    // Store refresh token
    refreshTokens.set(refreshToken, {
      userId: user.id,
      email: user.email,
      createdAt: new Date().toISOString()
    });

    // Return user data without password
    const { password: _, ...userWithoutPassword } = user;

    res.status(201).json({
      message: 'User registered successfully',
      user: userWithoutPassword,
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: auth.parseExpiry(auth.tokenExpiry)
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      error: 'Registration failed',
      message: error.message
    });
  }
});

/**
 * POST /api/auth/login
 * Authenticate user and return tokens
 */
router.post('/login', loginLimiter, loginValidation, async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { email, password } = req.body;

    // Find user
    const user = users.get(email);
    if (!user) {
      return res.status(401).json({
        error: 'Authentication failed',
        message: 'Invalid email or password'
      });
    }

    // Check if account is locked
    if (user.lockedUntil && new Date() < new Date(user.lockedUntil)) {
      return res.status(423).json({
        error: 'Account locked',
        message: 'Account is temporarily locked due to too many failed attempts',
        lockedUntil: user.lockedUntil
      });
    }

    // Check if account is active
    if (!user.isActive) {
      return res.status(403).json({
        error: 'Account inactive',
        message: 'Account has been deactivated'
      });
    }

    // Verify password
    const isPasswordValid = await auth.verifyPassword(password, user.password);
    if (!isPasswordValid) {
      // Increment failed attempts
      user.loginAttempts = (user.loginAttempts || 0) + 1;

      // Lock account after 5 failed attempts
      if (user.loginAttempts >= 5) {
        user.lockedUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutes
      }

      return res.status(401).json({
        error: 'Authentication failed',
        message: 'Invalid email or password'
      });
    }

    // Reset failed attempts on successful login
    user.loginAttempts = 0;
    user.lockedUntil = null;
    user.lastLogin = new Date().toISOString();

    // Generate tokens
    const accessToken = auth.generateAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role
    });

    const refreshToken = auth.generateRefreshToken({
      userId: user.id,
      email: user.email
    });

    // Store refresh token
    refreshTokens.set(refreshToken, {
      userId: user.id,
      email: user.email,
      createdAt: new Date().toISOString()
    });

    // Return user data without password
    const { password: _, ...userWithoutPassword } = user;

    res.json({
      message: 'Login successful',
      user: userWithoutPassword,
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: auth.parseExpiry(auth.tokenExpiry)
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      error: 'Login failed',
      message: error.message
    });
  }
});

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
router.post('/refresh', tokenLimiter, refreshTokenValidation, async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { refreshToken } = req.body;

    // Check if refresh token exists
    const tokenData = refreshTokens.get(refreshToken);
    if (!tokenData) {
      return res.status(401).json({
        error: 'Invalid refresh token',
        message: 'Refresh token not found or has been revoked'
      });
    }

    // Verify refresh token
    const decoded = auth.verifyToken(refreshToken, 'refresh');

    // Check if user still exists and is active
    const user = Array.from(users.values()).find(u => u.id === decoded.sub);
    if (!user || !user.isActive) {
      // Remove invalid refresh token
      refreshTokens.delete(refreshToken);
      return res.status(401).json({
        error: 'Invalid refresh token',
        message: 'User account not found or inactive'
      });
    }

    // Generate new access token
    const newAccessToken = auth.generateAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role
    });

    res.json({
      message: 'Token refreshed successfully',
      tokens: {
        accessToken: newAccessToken,
        expiresIn: auth.parseExpiry(auth.tokenExpiry)
      }
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(401).json({
      error: 'Token refresh failed',
      message: error.message
    });
  }
});

/**
 * POST /api/auth/logout
 * Logout user and revoke tokens
 */
router.post('/logout', auth.authenticate(), async (req, res) => {
  try {
    const { refreshToken } = req.body;
    const user = req.user;

    // Revoke current access token
    if (user.jti) {
      await auth.revokeToken(user.jti);
    }

    // Remove refresh token if provided
    if (refreshToken && refreshTokens.has(refreshToken)) {
      refreshTokens.delete(refreshToken);
    }

    // Revoke all user tokens (optional, for complete logout)
    await auth.revokeAllUserTokens(user.id);

    res.json({
      message: 'Logout successful',
      revokedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      error: 'Logout failed',
      message: error.message
    });
  }
});

/**
 * GET /api/auth/me
 * Get current user profile
 */
router.get('/me', auth.authenticate(), (req, res) => {
  try {
    const user = Array.from(users.values()).find(u => u.id === req.user.id);
    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User account not found'
      });
    }

    const { password: _, ...userWithoutPassword } = user;

    res.json({
      user: userWithoutPassword,
      authenticatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      error: 'Failed to get profile',
      message: error.message
    });
  }
});

/**
 * POST /api/auth/change-password
 * Change user password
 */
router.post('/change-password', passwordLimiter, auth.authenticate(), [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('New password must be at least 8 characters with uppercase, lowercase, number, and special character'),
  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error('Password confirmation does not match');
      }
      return true;
    })
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    // Find user
    const user = Array.from(users.values()).find(u => u.id === userId);
    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User account not found'
      });
    }

    // Verify current password
    const isCurrentPasswordValid = await auth.verifyPassword(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      return res.status(401).json({
        error: 'Authentication failed',
        message: 'Current password is incorrect'
      });
    }

    // Check if new password is different from current
    const isSamePassword = await auth.verifyPassword(newPassword, user.password);
    if (isSamePassword) {
      return res.status(400).json({
        error: 'Invalid password',
        message: 'New password must be different from current password'
      });
    }

    // Hash new password
    const hashedNewPassword = await auth.hashPassword(newPassword);
    user.password = hashedNewPassword;
    user.passwordChangedAt = new Date().toISOString();

    // Revoke all existing tokens (force re-login)
    await auth.revokeAllUserTokens(userId);

    // Clear all refresh tokens for this user
    for (const [token, tokenData] of refreshTokens.entries()) {
      if (tokenData.userId === userId) {
        refreshTokens.delete(token);
      }
    }

    res.json({
      message: 'Password changed successfully',
      changedAt: user.passwordChangedAt
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      error: 'Password change failed',
      message: error.message
    });
  }
});

export default router;