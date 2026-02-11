export type IndexStatus = 'active' | 'building' | 'deprecated';

/**
* SearchIndex - Immutable domain entity representing a search index
*
* State transitions:
*   building → active → deprecated
*/
export class SearchIndex {
  private constructor(
  public readonly id: string,
  public readonly domainId: string,
  public readonly name: string,
  public readonly version: number,
  public readonly status: IndexStatus
  ) {}

  /**
  * Create a new search index
  * @param id - Unique identifier
  * @param domainId - Domain ID
  * @param name - Index name
  * @param version - Index version
  * @param status - Initial status
  * @returns New SearchIndex instance
  */
  static create(
  id: string,
  domainId: string,
  name: string,
  version: number = 1,
  status: IndexStatus = 'building'
  ): SearchIndex {
  return new SearchIndex(id, domainId, name, version, status);
  }

  /**
  * Reconstitute from persistence
  */
  static reconstitute(
  id: string,
  domainId: string,
  name: string,
  version: number,
  status: IndexStatus
  ): SearchIndex {
  return new SearchIndex(id, domainId, name, version, status);
  }

  /**
  * Activate index - returns new immutable instance
  * @returns New SearchIndex with 'active' status
  * @throws Error if index is not in 'building' status
  */
  activate(): SearchIndex {
  if (this.status !== 'building') {
    throw new Error('Only building indexes can be activated');
  }
  return new SearchIndex(this.id, this.domainId, this.name, this.version, 'active');
  }

  /**
  * Deprecate index - returns new immutable instance
  * @returns New SearchIndex with 'deprecated' status
  */
  deprecate(): SearchIndex {
  if (this.status === 'deprecated') {
    throw new Error('Index is already deprecated');
  }
  return new SearchIndex(this.id, this.domainId, this.name, this.version, 'deprecated');
  }

  /**
  * Create new version - returns new immutable instance with incremented version
  * @returns New SearchIndex with incremented version and 'building' status
  */
  createNewVersion(newId: string): SearchIndex {
  return new SearchIndex(
    newId,
    this.domainId,
    this.name,
    this.version + 1,
    'building'
  );
  }

  /**
  * Check if index is active
  */
  isActive(): boolean {
  return this.status === 'active';
  }

  /**
  * Check if index is building
  */
  isBuilding(): boolean {
  return this.status === 'building';
  }

  /**
  * Check if index is deprecated
  */
  isDeprecated(): boolean {
  return this.status === 'deprecated';
  }
}
