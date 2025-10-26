# Frontend Authentication System

## Overview

This document describes the comprehensive JWT-based authentication system implemented for the GUI-LOP frontend application.

## Features Implemented

### 🔐 Authentication System

- **JWT Token Management**: Secure handling of access and refresh tokens
- **Automatic Token Refresh**: Seamless background token renewal
- **Session Management**: Auto-logout on inactivity (30 minutes)
- **Token Storage**: Hybrid approach using localStorage (access) and httpOnly cookies (refresh)

### 🛡️ Security Features

- **Route Protection**: Authentication guards for protected pages
- **Token Validation**: Automatic token expiry checking
- **Secure WebSocket**: Authenticated WebSocket connections with automatic reconnection
- **Activity Tracking**: User activity monitoring for session security

### 🎨 User Interface

- **Login Form**: Modern form with validation and error handling
- **Registration Form**: Comprehensive signup with password strength indicator
- **Responsive Design**: Mobile-friendly authentication layouts
- **Error Handling**: User-friendly error messages and feedback

## Architecture

### Directory Structure

```
src/
├── components/auth/          # Authentication components
│   ├── LoginForm.jsx        # Login form component
│   ├── RegisterForm.jsx     # Registration form component
│   ├── ProtectedRoute.jsx   # Route protection wrapper
│   ├── AuthLayout.jsx       # Authentication layout wrapper
│   └── AuthPage.jsx         # Main authentication page
├── contexts/
│   └── AuthContext.jsx      # Authentication context and state management
├── services/
│   ├── api.js              # API client with interceptors
│   └── auth.js             # Authentication API endpoints
├── utils/
│   └── tokenStorage.js     # Token management utilities
└── tests/
    └── auth.test.js        # Authentication tests
```

### Core Components

#### AuthContext
- Centralized authentication state management
- User session handling
- Token refresh logic
- Auto-logout functionality

#### API Client
- Axios interceptors for automatic token injection
- Automatic token refresh on 401 errors
- Request/response error handling
- WebSocket authentication

#### Token Storage
- Hybrid token storage approach
- JWT validation and expiry checking
- Secure token management utilities

## Usage

### Authentication Context

```javascript
import { useAuth } from './contexts/AuthContext';

const { login, register, logout, user, isAuthenticated } = useAuth();

// Login
const result = await login({ email, password });

// Register
const result = await register({ username, email, password });

// Logout
await logout();
```

### Protected Routes

```javascript
import ProtectedRoute from './components/auth/ProtectedRoute';

<Route
  path="/dashboard"
  element={
    <ProtectedRoute>
      <Dashboard />
    </ProtectedRoute>
  }
/>
```

### API Calls

```javascript
import { api } from './services/api';

// Automatic token injection
const response = await api.get('/api/user/profile');

// Manual API call
const response = await authAPI.getCurrentUser();
```

## Token Management

### Storage Strategy
- **Access Token**: localStorage (15-30 minute expiry)
- **Refresh Token**: httpOnly cookie (7 day expiry)
- **User Data**: localStorage

### Refresh Logic
1. Automatic refresh 5 minutes before expiry
2. Background token validation every minute
3. Fallback to login on refresh failure
4. Automatic logout on authentication errors

### WebSocket Authentication
- Token passed as query parameter
- Automatic reconnection with exponential backoff
- Authentication error handling

## Security Considerations

### Token Storage
- Access tokens in localStorage for API access
- Refresh tokens in httpOnly cookies for security
- Automatic token cleanup on logout

### Session Management
- 30-minute auto-logout on inactivity
- Activity tracking via mouse/keyboard events
- Manual logout token invalidation

### Error Handling
- Graceful degradation on network errors
- User-friendly error messages
- Automatic retry for failed requests

## Testing

### Running Tests
```bash
npm test -- src/tests/auth.test.js
```

### Test Coverage
- Form validation
- Authentication flow
- Token management
- Route protection
- Error scenarios

## Configuration

### Environment Variables
```env
REACT_APP_API_URL=http://localhost:3001
NODE_ENV=production  # Enables secure cookie settings
```

### API Endpoints
The frontend expects the following authentication endpoints:
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration
- `POST /api/auth/logout` - User logout
- `POST /api/auth/refresh` - Token refresh
- `GET /api/auth/me` - Current user info

## Browser Compatibility

- Modern browsers with ES6+ support
- LocalStorage support required
- WebSocket support required
- Cookie support required

## Performance Considerations

- Token refresh operations are debounced
- WebSocket connections use exponential backoff
- Form validation is real-time but efficient
- Component re-renders are optimized with useCallback

## Troubleshooting

### Common Issues

1. **Token not persisting**: Check localStorage support and browser settings
2. **WebSocket not connecting**: Verify token format and server configuration
3. **Auto-refresh not working**: Check server clock synchronization
4. **Form validation errors**: Verify yup schema configuration

### Debug Mode
Enable debug logging by setting:
```javascript
localStorage.setItem('debug', 'auth:*');
```

## Future Enhancements

- Multi-factor authentication support
- Social login integration
- Biometric authentication
- Advanced session analytics
- Rate limiting integration
- Audit logging