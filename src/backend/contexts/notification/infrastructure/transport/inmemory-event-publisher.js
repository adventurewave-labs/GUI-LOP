import { EventPublisher } from '../../application/ports/event-publisher.js';

export class InMemoryEventPublisher extends EventPublisher {
  constructor() {
    super();
    this._handlers = new Map(); // channel -> Set<handler>
    this._published = []; // {channel, envelope}
  }

  async publish(channel, envelope) {
    this._published.push({ channel, envelope });
    const set = this._handlers.get(channel);
    if (!set) return;
    for (const h of set) {
      await h(envelope);
    }
  }

  async subscribe(channel, handler) {
    if (!this._handlers.has(channel)) this._handlers.set(channel, new Set());
    this._handlers.get(channel).add(handler);
    return () => this._handlers.get(channel)?.delete(handler);
  }

  publishedFor(channel) {
    return this._published.filter((x) => x.channel === channel);
  }

  async close() {
    this._handlers.clear();
  }
}
