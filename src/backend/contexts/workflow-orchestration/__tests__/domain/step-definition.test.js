import { StepDefinition } from '../../domain/template/step-definition.js';

describe('StepDefinition', () => {
  it('builds a valid automated step', () => {
    const step = new StepDefinition({ name: 'Analyse', kind: 'automated' });
    expect(step.name).toBe('Analyse');
    expect(step.kind).toBe('automated');
    expect(step.onTimeout).toBe('fail');
    expect(Object.isFrozen(step)).toBe(true);
  });

  it('builds a valid human step with uiSpec', () => {
    const step = new StepDefinition({ name: 'Approve', kind: 'human', uiSpec: { fields: [] } });
    expect(step.uiSpec).toBeTruthy();
  });

  it('rejects unknown kind', () => {
    expect(() => new StepDefinition({ name: 'X', kind: 'wat' })).toThrow();
  });

  it('rejects empty name', () => {
    expect(() => new StepDefinition({ name: '', kind: 'automated' })).toThrow();
  });

  it('rejects negative deadline', () => {
    expect(() => new StepDefinition({ name: 'X', kind: 'automated', deadline: -1 })).toThrow();
  });

  it('rejects unknown onTimeout', () => {
    expect(() => new StepDefinition({ name: 'X', kind: 'automated', onTimeout: 'cry' })).toThrow();
  });

  it('serialises round-trip', () => {
    const step = new StepDefinition({
      name: 'X',
      kind: 'automated',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      deadline: 30000,
      onTimeout: 'escalate',
    });
    const json = step.toJSON();
    expect(json.name).toBe('X');
    expect(json.deadline).toBe(30000);
    expect(json.onTimeout).toBe('escalate');
  });
});
