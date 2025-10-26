import Cookies from 'js-cookie';

// Token storage configuration
const TOKEN_CONFIG = {
  accessTokenKey: 'accessToken',
  refreshTokenKey: 'refreshToken',
  userKey: 'user',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    httpOnly: false, // We need to access this in JavaScript
    expires: 7, // 7 days
  },
};

export const tokenStorage = {
  // Set both access and refresh tokens
  setTokens: (accessToken, refreshToken) => {
    try {
      // Store access token in localStorage (short-lived)
      localStorage.setItem(TOKEN_CONFIG.accessTokenKey, accessToken);

      // Store refresh token in httpOnly cookie (long-lived)
      Cookies.set(TOKEN_CONFIG.refreshTokenKey, refreshToken, TOKEN_CONFIG.cookieOptions);

      return true;
    } catch (error) {
      console.error('Error storing tokens:', error);
      return false;
    }
  },

  // Set access token only
  setAccessToken: (accessToken) => {
    try {
      localStorage.setItem(TOKEN_CONFIG.accessTokenKey, accessToken);
      return true;
    } catch (error) {
      console.error('Error storing access token:', error);
      return false;
    }
  },

  // Get access token from localStorage
  getAccessToken: () => {
    try {
      return localStorage.getItem(TOKEN_CONFIG.accessTokenKey);
    } catch (error) {
      console.error('Error getting access token:', error);
      return null;
    }
  },

  // Get refresh token from cookies
  getRefreshToken: () => {
    try {
      return Cookies.get(TOKEN_CONFIG.refreshTokenKey);
    } catch (error) {
      console.error('Error getting refresh token:', error);
      return null;
    }
  },

  // Get both tokens
  getTokens: () => {
    return {
      accessToken: tokenStorage.getAccessToken(),
      refreshToken: tokenStorage.getRefreshToken(),
    };
  },

  // Clear all tokens
  clearTokens: () => {
    try {
      localStorage.removeItem(TOKEN_CONFIG.accessTokenKey);
      Cookies.remove(TOKEN_CONFIG.refreshTokenKey);
      return true;
    } catch (error) {
      console.error('Error clearing tokens:', error);
      return false;
    }
  },

  // Check if access token exists and is valid
  isAccessTokenValid: () => {
    try {
      const token = tokenStorage.getAccessToken();
      if (!token) return false;

      // Decode JWT token to check expiry
      const payload = JSON.parse(atob(token.split('.')[1]));
      const now = Date.now() / 1000; // Convert to seconds

      return payload.exp > now;
    } catch (error) {
      console.error('Error validating access token:', error);
      return false;
    }
  },

  // Get token expiry time
  getTokenExpiry: () => {
    try {
      const token = tokenStorage.getAccessToken();
      if (!token) return null;

      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp * 1000; // Convert to milliseconds
    } catch (error) {
      console.error('Error getting token expiry:', error);
      return null;
    }
  },

  // Check if token is expiring soon (within 5 minutes)
  isTokenExpiringSoon: (minutes = 5) => {
    try {
      const expiry = tokenStorage.getTokenExpiry();
      if (!expiry) return true;

      const now = Date.now();
      const timeUntilExpiry = expiry - now;
      const fiveMinutes = minutes * 60 * 1000;

      return timeUntilExpiry < fiveMinutes;
    } catch (error) {
      console.error('Error checking token expiry:', error);
      return true;
    }
  },

  // Store user data
  setUser: (user) => {
    try {
      localStorage.setItem(TOKEN_CONFIG.userKey, JSON.stringify(user));
      return true;
    } catch (error) {
      console.error('Error storing user data:', error);
      return false;
    }
  },

  // Get user data
  getUser: () => {
    try {
      const userData = localStorage.getItem(TOKEN_CONFIG.userKey);
      return userData ? JSON.parse(userData) : null;
    } catch (error) {
      console.error('Error getting user data:', error);
      return null;
    }
  },

  // Clear user data
  clearUser: () => {
    try {
      localStorage.removeItem(TOKEN_CONFIG.userKey);
      return true;
    } catch (error) {
      console.error('Error clearing user data:', error);
      return false;
    }
  },

  // Clear all authentication data
  clearAll: () => {
    tokenStorage.clearTokens();
    tokenStorage.clearUser();
  },
};

export default tokenStorage;