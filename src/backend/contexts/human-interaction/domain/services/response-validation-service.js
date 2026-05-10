/**
 * ResponseValidationService — validates a raw `(action, payload)` tuple
 * against a pending step's UI specification.
 *
 * The service is constructed for a specific step (via `forStep`) so it can
 * close over the step's allowed actions and payload schema. It returns a
 * `Result<{action: ResponseAction, payload: ResponsePayload}, InvalidResponseError>`.
 *
 * The payload schema is interpreted as a minimal JSON-Schema-like shape:
 *
 *   {
 *     type: "object",
 *     required: ["foo"],
 *     properties: {
 *       foo: { type: "string" },
 *       bar: { type: "number", minimum: 0 }
 *     },
 *     additionalProperties: false
 *   }
 *
 * Only the subset needed by tests is implemented here (type checking,
 * required properties, additionalProperties). The full validator can be
 * swapped in via a custom `validate` function passed to the constructor.
 */
import { Result } from '../../../../shared-kernel/domain/result.js';
import { ResponseAction } from '../human-response/response-action.js';
import { ResponsePayload } from '../human-response/response-payload.js';
import { InvalidResponseError } from '../errors.js';

export class ResponseValidationService {
  /**
   * @param {object} args
   * @param {string[]} [args.allowedActions]   beyond defaults
   * @param {object}   [args.payloadSchema]
   * @param {(action:string, payload:unknown)=>Result} [args.validate]
   */
  constructor({ allowedActions, payloadSchema, validate } = {}) {
    this._allowedActions = allowedActions ?? [];
    this._schema = payloadSchema ?? null;
    if (typeof validate === 'function') {
      this.validate = validate;
    }
  }

  /**
   * Build a service from a step descriptor.
   *
   * @param {{ allowedActions?: string[], responseSchema?: object }} step
   */
  static forStep(step = {}) {
    return new ResponseValidationService({
      allowedActions: step.allowedActions ?? step.actions ?? [],
      payloadSchema: step.responseSchema ?? step.schema ?? null,
    });
  }

  validate(rawAction, rawPayload) {
    let action;
    try {
      action = ResponseAction.of(rawAction, this._allowedActions);
    } catch (err) {
      if (err instanceof InvalidResponseError) return Result.err(err);
      return Result.err(new InvalidResponseError(err.message));
    }

    let payload;
    try {
      payload = ResponsePayload.of(rawPayload);
    } catch (err) {
      if (err instanceof InvalidResponseError) return Result.err(err);
      return Result.err(new InvalidResponseError(err.message));
    }

    const schemaErr = this._validateSchema(payload.toJSON());
    if (schemaErr) return Result.err(schemaErr);

    return Result.ok({ action, payload });
  }

  _validateSchema(value) {
    const schema = this._schema;
    if (!schema) return null;
    if (schema.type === 'object') {
      if (typeof value !== 'object' || Array.isArray(value) || value === null) {
        return new InvalidResponseError('Payload must be an object', { schema: 'object' });
      }
      if (Array.isArray(schema.required)) {
        for (const key of schema.required) {
          if (!(key in value)) {
            return new InvalidResponseError(`Payload missing required field: ${key}`, { field: key });
          }
        }
      }
      if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          if (!(key in value)) continue;
          const err = this._validateProp(key, value[key], propSchema);
          if (err) return err;
        }
      }
      if (schema.additionalProperties === false && schema.properties) {
        const allowed = new Set(Object.keys(schema.properties));
        for (const key of Object.keys(value)) {
          if (!allowed.has(key)) {
            return new InvalidResponseError(`Unexpected field: ${key}`, { field: key });
          }
        }
      }
    }
    return null;
  }

  _validateProp(key, value, schema) {
    if (schema.type === 'string' && typeof value !== 'string') {
      return new InvalidResponseError(`Field ${key} must be a string`, { field: key });
    }
    if (schema.type === 'number' && typeof value !== 'number') {
      return new InvalidResponseError(`Field ${key} must be a number`, { field: key });
    }
    if (schema.type === 'boolean' && typeof value !== 'boolean') {
      return new InvalidResponseError(`Field ${key} must be a boolean`, { field: key });
    }
    if (schema.type === 'number' && typeof schema.minimum === 'number' && value < schema.minimum) {
      return new InvalidResponseError(`Field ${key} must be >= ${schema.minimum}`, { field: key });
    }
    if (schema.enum && !schema.enum.includes(value)) {
      return new InvalidResponseError(`Field ${key} must be one of ${schema.enum.join(', ')}`, { field: key });
    }
    return null;
  }
}
