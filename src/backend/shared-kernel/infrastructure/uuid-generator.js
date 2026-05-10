import { randomUUID } from 'node:crypto';

/**
 * UuidGenerator — production implementation of the IdGenerator port.
 * Uses the platform CSPRNG via crypto.randomUUID().
 */
export class UuidGenerator {
  /** Returns a fresh UUID v4 string. */
  newId() {
    return randomUUID();
  }
}

/** Singleton instance. */
export const uuidGenerator = new UuidGenerator();
