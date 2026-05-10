/**
 * HumanResponseRepository port.
 *
 * Implementations are provided by the infrastructure layer (Postgres,
 * in-memory). The application layer depends only on this contract.
 */
/* eslint-disable no-unused-vars */
export class HumanResponseRepository {
  /** @returns {Promise<import('../../domain/human-response/human-response.js').HumanResponse|null>} */
  async findById(id) { throw new Error('not implemented'); }

  /** @returns {Promise<import('../../domain/human-response/human-response.js').HumanResponse|null>} */
  async findFor(workflowId, stepId) { throw new Error('not implemented'); }

  /** @returns {Promise<import('../../domain/human-response/human-response.js').HumanResponse|null>} */
  async findByIdempotencyKey(workflowId, stepId, idempotencyKey) { throw new Error('not implemented'); }

  /**
   * Persist the response (and queue its events on the outbox if `uow` carries one).
   * @param {import('../../domain/human-response/human-response.js').HumanResponse} response
   * @param {object} [uow]
   */
  async save(response, uow) { throw new Error('not implemented'); }
}
