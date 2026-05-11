/**
 * ComponentCatalogueRepository — exposes the available UI components and their
 * versions. Methods are sync where possible because the catalogue is small and
 * loaded at boot.
 */

export class ComponentCatalogueRepository {
  has(_name, _version) { throw new Error('ComponentCatalogueRepository.has is abstract'); }
  latestVersion(_name) {
    throw new Error('ComponentCatalogueRepository.latestVersion is abstract');
  }
  async list() { throw new Error('ComponentCatalogueRepository.list is abstract'); }
}
