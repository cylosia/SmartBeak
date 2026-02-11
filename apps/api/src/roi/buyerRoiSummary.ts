
import { computePortfolioRoi } from './portfolioRoi';
import { keywordCoverageForDomain } from '../keywords/keywords';

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
  const portfolio = computePortfolioRoi(input.roi_rows.map(r => ({
    production_cost_usd: r.production_cost_usd ?? 0,
    monthly_revenue_estimate: r.monthly_revenue_estimate ?? 0,
  })));
  const kw = await keywordCoverageForDomain(input.domain_id);

  return {
  domain: input.domain,
  total_content_items: input.roi_rows.length,
  portfolio_roi: portfolio,
  keyword_coverage: kw,
  notes: [
    'ROI figures are advisory estimates based on historical performance and assumptions.',
    'Keyword coverage indicates how many known keywords have at least one page targeting them.'
  ]
  };
}
