/**
 * Maps domain errors to HTTP responses for the Human Interaction context.
 */
import {
  IneligibleResponderError,
  InvalidResponseError,
  StepNotPendingError,
  ResponseConflictError,
} from '../../domain/errors.js';
import {
  DomainError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  ValidationError,
} from '../../../../shared-kernel/domain/errors.js';

export function mapError(err) {
  if (err instanceof IneligibleResponderError) return { status: 403, body: toBody(err, 'INELIGIBLE_RESPONDER') };
  if (err instanceof InvalidResponseError) return { status: 422, body: toBody(err, 'INVALID_RESPONSE') };
  if (err instanceof StepNotPendingError) return { status: 404, body: toBody(err, 'STEP_NOT_PENDING') };
  if (err instanceof ResponseConflictError) return { status: 409, body: toBody(err, 'RESPONSE_CONFLICT') };
  if (err instanceof NotFoundError) return { status: 404, body: toBody(err, 'NOT_FOUND') };
  if (err instanceof ConflictError) return { status: 409, body: toBody(err, err.code ?? 'CONFLICT') };
  if (err instanceof ForbiddenError) return { status: 403, body: toBody(err, err.code ?? 'FORBIDDEN') };
  if (err instanceof ValidationError) return { status: 422, body: toBody(err, err.code ?? 'VALIDATION') };
  if (err instanceof DomainError) return { status: 400, body: toBody(err, err.code ?? 'DOMAIN_ERROR') };
  return { status: 500, body: { error: { code: 'INTERNAL', message: 'Internal server error' } } };
}

function toBody(err, code) {
  return {
    error: {
      code,
      message: err.message,
      details: err.details ?? {},
    },
  };
}
