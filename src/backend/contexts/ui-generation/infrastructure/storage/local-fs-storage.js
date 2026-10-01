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
    this._baseDir = path.resolve(baseDir);
    this._urlPrefix = urlPrefix;
  }

  /**
   * Resolve `key` under the base directory, refusing anything that would
   * escape it (`../`, absolute paths, NUL bytes).
   */
  _resolve(key) {
    if (typeof key !== 'string' || key.length === 0 || key.includes('\0')) {
      throw new Error('LocalFsStorage: invalid key');
    }
    const target = path.resolve(this._baseDir, key);
    if (target !== this._baseDir && !target.startsWith(this._baseDir + path.sep)) {
      throw new Error('LocalFsStorage: key escapes base directory');
    }
    return target;
  }

  async put(key, content) {
    const target = this._resolve(key);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- contained by _resolve
    await fs.mkdir(path.dirname(target), { recursive: true });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- contained by _resolve
    await fs.writeFile(target, content, 'utf8');
  }

  async get(key) {
    const target = this._resolve(key);
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- contained by _resolve
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
