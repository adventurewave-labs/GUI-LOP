/**
 * Result<T, E> — minimal Either-style return type used across contexts.
 * Replace with the full Phase-0 implementation once available.
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

  static fail(error) {
    return new Result(false, undefined, error);
  }

  get isOk() {
    return this._ok === true;
  }

  get isFail() {
    return this._ok === false;
  }

  get value() {
    if (!this._ok) {
      throw new Error('Cannot read .value on a failed Result');
    }
    return this._value;
  }

  get error() {
    if (this._ok) {
      throw new Error('Cannot read .error on an ok Result');
    }
    return this._error;
  }

  map(fn) {
    return this._ok ? Result.ok(fn(this._value)) : this;
  }

  mapError(fn) {
    return this._ok ? this : Result.fail(fn(this._error));
  }

  unwrapOr(fallback) {
    return this._ok ? this._value : fallback;
  }
}

export const ok = (v) => Result.ok(v);
export const fail = (e) => Result.fail(e);
