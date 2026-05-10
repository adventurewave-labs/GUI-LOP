/**
 * Backwards-compatibility shim.
 *
 * Older imports of `authAPI` from `./auth` are forwarded to the
 * v1 implementation in `./api/auth.js` (wrapped in the legacy
 * `{ success, data, error }` envelope).
 */

export { authAPI } from './api.js';
