/**
* Database interface for monetization decay advisor
*/
export interface Database {
  query: (sql: string, params: unknown[]) => Promise<{ rows: MonetizationDecaySignal[] }>;
}

/**
* Monetization decay signal
*/
export interface MonetizationDecaySignal {
  id: string;
  content_version_id: string;
  period_start: Date;
  period_end: Date;
  revenue_decline_pct: number;
  decay_flag: boolean;
  recommendations: string[];
}

/**
* Gets monetization decay signals with validation
* @param db - Database instance
* @param contentVersionId - Optional content version ID to filter by
* @param limit - Maximum number of results (default: 100, max: 1000)
* @returns Promise resolving to array of decay signals
*/
export async function getMonetizationDecaySignals(
  db: Database,
  contentVersionId?: string,
  limit = 100
): Promise<MonetizationDecaySignal[]> {
  // Validate contentVersionId if provided
  if (contentVersionId !== undefined && (typeof contentVersionId !== 'string' || contentVersionId.length === 0)) {
  throw new Error('contentVersionId must be a non-empty string if provided');
  }

  // Validate limit
  if (typeof limit !== 'number' || limit < 1) {
  throw new Error('limit must be a positive number');
  }

  const safeLimit = Math.min(Math.max(1, limit), 1000);

  if (contentVersionId) {
  const result = await db.query(
    'SELECT id, content_version_id, period_start, period_end, revenue_decline_pct, decay_flag, recommendations FROM monetization_decay_signals WHERE content_version_id = $1 ORDER BY period_start DESC LIMIT $2',
    [contentVersionId, safeLimit]
  );
  return result.rows;
  }
  const result = await db.query('SELECT id, content_version_id, period_start, period_end, revenue_decline_pct, decay_flag, recommendations FROM monetization_decay_signals WHERE decay_flag = TRUE LIMIT $1', [safeLimit]);
  return result.rows;
}
