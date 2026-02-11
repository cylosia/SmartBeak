export type LifecycleAction = 'refresh' | 'merge' | 'prune';

/**
* Suggests a lifecycle action for content based on its metrics
*
* Priority order (highest to lowest):
* 1. Prune: Content with very low traffic should be removed
* 2. Refresh: Content showing decay needs updating
* 3. Merge: Content with overlap issues and low traffic should be consolidated
*
* @param input - The content metrics
* @returns The recommended lifecycle action
*/
export function suggestLifecycleAction(input: {
  decay: boolean;
  overlaps: boolean;
  traffic: number;
}): LifecycleAction {
  // Configurable thresholds from environment variables
  const PRUNE_THRESHOLD = Number(process.env['CONTENT_PRUNE_THRESHOLD']) || 10;
  const MERGE_THRESHOLD = Number(process.env['CONTENT_MERGE_THRESHOLD']) || 50;

  // Highest priority: Content with very low traffic should be pruned
  if (input.traffic < PRUNE_THRESHOLD) return 'prune';

  // Second priority: Content showing decay needs refreshing
  if (input.decay) return 'refresh';

  // Third priority: Content with overlap issues and low traffic should be merged
  if (input.overlaps && input.traffic < MERGE_THRESHOLD) return 'merge';

  // Default action for healthy content
  return 'refresh';
}
