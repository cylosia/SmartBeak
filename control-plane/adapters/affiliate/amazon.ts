import fetch from 'node-fetch';
import { createHmac, createHash } from 'crypto';

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
    // Content-Type is now included in buildPAAPIHeaders output
    // as part of the SigV4 signed headers
    const response = await fetch(`${baseUrl}/paapi5/searchitems`, {
    method: 'POST',
    headers,
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
    imageUrl?: string | undefined;
    price?: number | undefined;
    currency?: string | undefined;
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
        this.logger.warn('Skipping malformed item in Amazon PAAPI response', context);
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
  * PAAPI marketplace to AWS region mapping.
  * Amazon PAAPI 5.0 uses specific regional endpoints.
  */
  private static readonly PAAPI_REGION_MAP: Record<string, string> = {
    'US': 'us-east-1', 'CA': 'us-east-1', 'MX': 'us-east-1', 'BR': 'us-east-1',
    'UK': 'eu-west-1', 'DE': 'eu-west-1', 'FR': 'eu-west-1',
    'IN': 'eu-west-1', 'AE': 'eu-west-1', 'TR': 'eu-west-1',
    'JP': 'us-west-2', 'AU': 'us-west-2', 'SG': 'us-west-2',
  };

  /**
  * Build PAAPI 5.0 headers with complete AWS Signature Version 4.
  *
  * SECURITY FIX: Previous implementation only included the Credential component
  * in the Authorization header — missing SignedHeaders and Signature. Without
  * the HMAC signature, all PAAPI requests would be rejected with 403.
  *
  * Full SigV4 flow:
  * 1. Build canonical request (method, path, query, headers, payload hash)
  * 2. Create string to sign (algorithm, date, scope, canonical request hash)
  * 3. Derive signing key (HMAC chain: date → region → service → aws4_request)
  * 4. Compute signature (HMAC of string-to-sign with signing key)
  */
  private buildPAAPIHeaders(payload: unknown, timestamp: string): Record<string, string> {
  const amzDate = timestamp.replace(/[-:]/g, '').split('.')[0] + 'Z';
  const dateStamp = timestamp.split('T')[0]!.replace(/-/g, '');
  const marketplace = this.credentials.marketplace || 'US';
  const region = AmazonAdapter.PAAPI_REGION_MAP[marketplace] || 'us-east-1';
  const service = 'ProductAdvertisingAPI';
  const baseUrl = this.baseUrls[marketplace] || this.baseUrls['US']!;
  const host = new URL(baseUrl).host;
  const target = 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems';
  const contentType = 'application/json; charset=utf-8';
  const contentEncoding = 'amz-1.0';

  const payloadString = JSON.stringify(payload);
  const payloadHash = createHash('sha256').update(payloadString).digest('hex');

  // Step 1: Create canonical request
  const canonicalHeaders = [
    `content-encoding:${contentEncoding}`,
    `content-type:${contentType}`,
    `host:${host}`,
    `x-amz-date:${amzDate}`,
    `x-amz-target:${target}`,
  ].join('\n') + '\n';

  const signedHeaders = 'content-encoding;content-type;host;x-amz-date;x-amz-target';

  const canonicalRequest = [
    'POST',
    '/paapi5/searchitems',
    '', // empty canonical query string for POST
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  // Step 2: Create string to sign
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  // Step 3: Derive signing key (HMAC chain)
  const kDate = createHmac('sha256', `AWS4${this.credentials.secretKey}`).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(region).digest();
  const kService = createHmac('sha256', kRegion).update(service).digest();
  const kSigning = createHmac('sha256', kService).update('aws4_request').digest();

  // Step 4: Compute signature
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  // Build complete Authorization header
  const authorization = `AWS4-HMAC-SHA256 Credential=${this.credentials.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    'Content-Type': contentType,
    'Content-Encoding': contentEncoding,
    'Host': host,
    'X-Amz-Date': amzDate,
    'X-Amz-Target': target,
    'Authorization': authorization,
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
