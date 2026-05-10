/**
 * ResponsePayload value object — wraps the JSON payload submitted by the
 * responder. The wrapper guarantees the payload is JSON-serialisable and
 * exposes a defensively-cloned `value`.
 */
import { InvalidResponseError } from '../errors.js';

export class ResponsePayload {
  /**
   * @param {Record<string, unknown>} value
   */
  constructor(value) {
    if (value === null || value === undefined) {
      throw new InvalidResponseError('Payload must be an object', { value });
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new InvalidResponseError('Payload must be a plain object', {
        type: Array.isArray(value) ? 'array' : typeof value,
      });
    }
    let serialised;
    try {
      serialised = JSON.stringify(value);
    } catch (err) {
      throw new InvalidResponseError('Payload is not JSON serialisable', {
        cause: err.message,
      });
    }
    this._json = serialised;
    this.value = JSON.parse(serialised);
    Object.freeze(this.value);
    Object.freeze(this);
  }

  static of(value) {
    return new ResponsePayload(value);
  }

  toJSON() {
    return JSON.parse(this._json);
  }
}
