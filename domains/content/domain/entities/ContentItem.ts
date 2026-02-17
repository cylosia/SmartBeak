// P1-FIX: Removed BOM character from file
import { ContentScheduled } from '../events/ContentScheduled';
import { ContentPublished } from '../events/ContentPublished';

/**
* ContentItem Domain Entity
*
* Represents a piece of content within the system. Content items follow
* a lifecycle from draft → scheduled → published → archived.
*
* This entity is immutable - all state changes return new instances.
*
* @module domains/content/domain/entities/ContentItem
*/

export type ContentStatus = 'draft' | 'scheduled' | 'published' | 'archived';
export type ContentType = 'article' | 'page' | 'product' | 'review' | 'guide' | 'post' | 'image' | 'video';

export interface ContentItemProps {
  id: string;
  domainId: string;
  title: string;
  body: string;
  status: ContentStatus;
  contentType?: ContentType | undefined;
  publishAt?: Date | undefined;
  archivedAt?: Date | undefined;
  createdAt?: Date | undefined;
  updatedAt?: Date | undefined;
}

export class ContentItem {
  private _id: string;
  private _domainId: string;
  private _title: string;
  private _body: string;
  private _status: ContentStatus;
  private _contentType: ContentType;
  private _publishAt?: Date | undefined;
  private _archivedAt?: Date | undefined;
  private _createdAt: Date;
  private _updatedAt: Date;

  constructor(props: ContentItemProps) {
  this._id = props["id"];
  this._domainId = props.domainId;
  this._title = props["title"];
  this._body = props["body"];
  this._status = props["status"];
  this._contentType = props.contentType ?? 'article';
  this._publishAt = props.publishAt;
  this._archivedAt = props.archivedAt;
  this._createdAt = props["createdAt"] ?? new Date();
  this._updatedAt = props["updatedAt"] ?? new Date();

  this.validate();
  }

  // Getters for immutable access
  get id(): string { return this._id; }
  get domainId(): string { return this._domainId; }
  get title(): string { return this._title; }
  get body(): string { return this._body; }
  get status(): ContentStatus { return this._status; }
  get contentType(): ContentType { return this._contentType; }
  get publishAt(): Date | undefined { return this._publishAt; }
  get archivedAt(): Date | undefined { return this._archivedAt; }
  get createdAt(): Date { return this._createdAt; }
  get updatedAt(): Date { return this._updatedAt; }

  static createDraft(
  id: string,
  domainId: string,
  title = '',
  body = '',
  contentType: ContentType = 'article'
  ): ContentItem {
  const now = new Date();
  return new ContentItem({
    id,
    domainId,
    title,
    body,
    status: 'draft',
    contentType,
    createdAt: now,
    updatedAt: now,
  });
  }

  // P1-FIX: Added input validation constants and enhanced validation
  private static readonly VALIDATION = {
    MIN_ID_LENGTH: 3,
    MAX_TITLE_LENGTH: 500,
    MAX_BODY_LENGTH: 100000,
    VALID_STATUSES: ['draft', 'scheduled', 'published', 'archived'] as ContentStatus[],
  };

  private validate(): void {
    // P1-FIX: Input validation for ID
    if (!this._id || typeof this._id !== 'string') {
      throw new Error('Content ID is required and must be a string');
    }
    if (this._id.length < ContentItem.VALIDATION.MIN_ID_LENGTH) {
      throw new Error(`Content ID must be at least ${ContentItem.VALIDATION.MIN_ID_LENGTH} characters`);
    }
    // P1-FIX: Input validation for domainId
    if (!this._domainId || typeof this._domainId !== 'string') {
      throw new Error('Domain ID is required and must be a string');
    }
    // P1-FIX: Input validation for title
    if (this._title && typeof this._title === 'string' && this._title.length > ContentItem.VALIDATION.MAX_TITLE_LENGTH) {
      throw new Error(`Title must be less than ${ContentItem.VALIDATION.MAX_TITLE_LENGTH} characters`);
    }
    // P1-FIX: Input validation for body
    if (this._body && typeof this._body === 'string' && this._body.length > ContentItem.VALIDATION.MAX_BODY_LENGTH) {
      throw new Error(`Body must be less than ${ContentItem.VALIDATION.MAX_BODY_LENGTH} characters`);
    }
    // P1-FIX: Validate status is valid
    if (!ContentItem.VALIDATION.VALID_STATUSES.includes(this._status)) {
      throw new Error(`Invalid status: ${this._status}`);
    }
  }

  /**
  * Update draft content
  * Returns new instance (immutable update)
  */
  updateDraft(title: string, body: string): ContentItem {
  if (this._status !== 'draft' && this._status !== 'scheduled') {
    throw new Error('Cannot update content: only drafts and scheduled content can be edited');
  }

  const updates: Partial<ContentItemProps> = {
    title,
    body,
    updatedAt: new Date(),
  };

  // Editing invalidates schedule
  if (this._status === 'scheduled') {
    updates["status"] = 'draft';
    updates.publishAt = undefined;
  }

  return new ContentItem({ ...this.toProps(), ...updates });
  }

  /**
  * Schedule content for publishing
  * Returns new instance (immutable update)
  */
  schedule(publishAt: Date): { item: ContentItem; event: ReturnType<ContentScheduled['toEnvelope']> } {
  if (this._status !== 'draft') {
    throw new Error('Only drafts can be scheduled');
  }
  if (!this._title || this._title.trim().length === 0) {
    throw new Error('Cannot schedule content without a title');
  }
  if (!this._body || this._body.trim().length === 0) {
    throw new Error('Cannot schedule content without body content');
  }
  if (publishAt.getTime() <= Date.now()) {
    throw new Error('Schedule time must be in the future');
  }

  const newItem = new ContentItem({
    ...this.toProps(),
    status: 'scheduled',
    updatedAt: new Date(),
  });

  const event = new ContentScheduled().toEnvelope(this._id, publishAt);
  return { item: newItem, event };
  }

  /**
  * Publish content
  * Returns new instance (immutable update)
  */
  publish(now = new Date()): { item: ContentItem; event: ReturnType<ContentPublished['toEnvelope']> } {
  // Idempotency check
  if (this._status === 'published') {
    throw new Error('Content is already published');
  }

  if (this._status === 'scheduled' && this._publishAt && this._publishAt > now) {
    throw new Error('Publish time has not been reached yet');
  }
  if (this._status !== 'draft' && this._status !== 'scheduled') {
    throw new Error(`Content cannot be published: current status is ${this._status}`);
  }

  const newItem = new ContentItem({
    ...this.toProps(),
    status: 'published',
    publishAt: undefined,
    updatedAt: now,
  });

  const event = new ContentPublished().toEnvelope(this._id);
  return { item: newItem, event };
  }

  /**
  * Archive content
  */
  archive(): ContentItem {
  if (this._status === 'archived') {
    throw new Error('Content is already archived');
  }

  return new ContentItem({
    ...this.toProps(),
    status: 'archived',
    archivedAt: new Date(),
    updatedAt: new Date(),
  });
  }

  /**
  * Unarchive content
  */
  unarchive(): ContentItem {
  if (this._status !== 'archived') {
    throw new Error('Cannot unarchive content that is not archived');
  }

  return new ContentItem({
    ...this.toProps(),
    status: 'draft',
    archivedAt: undefined,
    updatedAt: new Date(),
  });
  }

  /**
  * Convert to plain object (for persistence)
  */
  toProps(): ContentItemProps {
  return {
    id: this._id,
    domainId: this._domainId,
    title: this._title,
    body: this._body,
    status: this._status,
    contentType: this._contentType,
    publishAt: this._publishAt,
    archivedAt: this._archivedAt,
    createdAt: this._createdAt,
    updatedAt: this._updatedAt,
  };
  }
}
