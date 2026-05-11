/**
 * @typedef {import('../../domain/workflow/workflow.js').Workflow} Workflow
 *
 * @typedef {object} WorkflowRepository
 * @property {(id: string) => Promise<Workflow|null>} findById
 * @property {(workflow: Workflow, uow?: any) => Promise<void>} save
 * @property {(id: string) => Promise<{ status: string, version: number }|null>} status
 */

export const WorkflowRepositoryPort = Symbol('WorkflowRepository');
