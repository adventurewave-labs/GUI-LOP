import { UuidGenerator, uuidGenerator } from '../uuid-generator.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('UuidGenerator', () => {
  test('newId returns a UUID v4 string', () => {
    const gen = new UuidGenerator();
    const id = gen.newId();
    expect(typeof id).toBe('string');
    expect(id).toMatch(UUID_RE);
  });

  test('produces unique values', () => {
    const gen = new UuidGenerator();
    const ids = new Set();
    for (let i = 0; i < 50; i++) ids.add(gen.newId());
    expect(ids.size).toBe(50);
  });

  test('singleton works the same', () => {
    expect(uuidGenerator.newId()).toMatch(UUID_RE);
  });
});
