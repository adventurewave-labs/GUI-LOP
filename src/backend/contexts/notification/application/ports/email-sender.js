export class EmailSender {
  async send(_to, _envelope) {
    throw new Error('EmailSender.send is abstract');
  }
}
