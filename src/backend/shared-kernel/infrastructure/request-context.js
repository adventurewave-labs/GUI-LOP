/**
 * request-context — per-request ambient context via AsyncLocalStorage.
 *
 * Lets any layer (logger, outbound HTTP adapters, audit) read the current
 * `request_id` / `user_id` / `trace_id` without threading them through every
 * function signature. Outside a request (boot, background workers) the
 * context is simply empty.
 *
 * The stored object is mutable on purpose: the auth middleware runs *after*
 * the context is opened and enriches it with the authenticated principal.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();

/**
 * Run `fn` inside a fresh context seeded with `fields`.
 * @template T
 * @param {Record<string, unknown>} fields
 * @param {() => T} fn
 * @returns {T}
 */
export function runWithContext(fields, fn) {
  return als.run({ ...fields }, fn);
}

/** Current context (a live reference) or `undefined` outside a request. */
export function getContext() {
  return als.getStore();
}

/**
 * Set a field on the current context. No-op outside a request.
 * @param {string} key
 * @param {unknown} value
 */
export function setContextField(key, value) {
  const store = als.getStore();
  if (store && value !== undefined && value !== null) store[key] = value;
}
