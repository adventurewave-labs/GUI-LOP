import { ValidationError } from '../../../shared-kernel/domain/errors.js';
export const RULE_TYPES = Object.freeze({
  REQUIRED: 'required',
  MIN_LENGTH: 'minLength',
  MAX_LENGTH: 'maxLength',
  PATTERN: 'pattern',
  MIN: 'min',
  MAX: 'max',
  ENUM: 'enum'
});

const ALL = new Set(Object.values(RULE_TYPES));

export class ValidationRule {
  constructor({ id, type, value, message }) {
    if (!id) throw new ValidationError('ValidationRule.id is required');
    if (!ALL.has(type)) throw new ValidationError(`Unknown validation rule: ${type}`);
    checkValue(type, value ?? null);
    if (message != null && typeof message !== 'string') {
      throw new ValidationError('ValidationRule.message must be a string');
    }
    this.id = id;
    this.type = type;
    this.value = value ?? null;
    this.message = message ?? null;
    Object.freeze(this);
  }

  /** @param {{ id: string, type: string, value?: unknown, message?: string|null }} spec */
  static of(spec) {
    return new ValidationRule(spec);
  }

  toJSON() {
    return { id: this.id, type: this.type, value: this.value, message: this.message };
  }
}

/** Longest `pattern` accepted; bounds the regex the client compiles. */
export const MAX_PATTERN_LENGTH = 512;

/**
 * Rule values arrive from AI drafts and are shipped to the browser, which
 * compiles `pattern` into a RegExp and compares numbers. They were never
 * checked: `{ type: 'minLength', value: 'abc' }` or an uncompilable pattern
 * passed the domain and failed (or misbehaved) client-side.
 */
function checkValue(type, value) {
  const fail = (why) => {
    throw new ValidationError(`ValidationRule(${type}).value ${why}`);
  };
  switch (type) {
    case RULE_TYPES.REQUIRED:
      if (value !== null && typeof value !== 'boolean') fail('must be boolean or absent');
      return;
    case RULE_TYPES.MIN_LENGTH:
    case RULE_TYPES.MAX_LENGTH:
      if (!Number.isInteger(value) || value < 0) fail('must be a non-negative integer');
      return;
    case RULE_TYPES.MIN:
    case RULE_TYPES.MAX:
      if (typeof value !== 'number' || !Number.isFinite(value)) fail('must be a finite number');
      return;
    case RULE_TYPES.PATTERN:
      if (typeof value !== 'string' || value.length === 0) fail('must be a non-empty string');
      if (value.length > MAX_PATTERN_LENGTH) fail(`must be at most ${MAX_PATTERN_LENGTH} characters`);
      try {
        // eslint-disable-next-line security/detect-non-literal-regexp -- compile check only, never executed here
        new RegExp(value);
      } catch {
        fail('must be a valid regular expression');
      }
      return;
    case RULE_TYPES.ENUM:
      if (!Array.isArray(value) || value.length === 0) fail('must be a non-empty array');
      if (!value.every((v) => ['string', 'number', 'boolean'].includes(typeof v))) {
        fail('entries must be strings, numbers or booleans');
      }
      return;
    default:
      return;
  }
}
