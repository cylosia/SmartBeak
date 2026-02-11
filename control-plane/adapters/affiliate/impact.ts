import fetch from 'node-fetch';

import { AffiliateRevenueAdapter, AffiliateRevenueReport } from './types';

﻿


/**
* Impact (formerly Impact Radius) Adapter
* Uses Impact REST API v2
*
* Required: IMPACT_ACCOUNT_SID, IMPACT_AUTH_TOKEN
* API Docs: https://developer.impact.com/
*/

export interface ImpactCredentials {
  accountSid: string;
  authToken: string;
  apiUrl?: string;
}

export interface ImpactAction {
  Id: string;
  CampaignId: string;
  CampaignName: string;
  State: 'PENDING' | 'APPROVED' | 'REVERSED' | 'REPLACED';
  EventDate: string;
  LockingDate?: string;
  PayoutDate?: string;
  CustomerId?: string;
  CustomerStatus?: string;
  ActionTrackerId: string;
  ActionTrackerName: string;
  SubId1?: string;
  SubId2?: string;
  SubId3?: string;
  SharedId?: string;
  Uri: string;
}

export interface ImpactActionDetail extends ImpactAction {
  Currency: string;
  Payout: number;
  Amount: number;
  MediaPartnerId: string;
  MediaPartnerName: string;
  Revenue: number;
  Quantity: number;
  ProductName?: string;
  ProductSku?: string;
  PromoCode?: string;
  PayoutRule?: string;
}

export class ImpactAdapter implements AffiliateRevenueAdapter {
  readonly provider = 'impact';
  private credentials: ImpactCredentials;
  private baseUrl: string;

  constructor(credentials?: Partial<ImpactCredentials>) {
  this.credentials = {
    accountSid: credentials?.accountSid || process.env['IMPACT_ACCOUNT_SID'] || '',
    authToken: credentials?.authToken || process.env['IMPACT_AUTH_TOKEN'] || '',
    apiUrl: credentials?.apiUrl || process.env['IMPACT_API_URL'] || 'https://api.impact.com',
  };

  if (!this.credentials.accountSid) {
    throw new Error('IMPACT_ACCOUNT_SID is required');
  }
  if (!this.credentials.authToken) {
    throw new Error('IMPACT_AUTH_TOKEN is required');
  }

  this.baseUrl = `${this.credentials.apiUrl}/Mediapartners/${this.credentials.accountSid}`;
  }

  /**
  * Build authentication headers for Impact API
  * Uses Basic Auth with Account SID as username and Auth Token as password
  */
  private getAuthHeaders(): Record<string, string> {
  const auth = Buffer.from(`${this.credentials.accountSid}:${this.credentials.authToken}`).toString('base64');
  return {
    'Authorization': `Basic ${auth}`,
    'Accept': 'application/json',
  };
  }

  /**
  * Fetch action records (conversions) for a date range

  */
  async fetchReports(input: {
  startDate: Date;
  endDate: Date;
  credentialsRef: string;
  }): Promise<AffiliateRevenueReport[]> {
  try {
    // Format dates for Impact API (ISO 8601)
    const startDateStr = input.startDate.toISOString();
    const endDateStr = input.endDate.toISOString();

    // Build URL with filters
    const url = new URL(`${this.baseUrl}/Actions`);
    url.searchParams.append('EventDateStart', startDateStr);
    url.searchParams.append('EventDateEnd', endDateStr);
    url.searchParams.append('PageSize', '1000'); // Max page size

    url.searchParams.append('$expand', 'ActionDetails');

    const response = await fetch(url.toString(), {
    method: 'GET',
    headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
    const error = await response.text();
    throw new Error(`Impact API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
    '@pages'?: number;
    '@page'?: number;
    '@pageSize'?: number;
    '@total'?: number;
    Actions?: Array<ImpactAction & {
    ActionDetails?: ImpactActionDetail;
    }>;
    };

    const actions = data.Actions || [];

    const reports: AffiliateRevenueReport[] = [];

    for (const action of actions) {
    // Use inline ActionDetails if available, otherwise fall back to basic info
    const details = action.ActionDetails;

    if (details) {
    reports.push({
    affiliate_offer_external_id: details.ProductSku || details.ActionTrackerId,
    reported_period_start: details.EventDate,
    reported_period_end: details.LockingDate || details.PayoutDate || details.EventDate,
    gross_revenue: details.Revenue || 0,
    net_revenue: details.Payout || 0,
    conversions: details.Quantity || 1,
    currency: details.Currency || 'USD',
    status: this.mapStatus(details.State),
    source_provider: 'impact',
    source_reference: `actionId:${details.Id}|campaign:${details.CampaignId}|customer:${details.CustomerId}`,
    });
    } else {
    // Fallback to basic action info if details not available
    reports.push({
    affiliate_offer_external_id: action.ActionTrackerId,
    reported_period_start: action.EventDate,
    reported_period_end: action.EventDate,
    gross_revenue: 0,
    net_revenue: 0,
    conversions: 1,
    currency: 'USD',
    status: this.mapStatus(action.State),
    source_provider: 'impact',
    source_reference: `actionId:${action.Id}|campaign:${action.CampaignId}`,
    });
    }
    }

    return reports;
  } catch (error: unknown) {
    console["error"]('[ImpactAdapter] Error fetching reports:', error instanceof Error ? error.message : String(error));
    throw error;
  }
  }

  /**
  * Get detailed information about a specific action
  */
  private async getActionDetails(actionId: string): Promise<ImpactActionDetail> {
  const response = await fetch(`${this.baseUrl}/Actions/${actionId}`, {
    method: 'GET',
    headers: this.getAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch action details: ${response.status}`);
  }

  return await response.json() as ImpactActionDetail;
  }

  /**
  * Map Impact status to standard status
  */
  private mapStatus(impactState: string): 'provisional' | 'final' | 'reversed' {
  const statusMap: Record<string, 'provisional' | 'final' | 'reversed'> = {
    'PENDING': 'provisional',
    'APPROVED': 'final',
    'REVERSED': 'reversed',
    'REPLACED': 'provisional',
  };
  return statusMap[impactState] || 'provisional';
  }

  /**
  * List campaigns (advertisers) in the account
  */
  async listCampaigns(status?: 'PENDING' | 'APPROVED' | 'REJECTED'): Promise<Array<{
  id: string;
  name: string;
  description?: string;
  status: string;
  category?: string;
  currency: string;
  commissionTerms?: string;
  trackingLink?: string;
  }>> {
  try {
    const url = new URL(`${this.baseUrl}/Campaigns`);
    if (status) {
    url.searchParams.append('Status', status);
    }
    url.searchParams.append('PageSize', '1000');

    const response = await fetch(url.toString(), {
    method: 'GET',
    headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
    const error = await response.text();
    throw new Error(`Impact API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
    Campaigns?: Array<{
    Id: string;
    Name: string;
    Description?: string;
    Status: string;
    Category?: string;
    Currency: string;
    TrackingLink?: string;
    DefaultPayout?: number;
    PayoutType?: string;
    }>;
    };

    return (data.Campaigns || []).map(c => ({
    id: String(c["Id"]),
    name: c.Name,
    description: (c.Description || undefined) as string | undefined,
    status: c.Status,
    category: (c.Category || undefined) as string | undefined,
    currency: c.Currency,
    commissionTerms: (c.DefaultPayout ? `${c.DefaultPayout} ${c.PayoutType}` : undefined) as string | undefined,
    trackingLink: (c.TrackingLink || undefined) as string | undefined,
    })) as { id: string; name: string; description?: string; status: string; category?: string; currency: string; commissionTerms?: string; trackingLink?: string; }[];
  } catch (error: unknown) {
    console["error"]('[ImpactAdapter] Error listing campaigns:', error instanceof Error ? error.message : String(error));
    throw error;
  }
  }

  /**
  * Get campaign details including ad formats and links
  */
  async getCampaignAds(campaignId: string): Promise<Array<{
  id: string;
  name: string;
  type: string;
  trackingLink: string;
  landingPageUrl?: string;
  creativeUrl?: string;
  dimensions?: { width: number; height: number };
  }>> {
  try {
    const url = new URL(`${this.baseUrl}/Campaigns/${campaignId}/Ads`);
    url.searchParams.append('PageSize', '1000');

    const response = await fetch(url.toString(), {
    method: 'GET',
    headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
    const error = await response.text();
    throw new Error(`Impact API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
    Ads?: Array<{
    Id: string;
    Name: string;
    AdType: string;
    TrackingLink: string;
    LandingPageUrl?: string;
    CreativeUrl?: string;
    Width?: number;
    Height?: number;
    }>;
    };

    return (data.Ads || []).map(ad => ({
    id: String(ad["Id"]),
    name: ad.Name,
    type: ad.AdType,
    trackingLink: ad.TrackingLink,
    landingPageUrl: (ad.LandingPageUrl || undefined) as string | undefined,
    creativeUrl: (ad.CreativeUrl || undefined) as string | undefined,
    dimensions: (ad.Width && ad.Height ? { width: ad.Width, height: ad.Height } : undefined) as { width: number; height: number; } | undefined,
    })) as { id: string; name: string; type: string; trackingLink: string; landingPageUrl?: string; creativeUrl?: string; dimensions?: { width: number; height: number; }; }[];
  } catch (error: unknown) {
    console["error"]('[ImpactAdapter] Error getting campaign ads:', error instanceof Error ? error.message : String(error));
    throw error;
  }
  }

  /**
  * Get performance summary
  */
  async getPerformanceSummary(startDate: Date, endDate: Date): Promise<{
  clicks: number;
  actions: number;
  revenue: number;
  payouts: number;
  currency: string;
  }> {
  try {
    const url = new URL(`${this.baseUrl}/Reports/ActionSummary`);
    url.searchParams.append('StartDate', startDate.toISOString());
    url.searchParams.append('EndDate', endDate.toISOString());

    const response = await fetch(url.toString(), {
    method: 'GET',
    headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
    const error = await response.text();
    throw new Error(`Impact API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
    Clicks?: number;
    Actions?: number;
    Revenue?: { Amount: number; Currency: string };
    Payouts?: { Amount: number; Currency: string };
    };

    return {
    clicks: data.Clicks || 0,
    actions: data.Actions || 0,
    revenue: data.Revenue?.Amount || 0,
    payouts: data.Payouts?.Amount || 0,
    currency: data.Revenue?.Currency || 'USD',
    };
  } catch (error: unknown) {
    console["error"]('[ImpactAdapter] Error getting performance summary:', error instanceof Error ? error.message : String(error));
    throw error;
  }
  }

  /**
  * Generate tracking link with sub-IDs
  */
  generateTrackingLink(
  baseUrl: string,
  subIds?: { subId1?: string; subId2?: string; subId3?: string; sharedId?: string }
  ): string {
  const url = new URL(baseUrl);

  if (subIds?.subId1) url.searchParams.append('subId1', subIds.subId1);
  if (subIds?.subId2) url.searchParams.append('subId2', subIds.subId2);
  if (subIds?.subId3) url.searchParams.append('subId3', subIds.subId3);
  if (subIds?.sharedId) url.searchParams.append('sharedId', subIds.sharedId);

  return url.toString();
  }

  /**
  * Get deals/coupons for a campaign
  */
  async getDeals(campaignId?: string): Promise<Array<{
  id: string;
  name: string;
  description?: string;
  code?: string;
  discount?: string;
  startDate?: string;
  endDate?: string;
  landingPage?: string;
  }>> {
  try {
    const url = new URL(`${this.baseUrl}/Deals`);
    if (campaignId) {
    url.searchParams.append('CampaignId', campaignId);
    }
    url.searchParams.append('PageSize', '1000');

    const response = await fetch(url.toString(), {
    method: 'GET',
    headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
    const error = await response.text();
    throw new Error(`Impact API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
    Deals?: Array<{
    Id: string;
    Name: string;
    Description?: string;
    CouponCode?: string;
    Discount?: string;
    StartDate?: string;
    EndDate?: string;
    LandingPageUrl?: string;
    }>;
    };

    return (data.Deals || []).map(d => ({
    id: String(d["Id"]),
    name: d.Name,
    description: (d.Description || undefined) as string | undefined,
    code: (d.CouponCode || undefined) as string | undefined,
    discount: (d.Discount || undefined) as string | undefined,
    startDate: (d.StartDate || undefined) as string | undefined,
    endDate: (d.EndDate || undefined) as string | undefined,
    landingPage: (d.LandingPageUrl || undefined) as string | undefined,
    })) as { id: string; name: string; description?: string; code?: string; discount?: string; startDate?: string; endDate?: string; landingPage?: string; }[];
  } catch (error: unknown) {
    console["error"]('[ImpactAdapter] Error getting deals:', error instanceof Error ? error.message : String(error));
    throw error;
  }
  }

  /**
  * Get unique promo codes assigned to the publisher
  */
  async getPromoCodes(campaignId?: string): Promise<Array<{
  id: string;
  code: string;
  campaignId: string;
  campaignName: string;
  status: string;
  startDate?: string;
  endDate?: string;
  }>> {
  try {
    const url = new URL(`${this.baseUrl}/PromoCodes`);
    if (campaignId) {
    url.searchParams.append('CampaignId', campaignId);
    }
    url.searchParams.append('PageSize', '1000');

    const response = await fetch(url.toString(), {
    method: 'GET',
    headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
    const error = await response.text();
    throw new Error(`Impact API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
    PromoCodes?: Array<{
    Id: string;
    Code: string;
    CampaignId: string;
    CampaignName: string;
    Status: string;
    StartDate?: string;
    EndDate?: string;
    }>;
    };

    return (data.PromoCodes || []).map(p => ({
    id: String(p["Id"]),
    code: p.Code,
    campaignId: p.CampaignId,
    campaignName: p.CampaignName,
    status: p.Status,
    startDate: (p.StartDate || undefined) as string | undefined,
    endDate: (p.EndDate || undefined) as string | undefined,
    })) as { id: string; code: string; campaignId: string; campaignName: string; status: string; startDate?: string; endDate?: string; }[];
  } catch (error: unknown) {
    console["error"]('[ImpactAdapter] Error getting promo codes:', error instanceof Error ? error.message : String(error));
    throw error;
  }
  }
}

// Backward-compatible default export
export const impactAdapter = new ImpactAdapter();
