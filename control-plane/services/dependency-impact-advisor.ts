import { getLogger } from '@kernel/logger';

/**
* Dependency Impact Advisor Service
* Analyzes critical dependency breaks and their impact
*/

const logger = getLogger('dependency-impact-advisor');

/**
* Database query result row
*/
export interface QueryResultRow {
  [key: string]: unknown;
}

/**
* Database query result
*/
export interface QueryResult<T = QueryResultRow> {
  rows: T[];
  rowCount: number | null;
}

/**
* Database client interface
*/
export interface DependencyImpactDb {
  query<T = QueryResultRow>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

/**
* Critical dependency break record
*/
export interface CriticalDependencyBreak {
  id: string;
  from_asset_type: string;
  from_asset_id: string;
  to_asset_type: string;
  to_asset_id: string;
  impact_level: 'low' | 'medium' | 'high' | 'critical';
  detected_at: Date;
  [key: string]: unknown;
}

/**
* Validate asset type
*/
function validateAssetType(assetType: unknown): assetType is string {
  return typeof assetType === 'string' && assetType.length > 0 && assetType.length <= 100;
}

/**
* Validate asset ID
*/
function validateAssetId(assetId: unknown): assetId is string {
  return typeof assetId === 'string' && assetId.length > 0 && assetId.length <= 255;
}

/**
* Validate database client
*/
function validateDb(db: unknown): db is DependencyImpactDb {
  return (
  db !== null &&
  typeof db === 'object' &&
  'query' in db &&
  typeof (db as DependencyImpactDb).query === 'function'
  );
}

/**
* Get critical dependencies
* @param db - Database client
* @param assetType - Optional filter by source asset type
* @param assetId - Optional filter by source asset ID
* @returns Array of critical dependency breaks
* @throws Error if database query fails or invalid parameters provided
*/
export async function getCriticalDependencies(
  db: DependencyImpactDb,
  assetType?: string,
  assetId?: string
): Promise<CriticalDependencyBreak[]> {
  try {
  // Validate database client
  if (!validateDb(db)) {
    logger["error"]('Invalid database client provided', new Error('Database validation failed'));
    throw new Error('Invalid database client: query method not found');
  }

  // Validate parameters if provided
  if (assetType !== undefined && !validateAssetType(assetType)) {
    logger["error"]('Invalid asset type parameter', new Error('Validation failed'), { assetType });
    throw new Error('Invalid asset type: must be a non-empty string (max 100 chars)');
  }

  if (assetId !== undefined && !validateAssetId(assetId)) {
    logger["error"]('Invalid asset ID parameter', new Error('Validation failed'), { assetId });
    throw new Error('Invalid asset ID: must be a non-empty string (max 255 chars)');
  }

  // Validate that both or neither of assetType/assetId are provided
  if ((assetType && !assetId) || (!assetType && assetId)) {
    logger["error"]('Mismatched asset filters', new Error('Validation failed'), { assetType, assetId });
    throw new Error('Both assetType and assetId must be provided together, or neither');
  }

  let result: QueryResult<CriticalDependencyBreak>;

  if (assetType && assetId) {
    // Sanitize inputs (SQL injection protection via parameterized query)
    const sanitizedAssetType = assetType.trim();
    const sanitizedAssetId = assetId.trim();

    result = await db.query<CriticalDependencyBreak>(
    `SELECT * FROM critical_dependency_breaks
    WHERE from_asset_type = $1
    AND from_asset_id = $2`,
    [sanitizedAssetType, sanitizedAssetId]
    );
  } else {
    // M03-FIX: Add LIMIT to prevent unbounded full table scan
    result = await db.query<CriticalDependencyBreak>(
    `SELECT * FROM critical_dependency_breaks ORDER BY detected_at DESC LIMIT 1000`
    );
  }

  const rows = result.rows || [];

  logger.info('Critical dependencies retrieved', {
    count: rows.length,
    filtered: !!(assetType && assetId),
  });

  return rows;
  } catch (error) {
  logger["error"](
    'Failed to get critical dependencies',
    error instanceof Error ? error : new Error(String(error)),
    { assetType, assetId }
  );
  throw error;
  }
}
