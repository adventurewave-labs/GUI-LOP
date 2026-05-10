/**
 * Unit tests for the Pg-backed WorkflowTemplateRepository.
 *
 * Drives the repository against a fake `pool` so we can assert on the
 * exact SQL params written for both code paths:
 *   - "modern": migration 010 applied, real `version` column.
 *   - "legacy": pre-010 schema, version smuggled into default_config.
 */

import { PgWorkflowTemplateRepository } from '../../infrastructure/persistence/pg-workflow-template-repository.js';
import { WorkflowTemplate } from '../../domain/template/workflow-template.js';

function makeTemplate({ key = 'data-analysis', version = 1, status = 'published' } = {}) {
  return WorkflowTemplate.rehydrate({
    key,
    version,
    name: 'Data Analysis',
    description: 'desc',
    steps: [
      { id: 's1', name: 'collect', kind: 'automated', order: 1 },
    ],
    defaultConfig: { foo: 'bar' },
    status,
    createdAt: new Date('2026-05-10T00:00:00Z'),
    updatedAt: new Date('2026-05-10T00:00:00Z'),
    publishedAt: status === 'published' ? new Date('2026-05-10T00:00:00Z') : null,
    deprecatedAt: status === 'deprecated' ? new Date('2026-05-10T00:00:00Z') : null,
    createdBy: 'admin-1',
  });
}

function modernPool() {
  // Captures every call so tests can assert per-statement.
  const calls = [];
  const pool = {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      // Probe for column existence -> says yes.
      if (/information_schema\.columns/.test(sql)) {
        return { rows: [{ '?column?': 1 }] };
      }
      // SELECT shapes return zero rows by default; tests override.
      return { rows: [] };
    },
  };
  return pool;
}

function legacyPool() {
  const calls = [];
  const pool = {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/information_schema\.columns/.test(sql)) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  return pool;
}

describe('PgWorkflowTemplateRepository (modern schema)', () => {
  test('save() writes the real version column on the canonical conflict target', async () => {
    const pool = modernPool();
    const repo = new PgWorkflowTemplateRepository({ pool });
    const tmpl = makeTemplate({ version: 3 });

    await repo.save(tmpl);

    // First call probes the column; second is the INSERT.
    const insert = pool.calls.find((c) => /INSERT INTO workflow_templates/.test(c.sql));
    expect(insert).toBeDefined();
    expect(insert.sql).toMatch(/\(template_key, version, name/);
    expect(insert.sql).toMatch(/ON CONFLICT \(template_key, version\)/);
    // params: key, version, name, description, steps, default_config, is_active, created_by
    expect(insert.params[0]).toBe('data-analysis');
    expect(insert.params[1]).toBe(3);
    // default_config should NOT contain __version / __status anymore.
    const cfg = JSON.parse(insert.params[5]);
    expect(cfg).toEqual({ foo: 'bar' });
  });

  test('findCurrent() reads the real version column and rehydrates correctly', async () => {
    const pool = modernPool();
    pool.query = async (sql, _params) => {
      if (/information_schema\.columns/.test(sql)) return { rows: [{ ok: 1 }] };
      if (/SELECT id, name, description, template_key/.test(sql)) {
        return {
          rows: [{
            id: 'row-1',
            name: 'Data Analysis',
            description: 'desc',
            template_key: 'data-analysis',
            steps: [{ id: 's1', name: 'collect', kind: 'automated', order: 1 }],
            default_config: { foo: 'bar' },
            is_active: true,
            created_at: new Date('2026-05-10T00:00:00Z'),
            updated_at: new Date('2026-05-10T00:00:00Z'),
            created_by: 'admin-1',
            version: 7,
          }],
        };
      }
      return { rows: [] };
    };
    const repo = new PgWorkflowTemplateRepository({ pool });
    const t = await repo.findCurrent('data-analysis');
    expect(t).not.toBeNull();
    expect(t.version.value).toBe(7);
    expect(t.defaultConfig).toEqual({ foo: 'bar' });
  });

  test('round-trip: save then findVersion returns the same version', async () => {
    // Build a tiny in-memory store keyed by (template_key, version).
    const store = new Map();
    const pool = {
      async query(sql, params = []) {
        if (/information_schema\.columns/.test(sql)) return { rows: [{ ok: 1 }] };
        if (/^\s*INSERT INTO workflow_templates/.test(sql)) {
          const [key, version, name, description, stepsJson, cfgJson, isActive] = params;
          store.set(`${key}@${version}`, {
            id: 'row-1',
            template_key: key,
            version,
            name,
            description,
            steps: JSON.parse(stepsJson),
            default_config: JSON.parse(cfgJson),
            is_active: isActive,
            created_at: new Date('2026-05-10T00:00:00Z'),
            updated_at: new Date('2026-05-10T00:00:00Z'),
            created_by: 'admin-1',
          });
          return { rows: [] };
        }
        if (/WHERE template_key = \$1 AND version = \$2/.test(sql)) {
          const [key, version] = params;
          const row = store.get(`${key}@${version}`);
          return row ? { rows: [row] } : { rows: [] };
        }
        return { rows: [] };
      },
    };
    const repo = new PgWorkflowTemplateRepository({ pool });
    await repo.save(makeTemplate({ version: 4 }));
    const found = await repo.findVersion('data-analysis', 4);
    expect(found).not.toBeNull();
    expect(found.version.value).toBe(4);
  });
});

describe('PgWorkflowTemplateRepository (legacy schema)', () => {
  test('falls back to default_config.__version when column is absent and warns once', async () => {
    const pool = legacyPool();
    const warn = jest.fn();
    const repo = new PgWorkflowTemplateRepository({ pool, logger: { warn } });
    const tmpl = makeTemplate({ version: 2 });

    await repo.save(tmpl);
    await repo.save(makeTemplate({ version: 3 })); // second call — no second warning.

    // Insert SQL must use the old single-column ON CONFLICT (template_key).
    const insert = pool.calls.find((c) => /INSERT INTO workflow_templates/.test(c.sql));
    expect(insert.sql).toMatch(/ON CONFLICT \(template_key\) DO UPDATE/);
    const cfg = JSON.parse(insert.params[4]);
    expect(cfg.__version).toBe(2);
    expect(cfg.__status).toBe('published');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/version column missing/);
  });

  test('rehydrates legacy rows that only carry __version in default_config', async () => {
    const pool = {
      async query(sql) {
        if (/information_schema\.columns/.test(sql)) return { rows: [] };
        return {
          rows: [{
            id: 'row-1',
            name: 'Data Analysis',
            description: 'desc',
            template_key: 'data-analysis',
            steps: [{ id: 's1', name: 'collect', kind: 'automated', order: 1 }],
            default_config: { foo: 'bar', __version: 9, __status: 'published' },
            is_active: true,
            created_at: new Date('2026-05-10T00:00:00Z'),
            updated_at: new Date('2026-05-10T00:00:00Z'),
            created_by: 'admin-1',
          }],
        };
      },
    };
    const repo = new PgWorkflowTemplateRepository({ pool });
    const t = await repo.findCurrent('data-analysis');
    expect(t.version.value).toBe(9);
    expect(t.defaultConfig).toEqual({ foo: 'bar' });
  });
});
