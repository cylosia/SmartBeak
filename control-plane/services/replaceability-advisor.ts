/**
* Database interface for replaceability advisor
*/
export interface Database {
  query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>;
}

/**
* Replaceability index entry
*/
export interface ReplaceabilityEntry {
  id: string;
  asset_type: string;
  asset_id: string;
  replaceability_score: number;
  replacement_cost_estimate: number;
  replacement_time_estimate_days: number;
  alternatives_available: number;
  last_updated: Date;
}

/**
* Gets replaceability data with validation
* @param db - Database instance
* @param assetType - Optional asset type to filter by
* @param assetId - Optional asset ID to filter by
* @param limit - Maximum number of results (default: 100, max: 1000)
* @returns Promise resolving to array of replaceability entries
*/
export async function getReplaceability(
  db: Database,
  assetType?: string,
  assetId?: string,
  limit = 100
): Promise<ReplaceabilityEntry[]> {
  // Validate assetType if provided
  if (assetType !== undefined && (typeof assetType !== 'string' || assetType.length === 0)) {
  throw new Error('assetType must be a non-empty string if provided');
  }

  // Validate assetId if provided
  if (assetId !== undefined && (typeof assetId !== 'string' || assetId.length === 0)) {
  throw new Error('assetId must be a non-empty string if provided');
  }

  // Validate limit
  if (typeof limit !== 'number' || limit < 1) {
  throw new Error('limit must be a positive number');
  }

  const safeLimit = Math.min(Math.max(1, limit), 1000);

  if (assetType && assetId) {
  const result = await db.query(
    'select * from replaceability_index where asset_type = $1 and asset_id = $2 LIMIT $3',
    [assetType, assetId, safeLimit]
  );
  return result.rows as ReplaceabilityEntry[];
  }
  const result = await db.query('select * from replaceability_index LIMIT $1', [safeLimit]);
  return result.rows as ReplaceabilityEntry[];
}
