/**
 * LocalFsStorage — writes content blobs to a configurable directory under the
 * repo. URL is `/<urlPrefix>/<key>` (served by an Express static handler the
 * caller wires up).
 */

import { promises as fs } from 'fs';
import path from 'path';
import { ObjectStorage } from '../../application/ports/object-storage.js';

export class LocalFsStorage extends ObjectStorage {
  constructor({ baseDir = 'var/ui-documents', urlPrefix = '/ui-documents' } = {}) {
    super();
    this._baseDir = baseDir;
    this._urlPrefix = urlPrefix;
  }

  async put(key, content) {
    const target = path.resolve(this._baseDir, key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
  }

  async get(key) {
    const target = path.resolve(this._baseDir, key);
    try {
      return await fs.readFile(target, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  getUrl(key) {
    return `${this._urlPrefix}/${key}`;
  }
}
