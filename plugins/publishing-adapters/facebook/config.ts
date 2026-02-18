export interface FacebookTargetConfig {
  pageId: string;
  accessToken: string;
}

export function validateFacebookConfig(cfg: unknown): asserts cfg is FacebookTargetConfig {
  if (!cfg || typeof cfg !== 'object') throw new Error('Invalid Facebook config');
  const config = cfg as Record<string, unknown>;
  if (!config['pageId'] || typeof config['pageId'] !== 'string') throw new Error('Missing pageId');
  if (!/^\d+$/.test(config['pageId'] as string)) throw new Error('Invalid pageId: must be a numeric string');
  if (!config['accessToken'] || typeof config['accessToken'] !== 'string') throw new Error('Missing accessToken');
  const MIN_TOKEN_LENGTH = 50;
  if ((config['accessToken'] as string).length < MIN_TOKEN_LENGTH) throw new Error(`accessToken is too short (minimum ${MIN_TOKEN_LENGTH} characters)`);
}
