export class UIDocumentRepository {
  async save(_doc) { throw new Error('UIDocumentRepository.save is abstract'); }
  async findById(_id) { throw new Error('UIDocumentRepository.findById is abstract'); }
  async findByStep(_workflowId, _stepId) {
    throw new Error('UIDocumentRepository.findByStep is abstract');
  }
}
