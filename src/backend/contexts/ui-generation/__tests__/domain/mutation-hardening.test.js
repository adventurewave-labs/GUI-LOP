/**
 * Mutation hardening for the ui-generation domain (roadmap 15d).
 *
 * Targets the Stryker survivors in component-resolver, component-ref,
 * validation-rule, generation-strategy-selector, layout and field-type, and
 * pins two fixes made while writing it:
 *   - ValidationRule never checked `value` (AI-supplied, shipped to the
 *     browser): `minLength: 'abc'`, uncompilable/oversized `pattern`,
 *     empty `enum` all passed.
 *   - Layout was only shallow-frozen: regions[i].fields was mutable.
 */
import { resolve } from '../../domain/services/component-resolver.js';
import { ComponentRef } from '../../domain/component-ref.js';
import { ValidationRule, RULE_TYPES, MAX_PATTERN_LENGTH } from '../../domain/validation-rule.js';
import { select, STRATEGIES } from '../../domain/services/generation-strategy-selector.js';
import { Layout, LAYOUT_KINDS } from '../../domain/layout.js';
import { FieldType, FIELD_TYPES } from '../../domain/field-type.js';
import { Field } from '../../domain/field.js';
import { ValidationError } from '../../../../shared-kernel/domain/errors.js';

describe('enumerations are exact (string literals pinned)', () => {
  test('FIELD_TYPES / LAYOUT_KINDS / RULE_TYPES / STRATEGIES', () => {
    expect(FIELD_TYPES).toEqual({ TEXT: 'text', TEXTAREA: 'textarea', NUMBER: 'number', BOOLEAN: 'boolean', DATE: 'date', SELECT: 'select', EMAIL: 'email' });
    expect(LAYOUT_KINDS).toEqual({ STACK: 'stack', GRID: 'grid', TABS: 'tabs', FORM: 'form' });
    expect(RULE_TYPES).toEqual({ REQUIRED: 'required', MIN_LENGTH: 'minLength', MAX_LENGTH: 'maxLength', PATTERN: 'pattern', MIN: 'min', MAX: 'max', ENUM: 'enum' });
    expect(STRATEGIES).toEqual({ STATIC_FORM: 'static-form', DASHBOARD: 'dashboard', COMPOSITE: 'composite' });
    for (const o of [FIELD_TYPES, LAYOUT_KINDS, RULE_TYPES, STRATEGIES]) expect(Object.isFrozen(o)).toBe(true);
  });
});

describe('FieldType', () => {
  test('accepts every known type, serialises to its value, is frozen', () => {
    for (const v of Object.values(FIELD_TYPES)) {
      const t = FieldType.of(v);
      expect(t.value).toBe(v);
      expect(t.toJSON()).toBe(v);
      expect(Object.isFrozen(t)).toBe(true);
    }
  });

  test('unknown type → ValidationError naming the type and listing allowed', () => {
    let err;
    try { FieldType.of('colour'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toBe('Unknown field type: colour');
  });
});

describe('ComponentRef', () => {
  test('object and "name@x.y.z" string forms; toJSON / toString', () => {
    const a = ComponentRef.of({ name: 'text-input', version: '1.2.3' });
    const b = ComponentRef.of('text-input@1.2.3');
    expect(a.toJSON()).toEqual({ name: 'text-input', version: '1.2.3' });
    expect(b.toJSON()).toEqual(a.toJSON());
    expect(b.toString()).toBe('text-input@1.2.3');
    expect(Object.isFrozen(a)).toBe(true);
    expect(ComponentRef.of('x@10.20.30').version).toBe('10.20.30');
  });

  test.each([
    [{ version: '1.0.0' }, 'ComponentRef.name is required'],
    [{ name: 'x' }, 'ComponentRef.version is required'],
    ['x', 'ComponentRef.version is required'],
    [{ name: 'x', version: '1.0' }, 'ComponentRef.version must be semver: 1.0'],
    [{ name: 'x', version: 'v1.0.0' }, 'must be semver'],
    [{ name: 'x', version: '1.0.0-beta' }, 'must be semver'],
    [{ name: 'x', version: '1.0.0.0' }, 'must be semver'],
  ])('%p → %s', (spec, msg) => {
    expect(() => ComponentRef.of(spec)).toThrow(msg);
  });
});

describe('ValidationRule', () => {
  const rule = (type, value, extra = {}) => ValidationRule.of({ id: 'r1', type, value, ...extra });

  test('valid values for every rule type round-trip through toJSON', () => {
    const cases = [
      ['required', undefined, null], ['required', true, true],
      ['minLength', 0, 0], ['maxLength', 255, 255],
      ['min', -1.5, -1.5], ['max', 100, 100],
      ['pattern', '^[a-z]+$', '^[a-z]+$'],
      ['enum', ['a', 1, true], ['a', 1, true]],
    ];
    for (const [type, value, stored] of cases) {
      expect(rule(type, value, { message: 'm' }).toJSON()).toEqual({ id: 'r1', type, value: stored, message: 'm' });
    }
    expect(rule('required').message).toBeNull();
    expect(Object.isFrozen(rule('required'))).toBe(true);
  });

  test.each([
    ['required', 'yes', 'must be boolean or absent'],
    ['minLength', 'abc', 'non-negative integer'],
    ['minLength', -1, 'non-negative integer'],
    ['maxLength', 1.5, 'non-negative integer'],
    ['min', '5', 'finite number'],
    ['max', Infinity, 'finite number'],
    ['pattern', '', 'non-empty string'],
    ['pattern', 42, 'non-empty string'],
    ['pattern', '([a-z]', 'valid regular expression'],
    ['pattern', 'a'.repeat(MAX_PATTERN_LENGTH + 1), `at most ${MAX_PATTERN_LENGTH}`],
    ['enum', [], 'non-empty array'],
    ['enum', 'a', 'non-empty array'],
    ['enum', [{}], 'strings, numbers or booleans'],
  ])('%s with value %p is rejected (%s)', (type, value, msg) => {
    expect(() => rule(type, value)).toThrow(`ValidationRule(${type}).value`);
    expect(() => rule(type, value)).toThrow(msg);
  });

  test('id, type and message are checked', () => {
    expect(() => ValidationRule.of({ type: 'required' })).toThrow('ValidationRule.id is required');
    expect(() => ValidationRule.of({ id: 'x', type: 'regex' })).toThrow('Unknown validation rule: regex');
    expect(() => ValidationRule.of({ id: 'x', type: 'required', message: 5 })).toThrow('message must be a string');
  });
});

describe('Layout', () => {
  test('defaults to an empty stack; known kinds only; regions must be an array', () => {
    expect(Layout.of(undefined).toJSON()).toEqual({ kind: 'stack', regions: [] });
    expect(Layout.of({ kind: 'grid' }).kind).toBe('grid');
    expect(() => Layout.of({ kind: 'carousel' })).toThrow('Unknown layout kind: carousel');
    expect(() => Layout.of({ regions: 'x' })).toThrow('Layout.regions must be an array');
  });

  test('deep-frozen: regions and their field lists cannot be mutated (bug)', () => {
    const src = { kind: 'tabs', regions: [{ id: 'main', fields: ['a'] }, { id: 'side' }] };
    const l = Layout.of(src);
    src.regions[0].fields.push('leak');
    expect(l.regions[0].fields).toEqual(['a']);
    expect(l.regions[1].fields).toEqual([]);
    expect(() => l.regions[0].fields.push('x')).toThrow(TypeError);
    expect(Object.isFrozen(l.regions[0])).toBe(true);
    const json = l.toJSON();
    json.regions[0].fields.push('y');
    expect(l.regions[0].fields).toEqual(['a']);
    expect(json).toEqual({ kind: 'tabs', regions: [{ id: 'main', fields: ['a', 'y'] }, { id: 'side', fields: [] }] });
  });
});

describe('generation-strategy-selector.select', () => {
  const spec = (over = {}) => ({ fields: [{}], layout: null, ...over });

  test('a known strategy hint wins; unknown hints are ignored', () => {
    expect(select(spec({ strategyHint: 'dashboard' }))).toBe('dashboard');
    expect(select(spec({ strategyHint: 'composite', fields: [] }))).toBe('composite');
    expect(select(spec({ strategyHint: 'fancy' }))).toBe('static-form');
  });

  test('tabs or >1 region → composite; exactly 1 region does not count', () => {
    expect(select(spec({ layout: { kind: 'tabs', regions: [] } }))).toBe('composite');
    expect(select(spec({ layout: { kind: 'stack', regions: [{}, {}] } }))).toBe('composite');
    expect(select(spec({ layout: { kind: 'stack', regions: [{}] } }))).toBe('static-form');
  });

  test('no fields → dashboard, otherwise static form', () => {
    expect(select(spec({ fields: [] }))).toBe('dashboard');
    expect(select(spec({ fields: [{}], layout: { kind: 'grid', regions: [] } }))).toBe('static-form');
  });
});

describe('component-resolver.resolve', () => {
  const catalogue = (entries) => ({
    has: (n, v) => entries.some(([en, ev]) => en === n && ev === v),
    latestVersion: (n) => entries.filter(([en]) => en === n).map(([, v]) => v).pop(),
  });
  const cat = catalogue([['text-input', '1.0.0'], ['text-input', '2.0.0'], ['select', '1.0.0'], ['textarea', '1.0.0'],
    ['boolean-checkbox', '1.0.0'], ['date-picker', '1.0.0']]);

  test('type defaults map to the latest catalogue version', () => {
    const expected = { text: 'text-input', email: 'text-input', number: 'text-input', textarea: 'textarea', boolean: 'boolean-checkbox', date: 'date-picker', select: 'select' };
    for (const [type, name] of Object.entries(expected)) {
      const r = resolve(Field.of({ id: 'f', label: 'L', type }), cat);
      expect(r.component).toEqual({ name, version: name === 'text-input' ? '2.0.0' : '1.0.0' });
    }
  });

  test('explicit component is used verbatim and must exist', () => {
    const f = Field.of({ id: 'f', label: 'L', type: 'text', component: 'text-input@1.0.0' });
    expect(resolve(f, cat).component).toEqual({ name: 'text-input', version: '1.0.0' });
    const missing = Field.of({ id: 'f', label: 'L', type: 'text', component: 'text-input@9.9.9' });
    expect(() => resolve(missing, cat)).toThrow('Component text-input@9.9.9 not in catalogue');
    expect(() => resolve(Field.of({ id: 'f', label: 'L', type: 'text' }), catalogue([])))
      .toThrow('Component text-input@undefined not in catalogue');
  });

  test('props carry label, type, serialised validations and a copy of options; result is frozen', () => {
    const f = Field.of({
      id: 'f1', label: 'Colour', type: 'select', options: ['red', 'blue'],
      validations: [{ id: 'v', type: 'required', value: true }],
    });
    const r = resolve(f, cat);
    expect(r).toEqual({
      fieldId: 'f1',
      component: { name: 'select', version: '1.0.0' },
      props: { label: 'Colour', type: 'select', validations: [{ id: 'v', type: 'required', value: true, message: null }], options: ['red', 'blue'] },
    });
    expect(Object.isFrozen(r)).toBe(true);
    expect(r.props.options).not.toBe(f.options);
    expect(resolve(Field.of({ id: 'g', label: 'G', type: 'text' }), cat).props.options).toEqual([]);
  });
});
