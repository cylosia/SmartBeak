/**
* MEDIUM FIX M1, M2, M3: Enhanced sale readiness computation
* - Input validation
* - Bounds checking
* - Error handling
* - Type safety
*/

import { getLogger } from '@kernel/logger';

const logger = getLogger('SaleReadiness');

export type SaleReadinessInput = {
  seo_completeness: number;       // 0-100
  content_freshness_ratio: number; // 0-1
  audience_size: number;
  audience_growth_rate: number;   // monthly %
  revenue_monthly: number;
  compliance_flags: number;       // count
};

export type SaleReadinessOutput = {
  score: number;
  breakdown: {
  seo: number;
  content: number;
  audience: number;
  revenue: number;
  risk: number;
  };
  rationale: string[];
  valid: boolean;
  errors?: string[];
};

const MAX_SEO_COMPLETENESS = 100;
const MAX_CONTENT_FRESHNESS = 1;
const MAX_AUDIENCE_SIZE = 100000000; // 100M
const MAX_REVENUE_MONTHLY = 1000000000; // $1B
const MAX_COMPLIANCE_FLAGS = 5;

/**
* MEDIUM FIX M3: Validate sale readiness input
*/
function validateInput(input: SaleReadinessInput): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (input === null || input === undefined || typeof input !== 'object') {
  return { valid: false, errors: ['Input must be an object'] };
  }

  // Validate seo_completeness
  if (typeof input.seo_completeness !== 'number') {
  errors.push('seo_completeness must be a number');
  } else if (isNaN(input.seo_completeness) || !isFinite(input.seo_completeness)) {
  errors.push('seo_completeness must be a valid number');
  } else if (input.seo_completeness < 0) {
  errors.push('seo_completeness must be >= 0');
  } else if (input.seo_completeness > MAX_SEO_COMPLETENESS) {
  errors.push(`seo_completeness must be <= ${MAX_SEO_COMPLETENESS}`);
  }

  // Validate content_freshness_ratio
  if (typeof input.content_freshness_ratio !== 'number') {
  errors.push('content_freshness_ratio must be a number');
  } else if (isNaN(input.content_freshness_ratio) || !isFinite(input.content_freshness_ratio)) {
  errors.push('content_freshness_ratio must be a valid number');
  } else if (input.content_freshness_ratio < 0) {
  errors.push('content_freshness_ratio must be >= 0');
  } else if (input.content_freshness_ratio > MAX_CONTENT_FRESHNESS) {
  errors.push(`content_freshness_ratio must be <= ${MAX_CONTENT_FRESHNESS}`);
  }

  // Validate audience_size
  if (typeof input.audience_size !== 'number') {
  errors.push('audience_size must be a number');
  } else if (isNaN(input.audience_size) || !isFinite(input.audience_size)) {
  errors.push('audience_size must be a valid number');
  } else if (input.audience_size < 0) {
  errors.push('audience_size must be >= 0');
  } else if (input.audience_size > MAX_AUDIENCE_SIZE) {
  errors.push(`audience_size must be <= ${MAX_AUDIENCE_SIZE}`);
  }

  // Validate audience_growth_rate
  if (typeof input.audience_growth_rate !== 'number') {
  errors.push('audience_growth_rate must be a number');
  } else if (isNaN(input.audience_growth_rate) || !isFinite(input.audience_growth_rate)) {
  errors.push('audience_growth_rate must be a valid number');
  }

  // Validate revenue_monthly
  if (typeof input.revenue_monthly !== 'number') {
  errors.push('revenue_monthly must be a number');
  } else if (isNaN(input.revenue_monthly) || !isFinite(input.revenue_monthly)) {
  errors.push('revenue_monthly must be a valid number');
  } else if (input.revenue_monthly < 0) {
  errors.push('revenue_monthly must be >= 0');
  } else if (input.revenue_monthly > MAX_REVENUE_MONTHLY) {
  errors.push(`revenue_monthly must be <= ${MAX_REVENUE_MONTHLY}`);
  }

  // Validate compliance_flags
  if (typeof input.compliance_flags !== 'number') {
  errors.push('compliance_flags must be a number');
  } else if (isNaN(input.compliance_flags) || !isFinite(input.compliance_flags)) {
  errors.push('compliance_flags must be a valid number');
  } else if (input.compliance_flags < 0) {
  errors.push('compliance_flags must be >= 0');
  } else if (input.compliance_flags > MAX_COMPLIANCE_FLAGS) {
  errors.push(`compliance_flags must be <= ${MAX_COMPLIANCE_FLAGS}`);
  }

  return { valid: errors.length === 0, errors };
}

export function computeSaleReadiness(input: SaleReadinessInput): SaleReadinessOutput {
  const validation = validateInput(input);
  if (!validation.valid) {
  logger.error('Invalid input', undefined, { errors: validation.errors });
  return {
    score: 0,
    breakdown: { seo: 0, content: 0, audience: 0, revenue: 0, risk: 0 },
    rationale: ['Input validation failed'],
    valid: false,
    errors: validation.errors,
  };
  }

  try {
    const seo = Math.max(0, Math.min(input.seo_completeness, MAX_SEO_COMPLETENESS));
  const contentRatio = Math.max(0, Math.min(input.content_freshness_ratio, MAX_CONTENT_FRESHNESS));
  const content = Math.round(contentRatio * 100);

  const audienceSize = Math.max(0, Math.min(input.audience_size, MAX_AUDIENCE_SIZE));
  const audience =
    audienceSize > 10000
    ? 100
    : Math.round((audienceSize / 10000) * 100);

  const revenueMonthly = Math.max(0, Math.min(input.revenue_monthly, MAX_REVENUE_MONTHLY));
  const revenue =
    revenueMonthly >= 5000
    ? 100
    : Math.round((revenueMonthly / 5000) * 100);

  const complianceFlags = Math.max(0, Math.min(input.compliance_flags, MAX_COMPLIANCE_FLAGS));
  const risk = Math.max(0, 100 - complianceFlags * 20);

  const score = Math.round(
    seo * 0.25 +
    content * 0.2 +
    audience * 0.2 +
    revenue * 0.25 +
    risk * 0.1
  );

  const rationale = [
    `SEO completeness score: ${seo}`,
    `Content freshness score: ${content}`,
    `Audience score: ${audience}`,
    `Revenue score: ${revenue}`,
    `Risk score: ${risk}`
  ];

  return {
    score,
    breakdown: { seo, content, audience, revenue, risk },
    rationale,
    valid: true,
  };
  } catch (error) {
    logger.error('Error computing sale readiness', error instanceof Error ? error : undefined, { error: String(error) });
  return {
    score: 0,
    breakdown: { seo: 0, content: 0, audience: 0, revenue: 0, risk: 0 },
    rationale: ['Error during computation'],
    valid: false,
    errors: [error instanceof Error ? error["message"] : 'Unknown error'],
  };
  }
}
