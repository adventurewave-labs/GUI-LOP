// @ts-check
/**
 * Transient infrastructure errors → 503 + Retry-After instead of 500.
 *
 * With session limits on the pool (pg-pool.js), overload now surfaces as
 * fast, typed failures — statement/lock timeouts, an exhausted pool, a
 * connection killed by failover. Those are "try again shortly", not bugs:
 * clients and load balancers retry a 503 (honouring Retry-After) and must
 * not treat it as a server defect, and alerting can tell overload from
 * breakage.
 */

/** SQLSTATEs that mean "retry later", not "your request is wrong". */
const TRANSIENT_SQLSTATES = new Set([
  '57014', // query_canceled (statement_timeout)
  '55P03', // lock_not_available (lock_timeout)
  '25P03', // idle_in_transaction_session_timeout
  '57P01', // admin_shutdown (terminated / failover)
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now (starting up / recovery)
  '53300', // too_many_connections
  '40001', // serialization_failure
  '40P01', // deadlock_detected
]);

const TRANSIENT_MESSAGES = /timeout exceeded when trying to connect|Connection terminated|connect ECONNREFUSED|Query read timeout/i;

/** @param {any} err */
export function isTransientDbError(err) {
  if (!err || typeof err !== 'object') return false;
  const code = typeof err.code === 'string' ? err.code : '';
  if (TRANSIENT_SQLSTATES.has(code) || code.startsWith('08')) return true; // 08xxx connection exceptions
  return TRANSIENT_MESSAGES.test(String(err.message ?? ''));
}

export const RETRY_AFTER_SECONDS = 1;
