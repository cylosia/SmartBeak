
import { computePortfolioRoi } from './portfolioRoi';
import { keywordCoverageForDomain } from '../keywords/keywords';
import { createDomainId } from '@kernel/branded';

/**
* ROI row data structure for buyer ROI summary
*/
export interface RoiRow {
  id?: string;
  domain_id?: string;
  content_id?: string;
  production_cost_usd?: number;
  monthly_revenue_estimate?: number;
  roi_12mo?: number;
  payback_months?: number;
  created_at?: Date;
  updated_at?: Date;
}

/**
* Input parameters for generating buyer ROI summary
*/
export interface BuyerRoiSummaryInput {
  domain: string;
  domain_id: string;
  roi_rows: RoiRow[];
}

/**
* Keyword coverage result
*/
export interface KeywordCoverage {
  total_keywords: number;
  covered_keywords: number;
}

/**
* Buyer ROI summary result
*/
export interface BuyerRoiSummary {
  domain: string;
  total_content_items: number;
  portfolio_roi: ReturnType<typeof computePortfolioRoi>;
  keyword_coverage: KeywordCoverage;
  notes: string[];
}

/**
* Generate a comprehensive ROI summary for a potential domain buyer
* @param input - Domain data including ROI rows
* @returns Buyer ROI summary with portfolio metrics and keyword coverage
*/
export async function generateBuyerRoiSummary(
  input: BuyerRoiSummaryInput
): Promise<BuyerRoiSummary> {
  // P2-FIX: Do NOT default missing financial fields to 0.
  // A missing production_cost_usd defaulting to $0 makes the ROI appear infinite,
  // which is materially misleading for buyers making acquisition decisions.
  // Filter to rows that have both fields, and surface the data-quality count.
  const completeRows = input.roi_rows.filter(
    r =>
      r.production_cost_usd !== undefined &&
      r.production_cost_usd !== null &&
      r.monthly_revenue_estimate !== undefined &&
      r.monthly_revenue_estimate !== null
  );
  const missingDataCount = input.roi_rows.length - completeRows.length;

  // P1-FIX (P1-7): Replace unsafe `as number` cast with explicit numeric validation.
  // After the null/undefined filter above, TypeScript still infers the fields as
  // `number | undefined` because the interface uses optional properties. The cast
  // was silently accepted even when a DB returns a string or NaN, producing corrupt
  // ROI figures on buyer reports. Use Number() + isFinite to fail loudly instead.
  const portfolio = computePortfolioRoi(completeRows.map(r => {
    const cost = Number(r.production_cost_usd);
    const revenue = Number(r.monthly_revenue_estimate);
    if (!Number.isFinite(cost) || !Number.isFinite(revenue)) {
      throw new Error(
        `Non-numeric financial data in ROI row: cost=${String(r.production_cost_usd)}, ` +
        `revenue=${String(r.monthly_revenue_estimate)}`
      );
    }
    return { production_cost_usd: cost, monthly_revenue_estimate: revenue };
  }));
  const kw = await keywordCoverageForDomain(createDomainId(input.domain_id));

  const notes: string[] = [
    'ROI figures are advisory estimates based on historical performance and assumptions.',
    'Keyword coverage indicates how many known keywords have at least one page targeting them.',
  ];
  if (missingDataCount > 0) {
    notes.push(
      `Data quality: ${missingDataCount} of ${input.roi_rows.length} content items excluded from ROI ` +
      `calculation due to missing cost or revenue data.`
    );
  }

  return {
  domain: input.domain,
  total_content_items: input.roi_rows.length,
  portfolio_roi: portfolio,
  keyword_coverage: kw,
  notes,
  };
}
