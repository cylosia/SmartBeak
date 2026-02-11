/**
* Target configuration for region selection
*/
export interface TargetConfig {
  region?: string;
}

/**
* Select AWS region for a target
* @param target - Target configuration
* @returns Selected region (defaults to us-east-1)
*/
export function selectRegionForTarget(target: TargetConfig): string {
  if (!target || typeof target !== 'object') {
  return 'us-east-1';
  }
  return target.region ?? 'us-east-1';
}
