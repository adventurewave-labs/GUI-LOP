import { randomUUID, randomBytes } from 'node:crypto';

/**
 * @typedef {Object} IdGenerator
 * @property {() => string} newId
 * @property {(bytes: number) => Buffer} randomBytes
 */

/** Default UUID-based id generator (uses node:crypto). */
export const defaultIdGenerator = {
  newId: () => randomUUID(),
  randomBytes: (n) => randomBytes(n),
};
