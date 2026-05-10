/**
 * SystemClock — production implementation of the Clock port backed by
 * the platform wall clock.
 */
export class SystemClock {
  /** Returns the current Date. */
  now() {
    return new Date();
  }
}

/** Singleton instance — ports are stateless so one instance is fine. */
export const systemClock = new SystemClock();
