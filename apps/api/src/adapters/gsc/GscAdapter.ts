// P1-FIX: Removed BOM character
import { timeoutConfig } from '@config';
import { google, searchconsole_v1, Auth } from 'googleapis';


/**
* Google Search Console Adapter
*
*/

// Use GoogleAuth type which accepts various credential formats
/**
* Supported GSC authentication types
*/
export type GSCAuth = Auth.GoogleAuth | Auth.JWT | GSCServiceAccountCredentials;

/**
* GSC service account credentials structure
*/
export interface GSCServiceAccountCredentials {
  client_email: string;
  private_key: string;
  client_id?: string;
}

/**
* Request parameters for search analytics query
*/
export interface SearchAnalyticsRequest {
  startDate: string;
  endDate: string;
  dimensions?: string[];
  rowLimit?: number;
  startRow?: number;
  dimensionFilterGroups?: searchconsole_v1.Schema$ApiDimensionFilterGroup[];
  aggregationType?: 'AUTO' | 'BY_PROPERTY' | 'BY_PAGE';
}

/**
* Response from search analytics query
*/
export interface SearchAnalyticsResponse {
  rows?: searchconsole_v1.Schema$ApiDataRow[] | undefined;
  responseAggregationType?: string | undefined;
}

/**
* Health status for GSC connection
*/
export interface GSCHealthStatus {
  healthy: boolean;
  latency: number;
  error?: string | undefined;
}

/**
* GSC site information
*/
export interface GSCSite {
  siteUrl: string;
  permissionLevel: 'siteOwner' | 'siteFullUser' | 'siteRestrictedUser';
}

/**
* Google API error structure
*/
export interface GoogleApiError {
  message?: string;
  code?: number;
  errors?: Array<{ message?: string; reason?: string }>;
}

// Valid permission levels for GSC sites
const VALID_PERMISSION_LEVELS = ['siteOwner', 'siteFullUser', 'siteRestrictedUser'] as const;
export type PermissionLevel = typeof VALID_PERMISSION_LEVELS[number];

/**
* Replaces unsafe type assertion `as GSCSite['permissionLevel']`
*/
function isValidPermissionLevel(level: unknown): level is PermissionLevel {
  return typeof level === 'string' && VALID_PERMISSION_LEVELS.includes(level as PermissionLevel);
}

/**
* Validates GSC authentication credentials
* @param auth - Credentials to validate
* @throws Error if credentials are invalid
*/
function validateAuth(auth: unknown): void {
  if (!auth) {
  throw new Error('Authentication credentials are required');
  }

  // Check for JWT or GoogleAuth (has authorize method)
  const authWithAuthorize = auth as { authorize?: () => Promise<unknown> };
  if (typeof authWithAuthorize.authorize === 'function') {
  return; // Valid JWT or GoogleAuth
  }

  // Check for service account credentials
  const creds = auth as Record<string, unknown>;
  if (creds['client_email'] && creds['private_key']) {
  if (typeof creds['client_email'] !== 'string' || typeof creds['private_key'] !== 'string') {
    throw new Error('Service account credentials must have string client_email and private_key');
  }
  return;
  }

  throw new Error('Invalid authentication credentials. Expected JWT, GoogleAuth, or service account credentials');
}

/**
* Validates search analytics request
* @param request - Request to validate
* @throws Error if request is invalid
*/
function validateSearchAnalyticsRequest(request: unknown): void {
  if (!request || typeof request !== 'object') {
  throw new Error('Request must be an object');
  }

  const req = request as Record<string, unknown>;

  // Validate required dates
  if (!req['startDate'] || typeof req['startDate'] !== 'string') {
  throw new Error('startDate is required and must be a string (YYYY-MM-DD)');
  }

  if (!req['endDate'] || typeof req['endDate'] !== 'string') {
  throw new Error('endDate is required and must be a string (YYYY-MM-DD)');
  }

  // Validate date format (YYYY-MM-DD)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(req['startDate'])) {
  throw new Error('startDate must be in YYYY-MM-DD format');
  }
  if (!dateRegex.test(req['endDate'])) {
  throw new Error('endDate must be in YYYY-MM-DD format');
  }

  // Validate dimensions if provided
  if (req['dimensions'] !== undefined) {
  if (!Array.isArray(req['dimensions'])) {
    throw new Error('Dimensions must be an array of strings');
  }
  const validDimensions = ['country', 'device', 'page', 'query', 'searchAppearance', 'date'];
  for (const dim of req['dimensions']) {
    if (typeof dim !== 'string' || !validDimensions.includes(dim)) {
    throw new Error(`Invalid dimension: ${dim}. Valid dimensions: ${validDimensions.join(', ')}`);
    }
  }
  }

  // Validate rowLimit if provided
  if ('rowLimit' in req && req['rowLimit'] !== undefined) {
  if (typeof req['rowLimit'] !== 'number' || req['rowLimit'] < 1 || req['rowLimit'] > 25000) {
    throw new Error('rowLimit must be a number between 1 and 25000');
  }
  }
}

/**
* Validates site URL format
* @param siteUrl - Site URL to validate
* @returns Validated site URL
* @throws Error if site URL is invalid
*/
function validateSiteUrl(siteUrl: string): string {
  if (!siteUrl || typeof siteUrl !== 'string') {
  throw new Error('Site URL is required and must be a string');
  }

  const trimmed = siteUrl.trim();

  // GSC site URLs typically start with http://, https://, or sc-domain:
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://') && !trimmed.startsWith('sc-domain:')) {
  throw new Error('Site URL must start with http://, https://, or sc-domain:');
  }

  return trimmed;
}

/**
* Google Search Console API Adapter
* @class GscAdapter
*/
export class GscAdapter {
  private readonly client: searchconsole_v1.Searchconsole;

  /**
  * Creates an instance of GscAdapter
  * @param auth - Google service account credentials
  * @throws Error if authentication is invalid
  */
  constructor(auth: GSCAuth) {
  validateAuth(auth);

  // P1-FIX: The googleapis library accepts multiple auth formats at runtime
  // Use unknown as intermediate type for safer type assertion
  // Auth is validated above, ensuring runtime compatibility
  this.client = google.searchconsole({
    version: 'v1',
    auth: (auth as unknown) as Auth.GoogleAuth
  });
  }

  /**
  * Fetch search analytics data
  *
  * @param siteUrl - Site URL (e.g., 'https://example.com/')
  * @param body - Search analytics request
  * @returns Search analytics data
  * @throws Error if request fails or input is invalid
  */
  async fetchSearchAnalytics(
  siteUrl: string,
  body: SearchAnalyticsRequest
  ): Promise<SearchAnalyticsResponse> {
  // Validate inputs
  const validatedSiteUrl = validateSiteUrl(siteUrl);
  validateSearchAnalyticsRequest(body);

  const timeoutMs = timeoutConfig.long; // 30 seconds

  const fetchPromise = this.client.searchanalytics.query({
    siteUrl: validatedSiteUrl,
    requestBody: body,
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('GSC request timeout')), timeoutMs);
  });

  try {
    const res = await Promise.race([fetchPromise, timeoutPromise]);
    return res.data as SearchAnalyticsResponse;
  } catch (error) {
    if (error instanceof Error) {
    throw error;
    }
    throw new Error('Unknown error during GSC search analytics fetch');
  }
  }

  /**
  * List sites registered in Search Console
  * @returns Array of site entries
  * @throws Error if listing fails
  */
  async listSites(): Promise<GSCSite[]> {
  try {
    const response = await this.client.sites.list({});

    return (response.data.siteEntry || []).map((site) => ({
    siteUrl: site.siteUrl || '',
    permissionLevel: isValidPermissionLevel(site.permissionLevel) ? site.permissionLevel : 'siteRestrictedUser',
    }));
  } catch (error) {
    if (error instanceof Error) {
    throw error;
    }
    throw new Error('Unknown error during GSC sites list');
  }
  }

  /**
  * Get site information
  * @param siteUrl - Site URL
  * @returns Site information
  * @throws Error if site not found or request fails
  */
  async getSite(siteUrl: string): Promise<GSCSite> {
  const validatedSiteUrl = validateSiteUrl(siteUrl);

  try {
    const response = await this.client.sites.get({
    siteUrl: validatedSiteUrl,
    });

    if (!response.data.siteUrl) {
    throw new Error('Site not found');
    }

    return {
    siteUrl: response.data.siteUrl,
    permissionLevel: isValidPermissionLevel(response.data.permissionLevel) ? response.data.permissionLevel : 'siteRestrictedUser',
    };
  } catch (error) {
    if (error instanceof Error) {
    throw error;
    }
    throw new Error('Unknown error during GSC site get');
  }
  }

  /**
  * Health check for GSC connection
  *
  * @returns Health status with latency
  */
  async healthCheck(): Promise<GSCHealthStatus> {
  const start = Date.now();
  try {
    // Try to list sites as health check
    await this.client.sites.list({});
    return { healthy: true, latency: Date.now() - start };
  } catch (error: unknown) {
    const errMessage = error instanceof Error
    ? error["message"]
    : error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown })["message"])
    : 'Unknown error';
    return {
    healthy: false,
    latency: Date.now() - start,
    error: errMessage,
    };
  }
  }
}
