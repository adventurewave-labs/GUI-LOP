import { ForbiddenError } from '../../../../shared-kernel/domain/errors.js';
import { TemplateNotFoundError } from '../../domain/errors.js';
import { Workflow } from '../../domain/workflow/workflow.js';

export class CreateWorkflowUseCase {
  constructor({ templates, workflows, clock, idGen, authorisation, idempotency }) {
    this._templates = templates;
    this._workflows = workflows;
    this._clock = clock;
    this._idGen = idGen;
    this._authorisation = authorisation;
    this._idempotency = idempotency;
  }

  async execute(input) {
    if (this._authorisation) {
      const decision = await this._authorisation.authorise({
        actor: input.actor,
        action: 'workflow:create',
      });
      if (!decision.allowed) throw new ForbiddenError(decision.reason ?? 'forbidden');
    }

    if (input.idempotencyKey && this._idempotency) {
      const existing = await this._idempotency.get({
        actor: input.actor.id,
        route: 'create_workflow',
        key: input.idempotencyKey,
      });
      if (existing) return existing.response;
    }

    const template = input.templateVersion
      ? await this._templates.findVersion(input.templateKey, input.templateVersion)
      : await this._templates.findCurrent(input.templateKey);
    if (!template) throw new TemplateNotFoundError(input.templateKey, input.templateVersion);

    const id = this._idGen.next();
    const wf = Workflow.createFromTemplate({
      id,
      template,
      context: input.context ?? {},
      createdBy: input.actor?.id ?? null,
      now: this._clock.now(),
      stepIdGen: { next: () => this._idGen.next() },
      actor: input.actor,
      correlationId: input.correlationId,
    });
    await this._workflows.save(wf);

    const response = {
      workflowId: wf.id,
      status: wf.status,
      templateKey: wf.templateKey,
      templateVersion: wf.templateVersion,
    };
    if (input.idempotencyKey && this._idempotency) {
      await this._idempotency.put(
        { actor: input.actor.id, route: 'create_workflow', key: input.idempotencyKey },
        { bodyHash: hash(input), response },
      );
    }
    return response;
  }
}

function hash(input) {
  return JSON.stringify({
    templateKey: input.templateKey,
    templateVersion: input.templateVersion ?? null,
    context: input.context ?? null,
  });
}
