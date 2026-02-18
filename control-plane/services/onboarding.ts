
// Valid onboarding steps — must match column names in migration 20260210001800_cp_onboarding.up.sql
import { Pool, PoolClient } from 'pg';

const VALID_STEPS = ['step_create_domain', 'step_create_content', 'step_publish_content'] as const;
export type OnboardingStep = typeof VALID_STEPS[number];

// Column map provides defence-in-depth against future VALID_STEPS additions that could
// introduce SQL injection via string interpolation.
const STEP_COLUMNS: Record<OnboardingStep, string> = {
  step_create_domain: 'step_create_domain',
  step_create_content: 'step_create_content',
  step_publish_content: 'step_publish_content',
} as const;

// Onboarding state interface — mirrors the org_onboarding table schema
export interface OnboardingState {
  org_id: string;
  step_create_domain: boolean;
  step_create_content: boolean;
  step_publish_content: boolean;
  completed: boolean;
  updated_at?: Date;
}

export class OnboardingService {
  constructor(private pool: Pool) {}

  /**
   * Validate step name against whitelist
   */
  private validateStep(step: string): asserts step is OnboardingStep {
    if (!VALID_STEPS.includes(step as OnboardingStep)) {
      throw new Error('Invalid step');
    }
  }

  async ensure(orgId: string): Promise<void> {
    if (!orgId || typeof orgId !== 'string') {
      throw new Error('Valid orgId is required');
    }

    await this.pool.query(
      `INSERT INTO org_onboarding (org_id)
       VALUES ($1)
       ON CONFLICT (org_id) DO NOTHING`,
      [orgId]
    );
  }

  async mark(orgId: string, step: OnboardingStep): Promise<number> {
    // Validate step against whitelist to prevent SQL injection
    this.validateStep(step);

    if (!orgId || typeof orgId !== 'string') {
      throw new Error('Valid orgId is required');
    }

    // Use column map instead of direct string interpolation
    const column = STEP_COLUMNS[step];

    // Single UPSERT: eliminates double-query and ensures transaction-safe operation
    const { rowCount } = await this.pool.query(
      `INSERT INTO org_onboarding (org_id, "${column}", updated_at)
       VALUES ($1, true, now())
       ON CONFLICT (org_id) DO UPDATE
       SET "${column}" = true, updated_at = now()`,
      [orgId]
    );
    return rowCount ?? 0;
  }

  async get(orgId: string): Promise<OnboardingState | null> {
    if (!orgId || typeof orgId !== 'string') {
      throw new Error('Valid orgId is required');
    }

    // P1-1: Wrap in REPEATABLE READ transaction to prevent race conditions between
    // ensure(), SELECT, and the optional completed=true UPDATE. Two concurrent get()
    // calls could otherwise both read completed=false and both issue the UPDATE.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');

      await this._ensure(client, orgId);

      const { rows } = await client.query(
        `SELECT org_id, step_create_domain, step_create_content, step_publish_content,
                completed, updated_at
         FROM org_onboarding WHERE org_id = $1`,
        [orgId]
      );

      const row = rows[0];
      if (!row) {
        await client.query('COMMIT');
        return null;
      }

      const allDone = row['step_create_domain'] && row['step_create_content'] && row['step_publish_content'];

      if (allDone && !row['completed']) {
        // Use RETURNING to get the authoritative value instead of mutating the JS object
        const { rows: updatedRows } = await client.query(
          `UPDATE org_onboarding
           SET completed = true, updated_at = now()
           WHERE org_id = $1 AND completed = false
           RETURNING completed`,
          [orgId]
        );
        // If RETURNING produced a row, the update succeeded; reflect it in our result
        if (updatedRows.length > 0) {
          row['completed'] = true;
        }
      }

      await client.query('COMMIT');
      return row as OnboardingState;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore rollback error */ }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Internal ensure: calls INSERT ON CONFLICT on an existing client (within a transaction).
   */
  private async _ensure(client: PoolClient, orgId: string): Promise<void> {
    await client.query(
      `INSERT INTO org_onboarding (org_id)
       VALUES ($1)
       ON CONFLICT (org_id) DO NOTHING`,
      [orgId]
    );
  }

  /**
   * Check if onboarding is completed
   */
  async isCompleted(orgId: string): Promise<boolean> {
    const row = await this.get(orgId);
    return row?.completed === true;
  }

  /**
   * Get onboarding progress percentage
   */
  async getProgress(orgId: string): Promise<number> {
    const row = await this.get(orgId);
    if (!row) return 0;
    let done = 0;
    if (row['step_create_domain']) done++;
    if (row['step_create_content']) done++;
    if (row['step_publish_content']) done++;
    return Math.round((done / VALID_STEPS.length) * 100);
  }

  /**
   * Reset onboarding status.
   * WARNING: This method resets all onboarding progress. Guard usage appropriately.
   */
  async reset(orgId: string): Promise<void> {
    if (!orgId || typeof orgId !== 'string') {
      throw new Error('Valid orgId is required');
    }

    await this.pool.query(
      `UPDATE org_onboarding
       SET step_create_domain = false,
           step_create_content = false,
           step_publish_content = false,
           completed = false,
           updated_at = now()
       WHERE org_id = $1`,
      [orgId]
    );
  }
}
