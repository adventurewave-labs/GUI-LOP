/**
 * bcrypt-worker.js — worker entry point for offloading bcrypt CPU work.
 *
 * Listens for `{ id, op, args }` messages on the parent port, runs the
 * matching bcrypt op, and replies with `{ id, ok: true, value }` or
 * `{ id, ok: false, error: { message, code } }`. The worker is spawned by
 * `BcryptPasswordHasher` and pooled so a single worker can serve many
 * concurrent verify/hash calls without being torn down.
 *
 * Operations:
 *   - 'hash':    args = [plaintext, rounds]              -> string digest
 *   - 'compare': args = [plaintext, hashString]          -> boolean
 *
 * Pure ESM. No state beyond the bcrypt module itself.
 */
import { parentPort } from 'node:worker_threads';
import bcrypt from 'bcrypt';

if (!parentPort) {
  throw new Error('bcrypt-worker.js must be spawned as a worker thread');
}

parentPort.on('message', async (msg) => {
  const { id, op, args } = msg ?? {};
  try {
    let value;
    switch (op) {
      case 'hash': {
        const [plaintext, rounds] = args;
        value = await bcrypt.hash(plaintext, rounds);
        break;
      }
      case 'compare': {
        const [plaintext, hashString] = args;
        value = await bcrypt.compare(plaintext, hashString);
        break;
      }
      default:
        throw new Error(`unknown bcrypt-worker op: ${op}`);
    }
    parentPort.postMessage({ id, ok: true, value });
  } catch (err) {
    parentPort.postMessage({
      id,
      ok: false,
      error: { message: err?.message ?? String(err), code: err?.code ?? null },
    });
  }
});
