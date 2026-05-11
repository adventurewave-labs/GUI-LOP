/**
 * Deterministic Clock and IdGenerator implementations for tests.
 *
 * They live in shared-kernel/infrastructure (alongside SystemClock and
 * UuidGenerator) so every bounded context can import the same versions
 * and we don't need separate stubs per context.
 *
 * Both `FrozenClock` and `FixedClock` are exported as historical aliases
 * (Phase 3 used `FixedClock`, Phase 4-6 used `FrozenClock`). They implement
 * the same interface.
 *
 * Both `FixedIdGenerator` and `SequentialIdGenerator` expose `next()` and
 * `newId()` so callers using either method name work.
 */

/**
 * Clock that always returns a fixed instant. `advance(ms)` moves it forward.
 */
export class FrozenClock {
  constructor(initial = new Date('2026-01-01T00:00:00.000Z')) {
    this._now = initial instanceof Date ? new Date(initial) : new Date(initial);
  }

  now() {
    return new Date(this._now);
  }

  nowIso() {
    return this.now().toISOString();
  }

  advance(ms) {
    this._now = new Date(this._now.getTime() + ms);
    return this.now();
  }

  set(date) {
    this._now = new Date(date);
  }
}

/** Phase 3 alias for {@link FrozenClock}. */
export const FixedClock = FrozenClock;

/**
 * IdGenerator that returns ids from a queue, then synthesises monotonic
 * UUID-shaped strings once the queue empties. Exposes both `next()` and
 * `newId()` so callers using either method work.
 */
export class FixedIdGenerator {
  constructor(ids = []) {
    this._queue = Array.isArray(ids) ? [...ids] : [];
    this._counter = 0;
  }

  next() {
    if (this._queue.length > 0) return this._queue.shift();
    this._counter += 1;
    return `00000000-0000-0000-0000-${String(this._counter).padStart(12, '0')}`;
  }

  newId() {
    return this.next();
  }

  push(id) {
    this._queue.push(id);
  }
}

/**
 * IdGenerator that emits `prefix-NNNNNNNN-0000-0000-0000-000000000000` strings.
 * Phase 2's preferred test fixture; kept for backwards compatibility.
 */
export class SequentialIdGenerator {
  constructor(prefix = 'id') {
    this._prefix = prefix;
    this._n = 0;
  }

  next() {
    this._n += 1;
    return `${this._prefix}-${this._n.toString().padStart(8, '0')}-0000-0000-0000-000000000000`;
  }

  newId() {
    return this.next();
  }
}
