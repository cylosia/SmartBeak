/**
* Publishing Adapter Interface
* Defines the contract for publishing to external platforms
*/

export interface PublishingTarget {
  id: string;
  type: 'wordpress' | 'webhook' | 'api' | 'social';
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

export interface PublishResult {
  success: boolean;
  publishedUrl?: string | undefined;
  publishedId?: string | undefined;
  error?: string | undefined;
  timestamp: Date;
  requestId?: string | undefined; // For request cancellation support
}

export interface IPublishingAdapter {
  readonly targetType: string;

  validateConfig(config: Record<string, unknown>): { valid: boolean; errors: string[] };
  publish(content: PublishingContent, target: PublishingTarget): Promise<PublishResult>;
  unpublish?(publishedId: string, target: PublishingTarget): Promise<boolean>;
  update?(publishedId: string, content: PublishingContent, target: PublishingTarget): Promise<PublishResult>;
}

/**
* Abstract publishing adapter

*/
export abstract class PublishingAdapter implements IPublishingAdapter {
  abstract readonly targetType: string;

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
  async unpublish?(publishedId: string, target: PublishingTarget): Promise<boolean> {
  throw new Error('Unpublish not implemented');
  }

  /**
  * Update published content (optional)
  */
  async update?(publishedId: string, content: PublishingContent, target: PublishingTarget): Promise<PublishResult> {
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
