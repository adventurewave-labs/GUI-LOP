import { ObjectStorage } from '../../application/ports/object-storage.js';

export class InMemoryStorage extends ObjectStorage {
  constructor({ urlPrefix = '/ui-documents' } = {}) {
    super();
    this._urlPrefix = urlPrefix;
    this._items = new Map();
  }

  async put(key, content) {
    this._items.set(key, content);
  }

  async get(key) {
    return this._items.get(key) ?? null;
  }

  getUrl(key) {
    return `${this._urlPrefix}/${key}`;
  }

  size() {
    return this._items.size;
  }
}
