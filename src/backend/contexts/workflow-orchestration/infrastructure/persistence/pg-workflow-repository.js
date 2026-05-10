import { WorkflowConflictError } from '../../domain/errors.js';
import { Workflow } from '../../domain/workflow/workflow.js';

/**
 * Postgres-backed `WorkflowRepository`.
 *
 * Uses optimistic concurrency on the `version` column added by
 * migration `004_workflow_versioning.sql`.
 */
export class PgWorkflowRepository {
  constructor({ pool, outbox }) {
    this._pool = pool;
    this._outbox = outbox;
  }

  async findById(id) {
    const { rows: wfRows } = await this._pool.query(
      `SELECT id, template_id, template_key, status, context, config, ui_url,
              ui_components, created_by, created_at, started_at,
              completed_at, updated_at, metadata, version
       FROM workflows WHERE id = $1`,
      [id],
    );
    if (wfRows.length === 0) return null;
    const row = wfRows[0];

    const { rows: stepRows } = await this._pool.query(
      `SELECT id, step_name, step_order, status, input_data, output_data,
              error_message, started_at, completed_at, metadata
       FROM workflow_steps
       WHERE workflow_id = $1
       ORDER BY step_order ASC`,
      [id],
    );

    const meta = row.metadata ?? {};
    const steps = stepRows.map((s) => ({
      id: s.id,
      name: s.step_name,
      kind: (s.metadata?.kind) ?? 'automated',
      order: s.step_order,
      status: s.status,
      inputData: s.input_data,
      outputData: s.output_data,
      uiSpec: s.metadata?.ui_spec ?? null,
      error: s.error_message,
      startedAt: s.started_at,
      completedAt: s.completed_at,
      deadline: s.metadata?.deadline ?? null,
      onTimeout: s.metadata?.on_timeout ?? 'fail',
    }));

    return Workflow.rehydrate({
      id: row.id,
      templateKey: row.template_key,
      templateVersion: meta.template_version ?? 1,
      context: row.context ?? {},
      status: row.status,
      steps,
      transitions: meta.transitions ?? [],
      createdBy: row.created_by,
      createdAt: row.created_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      failureReason: meta.failure_reason ?? null,
      cancellation: meta.cancellation ?? null,
      version: row.version ?? 0,
    });
  }

  async save(workflow) {
    const client = await this._pool.connect();
    try {
      await client.query('BEGIN');
      const expectedVersion = workflow.version;
      const meta = {
        template_version: workflow.templateVersion,
        transitions: workflow.transitions.map((t) => t.toJSON()),
        failure_reason: workflow.failureReason,
        cancellation: workflow.cancellation,
      };
      const { rowCount: insertCount } = await client.query(
        `INSERT INTO workflows
           (id, template_key, status, context, created_by,
            created_at, started_at, completed_at, metadata, version)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9::jsonb, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          workflow.id,
          workflow.templateKey,
          workflow.status,
          JSON.stringify(workflow.context.toJSON()),
          workflow.createdBy,
          workflow.createdAt,
          workflow.startedAt,
          workflow.completedAt,
          JSON.stringify(meta),
          expectedVersion + 1,
        ],
      );

      if (insertCount === 0) {
        const { rowCount } = await client.query(
          `UPDATE workflows
           SET status = $2,
               context = $3::jsonb,
               started_at = COALESCE(started_at, $4),
               completed_at = $5,
               metadata = $6::jsonb,
               version = version + 1,
               updated_at = NOW()
           WHERE id = $1 AND version = $7`,
          [
            workflow.id,
            workflow.status,
            JSON.stringify(workflow.context.toJSON()),
            workflow.startedAt,
            workflow.completedAt,
            JSON.stringify(meta),
            expectedVersion,
          ],
        );
        if (rowCount !== 1) {
          await client.query('ROLLBACK');
          const { rows } = await this._pool.query(
            'SELECT version FROM workflows WHERE id = $1',
            [workflow.id],
          );
          throw new WorkflowConflictError(workflow.id, expectedVersion, rows[0]?.version ?? -1);
        }
      }

      await client.query('DELETE FROM workflow_steps WHERE workflow_id = $1', [workflow.id]);
      for (const step of workflow.steps) {
        const stepMeta = {
          kind: step.kind,
          ui_spec: step.uiSpec,
          deadline: step.deadline,
          on_timeout: step.onTimeout,
        };
        await client.query(
          `INSERT INTO workflow_steps
             (id, workflow_id, step_name, step_order, status, input_data,
              output_data, error_message, started_at, completed_at, metadata)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11::jsonb)`,
          [
            step.id,
            workflow.id,
            step.name,
            step.order,
            step.status,
            JSON.stringify(step.inputData ?? {}),
            JSON.stringify(step.outputData ?? {}),
            step.error,
            step.startedAt,
            step.completedAt,
            JSON.stringify(stepMeta),
          ],
        );
      }

      const events = workflow.pullEvents();
      if (this._outbox && events.length) await this._outbox.enqueue(events, client);

      workflow._bumpVersion();
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
      throw err;
    } finally {
      client.release();
    }
  }

  async status(id) {
    const { rows } = await this._pool.query(
      'SELECT status, version FROM workflows WHERE id = $1',
      [id],
    );
    return rows[0] ?? null;
  }
}
