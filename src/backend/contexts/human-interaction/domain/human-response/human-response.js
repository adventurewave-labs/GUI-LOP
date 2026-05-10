/**
 * HumanResponse aggregate root.
 *
 * Captures one human's authoritative response to a workflow's pending step.
 * Once `record()` has constructed the aggregate, the instance is immutable
 * and carries the `human_response.recorded` event in `pending_events`.
 *
 * Invariants enforced:
 *   - `action` is one of the actions allowed by the step (validated via
 *     the injected `ResponseValidationService`).
 *   - `payload` conforms to the step's response schema (same service).
 *   - `(workflow_id, step_id, idempotency_key)` is the dedupe key — see
 *     `record-human-response` use case for the runtime check.
 *   - Once recorded, the aggregate cannot be mutated.
 */
import { ResponseAction } from './response-action.js';
import { ResponsePayload } from './response-payload.js';
import { ResponseRationale } from './response-rationale.js';
import { ConfidenceScore } from './confidence-score.js';
import { HumanResponseRecorded } from '../events.js';
import { InvariantViolationError } from '../errors.js';

export class HumanResponse {
  /**
   * Private constructor — use `HumanResponse.record(...)`.
   */
  constructor(props) {
    this.id = props.id;
    this.workflowId = props.workflowId;
    this.stepId = props.stepId;
    this.responder = props.responder;
    this.action = props.action;
    this.payload = props.payload;
    this.rationale = props.rationale ?? null;
    this.confidence = props.confidence ?? null;
    this.idempotencyKey = props.idempotencyKey;
    this.recordedAt = props.recordedAt;
    this._pendingEvents = props.pendingEvents ? [...props.pendingEvents] : [];
    Object.freeze(this);
  }

  /**
   * Construct a new, validated HumanResponse and emit the recorded event.
   *
   * @param {object} args
   * @param {string} args.id
   * @param {string} args.workflowId
   * @param {string} args.stepId
   * @param {string} args.responder           UserId
   * @param {string} args.action               raw action string
   * @param {object} args.payload              raw payload
   * @param {string} [args.rationale]
   * @param {number} [args.confidence]
   * @param {string} args.idempotencyKey
   * @param {Date}   args.now
   * @param {{ validate: (action, payload) => import('../../../../shared-kernel/domain/result.js').Result }} args.validator
   * @returns {HumanResponse}
   */
  static record(args) {
    const {
      id,
      workflowId,
      stepId,
      responder,
      action,
      payload,
      rationale,
      confidence,
      idempotencyKey,
      now,
      validator,
    } = args;

    if (!id) throw new InvariantViolationError('HumanResponse: id is required');
    if (!workflowId) throw new InvariantViolationError('HumanResponse: workflowId is required');
    if (!stepId) throw new InvariantViolationError('HumanResponse: stepId is required');
    if (!responder) throw new InvariantViolationError('HumanResponse: responder is required');
    if (!idempotencyKey) {
      throw new InvariantViolationError('HumanResponse: idempotencyKey is required');
    }
    if (!(now instanceof Date)) {
      throw new InvariantViolationError('HumanResponse: now must be a Date');
    }
    if (!validator || typeof validator.validate !== 'function') {
      throw new InvariantViolationError('HumanResponse: validator is required');
    }

    // Delegate action+payload validation to the injected service. The service
    // owns knowledge of the step's UI spec (allowed actions and schema).
    const validation = validator.validate(action, payload);
    if (validation.isErr()) {
      throw validation.unwrapErr();
    }

    const actionVo = validation.unwrap().action;
    const payloadVo = validation.unwrap().payload;
    const rationaleVo = ResponseRationale.of(rationale);
    const confidenceVo = ConfidenceScore.of(confidence);

    const event = new HumanResponseRecorded({
      humanResponseId: id,
      workflowId,
      stepId,
      action: actionVo.value,
      payload: payloadVo.toJSON(),
      by: responder,
      occurredAt: now,
    });

    return new HumanResponse({
      id,
      workflowId,
      stepId,
      responder,
      action: actionVo,
      payload: payloadVo,
      rationale: rationaleVo,
      confidence: confidenceVo,
      idempotencyKey,
      recordedAt: now,
      pendingEvents: [event],
    });
  }

  /**
   * Hydrate an aggregate from persistence (no validation, no events).
   */
  static rehydrate(state) {
    return new HumanResponse({
      id: state.id,
      workflowId: state.workflowId,
      stepId: state.stepId,
      responder: state.responder,
      action: state.action instanceof ResponseAction
        ? state.action
        : new ResponseAction(state.action),
      payload: state.payload instanceof ResponsePayload
        ? state.payload
        : new ResponsePayload(state.payload ?? {}),
      rationale: state.rationale instanceof ResponseRationale
        ? state.rationale
        : ResponseRationale.of(state.rationale ?? null),
      confidence: state.confidence instanceof ConfidenceScore
        ? state.confidence
        : ConfidenceScore.of(state.confidence ?? null),
      idempotencyKey: state.idempotencyKey,
      recordedAt: state.recordedAt instanceof Date ? state.recordedAt : new Date(state.recordedAt),
      pendingEvents: [],
    });
  }

  pendingEvents() {
    return [...this._pendingEvents];
  }

  /**
   * Plain-object snapshot suitable for persistence layers and event payloads.
   */
  toState() {
    return {
      id: this.id,
      workflowId: this.workflowId,
      stepId: this.stepId,
      responder: this.responder,
      action: this.action.value,
      payload: this.payload.toJSON(),
      rationale: this.rationale ? this.rationale.value : null,
      confidence: this.confidence ? this.confidence.value : null,
      idempotencyKey: this.idempotencyKey,
      recordedAt: this.recordedAt,
    };
  }
}
