
// Valid onboarding steps
import { Pool } from 'pg';

const VALID_STEPS = ['profile', 'billing', 'team'] as const;
export type OnboardingStep = typeof VALID_STEPS[number];

// SECURITY FIX (H03): Map step names to column names to prevent SQL interpolation of arbitrary strings.
// Even though validateStep() checks against VALID_STEPS, a column map is defense-in-depth against
// future modifications to VALID_STEPS that could introduce SQL injection.
const STEP_COLUMNS: Record<OnboardingStep, string> = {
  profile: 'profile',
  billing: 'billing',
  team: 'team',
} as const;

// Onboarding state interface
export interface OnboardingState {
  org_id: string;
  profile: boolean;
  billing: boolean;
  team: boolean;
  completed: boolean;
  created_at?: Date;
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

  // SECURITY FIX (H03): Use column map instead of direct string interpolation
  const column = STEP_COLUMNS[step];

  // FIX (M02+M03+M04): Single UPSERT instead of ensure() + UPDATE (eliminates double query
  // and ensures transaction-safe operation with updated_at)
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

  await this.ensure(orgId);
  // FIX (M01): Select specific columns instead of SELECT *
  const { rows } = await this.pool.query(
    'SELECT org_id, profile, billing, team, completed, created_at, updated_at FROM org_onboarding WHERE org_id=$1',
    [orgId]
  );

  // SECURITY FIX (H06): Guard against undefined row
  const row = rows[0];
  if (!row) {
    return null;
  }

  const completed =
    row.profile &&
    row.billing &&
    row.team;

  if (completed && !row.completed) {
    // FIX (M03): Include updated_at in auto-completion update
    // FIX (M12): Add WHERE completed=false for idempotent concurrent access
    await this.pool.query(
    'UPDATE org_onboarding SET completed=true, updated_at=now() WHERE org_id=$1 AND completed=false',
    [orgId]
    );
    row.completed = true;
  }

  return row;
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
  let completed = 0;
  if (row.profile) completed++;
  if (row.billing) completed++;
  if (row.team) completed++;
  return Math.round((completed / VALID_STEPS.length) * 100);
  }

  /**
  * Reset onboarding status
  * WARNING: This method resets all onboarding progress. Guard usage appropriately.
  */
  async reset(orgId: string): Promise<void> {
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('Valid orgId is required');
  }

  await this.pool.query(
    `UPDATE org_onboarding
    SET profile = false,
    billing = false,
    team = false,
    completed = false,
    updated_at = now()
    WHERE org_id = $1`,
    [orgId]
  );
  }
}
