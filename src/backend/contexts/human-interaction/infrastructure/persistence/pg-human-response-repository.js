/**
 * Postgres adapter for HumanResponseRepository.
 *
 * Maps the `human_responses` table (see `database/schemas/01_main_schema.sql`)
 * to the HumanResponse aggregate. The table predates this context's
 * idempotency requirement, so the adapter looks for the idempotency key in
 * the `metadata` JSONB column.
 *
 * To enforce dedupe at the database level, deployers should add:
 *
 *   CREATE UNIQUE INDEX idx_human_responses_idempotency
 *     ON human_responses (workflow_id, step_id, (metadata->>'idempotency_key'))
 *     WHERE metadata->>'idempotency_key' IS NOT NULL;
 */
import { HumanResponseRepository } from '../../application/ports/human-response-repository.js';
import { HumanResponse } from '../../domain/human-response/human-response.js';

export class PgHumanResponseRepository extends HumanResponseRepository {
  /**
   * @param {{ query: (text: string, params?: any[]) => Promise<{rows: any[]}> }} db
   */
  constructor(db) {
    super();
    this.db = db;
  }

  async findById(id) {
    const { rows } = await this.db.query(
      'SELECT * FROM human_responses WHERE id = $1 LIMIT 1',
      [id],
    );
    return rows[0] ? this._toAggregate(rows[0]) : null;
  }

  async findFor(workflowId, stepId) {
    const { rows } = await this.db.query(
      `SELECT * FROM human_responses
         WHERE workflow_id = $1 AND step_id = $2
         ORDER BY created_at ASC
         LIMIT 1`,
      [workflowId, stepId],
    );
    return rows[0] ? this._toAggregate(rows[0]) : null;
  }

  async findByIdempotencyKey(workflowId, stepId, idempotencyKey) {
    const { rows } = await this.db.query(
      `SELECT * FROM human_responses
         WHERE workflow_id = $1
           AND step_id = $2
           AND metadata->>'idempotency_key' = $3
         LIMIT 1`,
      [workflowId, stepId, idempotencyKey],
    );
    return rows[0] ? this._toAggregate(rows[0]) : null;
  }

  async save(response, uow) {
    const state = response.toState();
    const client = (uow && uow.client) ? uow.client : this.db;
    const metadata = {
      idempotency_key: state.idempotencyKey,
      rationale: state.rationale,
    };
    await client.query(
      `INSERT INTO human_responses
         (id, workflow_id, step_id, user_id, action, response_data, confidence_score, reasoning, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        state.id,
        state.workflowId,
        state.stepId,
        state.responder,
        state.action,
        JSON.stringify(state.payload),
        state.confidence,
        state.rationale,
        JSON.stringify(metadata),
        state.recordedAt,
      ],
    );
  }

  _toAggregate(row) {
    const metadata = row.metadata ?? {};
    return HumanResponse.rehydrate({
      id: row.id,
      workflowId: row.workflow_id,
      stepId: row.step_id,
      responder: row.user_id,
      action: row.action,
      payload: row.response_data ?? {},
      rationale: row.reasoning ?? metadata.rationale ?? null,
      confidence: row.confidence_score === null ? null : Number(row.confidence_score),
      idempotencyKey: metadata.idempotency_key ?? row.idempotency_key ?? null,
      recordedAt: row.created_at,
    });
  }
}
