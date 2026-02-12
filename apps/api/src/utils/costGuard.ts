import { getLogger } from '@kernel/logger';

const logger = getLogger('costGuard');

/**
 * MEDIUM FIX M1, M2, M3: Enhanced cost guard
 * - Input validation
 * - Bounds checking
 * - Detailed error messages
 * - Cost categorization
 */
const MAX_ALLOWED_COST = 1000000;
const MINIMUM_BUDGET_THRESHOLD = 0;
/**
 * MEDIUM FIX M3: Validate cost estimate
 * @param estimate - Cost estimate to validate
 */
function validateEstimate(estimate: number): void {
  if (typeof estimate !== 'number') {
    throw new Error('Invalid estimate: must be a number');
  }
  if (isNaN(estimate)) {
    throw new Error('Invalid estimate: must not be NaN');
  }
  if (!isFinite(estimate)) {
    throw new Error('Invalid estimate: must be finite');
  }
  if (estimate < 0) {
    throw new Error(`Invalid estimate: cannot be negative (got ${estimate})`);
  }
  if (estimate > MAX_ALLOWED_COST) {
    throw new Error(`Invalid estimate: exceeds maximum allowed cost of ${MAX_ALLOWED_COST} (got ${estimate})`);
  }
}
/**
 * MEDIUM FIX M3: Validate remaining budget
 * @param remainingBudget - Remaining budget to validate
 */
function validateBudget(remainingBudget: number): void {
  if (typeof remainingBudget !== 'number') {
    throw new Error('Invalid remainingBudget: must be a number');
  }
  if (isNaN(remainingBudget)) {
    throw new Error('Invalid remainingBudget: must not be NaN');
  }
  if (!isFinite(remainingBudget)) {
    throw new Error('Invalid remainingBudget: must be finite');
  }
  if (remainingBudget < MINIMUM_BUDGET_THRESHOLD) {
    throw new Error(`Invalid remainingBudget: cannot be below ${MINIMUM_BUDGET_THRESHOLD} (got ${remainingBudget})`);
  }
}


export interface CostCheckResult {
  allowed: boolean;
  estimate: number;
  remainingBudget: number;
  shortfall?: number | undefined;
  percentageOfBudget?: number | undefined;
}

export function assertCostAllowed(estimate: number, remainingBudget: number): CostCheckResult {
    validateEstimate(estimate);
  validateBudget(remainingBudget);
    const percentageOfBudget = remainingBudget > 0 ? (estimate / remainingBudget) * 100 : 0;
  if (estimate > remainingBudget) {
    const shortfall = estimate - remainingBudget;
        const errorMessage = `Insufficient budget for job: estimate $${estimate.toFixed(2)} exceeds remaining budget $${remainingBudget.toFixed(2)} (shortfall: $${shortfall.toFixed(2)})`;
    logger.warn(`[assertCostAllowed] Budget check failed:`, {
      estimate,
      remainingBudget,
      shortfall,
      percentageOfBudget: percentageOfBudget.toFixed(2) + '%',
    });
    throw new Error(errorMessage);
  }
    logger.debug(`[assertCostAllowed] Budget check passed:`, {
      estimate,
      remainingBudget,
      percentageOfBudget: percentageOfBudget.toFixed(2) + '%',
    });
  return {
    allowed: true,
    estimate,
    remainingBudget,
    percentageOfBudget,
  };
}
/**
 * MEDIUM FIX M2: Check cost without throwing
 * Returns result object instead of throwing
 */
export function checkCostAllowed(estimate: number, remainingBudget: number): CostCheckResult {
  try {
    validateEstimate(estimate);
    validateBudget(remainingBudget);
    const allowed = estimate <= remainingBudget;
    const shortfall = allowed ? undefined : estimate - remainingBudget;
    const percentageOfBudget = remainingBudget > 0 ? (estimate / remainingBudget) * 100 : 0;
    return {
      allowed,
      estimate,
      remainingBudget,
      shortfall,
      percentageOfBudget,
    };
  }
  catch (error) {
    logger.warn('[checkCostAllowed] Validation failed', {
      estimate,
      remainingBudget,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      allowed: false,
      estimate,
      remainingBudget,
      shortfall: undefined,
      percentageOfBudget: undefined,
    };
  }
}
