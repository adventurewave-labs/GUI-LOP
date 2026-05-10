import {
  DomainError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  ValidationError,
  InvariantViolationError,
} from '../errors.js';

describe('Domain errors', () => {
  test.each([
    [NotFoundError, 'NOT_FOUND'],
    [ConflictError, 'CONFLICT'],
    [ForbiddenError, 'FORBIDDEN'],
    [ValidationError, 'VALIDATION'],
    [InvariantViolationError, 'INVARIANT_VIOLATION'],
  ])('%p extends DomainError with code %s', (Cls, code) => {
    const e = new Cls('msg', { foo: 1 });
    expect(e).toBeInstanceOf(DomainError);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe(code);
    expect(e.details).toEqual({ foo: 1 });
    expect(e.name).toBe(Cls.name);
    expect(e.message).toBe('msg');
  });

  test('default messages exist', () => {
    expect(new NotFoundError().message).toMatch(/not found/i);
    expect(new ConflictError().message).toMatch(/conflict/i);
    expect(new ForbiddenError().message).toMatch(/permitted/i);
    expect(new ValidationError().message).toMatch(/validation/i);
    expect(new InvariantViolationError().message).toMatch(/invariant/i);
  });

  test('default details is an empty object', () => {
    expect(new ConflictError('m').details).toEqual({});
  });

  test('DomainError can be constructed directly', () => {
    const e = new DomainError('CUSTOM', 'something', { x: 1 });
    expect(e.code).toBe('CUSTOM');
    expect(e.details).toEqual({ x: 1 });
  });
});
