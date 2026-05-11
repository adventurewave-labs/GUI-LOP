import { Result } from '../result.js';

describe('Result', () => {
  test('Result.ok wraps a value', () => {
    const r = Result.ok(42);
    expect(r.isOk()).toBe(true);
    expect(r.isErr()).toBe(false);
    expect(r.unwrap()).toBe(42);
  });

  test('Result.err wraps an error', () => {
    const r = Result.err('boom');
    expect(r.isErr()).toBe(true);
    expect(r.isOk()).toBe(false);
    expect(r.unwrapErr()).toBe('boom');
  });

  test('map transforms success values', () => {
    const r = Result.ok(2).map((n) => n * 3);
    expect(r.unwrap()).toBe(6);
  });

  test('map is a no-op on errors', () => {
    const r = Result.err('e').map((n) => n * 3);
    expect(r.isErr()).toBe(true);
    expect(r.unwrapErr()).toBe('e');
  });

  test('flatMap chains Results', () => {
    const r = Result.ok(2).flatMap((n) => Result.ok(n + 1));
    expect(r.unwrap()).toBe(3);
  });

  test('flatMap short-circuits on Err', () => {
    const r = Result.err('e').flatMap(() => Result.ok(1));
    expect(r.unwrapErr()).toBe('e');
  });

  test('flatMap rejects non-Result returns', () => {
    expect(() => Result.ok(1).flatMap(() => 5)).toThrow(TypeError);
  });

  test('unwrap on Err re-throws Error instances', () => {
    const err = new Error('nope');
    expect(() => Result.err(err).unwrap()).toThrow('nope');
  });

  test('unwrap on Err wraps non-Error in Error', () => {
    expect(() => Result.err({ a: 1 }).unwrap()).toThrow(/Result.unwrap called on Err/);
  });

  test('unwrapErr on Ok throws', () => {
    expect(() => Result.ok(1).unwrapErr()).toThrow('Result.unwrapErr called on Ok');
  });

  test('Results are frozen', () => {
    const r = Result.ok(1);
    expect(Object.isFrozen(r)).toBe(true);
  });
});
