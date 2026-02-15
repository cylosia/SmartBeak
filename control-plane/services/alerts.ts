

import { Pool } from 'pg';

import { getLogger } from '../../packages/kernel/logger';

const logger = getLogger('AlertsService');

// ============================================================================
// Type Definitions
// ============================================================================

/**
* Alert data structure
*/
export interface Alert {
  /** Alert ID */
  id: string;
  /** Organization ID */
  org_id: string;
  /** Metric being monitored */
  metric: string;
  /** Threshold value */
  threshold: number;
  /** Whether alert has been triggered */
  triggered: boolean;
  /** Creation timestamp */
  created_at: Date;
  /** Additional properties */
  [key: string]: unknown;
}

/**
* Result of checking alerts
*/
export interface AlertCheckResult {
  /** Whether any alerts were triggered */
  triggered: boolean;
  /** Number of alerts triggered */
  alertCount: number;
}

// ============================================================================
// Alert Service
// ============================================================================

/**
* Service for managing usage alerts
*
* Provides CRUD operations for alerts and trigger checking
* based on current metric values.
*/
export class AlertService {
  /**
  * Create a new AlertService
  * @param pool - Database connection pool
  */
  constructor(private readonly pool: Pool) {
  if (!pool) {
    throw new Error('Database pool is required');
  }
  }

  /**
  * Creates a new usage alert.
  *
  * @param orgId - Organization ID
  * @param metric - Metric name to monitor
  * @param threshold - Threshold value for triggering
  * @returns Promise that resolves when alert is created
  * @throws Error if validation fails or database operation fails
  */
  async create(orgId: string, metric: string, threshold: number): Promise<void> {
  // Input validation
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('Valid orgId (string) is required');
  }
  if (!metric || typeof metric !== 'string') {
    throw new Error('Valid metric (string) is required');
  }
  if (typeof threshold !== 'number' || Number.isNaN(threshold) || !Number.isFinite(threshold)) {
    throw new Error('Valid threshold (number) is required');
  }

  try {
    await this.pool.query(
    `INSERT INTO usage_alerts (id, org_id, metric, threshold, triggered, created_at)
    VALUES (gen_random_uuid(), $1, $2, $3, false, NOW())`,
    [orgId, metric, threshold]
    );

    logger.info(`Created alert for org ${orgId}: ${metric} > ${threshold}`);
  } catch (error) {
    logger.error('Error creating alert', error instanceof Error ? error : new Error(String(error)));
    throw new Error(`Failed to create alert: ${error instanceof Error ? error.message : String(error)}`);
  }
  }

  /**
  * Checks if any alerts should be triggered based on the current value.
  * Marks triggered alerts and returns the count.
  *
  * @param orgId - Organization ID
  * @param metric - Metric name
  * @param value - Current value to check against threshold
  * @returns Result indicating if alerts were triggered and the count
  * @throws Error if validation fails or database operation fails
  */
  async check(orgId: string, metric: string, value: number): Promise<AlertCheckResult> {
  // Input validation
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('Valid orgId (string) is required');
  }
  if (!metric || typeof metric !== 'string') {
    throw new Error('Valid metric (string) is required');
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || Number.isNaN(value)) {
    throw new Error('Valid value (number) is required');
  }

  const client = await this.pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = $1', [30000]); // 30 seconds

    // P1-FIX: Use SKIP LOCKED instead of NOWAIT to gracefully skip contended rows
    // instead of raising errors under concurrent access
    const { rows } = await client.query<Alert>(
    `SELECT * FROM usage_alerts
    WHERE org_id = $1 AND metric = $2 AND triggered = false AND threshold <= $3
    FOR UPDATE SKIP LOCKED`,
    [orgId, metric, value]
    );

    const alertCount = rows.length;

    // P1-FIX: Batch UPDATE instead of loop-based individual updates
    if (rows.length > 0) {
    const ids = rows.map(alert => alert.id);
    await client.query(
    'UPDATE usage_alerts SET triggered = true, updated_at = NOW() WHERE id = ANY($1)',
    [ids]
    );

    for (const alert of rows) {
    logger.warn(`[ALERT TRIGGERED] org=${orgId}, metric=${metric}, threshold=${alert.threshold}, value=${value}`);
    }
    }

    await client.query('COMMIT');

    return { triggered: alertCount > 0, alertCount };
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error checking alerts', error instanceof Error ? error : new Error(String(error)));
    throw new Error(`Failed to check alerts: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
  }

  /**
  * Gets all active (non-triggered) alerts for an organization.
  *
  * @param orgId - Organization ID
  * @returns Array of active alerts
  * @throws Error if validation fails or database operation fails
  */
  async getActiveAlerts(orgId: string): Promise<Alert[]> {
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('Valid orgId (string) is required');
  }

  try {
    const { rows } = await this.pool.query<Alert>(
    `SELECT * FROM usage_alerts
    WHERE org_id = $1 AND triggered = false
    ORDER BY created_at DESC`,
    [orgId]
    );

    return rows;
  } catch (error) {
    logger.error('Error fetching active alerts', error instanceof Error ? error : new Error(String(error)));
    throw new Error(`Failed to fetch active alerts: ${error instanceof Error ? error.message : String(error)}`);
  }
  }

  /**
  * Deletes an alert by ID.
  *
  * @param alertId - Alert ID
  * @returns Promise that resolves when alert is deleted
  * @throws Error if validation fails or database operation fails
  */
  async delete(alertId: string, orgId: string): Promise<void> {
  if (!alertId || typeof alertId !== 'string') {
    throw new Error('Valid alertId (string) is required');
  }
  // P1-FIX: Require orgId to prevent cross-tenant deletion
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('Valid orgId (string) is required');
  }

  try {
    const result = await this.pool.query(
    'DELETE FROM usage_alerts WHERE id = $1 AND org_id = $2',
    [alertId, orgId]
    );

    if (result.rowCount === 0) {
    throw new Error('Alert not found');
    }

    logger.info(`Deleted alert: ${alertId}`);
  } catch (error) {
    logger.error('Error deleting alert', error instanceof Error ? error : new Error(String(error)));
    throw new Error(`Failed to delete alert: ${error instanceof Error ? error.message : String(error)}`);
  }
  }
}
