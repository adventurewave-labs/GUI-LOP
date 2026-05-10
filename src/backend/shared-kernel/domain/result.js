/**
 * Result<T, E> — explicit success/failure container used across the domain.
 * Stub of Phase 0 shared kernel; matches the canonical signature.
 */
export class Result {
  constructor(ok, value, error) {
    this._ok = ok;
    this._value = value;
    this._error = error;
    Object.freeze(this);
  }

  static ok(value) {
    return new Result(true, value, undefined);
  }

  static err(error) {
    return new Result(false, undefined, error);
  }

  isOk() {
    return this._ok === true;
  }

  isErr() {
    return this._ok === false;
  }

  map(fn) {
    if (!this._ok) return this;
    return Result.ok(fn(this._value));
  }

  flatMap(fn) {
    if (!this._ok) return this;
    const next = fn(this._value);
    if (!(next instanceof Result)) {
      throw new TypeError('Result.flatMap: callback must return a Result');
    }
    return next;
  }

  unwrap() {
    if (!this._ok) {
      const err = this._error;
      if (err instanceof Error) throw err;
      throw new Error(
        `Result.unwrap called on Err: ${typeof err === 'string' ? err : JSON.stringify(err)}`,
      );
    }
    return this._value;
  }

  unwrapErr() {
    if (this._ok) {
      throw new Error('Result.unwrapErr called on Ok');
    }
    return this._error;
  }

  get value() {
    return this._value;
  }

  get error() {
    return this._error;
  }
}
