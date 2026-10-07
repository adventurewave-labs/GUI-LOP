/**
 * Seed: default workflow templates.
 *
 * Mirrors the three templates that the legacy `simple-server.js`
 * exposes (`data-analysis`, `decision-making`, `content-creation`)
 * and adds richer step kinds so the new engine can run them.
 *
 * Usage:
 *   import { seedDefaultTemplates } from './workflow-templates.js';
 *   await seedDefaultTemplates(pgPool);
 *
 * Or, using the in-memory repository in tests:
 *   await seedDefaultTemplates(repo, { mode: 'repository' });
 */

export const DEFAULT_TEMPLATES = Object.freeze([
  {
    template_key: 'data-analysis',
    name: 'Data Analysis Workflow',
    description: 'Analyze data and generate insights with human approval',
    default_config: { category: 'analytics', complexity: 'intermediate' },
    steps: [
      { name: 'Data Ingestion', kind: 'automated' },
      { name: 'Analysis', kind: 'automated' },
      { name: 'Insight Generation', kind: 'automated' },
      { name: 'Human Review', kind: 'human', uiSpec: { form: 'review' } },
      { name: 'Final Report', kind: 'automated' },
    ],
  },
  {
    template_key: 'decision-making',
    name: 'Decision Making Workflow',
    description: 'Generate options and collect human input for decisions',
    default_config: { category: 'decision', complexity: 'advanced' },
    steps: [
      { name: 'Context Analysis', kind: 'automated' },
      { name: 'Option Generation', kind: 'automated' },
      { name: 'Human Selection', kind: 'human', uiSpec: { form: 'choose-option' } },
      { name: 'Reasoning', kind: 'automated' },
      { name: 'Confidence Assessment', kind: 'automated' },
    ],
  },
  {
    template_key: 'content-creation',
    name: 'Content Creation Workflow',
    description: 'Create content with human review and revision',
    default_config: { category: 'content', complexity: 'intermediate' },
    steps: [
      { name: 'Requirements', kind: 'automated' },
      { name: 'Content Generation', kind: 'automated' },
      { name: 'Human Review', kind: 'human', uiSpec: { form: 'review' } },
      { name: 'Revision', kind: 'automated' },
      { name: 'Finalization', kind: 'automated' },
    ],
  },
]);

/**
 * Seed the default templates.
 *
 * @param {object} target Either a pg-style pool (with `.query`) or a
 *                        WorkflowTemplateRepository (with `.save`).
 * @param {{ mode?: 'pg'|'repository', clock?: { now(): Date }, onConflict?: 'update'|'keep' }} [options]
 *   `onConflict: 'keep'` (used at boot) only inserts missing templates and
 *   never overwrites one an operator has edited; `'update'` (default, the
 *   explicit `db:seed`) resets them to the shipped definition.
 */
export async function seedDefaultTemplates(target, options = {}) {
  const mode = options.mode ?? (typeof target?.save === 'function' ? 'repository' : 'pg');
  const now = (options.clock?.now?.() ?? new Date()).toISOString();

  if (mode === 'pg') {
    for (const tmpl of DEFAULT_TEMPLATES) {
      const config = { ...(tmpl.default_config ?? {}), __version: 1, __status: 'published' };
      await target.query(
        `INSERT INTO workflow_templates
            (template_key, name, description, steps, default_config, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, TRUE, $6, $6)
         ${options.onConflict === 'keep' ? 'ON CONFLICT (template_key) DO NOTHING' : `ON CONFLICT (template_key) DO UPDATE
           SET name = EXCLUDED.name,
               description = EXCLUDED.description,
               steps = EXCLUDED.steps,
               default_config = EXCLUDED.default_config,
               updated_at = EXCLUDED.updated_at`}`,
        [
          tmpl.template_key,
          tmpl.name,
          tmpl.description,
          JSON.stringify(tmpl.steps),
          JSON.stringify(config),
          now,
        ],
      );
    }
    return DEFAULT_TEMPLATES.map((t) => t.template_key);
  }

  // repository mode: build aggregate, publish, save.
  const { WorkflowTemplate } = await import('../../src/backend/contexts/workflow-orchestration/domain/template/workflow-template.js');
  const { StepDefinition } = await import('../../src/backend/contexts/workflow-orchestration/domain/template/step-definition.js');
  const nowDate = options.clock?.now?.() ?? new Date();
  for (const tmpl of DEFAULT_TEMPLATES) {
    if (options.onConflict === 'keep' && typeof target.findCurrent === 'function') {
      // Boot-time seeding: an existing template (possibly edited, published
      // at a later version, or deprecated by an operator) is left untouched.
      const existing = await target.findCurrent(tmpl.template_key).catch(() => null);
      if (existing) continue;
    }
    const t = WorkflowTemplate.draft({
      key: tmpl.template_key,
      version: 1,
      name: tmpl.name,
      description: tmpl.description,
      defaultConfig: tmpl.default_config,
      now: nowDate,
    });
    for (const step of tmpl.steps) {
      t.addStep(new StepDefinition(step), nowDate);
    }
    t.publish({ now: nowDate });
    await target.save(t);
  }
  return DEFAULT_TEMPLATES.map((t) => t.template_key);
}
