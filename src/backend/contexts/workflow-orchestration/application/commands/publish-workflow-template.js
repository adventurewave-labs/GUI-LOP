// @ts-check
import { ForbiddenError } from '../../../../shared-kernel/domain/errors.js';
import { WorkflowTemplate } from '../../domain/template/workflow-template.js';
import { StepDefinition } from '../../domain/template/step-definition.js';
import { TemplateKey } from '../../domain/template/template-key.js';
import { TemplateVersion } from '../../domain/template/template-version.js';
import { TemplateVersionExistsError } from '../../domain/errors.js';

/** Content that defines a template version (what "the same publish" means). */
const fingerprint = (t) => JSON.stringify({
  name: t.name,
  description: t.description ?? '',
  steps: t.steps.map((s) => (typeof s.toJSON === 'function' ? s.toJSON() : s)),
  defaultConfig: t.defaultConfig ?? {},
});

export class PublishWorkflowTemplateUseCase {
  constructor({ templates, clock, authorisation }) {
    this._templates = templates;
    this._clock = clock;
    this._authorisation = authorisation;
  }

  async execute(input) {
    if (this._authorisation) {
      const decision = await this._authorisation.authorise({
        actor: input.actor,
        action: 'workflow_template:publish',
      });
      if (!decision.allowed) {
        throw new ForbiddenError(decision.reason ?? 'forbidden');
      }
    }

    const key = TemplateKey.of(input.key);
    const existing = await this._templates.findCurrent(key.value);
    const version = TemplateVersion.of(
      input.version ?? (existing ? existing.version.value + 1 : 1),
    );

    const now = this._clock.now();
    const template = WorkflowTemplate.draft({
      key,
      version,
      name: input.name,
      description: input.description ?? '',
      defaultConfig: input.defaultConfig ?? {},
      createdBy: input.actor?.id ?? null,
      now,
    });
    for (const step of input.steps ?? []) {
      template.addStep(step instanceof StepDefinition ? step : new StepDefinition(step), now);
    }
    template.publish({ now, actor: input.actor, correlationId: input.correlationId });

    // Published versions are immutable. This used to upsert, so publishing an
    // existing (key, version) silently replaced it, and two admins publishing
    // "the next version" at the same time both wrote version N+1 — last
    // writer won. Now: identical content is an idempotent no-op, different
    // content is a 409, and the write itself is create-only (the race loser
    // gets the same 409 from the repository).
    const clash = await this._templates.findVersion(key.value, version.value);
    if (clash) {
      if (fingerprint(clash) !== fingerprint(template)) throw new TemplateVersionExistsError(key.value, version.value);
      return { key: clash.key.value, version: clash.version.value, status: clash.status };
    }
    await this._templates.save(template, { createOnly: true });
    return {
      key: template.key.value,
      version: template.version.value,
      status: template.status,
    };
  }
}
