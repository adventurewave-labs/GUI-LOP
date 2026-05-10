import { ConflictError, ForbiddenError, NotFoundError, UnauthorisedError, ValidationError } from '../../../../shared-kernel/domain/errors.js';
import {
  InvalidCredentialsError,
  SessionExpiredError,
  SessionRevokedError,
  UserDeactivatedError,
} from '../../domain/errors.js';

/**
 * Map a domain/application error to an HTTP status + body shape.
 * Returns `null` if the error is unrecognised (caller should 500).
 */
export function mapErrorToHttp(err) {
  if (!err) return null;
  if (err instanceof ValidationError || err.code === 'VALIDATION') {
    return {
      status: 400,
      body: {
        error: 'validation_error',
        message: err.message,
        field: err.field,
      },
    };
  }
  if (err instanceof InvalidCredentialsError) {
    return { status: 401, body: { error: 'invalid_credentials', message: err.message } };
  }
  if (err instanceof UnauthorisedError) {
    return { status: 401, body: { error: 'unauthorised', message: err.message } };
  }
  if (err instanceof UserDeactivatedError) {
    return { status: 403, body: { error: 'user_deactivated', message: err.message } };
  }
  if (err instanceof SessionExpiredError) {
    return { status: 401, body: { error: 'session_expired', message: err.message } };
  }
  if (err instanceof SessionRevokedError) {
    return { status: 401, body: { error: 'session_revoked', message: err.message } };
  }
  if (err instanceof ForbiddenError) {
    return { status: 403, body: { error: 'forbidden', message: err.message } };
  }
  if (err instanceof NotFoundError) {
    return { status: 404, body: { error: 'not_found', message: err.message } };
  }
  if (err instanceof ConflictError) {
    return { status: 409, body: { error: 'conflict', message: err.message } };
  }
  return null;
}

/** Express-style middleware that finalises the response for a known error. */
export function sendError(res, err) {
  const mapped = mapErrorToHttp(err);
  if (!mapped) {
    res.status(500).json({ error: 'internal_error', message: 'Unexpected error' });
    return;
  }
  res.status(mapped.status).json(mapped.body);
}
