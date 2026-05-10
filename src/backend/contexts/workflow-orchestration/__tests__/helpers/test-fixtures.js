import { FixedClock, SequentialIdGenerator } from '../../shared-kernel-stubs.js';
import { StepDefinition } from '../../domain/template/step-definition.js';
import { WorkflowTemplate } from '../../domain/template/workflow-template.js';
import { Workflow } from '../../domain/workflow/workflow.js';

/** Build a deterministic clock fixed to 2026-01-01T00:00:00Z. */
export function makeClock(iso = '2026-01-01T00:00:00.000Z') {
  return new FixedClock(new Date(iso));
}

/** Build a deterministic id generator. */
export function makeIds(prefix = 'tst') {
  return new SequentialIdGenerator(prefix);
}

/** A small published template with one automated step. */
export function singleAutomatedTemplate(now) {
  const t = WorkflowTemplate.draft({ key: 'auto-only', version: 1, name: 'Auto Only', now });
  t.addStep(new StepDefinition({ name: 'Echo', kind: 'automated' }), now);
  t.publish({ now });
  return t;
}

/** A two-step template: automated, then human. */
export function autoThenHumanTemplate(now) {
  const t = WorkflowTemplate.draft({ key: 'auto-then-human', version: 1, name: 'Auto then Human', now });
  t.addStep(new StepDefinition({ name: 'Compute', kind: 'automated' }), now);
  t.addStep(new StepDefinition({
    name: 'Approve',
    kind: 'human',
    uiSpec: { form: 'approve' },
  }), now);
  t.publish({ now });
  return t;
}

/** Convenience: build a brand-new workflow from a template. */
export function makeWorkflow(template, now, ids) {
  return Workflow.createFromTemplate({
    id: ids.next(),
    template,
    now,
    stepIdGen: { next: () => ids.next() },
    actor: { id: 'user-1' },
  });
}
