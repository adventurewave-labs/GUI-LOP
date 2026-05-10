/**
 * RegisterWebhook — convenience command around Subscribe with channel='webhook'.
 */

import { SubscribeCommand } from './subscribe.js';

export class RegisterWebhookCommand {
  constructor(deps) {
    this._subscribe = new SubscribeCommand(deps);
  }

  async execute({ subscriberRef, url, filter }) {
    return this._subscribe.execute({
      subscriberKind: 'webhook',
      subscriberRef,
      channel: 'webhook',
      address: url,
      filter
    });
  }
}
