export class ListUIComponentsQuery {
  constructor({ componentCatalogueRepository }) {
    this._cat = componentCatalogueRepository;
  }

  async execute() {
    return this._cat.list();
  }
}
