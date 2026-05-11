/**
 * Outbox port — durable buffer for domain events written transactionally
 * with aggregate state, then dispatched by a separate publisher (ADR 0014).
 *
 * Interface:
 *   {
 *     // Enqueue events inside the same transaction as the aggregate write.
 *     enqueue(events: DomainEvent[], uowCtx: { client }): Promise<void>
 *
 *     // Pick the next batch of pending events for dispatch.
 *     // Implementations MUST use FOR UPDATE SKIP LOCKED to allow
 *     // concurrent publishers.
 *     pickBatch(size: number): Promise<OutboxRow[]>
 *
 *     // Mark events as successfully dispatched.
 *     markDispatched(ids: string[]): Promise<void>
 *
 *     // Mark a single event as failed; the publisher decides retry vs.
 *     // dead-letter based on retry_count.
 *     markFailed(id: string, reason: string): Promise<void>
 *
 *     // Observability: oldest pending event age in milliseconds.
 *     // Returns 0 when no rows are pending. Used by the /health probe
 *     // to surface dispatch lag (see ADR 0021 — Observability).
 *     getOldestPendingAge(now: Date): Promise<number>
 *
 *     // Observability: number of pending rows. Used alongside
 *     // getOldestPendingAge() to distinguish "stuck consumer" from
 *     // "burst of fresh events".
 *     getPendingCount(): Promise<number>
 *   }
 */
export const OUTBOX_PORT = Symbol.for('shared-kernel/Outbox');
