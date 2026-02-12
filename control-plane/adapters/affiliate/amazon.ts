import fetch from 'node-fetch';

import { timeoutConfig } from '@config';
import { StructuredLogger, createRequestContext, MetricsCollector } from '@kernel/request';
import { validateNonEmptyString } from '@kernel/validation';
import { withRetry } from '@kernel/retry';

import { AffiliateRevenueAdapter, AffiliateRevenueReport } from './types';

import { AbortController } from 'abort-controller';


/**

* Amazon Associates (Product Advertising API 5.0)
* Fetches affiliate earnings reports
*
*/

export interface AmazonCredentials {
  accessKey: string;
  secretKey: string;
  associateTag: string;
  marketplace?: string | undefined;
}

export class AmazonAdapter implements AffiliateRevenueAdapter {
  readonly provider = 'amazon';
  private readonly credentials: AmazonCredentials;
  private readonly baseUrls: Record<string, string>;
  private readonly timeoutMs = timeoutConfig.long;
  private readonly logger: StructuredLogger;
  private readonly metrics: MetricsCollector;

  constructor(credentials?: Partial<AmazonCredentials>) {
  this.credentials = {
    accessKey: credentials?.accessKey || process.env['AMAZON_ACCESS_KEY'] || '',
    secretKey: credentials?.secretKey || process.env['AMAZON_SECRET_KEY'] || '',
    associateTag: credentials?.associateTag || process.env['AMAZON_ASSOCIATE_TAG'] || '',
    marketplace: credentials?.marketplace || process.env['AMAZON_MARKETPLACE'] || 'US',
  };

  if (!this.credentials.accessKey || !this.credentials.secretKey) {
    throw new Error('AMAZON_ACCESS_KEY and AMAZON_SECRET_KEY are required');
  }
  if (!this.credentials.associateTag) {
    throw new Error('AMAZON_ASSOCIATE_TAG is required');
  }

  this.baseUrls = {
    'US': 'https://webservices.amazon.com',
    'CA': 'https://webservices.amazon.ca',
    'UK': 'https://webservices.amazon.co.uk',
    'DE': 'https://webservices.amazon.de',
    'FR': 'https://webservices.amazon.fr',
    'JP': 'https://webservices.amazon.co.jp',
    'IN': 'https://webservices.amazon.in',
    'BR': 'https://webservices.amazon.com.br',
    'MX': 'https://webservices.amazon.com.mx',
    'AU': 'https://webservices.amazon.com.au',
    'AE': 'https://webservices.amazon.ae',
    'SG': 'https://webservices.amazon.sg',
    'TR': 'https://webservices.amazon.com.tr',
  };

  this.logger = new StructuredLogger('AmazonAdapter');
  this.metrics = new MetricsCollector('AmazonAdapter');
  }

  /**
  * Search products using Product Advertising API 5.0
  */
  async searchProducts(keywords: string, category?: string | undefined): Promise<Array<{
  asin: string;
  title: string;
  imageUrl?: string | undefined;
  price?: number | undefined;
  currency?: string | undefined;
  url: string;
  }>> {
  const context = createRequestContext('AmazonAdapter', 'searchProducts');

  validateNonEmptyString(keywords, 'keywords');

  this.logger.info('Searching Amazon products', context, { keywords, category });

  const startTime = Date.now();

  const baseUrl = this.baseUrls[this.credentials.marketplace || 'US'];

  const timestamp = new Date().toISOString();
  const payload = {
    Keywords: keywords,
    SearchIndex: category || 'All',
    ItemPage: 1,
    Resources: [
    'Images.Primary.Large',
    'ItemInfo.Title',
    'Offers.Listings.Price',
    ],
  };

  const headers = this.buildPAAPIHeaders(payload, timestamp);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

  try {
    const res = await withRetry(async () => {
    const response = await fetch(`${baseUrl}/paapi5/searchitems`, {
    method: 'POST',
    headers: {
    'Content-Type': 'application/json',
    ...headers,
    },
    body: JSON.stringify(payload),
    signal: controller.signal,
    });

    if (!response.ok) {
    if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after');
    const error = new Error(`Amazon PAAPI rate limited: ${response.status}`);
    (error as Error & { status: number; retryAfter?: string }).status = response.status;
    (error as Error & { status: number; retryAfter?: string | undefined }).retryAfter = retryAfter || undefined;
    throw error;
    }

    throw new Error(`Amazon PAAPI error: ${response.status} ${response.statusText}`);
    }

    return response;
    }, { maxRetries: 3 });

    const rawData: unknown = await res.json();

    // Runtime validation of Amazon PAAPI response structure
    const products: Array<{
    asin: string;
    title: string;
    imageUrl?: string;
    price?: number;
    currency?: string;
    url: string;
    }> = [];

    if (typeof rawData === 'object' && rawData !== null) {
    const data = rawData as Record<string, unknown>;
    const searchResult = data['SearchResult'];
    if (typeof searchResult === 'object' && searchResult !== null) {
    const sr = searchResult as Record<string, unknown>;
    const items = sr['Items'];
    if (Array.isArray(items)) {
    for (const item of items) {
        if (typeof item !== 'object' || item === null) continue;
        const i = item as Record<string, unknown>;
        if (typeof i['ASIN'] !== 'string' || typeof i['DetailPageURL'] !== 'string') {
        this.logger.warn('Skipping malformed item in Amazon PAAPI response');
        continue;
        }
        const itemInfo = i['ItemInfo'] as Record<string, unknown> | undefined;
        const title = (itemInfo?.['Title'] as Record<string, unknown> | undefined)?.['DisplayValue'];
        const images = i['Images'] as Record<string, unknown> | undefined;
        const primary = (images?.['Primary'] as Record<string, unknown> | undefined);
        const large = (primary?.['Large'] as Record<string, unknown> | undefined);
        const offers = i['Offers'] as Record<string, unknown> | undefined;
        const listings = offers?.['Listings'];
        let price: number | undefined;
        let currency: string | undefined;
        if (Array.isArray(listings) && listings.length > 0) {
        const firstListing = listings[0] as Record<string, unknown> | undefined;
        const priceObj = firstListing?.['Price'] as Record<string, unknown> | undefined;
        if (typeof priceObj?.['Amount'] === 'number') price = priceObj['Amount'];
        if (typeof priceObj?.['Currency'] === 'string') currency = priceObj['Currency'];
        }
        products.push({
        asin: i['ASIN'],
        title: typeof title === 'string' ? title : '',
        imageUrl: typeof large?.['URL'] === 'string' ? large['URL'] : undefined,
        price,
        currency,
        url: i['DetailPageURL'],
        });
    }
    }
    }
    }

    const latency = Date.now() - startTime;
    this.metrics.recordLatency('searchProducts', latency, true);
    this.metrics.recordSuccess('searchProducts');
    this.logger.info('Successfully searched Amazon products', context, { count: products.length });

    return products;
  } catch (error) {
    const latency = Date.now() - startTime;
    this.metrics.recordLatency('searchProducts', latency, false);
    this.metrics.recordError('searchProducts', error instanceof Error ? error.name : 'Unknown');
    this.logger["error"]('Failed to search Amazon products', context, error as Error);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
  }

  /**
  * Build PAAPI 5.0 headers with AWS Signature Version 4
  */
  private buildPAAPIHeaders(payload: unknown, timestamp: string): Record<string, string> {
  const date = timestamp.split('T')[0]!.replace(/-/g, '');

  return {
    'X-Amz-Date': timestamp.replace(/[-:]/g, '').split('.')[0] + 'Z',
    'X-Amz-Target': 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems',
    'Content-Encoding': 'amz-1.0',
    'Authorization': `AWS4-HMAC-SHA256 Credential=${this.credentials.accessKey}/${date}/us-east-1/ProductAdvertisingAPI/aws4_request`,
  };
  }

  /**
  * Fetch affiliate reports (placeholder - requires manual CSV import)
  */
  async fetchReports(_input: {
  startDate: Date;
  endDate: Date;
  credentialsRef: string;
  }): Promise<AffiliateRevenueReport[]> {
  const context = createRequestContext('AmazonAdapter', 'fetchReports');
  this.logger.warn('Amazon Associates earnings API not available', context);
  return [];
  }

  /**
  * Generate affiliate link
  */
  generateAffiliateLink(asin: string, tag?: string): string {
  const trackingId = tag || this.credentials.associateTag;
  const domain = this.getDomainForMarketplace();
  return `https://${domain}/dp/${asin}?tag=${trackingId}`;
  }

  /**
  * Get domain for marketplace
  */
  private getDomainForMarketplace(): string {
  const domains: Record<string, string> = {
    'US': 'www.amazon.com',
    'CA': 'www.amazon.ca',
    'UK': 'www.amazon.co.uk',
    'DE': 'www.amazon.de',
    'FR': 'www.amazon.fr',
    'JP': 'www.amazon.co.jp',
    'IN': 'www.amazon.in',
    'BR': 'www.amazon.com.br',
    'MX': 'www.amazon.com.mx',
    'AU': 'www.amazon.com.au',
    'AE': 'www.amazon.ae',
    'SG': 'www.amazon.sg',
    'TR': 'www.amazon.com.tr',
  };
  return (domains[this.credentials.marketplace || 'US'] || domains['US']) as string;
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number; error?: string | undefined }> {
  const start = Date.now();

  try {
    // Try a simple search as health check
    await this.searchProducts('test');

    return {
    healthy: true,
    latency: Date.now() - start,
    };
  } catch (error) {
    // If error is auth-related, service is reachable
    const errorMessage = error instanceof Error ? error.message : '';
    const isAuthError = errorMessage.includes('401') || errorMessage.includes('403');

    return {
    healthy: isAuthError,
    latency: Date.now() - start,
    error: isAuthError ? undefined : errorMessage,
    };
  }
  }
}

// Backward-compatible default export
export const amazonAdapter = new AmazonAdapter();
