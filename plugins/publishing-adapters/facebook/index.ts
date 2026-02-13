import fetch from 'node-fetch';

import { PublishAdapter, PublishInput, PublishTargetConfig } from '../../../packages/types/publishing';
import { getFacebookGraphUrl } from '@config';
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

export class FacebookPublishAdapter implements PublishAdapter {
  async publish({ domainId: _domainId, contentId: _contentId, targetConfig }: FacebookPublishInput): Promise<void> {
    validateFacebookConfig(targetConfig);

    // NOTE: Content/SEO/media are resolved by the worker context in real impl.
    // For now, assume targetConfig carries resolved fields for safety.
    const title = targetConfig.title ?? '';
    const url = targetConfig.url ?? '';
    const post = renderFacebookPost({
      title,
      url,
      ...(targetConfig.excerpt !== undefined && { excerpt: targetConfig.excerpt }),
      ...(targetConfig.imageUrl !== undefined && { imageUrl: targetConfig.imageUrl }),
    });

    const endpoint = `${getFacebookGraphUrl()}/${targetConfig.pageId}/feed`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: post.message,
        link: post.link,
        access_token: targetConfig.accessToken
      })
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Facebook publish failed: ${res.status} ${text}`);
    }
  }
}
