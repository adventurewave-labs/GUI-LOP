/**
 * retry.test.js — unit tests for the AI ACL retry helper.
 */
import { withRetry, backoffDelay } from '../../../infrastructure/ai/retry.js';
import { AIInvalidRequest, AIProviderUnavailable, AIQuotaExceeded } from '../../../infrastructure/ai/domain-errors.js';

describe('backoffDelay', () => {
  test('respects base and max delay', () => {
    // With rng=1 we expect floor(base * 2^attempt) capped at maxDelayMs.
    expect(backoffDelay({ attempt: 0, baseDelayMs: 100, maxDelayMs: 1000, rng: () => 1 - Number.EPSILON })).toBeLessThanOrEqual(100);
    expect(backoffDelay({ attempt: 3, baseDelayMs: 100, maxDelayMs: 500, rng: () => 1 - Number.EPSILON })).toBeLessThanOrEqual(500);
    expect(backoffDelay({ attempt: 1, baseDelayMs: 100, maxDelayMs: 10000, rng: () => 0 })).toBe(0);
  });
});

describe('withRetry', () => {
  test('returns on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const out = await withRetry(fn, { maxRetries: 2 });
    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries on retryable error and eventually succeeds', async () => {
    const sleep = jest.fn().mockResolvedValue();
    let calls = 0;
    const fn = jest.fn(async () => {
      calls += 1;
      if (calls < 3) throw new AIProviderUnavailable('boom');
      return 'ok';
    });
    const out = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10, sleep, rng: () => 0.5 });
    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  test('does NOT retry non-retryable errors', async () => {
    const fn = jest.fn(async () => { throw new AIInvalidRequest('nope'); });
    await expect(withRetry(fn, { maxRetries: 5 })).rejects.toThrow('nope');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries on quota error', async () => {
    let calls = 0;
    const fn = jest.fn(async () => {
      calls += 1;
      if (calls === 1) throw new AIQuotaExceeded('hold up');
      return 'ok';
    });
    const out = await withRetry(fn, { maxRetries: 1, baseDelayMs: 1, sleep: () => Promise.resolve() });
    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('exhausts attempts and rethrows the last error', async () => {
    const fn = jest.fn(async () => { throw new AIProviderUnavailable('still down'); });
    await expect(withRetry(fn, { maxRetries: 2, baseDelayMs: 1, sleep: () => Promise.resolve() }))
      .rejects.toThrow('still down');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  test('passes AbortSignal that fires on timeout', async () => {
    let signalSeen = null;
    const fn = jest.fn((signal) => new Promise((_, reject) => {
      signalSeen = signal;
      signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }));
    await expect(withRetry(fn, { maxRetries: 0, timeoutMs: 20, sleep: () => Promise.resolve() }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(signalSeen).toBeInstanceOf(AbortSignal);
  });

  test('retries on AbortError when retries remain', async () => {
    let calls = 0;
    const fn = jest.fn(async () => {
      calls += 1;
      if (calls === 1) {
        const e = new Error('timeout');
        e.name = 'AbortError';
        throw e;
      }
      return 'ok';
    });
    const out = await withRetry(fn, { maxRetries: 2, baseDelayMs: 1, sleep: () => Promise.resolve() });
    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
