/**
 * ResponseRationale value object — free-text justification, capped at 5000
 * characters. Optional; pass `null` or omit to indicate "no rationale".
 */
import { InvalidResponseError } from '../errors.js';

export const MAX_LENGTH = 5000;

export class ResponseRationale {
  /**
   * @param {string} text
   */
  constructor(text) {
    if (typeof text !== 'string') {
      throw new InvalidResponseError('Rationale must be a string', { type: typeof text });
    }
    if (text.length > MAX_LENGTH) {
      throw new InvalidResponseError(
        `Rationale exceeds ${MAX_LENGTH} character limit`,
        { length: text.length, max: MAX_LENGTH },
      );
    }
    this.value = text;
    Object.freeze(this);
  }

  /**
   * @param {string|null|undefined} text
   * @returns {ResponseRationale|null}
   */
  static of(text) {
    if (text === null || text === undefined) return null;
    return new ResponseRationale(text);
  }

  toString() {
    return this.value;
  }
}
