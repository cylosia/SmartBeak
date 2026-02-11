/**
* SeoDocument - Immutable domain entity representing SEO metadata
*/
export class SeoDocument {
  private constructor(
  public readonly id: string,
  public readonly title: string,
  public readonly description: string,
  public readonly updatedAt: Date
  ) {}

  /**
  * Create a new SEO document
  * @param id - Unique identifier
  * @param title - Page title
  * @param description - Meta description
  * @returns New SeoDocument instance
  */
  static create(id: string, title: string, description: string): SeoDocument {
  return new SeoDocument(id, title, description, new Date());
  }

  /**
  * Reconstitute from persistence
  * @param id - Unique identifier
  * @param title - Page title
  * @param description - Meta description
  * @param updatedAt - Last updated timestamp
  * @returns New SeoDocument instance
  */
  static reconstitute(
  id: string,
  title: string,
  description: string,
  updatedAt: Date
  ): SeoDocument {
  return new SeoDocument(id, title, description, updatedAt);
  }

  /**
  * Update SEO metadata - returns new immutable instance
  * @param title - New title (optional - keeps current if not provided)
  * @param description - New description (optional - keeps current if not provided)
  * @returns New SeoDocument with updated values
  */
  update(title?: string, description?: string): SeoDocument {
  const newTitle = title ?? this["title"];
  const newDescription = description ?? this.description;
  if (this["title"] === newTitle && this.description === newDescription) {
    return this;
  }
  return new SeoDocument(this["id"], newTitle, newDescription, new Date());
  }

  /**
  * Update title only - returns new immutable instance
  * @param title - New title
  * @returns New SeoDocument with updated title
  */
  updateTitle(title: string): SeoDocument {
  if (this["title"] === title) {
    return this;
  }
  return new SeoDocument(this["id"], title, this.description, new Date());
  }

  /**
  * Update description only - returns new immutable instance
  * @param description - New description
  * @returns New SeoDocument with updated description
  */
  updateDescription(description: string): SeoDocument {
  if (this.description === description) {
    return this;
  }
  return new SeoDocument(this["id"], this["title"], description, new Date());
  }
}
