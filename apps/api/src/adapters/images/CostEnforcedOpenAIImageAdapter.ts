import { CostTracker } from '@monitoring/costTracker';
import {
  OpenAIImageAdapter,
  ImageGenerationOptions,
  ImageEditOptions,
  ImageVariationOptions,
  GeneratedImage,
} from './OpenAIImageAdapter';
import { getLogger } from '@kernel/logger';

const logger = getLogger('CostEnforcedOpenAIImageAdapter');

/**
 * Error thrown when an org's spending budget has been exceeded.
 * The statusCode property is read by the Fastify error handler.
 */
export class BudgetExceededError extends Error {
  public readonly statusCode = 402;
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

/**
 * Cost-enforcing wrapper around OpenAIImageAdapter.
 *
 * Adds org-aware budget checking before every OpenAI API call
 * and records actual costs after successful calls.
 */
export class CostEnforcedOpenAIImageAdapter {
  private readonly adapter: OpenAIImageAdapter;
  private readonly costTracker: CostTracker;

  constructor(adapter: OpenAIImageAdapter, costTracker: CostTracker) {
    this.adapter = adapter;
    this.costTracker = costTracker;
  }

  /**
   * Generate images with budget enforcement.
   */
  async generate(
    orgId: string,
    prompt: string,
    options: ImageGenerationOptions = {}
  ): Promise<GeneratedImage[]> {
    const estimatedCost = this.adapter.calculateCost(options);

    // Pre-call budget check
    const budgetCheck = await this.costTracker.checkBudget(orgId, estimatedCost);
    if (!budgetCheck.allowed) {
      throw new BudgetExceededError(budgetCheck.reason || 'Budget exceeded');
    }

    // Make the actual API call
    const images = await this.adapter.generate(prompt, options);

    // Post-call cost recording (fire-and-forget)
    this.costTracker.track({
      orgId,
      service: 'openai',
      operation: `image:generate:${options.model || 'dall-e-3'}`,
      cost: estimatedCost,
      currency: 'USD',
      metadata: {
        model: options.model || 'dall-e-3',
        size: options.size || '1024x1024',
        quality: options.quality || 'standard',
        n: options.n || 1,
      },
      timestamp: new Date(),
    }).catch((err: unknown) => {
      logger.error('Failed to track image generation cost', err instanceof Error ? err : new Error(String(err)));
    });

    return images;
  }

  /**
   * Edit an image with budget enforcement.
   */
  async editImage(orgId: string, options: ImageEditOptions): Promise<GeneratedImage[]> {
    // DALL-E 2 edits: ~$0.02 per image
    const estimatedCost = 0.02 * (options.n || 1);

    const budgetCheck = await this.costTracker.checkBudget(orgId, estimatedCost);
    if (!budgetCheck.allowed) {
      throw new BudgetExceededError(budgetCheck.reason || 'Budget exceeded');
    }

    const images = await this.adapter.editImage(options);

    this.costTracker.track({
      orgId,
      service: 'openai',
      operation: 'image:edit:dall-e-2',
      cost: estimatedCost,
      currency: 'USD',
      metadata: { size: options.size || '1024x1024', n: options.n || 1 },
      timestamp: new Date(),
    }).catch((err: unknown) => {
      logger.error('Failed to track image edit cost', err instanceof Error ? err : new Error(String(err)));
    });

    return images;
  }

  /**
   * Create image variations with budget enforcement.
   */
  async createVariation(orgId: string, options: ImageVariationOptions): Promise<GeneratedImage[]> {
    // DALL-E 2 variations: ~$0.02 per image
    const estimatedCost = 0.02 * (options.n || 1);

    const budgetCheck = await this.costTracker.checkBudget(orgId, estimatedCost);
    if (!budgetCheck.allowed) {
      throw new BudgetExceededError(budgetCheck.reason || 'Budget exceeded');
    }

    const images = await this.adapter.createVariation(options);

    this.costTracker.track({
      orgId,
      service: 'openai',
      operation: 'image:variation:dall-e-2',
      cost: estimatedCost,
      currency: 'USD',
      metadata: { size: options.size || '1024x1024', n: options.n || 1 },
      timestamp: new Date(),
    }).catch((err: unknown) => {
      logger.error('Failed to track image variation cost', err instanceof Error ? err : new Error(String(err)));
    });

    return images;
  }

  healthCheck() {
    return this.adapter.healthCheck();
  }

  calculateCost(options: ImageGenerationOptions) {
    return this.adapter.calculateCost(options);
  }
}
