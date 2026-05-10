/**
 * ConfidenceScore value object — decimal in the closed interval [0, 1].
 */
import { InvalidResponseError } from '../errors.js';

export class ConfidenceScore {
  /**
   * @param {number} value
   */
  constructor(value) {
    if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
      throw new InvalidResponseError('Confidence must be a finite number', { value });
    }
    if (value < 0 || value > 1) {
      throw new InvalidResponseError('Confidence must be in [0, 1]', { value });
    }
    this.value = value;
    Object.freeze(this);
  }

  /**
   * @param {number|null|undefined} value
   * @returns {ConfidenceScore|null}
   */
  static of(value) {
    if (value === null || value === undefined) return null;
    return new ConfidenceScore(value);
  }
}
