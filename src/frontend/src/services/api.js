/**
 * Backwards-compatibility shim.
 *
 * The real implementation now lives under `./api/` (per-context modules).
 * This file keeps the historical `apiClient` / `api` / `authAPI` /
 * `tokenStorage` / `createAuthenticatedWebSocket` exports working so any
 * remaining call-sites compile and tests that mock `'../services/api'`
 * still find the symbols they expect — but the implementations now talk to
 * `/api/v1/*` and the new versioned WebSocket envelope.
 *
 * New code should import from `./api/index.js` (or the per-context
 * modules) and `./websocket/client.js` directly.
 */

import { request, accessTokenStore, ApiError, apiBaseUrl } from './api/client.js';
import { authApi } from './api/auth.js';
import { workflowsApi } from './api/workflows.js';
import { inboxApi } from './api/inbox.js';
import { tokenStorage as _tokenStorage } from '../utils/tokenStorage.js';

export { ApiError, accessTokenStore, apiBaseUrl };
export const tokenStorage = _tokenStorage;

/* -------------------- legacy `api` / `apiClient` surface -------------------- */

function legacyEnvelope(promise) {
  return promise
    .then((data) => ({ success: true, data, status: 200, headers: {} }))
    .catch((err) => {
      if (err instanceof ApiError) {
        return {
          success: false,
          error: err.message,
          status: err.status,
          message: err.message,
          code: err.code,
          data: err.body,
        };
      }
      return {
        success: false,
        error: err && err.message ? err.message : 'Network error',
        status: null,
        data: null,
      };
    });
}

export const api = {
  get: (url, config = {}) =>
    legacyEnvelope(request(url, { method: 'GET', query: config.params })),
  post: (url, data = {}, config = {}) =>
    legacyEnvelope(request(url, { method: 'POST', body: data, headers: config.headers })),
  put: (url, data = {}, config = {}) =>
    legacyEnvelope(request(url, { method: 'PUT', body: data, headers: config.headers })),
  patch: (url, data = {}, config = {}) =>
    legacyEnvelope(request(url, { method: 'PATCH', body: data, headers: config.headers })),
  delete: (url, config = {}) =>
    legacyEnvelope(request(url, { method: 'DELETE', headers: config.headers })),
};

export const apiClient = api;
export default api;

/* -------------------- legacy `authAPI` surface -------------------- */

export const authAPI = {
  login: (credentials) => legacyEnvelope(authApi.login(credentials)),
  register: (userData) => legacyEnvelope(authApi.register(userData)),
  logout: () => legacyEnvelope(authApi.logout()),
  refreshToken: () => legacyEnvelope(authApi.refresh()),
  getCurrentUser: () => legacyEnvelope(authApi.me()),
  changePassword: (data) => legacyEnvelope(authApi.changePassword(data)),
};

/* -------------------- legacy WebSocket factory -------------------- */

export const createAuthenticatedWebSocket = (urlOrPath = '/ws/v1') => {
  const token = accessTokenStore.get();
  if (!token) throw new Error('No access token available for WebSocket connection');

  let urlString;
  if (urlOrPath.startsWith('ws://') || urlOrPath.startsWith('wss://')) {
    urlString = urlOrPath;
  } else if (urlOrPath.startsWith('http://')) {
    urlString = `ws://${urlOrPath.slice('http://'.length)}`;
  } else if (urlOrPath.startsWith('https://')) {
    urlString = `wss://${urlOrPath.slice('https://'.length)}`;
  } else {
    const base = apiBaseUrl
      .replace(/^https/, 'wss')
      .replace(/^http/, 'ws')
      .replace(/\/$/, '');
    urlString = `${base}${urlOrPath.startsWith('/') ? '' : '/'}${urlOrPath}`;
  }

  const url = new URL(urlString);
  url.searchParams.set('token', token);
  return new WebSocket(url.toString());
};

/* -------------------- formatters kept for older imports -------------------- */

export const formatAPIResponse = (response) => ({
  success: true,
  data: response.data,
  status: response.status,
  headers: response.headers,
});

export const formatAPIError = (error) => ({
  success: false,
  error: error?.message ?? 'An unexpected error occurred',
  status: error?.status ?? null,
  data: error?.body ?? null,
});
