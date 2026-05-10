/**
 * cached-workflow-template-repository.js
 *
 * Read-through LRU + TTL cache decorator for the workflow template repo.
 *
 * Workflow templates are the most-read items in the platform: every
 * `CreateWorkflow` calls `findCurrent(template_key)` against Postgres.
 * Templates are also slow-changing (publish/deprecate happens at human
 * tempo). Wrapping the underlying repo in a small read-through cache
 * cuts a Postgres round-trip off every workflow creation.
 *
 * - `findCurrent(key)`              cache-key:  current:<key>
 * - `findVersion(key, version)`     cache-key:  version:<key>:<version>
 * - `save(template)`                writes through and INVALIDATES the
 *                                   `current:<key>` entry plus every
 *                                   `version:<key>:*` entry for that key.
 * - any other method                proxied verbatim, no caching.
 *
 * Bounded by `maxEntries` (default 100) — eviction is strict LRU based
 * on a recency Map (insertion-order = LRU). Per-entry TTL defaults to
 * 60 s. Both bounds are sized for development/typical-prod usage; tune
 * via the constructor in the composition root.
 */

export class CachedWorkflowTemplateRepository {
  /**
   * @param {object} opts
   * @param {object} opts.delegate    Underlying repository (pg or in-memory).
   * @param {number} [opts.ttlMs]     Entry TTL in ms (default 60_000).
   * @param {number} [opts.maxEntries] LRU max size (default 100).
   * @param {() => number} [opts.now] Clock; defaults to Date.now.
   */
  constructor({ delegate, ttlMs = 60_000, maxEntries = 100, now = () => Date.now() }) {
    if (!delegate) throw new Error('CachedWorkflowTemplateRepository requires { delegate }');
    this._delegate = delegate;
    this._ttlMs = ttlMs;
    this._maxEntries = maxEntries;
    this._now = now;
    /** @type {Map<string, {value: any, expiresAt: number}>} */
    this._cache = new Map();
    this.metrics = { hits: 0, misses: 0, invalidations: 0 };
  }

  /* ---------------- public repo surface ---------------- */

  async findCurrent(key) {
    const cacheKey = `current:${key}`;
    const cached = this._read(cacheKey);
    if (cached !== undefined) return cached;
    const value = await this._delegate.findCurrent(key);
    this._write(cacheKey, value);
    return value;
  }

  async findVersion(key, version) {
    const v = typeof version === 'number' ? version : Number.parseInt(version, 10);
    const cacheKey = `version:${key}:${v}`;
    const cached = this._read(cacheKey);
    if (cached !== undefined) return cached;
    const value = await this._delegate.findVersion(key, v);
    this._write(cacheKey, value);
    return value;
  }

  async save(template) {
    const out = await this._delegate.save(template);
    // Invalidate every entry tied to this template key.
    const key = template?.key?.value ?? template?.key ?? null;
    if (key != null) this._invalidateKey(key);
    return out;
  }

  // Pass-through: list/other queries don't get cached because they are
  // either cheap, infrequent, or filter-dependent.
  async list(filter) {
    return this._delegate.list(filter);
  }

  /* ---------------- escape hatches & introspection ---------------- */

  /** Clears the entire cache (e.g. after a bulk admin reload). */
  invalidateAll() {
    if (this._cache.size > 0) this.metrics.invalidations += this._cache.size;
    this._cache.clear();
  }

  /** Returns the current cache size (used by tests). */
  size() { return this._cache.size; }

  /* ---------------- private ---------------- */

  _read(cacheKey) {
    const entry = this._cache.get(cacheKey);
    if (!entry) {
      this.metrics.misses += 1;
      return undefined;
    }
    if (entry.expiresAt <= this._now()) {
      this._cache.delete(cacheKey);
      this.metrics.misses += 1;
      return undefined;
    }
    // LRU: re-insert to bump recency.
    this._cache.delete(cacheKey);
    this._cache.set(cacheKey, entry);
    this.metrics.hits += 1;
    return entry.value;
  }

  _write(cacheKey, value) {
    if (this._cache.has(cacheKey)) this._cache.delete(cacheKey);
    this._cache.set(cacheKey, { value, expiresAt: this._now() + this._ttlMs });
    while (this._cache.size > this._maxEntries) {
      const oldest = this._cache.keys().next().value;
      this._cache.delete(oldest);
    }
  }

  _invalidateKey(key) {
    const targets = [`current:${key}`];
    const versionPrefix = `version:${key}:`;
    for (const k of this._cache.keys()) {
      if (k.startsWith(versionPrefix)) targets.push(k);
    }
    for (const t of targets) {
      if (this._cache.delete(t)) this.metrics.invalidations += 1;
    }
  }
}
