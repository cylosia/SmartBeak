import fetch from 'node-fetch';
import FormData from 'form-data';

import { API_BASE_URLS, DEFAULT_TIMEOUTS } from '../../utils/config';
import { StructuredLogger, createRequestContext, MetricsCollector } from '@kernel/request';
import { validateNonEmptyString } from '../../utils/validation';
import { withRetry, sleep } from '@kernel/retry';

// P2-10: Remove node-fetch AbortController polyfill — Node 18+ provides a global
// AbortController with the correct types. The polyfill conflicts with the native
// fetch signal type.

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
 * API Error with status code
 */
class ApiError extends Error {
  constructor(
    message: string,
    public status: number
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
    // P1-10: prompt removed from metadata — user-generated content must not flow
    // into structured logs via the return value. Prompts are PII under GDPR/CCPA.
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
    } = options;

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
            }),
            signal: controller.signal,
          });

          if (!response.ok) {
            if (response.status === 429) {
              // P0-7: Honor the Retry-After header before rethrowing so withRetry
              // does not retry immediately (ignoring the server-specified cooldown).
              // Sleep happens inside the retry fn so withRetry adds 0 extra delay.
              const retryAfterHeader = response.headers.get('retry-after');
              const delayMs = retryAfterHeader
                ? (parseInt(retryAfterHeader, 10) * 1_000 || 60_000)
                : 60_000;
              await sleep(delayMs);
              throw new ApiError(`OpenAI rate limited: ${response.status}`, response.status);
            }

            // P1-8: Truncate raw error body before throwing — the full body could
            // contain echoed request fields (API key in debugging proxies, user prompt).
            const errorText = await response.text();
            const truncated = errorText.slice(0, 200);
            this.logger.debug('OpenAI error response body', context, { status: response.status, truncatedBody: truncated });
            throw new ApiError(`OpenAI API error: ${response.status}`, response.status);
          }

          const rawData = await response.json();
          if (!isOpenAIImageResponse(rawData)) {
            throw new ApiError('Invalid response format from OpenAI API', 500);
          }
          return rawData;
        } finally {
          clearTimeout(timeoutId);
        }
      }, {
        maxRetries: 3,
        initialDelayMs: 0,
        maxDelayMs: 0,
        shouldRetry: (e) => e instanceof ApiError && (e.status === 429 || e.status >= 500),
      });

      if (!data.data.every((item: unknown) => {
        const img = item as OpenAIImageData;
        return img && typeof img === 'object' && typeof img.url === 'string';
      })) {
        throw new ApiError('Invalid response data structure from OpenAI API', 500);
      }

      const images = data.data.map((img): GeneratedImage => ({
        url: img['url'],
        revisedPrompt: img.revised_prompt ?? undefined,
        b64Json: img.b64_json ?? undefined,
        metadata: {
          model,
          size,
          quality,
          style: style ?? undefined,
          // P1-10: prompt intentionally omitted — do not log user-generated content
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

    this.logger.info('Editing image with OpenAI', context);

    const startTime = Date.now();

    try {
      const data = await withRetry(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
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
              // P0-7: Honor Retry-After
              const retryAfterHeader = response.headers.get('retry-after');
              const delayMs = retryAfterHeader
                ? (parseInt(retryAfterHeader, 10) * 1_000 || 60_000)
                : 60_000;
              await sleep(delayMs);
              throw new ApiError(`OpenAI rate limited: ${response.status}`, response.status);
            }
            // P1-8: Truncate error body
            const errorText = await response.text();
            this.logger.debug('OpenAI edit error body', context, { status: response.status, truncatedBody: errorText.slice(0, 200) });
            throw new ApiError(`OpenAI edit error: ${response.status}`, response.status);
          }

          const rawData = await response.json();
          if (!isOpenAIImageResponse(rawData)) {
            throw new ApiError('Invalid response format from OpenAI API', 500);
          }
          return rawData;
        } finally {
          clearTimeout(timeoutId);
        }
      }, {
        maxRetries: 3,
        initialDelayMs: 0,
        maxDelayMs: 0,
        shouldRetry: (e) => e instanceof ApiError && (e.status === 429 || e.status >= 500),
      });

      const images = data.data.map((img): GeneratedImage => ({
        url: img['url'],
        b64Json: img.b64_json ?? undefined,
        metadata: {
          model: 'dall-e-2',
          size: size as DalleSize,
          quality: 'standard',
          // P1-10: prompt omitted
          createdAt: new Date(data.created * 1000).toISOString(),
          provider: 'openai',
        },
      }));

      const latency = Date.now() - startTime;
      this.metrics.recordLatency('editImage', latency, true);
      this.metrics.recordSuccess('editImage');
      return images;
    } catch (error) {
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

    this.logger.info('Creating image variation with OpenAI', context);

    const startTime = Date.now();

    try {
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
              // P0-7: Honor Retry-After
              const retryAfterHeader = response.headers.get('retry-after');
              const delayMs = retryAfterHeader
                ? (parseInt(retryAfterHeader, 10) * 1_000 || 60_000)
                : 60_000;
              await sleep(delayMs);
              throw new ApiError(`OpenAI rate limited: ${response.status}`, response.status);
            }
            // P1-8: Truncate error body
            const errorText = await response.text();
            this.logger.debug('OpenAI variation error body', context, { status: response.status, truncatedBody: errorText.slice(0, 200) });
            throw new ApiError(`OpenAI variation error: ${response.status}`, response.status);
          }

          const rawData = await response.json();
          if (!isOpenAIImageResponse(rawData)) {
            throw new ApiError('Invalid response format from OpenAI API', 500);
          }
          return rawData;
        } finally {
          clearTimeout(timeoutId);
        }
      }, {
        maxRetries: 3,
        initialDelayMs: 0,
        maxDelayMs: 0,
        shouldRetry: (e) => e instanceof ApiError && (e.status === 429 || e.status >= 500),
      });

      const images = data.data.map((img): GeneratedImage => ({
        url: img['url'],
        b64Json: img.b64_json ?? undefined,
        metadata: {
          model: 'dall-e-2',
          size: size as DalleSize,
          quality: 'standard',
          // P2-13: variation has no prompt — use undefined instead of sentinel ''
          // which would appear as an empty-prompt policy violation in audit logs
          createdAt: new Date(data.created * 1000).toISOString(),
          provider: 'openai',
        },
      }));

      const latency = Date.now() - startTime;
      this.metrics.recordLatency('createVariation', latency, true);
      this.metrics.recordSuccess('createVariation');
      return images;
    } catch (error) {
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
      const res = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      const latency = Date.now() - start;
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
        error: error instanceof Error ? error['message'] : 'Unknown error',
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

    // eslint-disable-next-line security/detect-object-injection -- static lookup table with validated inputs
    const costPerImage = costs[model]?.[quality]?.[size] || 0.040;
    return costPerImage * n;
  }
}
