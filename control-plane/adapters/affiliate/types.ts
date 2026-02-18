import { z } from 'zod';

/**
 * FIXED (AFFILIATE-SCHEMA): Zod schema for runtime validation of external affiliate revenue
 * data received from third-party providers (Facebook, LinkedIn, etc.).
 *
 * External data is untrusted: a compromised or MITM-attacked provider could send malformed
 * or malicious revenue figures. Parsing via this schema at the adapter boundary ensures:
 * 1. Financial fields (gross_revenue, net_revenue) conform to decimal string format
 * 2. Currency codes are exactly 3 uppercase letters (ISO 4217)
 * 3. Status values are from the expected enum (no injection of arbitrary status strings)
 * 4. conversions is a non-negative integer (no negative conversion counts)
 *
 * Adapters MUST call AffiliateRevenueReportSchema.array().parse(rawData) before returning.
 */
export const AffiliateRevenueReportSchema = z.object({
  affiliate_offer_external_id: z.string().min(1).max(255),
  reported_period_start: z.string().datetime({ message: 'reported_period_start must be ISO 8601' }),
  reported_period_end: z.string().datetime({ message: 'reported_period_end must be ISO 8601' }),
  /**
   * Decimal string, e.g. "1234.56".
   * Must NOT be `number` — IEEE 754 float arithmetic corrupts financial totals.
   * Parse with decimal.js or similar when arithmetic is needed.
   */
  gross_revenue: z.string().regex(/^\d+(\.\d{1,2})?$/, 'gross_revenue must be a decimal string, e.g. "1234.56"'),
  /**
   * Decimal string, e.g. "1234.56".
   * Same constraint as gross_revenue — never JavaScript `number` for money.
   */
  net_revenue: z.string().regex(/^\d+(\.\d{1,2})?$/, 'net_revenue must be a decimal string, e.g. "1234.56"'),
  conversions: z.number().int().nonnegative(),
  /** ISO 4217 currency code, e.g. "USD", "EUR" */
  currency: z.string().length(3).regex(/^[A-Z]{3}$/, 'currency must be a 3-letter ISO 4217 code'),
  status: z.enum(['provisional', 'final', 'reversed']),
  source_provider: z.string().min(1).max(100),
  source_reference: z.string().min(1).max(255),
});

export type AffiliateRevenueReport = z.infer<typeof AffiliateRevenueReportSchema>;

export interface AffiliateRevenueAdapter {
  provider: string;
  fetchReports(input: {
    startDate: Date;
    endDate: Date;
    credentialsRef: string;
  }): Promise<AffiliateRevenueReport[]>;
}
