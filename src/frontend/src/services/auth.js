import { api } from './api';

// Authentication API endpoints
export const authAPI = {
  // Login user
  login: async (credentials) => {
    return api.post('/api/auth/login', credentials);
  },

  // Register new user
  register: async (userData) => {
    return api.post('/api/auth/register', userData);
  },

  // Logout user
  logout: async () => {
    return api.post('/api/auth/logout');
  },

  // Refresh access token
  refreshToken: async () => {
    return api.post('/api/auth/refresh');
  },

  // Get current user
  getCurrentUser: async () => {
    return api.get('/api/auth/me');
  },

  // Update user profile
  updateProfile: async (userData) => {
    return api.put('/api/auth/profile', userData);
  },

  // Change password
  changePassword: async (passwordData) => {
    return api.put('/api/auth/password', passwordData);
  },

  // Request password reset
  requestPasswordReset: async (email) => {
    return api.post('/api/auth/forgot-password', { email });
  },

  // Reset password with token
  resetPassword: async (token, newPassword) => {
    return api.post('/api/auth/reset-password', { token, newPassword });
  },

  // Verify email
  verifyEmail: async (token) => {
    return api.post('/api/auth/verify-email', { token });
  },

  // Resend verification email
  resendVerification: async (email) => {
    return api.post('/api/auth/resend-verification', { email });
  },
};