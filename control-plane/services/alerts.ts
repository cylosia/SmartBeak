

import { Pool } from 'pg';

import { getLogger } from '../../packages/kernel/logger';
import { getErrorMessage } from '@errors';

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

    // P1-10 FIX: Use structured key-value logging instead of template literals.
    // Template literals embed orgId, metric, and threshold in a single string that
    // log aggregators cannot reliably redact or filter, exposing business-sensitive
    // configuration (e.g. billing tier thresholds) in plain text log streams.
    logger.info('alert_created', { orgId, metric, threshold });
  } catch (error: unknown) {
    logger.error('Error creating alert', new Error(getErrorMessage(error)));
    throw new Error(`Failed to create alert: ${getErrorMessage(error)}`);
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
    // instead of raising errors under concurrent access.
    // P1-6 FIX: SELECT only id and threshold (not *) and add LIMIT to bound the
    // lock scope. Without LIMIT, an org with thousands of matching alerts locks
    // all of them in one transaction, blocking concurrent check() calls and
    // causing a lock storm under load. Process in bounded batches of 100.
    const { rows } = await client.query<Pick<Alert, 'id' | 'threshold'>>(
    `SELECT id, threshold FROM usage_alerts
    WHERE org_id = $1 AND metric = $2 AND triggered = false AND threshold <= $3
    FOR UPDATE SKIP LOCKED
    LIMIT 100`,
    [orgId, metric, value]
    );

    const alertCount = rows.length;

    // P1-FIX: Batch UPDATE instead of loop-based individual updates
    if (rows.length > 0) {
    const ids = rows.map(alert => alert['id']);
    await client.query(
    'UPDATE usage_alerts SET triggered = true, updated_at = NOW() WHERE id = ANY($1)',
    [ids]
    );

    for (const alert of rows) {
    logger.warn('alert_triggered', { orgId, metric, threshold: alert['threshold'], value });
    }
    }

    await client.query('COMMIT');

    return { triggered: alertCount > 0, alertCount };
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    logger.error('Error checking alerts', new Error(getErrorMessage(error)));
    throw new Error(`Failed to check alerts: ${getErrorMessage(error)}`);
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
    // P1-4 FIX: SELECT explicit columns (not *) and add LIMIT to prevent a tenant
    // with many alerts from loading unbounded rows into the Node.js heap, which
    // causes an OOM crash that takes down all other tenants on the same process.
    // The idx_usage_alerts_org_active partial index covers (org_id) WHERE triggered=false
    // so this query no longer requires a full table scan.
    const { rows } = await this.pool.query<Alert>(
    `SELECT id, org_id, metric, threshold, triggered, created_at
    FROM usage_alerts
    WHERE org_id = $1 AND triggered = false
    ORDER BY created_at DESC
    LIMIT 200`,
    [orgId]
    );

    return rows;
  } catch (error: unknown) {
    logger.error('Error fetching active alerts', new Error(getErrorMessage(error)));
    throw new Error(`Failed to fetch active alerts: ${getErrorMessage(error)}`);
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
  } catch (error: unknown) {
    logger.error('Error deleting alert', new Error(getErrorMessage(error)));
    throw new Error(`Failed to delete alert: ${getErrorMessage(error)}`);
  }
  }
}
