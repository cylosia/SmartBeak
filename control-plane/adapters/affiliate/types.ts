export type AffiliateRevenueReport = {
  affiliate_offer_external_id: string;
  reported_period_start: string;
  reported_period_end: string;
  /**
   * FIXED (AFFILIATE-1): Decimal string, e.g. "1234.56".
   * Must NOT be `number` — IEEE 754 float arithmetic corrupts financial totals.
   * Parse with decimal.js or similar when arithmetic is needed.
   */
  gross_revenue: string;
  /**
   * FIXED (AFFILIATE-1): Decimal string, e.g. "1234.56".
   * Same constraint as gross_revenue — never JavaScript `number` for money.
   */
  net_revenue: string;
  conversions: number;
  /** ISO 4217 currency code, e.g. "USD", "EUR" */
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
