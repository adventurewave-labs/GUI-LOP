export class ListWorkflowTemplatesQuery {
  constructor({ templates }) {
    this._templates = templates;
  }

  async execute(filter = {}) {
    const templates = await this._templates.list(filter);
    return templates.map(toDTO);
  }
}

function toDTO(t) {
  return {
    id: t.key.value,
    template_key: t.key.value,
    version: t.version.value,
    name: t.name,
    description: t.description,
    status: t.status,
    steps: t.steps.map((s) => s.toJSON()),
    default_config: t.defaultConfig,
    created_at: t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
    updated_at: t.updatedAt instanceof Date ? t.updatedAt.toISOString() : t.updatedAt,
  };
}
