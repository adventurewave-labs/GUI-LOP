/**
 * @jest-environment jsdom
 */
/**
 * One token refresh, however many callers (roadmap #16).
 *
 * Before: three independent refresh paths (the 401 handler, authApi.refresh()
 * used by AuthContext's expiry timer, and nothing at all for the WebSocket's
 * 4001) could each spend the refresh token. With rotating refresh tokens the
 * losers get 401 and log the user out.
 */
import { request, accessTokenStore, refreshAccessToken } from '../client.js';
import { authApi } from '../auth.js';
import { tokenStorage } from '../../../utils/tokenStorage.js';
import { createWebSocketClient, CLOSE_TOKEN_EXPIRED } from '../../websocket/client.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

/** fetch mock: /auth/refresh resolves only when released; other calls 401 until refreshed. */
function installFetch() {
  const calls = { refresh: 0, api: [] };
  let release;
  const refreshGate = new Promise((r) => { release = r; });
  global.fetch = jest.fn(async (url, init) => {
    if (String(url).endsWith('/api/v1/auth/refresh')) {
      calls.refresh += 1;
      await refreshGate;
      return {
        ok: true,
        status: 200,
        json: async () => ({ accessToken: 'access-2', refreshToken: 'refresh-2' }),
      };
    }
    const auth = init?.headers?.Authorization;
    calls.api.push(auth);
    const ok = auth === 'Bearer access-2';
    return { ok, status: ok ? 200 : 401, text: async () => (ok ? '{"ok":true}' : '') };
  });
  return { calls, release };
}

describe('single-flight token refresh', () => {
  let originalFetch;
  let originalLocation;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalLocation = window.location;
    delete window.location;
    window.location = { pathname: '/workflows', search: '', assign: jest.fn() };
    accessTokenStore.set('access-1');
    jest.spyOn(tokenStorage, 'getRefreshToken').mockReturnValue('refresh-1');
    jest.spyOn(tokenStorage, 'setTokens').mockImplementation(() => {});
    jest.spyOn(tokenStorage, 'setAccessToken').mockImplementation(() => {});
    jest.spyOn(tokenStorage, 'clearTokens').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.location = originalLocation;
    jest.restoreAllMocks();
  });

  test('five concurrent 401s trigger exactly one refresh, then all retry with the new token', async () => {
    const { calls, release } = installFetch();
    const pending = Array.from({ length: 5 }, (_, i) => request(`/api/v1/workflows/${i}`));
    await flush();
    release();
    const results = await Promise.all(pending);
    expect(calls.refresh).toBe(1);
    expect(results).toEqual(Array(5).fill({ ok: true }));
    expect(calls.api.filter((a) => a === 'Bearer access-2')).toHaveLength(5);
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  test('authApi.refresh() (AuthContext timer) shares the in-flight refresh with a 401 retry', async () => {
    const { calls, release } = installFetch();
    const viaRequest = request('/api/v1/workflows');
    await flush();
    const viaAuthApi = authApi.refresh();
    const viaExport = refreshAccessToken();
    release();
    await Promise.all([viaRequest, viaAuthApi, viaExport]);
    expect(calls.refresh).toBe(1);
    expect(accessTokenStore.get()).toBe('access-2');
    expect(tokenStorage.setTokens).toHaveBeenCalledWith('access-2', 'refresh-2');
  });

  test('authApi.refresh() rejects when the refresh fails', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    await expect(authApi.refresh()).rejects.toThrow('Token refresh failed');
    tokenStorage.getRefreshToken.mockReturnValue(undefined);
    await expect(authApi.refresh()).rejects.toThrow('No refresh token available');
  });

  test('WebSocket 4001 uses the shared refresh by default and reconnects with the new token', async () => {
    const { calls, release } = installFetch();
    const sockets = [];
    class FakeWS {
      constructor(url, protocols) { this.url = url; this.protocols = protocols; sockets.push(this); }
      close(code) { this.onclose?.({ code }); }
    }
    const scheduler = jest.fn();
    createWebSocketClient({ WebSocketImpl: FakeWS, baseUrl: 'http://x', scheduler, autoConnect: true });
    expect(sockets[0].protocols).toEqual(['bearer', 'access-1']);
    sockets[0].close(CLOSE_TOKEN_EXPIRED);
    await flush();
    release();
    await flush();
    await flush();
    expect(calls.refresh).toBe(1);
    expect(sockets).toHaveLength(2);
    expect(sockets[1].protocols).toEqual(['bearer', 'access-2']);
    expect(scheduler).not.toHaveBeenCalled();
  });

  test('WebSocket 4001 with a failed refresh backs off instead of reconnect-spinning', async () => {
    const sockets = [];
    class FakeWS {
      constructor(url, protocols) { this.protocols = protocols; sockets.push(this); }
      close(code) { this.onclose?.({ code }); }
    }
    for (const onTokenExpired of [async () => ({ ok: false }), async () => { throw new Error('x'); }]) {
      sockets.length = 0;
      const scheduler = jest.fn();
      createWebSocketClient({ WebSocketImpl: FakeWS, baseUrl: 'http://x', getToken: () => 't', onTokenExpired, scheduler, autoConnect: true });
      sockets[0].close(CLOSE_TOKEN_EXPIRED);
      await flush();
      await flush();
      expect(sockets).toHaveLength(1); // no immediate reconnect
      expect(scheduler).toHaveBeenCalledTimes(1); // normal backoff instead
    }
  });
});
