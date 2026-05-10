import { EmailSender } from '../../application/ports/email-sender.js';

export class MockEmailSender extends EmailSender {
  constructor({ failOn } = {}) {
    super();
    this._sent = [];
    this._failOn = failOn ?? null; // predicate fn(to, envelope) => boolean
  }

  async send(to, envelope) {
    if (this._failOn && this._failOn(to, envelope)) {
      throw new Error(`MockEmailSender forced failure for ${to}`);
    }
    this._sent.push({ to, envelope });
  }

  sent() {
    return [...this._sent];
  }
}
