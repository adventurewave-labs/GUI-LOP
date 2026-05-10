import { ValidationError } from '../../../shared-kernel/domain/errors.js';
export const LAYOUT_KINDS = Object.freeze({
  STACK: 'stack',
  GRID: 'grid',
  TABS: 'tabs',
  FORM: 'form'
});

const ALL = new Set(Object.values(LAYOUT_KINDS));

export class Layout {
  constructor({ kind = LAYOUT_KINDS.STACK, regions = [] } = {}) {
    if (!ALL.has(kind)) throw new ValidationError(`Unknown layout kind: ${kind}`);
    if (!Array.isArray(regions)) throw new ValidationError('Layout.regions must be an array');
    this.kind = kind;
    this.regions = Object.freeze(regions.map((r) => ({ ...r, fields: [...(r.fields ?? [])] })));
    Object.freeze(this);
  }

  static of(spec) {
    return new Layout(spec ?? {});
  }

  toJSON() {
    return { kind: this.kind, regions: this.regions.map((r) => ({ ...r })) };
  }
}
