/**
 * WorkflowContext — immutable JSON wrapper that evolves through
 * copy-on-write `merge()` calls.
 */
export class WorkflowContext {
  /** @private */
  constructor(data) {
    this._data = data;
    Object.freeze(this);
  }

  static empty() {
    return new WorkflowContext(Object.freeze({}));
  }

  static of(data) {
    if (data === undefined || data === null) return WorkflowContext.empty();
    if (typeof data !== 'object' || Array.isArray(data)) {
      return new WorkflowContext(Object.freeze({ value: cloneDeep(data) }));
    }
    return new WorkflowContext(Object.freeze(cloneDeep(data)));
  }

  toJSON() { return cloneDeep(this._data); }

  get(key) {
    const v = this._data?.[key];
    return v === undefined ? undefined : cloneDeep(v);
  }

  merge(patch) {
    if (!patch || typeof patch !== 'object') return this;
    return new WorkflowContext(
      Object.freeze({ ...this._data, ...cloneDeep(patch) }),
    );
  }

  equals(other) {
    if (!(other instanceof WorkflowContext)) return false;
    return JSON.stringify(this._data) === JSON.stringify(other._data);
  }
}

function cloneDeep(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}
