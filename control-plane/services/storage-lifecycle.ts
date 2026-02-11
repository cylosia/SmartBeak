/**
* Storage lifecycle policy definition
*/
export interface StorageLifecyclePolicy {
  /** Policy name */
  name: string;
  /** Number of days after which policy applies */
  afterDays: number;
}

/**
* Get default media storage lifecycle policies
* @returns Array of default policies
*/
export function getDefaultMediaPolicies(): StorageLifecyclePolicy[] {
  const DAYS_CLEANUP_ORPHANED = 7;
  const DAYS_MOVE_COLD = 30;

  return [
  { name: 'cleanup-orphaned-uploads', afterDays: DAYS_CLEANUP_ORPHANED },
  { name: 'move-cold-media', afterDays: DAYS_MOVE_COLD }
  ];
}
