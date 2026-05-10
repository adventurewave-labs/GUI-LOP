/**
 * ProjectionUpdater — subscribes to all event types and dispatches to
 * registered per-type handlers. Default behaviour is no-op so that downstream
 * specific handlers can extend it.
 */

export class ProjectionUpdater {
  constructor() {
    this._handlers = new Map(); // type -> handler[]
    this._processed = 0;
  }

  on(type, handler) {
    if (!this._handlers.has(type)) this._handlers.set(type, []);
    this._handlers.get(type).push(handler);
    return this;
  }

  async handle(event) {
    const list = this._handlers.get(event.type) ?? [];
    for (const h of list) {
      await h(event);
    }
    this._processed += 1;
  }

  get processedCount() {
    return this._processed;
  }
}
