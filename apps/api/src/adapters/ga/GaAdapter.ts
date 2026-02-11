import { timeoutConfig } from '@config';
import { BetaAnalyticsDataClient, protos } from '@google-analytics/data';


/**
* Google Analytics Adapter
*
*/

// Type definitions for GA requests
/**
* Health status for GA connection
*/
export interface GAHealthStatus {
  healthy: boolean;
  latency: number;
  error?: string;
}

/**
* Google Analytics service account credentials
*/
export interface GACredentials {
  client_email: string;
  private_key: string;
}

/**
* Google Analytics report request configuration
*/
export interface GARequest {
  dimensions?: protos.google.analytics.data.v1beta.IDimension[];
  metrics?: protos.google.analytics.data.v1beta.IMetric[];
  dateRanges?: protos.google.analytics.data.v1beta.IDateRange[];
}

/**
* Google Analytics report response
*/
export interface GAResponse {
  rows?: protos.google.analytics.data.v1beta.IRow[] | null;
  totals?: protos.google.analytics.data.v1beta.IRow[] | null;
}

/**
* Google API error structure
*/
export interface GoogleApiError {
  message?: string;
  code?: number;
}

/**
* Validates GA credentials
* @param credentials - Credentials to validate
* @returns Validated credentials
* @throws Error if credentials are invalid
*/
function validateCredentials(credentials: unknown): GACredentials {
  if (!credentials || typeof credentials !== 'object') {
  throw new Error('Credentials must be an object');
  }

  const creds = credentials as Record<string, unknown>;

  if (!creds['client_email'] || typeof creds['client_email'] !== 'string') {
  throw new Error('Credentials must include client_email as a string');
  }

  if (!creds['private_key'] || typeof creds['private_key'] !== 'string') {
  throw new Error('Credentials must include private_key as a string');
  }

  return {
  client_email: creds['client_email'],
  private_key: creds['private_key'],
  };
}

/**
* Validates GA request parameters
* @param request - Request to validate
* @returns Validated request
* @throws Error if request is invalid
*/
function validateRequest(request: unknown): GARequest {
  if (!request || typeof request !== 'object') {
  throw new Error('Request must be an object');
  }

  const req = request as Record<string, unknown>;

  // Validate dimensions if provided
  if (req['dimensions'] !== undefined) {
  if (!Array.isArray(req['dimensions'])) {
    throw new Error('Dimensions must be an array');
  }
  }

  // Validate metrics if provided
  if (req['metrics'] !== undefined) {
  if (!Array.isArray(req['metrics'])) {
    throw new Error('Metrics must be an array');
  }
  }

  // Validate dateRanges if provided
  if (req['dateRanges'] !== undefined) {
  if (!Array.isArray(req['dateRanges'])) {
    throw new Error('Date ranges must be an array');
  }
  }

  return req as GARequest;
}

/**
* Validates property ID format
* @param propertyId - Property ID to validate
* @returns Validated property ID
* @throws Error if property ID is invalid
*/
function validatePropertyId(propertyId: string): string {
  if (!propertyId || typeof propertyId !== 'string') {
  throw new Error('Property ID is required and must be a string');
  }

  // GA4 property IDs are numeric
  const trimmed = propertyId.trim();
  if (!/^\d+$/.test(trimmed)) {
  throw new Error('Property ID must be a numeric string');
  }

  return trimmed;
}

/**
* Google Analytics Data API Adapter
* @class GaAdapter
*/
export class GaAdapter {
  private readonly client: BetaAnalyticsDataClient;

  /**
  * Creates an instance of GaAdapter
  * @param credentials - Google service account credentials
  * @throws Error if credentials are invalid
  */
  constructor(credentials: GACredentials) {
  const validatedCreds = validateCredentials(credentials);
  this.client = new BetaAnalyticsDataClient({ credentials: validatedCreds });
  }

  /**
  * Fetch metrics from Google Analytics
  *
  * @param propertyId - GA4 property ID
  * @param request - Report request configuration
  * @returns Analytics report response
  * @throws Error if request fails or input is invalid
  */
  async fetchMetrics(
  propertyId: string,
  request: GARequest
  ): Promise<GAResponse> {
  // Validate inputs
  const validatedPropertyId = validatePropertyId(propertyId);
  const validatedRequest = validateRequest(request);

  const timeoutMs = timeoutConfig.long; // 30 seconds

  const runReportPromise = this.client.runReport({
    property: `properties/${validatedPropertyId}`,
    ...validatedRequest,
  });

  // Create timeout promise with cleanup capability
  let timeoutId: NodeJS.Timeout | undefined = undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('GA request timeout')), timeoutMs);
  });

  try {
    // Race between request and timeout
    const [response] = await Promise.race([
      runReportPromise,
      timeoutPromise
    ]);

    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error) {
    throw error;
    }
    throw new Error('Unknown error during GA metrics fetch');
  }
  }

  /**
  * Health check for GA connection
  * @returns Health status with latency
  */
  async healthCheck(): Promise<GAHealthStatus> {
  const start = Date.now();
  try {
    // Try to fetch metadata as health check
    await this.client.getMetadata({
    name: 'properties/0/metadata', // Invalid property, but tests connection
    });
    return { healthy: true, latency: Date.now() - start };
  } catch (error: unknown) {
    // Expected to fail with 'property not found' but connection succeeded
    const err = error instanceof Error ? error : new Error(String(error));
    const errCode = error && typeof error === 'object' && 'code' in error ? (error as { code?: number }).code : undefined;
    if (err["message"]?.includes('not found') || errCode === 5) {
    return { healthy: true, latency: Date.now() - start };
    }
    return {
    healthy: false,
    latency: Date.now() - start,
    error: err["message"] || 'Unknown error',
    };
  }
  }

  /**
  * Close the client connection
  */
  async close(): Promise<void> {
  await this.client.close();
  }
}
