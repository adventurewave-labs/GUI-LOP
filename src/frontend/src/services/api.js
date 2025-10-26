import axios from 'axios';
import { authAPI } from './auth';
import { tokenStorage } from '../utils/tokenStorage';

// API base configuration
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

// Create axios instance
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // Important for httpOnly cookies
});

// Request interceptor to add access token
apiClient.interceptors.request.use(
  (config) => {
    const token = tokenStorage.getAccessToken();

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Add request timestamp for debugging
    config.metadata = { startTime: new Date() };

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle token refresh
apiClient.interceptors.response.use(
  (response) => {
    // Calculate request duration for debugging
    const duration = new Date() - response.config.metadata.startTime;
    response.config.metadata.duration = duration;

    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // If error is 401 (Unauthorized) and we haven't already tried to refresh
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        // Attempt to refresh the token
        const response = await authAPI.refreshToken();

        if (response.success) {
          const { accessToken } = response.data;
          tokenStorage.setAccessToken(accessToken);

          // Retry the original request with new token
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
          return apiClient(originalRequest);
        } else {
          // Refresh failed, clear tokens and redirect to login
          tokenStorage.clearTokens();
          window.location.href = '/login';
          return Promise.reject(error);
        }
      } catch (refreshError) {
        // Refresh failed completely
        tokenStorage.clearTokens();
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    // Handle other HTTP errors
    if (error.response?.status >= 500) {
      console.error('Server error:', error.response.data);
      // You could implement a global error notification here
    }

    return Promise.reject(error);
  }
);

// API response formatter
export const formatAPIResponse = (response) => ({
  success: true,
  data: response.data,
  status: response.status,
  headers: response.headers,
});

// API error formatter
export const formatAPIError = (error) => {
  if (error.response) {
    // Server responded with error status
    return {
      success: false,
      error: error.response.data.error || error.response.data.message || 'Server error',
      status: error.response.status,
      data: error.response.data,
    };
  } else if (error.request) {
    // Request was made but no response received
    return {
      success: false,
      error: 'Network error. Please check your connection.',
      status: null,
      data: null,
    };
  } else {
    // Something else happened in setting up the request
    return {
      success: false,
      error: error.message || 'An unexpected error occurred',
      status: null,
      data: null,
    };
  }
};

// Generic API request wrapper
export const apiRequest = async (config) => {
  try {
    const response = await apiClient(config);
    return formatAPIResponse(response);
  } catch (error) {
    return formatAPIError(error);
  }
};

// HTTP method helpers
export const api = {
  get: (url, config = {}) => apiRequest({ method: 'GET', url, ...config }),
  post: (url, data = {}, config = {}) => apiRequest({ method: 'POST', url, data, ...config }),
  put: (url, data = {}, config = {}) => apiRequest({ method: 'PUT', url, data, ...config }),
  patch: (url, data = {}, config = {}) => apiRequest({ method: 'PATCH', url, data, ...config }),
  delete: (url, config = {}) => apiRequest({ method: 'DELETE', url, ...config }),
};

// WebSocket factory with authentication
export const createAuthenticatedWebSocket = (url, options = {}) => {
  const token = tokenStorage.getAccessToken();

  if (!token) {
    throw new Error('No access token available for WebSocket connection');
  }

  // Create WebSocket URL with token as query parameter
  const wsUrl = new URL(url);
  wsUrl.searchParams.append('token', token);

  const ws = new WebSocket(wsUrl.toString());

  // Add authentication to WebSocket options
  const wsOptions = {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  };

  return ws;
};

// Export default api client for direct usage
export default apiClient;