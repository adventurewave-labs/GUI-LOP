# GUI-LOP Authentication System Documentation

## Overview

The GUI-LOP platform implements a comprehensive JWT-based authentication system with the following security features:

- **JWT Access Tokens**: 15-minute expiry with secure signing
- **Refresh Tokens**: 7-day expiry with rotation mechanism
- **Secure Password Hashing**: bcrypt with 12+ salt rounds
- **Rate Limiting**: Protection against brute force attacks
- **Token Blacklisting**: Secure logout functionality
- **Role-based Authorization**: User and admin roles
- **Input Validation**: Comprehensive sanitization and validation

## Security Features

### Password Security
- **Hashing Algorithm**: bcrypt with 12 salt rounds
- **Password Requirements**:
  - Minimum 8 characters
  - At least one uppercase letter
  - At least one lowercase letter
  - At least one number
  - Special characters optional but recommended

### Token Security
- **Access Tokens**: 15 minutes expiry, cannot be refreshed
- **Refresh Tokens**: 7 days expiry, supports rotation
- **Token Storage**: In-memory with periodic cleanup
- **Blacklisting**: Tokens are revoked on logout
- **Session Management**: User agent tracking for security

### Rate Limiting
- **Authentication Routes**: 5 attempts per 15 minutes
- **IP Locking**: Automatic lock after exceeded attempts
- **Token Refresh**: 10 attempts per 15 minutes

## API Endpoints

### Authentication Routes (`/api/auth/`)

#### POST `/api/auth/register`
Register a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123",
  "firstName": "John",
  "lastName": "Doe",
  "role": "user" // Optional: "user" or "admin"
}
```

**Response (201):**
```json
{
  "success": true,
  "message": "User registered successfully",
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "role": "user",
      "isActive": true,
      "createdAt": "2024-01-01T00:00:00.000Z"
    },
    "tokens": {
      "accessToken": "jwt-token",
      "refreshToken": "refresh-token",
      "tokenType": "Bearer",
      "expiresIn": 900
    }
  }
}
```

#### POST `/api/auth/login`
Authenticate user and receive tokens.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "role": "user",
      "lastLogin": "2024-01-01T00:00:00.000Z"
    },
    "tokens": {
      "accessToken": "jwt-token",
      "refreshToken": "refresh-token",
      "tokenType": "Bearer",
      "expiresIn": 900
    }
  }
}
```

#### POST `/api/auth/refresh`
Refresh access token using refresh token.

**Request Body:**
```json
{
  "refreshToken": "refresh-token"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Token refreshed successfully",
  "data": {
    "tokens": {
      "accessToken": "new-jwt-token",
      "refreshToken": "new-refresh-token",
      "tokenType": "Bearer",
      "expiresIn": 900
    }
  }
}
```

#### POST `/api/auth/logout`
Logout user and revoke tokens.

**Request Body:**
```json
{
  "accessToken": "jwt-token", // Optional
  "refreshToken": "refresh-token" // Optional
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Logout successful",
  "data": {
    "loggedOut": true
  }
}
```

#### POST `/api/auth/logout-all`
Logout user from all devices.

**Headers:**
```
Authorization: Bearer jwt-token
```

**Response (200):**
```json
{
  "success": true,
  "message": "Logged out from all devices successfully",
  "data": {
    "loggedOutFromAll": true
  }
}
```

#### GET `/api/auth/me`
Get current user information.

**Headers:**
```
Authorization: Bearer jwt-token
```

**Response (200):**
```json
{
  "success": true,
  "message": "User information retrieved successfully",
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "role": "user",
      "isActive": true,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

#### POST `/api/auth/change-password`
Change user password.

**Headers:**
```
Authorization: Bearer jwt-token
```

**Request Body:**
```json
{
  "currentPassword": "OldPass123",
  "newPassword": "NewPass123"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Password changed successfully. Please login again.",
  "data": {
    "passwordChanged": true
  }
}
```

## Protected API Routes

All workflow-related routes require authentication:

- `POST /api/workflows` - Create new workflow
- `GET /api/workflows` - Get user's workflows
- `GET /api/workflows/:workflowId` - Get workflow status
- `POST /api/workflows/:workflowId/execute` - Execute workflow
- `POST /api/workflows/:workflowId/respond` - Respond to workflow

## Usage Examples

### JavaScript/Node.js

```javascript
// User Registration
const registerResponse = await fetch('/api/auth/register', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'SecurePass123',
    firstName: 'John',
    lastName: 'Doe'
  })
});

const { data } = await registerResponse.json();
const { accessToken, refreshToken } = data.tokens;

// Store tokens securely (httpOnly cookies recommended)
localStorage.setItem('accessToken', accessToken);
localStorage.setItem('refreshToken', refreshToken);
```

```javascript
// Making Authenticated Requests
const createWorkflow = async (template, context) => {
  const token = localStorage.getItem('accessToken');

  const response = await fetch('/api/workflows', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ template, context })
  });

  if (response.status === 401) {
    // Token expired, try to refresh
    const newToken = await refreshAccessToken();
    if (newToken) {
      // Retry request with new token
      return createWorkflow(template, context);
    }
  }

  return response.json();
};
```

```javascript
// Token Refresh Function
const refreshAccessToken = async () => {
  const refreshToken = localStorage.getItem('refreshToken');

  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ refreshToken })
    });

    if (response.ok) {
      const { data } = await response.json();
      localStorage.setItem('accessToken', data.tokens.accessToken);
      localStorage.setItem('refreshToken', data.tokens.refreshToken);
      return data.tokens.accessToken;
    }
  } catch (error) {
    console.error('Token refresh failed:', error);
  }

  // Refresh failed, redirect to login
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  window.location.href = '/login';
  return null;
};
```

### React Hooks Example

```jsx
// useAuth.js
import { useState, useEffect, createContext, useContext } from 'react';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      fetchUser();
    } else {
      setLoading(false);
    }
  }, []);

  const fetchUser = async () => {
    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch('/api/auth/me', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const { data } = await response.json();
        setUser(data.user);
      } else {
        // Token invalid, clear storage
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
      }
    } catch (error) {
      console.error('Failed to fetch user:', error);
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    if (response.ok) {
      const { data } = await response.json();
      localStorage.setItem('accessToken', data.tokens.accessToken);
      localStorage.setItem('refreshToken', data.tokens.refreshToken);
      setUser(data.user);
      return data;
    } else {
      const error = await response.json();
      throw new Error(error.message);
    }
  };

  const logout = async () => {
    const accessToken = localStorage.getItem('accessToken');
    const refreshToken = localStorage.getItem('refreshToken');

    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ accessToken, refreshToken })
    });

    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    setUser(null);
  };

  const value = {
    user,
    loading,
    login,
    logout,
    fetchUser
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
```

```jsx
// ProtectedRoute.js
import { useAuth } from './useAuth';
import { Navigate } from 'react-router-dom';

export const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
};
```

## Error Handling

### Common Error Codes

- `TOKEN_REQUIRED` - Authorization header missing or malformed
- `TOKEN_EXPIRED` - Access token has expired
- `TOKEN_INVALID` - Token is malformed or invalid
- `TOKEN_REVOKED` - Token has been revoked (logout)
- `REFRESH_TOKEN_EXPIRED` - Refresh token has expired
- `REFRESH_TOKEN_INVALID` - Refresh token is invalid
- `INVALID_CREDENTIALS` - Email or password incorrect
- `EMAIL_EXISTS` - User with email already exists
- `WEAK_PASSWORD` - Password doesn't meet requirements
- `RATE_LIMIT_EXCEEDED` - Too many attempts, IP locked
- `ACCESS_DENIED` - Insufficient permissions

### Error Response Format

```json
{
  "success": false,
  "message": "Error description",
  "code": "ERROR_CODE",
  "field": "email", // Optional: for validation errors
  "retryAfter": 900 // Optional: for rate limiting
}
```

## Security Best Practices

### Frontend Implementation
1. **Store tokens securely**: Use httpOnly cookies or secure storage
2. **Handle token expiry**: Implement automatic refresh
3. **Clear tokens on logout**: Remove all stored tokens
4. **Validate responses**: Check for authentication errors
5. **Use HTTPS**: Always use secure connections

### Backend Configuration
1. **Environment variables**: Set strong JWT secrets
2. **Token rotation**: Enable refresh token rotation
3. **Rate limiting**: Configure appropriate limits
4. **CORS settings**: Restrict to allowed origins
5. **Logging**: Monitor authentication attempts

### Production Deployment
```bash
# Set secure JWT secrets
export JWT_SECRET="your-super-secure-jwt-secret-key-here"
export REFRESH_TOKEN_SECRET="your-super-secure-refresh-secret-key-here"

# Set CORS origin
export FRONTEND_URL="https://your-frontend-domain.com"

# Set environment
export NODE_ENV="production"
```

## Testing

Run the authentication test suite:

```bash
npm test -- auth.test.js
```

The test suite covers:
- User registration and validation
- Login and token generation
- Token refresh and rotation
- Protected route access
- Password change functionality
- Rate limiting enforcement
- Error handling

## Troubleshooting

### Common Issues

**Q: Access token expires too quickly**
A: Access tokens are set to 15 minutes for security. Use the refresh token mechanism to automatically obtain new tokens.

**Q: Can't access protected routes**
A: Ensure the Authorization header is correctly formatted: `Bearer <token>`

**Q: Getting "token revoked" error**
A: This happens when a token has been blacklisted. Login again to get new tokens.

**Q: Rate limiting issues**
A: The system limits failed attempts to prevent brute force attacks. Wait for the lock period to expire or use a different IP.

### Debug Mode

Enable debug logging by setting:
```bash
export NODE_ENV="development"
```

This will provide detailed error messages and stack traces for troubleshooting.

## Migration Guide

### From Simple Authentication

If migrating from a simpler authentication system:

1. **Update client code**: Use the new token-based flow
2. **Handle token refresh**: Implement automatic token refresh
3. **Update error handling**: Handle new error codes and response formats
4. **Secure token storage**: Use recommended storage methods
5. **Test thoroughly**: Verify all authentication flows work correctly

### Database Integration

For production use, replace the in-memory user store with a database:

1. **Install database driver**: `npm install pg` or `npm install mysql2`
2. **Create user table**: Follow the User model schema
3. **Replace UserStore**: Implement database persistence
4. **Add connection pooling**: Handle database connections efficiently
5. **Migrate existing users**: Import existing user accounts

This authentication system provides a secure, production-ready foundation for the GUI-LOP platform with comprehensive security features and robust error handling.