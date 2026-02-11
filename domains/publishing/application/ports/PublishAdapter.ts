export interface PublishTargetConfig {
  url?: string;
  token?: string;
  apiKey?: string;
  webhook?: string;
  options?: Record<string, unknown>;
}

export interface PublishInput {
  domainId: string;
  contentId: string;
  targetConfig: PublishTargetConfig;
}

export interface PublishAdapter {
  publish(input: PublishInput): Promise<void>;
}

export function validateTargetConfig(config: unknown): asserts config is PublishTargetConfig {
  if (typeof config !== 'object' || config === null) {
  throw new Error('Invalid target config: must be an object');
  }

  const cfg = config as PublishTargetConfig;

  // Validate that no unexpected types are present
  if (cfg.url !== undefined && typeof cfg.url !== 'string') {
  throw new Error('Invalid target config: url must be a string');
  }
  if (cfg.token !== undefined && typeof cfg.token !== 'string') {
  throw new Error('Invalid target config: token must be a string');
  }
  if (cfg.apiKey !== undefined && typeof cfg.apiKey !== 'string') {
  throw new Error('Invalid target config: apiKey must be a string');
  }
  if (cfg.webhook !== undefined && typeof cfg.webhook !== 'string') {
  throw new Error('Invalid target config: webhook must be a string');
  }
}
