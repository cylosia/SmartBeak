import { getLogger } from '../../../packages/kernel/logger';
import { MetricsCollector, createRequestContext } from '../../utils/request';
import { withRetry } from '../../utils/retry';

import { DEFAULT_TIMEOUTS } from '@config';

/**
* WordPress Adapter
* Handles WordPress API integration
*/

const logger = getLogger('WordPressAdapter');
const metrics = new MetricsCollector('WordPressAdapter');

// Define WordPress post type
export interface WordPressPost {
  id: number;
  title: { rendered: string };
  content: { rendered: string };
  excerpt?: { rendered: string };
  date: string;
  modified: string;
  status: string;
  author: number;
  featured_media?: number;
  categories?: number[];
  tags?: number[];
}

// Define adapter config type
export interface WordPressConfig {
  baseUrl: string;
  username?: string;
  password?: string;
  apiVersion?: string;
}

/**
* Fetch posts from WordPress
*/
export async function fetchWordPressPosts(
  config: WordPressConfig,
  options: { perPage?: number; page?: number } = {}
): Promise<WordPressPost[]> {
  const { perPage = 10, page = 1 } = options;

  // URL validation for baseUrl
  if (!config.baseUrl || typeof config.baseUrl !== 'string') {
  throw new Error('Invalid WordPress config: baseUrl is required');
  }

  // Warning - Basic auth should only be used over HTTPS
  if (config.baseUrl.startsWith('http://')) {
  logger.warn('Using HTTP instead of HTTPS. Basic auth credentials may be exposed.');
  }

  const url = new URL(`${config.baseUrl}/wp-json/wp/v2/posts`);
  url.searchParams.set('per_page', String(perPage));
  url.searchParams.set('page', String(page));

  const headers: Record<string, string> = {
  'Accept': 'application/json',
  };

  // Validate credentials before using
  // Warning - Basic auth should only be used over HTTPS
  if (config.username && config.password) {
  if (config.username.length === 0 || config.password.length === 0) {
    throw new Error('Invalid WordPress credentials: username and password must not be empty');
  }
  const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
  headers['Authorization'] = `Basic ${auth}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUTS.medium);
  const startTime = Date.now();
  try {
  const response = await withRetry(() => fetch(url.toString(), { headers, signal: controller.signal }), { maxRetries: 3 });

  if (!response.ok) {
    throw new Error(`WordPress API error: ${response.status} ${response.statusText}`);
  }

  const rawData = await response.json();
  if (!Array.isArray(rawData)) {
    throw new Error('Invalid response format: expected array');
  }
  const posts = rawData as WordPressPost[];
  return posts;
  } catch (error) {
  const err = error instanceof Error ? error : new Error(String(error));
  logger.error('WordPress API error', createRequestContext('WordPressAdapter', 'fetchPosts'), err, { status: (error as { status?: number }).status });
  metrics.recordError('fetchPosts', err.name);
  throw new Error('Failed to fetch WordPress posts');
  } finally {
  clearTimeout(timeoutId);
  const duration = Date.now() - startTime;
  metrics.recordLatency('fetchPosts', duration, true);
  }
}

/**
* Create WordPress post
*/
export async function createWordPressPost(
  config: WordPressConfig,
  post: {
  title: string;
  content: string;
  status?: 'draft' | 'publish' | 'pending' | 'private';
  categories?: number[];
  tags?: number[];
  }
): Promise<WordPressPost> {
  // URL validation for baseUrl
  if (!config.baseUrl || typeof config.baseUrl !== 'string') {
  throw new Error('Invalid WordPress config: baseUrl is required');
  }

  // Warning - Basic auth should only be used over HTTPS
  if (config.baseUrl.startsWith('http://')) {
  logger.warn('Using HTTP instead of HTTPS. Basic auth credentials may be exposed.');
  }

  const url = `${config.baseUrl}/wp-json/wp/v2/posts`;

  const headers: Record<string, string> = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  };

  // Validate credentials before using
  // Warning - Basic auth should only be used over HTTPS
  if (config.username && config.password) {
  if (config.username.length === 0 || config.password.length === 0) {
    throw new Error('Invalid WordPress credentials: username and password must not be empty');
  }
  const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
  headers['Authorization'] = `Basic ${auth}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUTS.medium);
  const startTime = Date.now();
  try {
  const response = await withRetry(() => fetch(url, {
    method: 'POST',
    body: JSON.stringify({
    title: post.title,
    content: post.content,
    status: post.status || 'draft',
    categories: post.categories || [],
    tags: post.tags || [],
    }),
    signal: controller.signal,
  }), { maxRetries: 3 });

  if (!response.ok) {
    throw new Error(`WordPress API error: ${response.status} ${response.statusText}`);
  }

  const rawData = await response.json();
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) {
    throw new Error('Invalid response format: expected object');
  }
  const created = rawData as WordPressPost;
  return created;
  } catch (error) {
  const err = error instanceof Error ? error : new Error(String(error));
  logger.error('WordPress API error', createRequestContext('WordPressAdapter', 'createPost'), err, { status: (error as { status?: number }).status });
  metrics.recordError('createPost', err.name);
  throw new Error('Failed to create WordPress post');
  } finally {
  clearTimeout(timeoutId);
  const duration = Date.now() - startTime;
  metrics.recordLatency('createPost', duration, true);
  }
}

/**
* Health check for WordPress API
* @param config - WordPress configuration
* @returns Health check result
*/
export async function healthCheck(config: WordPressConfig): Promise<{ healthy: boolean; latency: number; error?: string | undefined }> {
  const start = Date.now();

  // URL validation for baseUrl
  if (!config.baseUrl || typeof config.baseUrl !== 'string') {
  return {
    healthy: false,
    latency: 0,
    error: 'Invalid WordPress config: baseUrl is required',
  };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
  const url = `${config.baseUrl}/wp-json/wp/v2/posts?per_page=1`;
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };

  // Add auth if credentials provided
  if (config.username && config.password) {
    const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
    headers['Authorization'] = `Basic ${auth}`;
  }

  const response = await fetch(url, {
    signal: controller.signal,
    method: 'HEAD'
  });

  const latency = Date.now() - start;

  // Only 200-299 status codes indicate a healthy service
  const healthy = response.ok;

  return {
    healthy,
    latency: Date.now() - start,
    error: healthy ? undefined : `WordPress API returned status ${response.status}`,
  };
  } catch (error) {
  return {
    healthy: false,
    latency: Date.now() - start,
    error: error instanceof Error ? error["message"] : 'Unknown error',
  };
  } finally {
  clearTimeout(timeoutId);
  }
}

/**
* Parse WordPress content
*/
export function parseWordPressContent(htmlContent: string): { text: string; images: string[] } {
  if (!htmlContent || typeof htmlContent !== 'string') {
  return { text: '', images: [] };
  }

  // P1-FIX: ReDoS - Simplified regex without catastrophic backtracking
  // Use a non-greedy pattern and avoid nested quantifiers
  const imageRegex = /<img[^>]+src=['\']([^'']+)['\'][^>]*>/gi;
  const images: string[] = [];
  let match;
  let iterations = 0;
  const MAX_ITERATIONS = 1000;

  // Reset lastIndex to prevent issues with global regex
  imageRegex.lastIndex = 0;

  while ((match = imageRegex.exec(htmlContent)) !== null && iterations < MAX_ITERATIONS) {
  iterations++;
  images.push(match[1]!);
  }

  if (iterations >= MAX_ITERATIONS) {
  logger.warn('Regex iteration limit reached, iterations: ' + iterations, createRequestContext('WordPressAdapter', 'parseWordPressContent'));
  }

  // Strip HTML tags for plain text
  const text = htmlContent
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

  return { text, images };
}
