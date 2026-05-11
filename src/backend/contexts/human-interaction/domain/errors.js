/**
 * Domain errors specific to the Human Interaction bounded context.
 */
import {
  DomainError,
  ForbiddenError,
  ValidationError,
  ConflictError,
  InvariantViolationError,
} from '../../../shared-kernel/domain/errors.js';

/** The submitter is not authorised or not eligible for the pending step. */
export class IneligibleResponderError extends ForbiddenError {
  constructor(message = 'Responder is not eligible for this step', details = {}) {
    super(message, details);
    this.code = 'INELIGIBLE_RESPONDER';
  }
}

/** The submitted action or payload does not match the step's UI spec. */
export class InvalidResponseError extends ValidationError {
  constructor(message = 'Response is invalid for this step', details = {}) {
    super(message, details);
    this.code = 'INVALID_RESPONSE';
  }
}

/** A response was submitted to a step that is not currently pending. */
export class StepNotPendingError extends DomainError {
  constructor(message = 'Step is not pending', details = {}) {
    super('STEP_NOT_PENDING', message, details);
  }
}

/**
 * A second response (different idempotency key) was submitted while another
 * response had already been recorded for the same (workflow, step).
 */
export class ResponseConflictError extends ConflictError {
  constructor(message = 'A response has already been recorded for this step', details = {}) {
    super(message, details);
    this.code = 'RESPONSE_CONFLICT';
  }
}

export { InvariantViolationError };
