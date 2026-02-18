
// Valid quota fields — validated against this whitelist before any SQL usage
import { Pool } from 'pg';
import type { OrgId } from '@kernel/branded';
import { BillingService } from './billing';
import { UsageService } from './usage';

const VALID_QUOTA_FIELDS = ['domain_count', 'content_count', 'media_count'] as const;
export type QuotaField = typeof VALID_QUOTA_FIELDS[number];



export class QuotaService {
  constructor(
  private billing: BillingService,
  private usage: UsageService,
  /**
   * SECURITY: Required for the atomic enforceAndIncrement() path.
   * Callers that only use check()/getAllQuotas() may pass the pool
   * from the same source as BillingService/UsageService.
   */
  private pool: Pool,
  ) {}

  /**
  * Validate quota field
  */
  private validateField(field: string): asserts field is QuotaField {
  if (!VALID_QUOTA_FIELDS.includes(field as QuotaField)) {
    throw new Error(`Invalid quota field: ${field}. Must be one of: ${VALID_QUOTA_FIELDS.join(', ')}`);
  }
  }

  /**
  * Get quota limit for a field from plan.
  *
  * NOTE: The switch has no `default` branch intentionally. TypeScript will
  * produce an exhaustiveness error if a new QuotaField value is added without
  * a corresponding case here.
  */
  private getLimitFromPlan(plan: { max_domains?: number | undefined; max_content?: number | undefined; max_media?: number | undefined; max_media_storage?: number | undefined } | null, field: QuotaField): number | null {
  if (!plan) return null;

  switch (field) {
    case 'domain_count':
    return plan.max_domains ?? null;
    case 'content_count':
    return plan.max_content ?? null;
    case 'media_count':
    // max_media_storage is the legacy column name; max_media is preferred.
    return plan.max_media ?? plan.max_media_storage ?? null;
  }
  }

  /**
   * Atomically enforce quota and increment the usage counter.
   *
   * SECURITY (P0-1 FIX): This is the CORRECT enforcement path. It eliminates
   * the TOCTOU race condition present in enforce() by combining the check and
   * the increment into a single conditional UPDATE. No concurrent request can
   * exceed the quota between the check and the resource creation because the
   * increment only succeeds when the current count is strictly below the limit.
   *
   * Callers MUST use this method instead of calling enforce() followed by a
   * separate UsageService.increment() call.
   *
   * @throws Error if the quota would be exceeded by this increment.
   */
  async enforceAndIncrement(orgId: OrgId, field: QuotaField): Promise<void> {
  this.validateField(field);
  if (!orgId) throw new Error('Valid orgId is required');

  const plan = await this.billing.getActivePlan(orgId);
  const limit = this.getLimitFromPlan(plan, field);

  if (limit === null) {
    // Unlimited plan — just increment without a limit check.
    await this.usage.increment(orgId, field);
    return;
  }

  // Atomic conditional UPDATE: only succeeds (rowCount = 1) when
  // current_value < limit. field is a validated QuotaField from the
  // VALID_QUOTA_FIELDS whitelist — safe to interpolate as a column name.
  const { rowCount } = await this.pool.query(
    `UPDATE org_usage
     SET ${field} = ${field} + 1, updated_at = NOW()
     WHERE org_id = $1 AND ${field} < $2`,
    [orgId, limit]
  );

  if ((rowCount ?? 0) === 0) {
    // Either the org_usage row doesn't exist yet, or the quota is full.
    // Read current value to produce a meaningful error message.
    const usageRecord = await this.usage.getUsage(orgId);
    const current = (usageRecord[field as keyof typeof usageRecord] as number) ?? 0;
    throw new Error(
    process.env['NODE_ENV'] === 'production'
      ? `Quota exceeded for ${field}`
      : `Quota exceeded for ${field}: ${current}/${limit}`
    );
  }
  }

  /**
   * Enforce quota limit for a specific resource type.
   *
   * @deprecated Use enforceAndIncrement() instead. This method has a TOCTOU
   * race condition: it reads the current usage count and then returns. The
   * caller must then separately create the resource and increment usage, but
   * concurrent requests can exceed the quota in the window between check and
   * increment. enforceAndIncrement() eliminates this window with a single
   * atomic conditional UPDATE.
   */
  async enforce(orgId: OrgId, field: QuotaField): Promise<void> {
  const { exceeded, current, limit } = await this.check(orgId, field);

  if (exceeded && limit !== null) {
    throw new Error(
    process.env['NODE_ENV'] === 'production'
      ? `Quota exceeded for ${field}`
      : `Quota exceeded for ${field}: ${current}/${limit}`
    );
  }
  }

  /**
  * Check if quota is exceeded without throwing
  */
  async check(orgId: OrgId, field: QuotaField): Promise<{ exceeded: boolean; current: number; limit: number | null }> {
  this.validateField(field);

  if (!orgId || typeof orgId !== 'string') {
    throw new Error('Valid orgId is required');
  }

  const plan = await this.billing.getActivePlan(orgId);
  if (!plan) {
    return { exceeded: false, current: 0, limit: null };
  }

  const usage = await this.usage.getUsage(orgId);
  const limit = this.getLimitFromPlan(plan, field);
  const current = (usage[field as keyof typeof usage] as number) ?? 0;

  if (limit === null || limit === undefined) {
    return { exceeded: false, current, limit: null };
  }

  return {
    exceeded: current >= limit,
    current,
    limit
  };
  }

  /**
  * Get all quota usage for an organization
  */
  async getAllQuotas(orgId: OrgId): Promise<Record<QuotaField, { current: number; limit: number | null; exceeded: boolean }>> {
  // P2-1 FIX: Validate orgId — previously missing, unlike check() which had this guard.
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('Valid orgId is required');
  }

  const plan = await this.billing.getActivePlan(orgId);
  const usage = await this.usage.getUsage(orgId);

  const createQuotaInfo = (field: QuotaField) => {
    const limit = this.getLimitFromPlan(plan, field);
    const fieldUsage = usage[field as keyof typeof usage] as number | undefined;
    return {
    current: fieldUsage ?? 0,
    limit,
    exceeded: limit !== null && limit !== undefined && (fieldUsage ?? 0) >= limit
    };
  };

  return {
    domain_count: createQuotaInfo('domain_count'),
    content_count: createQuotaInfo('content_count'),
    media_count: createQuotaInfo('media_count'),
  };
  }
}

// Note: Use QuotaService class methods instead of these standalone functions
// They are kept for backward compatibility but delegate to the service

/**
* Standalone function to enforce domain limit
* @deprecated Use QuotaService.enforceAndIncrement() instead
*/
export async function enforceDomainLimit(
  billing: BillingService,
  usage: UsageService,
  pool: Pool,
  orgId: OrgId
): Promise<void> {
  const quotaService = new QuotaService(billing, usage, pool);
  await quotaService.enforceAndIncrement(orgId, 'domain_count');
}

/**
* Standalone function to enforce content limit
* @deprecated Use QuotaService.enforceAndIncrement() instead
*/
export async function enforceContentLimit(
  billing: BillingService,
  usage: UsageService,
  pool: Pool,
  orgId: OrgId
): Promise<void> {
  const quotaService = new QuotaService(billing, usage, pool);
  await quotaService.enforceAndIncrement(orgId, 'content_count');
}

/**
* Standalone function to enforce media limit
* @deprecated Use QuotaService.enforceAndIncrement() instead
*/
export async function enforceMediaLimit(
  billing: BillingService,
  usage: UsageService,
  pool: Pool,
  orgId: OrgId
): Promise<void> {
  const quotaService = new QuotaService(billing, usage, pool);
  await quotaService.enforceAndIncrement(orgId, 'media_count');
}
