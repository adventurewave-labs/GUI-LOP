import { ValidationError } from '../../../../shared-kernel/domain/errors.js';
/**
 * Tiny schema validator. Supports the subset we need without pulling
 * in `ajv`. If the supplied schema is `undefined`/`null`, validation
 * is a no-op.
 */
export function validate(value, schema, path = '$') {
  if (!schema) return;
  if (typeof schema !== 'object') {
    throw new ValidationError(`Invalid schema at ${path}`, path);
  }
  const expectedType = schema.type;
  if (expectedType !== undefined && !KNOWN_TYPES.has(expectedType)) {
    // A typo ('strnig') used to match anything, silently disabling validation.
    throw new ValidationError(`Unknown schema type "${expectedType}" at ${path}`, path);
  }
  if (expectedType) {
    if (!matchesType(value, expectedType)) {
      throw new ValidationError(
        `Expected ${expectedType} at ${path}, got ${describe(value)}`,
        path,
      );
    }
  }
  // `required` is enforced whenever present — it used to be skipped unless
  // `properties` was also declared, so { type: 'object', required: ['x'] }
  // accepted {}.
  if (expectedType === 'object' || (!expectedType && Array.isArray(schema.required))) {
    if (Array.isArray(schema.required)) {
      for (const k of schema.required) {
        if (value === null || value === undefined || !(k in value)) {
          throw new ValidationError(
            `Missing required key: ${path}.${k}`,
            `${path}.${k}`,
          );
        }
      }
    }
    for (const [k, sub] of Object.entries(schema.properties ?? {})) {
      if (value && k in value) {
        validate(value[k], sub, `${path}.${k}`);
      }
    }
  }
  if (expectedType === 'array' && schema.items) {
    if (Array.isArray(value)) {
      value.forEach((v, i) => validate(v, schema.items, `${path}[${i}]`));
    }
  }
}

const KNOWN_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);

function matchesType(value, type) {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array': return Array.isArray(value);
    case 'null': return value === null;
    default: return false; // unreachable: unknown types are rejected above
  }
}

function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

export function validateInput(stepDef, input) {
  if (!stepDef.inputSchema) return;
  validate(input, stepDef.inputSchema, `step:${stepDef.name}.input`);
}

export function validateOutput(stepDef, output) {
  if (!stepDef.outputSchema) return;
  validate(output, stepDef.outputSchema, `step:${stepDef.name}.output`);
}
