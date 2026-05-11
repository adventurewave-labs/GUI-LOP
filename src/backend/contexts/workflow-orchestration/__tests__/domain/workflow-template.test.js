import { StepDefinition } from '../../domain/template/step-definition.js';
import { TEMPLATE_STATUS, WorkflowTemplate } from '../../domain/template/workflow-template.js';
import { TemplateImmutableError, InvalidStateTransitionError } from '../../domain/errors.js';
import { makeClock } from '../helpers/test-fixtures.js';

describe('WorkflowTemplate', () => {
  const clock = makeClock();
  const now = clock.now();

  it('builds a draft, accepts steps, validates and publishes', () => {
    const t = WorkflowTemplate.draft({ key: 'demo', version: 1, name: 'Demo', now });
    expect(t.status).toBe(TEMPLATE_STATUS.DRAFT);
    t.addStep(new StepDefinition({ name: 'A', kind: 'automated' }), now);
    t.addStep(new StepDefinition({ name: 'B', kind: 'human', uiSpec: { f: [] } }), now);
    expect(t.validateStructure()).toBe(true);
    const events = t.publish({ now });
    expect(t.status).toBe(TEMPLATE_STATUS.PUBLISHED);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('workflow_orchestration.template.published');
  });

  it('rejects duplicate step names', () => {
    const t = WorkflowTemplate.draft({ key: 'demo', name: 'Demo', now });
    t.addStep({ name: 'A', kind: 'automated' }, now);
    expect(() => t.addStep({ name: 'A', kind: 'automated' }, now)).toThrow(/Duplicate step/);
  });

  it('refuses to publish empty templates', () => {
    const t = WorkflowTemplate.draft({ key: 'empty', name: 'Empty', now });
    expect(() => t.publish({ now })).toThrow(/at least one step/);
  });

  it('is immutable after publish', () => {
    const t = WorkflowTemplate.draft({ key: 'kk', name: 'kk', now });
    t.addStep({ name: 'A', kind: 'automated' }, now);
    t.publish({ now });
    expect(() => t.addStep({ name: 'B', kind: 'automated' }, now))
      .toThrow(TemplateImmutableError);
  });

  it('publish is idempotent (no event on republish)', () => {
    const t = WorkflowTemplate.draft({ key: 'kk', name: 'kk', now });
    t.addStep({ name: 'A', kind: 'automated' }, now);
    t.publish({ now });
    t.pullEvents();
    const events = t.publish({ now });
    expect(events).toEqual([]);
  });

  it('deprecate transitions published -> deprecated', () => {
    const t = WorkflowTemplate.draft({ key: 'kk', name: 'kk', now });
    t.addStep({ name: 'A', kind: 'automated' }, now);
    t.publish({ now });
    t.pullEvents();
    const events = t.deprecate({ now });
    expect(t.status).toBe(TEMPLATE_STATUS.DEPRECATED);
    expect(events[0].eventType).toBe('workflow_orchestration.template.deprecated');
  });

  it('deprecate refuses drafts', () => {
    const t = WorkflowTemplate.draft({ key: 'kk', name: 'kk', now });
    t.addStep({ name: 'A', kind: 'automated' }, now);
    expect(() => t.deprecate({ now })).toThrow(InvalidStateTransitionError);
  });

  it('rehydrates from snapshot', () => {
    const t = WorkflowTemplate.draft({ key: 'kk', name: 'K', now });
    t.addStep({ name: 'A', kind: 'automated' }, now);
    t.publish({ now });
    t.pullEvents();
    const r = WorkflowTemplate.rehydrate({
      key: t.key.value,
      version: t.version.value,
      name: t.name,
      description: t.description,
      steps: t.steps.map((s) => s.toJSON()),
      defaultConfig: t.defaultConfig,
      status: t.status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      publishedAt: t.publishedAt,
    });
    expect(r.status).toBe('published');
    expect(r.steps).toHaveLength(1);
  });
});
