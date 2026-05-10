import { ForbiddenError } from '../../shared-kernel-stubs.js';
import { TemplateNotFoundError } from '../../domain/errors.js';

export class DeprecateWorkflowTemplateUseCase {
  constructor({ templates, clock, authorisation }) {
    this._templates = templates;
    this._clock = clock;
    this._authorisation = authorisation;
  }

  async execute(input) {
    if (this._authorisation) {
      const decision = await this._authorisation.authorise({
        actor: input.actor,
        action: 'workflow_template:deprecate',
      });
      if (!decision.allowed) {
        throw new ForbiddenError(decision.reason ?? 'forbidden');
      }
    }
    const template = await this._templates.findVersion(input.key, input.version);
    if (!template) throw new TemplateNotFoundError(input.key, input.version);
    template.deprecate({
      now: this._clock.now(),
      actor: input.actor,
      correlationId: input.correlationId,
    });
    await this._templates.save(template);
    return {
      key: template.key.value,
      version: template.version.value,
      status: template.status,
    };
  }
}
