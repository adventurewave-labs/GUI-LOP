import { SystemClock, systemClock } from '../system-clock.js';

describe('SystemClock', () => {
  test('now() returns a Date close to wall clock', () => {
    const clk = new SystemClock();
    const before = Date.now();
    const d = clk.now();
    const after = Date.now();
    expect(d).toBeInstanceOf(Date);
    expect(d.getTime()).toBeGreaterThanOrEqual(before);
    expect(d.getTime()).toBeLessThanOrEqual(after + 5);
  });

  test('singleton works the same', () => {
    expect(systemClock.now()).toBeInstanceOf(Date);
  });
});
