import { randomUUID } from 'node:crypto';

/**
 * UuidGenerator — production implementation of the IdGenerator port.
 * Uses the platform CSPRNG via crypto.randomUUID().
 *
 * Both `newId()` (canonical port name) and `next()` (legacy alias used by
 * Phase 1/2/4-6 contexts) are exposed so callers using either method work.
 */
export class UuidGenerator {
  /** Returns a fresh UUID v4 string. */
  newId() {
    return randomUUID();
  }

  /** Alias for {@link UuidGenerator#newId}. */
  next() {
    return randomUUID();
  }
}

/** Singleton instance. */
export const uuidGenerator = new UuidGenerator();
