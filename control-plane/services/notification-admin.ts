
import { Pool } from 'pg';

/**
 * Notification Admin Service
 * 
 * P1-HIGH SECURITY FIX: Issue 19 - Missing ownership checks in admin services
 * All methods now require and validate orgId to prevent unauthorized access
 */

export interface Notification {
  id: string;
  org_id: string;
  user_id?: string;
  channel: string;
  template?: string;
  status: string;
  created_at: Date;
}

export interface NotificationMetrics {
  delivered: number;
  failed: number;
  total: number;
}

export class NotificationAdminService {
  constructor(private pool: Pool) {}

  /**
   * Verify notification ownership
   * SECURITY FIX: Issue 19 - Check org ownership before returning data
   * 
   * @param notificationId - Notification ID to check
   * @param orgId - Organization ID to verify ownership
   * @returns True if notification belongs to org
   */
  private async verifyOwnership(notificationId: string, orgId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      'SELECT 1 FROM notifications WHERE id = $1 AND org_id = $2',
      [notificationId, orgId]
    );
    return rows.length > 0;
  }

  /**
   * List notifications for a specific organization
   * SECURITY FIX: Issue 19 - Enforce org-scoped queries
   * 
   * @param orgId - Organization ID to filter by
   * @param limit - Maximum number of results
   * @param offset - Pagination offset
   * @returns List of notifications belonging to the org
   */
  async listNotifications(orgId: string, limit = 100, offset = 0): Promise<Notification[]> {
    // SECURITY FIX: Validate orgId
    if (!orgId) {
      throw new Error('Organization ID is required');
    }

    const safeLimit = Math.min(Math.max(1, limit), 1000);
    // P2 FIX: Cap OFFSET to prevent deep-page O(n) table scans
    const MAX_SAFE_OFFSET = 10000;
    const safeOffset = Math.min(Math.max(0, offset), MAX_SAFE_OFFSET);
    
    const { rows } = await this.pool.query(
      `SELECT id, org_id, user_id, channel, template, status, created_at
      FROM notifications 
      WHERE org_id = $1
      ORDER BY created_at DESC 
      LIMIT $2 OFFSET $3`,
      [orgId, safeLimit, safeOffset]
    );
    return rows;
  }

  /**
   * Retry a notification
   * SECURITY FIX: Issue 19 - Verify ownership before retrying
   * 
   * @param notificationId - Notification ID to retry
   * @param orgId - Organization ID for ownership verification
   * @returns Success status
   */
  async retry(notificationId: string, orgId: string): Promise<{ ok: boolean }> {
    // SECURITY FIX: Validate inputs
    if (!notificationId) {
      throw new Error('Notification ID is required');
    }
    if (!orgId) {
      throw new Error('Organization ID is required');
    }

    // P1-FIX: Atomic ownership check + status guard in a single UPDATE.
    // Previously used separate SELECT (verifyOwnership) then UPDATE — TOCTOU race.
    // Also added status='failed' guard: only failed notifications can be retried.
    // Without this, an admin could reset a 'delivered' notification to 'pending',
    // causing duplicate delivery.
    const { rowCount } = await this.pool.query(
      `UPDATE notifications SET status='pending'
       WHERE id=$1 AND org_id=$2 AND status='failed'`,
      [notificationId, orgId]
    );
    if (!rowCount) {
      throw new Error('Notification not found, access denied, or not in failed state');
    }
    return { ok: true };
  }

  /**
   * Get metrics for a specific organization
   * SECURITY FIX: Issue 19 - Enforce org-scoped metrics
   * 
   * @param orgId - Organization ID to filter by
   * @returns Notification metrics for the org
   */
  async metrics(orgId: string): Promise<NotificationMetrics> {
    // SECURITY FIX: Validate orgId
    if (!orgId) {
      throw new Error('Organization ID is required');
    }

    const { rows } = await this.pool.query(
      `SELECT
        count(*) FILTER (WHERE status='delivered') AS delivered,
        count(*) FILTER (WHERE status='failed') AS failed,
        count(*) AS total
      FROM notifications
      WHERE org_id = $1`,
      [orgId]
    );
    return rows[0] || { delivered: 0, failed: 0, total: 0 };
  }

  /**
   * Get a single notification by ID (with ownership check)
   * SECURITY FIX: Issue 19 - Enforce org ownership
   * 
   * @param notificationId - Notification ID
   * @param orgId - Organization ID for ownership verification
   * @returns Notification or null if not found/no access
   */
  async getNotification(notificationId: string, orgId: string): Promise<Notification | null> {
    if (!notificationId || !orgId) {
      return null;
    }

    const { rows } = await this.pool.query(
      `SELECT id, org_id, user_id, channel, template, status, created_at
      FROM notifications 
      WHERE id = $1 AND org_id = $2`,
      [notificationId, orgId]
    );
    
    return rows[0] || null;
  }

  /**
   * Cancel a pending notification
   * SECURITY FIX: Issue 19 - Verify ownership before canceling
   * 
   * @param notificationId - Notification ID to cancel
   * @param orgId - Organization ID for ownership verification
   * @returns Success status
   */
  async cancel(notificationId: string, orgId: string): Promise<{ ok: boolean }> {
    if (!notificationId || !orgId) {
      throw new Error('Notification ID and Organization ID are required');
    }

    // P1-FIX: Atomic ownership check + status guard in single UPDATE (eliminates TOCTOU race).
    const { rowCount } = await this.pool.query(
      `UPDATE notifications
      SET status='cancelled'
      WHERE id=$1 AND org_id=$2 AND status='pending'`,
      [notificationId, orgId]
    );

    if (!rowCount) {
      throw new Error('Notification not found, access denied, or not in pending state');
    }
    return { ok: true };
  }
}
