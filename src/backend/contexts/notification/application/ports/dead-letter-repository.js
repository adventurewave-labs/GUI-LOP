/**
 * DeadLetterRepository port.
 */

export class DeadLetterRepository {
  async save(_record) {
    throw new Error('DeadLetterRepository.save is abstract');
  }

  async findById(_id) {
    throw new Error('DeadLetterRepository.findById is abstract');
  }

  async list({ limit = 100, offset = 0 } = {}) {
    throw new Error('DeadLetterRepository.list is abstract');
  }

  async delete(_id) {
    throw new Error('DeadLetterRepository.delete is abstract');
  }
}
