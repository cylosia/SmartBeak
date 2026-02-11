export interface FacebookTargetConfig {
  pageId: string;
  accessToken: string;
}

export function validateFacebookConfig(cfg: unknown): asserts cfg is FacebookTargetConfig {
  if (!cfg || typeof cfg !== 'object') throw new Error('Invalid Facebook config');
  const config = cfg as Record<string, unknown>;
  if (!config['pageId'] || typeof config['pageId'] !== 'string') throw new Error('Missing pageId');
  if (!config['accessToken'] || typeof config['accessToken'] !== 'string') throw new Error('Missing accessToken');
}
