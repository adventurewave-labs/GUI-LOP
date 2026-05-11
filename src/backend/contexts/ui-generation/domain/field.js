import { ValidationError } from '../../../shared-kernel/domain/errors.js';
import { FieldType } from './field-type.js';
import { ValidationRule } from './validation-rule.js';
import { ComponentRef } from './component-ref.js';

export class Field {
  constructor({ id, label, type, validations = [], component, options = [] }) {
    if (!id) throw new ValidationError('Field.id is required');
    if (!label) throw new ValidationError('Field.label is required');
    const ft = type instanceof FieldType ? type : FieldType.of(type);
    const rules = validations.map((v) => (v instanceof ValidationRule ? v : ValidationRule.of(v)));
    const comp = component
      ? component instanceof ComponentRef
        ? component
        : ComponentRef.of(component)
      : null;

    this.id = id;
    this.label = label;
    this.type = ft;
    this.validations = Object.freeze(rules);
    this.component = comp;
    this.options = Object.freeze([...options]);
    Object.freeze(this);
  }

  static of(spec) {
    return new Field(spec);
  }

  toJSON() {
    return {
      id: this.id,
      label: this.label,
      type: this.type.toJSON(),
      validations: this.validations.map((v) => v.toJSON()),
      component: this.component?.toJSON() ?? null,
      options: [...this.options]
    };
  }
}
