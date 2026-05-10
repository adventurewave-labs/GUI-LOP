/**
 * bcrypt-password-hasher.js — PasswordHasher backed by bcrypt.
 *
 * Performance: bcrypt at work factor 12 takes ~150-300 ms per hash on
 * typical x86_64 hardware. Doing that synchronously on the event-loop
 * thread blocks every other request for the duration. To keep the API
 * responsive under bursts of logins, this module owns a small pool of
 * worker threads (`bcrypt-worker.js`) and dispatches `hash`/`compare`
 * to the least-busy worker via round-robin.
 *
 * Falls back to direct (in-thread) bcrypt when:
 *   - `NODE_ENV === 'test'` so unit/integration tests stay deterministic
 *     and don't pay the worker spawn cost on every test boot.
 *   - The optional `useWorkerPool: false` constructor flag is passed.
 *   - Worker creation fails (e.g. the worker entry was bundled away).
 *
 * The pool is lazily created on first use and torn down on `dispose()`.
 * Pool size defaults to `max(2, os.cpus().length - 1)` to leave one core
 * for the event loop.
 */
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import bcrypt from 'bcrypt';
import { PasswordHash } from '../../domain/user/password-hash.js';

const DEFAULT_ROUNDS = 12;

/**
 * Resolve the worker entry path. Uses `import.meta.url` when running as
 * native ESM (production), and falls back to `__dirname` when the file is
 * transpiled to CJS (jest+babel test sandbox).
 */
function resolveWorkerPath() {
  try {
    // eslint-disable-next-line no-new-func
    const meta = new Function('return import.meta')();
    if (meta && typeof meta.url === 'string') {
      return join(dirname(fileURLToPath(meta.url)), 'bcrypt-worker.js');
    }
  } catch {
    // Babel/CJS path below.
  }
  // CJS fallback: __dirname is defined when babel-jest transforms us to CJS.
  // eslint-disable-next-line no-undef
  if (typeof __dirname === 'string') {
    // eslint-disable-next-line no-undef
    return join(__dirname, 'bcrypt-worker.js');
  }
  // Last-ditch: assume the worker sits next to this file under the canonical path.
  return 'src/backend/contexts/identity-and-access/infrastructure/crypto/bcrypt-worker.js';
}

const WORKER_PATH = resolveWorkerPath();

/**
 * Round-robin worker pool. Each worker maintains an in-flight `Map<id, deferred>`
 * so multiple async requests can interleave on the same worker. We dispatch by
 * the worker with the fewest in-flight requests.
 */
class BcryptWorkerPool {
  constructor({ size }) {
    this.size = size;
    /** @type {{ worker: Worker, inflight: Map<number, {resolve, reject}> }[]} */
    this.workers = [];
    this._nextId = 1;
    this._disposed = false;
  }

  _spawn() {
    const worker = new Worker(WORKER_PATH);
    const inflight = new Map();
    const entry = { worker, inflight };
    worker.on('message', (msg) => {
      const deferred = inflight.get(msg.id);
      if (!deferred) return;
      inflight.delete(msg.id);
      if (msg.ok) deferred.resolve(msg.value);
      else deferred.reject(Object.assign(new Error(msg.error?.message ?? 'bcrypt worker error'), { code: msg.error?.code }));
    });
    worker.on('error', (err) => {
      // Reject every in-flight request and remove the worker; future calls will respawn.
      for (const deferred of inflight.values()) deferred.reject(err);
      inflight.clear();
      const idx = this.workers.indexOf(entry);
      if (idx >= 0) this.workers.splice(idx, 1);
    });
    worker.on('exit', () => {
      const idx = this.workers.indexOf(entry);
      if (idx >= 0) this.workers.splice(idx, 1);
    });
    this.workers.push(entry);
    return entry;
  }

  _pickWorker() {
    if (this.workers.length < this.size) return this._spawn();
    let best = this.workers[0];
    for (const w of this.workers) {
      if (w.inflight.size < best.inflight.size) best = w;
    }
    return best;
  }

  run(op, args) {
    if (this._disposed) {
      return Promise.reject(new Error('BcryptWorkerPool has been disposed'));
    }
    const entry = this._pickWorker();
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      entry.inflight.set(id, { resolve, reject });
      entry.worker.postMessage({ id, op, args });
    });
  }

  async dispose() {
    this._disposed = true;
    const all = this.workers.slice();
    this.workers.length = 0;
    await Promise.all(all.map(({ worker }) => worker.terminate().catch(() => undefined)));
  }
}

let sharedPool = null;
function getSharedPool() {
  if (sharedPool) return sharedPool;
  const size = Math.max(2, (os.cpus()?.length ?? 2) - 1);
  sharedPool = new BcryptWorkerPool({ size });
  return sharedPool;
}

/** Disposes the shared bcrypt worker pool (used by graceful shutdown / tests). */
export async function disposeBcryptWorkerPool() {
  if (sharedPool) {
    await sharedPool.dispose();
    sharedPool = null;
  }
}

/**
 * Bcrypt-backed PasswordHasher. Same surface as before — `hash(plaintext)`
 * and `verify(plaintext, hash)` — with bcrypt CPU work optionally pushed
 * to a worker-thread pool so it doesn't block the event loop.
 */
export class BcryptPasswordHasher {
  /**
   * @param {{ rounds?: number, useWorkerPool?: boolean }} [opts]
   */
  constructor({ rounds = DEFAULT_ROUNDS, useWorkerPool } = {}) {
    this.rounds = rounds;
    // Default: enable the worker pool unless we're in tests (where the
    // overhead is unwanted and direct bcrypt is faster + deterministic).
    if (typeof useWorkerPool === 'boolean') {
      this._useWorkerPool = useWorkerPool;
    } else {
      this._useWorkerPool = process.env.NODE_ENV !== 'test';
    }
  }

  /** @param {string} plaintext */
  async hash(plaintext) {
    if (typeof plaintext !== 'string' || plaintext.length === 0) {
      throw new Error('plaintext must be a non-empty string');
    }
    const digest = await this._runHash(plaintext, this.rounds);
    return PasswordHash.fromTrustedHash(digest);
  }

  /**
   * @param {string} plaintext
   * @param {PasswordHash} hash
   */
  async verify(plaintext, hash) {
    if (!(hash instanceof PasswordHash)) {
      throw new Error('hash must be a PasswordHash VO');
    }
    if (typeof plaintext !== 'string' || plaintext.length === 0) {
      return false;
    }
    return this._runCompare(plaintext, hash.value);
  }

  async _runHash(plaintext, rounds) {
    if (!this._useWorkerPool) return bcrypt.hash(plaintext, rounds);
    try {
      return await getSharedPool().run('hash', [plaintext, rounds]);
    } catch {
      // Fall back to in-thread bcrypt so the request still completes.
      return bcrypt.hash(plaintext, rounds);
    }
  }

  async _runCompare(plaintext, hashString) {
    if (!this._useWorkerPool) return bcrypt.compare(plaintext, hashString);
    try {
      return await getSharedPool().run('compare', [plaintext, hashString]);
    } catch {
      return bcrypt.compare(plaintext, hashString);
    }
  }
}
