/**
 * Authentication Routes - Complete JWT Authentication System
 * Handles user registration, login, token refresh, and logout
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import { userStore } from '../models/User.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  revokeToken,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  rotateRefreshToken
} from '../utils/jwtUtils.js';
import { authRateLimit } from '../middleware/auth.js';

const router = express.Router();

/**
 * Validation Helper Functions
 */
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function validatePassword(password) {
  // Password must be at least 8 characters, contain uppercase, lowercase, and number
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/;
  return passwordRegex.test(password);
}

function validateName(name) {
  return name && name.trim().length >= 2 && name.trim().length <= 50;
}

function sanitizeInput(input) {
  return input.trim().replace(/[<>]/g, '');
}

/**
 * POST /api/auth/register
 * User registration with comprehensive validation
 */
router.post('/register', authRateLimit(5, 15 * 60 * 1000), async (req, res) => {
  try {
    const { email, password, firstName, lastName, role = 'user' } = req.body;

    // Input validation
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required: email, password, firstName, lastName',
        code: 'MISSING_FIELDS'
      });
    }

    // Validate email format
    if (!validateEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format',
        code: 'INVALID_EMAIL'
      });
    }

    // Validate password strength
    if (!validatePassword(password)) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long and contain uppercase, lowercase, and number',
        code: 'WEAK_PASSWORD',
        requirements: {
          minLength: 8,
          requiresUppercase: true,
          requiresLowercase: true,
          requiresNumber: true
        }
      });
    }

    // Validate names
    if (!validateName(firstName) || !validateName(lastName)) {
      return res.status(400).json({
        success: false,
        message: 'First and last names must be between 2-50 characters',
        code: 'INVALID_NAME'
      });
    }

    // Validate role
    const validRoles = ['user', 'admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role. Must be one of: ${validRoles.join(', ')}`,
        code: 'INVALID_ROLE'
      });
    }

    // Sanitize inputs
    const sanitizedData = {
      email: sanitizeInput(email.toLowerCase()),
      password,
      firstName: sanitizeInput(firstName),
      lastName: sanitizeInput(lastName),
      role
    };

    // Create user
    const user = await userStore.create(sanitizedData);

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    console.log(`New user registered: ${user.email} (${user.id})`);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          isActive: user.isActive,
          createdAt: user.createdAt
        },
        tokens: {
          accessToken,
          refreshToken,
          tokenType: 'Bearer',
          expiresIn: 900 // 15 minutes in seconds
        }
      },
      metadata: {
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      }
    });

  } catch (error) {
    console.error('Registration error:', error.message);

    if (error.message.includes('already exists')) {
      return res.status(409).json({
        success: false,
        message: 'User with this email already exists',
        code: 'EMAIL_EXISTS',
        field: 'email'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Registration failed. Please try again later.',
      code: 'REGISTRATION_ERROR'
    });
  }
});

/**
 * POST /api/auth/login
 * User login with JWT token generation
 */
router.post('/login', authRateLimit(5, 15 * 60 * 1000), async (req, res) => {
  try {
    const { email, password } = req.body;

    // Input validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required',
        code: 'MISSING_CREDENTIALS'
      });
    }

    // Validate email format
    if (!validateEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format',
        code: 'INVALID_EMAIL'
      });
    }

    // Sanitize email
    const sanitizedEmail = sanitizeInput(email.toLowerCase());

    // Find user
    const user = userStore.findByEmailForAuth(sanitizedEmail);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated. Please contact support.',
        code: 'ACCOUNT_DEACTIVATED'
      });
    }

    // Verify password
    const isPasswordValid = await user.verifyPassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
    }

    // Generate tokens
    const accessToken = generateAccessToken(user.toJSON());
    const refreshToken = generateRefreshToken(user.toJSON());

    // Get user agent for security
    const userAgent = req.headers['user-agent'];

    console.log(`User logged in: ${user.email} (${user.id}) - ${userAgent}`);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          isActive: user.isActive,
          lastLogin: new Date().toISOString()
        },
        tokens: {
          accessToken,
          refreshToken,
          tokenType: 'Bearer',
          expiresIn: 900 // 15 minutes in seconds
        }
      },
      metadata: {
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      }
    });

  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Login failed. Please try again later.',
      code: 'LOGIN_ERROR'
    });
  }
});

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
router.post('/refresh', authRateLimit(10, 15 * 60 * 1000), async (req, res) => {
  try {
    const { refreshToken } = req.body;

    // Input validation
    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required',
        code: 'REFRESH_TOKEN_REQUIRED'
      });
    }

    // Get user agent for security
    const userAgent = req.headers['user-agent'];

    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken, userAgent);

    // Get user
    const user = userStore.findById(decoded.sub);
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'User not found or account deactivated',
        code: 'USER_INVALID'
      });
    }

    // Generate new access token
    const newAccessToken = generateAccessToken(user);

    // Rotate refresh token (generate new one, revoke old)
    const newRefreshToken = rotateRefreshToken(refreshToken, user, userAgent);

    console.log(`Token refreshed for user: ${user.email} (${user.id})`);

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        tokens: {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          tokenType: 'Bearer',
          expiresIn: 900 // 15 minutes in seconds
        }
      },
      metadata: {
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      }
    });

  } catch (error) {
    console.error('Token refresh error:', error.message);

    if (error.message.includes('expired')) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token expired. Please login again.',
        code: 'REFRESH_TOKEN_EXPIRED'
      });
    } else if (error.message.includes('not found')) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token invalid. Please login again.',
        code: 'REFRESH_TOKEN_INVALID'
      });
    } else if (error.message.includes('Session mismatch')) {
      return res.status(401).json({
        success: false,
        message: 'Security violation detected. Please login again.',
        code: 'SECURITY_VIOLATION'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Token refresh failed. Please login again.',
      code: 'REFRESH_ERROR'
    });
  }
});

/**
 * POST /api/auth/logout
 * Logout user and revoke tokens
 */
router.post('/logout', async (req, res) => {
  try {
    const { refreshToken, accessToken } = req.body;

    // Revoke access token if provided
    if (accessToken) {
      revokeToken(accessToken);
    }

    // Revoke refresh token if provided
    if (refreshToken) {
      revokeRefreshToken(refreshToken);
    }

    // Get user info from Authorization header for logging
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const decoded = jwt.decode(token);
        if (decoded && decoded.email) {
          console.log(`User logged out: ${decoded.email}`);
        }
      } catch (error) {
        // Ignore decode errors during logout
      }
    }

    res.json({
      success: true,
      message: 'Logout successful',
      data: {
        loggedOut: true
      },
      metadata: {
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Logout error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Logout failed',
      code: 'LOGOUT_ERROR'
    });
  }
});

/**
 * POST /api/auth/logout-all
 * Logout user from all devices
 */
router.post('/logout-all', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access token required',
        code: 'TOKEN_REQUIRED'
      });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.decode(token);

    if (decoded && decoded.sub) {
      // Revoke all refresh tokens for this user
      revokeAllRefreshTokens(decoded.sub);

      // Revoke current access token
      revokeToken(token);

      console.log(`User logged out from all devices: ${decoded.sub}`);
    }

    res.json({
      success: true,
      message: 'Logged out from all devices successfully',
      data: {
        loggedOutFromAll: true
      },
      metadata: {
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Logout all error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Logout from all devices failed',
      code: 'LOGOUT_ALL_ERROR'
    });
  }
});

/**
 * GET /api/auth/me
 * Get current user information
 */
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access token required',
        code: 'TOKEN_REQUIRED'
      });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.decode(token);

    if (!decoded || !decoded.sub) {
      return res.status(401).json({
        success: false,
        message: 'Invalid access token',
        code: 'INVALID_TOKEN'
      });
    }

    const user = userStore.findById(decoded.sub);
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'User not found or account deactivated',
        code: 'USER_INVALID'
      });
    }

    res.json({
      success: true,
      message: 'User information retrieved successfully',
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          isActive: user.isActive,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        }
      },
      metadata: {
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Get user info error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve user information',
      code: 'USER_INFO_ERROR'
    });
  }
});

/**
 * POST /api/auth/change-password
 * Change user password
 */
router.post('/change-password', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access token required',
        code: 'TOKEN_REQUIRED'
      });
    }

    const { currentPassword, newPassword } = req.body;

    // Input validation
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required',
        code: 'MISSING_PASSWORDS'
      });
    }

    // Validate new password strength
    if (!validatePassword(newPassword)) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters long and contain uppercase, lowercase, and number',
        code: 'WEAK_PASSWORD'
      });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.decode(token);

    if (!decoded || !decoded.sub) {
      return res.status(401).json({
        success: false,
        message: 'Invalid access token',
        code: 'INVALID_TOKEN'
      });
    }

    // Get user for password verification
    const user = userStore.findByEmailForAuth(decoded.email);
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'User not found or account deactivated',
        code: 'USER_INVALID'
      });
    }

    // Verify current password
    const isCurrentPasswordValid = await user.verifyPassword(currentPassword);
    if (!isCurrentPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect',
        code: 'INVALID_CURRENT_PASSWORD'
      });
    }

    // Update password
    await user.updatePassword(newPassword);
    await userStore.update(user.id, { password: user.password });

    // Revoke all refresh tokens for security
    revokeAllRefreshTokens(user.id);

    console.log(`Password changed for user: ${user.email} (${user.id})`);

    res.json({
      success: true,
      message: 'Password changed successfully. Please login again.',
      data: {
        passwordChanged: true
      },
      metadata: {
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Change password error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Password change failed',
      code: 'CHANGE_PASSWORD_ERROR'
    });
  }
});

export default router;