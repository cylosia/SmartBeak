
import { computeSeoCompleteness } from './buyerCompleteness';
export type BuyerSeoReport = {
  domain: string;
  completeness_score: number;
  page_count: number;
  cluster_count: number;
  freshness_ratio: number;
  schema_coverage: number;
  notes: string[];
};

export function generateBuyerSeoReport(input: {
  domain: string;
  pages: number;
  clusters: number;
  freshness_ratio: number;
  schema_coverage: number;
}): BuyerSeoReport {
  return {
  domain: input.domain,
  completeness_score: computeSeoCompleteness({
    pages: input.pages,
    clusters: input.clusters,
    updated_ratio: input.freshness_ratio,
    schema_coverage: input.schema_coverage
  }),
  page_count: input.pages,
  cluster_count: input.clusters,
  freshness_ratio: input.freshness_ratio,
  schema_coverage: input.schema_coverage,
  notes: [
    'SEO completeness score is advisory and reflects content depth and maintenance.',
    'Higher freshness ratios indicate lower risk for buyers.'
  ]
  };
}
