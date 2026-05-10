import { RecordHumanResponse } from '../../application/commands/record-human-response.js';
import {
  IneligibleResponderError,
  StepNotPendingError,
  ResponseConflictError,
  InvalidResponseError,
} from '../../domain/errors.js';
import { HUMAN_RESPONSE_RECORDED } from '../../domain/events.js';
import { buildContext, seedPendingStep } from './helpers.js';

const step = {
  id: 'step-1',
  allowedActions: ['delegate'],
  responseSchema: {
    type: 'object',
    required: ['comment'],
    properties: { comment: { type: 'string' } },
    additionalProperties: false,
  },
};

const eligibleUser = {
  id: 'u-1',
  role: 'reviewer',
  permissions: ['workflow:respond'],
  scopes: ['wf-1'],
};

function makeUseCase(ctx) {
  return new RecordHumanResponse({
    responseRepository: ctx.responseRepository,
    pendingStepRepository: ctx.pendingStepRepository,
    workflowReader: ctx.workflowReader,
    userDirectory: ctx.userDirectory,
    authorisation: ctx.authorisation,
    workflowAdvancer: ctx.workflowAdvancer,
    eventPublisher: ctx.eventPublisher,
    unitOfWork: ctx.unitOfWork,
    clock: ctx.clock,
    ids: ctx.ids,
  });
}

describe('RecordHumanResponse use case', () => {
  const baseCommand = {
    workflowId: 'wf-1',
    stepId: 'step-1',
    action: 'approve',
    payload: { comment: 'lgtm' },
    actor: { userId: 'u-1' },
    idempotencyKey: 'k-1',
  };

  it('records a valid response, persists, publishes event, and advances the workflow', async () => {
    const ctx = buildContext({
      users: { 'u-1': eligibleUser },
      workflows: { 'wf-1': { id: 'wf-1', scope: 'wf-1', steps: [step] } },
    });
    await seedPendingStep(ctx.pendingStepRepository);
    const uc = makeUseCase(ctx);

    const { response, deduplicated } = await uc.execute(baseCommand);

    expect(deduplicated).toBe(false);
    expect(response.id).toBe('resp-1');
    expect(response.action.value).toBe('approve');
    expect(ctx.eventPublisher.events).toHaveLength(1);
    expect(ctx.eventPublisher.events[0].eventType).toBe(HUMAN_RESPONSE_RECORDED);
    expect(ctx.workflowAdvancer.calls).toEqual([
      expect.objectContaining({ workflowId: 'wf-1', stepId: 'step-1' }),
    ]);
    const closed = await ctx.pendingStepRepository.findByKey('wf-1', 'step-1');
    expect(closed.isClosed()).toBe(true);
  });

  it('returns the original response on duplicate idempotency key', async () => {
    const ctx = buildContext({
      users: { 'u-1': eligibleUser },
      workflows: { 'wf-1': { id: 'wf-1', scope: 'wf-1', steps: [step] } },
    });
    await seedPendingStep(ctx.pendingStepRepository);
    const uc = makeUseCase(ctx);

    const first = await uc.execute(baseCommand);
    const second = await uc.execute(baseCommand);

    expect(second.deduplicated).toBe(true);
    expect(second.response.id).toBe(first.response.id);
    // No new event for the dedup hit
    expect(ctx.eventPublisher.events).toHaveLength(1);
    // No second advance call.
    expect(ctx.workflowAdvancer.calls).toHaveLength(1);
  });

  it('rejects a second submission with a different key as ResponseConflictError', async () => {
    const ctx = buildContext({
      users: { 'u-1': eligibleUser, 'u-2': { ...eligibleUser, id: 'u-2' } },
      workflows: { 'wf-1': { id: 'wf-1', scope: 'wf-1', steps: [step] } },
    });
    await seedPendingStep(ctx.pendingStepRepository);
    const uc = makeUseCase(ctx);

    await uc.execute(baseCommand);
    // Re-open the step to bypass the closed-step guard so we exercise the
    // ResponseConflictError branch (winner-takes-all).
    const stepProj = await ctx.pendingStepRepository.findByKey('wf-1', 'step-1');
    stepProj.closedAt = null;
    await ctx.pendingStepRepository.upsert(stepProj);

    await expect(uc.execute({
      ...baseCommand,
      idempotencyKey: 'k-2',
      actor: { userId: 'u-2' },
    })).rejects.toBeInstanceOf(ResponseConflictError);
  });

  it('rejects an unauthorised actor with IneligibleResponderError', async () => {
    const ctx = buildContext({
      users: { 'u-1': eligibleUser },
      workflows: { 'wf-1': { id: 'wf-1', scope: 'wf-1', steps: [step] } },
      authorised: false,
      reason: 'no permission',
    });
    await seedPendingStep(ctx.pendingStepRepository);
    const uc = makeUseCase(ctx);

    await expect(uc.execute(baseCommand)).rejects.toBeInstanceOf(IneligibleResponderError);
  });

  it('rejects an authorised but ineligible user', async () => {
    const ctx = buildContext({
      users: { 'u-1': { ...eligibleUser, role: 'viewer' } },
      workflows: { 'wf-1': { id: 'wf-1', scope: 'wf-1', steps: [step] } },
    });
    await seedPendingStep(ctx.pendingStepRepository);
    const uc = makeUseCase(ctx);

    await expect(uc.execute(baseCommand)).rejects.toBeInstanceOf(IneligibleResponderError);
  });

  it('rejects when no pending step exists', async () => {
    const ctx = buildContext({
      users: { 'u-1': eligibleUser },
      workflows: { 'wf-1': { id: 'wf-1', scope: 'wf-1', steps: [step] } },
    });
    const uc = makeUseCase(ctx);
    await expect(uc.execute(baseCommand)).rejects.toBeInstanceOf(StepNotPendingError);
  });

  it('rejects an invalid payload with InvalidResponseError', async () => {
    const ctx = buildContext({
      users: { 'u-1': eligibleUser },
      workflows: { 'wf-1': { id: 'wf-1', scope: 'wf-1', steps: [step] } },
    });
    await seedPendingStep(ctx.pendingStepRepository);
    const uc = makeUseCase(ctx);
    await expect(uc.execute({
      ...baseCommand,
      payload: { unknown: true },
    })).rejects.toBeInstanceOf(InvalidResponseError);
  });

  it('requires an idempotency key', async () => {
    const ctx = buildContext({
      users: { 'u-1': eligibleUser },
      workflows: { 'wf-1': { id: 'wf-1', scope: 'wf-1', steps: [step] } },
    });
    await seedPendingStep(ctx.pendingStepRepository);
    const uc = makeUseCase(ctx);
    await expect(uc.execute({ ...baseCommand, idempotencyKey: undefined }))
      .rejects.toBeInstanceOf(ResponseConflictError);
  });
});
