import { WorkflowNotFoundError } from '../../domain/errors.js';

export class GetWorkflowDetailQuery {
  constructor({ workflows }) {
    this._workflows = workflows;
  }

  async execute(input) {
    const wf = await this._workflows.findById(input.workflowId);
    if (!wf) throw new WorkflowNotFoundError(input.workflowId);

    const steps = wf.steps.map((s) => s.toJSON());
    const completed = steps.filter((s) => s.status === 'completed').length;
    const humanInteractions = wf.transitions.filter(
      (t) => t.from === 'waiting_for_human' || t.to === 'waiting_for_human',
    ).length;

    return {
      id: wf.id,
      template_key: wf.templateKey,
      template_version: wf.templateVersion,
      status: wf.status,
      context: wf.context.toJSON(),
      steps,
      transitions: wf.transitions.map((t) => t.toJSON()),
      created_by: wf.createdBy,
      created_at: wf.createdAt?.toISOString?.() ?? wf.createdAt,
      started_at: wf.startedAt?.toISOString?.() ?? wf.startedAt,
      completed_at: wf.completedAt?.toISOString?.() ?? wf.completedAt,
      version: wf.version,
      metrics: {
        total_steps: steps.length,
        completed_steps: completed,
        human_interactions: humanInteractions,
      },
    };
  }
}
