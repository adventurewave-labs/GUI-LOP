/**
 * JWT Utilities - Secure Token Management
 * Handles JWT access tokens, refresh tokens, and token blacklisting
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// Configuration
const JWT_CONFIG = {
  // Access token expires in 15 minutes
  ACCESS_TOKEN_EXPIRY: '15m',
  // Refresh token expires in 7 days
  REFRESH_TOKEN_EXPIRY: '7d',
  // Use strong signing secret from environment
  JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex'),
  REFRESH_SECRET: process.env.REFRESH_TOKEN_SECRET || crypto.randomBytes(64).toString('hex'),
  // Issuer identifier
  ISSUER: 'gui-lop-platform',
  // Audience identifier
  AUDIENCE: 'gui-lop-users'
};

// In-memory token blacklist (in production, use Redis or database)
const tokenBlacklist = new Set();
const refreshTokens = new Map(); // userId -> tokenData

/**
 * Generate JWT access token
 */
export function generateAccessToken(user) {
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    type: 'access'
  };

  return jwt.sign(payload, JWT_CONFIG.JWT_SECRET, {
    expiresIn: JWT_CONFIG.ACCESS_TOKEN_EXPIRY,
    issuer: JWT_CONFIG.ISSUER,
    audience: JWT_CONFIG.AUDIENCE,
    jwtid: crypto.randomUUID()
  });
}

/**
 * Generate JWT refresh token
 */
export function generateRefreshToken(user) {
  const payload = {
    sub: user.id,
    email: user.email,
    type: 'refresh',
    // Add session identifier for enhanced security
    sessionId: crypto.randomUUID()
  };

  const token = jwt.sign(payload, JWT_CONFIG.REFRESH_SECRET, {
    expiresIn: JWT_CONFIG.REFRESH_TOKEN_EXPIRY,
    issuer: JWT_CONFIG.ISSUER,
    audience: JWT_CONFIG.AUDIENCE,
    jwtid: crypto.randomUUID()
  });

  // Store refresh token with metadata
  refreshTokens.set(user.id, {
    token,
    sessionId: payload.sessionId,
    createdAt: new Date().toISOString(),
    lastUsed: new Date().toISOString(),
    userAgent: null // Will be set when token is used
  });

  return token;
}

/**
 * Verify JWT access token
 */
export function verifyAccessToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_CONFIG.JWT_SECRET, {
      issuer: JWT_CONFIG.ISSUER,
      audience: JWT_CONFIG.AUDIENCE
    });

    // Check if token is blacklisted
    if (tokenBlacklist.has(decoded.jti)) {
      throw new Error('Token has been revoked');
    }

    // Verify token type
    if (decoded.type !== 'access') {
      throw new Error('Invalid token type');
    }

    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Access token expired');
    } else if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid access token');
    } else {
      throw error;
    }
  }
}

/**
 * Verify JWT refresh token
 */
export function verifyRefreshToken(token, userAgent = null) {
  try {
    const decoded = jwt.verify(token, JWT_CONFIG.REFRESH_SECRET, {
      issuer: JWT_CONFIG.ISSUER,
      audience: JWT_CONFIG.AUDIENCE
    });

    // Verify token type
    if (decoded.type !== 'refresh') {
      throw new Error('Invalid token type');
    }

    // Check if refresh token exists in our store
    const storedToken = refreshTokens.get(decoded.sub);
    if (!storedToken || storedToken.token !== token) {
      throw new Error('Refresh token not found or invalid');
    }

    // Check session ID matches
    if (storedToken.sessionId !== decoded.sessionId) {
      throw new Error('Session mismatch - possible token theft');
    }

    // Update last used timestamp and user agent
    if (storedToken) {
      storedToken.lastUsed = new Date().toISOString();
      if (userAgent) {
        storedToken.userAgent = userAgent;
      }
    }

    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Refresh token expired');
    } else if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid refresh token');
    } else {
      throw error;
    }
  }
}

/**
 * Revoke token (add to blacklist)
 */
export function revokeToken(token) {
  try {
    const decoded = jwt.decode(token);
    if (decoded && decoded.jti) {
      tokenBlacklist.add(decoded.jti);
    }
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Revoke all refresh tokens for a user
 */
export function revokeAllRefreshTokens(userId) {
  refreshTokens.delete(userId);
}

/**
 * Revoke specific refresh token
 */
export function revokeRefreshToken(token) {
  try {
    const decoded = jwt.decode(token);
    if (decoded && decoded.sub) {
      refreshTokens.delete(decoded.sub);
    }
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Rotate refresh token (generate new one, revoke old)
 */
export function rotateRefreshToken(oldToken, user, userAgent = null) {
  try {
    const decoded = jwt.decode(oldToken);
    if (decoded && decoded.jti) {
      // Add old token to blacklist
      tokenBlacklist.add(decoded.jti);
    }

    // Generate new refresh token
    const newToken = generateRefreshToken(user);

    return newToken;
  } catch (error) {
    throw new Error('Failed to rotate refresh token');
  }
}

/**
 * Clean up expired tokens (run periodically)
 */
export function cleanupExpiredTokens() {
  // Clean up expired access tokens from blacklist
  for (const jti of tokenBlacklist) {
    try {
      const decoded = jwt.decode(jti, { complete: true });
      if (decoded && decoded.payload.exp) {
        const expirationTime = decoded.payload.exp * 1000; // Convert to milliseconds
        if (Date.now() > expirationTime) {
          tokenBlacklist.delete(jti);
        }
      }
    } catch (error) {
      // Remove invalid tokens
      tokenBlacklist.delete(jti);
    }
  }

  // Clean up expired refresh tokens
  for (const [userId, tokenData] of refreshTokens.entries()) {
    try {
      const decoded = jwt.decode(tokenData.token, { complete: true });
      if (decoded && decoded.payload.exp) {
        const expirationTime = decoded.payload.exp * 1000;
        if (Date.now() > expirationTime) {
          refreshTokens.delete(userId);
        }
      }
    } catch (error) {
      // Remove invalid tokens
      refreshTokens.delete(userId);
    }
  }
}

/**
 * Get token blacklist info (for monitoring)
 */
export function getBlacklistInfo() {
  return {
    blacklistedTokens: tokenBlacklist.size,
    activeRefreshTokens: refreshTokens.size
  };
}

/**
 * Check if token is blacklisted
 */
export function isTokenBlacklisted(jti) {
  return tokenBlacklist.has(jti);
}

/**
 * Decode token without verification (for debugging)
 */
export function decodeToken(token) {
  try {
    return jwt.decode(token, { complete: true });
  } catch (error) {
    return null;
  }
}

// Set up periodic cleanup (run every hour)
setInterval(cleanupExpiredTokens, 60 * 60 * 1000);

export default {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  revokeToken,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  rotateRefreshToken,
  cleanupExpiredTokens,
  getBlacklistInfo,
  isTokenBlacklisted,
  decodeToken
};