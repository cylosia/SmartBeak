
// Valid onboarding steps
import { Pool, PoolClient } from 'pg';
import { ValidationError, ErrorCodes } from '@errors';
import { getLogger } from '@kernel/logger';

const logger = getLogger('OnboardingService');

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

/**
 * Assert that orgId is a non-empty string.
 * FIX (OB-02 / ON-4): Use ValidationError (AppError subclass) rather than
 * plain Error so the route-layer error handler maps it to a 400 response
 * instead of an opaque 500.
 */
function assertOrgId(orgId: string): void {
  if (!orgId || typeof orgId !== 'string') {
    throw new ValidationError('Valid orgId is required', ErrorCodes.VALIDATION_ERROR);
  }
}

export class OnboardingService {
  constructor(private pool: Pool) {}

  /**
  * Validate step name against whitelist
  */
  private validateStep(step: string): asserts step is OnboardingStep {
  if (!VALID_STEPS.includes(step as OnboardingStep)) {
    throw new ValidationError(
      `Invalid onboarding step: "${step}". Must be one of: ${VALID_STEPS.join(', ')}`,
      ErrorCodes.VALIDATION_ERROR
    );
  }
  }

  async ensure(orgId: string): Promise<void> {
  assertOrgId(orgId);

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
  assertOrgId(orgId);

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
  assertOrgId(orgId);

  // FIX (ON-1 / OB-01): Wrap ensure + SELECT + conditional UPDATE in a single
  // transaction so the sequence is atomic.  Previously ensure() and the SELECT
  // ran on separate pool connections with no ordering guarantee, and the
  // auto-complete UPDATE ran outside any transaction, making the read-modify-write
  // sequence vulnerable to TOCTOU races under concurrent requests.
  //
  // FIX (ON-3): Use REPEATABLE READ isolation.  The default READ COMMITTED level
  // allows another transaction to modify the row between our SELECT (line ~109)
  // and our conditional UPDATE (line ~126), creating a TOCTOU window where the
  // allStepsDone check could be evaluated against a stale snapshot.  With
  // REPEATABLE READ, all reads within the transaction see a consistent snapshot
  // taken at BEGIN, eliminating the window.  If a concurrent transaction commits
  // a conflicting write before we COMMIT, PostgreSQL raises a serialization error
  // that the caller can handle (retry or surface to the user).
  const client: PoolClient = await this.pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    // FIX (ON-4): Set per-statement and lock-acquisition timeouts so the
    // transaction cannot hold a connection indefinitely under slow queries or
    // lock contention, which would exhaust the connection pool.
    await client.query('SET LOCAL statement_timeout = 5000');
    await client.query('SET LOCAL lock_timeout = 2000');

    // Ensure the row exists (idempotent)
    await client.query(
      `INSERT INTO org_onboarding (org_id)
      VALUES ($1)
      ON CONFLICT (org_id) DO NOTHING`,
      [orgId]
    );

    // FIX (M01): Select specific columns instead of SELECT *
    const { rows } = await client.query<OnboardingState>(
      'SELECT org_id, profile, billing, team, completed, created_at, updated_at FROM org_onboarding WHERE org_id=$1',
      [orgId]
    );

    // SECURITY FIX (H06): Guard against undefined row
    const row = rows[0];
    if (!row) {
      await client.query('COMMIT');
      return null;
    }

    const allStepsDone = row.profile && row.billing && row.team;

    if (allStepsDone && !row.completed) {
      // FIX (M03): Include updated_at in auto-completion update
      // FIX (M12): Add WHERE completed=false for idempotent concurrent access
      await client.query(
        'UPDATE org_onboarding SET completed=true, updated_at=now() WHERE org_id=$1 AND completed=false',
        [orgId]
      );
      // FIX (ON-2): Return a new object rather than mutating the pg result row
      // in place.  Mutating the result object is a code smell: if the result were
      // ever shared or cached the mutation would produce incorrect state.
      await client.query('COMMIT');
      return { ...row, completed: true };
    }

    await client.query('COMMIT');
    return row;
  } catch (err) {
    await client.query('ROLLBACK').catch((rbErr: unknown) => {
      // Log rollback failures but re-throw the original error so callers see
      // the root cause, not the rollback error.
      // FIX (ON-5): Use structured logger instead of console.error.
      // console.* bypasses log aggregation, OpenTelemetry context propagation,
      // and the logger's automatic PII redaction, violating the "Never use
      // console.log" rule in CLAUDE.md.
      logger.error('OnboardingService.get: ROLLBACK failed', rbErr instanceof Error ? rbErr : undefined, {
        orgId,
        rbError: rbErr instanceof Error ? rbErr.message : String(rbErr),
      });
    });
    throw err;
  } finally {
    client.release();
  }
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
  assertOrgId(orgId);

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
