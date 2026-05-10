/**
 * EndpointAddress — VO validated against the subscription's channel.
 *
 * - websocket: free-form connection id (no validation)
 * - email:     RFC-5322 lite check
 * - webhook:   http(s) URL
 */

import { ValidationError } from '../../../../shared/kernel/errors.js';
import { CHANNELS } from './channel.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class EndpointAddress {
  constructor({ channel, value }) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new ValidationError('EndpointAddress.value must be a non-empty string');
    }
    const ch = typeof channel === 'string' ? channel : channel?.value;
    if (!ch) {
      throw new ValidationError('EndpointAddress.channel is required');
    }

    switch (ch) {
      case CHANNELS.EMAIL:
        if (!EMAIL_RE.test(value)) {
          throw new ValidationError(`Invalid email address: ${value}`);
        }
        break;
      case CHANNELS.WEBHOOK:
        try {
          const u = new URL(value);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') {
            throw new ValidationError(`Webhook URL must be http(s): ${value}`);
          }
        } catch (e) {
          if (e instanceof ValidationError) throw e;
          throw new ValidationError(`Invalid webhook URL: ${value}`);
        }
        break;
      case CHANNELS.WEBSOCKET:
        // connection id; no further checks
        break;
      default:
        throw new ValidationError(`Unsupported channel: ${ch}`);
    }

    this.channel = ch;
    this.value = value;
    Object.freeze(this);
  }

  static of(spec) {
    return new EndpointAddress(spec);
  }

  toJSON() {
    return { channel: this.channel, value: this.value };
  }
}
