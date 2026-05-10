import { WorkflowTemplate } from '../../domain/template/workflow-template.js';

export class InMemoryWorkflowTemplateRepository {
  constructor() {
    /** @type {Map<string, Map<number, object>>} */
    this._byKey = new Map();
    this.publishedEvents = [];
  }

  async findCurrent(key) {
    const versions = this._byKey.get(key);
    if (!versions || versions.size === 0) return null;
    const ordered = [...versions.entries()].sort(([a], [b]) => b - a);
    const [, latest] = ordered.find(([, snap]) => snap.status === 'published')
      ?? ordered[0];
    return WorkflowTemplate.rehydrate(deepClone(latest));
  }

  async findVersion(key, version) {
    const v = typeof version === 'number' ? version : Number.parseInt(version, 10);
    const versions = this._byKey.get(key);
    if (!versions || !versions.has(v)) return null;
    return WorkflowTemplate.rehydrate(deepClone(versions.get(v)));
  }

  async save(template) {
    const key = template.key.value;
    if (!this._byKey.has(key)) this._byKey.set(key, new Map());
    const snap = serialise(template);
    this._byKey.get(key).set(template.version.value, snap);
    const events = template.pullEvents();
    this.publishedEvents.push(...events);
  }

  async list(filter = {}) {
    const out = [];
    for (const versions of this._byKey.values()) {
      const ordered = [...versions.entries()].sort(([a], [b]) => b - a);
      const target = filter.activeOnly
        ? ordered.find(([, s]) => s.status === 'published')
        : ordered[0];
      if (target) out.push(WorkflowTemplate.rehydrate(deepClone(target[1])));
    }
    return out;
  }
}

function serialise(t) {
  return {
    key: t.key.value,
    version: t.version.value,
    name: t.name,
    description: t.description,
    steps: t.steps.map((s) => s.toJSON()),
    defaultConfig: t.defaultConfig,
    status: t.status,
    createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
    updatedAt: t.updatedAt instanceof Date ? t.updatedAt.toISOString() : t.updatedAt,
    publishedAt: t.publishedAt instanceof Date ? t.publishedAt.toISOString() : t.publishedAt,
    deprecatedAt: t.deprecatedAt instanceof Date ? t.deprecatedAt.toISOString() : t.deprecatedAt,
    createdBy: t.createdBy,
  };
}

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
