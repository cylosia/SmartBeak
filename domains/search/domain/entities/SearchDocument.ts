/**
* Fields that can be indexed in a search document
*/
export interface SearchDocumentFields {
  title?: string;
  content?: string;
  tags?: string[];
  [key: string]: unknown;
}

/**
* SearchDocument - Immutable domain entity representing a document in the search index
*
* Documents are stored with a set of fields that can be searched and filtered.
* Documents can be marked as deleted without removing them from the index immediately.
*/
export class SearchDocument {
  private constructor(
  public readonly id: string,
  public readonly indexId: string,
  public readonly fields: SearchDocumentFields,
  public readonly status: 'indexed' | 'deleted'
  ) {}

  /**
  * Create a new search document
  */
  static create(
  id: string,
  indexId: string,
  fields: SearchDocumentFields,
  status: 'indexed' | 'deleted' = 'indexed'
  ): SearchDocument {
  return new SearchDocument(id, indexId, JSON.parse(JSON.stringify(fields)), status);
  }

  /**
  * Reconstitute from persistence
  */
  static reconstitute(
  id: string,
  indexId: string,
  fields: SearchDocumentFields,
  status: 'indexed' | 'deleted'
  ): SearchDocument {
  return new SearchDocument(id, indexId, JSON.parse(JSON.stringify(fields)), status);
  }

  /**
  * Create a copy with updated fields (immutable update)
  */
  withFields(fields: SearchDocumentFields): SearchDocument {
  return new SearchDocument(this["id"], this.indexId, JSON.parse(JSON.stringify({ ...this.fields, ...fields })), this["status"]);
  }

  /**
  * Create a copy with deleted status
  */
  markDeleted(): SearchDocument {
  return new SearchDocument(this["id"], this.indexId, this.fields, 'deleted');
  }
}
