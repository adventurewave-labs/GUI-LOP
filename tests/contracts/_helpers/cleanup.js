/**
 * Per-test isolation helpers.
 *
 * Calling `truncateAll(pool)` between tests gives every test a clean
 * slate without the cost of recreating the container. We use
 * `TRUNCATE … RESTART IDENTITY CASCADE` and explicitly enumerate the
 * tables created by the production migrations plus the analytics
 * projections re-created by `applyAnalyticsProjections`.
 */

export const TRUNCATABLE = [
  // workflow + sessions + audit
  'workflow_metrics',
  'human_responses',
  'workflow_steps',
  'workflows',
  'workflow_templates',
  'user_sessions',
  'user_permissions',
  'api_keys',
  'users',
  // notification context
  'delivery_attempts',
  'dead_letters',
  'subscriptions',
  // human interaction projection
  'pending_steps',
  // ui generation
  'ui_documents',
  // shared kernel
  'outbox',
  'idempotency_keys',
  // analytics projections re-created in applyAnalyticsProjections
  'events',
  'audit_logs',
];

/**
 * Truncate every contract-relevant table. Skips tables that don't
 * exist (some suites apply only a subset of the schema).
 */
export async function truncateAll(pool) {
  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  );
  const present = new Set(rows.map((r) => r.table_name));
  const list = TRUNCATABLE.filter((t) => present.has(t));
  if (list.length === 0) return;
  await pool.query(
    `TRUNCATE TABLE ${list.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}
