/**
 * @typedef {import('../../domain/template/workflow-template.js').WorkflowTemplate} WorkflowTemplate
 *
 * @typedef {object} WorkflowTemplateRepository
 * @property {(key: string) => Promise<WorkflowTemplate|null>} findCurrent
 * @property {(key: string, version: number) => Promise<WorkflowTemplate|null>} findVersion
 * @property {(template: WorkflowTemplate, uow?: any) => Promise<void>} save
 * @property {(filter?: { activeOnly?: boolean }) => Promise<WorkflowTemplate[]>} list
 */

export const WorkflowTemplateRepositoryPort = Symbol('WorkflowTemplateRepository');
