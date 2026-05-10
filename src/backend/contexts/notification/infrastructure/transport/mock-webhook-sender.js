import { WebhookSender } from '../../application/ports/webhook-sender.js';

export class MockWebhookSender extends WebhookSender {
  constructor({ failOn } = {}) {
    super();
    this._sent = [];
    this._failOn = failOn ?? null;
  }

  async send(url, envelope) {
    if (this._failOn && this._failOn(url, envelope)) {
      throw new Error(`MockWebhookSender forced failure for ${url}`);
    }
    this._sent.push({ url, envelope });
  }

  sent() {
    return [...this._sent];
  }
}
