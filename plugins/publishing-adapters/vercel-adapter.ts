import { PublishAdapter, PublishInput, validateTargetConfig } from '../../packages/types/publishing';

import { getLogger } from '../../packages/kernel/logger';

const ALLOWED_HOSTS = ['api.vercel.com'];

const logger = getLogger('VercelPublishAdapter');

// Extended target config interface
interface ExtendedPublishTargetConfig {
  endpoint?: string;
  [key: string]: unknown;
}

export class VercelPublishAdapter implements PublishAdapter {
  async publish({ domainId, contentId, targetConfig }: PublishInput): Promise<void> {
    validateTargetConfig(targetConfig);

    // P2-11 FIX: Parse endpoint as URL and compare hostname, not raw string match
    const extConfig = targetConfig as ExtendedPublishTargetConfig;
    if (extConfig.endpoint) {
      let hostname: string;
      try {
        const url = new URL(extConfig.endpoint);
        hostname = url.hostname;
      } catch {
        throw new Error('Invalid publish endpoint URL format');
      }
      if (!ALLOWED_HOSTS.includes(hostname)) {
        throw new Error('Disallowed publish endpoint');
      }
    }

    // P2-12 FIX: Throw NotImplementedError instead of silently succeeding
    // This adapter is a placeholder. Implement the actual Vercel deployment API call
    // before using in production.
    logger.warn('VercelPublishAdapter.publish() is not yet implemented', { domainId, contentId });
    throw new Error('VercelPublishAdapter is not yet implemented. Configure a real deployment adapter.');
  }
}
