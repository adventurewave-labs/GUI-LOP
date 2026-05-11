import { ValidationError } from '../../../../shared-kernel/domain/errors.js';
/**
 * TemplateVersion — positive integer; a template family is a sequence
 * of versions. Versions never decrease.
 */
export class TemplateVersion {
  /** @private */
  constructor(value) {
    this.value = value;
    Object.freeze(this);
  }

  static of(raw) {
    const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
      throw new ValidationError(
        'TemplateVersion must be a positive integer',
        'version',
      );
    }
    return new TemplateVersion(n);
  }

  static initial() { return new TemplateVersion(1); }
  next() { return new TemplateVersion(this.value + 1); }

  equals(other) {
    return other instanceof TemplateVersion && other.value === this.value;
  }

  toString() { return String(this.value); }
}
