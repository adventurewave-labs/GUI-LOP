import { validate, validateInput, validateOutput } from '../../domain/workflow/step-validation-service.js';
import { ValidationError } from '../../../../shared-kernel/domain/errors.js';
describe('step-validation-service', () => {
  it('passes when no schema', () => {
    expect(() => validate(undefined, undefined)).not.toThrow();
  });

  it('checks primitive types', () => {
    validate('hi', { type: 'string' });
    expect(() => validate(1, { type: 'string' })).toThrow(ValidationError);
    validate(1, { type: 'integer' });
    expect(() => validate(1.5, { type: 'integer' })).toThrow();
    validate(true, { type: 'boolean' });
  });

  it('enforces required object keys', () => {
    const schema = {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' } },
    };
    validate({ name: 'a' }, schema);
    expect(() => validate({}, schema)).toThrow(/Missing required key/);
  });

  it('descends into arrays', () => {
    const schema = { type: 'array', items: { type: 'integer' } };
    validate([1, 2, 3], schema);
    expect(() => validate([1, 'two'], schema)).toThrow();
  });

  it('validateInput / validateOutput accept undefined schemas', () => {
    expect(() => validateInput({ name: 'x' }, {})).not.toThrow();
    expect(() => validateOutput({ name: 'x' }, {})).not.toThrow();
  });
});
