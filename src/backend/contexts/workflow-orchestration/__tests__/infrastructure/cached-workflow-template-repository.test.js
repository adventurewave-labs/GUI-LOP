/**
 * cached-workflow-template-repository.test.js
 *
 * Verifies the LRU + TTL + invalidation contract of the cache decorator.
 * Uses a stub delegate so we can count round-trips.
 */
import { CachedWorkflowTemplateRepository } from '../../infrastructure/persistence/cached-workflow-template-repository.js';

function makeStubDelegate(initial = {}) {
  const calls = { findCurrent: 0, findVersion: 0, save: 0, list: 0 };
  const stored = new Map(); // key -> Map<version, snapshot>
  for (const [k, versions] of Object.entries(initial)) {
    const m = new Map();
    for (const [v, snap] of Object.entries(versions)) m.set(Number(v), snap);
    stored.set(k, m);
  }
  return {
    calls,
    stored,
    async findCurrent(key) {
      calls.findCurrent += 1;
      const versions = stored.get(key);
      if (!versions || versions.size === 0) return null;
      const sorted = [...versions.entries()].sort(([a], [b]) => b - a);
      return sorted[0][1];
    },
    async findVersion(key, version) {
      calls.findVersion += 1;
      const v = typeof version === 'number' ? version : Number.parseInt(version, 10);
      const versions = stored.get(key);
      return versions?.get(v) ?? null;
    },
    async save(template) {
      calls.save += 1;
      const k = template.key.value;
      if (!stored.has(k)) stored.set(k, new Map());
      stored.get(k).set(template.version.value, { ...template });
    },
    async list() {
      calls.list += 1;
      return [];
    },
  };
}

function makeTemplate(key, version, name = `template-${key}-v${version}`) {
  return {
    key: { value: key },
    version: { value: version },
    name,
  };
}

describe('CachedWorkflowTemplateRepository', () => {
  test('findCurrent caches the underlying call (cache hit on second call)', async () => {
    const delegate = makeStubDelegate({ flow: { 1: makeTemplate('flow', 1) } });
    const cached = new CachedWorkflowTemplateRepository({ delegate });

    const a = await cached.findCurrent('flow');
    const b = await cached.findCurrent('flow');
    expect(a).toEqual(b);
    expect(delegate.calls.findCurrent).toBe(1);
    expect(cached.metrics.hits).toBe(1);
    expect(cached.metrics.misses).toBe(1);
  });

  test('findVersion caches by (key, version)', async () => {
    const delegate = makeStubDelegate({ flow: { 1: makeTemplate('flow', 1), 2: makeTemplate('flow', 2) } });
    const cached = new CachedWorkflowTemplateRepository({ delegate });

    await cached.findVersion('flow', 1);
    await cached.findVersion('flow', 1); // hit
    await cached.findVersion('flow', 2); // miss
    await cached.findVersion('flow', 2); // hit
    expect(delegate.calls.findVersion).toBe(2);
    expect(cached.metrics.hits).toBe(2);
    expect(cached.metrics.misses).toBe(2);
  });

  test('TTL expiry causes a re-fetch', async () => {
    const delegate = makeStubDelegate({ flow: { 1: makeTemplate('flow', 1) } });
    let now = 0;
    const cached = new CachedWorkflowTemplateRepository({
      delegate,
      ttlMs: 100,
      now: () => now,
    });
    await cached.findCurrent('flow');
    expect(delegate.calls.findCurrent).toBe(1);
    now = 50;
    await cached.findCurrent('flow'); // still fresh
    expect(delegate.calls.findCurrent).toBe(1);
    now = 200;
    await cached.findCurrent('flow'); // expired
    expect(delegate.calls.findCurrent).toBe(2);
  });

  test('LRU eviction respects maxEntries', async () => {
    const initial = {};
    for (let i = 0; i < 10; i += 1) {
      initial[`k${i}`] = { 1: makeTemplate(`k${i}`, 1) };
    }
    const delegate = makeStubDelegate(initial);
    const cached = new CachedWorkflowTemplateRepository({ delegate, maxEntries: 3 });

    // Pull 5 distinct keys -> only the last 3 (k2, k3, k4) should remain.
    for (let i = 0; i < 5; i += 1) {
      await cached.findCurrent(`k${i}`);
    }
    expect(cached.size()).toBe(3);
    expect(delegate.calls.findCurrent).toBe(5);

    // Re-read k0 (evicted) -> miss.
    await cached.findCurrent('k0');
    expect(delegate.calls.findCurrent).toBe(6);
    // Re-read k4 (still cached) -> hit.
    const before = delegate.calls.findCurrent;
    await cached.findCurrent('k4');
    expect(delegate.calls.findCurrent).toBe(before);
  });

  test('save() invalidates current and every version entry for that key', async () => {
    const delegate = makeStubDelegate({
      flow: { 1: makeTemplate('flow', 1), 2: makeTemplate('flow', 2) },
      other: { 1: makeTemplate('other', 1) },
    });
    const cached = new CachedWorkflowTemplateRepository({ delegate });

    // Prime the cache.
    await cached.findCurrent('flow');
    await cached.findVersion('flow', 1);
    await cached.findVersion('flow', 2);
    await cached.findCurrent('other');
    expect(cached.size()).toBe(4);

    // Save a NEW version of `flow`.
    await cached.save(makeTemplate('flow', 3));

    // `flow` entries should be gone; `other` entry survives.
    expect(cached.size()).toBe(1);
    expect(cached.metrics.invalidations).toBeGreaterThanOrEqual(3);

    // The next findCurrent('flow') goes through the delegate again.
    const before = delegate.calls.findCurrent;
    await cached.findCurrent('flow');
    expect(delegate.calls.findCurrent).toBe(before + 1);

    // `other` is still cached.
    const otherBefore = delegate.calls.findCurrent;
    await cached.findCurrent('other');
    expect(delegate.calls.findCurrent).toBe(otherBefore);
  });

  test('invalidateAll wipes the cache', async () => {
    const delegate = makeStubDelegate({ flow: { 1: makeTemplate('flow', 1) } });
    const cached = new CachedWorkflowTemplateRepository({ delegate });
    await cached.findCurrent('flow');
    expect(cached.size()).toBe(1);
    cached.invalidateAll();
    expect(cached.size()).toBe(0);
  });

  test('list() is proxied verbatim and not cached', async () => {
    const delegate = makeStubDelegate();
    const cached = new CachedWorkflowTemplateRepository({ delegate });
    await cached.list();
    await cached.list();
    expect(delegate.calls.list).toBe(2);
  });

  test('throws if delegate is missing', () => {
    expect(() => new CachedWorkflowTemplateRepository({})).toThrow(/delegate/);
  });
});
