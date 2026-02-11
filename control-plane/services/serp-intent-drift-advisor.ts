/**
* Database interface for SERP intent drift advisor
*/
export interface Database {
  query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>;
}

/**
* SERP intent drift signal
*/
export interface SerpIntentDriftSignal {
  id: string;
  content_id: string;
  period_start: Date;
  period_end: Date;
  serp_features_changed: string[];
  intent_shift_detected: boolean;
  new_dominant_intent?: string;
  previous_intent?: string;
  confidence_score: number;
}

/**
* Gets SERP intent drift signals with validation
* @param db - Database instance
* @param contentId - Optional content ID to filter by
* @param limit - Maximum number of results (default: 100, max: 1000)
* @returns Promise resolving to array of drift signals
*/
export async function getSerpIntentDriftSignals(
  db: Database,
  contentId?: string,
  limit = 100
): Promise<SerpIntentDriftSignal[]> {
  // Validate contentId if provided
  if (contentId !== undefined && (typeof contentId !== 'string' || contentId.length === 0)) {
  throw new Error('contentId must be a non-empty string if provided');
  }

  // Validate limit
  if (typeof limit !== 'number' || limit < 1) {
  throw new Error('limit must be a positive number');
  }

  const safeLimit = Math.min(Math.max(1, limit), 1000);

  if (contentId) {
  const result = await db.query(
    'select * from serp_intent_drift_signals where content_id = $1 order by period_start desc LIMIT $2',
    [contentId, safeLimit]
  );
  return result.rows as SerpIntentDriftSignal[];
  }
  const result = await db.query('select * from serp_intent_drift_signals LIMIT $1', [safeLimit]);
  return result.rows as SerpIntentDriftSignal[];
}
