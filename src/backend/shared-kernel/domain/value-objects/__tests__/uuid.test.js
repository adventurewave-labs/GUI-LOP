import { Uuid } from '../uuid.js';
import { ValidationError } from '../../errors.js';

describe('Uuid', () => {
  const valid = '11111111-1111-4111-8111-111111111111';

  test('Uuid.from accepts valid v4', () => {
    const u = Uuid.from(valid);
    expect(u.toString()).toBe(valid);
    expect(u.toJSON()).toBe(valid);
  });

  test('Uuid.from lowercases input', () => {
    const u = Uuid.from(valid.toUpperCase());
    expect(u.toString()).toBe(valid);
  });

  test('Uuid.from rejects non-strings', () => {
    expect(() => Uuid.from(123)).toThrow(ValidationError);
  });

  test('Uuid.from rejects malformed strings', () => {
    expect(() => Uuid.from('not-a-uuid')).toThrow(ValidationError);
  });

  test('Uuid.from rejects non-v4 versions', () => {
    // version digit is the third group's first char; using 1 here
    expect(() => Uuid.from('11111111-1111-1111-8111-111111111111')).toThrow(ValidationError);
  });

  test('Uuid.generate uses injected idGen', () => {
    const idGen = { newId: () => valid };
    const u = Uuid.generate(idGen);
    expect(u.equals(Uuid.from(valid))).toBe(true);
  });

  test('Uuid.generate rejects bad idGen', () => {
    expect(() => Uuid.generate(null)).toThrow(ValidationError);
    expect(() => Uuid.generate({})).toThrow(ValidationError);
  });

  test('equals is value-based', () => {
    expect(Uuid.from(valid).equals(Uuid.from(valid))).toBe(true);
    expect(Uuid.from(valid).equals('not a uuid')).toBe(false);
  });

  test('Uuid is frozen', () => {
    expect(Object.isFrozen(Uuid.from(valid))).toBe(true);
  });
});
