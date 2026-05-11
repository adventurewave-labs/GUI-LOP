/**
 * Centralised v1 API client for the GUI-LOP SPA.
 *
 * - Talks exclusively to `/api/v1/*` routes (the legacy `/api/workflows/*`
 *   alias is no longer used by the frontend).
 * - Holds the access token in memory (XSS posture per ADR 0008: short access
 *   TTL is the mitigation; we accept localStorage for the refresh token in
 *   this SPA because there is no SSR/BFF to set an `httpOnly` cookie).
 * - On a 401 response, attempts a single `POST /api/v1/auth/refresh` using
 *   the persisted refresh token, retries the original request once, and on
 *   a second 401 redirects to `/login` (preserving the destination as a
 *   `next` query parameter).
 * - Auto-attaches an `Idempotency-Key` (uuid v4) to every mutating request
 *   that creates a workflow or submits a human response.
 * - Surfaces backend domain error envelopes
 *   (`{ success: false, message, code, details }`) as a typed
 *   `ApiError` so callers can branch on `code` / `status`.
 */

import { tokenStorage } from '../../utils/tokenStorage.js';

const API_BASE_URL =
  (typeof process !== 'undefined' && process.env && process.env.REACT_APP_API_URL) ||
  'http://localhost:3001';

/* -------------------- in-memory access token -------------------- */

let accessToken = null;
const accessTokenSubscribers = new Set();

/** Listener API used by the WebSocket client to grab the latest token. */
export const accessTokenStore = {
  set(token) {
    accessToken = token || null;
    if (token) {
      try {
        tokenStorage.setAccessToken(token);
      } catch {
        /* ignore storage errors, memory copy is authoritative */
      }
    }
    accessTokenSubscribers.forEach((fn) => {
      try {
        fn(accessToken);
      } catch {
        /* ignore */
      }
    });
  },
  get() {
    if (accessToken) return accessToken;
    // Hydrate from storage on first read so a page reload still finds the
    // token until the AuthContext re-syncs it.
    try {
      const persisted = tokenStorage.getAccessToken();
      if (persisted) accessToken = persisted;
    } catch {
      /* ignore */
    }
    return accessToken;
  },
  clear() {
    accessToken = null;
    try {
      tokenStorage.clearTokens();
    } catch {
      /* ignore */
    }
    accessTokenSubscribers.forEach((fn) => {
      try {
        fn(null);
      } catch {
        /* ignore */
      }
    });
  },
  subscribe(fn) {
    accessTokenSubscribers.add(fn);
    return () => accessTokenSubscribers.delete(fn);
  },
};

/* -------------------- typed error -------------------- */

export class ApiError extends Error {
  constructor({ status, code, message, details, body }) {
    super(message || 'API error');
    this.name = 'ApiError';
    this.status = status ?? 0;
    this.code = code ?? null;
    this.details = details ?? null;
    this.body = body ?? null;
  }

  /** Convenience predicates so callers can write `if (err.isAuthError) ...`. */
  get isAuthError() {
    return this.status === 401 || this.status === 403;
  }
  get isValidationError() {
    return this.status === 400 || this.status === 422;
  }
  get isNotFound() {
    return this.status === 404;
  }
  get isRateLimited() {
    return this.status === 429;
  }
}

/* -------------------- uuid v4 (no extra dependency) -------------------- */

function uuidV4() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC 4122 fallback using getRandomValues if available
  const buf = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < 16; i += 1) buf[i] = Math.floor(Math.random() * 256);
  }
  buf[6] = (buf[6] & 0x0f) | 0x40;
  buf[8] = (buf[8] & 0x3f) | 0x80;
  const hex = Array.from(buf, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

/* -------------------- request helper -------------------- */

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Routes that REQUIRE an Idempotency-Key (the backend rejects without it).
 * Other mutating routes get one too — it's harmless and helps de-dup retries.
 */
function needsIdempotencyKey(method, path) {
  if (!MUTATING_METHODS.has(method)) return false;
  // Always add for safety on creates/updates; required for these:
  //   POST /api/v1/workflows
  //   POST /api/v1/workflows/:id/execute
  //   POST /api/v1/workflows/:id/respond
  //   POST /api/v1/auth/register
  //   POST /api/v1/auth/password
  return true;
}

let inFlightRefresh = null;

async function performRefresh() {
  if (inFlightRefresh) return inFlightRefresh;
  const refreshToken = tokenStorage.getRefreshToken();
  if (!refreshToken) {
    return Promise.resolve({ ok: false });
  }
  inFlightRefresh = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) return { ok: false };
      let data = {};
      try {
        if (typeof response.json === 'function') {
          data = (await response.json()) ?? {};
        } else if (typeof response.text === 'function') {
          const txt = await response.text();
          data = txt ? JSON.parse(txt) : {};
        }
      } catch {
        data = {};
      }
      const newAccess = data.accessToken;
      const newRefresh = data.refreshToken;
      if (!newAccess) return { ok: false };
      accessTokenStore.set(newAccess);
      if (newRefresh) {
        tokenStorage.setTokens(newAccess, newRefresh);
      }
      return { ok: true, data };
    } catch {
      return { ok: false };
    } finally {
      inFlightRefresh = null;
    }
  })();
  return inFlightRefresh;
}

function redirectToLogin() {
  if (typeof window === 'undefined') return;
  const here = `${window.location.pathname}${window.location.search}`;
  if (window.location.pathname.startsWith('/login')) return;
  const next = encodeURIComponent(here);
  window.location.assign(`/login?next=${next}`);
}

/**
 * Core request function.
 *
 * @param {string} path   Path under the API base (e.g. `/api/v1/workflows`).
 * @param {object} [opts]
 * @param {string} [opts.method]  HTTP method, default `GET`.
 * @param {object} [opts.body]    JSON body (auto-stringified).
 * @param {object} [opts.query]   Query params (auto-encoded).
 * @param {object} [opts.headers] Extra headers.
 * @param {boolean} [opts.skipAuth]   Don't attach Authorization header.
 * @param {boolean} [opts.skipRefresh] Don't attempt token refresh on 401.
 * @param {string} [opts.idempotencyKey] Override the auto-generated key.
 * @returns {Promise<any>} Parsed JSON body on success.
 * @throws {ApiError} on non-2xx responses or network errors.
 */
export async function request(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const url = new URL(`${API_BASE_URL}${path}`);
  if (opts.query) {
    Object.entries(opts.query).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    });
  }

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(opts.headers || {}),
  };

  if (!opts.skipAuth) {
    const token = accessTokenStore.get();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  if (needsIdempotencyKey(method, path) && !headers['Idempotency-Key']) {
    headers['Idempotency-Key'] = opts.idempotencyKey || uuidV4();
  }

  const init = {
    method,
    headers,
    credentials: 'include',
  };
  if (opts.body !== undefined && opts.body !== null) {
    init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }

  let response;
  try {
    response = await fetch(url.toString(), init);
  } catch (err) {
    throw new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: err && err.message ? err.message : 'Network error',
    });
  }

  // 401 → try single refresh + retry
  if (response.status === 401 && !opts.skipRefresh && !opts.skipAuth) {
    const refresh = await performRefresh();
    if (refresh.ok) {
      const retryHeaders = {
        ...headers,
        Authorization: `Bearer ${accessTokenStore.get()}`,
      };
      const retry = await fetch(url.toString(), { ...init, headers: retryHeaders }).catch(
        () => null,
      );
      if (retry && retry.status !== 401) {
        return finaliseResponse(retry);
      }
      // second 401 → fall through to redirect
    }
    accessTokenStore.clear();
    redirectToLogin();
    throw new ApiError({
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Session expired',
    });
  }

  return finaliseResponse(response);
}

async function finaliseResponse(response) {
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (response.ok) return body ?? {};

  // Domain error envelope: { success:false, message, code, details } OR
  // { error: { code, message, details } } depending on context.
  let code = null;
  let message = null;
  let details = null;
  if (body && typeof body === 'object') {
    if (body.error && typeof body.error === 'object') {
      code = body.error.code ?? null;
      message = body.error.message ?? null;
      details = body.error.details ?? null;
    } else {
      code = body.code ?? body.error ?? null;
      message = body.message ?? null;
      details = body.details ?? null;
    }
  }
  throw new ApiError({
    status: response.status,
    code,
    message: message || `HTTP ${response.status}`,
    details,
    body,
  });
}

export const apiBaseUrl = API_BASE_URL;
export { uuidV4 };
