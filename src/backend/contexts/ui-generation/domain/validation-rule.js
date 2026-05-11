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
    this.id = id;
    this.type = type;
    this.value = value ?? null;
    this.message = message ?? null;
    Object.freeze(this);
  }

  static of(spec) {
    return new ValidationRule(spec);
  }

  toJSON() {
    return { id: this.id, type: this.type, value: this.value, message: this.message };
  }
}
