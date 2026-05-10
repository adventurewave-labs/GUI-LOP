/**
 * Envelope — VO that wraps a domain event for transport over a channel.
 */

import { ValidationError } from '../../../../shared/kernel/errors.js';

export class Envelope {
  constructor({ type, version = 1, payload = {}, occurredAt }) {
    if (!type || typeof type !== 'string') {
      throw new ValidationError('Envelope.type is required');
    }
    if (!occurredAt) {
      throw new ValidationError('Envelope.occurredAt is required');
    }
    this.type = type;
    this.version = version;
    this.payload = Object.freeze({ ...payload });
    this.occurredAt = occurredAt;
    Object.freeze(this);
  }

  static of(spec) {
    return new Envelope(spec);
  }

  toJSON() {
    return {
      type: this.type,
      version: this.version,
      payload: this.payload,
      occurredAt: this.occurredAt
    };
  }
}
