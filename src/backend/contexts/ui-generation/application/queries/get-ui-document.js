export class GetUIDocumentQuery {
  constructor({ uiDocumentRepository }) {
    this._docs = uiDocumentRepository;
  }

  async execute({ id }) {
    return this._docs.findById(id);
  }
}
