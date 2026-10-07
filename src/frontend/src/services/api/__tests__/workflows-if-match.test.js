/**
 * @jest-environment jsdom
 */
/**
 * The SPA sends If-Match on execute/cancel and surfaces 412 as a typed,
 * recoverable error (roadmap P9).
 */
import { workflowsApi, versionEtag } from '../workflows.js';
import { ApiError, accessTokenStore } from '../client.js';

const respond = (status, body) => Promise.resolve({
  ok: status >= 200 && status < 300,
  status,
  text: () => Promise.resolve(JSON.stringify(body)),
});

describe('workflows API — optimistic concurrency', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = global.fetch; accessTokenStore.set('access-1'); });
  afterEach(() => { global.fetch = originalFetch; accessTokenStore.clear(); });

  test('versionEtag matches the backend format', () => {
    expect(versionEtag(0)).toBe('"v0"');
    expect(versionEtag(12)).toBe('"v12"');
  });

  test.each([
    ['execute', (v) => workflowsApi.execute('wf-1', { expectedVersion: v }), '/api/v1/workflows/wf-1/execute'],
    ['cancel', (v) => workflowsApi.cancel('wf-1', { reason: 'r', expectedVersion: v }), '/api/v1/workflows/wf-1/cancel'],
  ])('%s sends If-Match for the loaded version, and still sends an Idempotency-Key', async (_n, call, path) => {
    global.fetch = jest.fn(() => respond(200, { success: true, data: { status: 'cancelled' } }));
    await call(7);
    const [url, init] = global.fetch.mock.calls[0];
    expect(String(url)).toContain(path);
    expect(init.method).toBe('POST');
    expect(init.headers['If-Match']).toBe('"v7"');
    expect(init.headers['Idempotency-Key']).toEqual(expect.any(String));
  });

  test.each([undefined, null, '7', 1.5])('no If-Match when the version is %p (unconditional, as before)', async (v) => {
    global.fetch = jest.fn(() => respond(200, { success: true, data: {} }));
    await workflowsApi.execute('wf-1', { expectedVersion: v });
    await workflowsApi.cancel('wf-1', { expectedVersion: v });
    for (const [, init] of global.fetch.mock.calls) expect(init.headers['If-Match']).toBeUndefined();
  });

  test('412 → ApiError.isPreconditionFailed with the server\'s current version', async () => {
    global.fetch = jest.fn(() => respond(412, {
      type: 'https://gui-lop.dev/problems/precondition-failed', title: 'Precondition Failed', status: 412,
      code: 'PRECONDITION_FAILED', message: 'Workflow was modified', current_version: 9,
    }));
    const err = await workflowsApi.execute('wf-1', { expectedVersion: 7 }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.isPreconditionFailed).toBe(true);
    expect(err.currentVersion).toBe(9);
    expect(err.code).toBe('PRECONDITION_FAILED');
  });

  test('other errors are not precondition failures', async () => {
    global.fetch = jest.fn(() => respond(409, { code: 'CONFLICT', message: 'x' }));
    const err = await workflowsApi.cancel('wf-1', { expectedVersion: 7 }).catch((e) => e);
    expect(err.isPreconditionFailed).toBe(false);
    expect(err.currentVersion).toBeNull();
  });
});
