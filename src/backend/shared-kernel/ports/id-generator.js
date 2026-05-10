/**
 * IdGenerator port — produces fresh identifiers (UUID v4 by default).
 * Implementations live in shared-kernel/infrastructure/.
 *
 * Interface:
 *   {
 *     newId(): string      // returns a UUID v4 string
 *   }
 *
 * Domain code uses Uuid.generate(idGen) to obtain a typed Uuid VO.
 */
export const ID_GENERATOR_PORT = Symbol.for('shared-kernel/IdGenerator');
