export class WebhookSender {
  async send(_url, _envelope) {
    throw new Error('WebhookSender.send is abstract');
  }
}
