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

describe('type-check coverage (roadmap #14)', () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === '__tests__' ? [] : walk(p);
    return d.name.endsWith('.js') && !d.name.endsWith('.test.js') ? [p] : [];
  });
  const contexts = readdirSync(path.join(ROOT, 'src/backend/contexts'), { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name);
  const checked = [
    'src/backend/shared-kernel',
    'src/backend/bootstrap',
    // roadmap 14c: every context's application + interfaces layers
    ...contexts.flatMap((c) => [`src/backend/contexts/${c}/application`, `src/backend/contexts/${c}/interfaces`]),
  ]
    .filter((d) => { try { return readdirSync(path.join(ROOT, d)) && true; } catch { return false; } })
    .flatMap((d) => walk(path.join(ROOT, d)));

  test('every shared-kernel / bootstrap / application / interfaces module opts into `// @ts-check`', () => {
    const missing = checked
      .filter((f) => !readFileSync(f, 'utf8').startsWith('// @ts-check'))
      .map((f) => path.relative(ROOT, f));
    expect(checked.length).toBeGreaterThan(140);
    expect(missing).toEqual([]);
  });

  test('typecheck script is a real tsc run and CI does not tolerate failures', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts.typecheck).toMatch(/^tsc -p tsconfig\.typecheck\.json/);
    const ci = workflows.find((w) => w.file === 'ci.yml').text;
    const step = ci.slice(ci.indexOf('name: Type-check'), ci.indexOf('run: npm run typecheck'));
    expect(step).not.toMatch(/continue-on-error/);
  });
});
