import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import { authAPI } from '../services/api';
import { tokenStorage } from '../utils/tokenStorage';

// Authentication state shape
const initialState = {
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
  loginAttempt: 0,
  lastActivity: null,
};

// Action types
const AUTH_ACTIONS = {
  LOGIN_START: 'LOGIN_START',
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILURE: 'LOGIN_FAILURE',
  LOGOUT: 'LOGOUT',
  REGISTER_START: 'REGISTER_START',
  REGISTER_SUCCESS: 'REGISTER_SUCCESS',
  REGISTER_FAILURE: 'REGISTER_FAILURE',
  REFRESH_SUCCESS: 'REFRESH_SUCCESS',
  REFRESH_FAILURE: 'REFRESH_FAILURE',
  CLEAR_ERROR: 'CLEAR_ERROR',
  SET_LOADING: 'SET_LOADING',
  UPDATE_ACTIVITY: 'UPDATE_ACTIVITY',
};

// Reducer function
const authReducer = (state, action) => {
  switch (action.type) {
    case AUTH_ACTIONS.LOGIN_START:
    case AUTH_ACTIONS.REGISTER_START:
      return {
        ...state,
        isLoading: true,
        error: null,
        loginAttempt: state.loginAttempt + 1,
      };

    case AUTH_ACTIONS.LOGIN_SUCCESS:
    case AUTH_ACTIONS.REGISTER_SUCCESS:
      return {
        ...state,
        user: action.payload.user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
        lastActivity: Date.now(),
      };

    case AUTH_ACTIONS.LOGIN_FAILURE:
    case AUTH_ACTIONS.REGISTER_FAILURE:
      return {
        ...state,
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: action.payload,
      };

    case AUTH_ACTIONS.LOGOUT:
      return {
        ...state,
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
        lastActivity: null,
      };

    case AUTH_ACTIONS.REFRESH_SUCCESS:
      return {
        ...state,
        user: action.payload.user || state.user,
        isAuthenticated: true,
        error: null,
        lastActivity: Date.now(),
      };

    case AUTH_ACTIONS.REFRESH_FAILURE:
      return {
        ...state,
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: 'Session expired. Please login again.',
      };

    case AUTH_ACTIONS.CLEAR_ERROR:
      return {
        ...state,
        error: null,
      };

    case AUTH_ACTIONS.SET_LOADING:
      return {
        ...state,
        isLoading: action.payload,
      };

    case AUTH_ACTIONS.UPDATE_ACTIVITY:
      return {
        ...state,
        lastActivity: Date.now(),
      };

    default:
      return state;
  }
};

// Create context
const AuthContext = createContext();

// AuthProvider component
export const AuthProvider = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, initialState);

  // Initialize authentication on mount
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const tokens = tokenStorage.getTokens();

        if (tokens.accessToken) {
          // Validate access token by fetching current user
          const response = await authAPI.getCurrentUser();

          if (response.success) {
            dispatch({
              type: AUTH_ACTIONS.LOGIN_SUCCESS,
              payload: { user: response.data },
            });
          } else {
            // Access token invalid, try refresh
            await refreshAccessToken();
          }
        } else {
          dispatch({ type: AUTH_ACTIONS.SET_LOADING, payload: false });
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
        await tokenStorage.clearTokens();
        dispatch({ type: AUTH_ACTIONS.SET_LOADING, payload: false });
      }
    };

    initializeAuth();
  }, []);

  // Auto-refresh token before expiry
  useEffect(() => {
    if (!state.isAuthenticated) return;

    const checkTokenExpiry = async () => {
      const tokens = tokenStorage.getTokens();
      if (tokens.accessToken) {
        try {
          const tokenData = JSON.parse(atob(tokens.accessToken.split('.')[1]));
          const expiresAt = tokenData.exp * 1000;
          const now = Date.now();
          const timeUntilExpiry = expiresAt - now;

          // Refresh 5 minutes before expiry
          if (timeUntilExpiry < 5 * 60 * 1000) {
            await refreshAccessToken();
          }
        } catch (error) {
          console.error('Token validation error:', error);
        }
      }
    };

    const interval = setInterval(checkTokenExpiry, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [state.isAuthenticated]);

  // Auto-logout on inactivity (30 minutes)
  useEffect(() => {
    if (!state.isAuthenticated || !state.lastActivity) return;

    const checkInactivity = () => {
      const now = Date.now();
      const inactiveTime = now - state.lastActivity;
      const thirtyMinutes = 30 * 60 * 1000;

      if (inactiveTime > thirtyMinutes) {
        logout();
      }
    };

    const interval = setInterval(checkInactivity, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [state.isAuthenticated, state.lastActivity]);

  // Refresh access token
  const refreshAccessToken = useCallback(async () => {
    try {
      const response = await authAPI.refreshToken();

      if (response.success) {
        tokenStorage.setAccessToken(response.data.accessToken);
        dispatch({
          type: AUTH_ACTIONS.REFRESH_SUCCESS,
          payload: { user: response.data.user },
        });
        return true;
      } else {
        throw new Error(response.message || 'Token refresh failed');
      }
    } catch (error) {
      console.error('Token refresh error:', error);
      await tokenStorage.clearTokens();
      dispatch({ type: AUTH_ACTIONS.REFRESH_FAILURE });
      return false;
    }
  }, []);

  // Login function
  const login = useCallback(async (credentials) => {
    try {
      dispatch({ type: AUTH_ACTIONS.LOGIN_START });

      const response = await authAPI.login(credentials);

      if (response.success) {
        const { accessToken, refreshToken, user } = response.data;

        // Store tokens
        tokenStorage.setTokens(accessToken, refreshToken);

        dispatch({
          type: AUTH_ACTIONS.LOGIN_SUCCESS,
          payload: { user },
        });

        return { success: true, user };
      } else {
        throw new Error(response.message || 'Login failed');
      }
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || 'Login failed';
      dispatch({
        type: AUTH_ACTIONS.LOGIN_FAILURE,
        payload: errorMessage,
      });
      return { success: false, error: errorMessage };
    }
  }, []);

  // Register function
  const register = useCallback(async (userData) => {
    try {
      dispatch({ type: AUTH_ACTIONS.REGISTER_START });

      const response = await authAPI.register(userData);

      if (response.success) {
        const { accessToken, refreshToken, user } = response.data;

        // Store tokens
        tokenStorage.setTokens(accessToken, refreshToken);

        dispatch({
          type: AUTH_ACTIONS.REGISTER_SUCCESS,
          payload: { user },
        });

        return { success: true, user };
      } else {
        throw new Error(response.message || 'Registration failed');
      }
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || 'Registration failed';
      dispatch({
        type: AUTH_ACTIONS.REGISTER_FAILURE,
        payload: errorMessage,
      });
      return { success: false, error: errorMessage };
    }
  }, []);

  // Logout function
  const logout = useCallback(async () => {
    try {
      // Call logout API to invalidate refresh token
      await authAPI.logout();
    } catch (error) {
      console.error('Logout API error:', error);
    } finally {
      // Clear tokens regardless of API call success
      tokenStorage.clearTokens();
      dispatch({ type: AUTH_ACTIONS.LOGOUT });
    }
  }, []);

  // Update user activity
  const updateActivity = useCallback(() => {
    dispatch({ type: AUTH_ACTIONS.UPDATE_ACTIVITY });
  }, []);

  // Clear error
  const clearError = useCallback(() => {
    dispatch({ type: AUTH_ACTIONS.CLEAR_ERROR });
  }, []);

  // Context value
  const value = {
    // State
    ...state,

    // Actions
    login,
    register,
    logout,
    refreshAccessToken,
    updateActivity,
    clearError,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

// Custom hook to use auth context
export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
};

// Higher-order component for protected routes
export const withAuth = (Component) => {
  return (props) => {
    const { isAuthenticated, isLoading } = useAuth();

    if (isLoading) {
      return <div>Loading...</div>;
    }

    if (!isAuthenticated) {
      return <div>Please login to continue.</div>;
    }

    return <Component {...props} />;
  };
};

export default AuthContext;