export class GetActiveWorkflowsQuery {
  constructor({ pool }) {
    this._pool = pool;
  }

  async execute({ limit = 100, offset = 0 } = {}) {
    const sql = `SELECT * FROM active_workflows LIMIT $1 OFFSET $2`;
    try {
      const { rows } = await this._pool.query(sql, [limit, offset]);
      return rows;
    } catch (err) {
      if (err?.code === '42P01') return [];
      throw err;
    }
  }
}
