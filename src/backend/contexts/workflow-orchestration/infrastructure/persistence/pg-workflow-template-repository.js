import { WorkflowTemplate } from '../../domain/template/workflow-template.js';

/**
 * Postgres-backed `WorkflowTemplateRepository`.
 *
 * Maps the aggregate's version into the `default_config.__version`
 * JSON field for now (existing schema lacks a dedicated `version`
 * column for `workflow_templates`). A follow-up migration can lift
 * that into a real column.
 */
export class PgWorkflowTemplateRepository {
  constructor({ pool, outbox }) {
    this._pool = pool;
    this._outbox = outbox;
  }

  async findCurrent(key) {
    const { rows } = await this._pool.query(
      `SELECT id, name, description, template_key, steps, default_config,
              is_active, created_at, updated_at, created_by
       FROM workflow_templates
       WHERE template_key = $1 AND is_active = TRUE
       ORDER BY (default_config->>'__version')::int DESC NULLS LAST,
                created_at DESC
       LIMIT 1`,
      [key],
    );
    return rows[0] ? rowToTemplate(rows[0]) : null;
  }

  async findVersion(key, version) {
    const { rows } = await this._pool.query(
      `SELECT id, name, description, template_key, steps, default_config,
              is_active, created_at, updated_at, created_by
       FROM workflow_templates
       WHERE template_key = $1
         AND (default_config->>'__version')::int = $2
       LIMIT 1`,
      [key, version],
    );
    return rows[0] ? rowToTemplate(rows[0]) : null;
  }

  async save(template) {
    const config = {
      ...(template.defaultConfig ?? {}),
      __version: template.version.value,
      __status: template.status,
    };
    const stepsJson = JSON.stringify(template.steps.map((s) => s.toJSON()));
    await this._pool.query(
      `INSERT INTO workflow_templates
        (template_key, name, description, steps, default_config, is_active, created_by)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
       ON CONFLICT (template_key) DO UPDATE
         SET name = EXCLUDED.name,
             description = EXCLUDED.description,
             steps = EXCLUDED.steps,
             default_config = EXCLUDED.default_config,
             is_active = EXCLUDED.is_active,
             updated_at = NOW()`,
      [
        template.key.value,
        template.name,
        template.description,
        stepsJson,
        JSON.stringify(config),
        !template.isDeprecated(),
        template.createdBy,
      ],
    );
    if (this._outbox) {
      const events = template.pullEvents();
      if (events.length) await this._outbox.enqueue(events);
    } else {
      template.pullEvents();
    }
  }

  async list(filter = {}) {
    const { rows } = await this._pool.query(
      `SELECT id, name, description, template_key, steps, default_config,
              is_active, created_at, updated_at, created_by
       FROM workflow_templates
       ${filter.activeOnly ? 'WHERE is_active = TRUE' : ''}
       ORDER BY template_key`,
    );
    return rows.map(rowToTemplate);
  }
}

function rowToTemplate(row) {
  const cfg = row.default_config ?? {};
  const version = Number(cfg.__version ?? 1);
  const status = cfg.__status ?? (row.is_active ? 'published' : 'deprecated');
  const steps = Array.isArray(row.steps)
    ? row.steps
    : (row.steps ? JSON.parse(row.steps) : []);
  return WorkflowTemplate.rehydrate({
    key: row.template_key,
    version,
    name: row.name,
    description: row.description ?? '',
    steps,
    defaultConfig: stripInternals(cfg),
    status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: status === 'published' ? row.updated_at : null,
    deprecatedAt: status === 'deprecated' ? row.updated_at : null,
    createdBy: row.created_by,
  });
}

function stripInternals(cfg) {
  const { __version, __status, ...rest } = cfg ?? {};
  return rest;
}
