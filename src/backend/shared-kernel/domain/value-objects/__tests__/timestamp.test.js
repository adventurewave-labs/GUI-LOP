import { Timestamp } from '../timestamp.js';
import { ValidationError } from '../../errors.js';

describe('Timestamp', () => {
  test('from parses a valid ISO string', () => {
    const t = Timestamp.from('2026-05-10T12:00:00.000Z');
    expect(t.toISOString()).toBe('2026-05-10T12:00:00.000Z');
    expect(t.toJSON()).toBe('2026-05-10T12:00:00.000Z');
    expect(t.toEpochMs()).toBe(Date.parse('2026-05-10T12:00:00.000Z'));
  });

  test('from rejects non-strings', () => {
    expect(() => Timestamp.from(0)).toThrow(ValidationError);
  });

  test('from rejects garbage strings', () => {
    expect(() => Timestamp.from('not a date')).toThrow(ValidationError);
  });

  test('now uses injected clock', () => {
    const fixed = new Date('2026-01-01T00:00:00.000Z');
    const clock = { now: () => fixed };
    const t = Timestamp.now(clock);
    expect(t.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  test('now rejects bad clock', () => {
    expect(() => Timestamp.now(null)).toThrow(ValidationError);
    expect(() => Timestamp.now({ now: () => 'nope' })).toThrow(ValidationError);
  });

  test('comparison ops', () => {
    const a = Timestamp.from('2026-01-01T00:00:00.000Z');
    const b = Timestamp.from('2026-01-02T00:00:00.000Z');
    expect(a.isBefore(b)).toBe(true);
    expect(b.isAfter(a)).toBe(true);
    expect(a.compareTo(a)).toBe(0);
    expect(a.equals(Timestamp.from('2026-01-01T00:00:00.000Z'))).toBe(true);
  });

  test('compareTo rejects non-Timestamp', () => {
    expect(() => Timestamp.from('2026-01-01T00:00:00.000Z').compareTo('x')).toThrow(
      ValidationError,
    );
  });

  test('Timestamp is frozen', () => {
    expect(Object.isFrozen(Timestamp.from('2026-01-01T00:00:00.000Z'))).toBe(true);
  });
});
