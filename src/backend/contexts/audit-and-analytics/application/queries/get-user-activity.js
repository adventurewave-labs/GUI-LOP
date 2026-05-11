export class GetUserActivityQuery {
  constructor({ pool }) {
    this._pool = pool;
  }

  async execute({ userId, limit = 100, offset = 0 }) {
    if (!this._pool || typeof this._pool.query !== 'function') return [];
    const sql = `SELECT * FROM user_activity WHERE user_id = $1 LIMIT $2 OFFSET $3`;
    try {
      const { rows } = await this._pool.query(sql, [userId, limit, offset]);
      return rows;
    } catch (err) {
      if (err?.code === '42P01') return [];
      throw err;
    }
  }
}
