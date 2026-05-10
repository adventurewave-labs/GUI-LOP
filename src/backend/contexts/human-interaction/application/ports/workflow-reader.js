/**
 * WorkflowReader port — read-only summary of a workflow needed for step
 * lookup, payload schema retrieval and scope computation.
 *
 * The Workflow Orchestration context is the source of truth; this port
 * lets us depend on a small, query-only contract.
 */
/* eslint-disable no-unused-vars */
export class WorkflowReader {
  /**
   * @param {string} workflowId
   * @returns {Promise<{
   *   id: string,
   *   status: string,
   *   scope?: string,
   *   steps?: Array<{
   *     id: string,
   *     name?: string,
   *     status?: string,
   *     allowedActions?: string[],
   *     responseSchema?: object,
   *     uiDocumentId?: string,
   *     deadline?: Date,
   *     onTimeout?: string,
   *     eligibility?: object
   *   }>
   * }|null>}
   */
  async getSummary(workflowId) { throw new Error('not implemented'); }

  /**
   * @returns {Promise<object|null>}  the matching step descriptor
   */
  async getStep(workflowId, stepId) { throw new Error('not implemented'); }
}
