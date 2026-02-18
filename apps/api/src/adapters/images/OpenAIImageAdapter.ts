import fetch from 'node-fetch';
import FormData from 'form-data';

import { API_BASE_URLS, DEFAULT_TIMEOUTS } from '../../utils/config';
import { StructuredLogger, createRequestContext, MetricsCollector } from '@kernel/request';
import { validateNonEmptyString } from '../../utils/validation';
import { withRetry, parseRetryAfter, sleep } from '../../utils/retry';

// AbortController is a Node.js global since Node 18 (LTS). No polyfill needed.

/**
 * OpenAI DALL-E Image Generation Adapter
 * Supports DALL-E 2 and DALL-E 3
 *
 * Required: OPENAI_API_KEY
 * API Docs: https://platform.openai.com/docs/api-reference/images
 */

/** OpenAI DALL-E 2 image upload limit: 4MB */
const MAX_IMAGE_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Maximum prompt length enforced client-side before hitting the API.
 * OpenAI limits: DALL-E 2 → 1,000 chars; DALL-E 3 → 4,000 chars.
 */
const MAX_PROMPT_LENGTH: Record<string, number> = {
  'dall-e-2': 1_000,
  'dall-e-3': 4_000,
};

/**
 * Maximum number of characters of an OpenAI error body to include in a
 * thrown Error message.  Truncating prevents sensitive prompt/moderation
 * details from propagating up the call stack and into logs or client responses.
 */
const MAX_ERROR_BODY_LENGTH = 200;

/**
 * Trusted hostname suffixes for OpenAI-returned image URLs.
 * SECURITY FIX (OAI-01 / SSRF): OpenAI returns image URLs in API responses.
 * Without validation a compromised or spoofed response could point callers at
 * internal services (e.g. EC2 metadata at 169.254.169.254).  We verify every
 * URL's hostname ends with one of these known OpenAI CDN suffixes before
 * returning it to callers.
 */
const TRUSTED_IMAGE_HOST_SUFFIXES: readonly string[] = [
  '.openai.com',
  '.oaiusercontent.com',
  '.blob.core.windows.net', // Azure Blob — OpenAI's backend storage for DALL-E
];

/**
 * Validate that a URL returned by the OpenAI image API is safe to use.
 * - Scheme must be https (rejects http and non-URL strings)
 * - Hostname must end with a known OpenAI CDN suffix
 *
 * Throws if the URL is invalid or not from a trusted origin.
 */
function assertTrustedImageUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`SSRF guard: OpenAI returned an unparseable image URL: "${url.slice(0, 100)}"`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`SSRF guard: OpenAI image URL must use HTTPS, got "${parsed.protocol}"`);
  }
  const hostname = parsed.hostname.toLowerCase();
  const trusted = TRUSTED_IMAGE_HOST_SUFFIXES.some(
    (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix)
  );
  if (!trusted) {
    throw new Error(
      `SSRF guard: OpenAI image URL hostname "${hostname}" is not in the trusted allowlist`
    );
  }
}

/**
 * onRetry callback shared by all withRetry() calls.
 * SECURITY FIX (OAI-03): Respect the Retry-After header on 429 responses.
 * Previously the adapter always used exponential back-off regardless of what
 * OpenAI indicated, risking immediate re-requests that drain quota faster.
 */
async function onRetryRespectRetryAfter(error: Error, _attempt: number): Promise<void> {
  if (error instanceof ApiError && error.retryAfter) {
    const delayMs = parseRetryAfter(error.retryAfter);
    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }
}

/**
 * API Error with status code and retry information
 */
class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAfter?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Type guard for OpenAI image generation response
interface OpenAIImageData {
  url: string;
  revised_prompt?: string;
  b64_json?: string;
}

interface OpenAIImageResponse {
  created: number;
  data: OpenAIImageData[];
}

function isOpenAIImageResponse(data: unknown): data is OpenAIImageResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as Record<string, unknown>)['created'] === 'number' &&
    Array.isArray((data as Record<string, unknown>)['data'])
  );
}

export type DalleModel = 'dall-e-2' | 'dall-e-3';
export type DalleSize = '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792';
export type DalleQuality = 'standard' | 'hd';
export type DalleStyle = 'vivid' | 'natural';

export interface ImageGenerationOptions {
  model?: DalleModel;
  size?: DalleSize;
  quality?: DalleQuality;
  style?: DalleStyle;
  n?: number;
  user?: string;
}

export interface GeneratedImage {
  url: string;
  revisedPrompt?: string | undefined;
  b64Json?: string | undefined;
  localPath?: string | undefined;
  metadata: {
    model: DalleModel;
    size: DalleSize;
    quality: DalleQuality;
    style?: DalleStyle | undefined;
    prompt: string;
    createdAt: string;
    provider: 'openai';
  };
}

export interface ImageEditOptions {
  image: Buffer;
  mask?: Buffer;
  prompt: string;
  size?: DalleSize;
  n?: number;
}

export interface ImageVariationOptions {
  image: Buffer;
  size?: DalleSize;
  n?: number;
}

export class OpenAIImageAdapter {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: DalleModel = 'dall-e-3';
  private readonly timeoutMs = DEFAULT_TIMEOUTS.extended;
  private readonly logger: StructuredLogger;
  private readonly metrics: MetricsCollector;

  constructor(apiKey?: string) {
    const key = apiKey || process.env['OPENAI_API_KEY'] || '';
    if (!key) {
      throw new Error('OPENAI_API_KEY is required');
    }

    this.apiKey = key;
    this.baseUrl = API_BASE_URLS.openai;
    this.logger = new StructuredLogger('OpenAIImageAdapter');
    this.metrics = new MetricsCollector('OpenAIImageAdapter');
  }

  /**
   * Generate images from text prompt
   */
  async generate(prompt: string, options: ImageGenerationOptions = {}): Promise<GeneratedImage[]> {
    const context = createRequestContext('OpenAIImageAdapter', 'generate');

    validateNonEmptyString(prompt, 'prompt');

    const {
      model = this.defaultModel,
      size = '1024x1024',
      quality = 'standard',
      style = 'vivid',
      n = 1,
      user,
    } = options;

    // Validate prompt length before hitting the API to surface clear errors early.
    const maxPromptLen = MAX_PROMPT_LENGTH[model] ?? 1_000;
    if (prompt.length > maxPromptLen) {
      throw new Error(
        `Prompt length ${prompt.length} exceeds the ${maxPromptLen}-character limit for ${model}`
      );
    }

    // FIX (P2-n): Validate n before sending to the API.  n=0 or negative is
    // meaningless and would cause a confusing OpenAI 400 error; n>10 exceeds
    // the API maximum and wastes quota.
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      throw new Error('n must be an integer between 1 and 10');
    }

    // Validate model-specific constraints
    if (model === 'dall-e-3' && n > 1) {
      throw new Error('DALL-E 3 only supports n=1');
    }
    if (model === 'dall-e-3' && !(['1024x1024', '1792x1024', '1024x1792'] as string[]).includes(size)) {
      throw new Error('DALL-E 3 only supports 1024x1024, 1792x1024, or 1024x1792');
    }
    if (model === 'dall-e-2' && !(['256x256', '512x512', '1024x1024'] as string[]).includes(size)) {
      throw new Error('DALL-E 2 only supports 256x256, 512x512, or 1024x1024');
    }

    this.logger.info('Generating image with OpenAI', context, { model, size });

    const startTime = Date.now();

    try {
      // FIX (H05): Create AbortController per retry attempt, not shared across retries.
      // A shared controller causes later retries to be prematurely aborted by the original timeout.
      // FIX (M09): Move JSON parsing inside retry block so corrupt response bodies are retried.
      // FIX (OAI-03): onRetry respects Retry-After header from 429 responses.
      const data = await withRetry(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const response = await fetch(`${this.baseUrl}/images/generations`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model,
              prompt,
              size,
              quality,
              style,
              n,
              response_format: 'url',
              // Pass user identifier to OpenAI for per-user rate limiting and
              // abuse tracking. Omitted when undefined to keep payloads minimal.
              ...(user !== undefined ? { user } : {}),
            }),
            signal: controller.signal,
          });

          if (!response.ok) {
            if (response.status === 429) {
              const retryAfter = response.headers.get('retry-after') || undefined;
              throw new ApiError(`OpenAI rate limited: ${response.status}`, response.status, retryAfter);
            }

            // Truncate the error body to prevent sensitive prompt content or
            // moderation details from propagating into logs or client responses.
            const rawError = await response.text();
            const safeError = rawError.slice(0, MAX_ERROR_BODY_LENGTH);
            throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${safeError}`);
          }

          const rawData = await response.json();
          if (!isOpenAIImageResponse(rawData)) {
            throw new ApiError('Invalid response format from OpenAI API', 500);
          }
          return rawData;
        } finally {
          clearTimeout(timeoutId);
        }
      }, { maxRetries: 3, onRetry: onRetryRespectRetryAfter });

      // Validate each item in the data array has required fields
      if (!data.data.every((item: unknown) => {
        const img = item as OpenAIImageData;
        return img && typeof img === 'object' && typeof img.url === 'string';
      })) {
        throw new ApiError('Invalid response data structure from OpenAI API', 500);
      }

      // FIX (OAI-01 / SSRF): Validate every URL is from a trusted OpenAI CDN before
      // returning.  A compromised response could point callers at internal services.
      for (const img of data.data) {
        assertTrustedImageUrl(img["url"]);
      }

      const images = data.data.map((img): GeneratedImage => ({
        url: img["url"],
        revisedPrompt: img.revised_prompt ?? undefined,
        b64Json: img.b64_json ?? undefined,
        metadata: {
          model,
          size,
          quality,
          style: style ?? undefined,
          prompt,
          createdAt: new Date(data.created * 1000).toISOString(),
          provider: 'openai',
        },
      }));

      const latency = Date.now() - startTime;
      this.metrics.recordLatency('generate', latency, true);
      this.metrics.recordSuccess('generate');
      this.logger.info('Successfully generated image with OpenAI', context, { count: images.length });

      return images;
    } catch (error) {
      const latency = Date.now() - startTime;
      this.metrics.recordLatency('generate', latency, false);
      this.metrics.recordError('generate', error instanceof Error ? error.name : 'Unknown');
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Failed to generate image with OpenAI', context, err);
      throw error;
    }
  }

  /**
   * Edit an image using a mask
   */
  async editImage(options: ImageEditOptions): Promise<GeneratedImage[]> {
    const context = createRequestContext('OpenAIImageAdapter', 'editImage');

    const {
      image,
      mask,
      prompt,
      size = '1024x1024',
      n = 1,
    } = options;

    validateNonEmptyString(prompt, 'prompt');

    if (!image || !(image instanceof Buffer) || image.length === 0) {
      throw new Error('image is required and must be a non-empty Buffer');
    }
    if (image.length > MAX_IMAGE_UPLOAD_BYTES) {
      throw new Error(`image size ${image.length} bytes exceeds maximum ${MAX_IMAGE_UPLOAD_BYTES} bytes (4MB)`);
    }
    if (mask && mask instanceof Buffer && mask.length > MAX_IMAGE_UPLOAD_BYTES) {
      throw new Error(`mask size ${mask.length} bytes exceeds maximum ${MAX_IMAGE_UPLOAD_BYTES} bytes (4MB)`);
    }
    // FIX (P2-n): Validate n for editImage, matching the same guard in generate().
    // DALL-E 2 edits accept n=1..10; sending 0 or negative produces a confusing
    // OpenAI 400 error, and n>10 wastes quota without returning more images.
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      throw new Error('n must be an integer between 1 and 10');
    }

    this.logger.info('Editing image with OpenAI', context);

    const startTime = Date.now();

    try {
      // FIX (H05): Create AbortController per retry attempt
      const data = await withRetry(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          // Create new FormData for each retry to avoid consumed stream issues
          const formData = new FormData();
          formData.append('image', image, { filename: 'image.png', contentType: 'image/png' });
          if (mask) {
            formData.append('mask', mask, { filename: 'mask.png', contentType: 'image/png' });
          }
          formData.append('prompt', prompt);
          formData.append('size', size);
          formData.append('n', n.toString());
          formData.append('response_format', 'url');

          const response = await fetch(`${this.baseUrl}/images/edits`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              ...formData.getHeaders(),
            },
            body: formData,
            signal: controller.signal,
          });

          if (!response.ok) {
            if (response.status === 429) {
              const retryAfter = response.headers.get('retry-after') || undefined;
              throw new ApiError(`OpenAI rate limited: ${response.status}`, response.status, retryAfter);
            }

            const rawError = await response.text();
            const safeError = rawError.slice(0, MAX_ERROR_BODY_LENGTH);
            throw new Error(`OpenAI edit error: ${response.status} - ${safeError}`);
          }

          const rawData = await response.json();
          if (!isOpenAIImageResponse(rawData)) {
            throw new ApiError('Invalid response format from OpenAI API', 500);
          }
          return rawData;
        } finally {
          clearTimeout(timeoutId);
        }
      }, { maxRetries: 3, onRetry: onRetryRespectRetryAfter });

      // FIX (OAI-01 / SSRF): Validate URLs before returning.
      for (const img of data.data) {
        assertTrustedImageUrl(img["url"]);
      }

      const images = data.data.map((img): GeneratedImage => ({
        url: img["url"],
        b64Json: img.b64_json ?? undefined,
        metadata: {
          model: 'dall-e-2',
          size: size as DalleSize,
          quality: 'standard',
          prompt,
          createdAt: new Date(data.created * 1000).toISOString(),
          provider: 'openai',
        },
      }));

      // FIX (M10): Record latency on success (was missing)
      const latency = Date.now() - startTime;
      this.metrics.recordLatency('editImage', latency, true);
      this.metrics.recordSuccess('editImage');
      return images;
    } catch (error) {
      // FIX (M10): Record latency on error (was missing)
      const latency = Date.now() - startTime;
      this.metrics.recordLatency('editImage', latency, false);
      this.metrics.recordError('editImage', error instanceof Error ? error.name : 'Unknown');
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Failed to edit image with OpenAI', context, err);
      throw error;
    }
  }

  /**
   * Create image variations
   */
  async createVariation(options: ImageVariationOptions): Promise<GeneratedImage[]> {
    const context = createRequestContext('OpenAIImageAdapter', 'createVariation');

    const {
      image,
      size = '1024x1024',
      n = 1,
    } = options;

    if (!image || !(image instanceof Buffer) || image.length === 0) {
      throw new Error('image is required and must be a non-empty Buffer');
    }
    if (image.length > MAX_IMAGE_UPLOAD_BYTES) {
      throw new Error(`image size ${image.length} bytes exceeds maximum ${MAX_IMAGE_UPLOAD_BYTES} bytes (4MB)`);
    }
    // FIX (P2-n): Validate n for createVariation, matching the same guard in generate().
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      throw new Error('n must be an integer between 1 and 10');
    }

    this.logger.info('Creating image variation with OpenAI', context);

    const startTime = Date.now();

    try {
      // FIX (H05): Create AbortController per retry attempt
      const data = await withRetry(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const formData = new FormData();
          formData.append('image', image, { filename: 'image.png', contentType: 'image/png' });
          formData.append('size', size);
          formData.append('n', n.toString());
          formData.append('response_format', 'url');

          const response = await fetch(`${this.baseUrl}/images/variations`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              ...formData.getHeaders(),
            },
            body: formData,
            signal: controller.signal,
          });

          if (!response.ok) {
            if (response.status === 429) {
              const retryAfter = response.headers.get('retry-after') || undefined;
              throw new ApiError(`OpenAI rate limited: ${response.status}`, response.status, retryAfter);
            }

            const rawError = await response.text();
            const safeError = rawError.slice(0, MAX_ERROR_BODY_LENGTH);
            throw new Error(`OpenAI variation error: ${response.status} - ${safeError}`);
          }

          const rawData = await response.json();
          if (!isOpenAIImageResponse(rawData)) {
            throw new ApiError('Invalid response format from OpenAI API', 500);
          }
          return rawData;
        } finally {
          clearTimeout(timeoutId);
        }
      }, { maxRetries: 3, onRetry: onRetryRespectRetryAfter });

      // FIX (OAI-01 / SSRF): Validate URLs before returning.
      for (const img of data.data) {
        assertTrustedImageUrl(img["url"]);
      }

      const images = data.data.map((img): GeneratedImage => ({
        url: img["url"],
        b64Json: img.b64_json ?? undefined,
        metadata: {
          model: 'dall-e-2',
          size: size as DalleSize,
          quality: 'standard',
          prompt: '',
          createdAt: new Date(data.created * 1000).toISOString(),
          provider: 'openai',
        },
      }));

      // FIX (M10): Record latency on success (was missing)
      const latency = Date.now() - startTime;
      this.metrics.recordLatency('createVariation', latency, true);
      this.metrics.recordSuccess('createVariation');
      return images;
    } catch (error) {
      // FIX (M10): Record latency on error (was missing)
      const latency = Date.now() - startTime;
      this.metrics.recordLatency('createVariation', latency, false);
      this.metrics.recordError('createVariation', error instanceof Error ? error.name : 'Unknown');
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Failed to create image variation with OpenAI', context, err);
      throw error;
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number; error?: string | undefined }> {
    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUTS.short);

    try {
      // Check models endpoint as health check
      const res = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      const latency = Date.now() - start;

      // Only 200-299 status codes indicate a healthy service
      const healthy = res.ok;

      return {
        healthy,
        latency,
        error: healthy ? undefined : `OpenAI API returned status ${res.status}`,
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
   * Calculate cost for image generation
   */
  calculateCost(options: ImageGenerationOptions): number {
    const costs: Record<DalleModel, Record<DalleQuality, Record<string, number>>> = {
      'dall-e-2': {
        standard: {
          '256x256': 0.016,
          '512x512': 0.018,
          '1024x1024': 0.020,
        },
        hd: {
          '256x256': 0.016,
          '512x512': 0.018,
          '1024x1024': 0.020,
        },
      },
      'dall-e-3': {
        standard: {
          '1024x1024': 0.040,
          '1792x1024': 0.080,
          '1024x1792': 0.080,
        },
        hd: {
          '1024x1024': 0.080,
          '1792x1024': 0.120,
          '1024x1792': 0.120,
        },
      },
    };

    const model = options.model || this.defaultModel;
    const quality = options.quality || 'standard';
    const size = options.size || '1024x1024';
    const n = options.n || 1;

    // FIX (P2-nullish): Use ?? instead of || so that a hypothetical $0 cost
    // entry is not incorrectly replaced with the default.  || treats 0 as
    // falsy, silently returning 0.040 instead of 0.
    // eslint-disable-next-line security/detect-object-injection -- static lookup table with validated inputs
    const costPerImage = costs[model]?.[quality]?.[size] ?? 0.040;
    return costPerImage * n;
  }
}
