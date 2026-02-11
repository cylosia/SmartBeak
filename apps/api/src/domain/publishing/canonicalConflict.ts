/**
* Canonical conflict detection result
*/
export interface CanonicalConflictResult {
  /** Warning message describing the conflict */
  warning: string;
  /** Existing canonical URL */
  existing: string;
  /** Proposed canonical URL */
  proposed: string;
}

/**
* Detect conflicts between existing and proposed canonical URLs
*
* @param existingCanonical - Current canonical URL
* @param proposed - Proposed canonical URL
* @returns Conflict result if URLs differ, null otherwise
*/
export function detectCanonicalConflict(
  existingCanonical?: string,
  proposed?: string
): CanonicalConflictResult | null {
  if (!existingCanonical || !proposed) return null;
  if (existingCanonical !== proposed) {
  return {
    warning: 'Canonical conflict detected',
    existing: existingCanonical,
    proposed: proposed,
  };
  }
  return null;
}
