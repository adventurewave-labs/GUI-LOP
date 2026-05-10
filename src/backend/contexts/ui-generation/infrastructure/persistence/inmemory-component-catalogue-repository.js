/**
 * In-memory component catalogue, seeded with the default GUI-LOP catalogue.
 */

import { ComponentCatalogueRepository } from '../../application/ports/component-catalogue-repository.js';

const SEED = [
  { name: 'text-input', version: '1.0.0', kind: 'input' },
  { name: 'select', version: '1.0.0', kind: 'input' },
  { name: 'textarea', version: '1.0.0', kind: 'input' },
  { name: 'boolean-checkbox', version: '1.0.0', kind: 'input' },
  { name: 'date-picker', version: '1.0.0', kind: 'input' },
  { name: 'submit-button', version: '1.0.0', kind: 'action' },
  { name: 'dashboard-card', version: '1.0.0', kind: 'display' }
];

export class InMemoryComponentCatalogueRepository extends ComponentCatalogueRepository {
  constructor(extra = []) {
    super();
    this._byName = new Map();
    [...SEED, ...extra].forEach((c) => this._add(c));
  }

  _add(component) {
    if (!this._byName.has(component.name)) this._byName.set(component.name, []);
    this._byName.get(component.name).push({ ...component });
  }

  has(name, version) {
    const arr = this._byName.get(name);
    if (!arr) return false;
    return arr.some((c) => c.version === version);
  }

  latestVersion(name) {
    const arr = this._byName.get(name);
    if (!arr || arr.length === 0) return null;
    return arr.map((c) => c.version).sort().reverse()[0];
  }

  async list() {
    const out = [];
    for (const arr of this._byName.values()) {
      for (const c of arr) out.push({ ...c });
    }
    return out;
  }
}
