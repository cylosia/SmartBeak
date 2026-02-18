export type AffiliateRevenueReport = {
  affiliate_offer_external_id: string;
  reported_period_start: string;
  reported_period_end: string;
  // P1-6 FIX: Use string for monetary values, not number.
  // PostgreSQL NUMERIC serialises to a string via the pg driver; keeping it as
  // string preserves arbitrary decimal precision and avoids IEEE 754 rounding
  // errors (e.g. 0.1 + 0.2 ≠ 0.3) that affect JavaScript's number type.
  // Callers that need arithmetic should parse with a Decimal library (e.g. big.js).
  gross_revenue: string;
  net_revenue: string;
  conversions: number;
  currency: string;
  status: 'provisional' | 'final' | 'reversed';
  source_provider: string;
  source_reference: string;
};

export interface AffiliateRevenueAdapter {
  provider: string;
  fetchReports(input: {
  startDate: Date;
  endDate: Date;
  credentialsRef: string;
  }): Promise<AffiliateRevenueReport[]>;
}
