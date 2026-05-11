/**
 * Identity & Access HTTP wrappers — `/api/v1/auth/*`.
 *
 * Notes:
 *   - login/refresh/register are PUBLIC (no Authorization header), so we
 *     pass `skipAuth: true` and `skipRefresh: true` to avoid a refresh loop
 *     when the access token is missing/expired.
 *   - Successful login/register/refresh persist the new tokens via the
 *     accessTokenStore + tokenStorage so other modules see them.
 */

import { request, accessTokenStore } from './client.js';
import { tokenStorage } from '../../utils/tokenStorage.js';

function persistFromAuthResponse(data) {
  if (!data) return;
  if (data.accessToken) accessTokenStore.set(data.accessToken);
  if (data.accessToken && data.refreshToken) {
    tokenStorage.setTokens(data.accessToken, data.refreshToken);
  } else if (data.accessToken) {
    tokenStorage.setAccessToken(data.accessToken);
  }
}

export const authApi = {
  /** POST /api/v1/auth/register — public. */
  async register({ username, email, password }) {
    const data = await request('/api/v1/auth/register', {
      method: 'POST',
      body: { username, email, password },
      skipAuth: true,
      skipRefresh: true,
    });
    persistFromAuthResponse(data);
    return data;
  },

  /** POST /api/v1/auth/login — public. */
  async login({ identifier, email, username, password }) {
    const data = await request('/api/v1/auth/login', {
      method: 'POST',
      body: {
        identifier: identifier ?? email ?? username,
        password,
      },
      skipAuth: true,
      skipRefresh: true,
    });
    persistFromAuthResponse(data);
    return data;
  },

  /** POST /api/v1/auth/refresh — public; takes refreshToken from storage. */
  async refresh() {
    const refreshToken = tokenStorage.getRefreshToken();
    if (!refreshToken) throw new Error('No refresh token available');
    const data = await request('/api/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
      skipAuth: true,
      skipRefresh: true,
    });
    persistFromAuthResponse(data);
    return data;
  },

  /** POST /api/v1/auth/logout — requires bearer. */
  async logout() {
    try {
      await request('/api/v1/auth/logout', { method: 'POST' });
    } finally {
      accessTokenStore.clear();
    }
  },

  /** GET /api/v1/auth/me — requires bearer. */
  async me() {
    return request('/api/v1/auth/me');
  },

  /** POST /api/v1/auth/password — requires bearer. */
  async changePassword({ oldPassword, newPassword }) {
    return request('/api/v1/auth/password', {
      method: 'POST',
      body: { oldPassword, newPassword },
    });
  },
};

export default authApi;
