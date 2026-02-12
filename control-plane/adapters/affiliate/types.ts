export type AffiliateRevenueReport = {
  affiliate_offer_external_id: string;
  reported_period_start: string;
  reported_period_end: string;
  gross_revenue: number;
  net_revenue: number;
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
