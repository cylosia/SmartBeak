/**
 * P1-FIX: Email Provider with Fallback Chain
 * 
 * Implements multiple email providers with automatic failover:
 * Primary (SES) → Secondary (SendGrid/Postmark) → Tertiary (Log for manual)
 * 
 * Prevents email loss during provider outages or throttling.
 */

import { getLogger } from '@kernel/logger';
import { getRedis } from '@kernel/redis';

const logger = getLogger('email:fallback');

export interface EmailMessage {
  to: string | string[];
  from: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
  headers?: Record<string, string>;
}

export interface EmailProvider {
  name: string;
  send(message: EmailMessage): Promise<{ id: string; provider: string }>;
  healthCheck(): Promise<boolean>;
}

export interface FallbackConfig {
  // Providers in priority order
  providers: EmailProvider[];
  // Circuit breaker settings
  failureThreshold?: number;
  resetTimeoutMs?: number;
  // Retry settings
  maxRetries?: number;
  retryDelayMs?: number;
}

// Circuit breaker state per provider
interface CircuitState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
}

class EmailProviderWithCircuitBreaker implements EmailProvider {
  private circuit: CircuitState = {
    failures: 0,
    lastFailure: 0,
    isOpen: false,
  };

  constructor(
    public name: string,
    private provider: EmailProvider,
    private failureThreshold: number = 5,
    private resetTimeoutMs: number = 60000
  ) {}

  async send(message: EmailMessage): Promise<{ id: string; provider: string }> {
    // Check if circuit is open
    if (this.circuit.isOpen) {
      const timeSinceLastFailure = Date.now() - this.circuit.lastFailure;
      if (timeSinceLastFailure < this.resetTimeoutMs) {
        throw new Error(`Circuit open for ${this.name}`);
      }
      // Try to close circuit
      this.circuit.isOpen = false;
      this.circuit.failures = 0;
    }

    try {
      const result = await this.provider.send(message);
      // Success - reset failures
      this.circuit.failures = 0;
      return result;
    } catch (error) {
      // Failure - increment counter
      this.circuit.failures++;
      this.circuit.lastFailure = Date.now();

      if (this.circuit.failures >= this.failureThreshold) {
        this.circuit.isOpen = true;
        logger.error(`Circuit opened for ${this.name} after ${this.circuit.failures} failures`);
      }

      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      return await this.provider.healthCheck();
    } catch {
      return false;
    }
  }
}

/**
 * Fallback email sender with multiple providers
 */
export class FallbackEmailSender {
  private providers: EmailProviderWithCircuitBreaker[];

  constructor(config: FallbackConfig) {
    this.providers = config.providers.map(
      (p, i) => new EmailProviderWithCircuitBreaker(
        p.name,
        p,
        config.failureThreshold || 5,
        config.resetTimeoutMs || 60000
      )
    );
  }

  /**
   * Send email with automatic fallback
   */
  async send(message: EmailMessage): Promise<{ 
    id: string; 
    provider: string;
    attempts: number;
  }> {
    const errors: Error[] = [];

    for (const provider of this.providers) {
      try {
        const result = await provider.send(message);
        logger.info(`Email sent via ${provider.name}`, { 
          to: message.to,
          subject: message.subject,
        });
        return {
          ...result,
          attempts: errors.length + 1,
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.warn(`Provider ${provider.name} failed, trying next`, { error: err.message });
        errors.push(err);
      }
    }

    // All providers failed - log for manual retry
    logger.error(
      'All email providers failed',
      errors.length > 0 ? errors[0] : new Error('All providers failed'),
      { errorMessages: errors.map(e => e.message) }
    );

    // Store in Redis queue for manual retry
    await this.queueForRetry(message);

    throw new Error(
      `All email providers failed after ${errors.length} attempts`
    );
  }

  /**
   * Queue failed email for manual retry
   */
  private async queueForRetry(message: EmailMessage): Promise<void> {
    try {
      const redis = await getRedis();
      
      const failedMessage = {
        ...message,
        failedAt: new Date().toISOString(),
        retryCount: 0,
      };

      await redis.lpush('email:failed', JSON.stringify(failedMessage));
      logger.info('Email queued for manual retry', { to: message.to });
    } catch (error) {
      logger.error('Failed to queue email for retry', error as Error);
    }
  }

  /**
   * Get health status of all providers
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    providers: Array<{ name: string; healthy: boolean; circuitOpen: boolean }>;
  }> {
    const results = await Promise.all(
      this.providers.map(async (p) => ({
        name: p.name,
        healthy: await p.healthCheck(),
        circuitOpen: (p as any).circuit.isOpen,
      }))
    );

    return {
      healthy: results.some(r => r.healthy && !r.circuitOpen),
      providers: results,
    };
  }
}

/**
 * Create logging provider (last resort)
 */
export function createLogProvider(): EmailProvider {
  return {
    name: 'Log',
    async send(message: EmailMessage) {
      logger.info('[EMAIL-LOG] Would send email', {
        to: message.to,
        from: message.from,
        subject: message.subject,
      });
      return { id: `log-${Date.now()}`, provider: 'Log' };
    },
    async healthCheck() {
      return true;
    },
  };
}
