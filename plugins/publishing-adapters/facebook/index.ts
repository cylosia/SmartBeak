import { PublishAdapter, PublishInput, PublishTargetConfig } from '../../../packages/types/publishing';
import { FacebookAdapter } from '../../../control-plane/adapters/facebook/FacebookAdapter';
import { renderFacebookPost } from './render';
import { validateFacebookConfig, FacebookTargetConfig } from './config';

interface FacebookPublishInput extends PublishInput {
  targetConfig: PublishTargetConfig & FacebookTargetConfig & {
    title?: string;
    excerpt?: string;
    imageUrl?: string;
    url?: string;
  };
}

/**
 * Plugin-level Facebook adapter that delegates to the full-featured
 * control-plane FacebookAdapter (with retry, SSRF protection, metrics).
 *
 * This wrapper adds:
 *  - Per-call config validation via validateFacebookConfig
 *  - Post rendering via renderFacebookPost
 */
export class FacebookPublishAdapter implements PublishAdapter {
  async publish({ domainId: _domainId, contentId: _contentId, targetConfig }: FacebookPublishInput): Promise<void> {
    validateFacebookConfig(targetConfig);

    const title = targetConfig.title ?? '';
    const url = targetConfig.url ?? '';
    const post = renderFacebookPost({
      title,
      url,
      ...(targetConfig.excerpt !== undefined && { excerpt: targetConfig.excerpt }),
      ...(targetConfig.imageUrl !== undefined && { imageUrl: targetConfig.imageUrl }),
    });

    // Delegate to the full-featured adapter with retry, SSRF, and metrics
    const adapter = new FacebookAdapter(targetConfig.accessToken);
    await adapter.publishPagePost(targetConfig.pageId, post.message);
  }
}
