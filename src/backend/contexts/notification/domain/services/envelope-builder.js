/**
 * EnvelopeBuilder — wraps a domain event into the wire envelope sent over the
 * subscription's channel. Pure.
 */

import { Envelope } from '../subscription/envelope.js';

export function build(event, _subscription) {
  return new Envelope({
    type: event.type,
    version: event.version ?? 1,
    payload: event.payload ?? {},
    occurredAt: event.occurredAt ?? new Date().toISOString()
  });
}
