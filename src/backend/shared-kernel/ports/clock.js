/**
 * Clock port — abstracts wall-clock time so domain code stays deterministic
 * and unit-testable. Implementations live in shared-kernel/infrastructure/.
 *
 * Interface:
 *   {
 *     now(): Date          // current instant
 *   }
 *
 * Domain code MUST NOT call Date.now() / new Date() directly; it must
 * accept a Clock via constructor injection.
 */
export const CLOCK_PORT = Symbol.for('shared-kernel/Clock');
