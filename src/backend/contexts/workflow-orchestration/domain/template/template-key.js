import { ValidationError } from '../../../../shared-kernel/domain/errors.js';
const KEBAB_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * TemplateKey — kebab-case identifier of a workflow template family.
 * Multiple versions share the same key.
 */
export class TemplateKey {
  /** @private */
  constructor(value) {
    this.value = value;
    Object.freeze(this);
  }

  static of(raw) {
    if (typeof raw !== 'string') {
      throw new ValidationError('TemplateKey must be a string', 'template_key');
    }
    const trimmed = raw.trim();
    if (trimmed.length < 2 || trimmed.length > 100) {
      throw new ValidationError(
        'TemplateKey must be 2-100 characters',
        'template_key',
      );
    }
    if (!KEBAB_RE.test(trimmed)) {
      throw new ValidationError(
        'TemplateKey must be kebab-case (lowercase, digits, hyphens)',
        'template_key',
      );
    }
    return new TemplateKey(trimmed);
  }

  equals(other) {
    return other instanceof TemplateKey && other.value === this.value;
  }

  toString() { return this.value; }
}
