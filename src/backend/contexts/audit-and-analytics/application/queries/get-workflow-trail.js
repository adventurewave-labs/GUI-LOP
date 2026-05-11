/**
 * GetWorkflowTrail — joins `events` and `audit_logs` for a single workflow,
 * returning a chronological combined trail.
 */

export class GetWorkflowTrailQuery {
  constructor({ eventStore, auditLogStore }) {
    this._events = eventStore;
    this._logs = auditLogStore;
  }

  async execute({ workflowId, range }) {
    const [events, logs] = await Promise.all([
      this._events.query({ aggregateType: 'Workflow', aggregateId: workflowId, range }),
      this._logs.query({ aggregateType: 'Workflow', aggregateId: workflowId, range })
    ]);

    const merged = [
      ...events.map((e) => ({ kind: 'event', at: e.occurred_at ?? e.occurredAt, ...e })),
      ...logs.map((l) => ({ kind: 'audit', at: l.created_at ?? l.createdAt, ...l }))
    ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

    return { workflowId, items: merged };
  }
}
