/**
 * Result<T, E> — explicit success/failure container used across the domain.
 * Avoids exceptions for expected failure paths (validation, not-found, conflict).
 */
export class Result {
  /** @private */
  constructor(ok, value, error) {
    this._ok = ok;
    this._value = value;
    this._error = error;
    Object.freeze(this);
  }

  /** Construct a successful Result wrapping `value`. */
  static ok(value) {
    return new Result(true, value, undefined);
  }

  /** Construct a failed Result wrapping `error`. */
  static err(error) {
    return new Result(false, undefined, error);
  }

  /** True when the Result is a success. */
  isOk() {
    return this._ok === true;
  }

  /** True when the Result is a failure. */
  isErr() {
    return this._ok === false;
  }

  /**
   * Map the success value through `fn`. Failures pass through untouched.
   * @param {(v:any)=>any} fn
   * @returns {Result}
   */
  map(fn) {
    if (!this._ok) return this;
    return Result.ok(fn(this._value));
  }

  /**
   * Chain another Result-producing computation. Failures short-circuit.
   * @param {(v:any)=>Result} fn
   * @returns {Result}
   */
  flatMap(fn) {
    if (!this._ok) return this;
    const next = fn(this._value);
    if (!(next instanceof Result)) {
      throw new TypeError('Result.flatMap: callback must return a Result');
    }
    return next;
  }

  /** Unwrap the success value or throw if this is a failure. */
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

  /** Unwrap the error or throw if this is a success. */
  unwrapErr() {
    if (this._ok) {
      throw new Error('Result.unwrapErr called on Ok');
    }
    return this._error;
  }
}
