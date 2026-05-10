import { ForbiddenError } from '../../shared-kernel-stubs.js';
import { WorkflowTemplate } from '../../domain/template/workflow-template.js';
import { StepDefinition } from '../../domain/template/step-definition.js';
import { TemplateKey } from '../../domain/template/template-key.js';
import { TemplateVersion } from '../../domain/template/template-version.js';

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
    await this._templates.save(template);
    return {
      key: template.key.value,
      version: template.version.value,
      status: template.status,
    };
  }
}
