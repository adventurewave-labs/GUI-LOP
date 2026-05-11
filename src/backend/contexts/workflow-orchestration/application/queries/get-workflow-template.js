import { TemplateNotFoundError } from '../../domain/errors.js';

export class GetWorkflowTemplateQuery {
  constructor({ templates }) {
    this._templates = templates;
  }

  async execute(input) {
    const t = input.version
      ? await this._templates.findVersion(input.key, input.version)
      : await this._templates.findCurrent(input.key);
    if (!t) throw new TemplateNotFoundError(input.key, input.version);
    return {
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
}
