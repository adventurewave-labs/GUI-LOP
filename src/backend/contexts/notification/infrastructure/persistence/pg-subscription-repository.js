/**
 * PgSubscriptionRepository — PostgreSQL adapter for SubscriptionRepository.
 *
 * Schema: see database/migrations/006_subscriptions.sql.
 */

import { SubscriptionRepository } from '../../application/ports/subscription-repository.js';
import { Subscription } from '../../domain/subscription/subscription.js';
import { Channel } from '../../domain/subscription/channel.js';
import { EndpointAddress } from '../../domain/subscription/endpoint-address.js';
import { Filter } from '../../domain/subscription/filter.js';

const ROW_COLS = `
  id, subscriber_kind, subscriber_ref, channel, address, filters,
  is_active, created_at, last_active_at
`;

function rowToAggregate(row) {
  if (!row) return null;
  const channel = Channel.of(row.channel);
  const address = EndpointAddress.of({
    channel: row.channel,
    value: row.address
  });
  const filters =
    typeof row.filters === 'string' ? JSON.parse(row.filters) : (row.filters ?? {});
  return new Subscription({
    id: row.id,
    subscriberKind: row.subscriber_kind,
    subscriberRef: row.subscriber_ref,
    channel,
    address,
    filter: Filter.of(filters),
    isActive: row.is_active,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
    lastActiveAt:
      row.last_active_at instanceof Date
        ? row.last_active_at.toISOString()
        : row.last_active_at
  });
}

export class PgSubscriptionRepository extends SubscriptionRepository {
  constructor(pool) {
    super();
    this._pool = pool;
  }

  async save(sub) {
    const sql = `
      INSERT INTO subscriptions
        (id, subscriber_kind, subscriber_ref, channel, address, filters,
         is_active, created_at, last_active_at)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
      ON CONFLICT (id) DO UPDATE SET
        subscriber_kind = EXCLUDED.subscriber_kind,
        subscriber_ref  = EXCLUDED.subscriber_ref,
        channel         = EXCLUDED.channel,
        address         = EXCLUDED.address,
        filters         = EXCLUDED.filters,
        is_active       = EXCLUDED.is_active,
        last_active_at  = EXCLUDED.last_active_at
    `;
    await this._pool.query(sql, [
      sub.id,
      sub.subscriberKind,
      sub.subscriberRef,
      sub.channel.value,
      sub.address.value,
      JSON.stringify(sub.filter.toJSON()),
      sub.isActive,
      sub.createdAt,
      sub.lastActiveAt
    ]);
  }

  async findById(id) {
    const { rows } = await this._pool.query(
      `SELECT ${ROW_COLS} FROM subscriptions WHERE id = $1`,
      [id]
    );
    return rowToAggregate(rows[0]);
  }

  async findActive() {
    const { rows } = await this._pool.query(
      `SELECT ${ROW_COLS} FROM subscriptions WHERE is_active = true`
    );
    return rows.map(rowToAggregate);
  }

  async findBySubscriber(kind, ref) {
    const { rows } = await this._pool.query(
      `SELECT ${ROW_COLS} FROM subscriptions
        WHERE subscriber_kind = $1 AND subscriber_ref = $2`,
      [kind, ref]
    );
    return rows.map(rowToAggregate);
  }

  async delete(id) {
    await this._pool.query('DELETE FROM subscriptions WHERE id = $1', [id]);
  }
}
