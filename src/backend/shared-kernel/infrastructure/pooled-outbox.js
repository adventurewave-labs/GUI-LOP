// @ts-check
/**
 * Outbox adapter for contexts whose repositories do not share a transaction
 * with the caller (identity): each `enqueue` writes the events to the durable
 * Postgres outbox in its own short transaction.
 *
 * Why: identity published its events (sign-in, failed sign-in, session
 * revoked, refresh-token reuse, permission granted/revoked, user
 * deactivated, API key minted/revoked) to an in-memory array that nothing
 * read. They never reached the audit trail (`audit_events` is fed by the
 * outbox), webhooks, or anything else, and were lost on restart.
 *
 * The event is written right AFTER the state change, not atomically with it:
 * a crash between the two loses the event (never the reverse). A failure to
 * write is thrown — an identity change that cannot be audited is reported as
 * an error rather than silently unrecorded.
 *
 * `actorId` is added to the payload so the audit trail attributes an
 * administrative action to the administrator, not to the user it targets.
 */

/** Event types whose subject (`payload.userId`) is not the person who acted. */
const ADMINISTRATIVE = new Set(['permission.granted', 'permission.revoked', 'role.granted', 'user.deactivated', 'user.reactivated']);

/**
 * @param {object} deps
 * @param {{ connect(): Promise<{ query(sql: string, args?: any[]): Promise<any>, release(err?: any): void }> }} deps.pool
 * @param {{ enqueue(events: any[], ctx: { client: any }): Promise<void> }} deps.outbox
 * @param {string[]} [deps.skipTypes]  high-volume events that are not worth a row each
 */
export function createPooledOutbox({ pool, outbox, skipTypes = [] }) {
  const skip = new Set(skipTypes);
  return {
    /**
     * @param {any[]} events
     * @param {{ actorId?: string|null }} [ctx]
     */
    async enqueue(events, ctx = {}) {
      if (!Array.isArray(events)) throw new TypeError('Outbox.enqueue: events must be an array');
      const rows = events
        .map((ev) => (typeof ev?.toJSON === 'function' ? ev.toJSON() : ev))
        .filter((e) => e && !skip.has(e.eventType))
        .map((e) => {
          const actorId = ctx.actorId
            ?? (e.actor && e.actor.type !== 'system' && e.actor.id ? e.actor.id : null)
            ?? (ADMINISTRATIVE.has(e.eventType) ? 'system' : null);
          return actorId ? { ...e, payload: { ...e.payload, actorId: String(actorId) } } : e;
        });
      if (rows.length === 0) return;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await outbox.enqueue(rows, { client });
        await client.query('COMMIT');
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch { /* connection is gone; release below discards it */ }
        client.release(err);
        throw err;
      }
      client.release();
    },
  };
}
