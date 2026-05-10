import { WorkflowTemplate } from '../../domain/template/workflow-template.js';

/**
 * Postgres-backed `WorkflowTemplateRepository`.
 *
 * Identity is `(template_key, version)` — promoted to a real `version`
 * INT column by migration `010_workflow_templates_version.sql`. The
 * legacy `default_config.__version` JSONB back-channel is kept as a
 * one-release fallback: if the column is missing (older DB), the repo
 * logs a one-time warning and reads/writes through the legacy path so
 * deploys don't fail mid-migration.
 *
 * The `__version` and `__status` JSONB keys are no longer written when
 * the column path is available; on read we still strip them in case a
 * legacy row survives.
 */
export class PgWorkflowTemplateRepository {
  /**
   * @param {object} opts
   * @param {{query: Function}} opts.pool
   * @param {object} [opts.outbox]
   * @param {{warn: Function}} [opts.logger]
   */
  constructor({ pool, outbox, logger }) {
    this._pool = pool;
    this._outbox = outbox;
    this._logger = logger ?? null;
    /** @type {boolean|null} `null` until probed once. */
    this._hasVersionColumn = null;
    this._warnedMissingColumn = false;
  }

  async _versionColumnExists() {
    if (this._hasVersionColumn !== null) return this._hasVersionColumn;
    try {
      const { rows } = await this._pool.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_name = 'workflow_templates' AND column_name = 'version'
         LIMIT 1`,
      );
      this._hasVersionColumn = rows.length > 0;
    } catch {
      this._hasVersionColumn = false;
    }
    if (!this._hasVersionColumn && !this._warnedMissingColumn) {
      this._warnedMissingColumn = true;
      this._logger?.warn?.(
        'workflow_templates.version column missing; falling back to default_config.__version. ' +
          'Apply database/migrations/010_workflow_templates_version.sql to upgrade.',
      );
    }
    return this._hasVersionColumn;
  }

  async findCurrent(key) {
    const hasColumn = await this._versionColumnExists();
    const sql = hasColumn
      ? `SELECT id, name, description, template_key, steps, default_config,
                is_active, created_at, updated_at, created_by, version
         FROM workflow_templates
         WHERE template_key = $1 AND is_active = TRUE
         ORDER BY version DESC, created_at DESC
         LIMIT 1`
      : `SELECT id, name, description, template_key, steps, default_config,
                is_active, created_at, updated_at, created_by
         FROM workflow_templates
         WHERE template_key = $1 AND is_active = TRUE
         ORDER BY (default_config->>'__version')::int DESC NULLS LAST,
                  created_at DESC
         LIMIT 1`;
    const { rows } = await this._pool.query(sql, [key]);
    return rows[0] ? rowToTemplate(rows[0]) : null;
  }

  async findVersion(key, version) {
    const hasColumn = await this._versionColumnExists();
    const sql = hasColumn
      ? `SELECT id, name, description, template_key, steps, default_config,
                is_active, created_at, updated_at, created_by, version
         FROM workflow_templates
         WHERE template_key = $1 AND version = $2
         LIMIT 1`
      : `SELECT id, name, description, template_key, steps, default_config,
                is_active, created_at, updated_at, created_by
         FROM workflow_templates
         WHERE template_key = $1
           AND (default_config->>'__version')::int = $2
         LIMIT 1`;
    const { rows } = await this._pool.query(sql, [key, version]);
    return rows[0] ? rowToTemplate(rows[0]) : null;
  }

  async save(template) {
    const hasColumn = await this._versionColumnExists();
    const stepsJson = JSON.stringify(template.steps.map((s) => s.toJSON()));
    if (hasColumn) {
      const config = { ...(template.defaultConfig ?? {}) };
      // Insert-or-update on the (template_key, version) identity. is_active
      // mirrors the aggregate's `isDeprecated()` flag.
      await this._pool.query(
        `INSERT INTO workflow_templates
          (template_key, version, name, description, steps, default_config,
           is_active, created_by)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)
         ON CONFLICT (template_key, version) DO UPDATE
           SET name = EXCLUDED.name,
               description = EXCLUDED.description,
               steps = EXCLUDED.steps,
               default_config = EXCLUDED.default_config,
               is_active = EXCLUDED.is_active,
               updated_at = NOW()`,
        [
          template.key.value,
          template.version.value,
          template.name,
          template.description,
          stepsJson,
          JSON.stringify(config),
          !template.isDeprecated(),
          template.createdBy,
        ],
      );
    } else {
      // Legacy fallback: pre-migration schema with `template_key` UNIQUE
      // and version smuggled through default_config.__version.
      const config = {
        ...(template.defaultConfig ?? {}),
        __version: template.version.value,
        __status: template.status,
      };
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
    }
    if (this._outbox) {
      const events = template.pullEvents();
      if (events.length) await this._outbox.enqueue(events);
    } else {
      template.pullEvents();
    }
  }

  async list(filter = {}) {
    const hasColumn = await this._versionColumnExists();
    const sql = hasColumn
      ? `SELECT id, name, description, template_key, steps, default_config,
                is_active, created_at, updated_at, created_by, version
         FROM workflow_templates
         ${filter.activeOnly ? 'WHERE is_active = TRUE' : ''}
         ORDER BY template_key, version DESC`
      : `SELECT id, name, description, template_key, steps, default_config,
                is_active, created_at, updated_at, created_by
         FROM workflow_templates
         ${filter.activeOnly ? 'WHERE is_active = TRUE' : ''}
         ORDER BY template_key`;
    const { rows } = await this._pool.query(sql);
    return rows.map(rowToTemplate);
  }
}

function rowToTemplate(row) {
  const cfg = row.default_config ?? {};
  // Prefer the real column when present, otherwise read from JSONB so
  // legacy rows (pre-010) keep working through the transition.
  const version = Number(row.version ?? cfg.__version ?? 1);
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
