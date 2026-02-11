
// Valid onboarding steps
import { Pool, PoolClient } from 'pg';

const VALID_STEPS = ['profile', 'billing', 'team'] as const;
export type OnboardingStep = typeof VALID_STEPS[number];

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

  await this.ensure(orgId);

  // SECURITY: Step is validated against strict whitelist before use
  // The validateStep() call ensures only allowed column names from VALID_STEPS are used
  // VALID_STEPS = ['step_create_domain', 'step_create_content', 'step_publish_content']
  // This prevents SQL injection through the step parameter
  const { rowCount } = await this.pool.query(
    `UPDATE org_onboarding
    SET ${step} = true, updated_at = now()
    WHERE org_id = $1`,
    [orgId]
  );
  return rowCount ?? 0;
  }

  async get(orgId: string): Promise<OnboardingState | null> {
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('Valid orgId is required');
  }

  await this.ensure(orgId);
  const { rows } = await this.pool.query(
    'SELECT * FROM org_onboarding WHERE org_id=$1',
    [orgId]
  );
  const row = rows[0];
  const completed =
    row.profile &&
    row.billing &&
    row.team;

  if (completed && !row.completed) {
    await this.pool.query(
    'UPDATE org_onboarding SET completed=true WHERE org_id=$1',
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
  * Reset onboarding status (for testing)
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
