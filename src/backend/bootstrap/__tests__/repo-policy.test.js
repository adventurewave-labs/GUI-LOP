/**
 * repo-policy.test.js — supply-chain invariants for CI config.
 *
 *   - every third-party Action is pinned to a full 40-char commit SHA
 *   - every workflow declares a top-level least-privilege `permissions:`
 *   - production dependencies don't include packages the backend no longer uses
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../..');
const WF_DIR = path.join(ROOT, '.github/workflows');
const workflows = readdirSync(WF_DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ file: f, text: readFileSync(path.join(WF_DIR, f), 'utf8') }));

describe('GitHub Actions supply-chain policy', () => {
  test('there are workflows to check', () => {
    expect(workflows.length).toBeGreaterThan(3);
  });

  test.each(workflows.map((w) => [w.file, w.text]))('%s: actions are SHA-pinned', (_f, text) => {
    const uses = [...text.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)].map((m) => m[1]);
    const unpinned = uses.filter((u) => !u.startsWith('./') && !/@[0-9a-f]{40}$/.test(u));
    expect(unpinned).toEqual([]);
  });

  test.each(workflows.map((w) => [w.file, w.text]))('%s: declares top-level permissions', (_f, text) => {
    expect(text).toMatch(/^permissions:\s*\n\s+contents:\s*read/m);
    expect(text).not.toMatch(/^permissions:\s*write-all/m);
  });
});

describe('dependency hygiene', () => {
  test('dependabot covers npm, actions and docker', () => {
    const dep = readFileSync(path.join(ROOT, '.github/dependabot.yml'), 'utf8');
    for (const eco of ['npm', 'github-actions', 'docker']) {
      expect(dep).toMatch(new RegExp(`package-ecosystem:\\s*${eco}`));
    }
  });

  test('uuid is not a production dependency (crypto.randomUUID is used)', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.dependencies.uuid).toBeUndefined();
  });
});
