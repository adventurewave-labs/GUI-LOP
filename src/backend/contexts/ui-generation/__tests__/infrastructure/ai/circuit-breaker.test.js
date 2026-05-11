/**
 * circuit-breaker.test.js — unit tests for the three-state breaker.
 */
import { CircuitBreaker, STATES } from '../../../infrastructure/ai/circuit-breaker.js';
import { AIInvalidRequest, AIProviderUnavailable } from '../../../infrastructure/ai/domain-errors.js';

function freezeClock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (n) => { t += n; } };
}

describe('CircuitBreaker', () => {
  test('starts CLOSED and lets calls through', async () => {
    const cb = new CircuitBreaker();
    expect(cb.state).toBe(STATES.CLOSED);
    const out = await cb.execute(async () => 'ok');
    expect(out).toBe('ok');
  });

  test('opens after N consecutive provider faults', async () => {
    const clock = freezeClock();
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, now: clock.now });
    for (let i = 0; i < 3; i += 1) {
      await expect(cb.execute(async () => { throw new AIProviderUnavailable('x'); }))
        .rejects.toThrow();
    }
    expect(cb.state).toBe(STATES.OPEN);
  });

  test('non-provider faults do NOT trip the breaker', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2 });
    await expect(cb.execute(async () => { throw new AIInvalidRequest('bad'); })).rejects.toThrow();
    await expect(cb.execute(async () => { throw new AIInvalidRequest('bad'); })).rejects.toThrow();
    expect(cb.state).toBe(STATES.CLOSED);
  });

  test('fails fast while OPEN', async () => {
    const clock = freezeClock();
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: clock.now });
    await expect(cb.execute(async () => { throw new AIProviderUnavailable('x'); })).rejects.toThrow();
    expect(cb.state).toBe(STATES.OPEN);
    const fn = jest.fn();
    await expect(cb.execute(fn)).rejects.toThrow(/Circuit breaker is open/);
    expect(fn).not.toHaveBeenCalled();
  });

  test('moves to HALF_OPEN after cooldown and CLOSES on success', async () => {
    const clock = freezeClock();
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 100, now: clock.now });
    await expect(cb.execute(async () => { throw new AIProviderUnavailable('x'); })).rejects.toThrow();
    expect(cb.state).toBe(STATES.OPEN);
    clock.advance(101);
    expect(cb.state).toBe(STATES.HALF_OPEN);
    const out = await cb.execute(async () => 'ok');
    expect(out).toBe('ok');
    expect(cb.state).toBe(STATES.CLOSED);
  });

  test('re-opens on failure in HALF_OPEN', async () => {
    const clock = freezeClock();
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 100, now: clock.now });
    await expect(cb.execute(async () => { throw new AIProviderUnavailable('x'); })).rejects.toThrow();
    clock.advance(150);
    expect(cb.state).toBe(STATES.HALF_OPEN);
    await expect(cb.execute(async () => { throw new AIProviderUnavailable('y'); })).rejects.toThrow();
    expect(cb.state).toBe(STATES.OPEN);
  });

  test('reset() forces back to CLOSED', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    await expect(cb.execute(async () => { throw new AIProviderUnavailable('x'); })).rejects.toThrow();
    expect(cb.state).toBe(STATES.OPEN);
    cb.reset();
    expect(cb.state).toBe(STATES.CLOSED);
  });
});
