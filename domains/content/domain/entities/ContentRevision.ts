/**
* ContentRevision - Immutable domain entity representing a content snapshot
*/
export class ContentRevision {
  private constructor(
  public readonly id: string,
  public readonly contentId: string,
  public readonly title: string,
  public readonly body: string,
  public readonly createdAt: Date
  ) {}

  /**
  * Create a new content revision
  * @param id - Unique identifier for the revision
  * @param contentId - Associated content item ID
  * @param title - Content title at time of revision
  * @param body - Content body at time of revision
  * @param createdAt - Timestamp of the revision
  * @returns New ContentRevision instance
  */
  static create(
  id: string,
  contentId: string,
  title: string,
  body: string,
  createdAt: Date = new Date()
  ): ContentRevision {
  return new ContentRevision(id, contentId, title, body, createdAt);
  }

  /**
  * Reconstitute from persistence
  */
  static reconstitute(
  id: string,
  contentId: string,
  title: string,
  body: string,
  createdAt: Date
  ): ContentRevision {
  return new ContentRevision(id, contentId, title, body, createdAt);
  }

  /**
  * Get content size in bytes
  */
  getSize(): number {
  return Buffer.byteLength(this["body"], 'utf8');
  }

  /**
  * Check if body is empty
  */
  hasContent(): boolean {
  return this["body"].trim().length > 0;
  }

  /**
  * Get excerpt of content (first N characters)
  * @param length - Number of characters to include
  */
  getExcerpt(length: number = 200): string {
  if (this["body"].length <= length) {
    return this["body"];
  }
  return this["body"].substring(0, length).trim() + '...';
  }
}
