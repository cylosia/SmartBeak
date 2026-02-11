
// Valid quota fields
import { BillingService, ActivePlanResult } from './billing';
import { UsageService } from './usage';

const VALID_QUOTA_FIELDS = ['domain_count', 'content_count', 'media_count'] as const;
export type QuotaField = typeof VALID_QUOTA_FIELDS[number];



export class QuotaService {
  constructor(
  private billing: BillingService,
  private usage: UsageService
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
  * Get quota limit for a field from plan
  */
  private getLimitFromPlan(plan: { max_domains?: number | undefined; max_content?: number | undefined; max_media?: number | undefined; max_media_storage?: number | undefined } | null, field: QuotaField): number | null {
  if (!plan) return null;

  switch (field) {
    case 'domain_count':
    return plan.max_domains ?? null;
    case 'content_count':
    return plan.max_content ?? null;
    case 'media_count':
    return plan.max_media ?? plan.max_media_storage ?? null;
    default:
    return null;
  }
  }

  /**
  * Enforce quota limit for a specific resource type
  * Uses check() internally to avoid duplication
  */
  async enforce(orgId: string, field: QuotaField): Promise<void> {
  const { exceeded, current, limit } = await this.check(orgId, field);

  if (exceeded && limit !== null) {
    throw new Error(`Quota exceeded for ${field}: ${current}/${limit}`);
  }
  }

  /**
  * Check if quota is exceeded without throwing
  */
  async check(orgId: string, field: QuotaField): Promise<{ exceeded: boolean; current: number; limit: number | null }> {
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
  async getAllQuotas(orgId: string): Promise<Record<QuotaField, { current: number; limit: number | null; exceeded: boolean }>> {
  const plan = await this.billing.getActivePlan(orgId);
  const usage = await this.usage.getUsage(orgId);

  const createQuotaInfo = (field: QuotaField) => {
    const limit =
    field === 'domain_count' ? plan?.max_domains ?? null :
    field === 'content_count' ? plan?.max_content ?? null :
    field === 'media_count' ? plan?.max_media ?? null :
    null;

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
* @deprecated Use QuotaService.enforce() instead
*/
export async function enforceDomainLimit(
  billing: BillingService,
  usage: UsageService,
  orgId: string
): Promise<void> {
  const quotaService = new QuotaService(billing, usage);
  await quotaService.enforce(orgId, 'domain_count');
}

/**
* Standalone function to enforce content limit
* @deprecated Use QuotaService.enforce() instead
*/
export async function enforceContentLimit(
  billing: BillingService,
  usage: UsageService,
  orgId: string
): Promise<void> {
  const quotaService = new QuotaService(billing, usage);
  await quotaService.enforce(orgId, 'content_count');
}

/**
* Standalone function to enforce media limit
* @deprecated Use QuotaService.enforce() instead
*/
export async function enforceMediaLimit(
  billing: BillingService,
  usage: UsageService,
  orgId: string
): Promise<void> {
  const quotaService = new QuotaService(billing, usage);
  await quotaService.enforce(orgId, 'media_count');
}
