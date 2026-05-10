/**
 * WorkflowAdvancer port.
 *
 * Outbound port to the Workflow Orchestration bounded context. After a
 * human response is recorded, the use case calls `advance({workflowId})`
 * to ask Orchestration to resume execution.
 *
 * The in-process adapter delegates to Orchestration's `AdvanceWorkflow`
 * use case; an out-of-process implementation could call an HTTP/gRPC
 * endpoint instead.
 */
/* eslint-disable no-unused-vars */
export class WorkflowAdvancer {
  /**
   * @param {{workflowId: string, stepId?: string, response?: object}} args
   * @returns {Promise<void>}
   */
  async advance(args) { throw new Error('not implemented'); }
}
