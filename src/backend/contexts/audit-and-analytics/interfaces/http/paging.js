// @ts-check
/**
 * Query-string paging for the audit/analytics routers.
 *
 * Values used to go straight into SQL `LIMIT/OFFSET`: `?limit=-1` became a
 * Postgres error (→ 500) and `?limit=10000000` an unbounded scan. Clamp to
 * sane bounds; garbage falls back to the default.
 *
 * @param {{ limit?: unknown, offset?: unknown }} q
 * @param {{ defaultLimit?: number, maxLimit?: number }} [opts]
 * @returns {{ limit: number, offset: number }}
 */
export function parsePaging(q, { defaultLimit = 100, maxLimit = 1000 } = {}) {
  const l = Number.parseInt(String(q?.limit ?? ''), 10);
  const o = Number.parseInt(String(q?.offset ?? ''), 10);
  return {
    limit: Number.isFinite(l) && l > 0 ? Math.min(l, maxLimit) : defaultLimit,
    offset: Number.isFinite(o) && o > 0 ? Math.min(o, 1_000_000) : 0,
  };
}
