/**
 * PendingStepRepository port.
 *
 * Owns the projection of pending-step state. Indexed by `(workflowId, stepId)`.
 */
/* eslint-disable no-unused-vars */
export class PendingStepRepository {
  /**
   * Return open pending steps whose deadline is at or before `now`,
   * ordered by deadline ascending.
   * @param {Date} now
   * @param {number} [limit]
   * @returns {Promise<import('../../domain/pending-step/pending-step.js').PendingStep[]>}
   */
  async findOverdue(now, limit) { throw new Error('not implemented'); }

  /** @returns {Promise<import('../../domain/pending-step/pending-step.js').PendingStep|null>} */
  async findByKey(workflowId, stepId) { throw new Error('not implemented'); }

  /**
   * Insert or update a pending step.
   * @param {import('../../domain/pending-step/pending-step.js').PendingStep} step
   * @param {object} [uow]
   */
  async upsert(step, uow) { throw new Error('not implemented'); }

  async remove(workflowId, stepId, uow) { throw new Error('not implemented'); }

  /**
   * Optional: list all open pending steps. Used by inbox query.
   * Implementations should support filtering when supplied.
   */
  async list(filter) { throw new Error('not implemented'); }
}
