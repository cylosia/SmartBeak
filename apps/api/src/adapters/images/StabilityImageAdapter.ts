import fetch from 'node-fetch';
import FormData from 'form-data';
import { randomInt } from 'crypto';

import { API_BASE_URLS, DEFAULT_TIMEOUTS } from '../../utils/config';
import { StructuredLogger, createRequestContext, MetricsCollector } from '../../utils/request';
import { validateNonEmptyString } from '../../utils/validation';
import { withRetry } from '../../utils/retry';

import { AbortController } from 'abort-controller';

/**
 * Stability AI Image Generation Adapter
 * Supports Stable Diffusion XL and Core
 *
 * Required: STABILITY_API_KEY
 */

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

// Type guard for Stability AI response
interface StabilityArtifact {
  seed: number;
  base64: string;
  finishReason: 'SUCCESS' | 'CONTENT_FILTERED' | 'ERROR';
}

interface StabilityImageResponse {
  artifacts: StabilityArtifact[];
}

function isStabilityImageResponse(data: unknown): data is StabilityImageResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as Record<string, unknown>)['artifacts'])
  );
}

export type StabilityModel = 'stable-diffusion-xl-1024-v1-0' | 'stable-diffusion-v1-6' | 'stable-image-core' | 'stable-image-ultra' | 'upscaler';
export type StabilitySize = '1024x1024' | '1024x576' | '576x1024' | '768x1344' | '1344x768' | '1536x640' | '640x1536';

export interface StabilityGenerationOptions {
  model?: StabilityModel;
  width?: number;
  height?: number;
  seed?: number;
  steps?: number;
  cfgScale?: number;
  samples?: number;
  stylePreset?: 'photographic' | 'digital-art' | 'cinematic' | 'anime' | 'comic-book' | 'fantasy-art' | 'line-art' | '3d-model' | 'pixel-art' | 'tile-texture';
  negativePrompt?: string;
  sampler?: 'DDIM' | 'DDPM' | 'K_DPMPP_2M' | 'K_DPMPP_2S_ANCESTRAL' | 'K_DPM_2' | 'K_DPM_2_ANCESTRAL' | 'K_EULER' | 'K_EULER_ANCESTRAL' | 'K_HEUN' | 'K_LMS';
}

export interface GeneratedImage {
  url?: string | undefined;
  base64: string;
  seed: number;
  finishReason: 'SUCCESS' | 'CONTENT_FILTERED' | 'ERROR';
  localPath?: string | undefined;
  metadata: {
    model: StabilityModel;
    width: number;
    height: number;
    steps: number;
    cfgScale: number;
    seed: number;
    prompt: string;
    negativePrompt?: string | undefined;
    stylePreset?: string | undefined;
    createdAt: string;
    provider: 'stability';
  };
}

export interface ImageToImageOptions extends StabilityGenerationOptions {
  image: Buffer;
  imageStrength?: number;
  mode?: 'image-to-image' | 'inpainting' | 'outpainting';
  mask?: Buffer;
}

export class StabilityImageAdapter {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: StabilityModel = 'stable-diffusion-xl-1024-v1-0';
  private readonly timeoutMs = DEFAULT_TIMEOUTS.extended;
  private readonly logger: StructuredLogger;
  private readonly metrics: MetricsCollector;

  constructor(apiKey?: string) {
    const key = apiKey || process.env['STABILITY_API_KEY'] || '';
    if (!key) {
      throw new Error('STABILITY_API_KEY is required');
    }

    this.apiKey = key;
    this.baseUrl = API_BASE_URLS.stability;
    this.logger = new StructuredLogger('StabilityImageAdapter');
    this.metrics = new MetricsCollector('StabilityImageAdapter');
  }

  /**
   * Generate images from text prompt
   */
  async generate(prompt: string, options: StabilityGenerationOptions = {}): Promise<GeneratedImage[]> {
    const context = createRequestContext('StabilityImageAdapter', 'generate');

    validateNonEmptyString(prompt, 'prompt');

    const {
      model = this.defaultModel,
      width = 1024,
      height = 1024,
      // Use safe integer range for seed generation (0 to 2^31 - 1)
      seed = randomInt(0, 2147483647),
      steps = 30,
      cfgScale = 7,
      samples = 1,
      sampler = 'K_DPMPP_2M',
      stylePreset,
      negativePrompt,
    } = options;

    // Validate dimensions based on model
    this.validateDimensions(model, width, height);

    this.logger.info('Generating image with Stability AI', context, { model, width, height });

    const startTime = Date.now();

    const requestBody: Record<string, unknown> = {
      text_prompts: [
        { text: prompt, weight: 1.0 },
        ...(negativePrompt ? [{ text: negativePrompt, weight: -1.0 }] : []),
      ],
      cfg_scale: cfgScale,
      samples,
      steps,
      seed,
      width,
      height,
      sampler,
    };

    if (stylePreset) {
      requestBody['style_preset'] = stylePreset;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await withRetry(async () => {
        const response = await fetch(`${this.baseUrl}/generation/${model}/text-to-image`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        if (!response.ok) {
          if (response.status === 429) {
            const retryAfter = response.headers.get('retry-after') || undefined;
            throw new ApiError(`Stability AI rate limited: ${response.status}`, response.status, retryAfter);
          }

          const errorText = await response.text();
          throw new Error(`Stability API error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        return response;
      }, { maxRetries: 3 });

      const rawData = await res.json();
      if (!isStabilityImageResponse(rawData)) {
        throw new ApiError('Invalid response format from Stability API', 500);
      }
      const data = rawData;

      // Validate each artifact has required fields
      if (!data.artifacts.every((item: unknown) => {
        const artifact = item as StabilityArtifact;
        return artifact && typeof artifact === 'object' && typeof artifact.base64 === 'string';
      })) {
        throw new ApiError('Invalid response data structure from Stability API', 500);
      }

      const images = data.artifacts.map((artifact): GeneratedImage => ({
        base64: artifact.base64,
        seed: artifact.seed,
        finishReason: artifact.finishReason,
        metadata: {
          model: model as StabilityModel,
          width,
          height,
          steps,
          cfgScale,
          seed: artifact.seed,
          prompt,
          negativePrompt: negativePrompt ?? undefined,
          stylePreset: stylePreset ?? undefined,
          createdAt: new Date().toISOString(),
          provider: 'stability',
        },
      }));

      const latency = Date.now() - startTime;
      this.metrics.recordLatency('generate', latency, true);
      this.metrics.recordSuccess('generate');
      this.logger.info('Successfully generated image with Stability AI', context, { count: images.length });

      return images;
    } catch (error) {
      const latency = Date.now() - startTime;
      this.metrics.recordLatency('generate', latency, false);
      this.metrics.recordError('generate', error instanceof Error ? error.name : 'Unknown');
      this.logger.error('Failed to generate image with Stability AI', context, error as Error);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Generate image from image (img2img)
   */
  async imageToImage(prompt: string, options: ImageToImageOptions): Promise<GeneratedImage[]> {
    const context = createRequestContext('StabilityImageAdapter', 'imageToImage');

    validateNonEmptyString(prompt, 'prompt');

    const {
      image,
      imageStrength = 0.35,
      model = this.defaultModel,
      width = 1024,
      height = 1024,
      seed = randomInt(0, 2147483647),
      steps = 30,
      cfgScale = 7,
      samples = 1,
      sampler: _sampler,
      stylePreset,
      negativePrompt,
    } = options;

    if (!image || !(image instanceof Buffer) || image.length === 0) {
      throw new Error('image is required and must be a non-empty Buffer');
    }

    this.logger.info('Generating image-to-image with Stability AI', context, { model, width, height });

    const startTime = Date.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await withRetry(async () => {
        const formData = new FormData();
        formData.append('init_image', image, { filename: 'image.png', contentType: 'image/png' });
        formData.append('text_prompts[0][text]', prompt);
        formData.append('text_prompts[0][weight]', '1.0');
        if (negativePrompt) {
          formData.append('text_prompts[1][text]', negativePrompt);
          formData.append('text_prompts[1][weight]', '-1.0');
        }
        formData.append('image_strength', imageStrength.toString());
        formData.append('cfg_scale', cfgScale.toString());
        formData.append('samples', samples.toString());
        formData.append('steps', steps.toString());
        formData.append('seed', seed.toString());

        const response = await fetch(`${this.baseUrl}/generation/${model}/image-to-image`, {
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
            throw new ApiError(`Stability AI rate limited: ${response.status}`, response.status, retryAfter);
          }

          const errorText = await response.text();
          throw new Error(`Stability API error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        return response;
      }, { maxRetries: 3 });

      const rawData = await res.json();
      if (!isStabilityImageResponse(rawData)) {
        throw new ApiError('Invalid response format from Stability API', 500);
      }
      const data = rawData;

      const images = data.artifacts.map((artifact): GeneratedImage => ({
        base64: artifact.base64,
        seed: artifact.seed,
        finishReason: artifact.finishReason,
        metadata: {
          model: model as StabilityModel,
          width,
          height,
          steps,
          cfgScale,
          seed: artifact.seed,
          prompt,
          negativePrompt: negativePrompt ?? undefined,
          stylePreset: stylePreset ?? undefined,
          createdAt: new Date().toISOString(),
          provider: 'stability',
        },
      }));

      const latency = Date.now() - startTime;
      this.metrics.recordLatency('imageToImage', latency, true);
      this.metrics.recordSuccess('imageToImage');
      this.logger.info('Successfully generated image-to-image with Stability AI', context, { count: images.length });

      return images;
    } catch (error) {
      const latency = Date.now() - startTime;
      this.metrics.recordLatency('imageToImage', latency, false);
      this.metrics.recordError('imageToImage', error instanceof Error ? error.name : 'Unknown');
      this.logger.error('Failed to generate image-to-image with Stability AI', context, error as Error);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Validate dimensions based on model
   */
  private validateDimensions(model: StabilityModel, width: number, height: number): void {
    const validDimensions: Partial<Record<StabilityModel, Array<[number, number]>>> = {
      'stable-diffusion-xl-1024-v1-0': [
        [1024, 1024], [1024, 576], [576, 1024], [768, 1344], [1344, 768], [1536, 640], [640, 1536],
      ],
      'stable-diffusion-v1-6': [
        [512, 512], [512, 384], [384, 512], [768, 512], [512, 768],
      ],
      'stable-image-core': [[1024, 1024]],
      'stable-image-ultra': [[1024, 1024]],
      'upscaler': [[2048, 2048]],
    };

    const valid = validDimensions[model];
    if (!valid) {
      throw new Error(`Unknown model: ${model}`);
    }
    const isValid = valid.some(([w, h]) => w === width && h === height);

    if (!isValid) {
      throw new Error(
        `Invalid dimensions ${width}x${height} for model ${model}. ` +
        `Valid dimensions: ${valid.map(([w, h]) => `${w}x${h}`).join(', ')}`
      );
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number; error?: string | undefined }> {
    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUTS.short);

    try {
      // Check user balance endpoint as health check
      const res = await fetch(`${this.baseUrl}/user/balance`, {
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
        error: healthy ? undefined : `Stability API returned status ${res.status}`,
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
}
