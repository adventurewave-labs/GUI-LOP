/**
 * Postgres adapter for PendingStepRepository (table: pending_steps).
 *
 * See `database/migrations/005_pending_steps.sql` for schema.
 */
import { PendingStepRepository } from '../../application/ports/pending-step-repository.js';
import { PendingStep } from '../../domain/pending-step/pending-step.js';

export class PgPendingStepRepository extends PendingStepRepository {
  constructor(db) {
    super();
    this.db = db;
  }

  async findOverdue(now, limit = 50) {
    const { rows } = await this.db.query(
      `SELECT * FROM pending_steps
         WHERE closed_at IS NULL
           AND deadline IS NOT NULL
           AND deadline <= $1
         ORDER BY deadline ASC
         LIMIT $2`,
      [now, limit],
    );
    return rows.map((r) => this._toAggregate(r));
  }

  async findByKey(workflowId, stepId) {
    const { rows } = await this.db.query(
      `SELECT * FROM pending_steps WHERE workflow_id = $1 AND step_id = $2 LIMIT 1`,
      [workflowId, stepId],
    );
    return rows[0] ? this._toAggregate(rows[0]) : null;
  }

  async upsert(step, uow) {
    const state = step.toState();
    const client = (uow && uow.client) ? uow.client : this.db;
    await client.query(
      `INSERT INTO pending_steps
         (workflow_id, step_id, ui_document_id, eligibility, deadline, on_timeout,
          escalation_level, opened_at, closed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (workflow_id, step_id) DO UPDATE SET
           ui_document_id = EXCLUDED.ui_document_id,
           eligibility = EXCLUDED.eligibility,
           deadline = EXCLUDED.deadline,
           on_timeout = EXCLUDED.on_timeout,
           escalation_level = EXCLUDED.escalation_level,
           closed_at = EXCLUDED.closed_at`,
      [
        state.workflowId,
        state.stepId,
        state.uiDocumentId,
        JSON.stringify(state.eligibility),
        state.deadline,
        state.onTimeout,
        state.escalationLevel,
        state.openedAt,
        state.closedAt,
      ],
    );
  }

  async remove(workflowId, stepId, uow) {
    const client = (uow && uow.client) ? uow.client : this.db;
    await client.query(
      `DELETE FROM pending_steps WHERE workflow_id = $1 AND step_id = $2`,
      [workflowId, stepId],
    );
  }

  async list(filter = {}) {
    const where = [];
    const params = [];
    if (filter.workflowId) {
      params.push(filter.workflowId);
      where.push(`workflow_id = $${params.length}`);
    }
    if (filter.openOnly) {
      where.push('closed_at IS NULL');
    }
    const sql = `SELECT * FROM pending_steps${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
    const { rows } = await this.db.query(sql, params);
    return rows.map((r) => this._toAggregate(r));
  }

  _toAggregate(row) {
    return PendingStep.rehydrate({
      workflowId: row.workflow_id,
      stepId: row.step_id,
      uiDocumentId: row.ui_document_id,
      eligibility: row.eligibility ?? {},
      deadline: row.deadline,
      onTimeout: row.on_timeout,
      escalationLevel: row.escalation_level,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
    });
  }
}
