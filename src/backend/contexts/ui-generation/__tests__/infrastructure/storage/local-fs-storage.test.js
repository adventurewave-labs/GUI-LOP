/**
 * local-fs-storage.test.js — keys must stay inside the base directory.
 */
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalFsStorage } from '../../../infrastructure/storage/local-fs-storage.js';

describe('LocalFsStorage', () => {
  let dir;
  let storage;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'glop-fs-'));
    storage = new LocalFsStorage({ baseDir: path.join(dir, 'store') });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('round-trips nested keys', async () => {
    await storage.put('docs/abc/v1.json', '{"a":1}');
    await expect(storage.get('docs/abc/v1.json')).resolves.toBe('{"a":1}');
    await expect(storage.get('missing.json')).resolves.toBeNull();
  });

  test.each([
    ['../escape.txt'],
    ['docs/../../escape.txt'],
    ['/etc/passwd'],
    ['a\0b'],
    [''],
  ])('rejects traversal key %p', async (key) => {
    await expect(storage.put(key, 'x')).rejects.toThrow(/LocalFsStorage/);
    await expect(storage.get(key)).rejects.toThrow(/LocalFsStorage/);
  });

  test('a sibling dir sharing the prefix is not "inside"', async () => {
    await expect(storage.put('../store-evil/x', 'x')).rejects.toThrow(/escapes/);
    expect(existsSync(path.join(dir, 'store-evil'))).toBe(false);
  });
});
