/**
 * ComponentResolver — pure. Maps a Field to a concrete component instance from
 * the catalogue. If the field has an explicit component reference it's used
 * verbatim; otherwise falls back to a default per field type.
 */

import { ValidationError } from '../../../../shared/kernel/errors.js';

const TYPE_DEFAULTS = {
  text: 'text-input',
  email: 'text-input',
  number: 'text-input',
  textarea: 'textarea',
  boolean: 'boolean-checkbox',
  date: 'date-picker',
  select: 'select'
};

export function resolve(field, catalogue) {
  let name;
  let version;
  if (field.component) {
    name = field.component.name;
    version = field.component.version;
  } else {
    name = TYPE_DEFAULTS[field.type.value];
    if (!name) {
      throw new ValidationError(`No default component for field type ${field.type.value}`);
    }
    version = catalogue.latestVersion(name);
  }

  if (!catalogue.has(name, version)) {
    throw new ValidationError(`Component ${name}@${version} not in catalogue`);
  }

  return Object.freeze({
    fieldId: field.id,
    component: { name, version },
    props: {
      label: field.label,
      type: field.type.value,
      validations: field.validations.map((v) => v.toJSON()),
      options: [...(field.options ?? [])]
    }
  });
}
