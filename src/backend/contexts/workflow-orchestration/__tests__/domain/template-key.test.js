import { TemplateKey } from '../../domain/template/template-key.js';

describe('TemplateKey', () => {
  test.each([
    'data-analysis',
    'decision-making',
    'a1',
    'longer-key-name-3',
  ])('accepts kebab-case: %s', (raw) => {
    expect(TemplateKey.of(raw).value).toBe(raw);
  });

  test.each([
    '',
    '-leading',
    'trailing-',
    'Camel-Case',
    'snake_case',
    'with spaces',
    'a',
  ])('rejects: %s', (raw) => {
    expect(() => TemplateKey.of(raw)).toThrow();
  });

  it('equals by value', () => {
    expect(TemplateKey.of('a-b').equals(TemplateKey.of('a-b'))).toBe(true);
    expect(TemplateKey.of('a-b').equals(TemplateKey.of('a-c'))).toBe(false);
  });
});
