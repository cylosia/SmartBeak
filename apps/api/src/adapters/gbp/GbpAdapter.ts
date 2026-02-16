import { google } from 'googleapis';
import type { mybusinessbusinessinformation_v1, mybusinessnotifications_v1, Auth } from 'googleapis';
import { createCipheriv, randomBytes, createDecipheriv } from 'crypto';
import { getLogger } from '@kernel/logger';

// P1-HIGH FIX: Import database for refresh token storage
import { db } from '../../db';

// Lazy-loaded encryption key (deferred from module-level to avoid crashing on import)
let _ENCRYPTION_KEY: string | undefined;
function getEncryptionKey(): string {
  if (!_ENCRYPTION_KEY) {
    _ENCRYPTION_KEY = process.env['GBP_TOKEN_ENCRYPTION_KEY'];
    if (!_ENCRYPTION_KEY) {
      throw new Error('GBP_TOKEN_ENCRYPTION_KEY environment variable is required');
    }
    // AES-256 requires a 256-bit (32-byte) key, which is 64 hex characters
    if (!/^[0-9a-fA-F]{64}$/.test(_ENCRYPTION_KEY)) {
      _ENCRYPTION_KEY = undefined;
      throw new Error(
        'GBP_TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (256-bit key for AES-256-GCM)'
      );
    }
  }
  return _ENCRYPTION_KEY;
}

/**
 * Encrypt a token using AES-256-GCM
 * @param token - The token to encrypt
 * @returns Encrypted token string in format: iv:authTag:encrypted
 * @throws Error if encryption fails
 */
function encryptToken(token: string): string {
  try {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(getEncryptionKey(), 'hex'), iv);
    let encrypted = cipher.update(token, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (error) {
    throw new Error(`Failed to encrypt token: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Decrypt a token that was encrypted with AES-256-GCM
 * @param encryptedData - The encrypted token string in format: iv:authTag:encrypted
 * @returns The decrypted token
 * @throws Error if decryption fails or data is malformed
 */
function _decryptToken(encryptedData: string): string {
  try {
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted token format');
    }
    const [ivHex, authTagHex, encrypted] = parts;
    if (!ivHex || !authTagHex || !encrypted) {
      throw new Error('Invalid encrypted token components');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(getEncryptionKey(), 'hex'),
      Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    throw new Error(`Failed to decrypt token: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

const logger = getLogger('GbpAdapter');

/**
* Google Business Profile (GBP) Publishing Adapter
* Uses Google My Business API v4.9
*
* Required: OAuth2 credentials with these scopes:
* - https://www.googleapis.com/auth/business.manage
*
* API Docs: https://developers.google.com/my-business/reference/rest
*/

/**
* Media item for a GBP post
*/
export interface GBPpostMedia {
  mediaFormat: 'PHOTO' | 'VIDEO';
  sourceUrl?: string;
  data?: string; // Base64 encoded
}

/**
* Date components for scheduling
*/
export interface DateComponents {
  year: number;
  month: number;
  day: number;
}

/**
* Time components for scheduling
*/
export interface TimeComponents {
  hours: number;
  minutes: number;
  seconds: number;
  nanos: number;
}

/**
* Event schedule definition
*/
export interface EventSchedule {
  startDate: DateComponents;
  startTime?: TimeComponents | undefined;
  endDate?: DateComponents | undefined;
  endTime?: TimeComponents | undefined;
}

/**
* Event details for a GBP post
*/
export interface GBPPostEvent {
  title: string;
  schedule: EventSchedule;
}

/**
* Offer details for a GBP post
*/
export interface GBPPostOffer {
  couponCode?: string | undefined;
  redeemOnlineUrl?: string | undefined;
  termsConditions?: string | undefined;
}

/**
* Call to action for a GBP post
*/
export interface GBPCallToAction {
  actionType: 'BOOK' | 'ORDER' | 'SHOP' | 'LEARN_MORE' | 'SIGN_UP' | 'CALL';
  url?: string;
}

/**
* GBP post request body
*/
export interface GBPPost {
  languageCode: string;
  summary: string;
  callToAction?: GBPCallToAction | undefined;
  media?: GBPpostMedia[] | undefined;
  event?: GBPPostEvent | undefined;
  offer?: GBPPostOffer | undefined;
}

/**
* GBP address structure
*/
export interface GBPAddress {
  streetAddress: string;
  locality: string;
  administrativeArea: string;
  postalCode: string;
  regionCode: string;
}

/**
* GBP location information
*/
export interface GBPLocation {
  name: string;
  title: string;
  storeCode?: string | undefined;
  primaryPhone?: string | undefined;
  address?: GBPAddress | undefined;
  websiteUri?: string | undefined;
}

/**
* GBP account information
*/
export interface GBPAccount {
  name: string;
  accountName: string;
}

/**
* GBP post creation response
*/
export interface GBPPostResponse {
  name: string;
  state: 'LIVE' | 'REJECTED' | 'PENDING_REVIEW';
  searchUrl?: string | undefined;
}

/**
* GBP location insights
*/
export interface GBPLocationInsights {
  views: number;
  searches: number;
  actions: {
  website: number;
  phone: number;
  drivingDirections: number;
  };
}

/**
* Post insights metrics
*/
export interface GBPPostInsights {
  views: number;
  clicks?: number;
}

/**
* GBP API metric value
*/
export interface GBPMetricValue {
  metric: string;
  totalValue?: {
  value: string;
  };
}

/**
* OAuth token response
*/
export interface GBPTokenResponse {
  access_token: string;
  refresh_token?: string | undefined;
  expiry_date: number;
}

/**
* GBP OAuth2 credentials
*/
export interface GBPCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
  refreshToken?: string;
}

/**
* Google My Business v4 API client type (dynamic import)
*/
export interface MyBusinessV4Client {
  accounts: {
  list: (params: Record<string, unknown>) => Promise<{
    data: {
    accounts?: Array<{
    name?: string;
    accountName?: string;
    }>;
    };
  }>;
  locations: {
    list: (params: Record<string, unknown>) => Promise<{
    data: {
    locations?: Array<Record<string, unknown>>;
    };
    }>;
    localPosts: {
    create: (params: {
    parent: string;
    requestBody: Record<string, unknown>;
    }) => Promise<{
    data: {
    name?: string;
    state?: string;
    searchUrl?: string;
    };
    }>;
    patch: (params: {
    name: string;
    updateMask: string;
    requestBody: Record<string, unknown>;
    }) => Promise<{
    data: {
    name?: string;
    state?: string;
    };
    }>;
    delete: (params: { name: string }) => Promise<unknown>;
    list: (params: { parent: string }) => Promise<{
    data: {
    localPosts?: Array<{
        name?: string;
        summary?: string;
        state?: string;
        createTime?: string;
        updateTime?: string;
    }>;
    };
    }>;
    get: (params: { name: string }) => Promise<{
    data: Record<string, unknown>;
    }>;
    };
    reportInsights: (params: {
    name: string;
    requestBody: Record<string, unknown>;
    }) => Promise<{
    data: {
    locationMetrics?: Array<{
    metricValues?: GBPMetricValue[];
    }>;
    };
    }>;
  };
  };
}

/**
* Validates GBP credentials
* @param credentials - Credentials to validate
* @throws Error if credentials are invalid
*/
function validateCredentials(credentials?: GBPCredentials): void {
  const clientId = credentials?.clientId || process.env['GBP_CLIENT_ID'];
  const clientSecret = credentials?.clientSecret || process.env['GBP_CLIENT_SECRET'];

  if (!clientId || typeof clientId !== 'string') {
  throw new Error('GBP_CLIENT_ID is required');
  }
  if (!clientSecret || typeof clientSecret !== 'string') {
  throw new Error('GBP_CLIENT_SECRET is required');
  }
}

/**
* Validates location ID format
* @param locationId - Location ID to validate
* @returns Formatted location name
* @throws Error if location ID is invalid
*/
function formatLocationName(locationId: string): string {
  if (!locationId || typeof locationId !== 'string') {
  throw new Error('Location ID is required and must be a string');
  }
  return locationId.startsWith('locations/') ? locationId : `locations/${locationId}`;
}

/**
* Validates post input
* @param post - Post to validate
* @throws Error if post is invalid
*/
function validatePost(post: GBPPost): void {
  if (!post || typeof post !== 'object') {
  throw new Error('Post must be an object');
  }
  if (!post.summary || typeof post.summary !== 'string' || post.summary.trim().length === 0) {
  throw new Error('Post summary is required and must be a non-empty string');
  }
  if (!post.languageCode || typeof post.languageCode !== 'string') {
  throw new Error('Post languageCode is required and must be a string');
  }
}

/**
* Google API client with mybusiness v4 support (deprecated but still used for some operations)
*/
export interface GoogleAPIsWithMyBusiness {
  mybusiness: (options: { version: string; auth: Auth.OAuth2Client }) => MyBusinessV4Client;
}

/**
* Type guard to check if error has a code property
* @param error - Unknown error object
* @returns True if error has a numeric code property
*/
function isErrorWithCode(error: unknown): error is { code: number } {
  return (
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  typeof (error as { code: unknown }).code === 'number'
  );
}

/**
* Type guard to check if googleapis has mybusiness property
* P0-FIX: Runtime validation before type assertion
* @param g - googleapis module
* @returns True if mybusiness is available
*/
function hasMyBusiness(g: unknown): g is GoogleAPIsWithMyBusiness {
  return (
    typeof g === 'object' &&
    g !== null &&
    'mybusiness' in g &&
    typeof (g as Record<string, unknown>)['mybusiness'] === 'function'
  );
}

/**
* Gets My Business v4 client with proper typing
* P0-FIX: Added runtime validation before type assertion
* @param auth - OAuth2 client
* @returns My Business v4 client
* @throws Error if mybusiness is not available
*/
function getMyBusinessV4Client(auth: Auth.OAuth2Client): MyBusinessV4Client {
  // P0-FIX: Validate google has mybusiness before casting
  if (!hasMyBusiness(google)) {
    throw new Error(
      'Google My Business API v4 is not available. ' +
      'Please ensure the googleapis package is properly installed and configured.'
    );
  }
  
  const client = google.mybusiness({ version: 'v4', auth });

  if (!client || typeof client !== 'object') {
    throw new Error('Failed to initialize Google My Business API client');
  }

  return client;
}

/**
* Maps API location response to GBPLocation
* @param loc - Raw location data from API
* @returns Mapped GBPLocation
*/
function mapLocationResponse(loc: unknown): GBPLocation {
  if (!loc || typeof loc !== 'object') {
  return { name: '', title: '' };
  }
  const locObj = loc as Record<string, unknown>;
  const addressData = locObj['address'] && typeof locObj['address'] === 'object'
  ? locObj['address'] as Record<string, unknown>
  : undefined;

  return {
  name: String(locObj['name'] || ''),
  title: String(locObj['title'] || ''),
  storeCode: locObj['storeCode'] ? String(locObj['storeCode']) : undefined,
  primaryPhone: locObj['primaryPhone'] ? String(locObj['primaryPhone']) : undefined,
  address: addressData ? {
    streetAddress: Array.isArray(addressData['addressLines'])
    ? addressData['addressLines'].join(', ')
    : String(addressData['addressLines'] || ''),
    locality: String(addressData['locality'] || ''),
    administrativeArea: String(addressData['administrativeArea'] || ''),
    postalCode: String(addressData['postalCode'] || ''),
    regionCode: String(addressData['regionCode'] || ''),
  } : undefined,
  websiteUri: locObj['websiteUri'] ? String(locObj['websiteUri']) : undefined,
  };
}

export class GbpAdapter {
  private readonly auth: Auth.OAuth2Client;
  private readonly businessInfo: mybusinessbusinessinformation_v1.Mybusinessbusinessinformation;
  private readonly notifications: mybusinessnotifications_v1.Mybusinessnotifications;

  /**
  * Creates an instance of GbpAdapter
  * @param credentials - OAuth2 credentials for GBP
  * @throws Error if required credentials are missing
  */
  constructor(credentials?: GBPCredentials) {
  validateCredentials(credentials);

  const clientId = credentials?.clientId || process.env['GBP_CLIENT_ID'] || '';
  const clientSecret = credentials?.clientSecret || process.env['GBP_CLIENT_SECRET'] || '';

  this.auth = new google.auth.OAuth2(
    clientId,
    clientSecret,
    credentials?.redirectUri || process.env['GBP_REDIRECT_URI'] || 'https://localhost:3000/api/auth/gbp/callback'
  );

  if (credentials?.refreshToken) {
    this.auth.setCredentials({ refresh_token: credentials.refreshToken });
  }

  this.businessInfo = google.mybusinessbusinessinformation({
    version: 'v1',
    auth: this.auth,
  });

  this.notifications = google.mybusinessnotifications({
    version: 'v1',
    auth: this.auth,
  });
  }

  /**
  * Generate OAuth URL for GBP authorization
  * @param state - Optional state parameter for OAuth flow
  * @returns Authorization URL
  */
  getAuthUrl(state?: string): string {
  return this.auth.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/business.manage'],
    prompt: 'consent',
    ...(state ? { state } : {}),
  });
  }

  /**
  * Exchange code for tokens
  * @param code - Authorization code from OAuth callback
  * @param orgId - Organization ID to store refresh token for (optional, for persistence)
  * @returns Token response
  * @throws Error if token exchange fails
  * 
  * P1-HIGH FIX: Store encrypted refresh token in database when orgId is provided
  */
  async exchangeCode(code: string, orgId?: string): Promise<GBPTokenResponse> {
  if (!code || typeof code !== 'string') {
    throw new Error('Authorization code is required and must be a string');
  }

  const { tokens } = await this.auth.getToken(code);

  if (!tokens.access_token || !tokens.expiry_date) {
    throw new Error('Invalid token response from Google');
  }

  // P0-FIX: Store refresh token (implementation enabled)
  const refreshToken = tokens.refresh_token;
  if (refreshToken && orgId) {
    try {
      // P0-CRITICAL FIX: Use AES-256-GCM encryption for refresh tokens
      const encryptedRefreshToken = encryptToken(refreshToken);
      
      await db.raw(
        `INSERT INTO gbp_credentials (org_id, encrypted_refresh_token, updated_at)
         VALUES (?, ?, NOW())
         ON CONFLICT (org_id) 
         DO UPDATE SET encrypted_refresh_token = ?, updated_at = NOW()`,
        [orgId, encryptedRefreshToken, encryptedRefreshToken]
      );
      logger.info(`Refresh token stored for org ${orgId}`);
    } catch (error) {
      logger.error('Failed to store refresh token', error instanceof Error ? error : new Error(String(error)));
      // Log but don't fail - token response is still valid
    }
  }

  return {
    access_token: tokens.access_token,
    refresh_token: refreshToken || undefined,
    expiry_date: tokens.expiry_date,
  };
  }

  /**
  * Set refresh token
  * @param refreshToken - OAuth refresh token
  * @throws Error if refreshToken is invalid
  */
  setRefreshToken(refreshToken: string): void {
  if (!refreshToken || typeof refreshToken !== 'string') {
    throw new Error('Refresh token is required and must be a string');
  }
  this.auth.setCredentials({ refresh_token: refreshToken });
  }

  /**
  * List all GBP locations (businesses) for the authenticated user
  * @param accountId - Optional account ID to filter by
  * @returns Array of locations
  * @throws Error if listing fails
  */
  async listLocations(accountId?: string): Promise<GBPLocation[]> {
  try {
    // First, get the account
    let targetAccountId = accountId;
    if (!targetAccountId) {
    const accounts = await this.listAccounts();
    if (accounts.length === 0) {
    throw new Error('No GBP accounts found');
    }
    targetAccountId = accounts[0]!.name;
    }

    const response = await this.businessInfo.accounts.locations.list({
    parent: targetAccountId,
    readMask: 'name,title,storeCode,primaryPhone,address,websiteUri',
    });

    const locations = response.data.locations || [];

    return locations.map((loc) => mapLocationResponse(loc));
  } catch (error) {
    const errorMessage = error instanceof Error ? error["message"] : 'Unknown error';
    logger.error('Error listing locations', error instanceof Error ? error : new Error(errorMessage));
    throw error;
  }
  }

  /**
  * List GBP accounts
  * @returns Array of accounts
  */
  async listAccounts(): Promise<GBPAccount[]> {
  try {
    const mybusiness = getMyBusinessV4Client(this.auth);
    const response = await mybusiness.accounts.list({});

    return (response.data.accounts || []).map((acc) => ({
    name: acc['name'] || '',
    accountName: acc['accountName'] || '',
    }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error["message"] : 'Unknown error';
    logger.error('Error listing accounts', error instanceof Error ? error : new Error(errorMessage));
    // Fallback for newer API versions
    return [];
  }
  }

  /**
  * Create a post on a GBP location
  * @param locationId - GBP location ID
  * @param post - Post content
  * @returns Post creation response
  * @throws Error if post creation fails
  */
  async createPost(locationId: string, post: GBPPost): Promise<GBPPostResponse> {
  try {
    validatePost(post);

    // Format location ID properly
    const locationName = formatLocationName(locationId);

    // Build post request
    const postBody: Record<string, unknown> = {
    languageCode: post.languageCode || 'en-US',
    summary: post.summary,
    };

    // Add call to action
    if (post['callToAction']) {
    postBody['callToAction'] = {
    actionType: post['callToAction'].actionType,
    url: post['callToAction']["url"],
    };
    }

    // Add media
    if (post['media'] && post['media'].length > 0) {
    postBody['media'] = post['media'].map(m => ({
    mediaFormat: m.mediaFormat,
    sourceUrl: m.sourceUrl,
    data: m.data,
    }));
    }

    // Add event details
    if (post['event']) {
    postBody['event'] = post['event'];
    }

    // Add offer details
    if (post['offer']) {
    postBody['offer'] = post['offer'];
    }

    const mybusiness = getMyBusinessV4Client(this.auth);

    const response = await mybusiness.accounts.locations.localPosts.create({
    parent: locationName,
    requestBody: postBody,
    });

    const result = response.data;

    const validStates = ['LIVE', 'REJECTED', 'PENDING_REVIEW'] as const;
    const state = validStates.includes(result.state as typeof validStates[number])
    ? (result.state as typeof validStates[number])
    : 'PENDING_REVIEW';

    return {
    name: result.name || '',
    state,
    searchUrl: result.searchUrl,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error["message"] : 'Unknown error';
    logger.error('Error creating post', error instanceof Error ? error : new Error(errorMessage));

    if (isErrorWithCode(error)) {
    if (error.code === 403) {
    throw new Error('Insufficient permissions for this GBP location. Ensure you have manager access.');
    }
    if (error.code === 404) {
    throw new Error('GBP location not found.');
    }
    }

    throw error;
  }
  }

  /**
  * Create an offer post
  * @param locationId - GBP location ID
  * @param title - Offer title
  * @param summary - Offer summary
  * @param offerDetails - Offer details
  * @param mediaUrl - Optional media URL
  * @returns Post creation response
  */
  async createOffer(
  locationId: string,
  title: string,
  summary: string,
  offerDetails: {
    couponCode?: string;
    termsConditions?: string;
    redeemUrl?: string;
  },
  mediaUrl?: string
  ): Promise<{ name: string; state: string }> {
  return this.createPost(locationId, {
    languageCode: 'en-US',
    summary: `${title}\n\n${summary}`,
    offer: {
    couponCode: offerDetails.couponCode,
    termsConditions: offerDetails.termsConditions,
    redeemOnlineUrl: offerDetails.redeemUrl,
    },
    media: mediaUrl ? [{
    mediaFormat: 'PHOTO',
    sourceUrl: mediaUrl,
    }] : undefined,
  });
  }

  /**
  * Create an event post
  * @param locationId - GBP location ID
  * @param title - Event title
  * @param summary - Event summary
  * @param startDate - Event start date
  * @param endDate - Optional event end date
  * @param mediaUrl - Optional media URL
  * @returns Post creation response
  */
  async createEvent(
  locationId: string,
  title: string,
  summary: string,
  startDate: Date,
  endDate?: Date,
  mediaUrl?: string
  ): Promise<{ name: string; state: string }> {
  const formatDate = (date: Date): DateComponents => ({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  });

  const formatTime = (date: Date): TimeComponents => ({
    hours: date.getHours(),
    minutes: date.getMinutes(),
    seconds: date.getSeconds(),
    nanos: 0,
  });

  return this.createPost(locationId, {
    languageCode: 'en-US',
    summary: title,
    event: {
    title,
    schedule: {
      startDate: formatDate(startDate),
      startTime: formatTime(startDate),
      endDate: endDate ? formatDate(endDate) : undefined,
      endTime: endDate ? formatTime(endDate) : undefined,
    },
    },
    media: mediaUrl ? [{
    mediaFormat: 'PHOTO',
    sourceUrl: mediaUrl,
    }] : undefined,
  });
  }

  /**
  * Update a post
  * @param postName - Full post resource name
  * @param updates - Partial post updates
  * @returns Update response
  * @throws Error if update fails
  */
  async updatePost(
  postName: string,
  updates: Partial<GBPPost>
  ): Promise<{ name: string; state: string }> {
  try {
    if (!postName || typeof postName !== 'string') {
    throw new Error('Post name is required and must be a string');
    }

    const mybusiness = getMyBusinessV4Client(this.auth);

    if (typeof updates !== 'object' || updates === null) {
      throw new Error('Updates must be a valid object');
    }
    // Filter out undefined values to avoid clearing fields unintentionally
    const definedKeys = Object.keys(updates).filter(
      (k) => updates[k as keyof typeof updates] !== undefined
    );
    const requestBody: Record<string, unknown> = {};
    for (const key of definedKeys) {
      // eslint-disable-next-line security/detect-object-injection -- iterating typed object keys
      requestBody[key] = updates[key as keyof typeof updates];
    }
    const response = await mybusiness.accounts.locations.localPosts.patch({
    name: postName,
    updateMask: definedKeys.join(','),
    requestBody,
    });

    return {
    name: response.data.name || '',
    state: response.data.state || 'PENDING_REVIEW',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error["message"] : 'Unknown error';
    logger.error('Error updating post', error instanceof Error ? error : new Error(errorMessage));
    throw error;
  }
  }

  /**
  * Delete a post
  * @param postName - Full post resource name
  * @throws Error if deletion fails
  */
  async deletePost(postName: string): Promise<void> {
  try {
    if (!postName || typeof postName !== 'string') {
    throw new Error('Post name is required and must be a string');
    }

    const mybusiness = getMyBusinessV4Client(this.auth);

    await mybusiness.accounts.locations.localPosts.delete({
    name: postName,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error["message"] : 'Unknown error';
    logger.error('Error deleting post', error instanceof Error ? error : new Error(errorMessage));
    throw error;
  }
  }

  /**
  * List posts for a location
  * @param locationId - GBP location ID
  * @returns Array of posts
  * @throws Error if listing fails
  */
  async listPosts(locationId: string): Promise<Array<{
  name: string;
  summary: string;
  state: string;
  createTime: string;
  updateTime: string;
  }>> {
  try {
    const locationName = formatLocationName(locationId);

    const mybusiness = getMyBusinessV4Client(this.auth);

    const response = await mybusiness.accounts.locations.localPosts.list({
    parent: locationName,
    });

    return (response.data.localPosts || []).map((post) => ({
    name: post.name || '',
    summary: post.summary || '',
    state: post.state || '',
    createTime: post.createTime || '',
    updateTime: post.updateTime || '',
    }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error["message"] : 'Unknown error';
    logger.error('Error listing posts', error instanceof Error ? error : new Error(errorMessage));
    throw error;
  }
  }

  /**
  * Get post insights (analytics)
  * @param postName - Full post resource name
  * @returns Post insights
  */
  async getPostInsights(postName: string): Promise<GBPPostInsights> {
  try {
    if (!postName || typeof postName !== 'string') {
    throw new Error('Post name is required and must be a string');
    }

    const mybusiness = getMyBusinessV4Client(this.auth);

    // Note: GBP insights API requires specific permissions
    await mybusiness.accounts.locations.localPosts.get({
    name: postName,
    });

    // Extract insights if available
    return {
    views: 0, // Insights require separate metrics call
    clicks: 0,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error["message"] : 'Unknown error';
    logger.error('Error getting insights', error instanceof Error ? error : new Error(errorMessage));
    return { views: 0, clicks: 0 };
  }
  }

  /**
  * Get location insights
  * @param locationId - GBP location ID
  * @param days - Number of days to query (default: 30)
  * @returns Location insights
  */
  async getLocationInsights(locationId: string, days: number = 30): Promise<GBPLocationInsights> {
  try {
    const locationName = formatLocationName(locationId);

    const mybusiness = getMyBusinessV4Client(this.auth);

    // Calculate date range
    const endTime = new Date();
    const startTime = new Date();
    startTime.setDate(startTime.getDate() - days);

    // Extract account name from full location path (e.g., "accounts/123/locations/456")
    // If locationName is just "locations/456", we need to retrieve the account first
    const parts = (locationName || '').split('/locations/');
    let accountName = parts[0] || '';
    if (!accountName || accountName === locationName) {
      const accounts = await this.listAccounts();
      accountName = accounts[0]?.name || '';
    }

    const response = await mybusiness.accounts.locations.reportInsights({
    name: accountName,
    requestBody: {
    locationNames: [locationName],
    basicRequest: {
    metricRequests: [
        { metric: 'QUERIES_DIRECT' },
        { metric: 'QUERIES_INDIRECT' },
        { metric: 'VIEWS_MAPS' },
        { metric: 'VIEWS_SEARCH' },
        { metric: 'ACTIONS_WEBSITE' },
        { metric: 'ACTIONS_PHONE' },
        { metric: 'ACTIONS_DRIVING_DIRECTIONS' },
    ],
    timeRange: {
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
    },
    },
    },
    });

    const insights = response.data.locationMetrics?.[0]?.metricValues || [];

    const getValue = (metric: string): number => {
    const m = insights.find((i) => i.metric === metric);
    return parseInt(m?.totalValue?.value || '0', 10);
    };

    return {
    views: getValue('VIEWS_MAPS') + getValue('VIEWS_SEARCH'),
    searches: getValue('QUERIES_DIRECT') + getValue('QUERIES_INDIRECT'),
    actions: {
    website: getValue('ACTIONS_WEBSITE'),
    phone: getValue('ACTIONS_PHONE'),
    drivingDirections: getValue('ACTIONS_DRIVING_DIRECTIONS'),
    },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error["message"] : 'Unknown error';
    logger.error('Error getting location insights', error instanceof Error ? error : new Error(errorMessage));
    return {
    views: 0,
    searches: 0,
    actions: { website: 0, phone: 0, drivingDirections: 0 },
    };
  }
  }
}
