import { HumanResponse } from '../../domain/human-response/human-response.js';
import { ResponseValidationService } from '../../domain/services/response-validation-service.js';
import { InvariantViolationError, InvalidResponseError } from '../../domain/errors.js';
import { HUMAN_RESPONSE_RECORDED } from '../../domain/events.js';

const makeValidator = (step = {}) => ResponseValidationService.forStep({
  allowedActions: ['approve', 'reject'],
  responseSchema: {
    type: 'object',
    required: ['comment'],
    properties: { comment: { type: 'string' } },
    additionalProperties: false,
  },
  ...step,
});

describe('HumanResponse aggregate', () => {
  const baseArgs = {
    id: 'resp-1',
    workflowId: 'wf-1',
    stepId: 'step-1',
    responder: 'user-1',
    action: 'approve',
    payload: { comment: 'lgtm' },
    idempotencyKey: 'key-1',
    now: new Date('2026-05-10T10:00:00Z'),
  };

  it('records a valid response and emits human_response.recorded', () => {
    const response = HumanResponse.record({ ...baseArgs, validator: makeValidator() });
    expect(response.id).toBe('resp-1');
    expect(response.action.value).toBe('approve');
    expect(response.payload.value.comment).toBe('lgtm');
    expect(response.recordedAt).toEqual(baseArgs.now);
    const events = response.pendingEvents();
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe(HUMAN_RESPONSE_RECORDED);
    expect(events[0].payload.workflow_id).toBe('wf-1');
    expect(events[0].payload.action).toBe('approve');
  });

  it('is immutable once recorded', () => {
    const response = HumanResponse.record({ ...baseArgs, validator: makeValidator() });
    expect(Object.isFrozen(response)).toBe(true);
    expect(() => { response.action = null; }).toThrow();
    expect(() => { response.recordedAt = new Date(); }).toThrow();
  });

  it('rejects construction without idempotency key', () => {
    expect(() => HumanResponse.record({
      ...baseArgs, idempotencyKey: undefined, validator: makeValidator(),
    })).toThrow(InvariantViolationError);
  });

  it('rejects construction without responder', () => {
    expect(() => HumanResponse.record({
      ...baseArgs, responder: undefined, validator: makeValidator(),
    })).toThrow(InvariantViolationError);
  });

  it('rejects construction without a validator', () => {
    expect(() => HumanResponse.record({ ...baseArgs })).toThrow(InvariantViolationError);
  });

  it('propagates validator failures (invalid action)', () => {
    expect(() => HumanResponse.record({
      ...baseArgs,
      action: 'mystery',
      validator: makeValidator(),
    })).toThrow(InvalidResponseError);
  });

  it('propagates validator failures (payload schema mismatch)', () => {
    expect(() => HumanResponse.record({
      ...baseArgs,
      payload: { unexpected: true },
      validator: makeValidator(),
    })).toThrow(InvalidResponseError);
  });

  it('rehydrates from persisted state without events', () => {
    const r = HumanResponse.rehydrate({
      id: 'resp-2',
      workflowId: 'wf-1',
      stepId: 'step-1',
      responder: 'user-1',
      action: 'approve',
      payload: { comment: 'ok' },
      idempotencyKey: 'k',
      recordedAt: new Date(),
    });
    expect(r.pendingEvents()).toHaveLength(0);
  });

  it('toState round-trips through rehydrate', () => {
    const original = HumanResponse.record({ ...baseArgs, validator: makeValidator() });
    const state = original.toState();
    const round = HumanResponse.rehydrate(state);
    expect(round.toState()).toEqual(state);
  });
});
