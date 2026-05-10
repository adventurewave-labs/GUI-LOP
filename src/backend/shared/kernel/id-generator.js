/**
 * IdGenerator — abstracts UUID/ULID generation for deterministic tests.
 */

import { randomUUID } from 'crypto';

export class UuidGenerator {
  next() {
    return randomUUID();
  }
}

export class FixedIdGenerator {
  constructor(ids = []) {
    this._queue = [...ids];
    this._counter = 0;
  }

  next() {
    if (this._queue.length > 0) {
      return this._queue.shift();
    }
    this._counter += 1;
    return `00000000-0000-0000-0000-${String(this._counter).padStart(12, '0')}`;
  }

  push(id) {
    this._queue.push(id);
  }
}
