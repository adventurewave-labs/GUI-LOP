/**
 * Channel — value object enum.
 */

import { ValidationError } from '../../../../shared/kernel/errors.js';

export const CHANNELS = Object.freeze({
  WEBSOCKET: 'websocket',
  EMAIL: 'email',
  WEBHOOK: 'webhook'
});

const ALL = new Set(Object.values(CHANNELS));

export class Channel {
  constructor(value) {
    if (!ALL.has(value)) {
      throw new ValidationError(`Unknown channel: ${value}`, { allowed: [...ALL] });
    }
    this.value = value;
    Object.freeze(this);
  }

  static of(value) {
    return new Channel(value);
  }

  equals(other) {
    return other instanceof Channel && other.value === this.value;
  }

  toString() {
    return this.value;
  }

  toJSON() {
    return this.value;
  }
}
