/**
 * Mutation hardening for the workflow-orchestration domain (roadmap 15c).
 *
 * Written against the Stryker survivors in step-validation-service,
 * workflow-execution-policy, workflow-context and template-version: every
 * branch and boundary is pinned so a flipped operator or dropped condition
 * fails a test. Also pins three bugs found while doing it:
 *   - `required` was ignored unless `properties` was also declared
 *   - an unknown/typo'd schema type matched any value
 *   - TemplateVersion.of('2abc') === 2 (parseInt leniency)
 */
import { validate, validateInput, validateOutput } from '../../domain/workflow/step-validation-service.js';
import { nextAction, EngineAction, EngineActionType, isPause, isTerminalAction } from '../../domain/workflow/workflow-execution-policy.js';
import { WorkflowStatus } from '../../domain/workflow/workflow-status.js';
import { WorkflowContext } from '../../domain/workflow/workflow-context.js';
import { TemplateVersion } from '../../domain/template/template-version.js';
import { ValidationError } from '../../../../shared-kernel/domain/errors.js';

const ok = (v, s) => expect(() => validate(v, s)).not.toThrow();
const bad = (v, s, msg) => expect(() => validate(v, s)).toThrow(msg ?? ValidationError);

describe('step-validation-service.validate', () => {
  test('no schema → no-op; non-object schema → invalid', () => {
    ok(123, undefined);
    ok(123, null);
    bad(1, 'string', /Invalid schema at \$/);
  });

  test.each([
    ['string', 'x', 1],
    ['number', 1.5, '1'],
    ['number', 0, Infinity],
    ['number', -2, NaN],
    ['integer', 3, 3.5],
    ['boolean', false, 0],
    ['object', {}, []],
    ['object', { a: 1 }, null],
    ['array', [], {}],
    ['null', null, undefined],
  ])('type %s accepts %p, rejects %p', (type, good, wrong) => {
    ok(good, { type });
    bad(wrong, { type }, new RegExp(`Expected ${type} at \\$, got `));
  });

  test('error messages describe the actual type', () => {
    bad(null, { type: 'string' }, 'got null');
    bad([], { type: 'string' }, 'got array');
    bad(5, { type: 'string' }, 'got number');
  });

  test('unknown schema type is rejected instead of matching anything (bug)', () => {
    bad('x', { type: 'strnig' }, /Unknown schema type "strnig"/);
  });

  test('required is enforced with and without properties (bug)', () => {
    bad({}, { type: 'object', required: ['amount'] }, 'Missing required key: $.amount');
    ok({ amount: 1 }, { type: 'object', required: ['amount'] });
    bad({ b: 1 }, { type: 'object', required: ['a'], properties: { a: { type: 'number' } } }, '$.a');
    ok({ a: 0 }, { type: 'object', required: ['a'], properties: { a: { type: 'number' } } });
  });

  test('required without a declared type still applies (and rejects null)', () => {
    bad(null, { required: ['a'] }, 'Missing required key: $.a');
    bad({}, { required: ['a'] }, 'Missing required key: $.a');
    ok({ a: undefined }, { required: ['a'] });
    ok('anything', {});
  });

  test('properties are validated only when present, with nested paths', () => {
    const schema = { type: 'object', properties: { a: { type: 'object', properties: { b: { type: 'integer' } } } } };
    ok({}, schema);
    ok({ a: {} }, schema);
    ok({ a: { b: 2 } }, schema);
    bad({ a: { b: 'x' } }, schema, 'Expected integer at $.a.b, got string');
  });

  test('array items are validated with indexed paths', () => {
    const schema = { type: 'array', items: { type: 'string' } };
    ok([], schema);
    ok(['a', 'b'], schema);
    bad(['a', 2], schema, 'Expected string at $[1], got number');
  });

  test('validateInput / validateOutput use the step name in the path and skip without a schema', () => {
    expect(() => validateInput({ name: 's1' }, 42)).not.toThrow();
    expect(() => validateOutput({ name: 's1' }, 42)).not.toThrow();
    expect(() => validateInput({ name: 's1', inputSchema: { type: 'string' } }, 42))
      .toThrow('Expected string at step:s1.input, got number');
    expect(() => validateOutput({ name: 's2', outputSchema: { type: 'object', required: ['r'] } }, {}))
      .toThrow('Missing required key: step:s2.output.r');
  });
});

describe('workflow-execution-policy.nextAction', () => {
  const step = (kind, state = 'pending', error) => ({
    kind,
    error,
    isFailed: () => state === 'failed',
    isTerminal: () => state === 'done' || state === 'failed',
    isWaitingForHuman: () => state === 'waiting',
  });
  const wf = (status, steps = []) => ({ status, steps });

  test('idle reasons for missing / terminal / not-started / waiting workflows', () => {
    expect(nextAction(null)).toEqual({ type: EngineActionType.IDLE, reason: 'no_workflow' });
    for (const s of [WorkflowStatus.COMPLETED, WorkflowStatus.FAILED, WorkflowStatus.CANCELLED]) {
      expect(nextAction(wf(s))).toEqual({ type: EngineActionType.IDLE, reason: 'terminal' });
    }
    expect(nextAction(wf(WorkflowStatus.CREATED))).toEqual({ type: EngineActionType.IDLE, reason: 'not_started' });
    expect(nextAction(wf(WorkflowStatus.WAITING_FOR_HUMAN))).toEqual({ type: EngineActionType.IDLE, reason: 'waiting_for_human' });
  });

  test('a failed step fails the workflow with its error (or a default)', () => {
    expect(nextAction(wf(WorkflowStatus.RUNNING, [step('automated', 'failed', 'boom')])))
      .toEqual({ type: EngineActionType.FAIL, reason: 'boom' });
    expect(nextAction(wf(WorkflowStatus.RUNNING, [step('automated', 'done'), step('automated', 'failed')])))
      .toEqual({ type: EngineActionType.FAIL, reason: 'step_failed' });
  });

  test('first pending step decides by kind', () => {
    const run = (s) => nextAction(wf(WorkflowStatus.RUNNING, [step('automated', 'done'), s, step('automated')]));
    const a = step('automated');
    expect(run(a)).toEqual({ type: EngineActionType.ADVANCE, step: a });
    const e = step('external');
    expect(run(e)).toEqual({ type: EngineActionType.INVOKE_EXTERNAL, step: e });
    const h = step('human');
    expect(run(h)).toEqual({ type: EngineActionType.PAUSE_HUMAN, step: h });
    expect(run(step('weird'))).toEqual({ type: EngineActionType.FAIL, reason: 'unknown_step_kind:weird' });
  });

  test('no pending: waiting step pauses, otherwise complete (also for zero steps)', () => {
    const w = step('human', 'waiting');
    expect(nextAction(wf(WorkflowStatus.RUNNING, [step('automated', 'done'), w]))).toEqual({ type: EngineActionType.PAUSE_HUMAN, step: w });
    expect(nextAction(wf(WorkflowStatus.RUNNING, [step('automated', 'done')]))).toEqual({ type: EngineActionType.COMPLETE });
    expect(nextAction(wf(WorkflowStatus.RUNNING, []))).toEqual({ type: EngineActionType.COMPLETE });
  });

  test('isPause / isTerminalAction partition every action type', () => {
    const s = step('automated');
    const table = [
      [EngineAction.advance(s), false, false],
      [EngineAction.pauseHuman(s), true, false],
      [EngineAction.invokeExternal(s), true, false],
      [EngineAction.idle('x'), true, false],
      [EngineAction.complete(), false, true],
      [EngineAction.fail('x'), false, true],
    ];
    for (const [action, pause, terminal] of table) {
      expect([action.type, isPause(action)]).toEqual([action.type, pause]);
      expect([action.type, isTerminalAction(action)]).toEqual([action.type, terminal]);
      expect(Object.isFrozen(action)).toBe(true);
    }
  });
});

describe('WorkflowContext', () => {
  test('empty / of(null|undefined) are empty objects', () => {
    expect(WorkflowContext.empty().toJSON()).toEqual({});
    expect(WorkflowContext.of(undefined).toJSON()).toEqual({});
    expect(WorkflowContext.of(null).toJSON()).toEqual({});
  });

  test('primitives and arrays are wrapped under `value`', () => {
    expect(WorkflowContext.of(5).toJSON()).toEqual({ value: 5 });
    expect(WorkflowContext.of('s').toJSON()).toEqual({ value: 's' });
    expect(WorkflowContext.of([1, 2]).toJSON()).toEqual({ value: [1, 2] });
  });

  test('deep copies in and out — callers cannot mutate the context', () => {
    const src = { a: { b: 1 } };
    const ctx = WorkflowContext.of(src);
    src.a.b = 99;
    expect(ctx.get('a')).toEqual({ b: 1 });
    ctx.get('a').b = 42;
    ctx.toJSON().a.b = 42;
    expect(ctx.get('a')).toEqual({ b: 1 });
    expect(ctx.get('missing')).toBeUndefined();
    expect(Object.isFrozen(ctx)).toBe(true);
  });

  test('merge is copy-on-write; non-object patches are ignored', () => {
    const a = WorkflowContext.of({ x: 1, y: 1 });
    const b = a.merge({ y: 2, z: { k: 1 } });
    expect(a.toJSON()).toEqual({ x: 1, y: 1 });
    expect(b.toJSON()).toEqual({ x: 1, y: 2, z: { k: 1 } });
    expect(a.merge(null)).toBe(a);
    expect(a.merge('str')).toBe(a);
  });

  test('equals compares by value and only against contexts', () => {
    expect(WorkflowContext.of({ a: 1 }).equals(WorkflowContext.of({ a: 1 }))).toBe(true);
    expect(WorkflowContext.of({ a: 1 }).equals(WorkflowContext.of({ a: 2 }))).toBe(false);
    expect(WorkflowContext.of({ a: 1 }).equals({ a: 1 })).toBe(false);
  });
});

describe('TemplateVersion', () => {
  test.each([[1, 1], ['1', 1], [' 7 ', 7], ['42', 42], [42, 42]])('of(%p) → %p', (raw, want) => {
    expect(TemplateVersion.of(raw).value).toBe(want);
  });

  test.each([0, -1, 1.5, '0', '-2', '2abc', 'abc2', '1.5', '1e3', '0x10', '', 'x', null, undefined, NaN, {}])('of(%p) is rejected', (raw) => {
    expect(() => TemplateVersion.of(raw)).toThrow('TemplateVersion must be a positive integer');
  });

  test('initial / next / equals / toString', () => {
    const v1 = TemplateVersion.initial();
    expect(v1.value).toBe(1);
    expect(v1.next().value).toBe(2);
    expect(v1.next().next().toString()).toBe('3');
    expect(v1.equals(TemplateVersion.of(1))).toBe(true);
    expect(v1.equals(v1.next())).toBe(false);
    expect(v1.equals({ value: 1 })).toBe(false);
    expect(Object.isFrozen(v1)).toBe(true);
  });
});
