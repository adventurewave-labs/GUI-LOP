/**
 * ListActiveWorkflows — read-side query.
 *
 * If a `readDb` is supplied, we use the `active_workflows` view directly
 * (CQRS-Lite, ADR 0013). Otherwise, we fall back to scanning the
 * repository (suitable for in-memory tests).
 */
export class ListActiveWorkflowsQuery {
  constructor({ workflows, readDb }) {
    this._workflows = workflows;
    this._readDb = readDb;
  }

  async execute(filter = {}) {
    if (this._readDb && typeof this._readDb.query === 'function') {
      const rows = await this._readDb.query(
        `SELECT id, template_key, status, created_at, started_at, duration
         FROM active_workflows
         WHERE ($1::uuid IS NULL OR created_by = $1)
           AND ($2::text IS NULL OR template_key = $2)
         ORDER BY created_at DESC
         LIMIT 50`,
        [filter.byUser ?? null, filter.byTemplate ?? null],
      );
      return rows;
    }

    if (typeof this._workflows.list !== 'function') return [];
    const all = await this._workflows.list();
    const active = all.filter((w) =>
      ['created', 'running', 'waiting_for_human'].includes(w.status));
    return active
      .filter((w) => (filter.byUser ? w.createdBy === filter.byUser : true))
      .filter((w) => (filter.byTemplate ? w.templateKey === filter.byTemplate : true))
      .map((w) => ({
        id: w.id,
        template_key: w.templateKey,
        status: w.status,
        created_at: w.createdAt?.toISOString?.() ?? w.createdAt,
        started_at: w.startedAt?.toISOString?.() ?? w.startedAt,
      }));
  }
}
