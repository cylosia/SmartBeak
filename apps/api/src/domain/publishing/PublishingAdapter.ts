/**
* Publishing Adapter Interface
* Defines the contract for publishing to external platforms
*/

import type { PublishTargetType } from '@packages/types/publishing';

export interface PublishingTarget {
  id: string;
  type: PublishTargetType;
  name: string;
  config: Record<string, unknown>;
}

export interface PublishingContent {
  title: string;
  body: string;
  excerpt?: string;
  featuredImage?: string;
  tags?: string[];
  categories?: string[];
  meta?: Record<string, unknown>;
}

export type PublishResult =
  | { success: true; publishedUrl?: string | undefined; publishedId?: string | undefined; timestamp: Date; requestId?: string | undefined }
  | { success: false; error: string; timestamp: Date };

export interface IPublishingAdapter {
  readonly targetType: PublishTargetType;

  validateConfig(config: Record<string, unknown>): { valid: boolean; errors: string[] };
  publish(content: PublishingContent, target: PublishingTarget): Promise<PublishResult>;
  unpublish?(publishedId: string, target: PublishingTarget): Promise<boolean>;
  update?(publishedId: string, content: PublishingContent, target: PublishingTarget): Promise<PublishResult>;
}

/**
* Abstract publishing adapter

*/
export abstract class PublishingAdapter implements IPublishingAdapter {
  abstract readonly targetType: PublishTargetType;

  /**
  * Validate target configuration

  */
  abstract validateConfig(config: Record<string, unknown>): { valid: boolean; errors: string[] };

  /**
  * Publish content to target

  */
  abstract publish(content: PublishingContent, target: PublishingTarget): Promise<PublishResult>;

  /**
  * Unpublish content (optional)
  */
  async unpublish?(_publishedId: string, _target: PublishingTarget): Promise<boolean> {
  throw new Error('Unpublish not implemented');
  }

  /**
  * Update published content (optional)
  */
  async update?(_publishedId: string, _content: PublishingContent, _target: PublishingTarget): Promise<PublishResult> {
  throw new Error('Update not implemented');
  }

  /**
  * Generate slug from title

  */
  protected generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  }
}
