import { IdempotencyKey } from '../idempotency-key.js';
import { ValidationError } from '../../errors.js';

describe('IdempotencyKey', () => {
  test('accepts a UUID v4', () => {
    const v = '11111111-1111-4111-8111-111111111111';
    expect(new IdempotencyKey(v).toString()).toBe(v);
  });

  test('accepts a UUID v1', () => {
    const v = '11111111-1111-1111-8111-111111111111';
    expect(IdempotencyKey.from(v).toString()).toBe(v);
  });

  test('accepts a 16-char alphanumeric string', () => {
    const v = 'abc123ABC4567890';
    expect(new IdempotencyKey(v).toString()).toBe(v);
  });

  test('accepts a 64-char alphanumeric string', () => {
    const v = 'a'.repeat(64);
    expect(new IdempotencyKey(v).toString()).toBe(v);
  });

  test('rejects too-short alphanumeric', () => {
    expect(() => new IdempotencyKey('short123')).toThrow(ValidationError);
  });

  test('rejects too-long alphanumeric', () => {
    expect(() => new IdempotencyKey('a'.repeat(65))).toThrow(ValidationError);
  });

  test('rejects non-alphanumeric characters', () => {
    expect(() => new IdempotencyKey('has-some-dashes-here-too-many')).toThrow(ValidationError);
  });

  test('rejects non-strings', () => {
    expect(() => new IdempotencyKey(123)).toThrow(ValidationError);
  });

  test('toJSON yields the string', () => {
    const v = 'abc123ABC4567890';
    expect(JSON.stringify({ k: new IdempotencyKey(v) })).toBe(`{"k":"${v}"}`);
  });

  test('equals is value-based', () => {
    const v = 'abc123ABC4567890';
    expect(new IdempotencyKey(v).equals(new IdempotencyKey(v))).toBe(true);
    expect(new IdempotencyKey(v).equals('abc')).toBe(false);
  });
});
