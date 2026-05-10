/**
 * RetryPolicy — pure exponential backoff with a maximum attempt count.
 *
 * After `maxAttempts` attempts, returns a DeadLetter sentinel.
 */

export const DeadLetter = Object.freeze({ kind: 'DeadLetter' });

export function next(attemptCount, opts = {}) {
  const baseMs = opts.baseMs ?? 1_000;
  const factor = opts.factor ?? 2;
  const maxMs = opts.maxMs ?? 60_000;
  const maxAttempts = opts.maxAttempts ?? 5;

  if (attemptCount >= maxAttempts) {
    return DeadLetter;
  }

  const exp = Math.min(maxMs, Math.round(baseMs * Math.pow(factor, attemptCount)));
  return { delayMs: exp };
}
