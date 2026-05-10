import { ConflictError, DomainError, ForbiddenError, NotFoundError, UnauthorisedError, ValidationError } from '../../../../shared-kernel/domain/errors.js';
/**
 * Map a domain or unknown error to an HTTP `(status, body)` pair.
 * Body shape mirrors the legacy server's envelope so existing
 * frontends keep working: `{ success, message, code, ... }`.
 */
export function mapError(err) {
  if (err instanceof ValidationError) {
    return {
      status: 400,
      body: {
        success: false,
        message: err.message,
        code: 'VALIDATION_ERROR',
        field: err.field,
      },
    };
  }
  if (err instanceof UnauthorisedError) {
    return {
      status: 401,
      body: { success: false, message: err.message, code: 'UNAUTHORISED' },
    };
  }
  if (err instanceof ForbiddenError) {
    return {
      status: 403,
      body: { success: false, message: err.message, code: 'FORBIDDEN' },
    };
  }
  if (err instanceof NotFoundError) {
    return {
      status: 404,
      body: { success: false, message: err.message, code: err.code ?? 'NOT_FOUND' },
    };
  }
  if (err instanceof ConflictError) {
    return {
      status: 409,
      body: { success: false, message: err.message, code: err.code ?? 'CONFLICT' },
    };
  }
  if (err instanceof DomainError) {
    return {
      status: 422,
      body: { success: false, message: err.message, code: err.code },
    };
  }
  return {
    status: 500,
    body: { success: false, message: 'Internal server error', code: 'INTERNAL_ERROR' },
  };
}

/** Express middleware wrapper for unhandled async errors. */
export function expressErrorBoundary(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (err) {
      const { status, body } = mapError(err);
      res.status(status).json(body);
    }
  };
}
