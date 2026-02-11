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

    // SSRF protection example
    const extConfig = targetConfig as ExtendedPublishTargetConfig;
    if (extConfig.endpoint && !ALLOWED_HOSTS.includes(extConfig.endpoint)) {
      throw new Error('Disallowed publish endpoint');
    }

    logger.info('Publishing', { domainId, contentId });
  }
}
