/**
 * UI Generation context — domain tests for VOs and pure services.
 */

import { FieldType, FIELD_TYPES } from '../../../../src/backend/contexts/ui-generation/domain/field-type.js';
import { ValidationRule, RULE_TYPES } from '../../../../src/backend/contexts/ui-generation/domain/validation-rule.js';
import { Field } from '../../../../src/backend/contexts/ui-generation/domain/field.js';
import { ComponentRef } from '../../../../src/backend/contexts/ui-generation/domain/component-ref.js';
import { Layout, LAYOUT_KINDS } from '../../../../src/backend/contexts/ui-generation/domain/layout.js';
import { UISpecification } from '../../../../src/backend/contexts/ui-generation/domain/ui-specification.js';
import { UIDocument } from '../../../../src/backend/contexts/ui-generation/domain/ui-document.js';
import { compose } from '../../../../src/backend/contexts/ui-generation/domain/services/layout-composer.js';
import { resolve } from '../../../../src/backend/contexts/ui-generation/domain/services/component-resolver.js';
import { select, STRATEGIES } from '../../../../src/backend/contexts/ui-generation/domain/services/generation-strategy-selector.js';
import { InMemoryComponentCatalogueRepository } from '../../../../src/backend/contexts/ui-generation/infrastructure/persistence/inmemory-component-catalogue-repository.js';

describe('FieldType / ValidationRule / ComponentRef VOs', () => {
  it('FieldType validates known values', () => {
    expect(FieldType.of(FIELD_TYPES.TEXT).value).toBe('text');
    expect(() => FieldType.of('weird')).toThrow();
  });

  it('ValidationRule validates type', () => {
    const r = ValidationRule.of({ id: 'r1', type: RULE_TYPES.REQUIRED });
    expect(r.id).toBe('r1');
    expect(() => ValidationRule.of({ id: 'r2', type: 'unknown' })).toThrow();
  });

  it('ComponentRef enforces semver', () => {
    expect(() => ComponentRef.of({ name: 'x', version: '1.2.3' })).not.toThrow();
    expect(() => ComponentRef.of({ name: 'x', version: 'v1' })).toThrow();
  });
});

describe('Field VO', () => {
  it('builds with validations and component', () => {
    const f = Field.of({
      id: 'name',
      label: 'Name',
      type: 'text',
      validations: [{ id: 'r1', type: 'required' }],
      component: { name: 'text-input', version: '1.0.0' }
    });
    expect(f.id).toBe('name');
    expect(f.validations.length).toBe(1);
    expect(f.component.toString()).toBe('text-input@1.0.0');
  });
});

describe('Layout VO', () => {
  it('rejects unknown layout kinds', () => {
    expect(() => Layout.of({ kind: 'pyramid' })).toThrow();
  });
  it('accepts known layout kinds', () => {
    expect(Layout.of({ kind: LAYOUT_KINDS.GRID }).kind).toBe('grid');
  });
});

describe('UISpecification aggregate', () => {
  const catalogue = new InMemoryComponentCatalogueRepository();

  it('rejects duplicate field ids', () => {
    expect(() =>
      UISpecification.create(
        {
          id: 's1',
          workflowId: 'wf-1',
          stepId: 'step-1',
          fields: [
            { id: 'a', label: 'A', type: 'text' },
            { id: 'a', label: 'A2', type: 'text' }
          ]
        },
        { catalogue }
      )
    ).toThrow(/Duplicate field/);
  });

  it('rejects duplicate validation ids across fields', () => {
    expect(() =>
      UISpecification.create(
        {
          id: 's2',
          workflowId: 'wf',
          stepId: 'step',
          fields: [
            { id: 'a', label: 'A', type: 'text', validations: [{ id: 'r', type: 'required' }] },
            { id: 'b', label: 'B', type: 'text', validations: [{ id: 'r', type: 'required' }] }
          ]
        },
        { catalogue }
      )
    ).toThrow(/Duplicate validation rule/);
  });

  it('rejects unknown component refs against catalogue', () => {
    expect(() =>
      UISpecification.create(
        {
          id: 's3',
          workflowId: 'wf',
          stepId: 'step',
          fields: [
            { id: 'a', label: 'A', type: 'text', component: { name: 'no-such', version: '1.0.0' } }
          ]
        },
        { catalogue }
      )
    ).toThrow(/Component not in catalogue/);
  });
});

describe('UIDocument aggregate', () => {
  it('requires all key identifiers', () => {
    expect(() => new UIDocument({})).toThrow();
  });
});

describe('layout-composer / component-resolver / strategy-selector', () => {
  const catalogue = new InMemoryComponentCatalogueRepository();

  it('compose returns the spec layout when present, otherwise default form', () => {
    const spec = UISpecification.create(
      {
        id: 's4',
        workflowId: 'w',
        stepId: 's',
        fields: [{ id: 'a', label: 'A', type: 'text' }]
      },
      { catalogue }
    );
    const layout = compose(spec, {});
    expect(layout.kind).toBe(LAYOUT_KINDS.FORM);
    expect(layout.regions[0].fields).toEqual(['a']);
  });

  it('resolve returns default component for type when none given', () => {
    const spec = UISpecification.create(
      {
        id: 's5',
        workflowId: 'w',
        stepId: 's',
        fields: [{ id: 'a', label: 'A', type: 'text' }]
      },
      { catalogue }
    );
    const inst = resolve(spec.fields[0], catalogue);
    expect(inst.component.name).toBe('text-input');
    expect(inst.component.version).toBe('1.0.0');
  });

  it('strategy-selector picks static-form for simple specs', () => {
    const spec = UISpecification.create(
      {
        id: 's6',
        workflowId: 'w',
        stepId: 's',
        fields: [{ id: 'a', label: 'A', type: 'text' }]
      },
      { catalogue }
    );
    expect(select(spec)).toBe(STRATEGIES.STATIC_FORM);
  });

  it('strategy-selector picks dashboard for empty fields', () => {
    const spec = UISpecification.create(
      { id: 's7', workflowId: 'w', stepId: 's', fields: [] },
      { catalogue }
    );
    expect(select(spec)).toBe(STRATEGIES.DASHBOARD);
  });
});
