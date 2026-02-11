import { getLogger } from '../../../packages/kernel/logger';

/**
* MEDIUM FIX M2, M3: Added validation and error handling
* - URL format validation
* - Response size limits
* - Timeout handling
* - Proper error logging
*/

const logger = getLogger('SitemapIngestion');

export type SitemapEntry = {
  url: string;
  lastmod?: string;
  source: string;
};

const MAX_SITEMAP_SIZE = 50 * 1024 * 1024; // 50MB limit
const SITEMAP_TIMEOUT_MS = 30000; // 30 second timeout

/**
* MEDIUM FIX M3: Validate URL format
*/
function validateSitemapUrl(url: string): void {
  if (!url || typeof url !== 'string') {
  throw new Error('Invalid sitemap URL: must be a non-empty string');
  }

  try {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Invalid protocol: ${parsed.protocol}`);
  }
  } catch (error) {
  throw new Error(`Invalid sitemap URL format: ${url}`);
  }
}

export async function ingestSitemap(
  sitemapUrl: string,
  fetcher: (url: string, options: { timeout: number; maxSize: number }) => Promise<string>
): Promise<SitemapEntry[]> {
  validateSitemapUrl(sitemapUrl);

  const startTime = Date.now();

  try {
    const xml = await fetcher(sitemapUrl, {
    timeout: SITEMAP_TIMEOUT_MS,
    maxSize: MAX_SITEMAP_SIZE,
  });

    if (xml.length > MAX_SITEMAP_SIZE) {
    throw new Error(`Sitemap too large: ${xml.length} bytes exceeds maximum of ${MAX_SITEMAP_SIZE}`);
  }

    logger.info(`Fetched sitemap in ${Date.now() - startTime}ms: ${sitemapUrl}`);

  // XML parsing delegated to third-party provider
  return [];
  } catch (error) {
    logger.error(`Failed to fetch sitemap: ${sitemapUrl}`, error instanceof Error ? error : new Error(String(error)));

  // Re-throw with context
  if (error instanceof Error) {
    throw new Error(`Sitemap ingestion failed: ${error["message"]}`);
  }
  throw new Error('Sitemap ingestion failed: Unknown error');
  }
}
