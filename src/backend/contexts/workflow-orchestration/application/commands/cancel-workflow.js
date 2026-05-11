import { ForbiddenError } from '../../../../shared-kernel/domain/errors.js';
import { WorkflowNotFoundError } from '../../domain/errors.js';

export class CancelWorkflowUseCase {
  constructor({ workflows, clock, authorisation }) {
    this._workflows = workflows;
    this._clock = clock;
    this._authorisation = authorisation;
  }

  async execute(input) {
    if (this._authorisation) {
      const decision = await this._authorisation.authorise({
        actor: input.actor,
        action: 'workflow:cancel',
        resource: { type: 'workflow', id: input.workflowId },
      });
      if (!decision.allowed) throw new ForbiddenError(decision.reason ?? 'forbidden');
    }
    const wf = await this._workflows.findById(input.workflowId);
    if (!wf) throw new WorkflowNotFoundError(input.workflowId);
    wf.cancel(input.actor?.id ?? 'system', input.reason ?? null, this._clock.now(), {
      actor: input.actor,
      correlationId: input.correlationId,
    });
    await this._workflows.save(wf);
    return {
      workflowId: wf.id,
      status: wf.status,
      reason: input.reason ?? null,
    };
  }
}
