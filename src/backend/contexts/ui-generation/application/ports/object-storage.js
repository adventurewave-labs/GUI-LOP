export class ObjectStorage {
  async put(_key, _content) { throw new Error('ObjectStorage.put is abstract'); }
  async get(_key) { throw new Error('ObjectStorage.get is abstract'); }
  getUrl(_key) { throw new Error('ObjectStorage.getUrl is abstract'); }
}
