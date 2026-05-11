/**
 * GetWorkflowAnalytics — reads from the existing `workflow_analytics` view.
 * Falls back gracefully if the view is missing in test environments.
 */

export class GetWorkflowAnalyticsQuery {
  constructor({ pool }) {
    this._pool = pool;
  }

  async execute({ limit = 100, offset = 0 } = {}) {
    if (!this._pool || typeof this._pool.query !== 'function') return [];
    const sql = `SELECT * FROM workflow_analytics LIMIT $1 OFFSET $2`;
    try {
      const { rows } = await this._pool.query(sql, [limit, offset]);
      return rows;
    } catch (err) {
      if (this._isMissingRelation(err)) return [];
      throw err;
    }
  }

  _isMissingRelation(err) {
    return err?.code === '42P01' || /does not exist/i.test(err?.message ?? '');
  }
}
