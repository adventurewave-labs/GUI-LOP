/**
 * IdGenerator port — produces opaque, unique identifiers (UUID v4).
 */
import { randomUUID } from 'node:crypto';

export class IdGenerator {
  /** @returns {string} */
  next() { return randomUUID(); }
}

/** Deterministic generator for tests. */
export class SequenceIdGenerator extends IdGenerator {
  constructor(prefix = 'id-') {
    super();
    this._prefix = prefix;
    this._n = 0;
  }
  next() {
    this._n += 1;
    return `${this._prefix}${this._n}`;
  }
}
