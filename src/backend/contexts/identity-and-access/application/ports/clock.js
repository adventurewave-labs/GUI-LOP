/**
 * @typedef {Object} Clock
 * @property {() => Date} now
 */

export const systemClock = { now: () => new Date() };
