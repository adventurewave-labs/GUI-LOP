/**
 * Result<T, E> — explicit success/failure container used across the domain.
 * Avoids exceptions for expected failure paths (validation, not-found, conflict).
 *
 * Two API styles are supported because contexts grew up in parallel:
 *   - method form: `r.isOk()`, `r.isErr()`, `r.unwrap()`, `r.unwrapErr()`
 *   - property form (legacy): `r.isOk`, `r.isFail`, `r.value`, `r.error`
 *
 * Both forms are intentional and tested. New code should prefer the method
 * form, but the property form is kept so the bounded-context migration
 * could happen one PR at a time.
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

  /** Alias for `Result.err` (legacy). */
  static fail(error) {
    return new Result(false, undefined, error);
  }

  /** True when the Result is a success. Available as both method and getter. */
  isOk() {
    return this._ok === true;
  }

  /** True when the Result is a failure. */
  isErr() {
    return this._ok === false;
  }

  /** Legacy alias for {@link Result#isErr}. */
  isFail() {
    return this._ok === false;
  }

  /** Property accessor for the success value (legacy). */
  get value() {
    if (!this._ok) {
      throw new Error('Cannot read .value of a failed Result');
    }
    return this._value;
  }

  /** Property accessor for the error (legacy). */
  get error() {
    if (this._ok) {
      throw new Error('Cannot read .error of a successful Result');
    }
    return this._error;
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
   * Map the error through `fn`. Successes pass through untouched.
   * @param {(e:any)=>any} fn
   * @returns {Result}
   */
  mapError(fn) {
    if (this._ok) return this;
    return Result.err(fn(this._error));
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

  /** Return the success value or `fallback` on failure. */
  unwrapOr(fallback) {
    return this._ok ? this._value : fallback;
  }
}

/** Convenience constructor for an `Ok` Result. */
export const ok = (v) => Result.ok(v);

/** Convenience constructor for an `Err` Result. */
export const err = (e) => Result.err(e);

/** Legacy alias for {@link err}. */
export const fail = (e) => Result.err(e);
