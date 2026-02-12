import fetch from 'node-fetch';

import { AffiliateRevenueAdapter, AffiliateRevenueReport } from './types';




/**
* CJ Affiliate (Commission Junction) Adapter
* Uses CJ Developer APIs
*
* Required: CJ_PERSONAL_TOKEN, CJ_WEBSITE_ID
* API Docs: https://developers.cj.com/
*/

export interface CJCredentials {
  personalToken: string;
  websiteId: string;
}

export interface CJCommissionItem {
  original: boolean;
  originalActionId?: string;
  actionTrackerId: string;
  actionTrackerName: string;
  advertiserId: string;
  advertiserName: string;
  advertiserLocation: string;
  commissionId: string;
  postingDate: string;
  eventDate: string;
  lockingDate: string;
  orderId: string;
  category: string;
  sku: string;
  quantity: number;
  saleAmount: { amount: number };
  commissionAmount: { amount: number };
  status: string;
  publisherId: string;
  publisherName: string;
}

export class CJAdapter implements AffiliateRevenueAdapter {
  readonly provider = 'cj';
  private credentials: CJCredentials;
  private baseUrl = 'https://commissions.api.cj.com/query';

  constructor(credentials?: Partial<CJCredentials>) {
  this.credentials = {
    personalToken: credentials?.personalToken || process.env['CJ_PERSONAL_TOKEN'] || '',
    websiteId: credentials?.websiteId || process.env['CJ_WEBSITE_ID'] || '',
  };

  if (!this.credentials.personalToken) {
    throw new Error('CJ_PERSONAL_TOKEN is required');
  }
  if (!this.credentials.websiteId) {
    throw new Error('CJ_WEBSITE_ID is required');
  }
  }

  /**
  * Fetch commission transactions for a date range
  */
  async fetchReports(input: {
  startDate: Date;
  endDate: Date;
  credentialsRef: string;
  }): Promise<AffiliateRevenueReport[]> {
  try {
    const startDateStr = input.startDate.toISOString().split('T')[0];
    const endDateStr = input.endDate.toISOString().split('T')[0];

    // CJ uses GraphQL API with variables for security
    const query = `
    query CommissionTransactions($forPublishers: [String!]!, $since: String!, $before: String!) {
    commissionTransactions(
    forPublishers: $forPublishers
    since: $since
    before: $before
    ) {
    records {
        saleAmount {
        }
        commissionAmount {
        }
    }
    totalCommissionAmount {
    }
    }
    }
    `;

    const variables = {
    forPublishers: [this.credentials.websiteId],
    since: startDateStr,
    before: endDateStr,
    };

    const response = await fetch(this.baseUrl, {
    method: 'POST',
    headers: {
    'Authorization': `Bearer ${this.credentials.personalToken}`,
    'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
    const error = await response.text();
    throw new Error(`CJ API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
    data?: {
    commissionTransactions?: {
    records?: CJCommissionItem[];
    };
    };
    errors?: Array<{ message: string }>;
    };

    if (data.errors) {
    throw new Error(`CJ GraphQL error: ${data.errors.map(e => e.message).join(', ')}`);
    }

    const transactions = data.data?.commissionTransactions?.records || [];

    return transactions.map((t): AffiliateRevenueReport => ({
    affiliate_offer_external_id: t.sku || t.actionTrackerId,
    reported_period_start: t.eventDate,
    reported_period_end: t.postingDate,
    gross_revenue: t.saleAmount?.amount || 0,
    net_revenue: t.commissionAmount?.amount || 0,
    conversions: t.quantity || 1,
    currency: 'USD', // CJ reports in USD by default
    status: this.mapStatus(t.status),
    source_provider: 'cj',
    source_reference: `commissionId:${t.commissionId}|orderId:${t.orderId}|advertiser:${t.advertiserId}`,
    }));
  } catch (error: unknown) {
    console["error"]('[CJAdapter] Error fetching reports:', error instanceof Error ? error.message : String(error));
    throw error;
  }
  }

  /**
  * Map CJ status to our standard status
  */
  private mapStatus(cjStatus: string): 'provisional' | 'final' | 'reversed' {
  const statusMap: Record<string, 'provisional' | 'final' | 'reversed'> = {
    'active': 'provisional',
    'locked': 'final',
    'extended': 'provisional',
    'closed': 'final',
    'reversed': 'reversed',
    'corrected': 'provisional',
  };
  return statusMap[cjStatus?.toLowerCase()] || 'provisional';
  }

  /**
  * List advertisers (merchants) in the publisher's account
  */
  async listAdvertisers(): Promise<Array<{
  id: string;
  name: string;
  category: string;
  status: string;
  commissionTerms?: string;
  }>> {
  try {
    const query = `
    query AdvertiserRelationships($forPublishers: [String!]!) {
    advertiserRelationships(
    forPublishers: $forPublishers
    ) {
    records {
        primaryCategory {
        }
        commissionTerms {
        items {
        }
        }
    }
    }
    }
    `;

    const variables = {
    forPublishers: [this.credentials.websiteId],
    };

    const response = await fetch(this.baseUrl, {
    method: 'POST',
    headers: {
    'Authorization': `Bearer ${this.credentials.personalToken}`,
    'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
    const error = await response.text();
    throw new Error(`CJ API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
    data?: {
    advertiserRelationships?: {
    records?: Array<{
        advertiserId: string;
        advertiserName: string;
        primaryCategory?: { name: string };
        relationshipStatus: string;
        commissionTerms?: {
        items?: Array<{
        category: string;
        salePercent: number;
        }>;
        };
    }>;
    };
    };
    errors?: Array<{ message: string }>;
    };

    const advertisers = data.data?.advertiserRelationships?.records || [];

    return advertisers.map(a => ({
    id: a.advertiserId,
    name: a.advertiserName,
    category: a.primaryCategory?.name || 'Unknown',
    status: a.relationshipStatus,
    commissionTerms: (a.commissionTerms?.items
    ?.map(t => `${t.category}: ${t.salePercent}%`)
    .join(', ') || undefined) as string | undefined,
    })) as { id: string; name: string; category: string; status: string; commissionTerms?: string; }[];
  } catch (error: unknown) {
    console["error"]('[CJAdapter] Error listing advertisers:', error instanceof Error ? error.message : String(error));
    throw error;
  }
  }

  /**
  * Get product links for an advertiser
  */
  async getProductLinks(advertiserId: string, keywords?: string): Promise<Array<{
  id: string;
  name: string;
  url: string;
  description?: string;
  }>> {
  try {
    const query = `
    query LinkSearch($forAdvertisers: [String!]!, $forPublishers: [String!]!, $keywords: String) {
    linkSearch(
    forAdvertisers: $forAdvertisers
    forPublishers: $forPublishers
    keywords: $keywords
    ) {
    records {
    }
    }
    }
    `;

    const variables = {
    forAdvertisers: [advertiserId],
    forPublishers: [this.credentials.websiteId],
    keywords: keywords || null,
    };

    const response = await fetch(this.baseUrl, {
    method: 'POST',
    headers: {
    'Authorization': `Bearer ${this.credentials.personalToken}`,
    'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
    const error = await response.text();
    throw new Error(`CJ API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
    data?: {
    linkSearch?: {
    records?: Array<{
        linkId: string;
        linkName: string;
        description?: string;
        clickUrl: string;
    }>;
    };
    };
    errors?: Array<{ message: string }>;
    };

    const links = data.data?.linkSearch?.records || [];

    return links.map(l => ({
    id: l.linkId,
    name: l.linkName,
    url: l.clickUrl,
    description: (l.description || undefined) as string | undefined,
    })) as { id: string; name: string; url: string; description?: string; }[];
  } catch (error: unknown) {
    console["error"]('[CJAdapter] Error getting product links:', error instanceof Error ? error.message : String(error));
    throw error;
  }
  }

  /**
  * Get publisher stats/summary
  */
  async getPublisherStats(startDate: Date, endDate: Date): Promise<{
  clicks: number;
  impressions: number;
  sales: number;
  commissions: number;
  epc: number; // Earnings per click
  }> {
  try {
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    const query = `
    query PublisherStats($forPublishers: [String!]!, $since: String!, $before: String!) {
    publisherStats(
    forPublishers: $forPublishers
    since: $since
    before: $before
    ) {
    sales {
    }
    commissions {
    }
    epc {
    }
    }
    }
    `;

    const variables = {
    forPublishers: [this.credentials.websiteId],
    since: startDateStr,
    before: endDateStr,
    };

    const response = await fetch(this.baseUrl, {
    method: 'POST',
    headers: {
    'Authorization': `Bearer ${this.credentials.personalToken}`,
    'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
    const error = await response.text();
    throw new Error(`CJ API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
    data?: {
    publisherStats?: {
    clicks: number;
    impressions: number;
    sales?: { amount: number };
    commissions?: { amount: number };
    epc?: { amount: number };
    };
    };
    errors?: Array<{ message: string }>;
    };

    const stats = data.data?.publisherStats;

    return {
    clicks: stats?.clicks || 0,
    impressions: stats?.impressions || 0,
    sales: stats?.sales?.amount || 0,
    commissions: stats?.commissions?.amount || 0,
    epc: stats?.epc?.amount || 0,
    };
  } catch (error: unknown) {
    console["error"]('[CJAdapter] Error getting publisher stats:', error instanceof Error ? error.message : String(error));
    throw error;
  }
  }

  /**
  * Generate deep link
  */
  generateDeepLink(clickUrl: string, destinationUrl: string): string {
  // CJ deep links use the click URL as base and append destination
  const separator = clickUrl.includes('?') ? '&' : '?';
  return `${clickUrl}${separator}url=${encodeURIComponent(destinationUrl)}`;
  }
}

// P0-8 FIX: Use lazy initialization to prevent module-level crash when
// CJ_PERSONAL_TOKEN or CJ_WEBSITE_ID env vars are missing.
// Previously, `new CJAdapter()` at module scope crashed the entire app on import.
let _cjAdapter: CJAdapter | null = null;
export function getCjAdapter(): CJAdapter {
  if (!_cjAdapter) {
  _cjAdapter = new CJAdapter();
  }
  return _cjAdapter;
}

// Backward-compatible getter (deprecated — use getCjAdapter() instead)
export const cjAdapter = new Proxy({} as CJAdapter, {
  get(_target, prop) {
  return (getCjAdapter() as Record<string | symbol, unknown>)[prop];
  },
});
