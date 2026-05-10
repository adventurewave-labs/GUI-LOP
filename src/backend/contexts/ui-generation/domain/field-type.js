import { ValidationError } from '../../../shared/kernel/errors.js';

export const FIELD_TYPES = Object.freeze({
  TEXT: 'text',
  TEXTAREA: 'textarea',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  DATE: 'date',
  SELECT: 'select',
  EMAIL: 'email'
});

const ALL = new Set(Object.values(FIELD_TYPES));

export class FieldType {
  constructor(value) {
    if (!ALL.has(value)) {
      throw new ValidationError(`Unknown field type: ${value}`, { allowed: [...ALL] });
    }
    this.value = value;
    Object.freeze(this);
  }

  static of(value) {
    return new FieldType(value);
  }

  toJSON() {
    return this.value;
  }
}
