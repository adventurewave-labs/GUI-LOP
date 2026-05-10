/**
 * Unit tests for the v1 API client. Focuses on the auth-refresh-on-401
 * flow, idempotency-key emission, and ApiError mapping. We use a custom
 * `fetch` mock rather than `msw` so the test runs without a network stack.
 */

import { request, ApiError, accessTokenStore } from '../client.js';
import { tokenStorage } from '../../../utils/tokenStorage.js';

function makeResponse({ status = 200, body = '' } = {}) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

function jsonResponse(status, body) {
  return makeResponse({ status, body: JSON.stringify(body) });
}

describe('api client', () => {
  let originalFetch;
  let originalLocation;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalLocation = window.location;
    // Replace location so we can intercept `assign()`.
    delete window.location;
    window.location = {
      pathname: '/workflows',
      search: '',
      assign: jest.fn(),
    };
    accessTokenStore.set('access-1');
    jest.spyOn(tokenStorage, 'getRefreshToken').mockReturnValue('refresh-1');
    jest.spyOn(tokenStorage, 'setTokens').mockImplementation(() => {});
    jest.spyOn(tokenStorage, 'setAccessToken').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.location = originalLocation;
    accessTokenStore.clear();
    jest.restoreAllMocks();
  });

  test('sends bearer + Idempotency-Key on POST mutations', async () => {
    const fetchMock = jest.fn(() => jsonResponse(201, { ok: true }));
    global.fetch = fetchMock;

    await request('/api/v1/workflows', { method: 'POST', body: { template: 't' } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer access-1');
    expect(init.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/i);
  });

  test('does not send Idempotency-Key on GET', async () => {
    const fetchMock = jest.fn(() => jsonResponse(200, { ok: true }));
    global.fetch = fetchMock;

    await request('/api/v1/workflows/templates');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['Idempotency-Key']).toBeUndefined();
  });

  test('on 401 attempts a single refresh + retry', async () => {
    const fetchMock = jest
      .fn()
      // 1st call: original GET → 401
      .mockImplementationOnce(() => jsonResponse(401, { error: { code: 'UNAUTHORIZED' } }))
      // 2nd call: refresh → 200 with new tokens
      .mockImplementationOnce(() =>
        jsonResponse(200, { accessToken: 'access-2', refreshToken: 'refresh-2' }),
      )
      // 3rd call: retry of the original GET → 200
      .mockImplementationOnce(() => jsonResponse(200, { ok: true, retried: true }));
    global.fetch = fetchMock;

    const result = await request('/api/v1/workflows/templates');
    expect(result).toEqual({ ok: true, retried: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Refresh request payload includes refreshToken from storage
    const refreshCall = fetchMock.mock.calls[1];
    expect(refreshCall[0]).toMatch(/\/api\/v1\/auth\/refresh$/);
    expect(JSON.parse(refreshCall[1].body)).toEqual({ refreshToken: 'refresh-1' });

    // Retry uses the new bearer
    const retryInit = fetchMock.mock.calls[2][1];
    expect(retryInit.headers.Authorization).toBe('Bearer access-2');

    // Token store has the new access token
    expect(accessTokenStore.get()).toBe('access-2');
  });

  test('on second 401 redirects to /login?next=...', async () => {
    const fetchMock = jest
      .fn()
      .mockImplementationOnce(() => jsonResponse(401, {})) // original
      .mockImplementationOnce(() =>
        jsonResponse(200, { accessToken: 'access-2', refreshToken: 'refresh-2' }),
      ) // refresh
      .mockImplementationOnce(() => jsonResponse(401, {})); // retry still 401
    global.fetch = fetchMock;

    await expect(request('/api/v1/workflows/templates')).rejects.toBeInstanceOf(ApiError);
    expect(window.location.assign).toHaveBeenCalledTimes(1);
    const [target] = window.location.assign.mock.calls[0];
    expect(target).toMatch(/^\/login\?next=/);
    expect(decodeURIComponent(target.split('next=')[1])).toBe('/workflows');
  });

  test('on 401 with failed refresh redirects to /login', async () => {
    const fetchMock = jest
      .fn()
      .mockImplementationOnce(() => jsonResponse(401, {})) // original
      .mockImplementationOnce(() => jsonResponse(401, {})); // refresh fails
    global.fetch = fetchMock;

    await expect(request('/api/v1/workflows/templates')).rejects.toBeInstanceOf(ApiError);
    expect(window.location.assign).toHaveBeenCalled();
    expect(accessTokenStore.get()).toBeNull();
  });

  test('maps domain error envelope to ApiError', async () => {
    const fetchMock = jest.fn(() =>
      jsonResponse(422, {
        success: false,
        code: 'VALIDATION_FAILED',
        message: 'Bad input',
        details: { field: 'email' },
      }),
    );
    global.fetch = fetchMock;

    await expect(request('/api/v1/auth/login', { method: 'POST', body: {}, skipAuth: true, skipRefresh: true })).rejects
      .toMatchObject({
        name: 'ApiError',
        status: 422,
        code: 'VALIDATION_FAILED',
        message: 'Bad input',
        details: { field: 'email' },
      });
  });

  test('network error becomes ApiError with NETWORK_ERROR code', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('boom')));
    await expect(
      request('/api/v1/workflows/templates', { skipRefresh: true }),
    ).rejects.toMatchObject({ name: 'ApiError', code: 'NETWORK_ERROR', status: 0 });
  });

  test('skipAuth omits the Authorization header', async () => {
    const fetchMock = jest.fn(() => jsonResponse(200, {}));
    global.fetch = fetchMock;
    await request('/api/v1/auth/login', { method: 'POST', body: {}, skipAuth: true, skipRefresh: true });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
  });
});
