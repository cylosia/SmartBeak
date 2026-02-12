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

// SECURITY FIX (Finding 14): Mask PII in log output
function maskEmail(email: string | string[]): string | string[] {
  if (Array.isArray(email)) {
    return email.map(e => maskSingleEmail(e));
  }
  return maskSingleEmail(email);
}

// P2-15 FIX: Handle edge cases in email masking (single-label domains, empty local parts)
function maskSingleEmail(email: string): string {
  const atIndex = email.indexOf('@');
  if (atIndex <= 0) return '***';
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  if (!domain) return '***';
  const maskedLocal = (local[0] ?? '') + '***';
  const domainParts = domain.split('.');
  const maskedFirstPart = (domainParts[0]?.[0] ?? '') + '***';
  // P2-15 FIX: Handle single-label domains (e.g., "localhost") without trailing dot
  const maskedDomain = domainParts.length > 1
    ? maskedFirstPart + '.' + domainParts.slice(1).join('.')
    : maskedFirstPart;
  return `${maskedLocal}@${maskedDomain}`;
}

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
  // COMPLIANCE FIX (Finding 13): Required for CAN-SPAM and Gmail/Yahoo 2024 sender requirements
  listUnsubscribe?: string;
  listUnsubscribePost?: string;
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
  // P1-1 FIX: Track half-open state to allow exactly ONE probe request
  isHalfOpen: boolean;
}

// P2-10 FIX: Sanitize header values to prevent CRLF injection
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]/g, '');
}

class EmailProviderWithCircuitBreaker implements EmailProvider {
  private circuit: CircuitState = {
    failures: 0,
    lastFailure: 0,
    isOpen: false,
    isHalfOpen: false,
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
      // P1-1 FIX: Transition to half-open state. Only one request should
      // be allowed through as a probe. If another concurrent request arrives
      // while already half-open, reject it to prevent flooding a recovering provider.
      if (this.circuit.isHalfOpen) {
        throw new Error(`Circuit half-open for ${this.name}, probe in progress`);
      }
      this.circuit.isHalfOpen = true;
    }

    // COMPLIANCE FIX (Finding 13): Inject List-Unsubscribe headers if provided
    // P2-10 FIX: Sanitize header values to prevent CRLF injection
    const enrichedMessage = { ...message };
    if (message.listUnsubscribe) {
      enrichedMessage.headers = {
        ...enrichedMessage.headers,
        'List-Unsubscribe': sanitizeHeaderValue(message.listUnsubscribe),
      };
      if (message.listUnsubscribePost) {
        enrichedMessage.headers['List-Unsubscribe-Post'] = sanitizeHeaderValue(message.listUnsubscribePost);
      }
    }

    try {
      const result = await this.provider.send(enrichedMessage);
      // Success - reset failures and close circuit
      this.circuit.failures = 0;
      // P1-1 FIX: Close circuit fully on successful probe
      this.circuit.isOpen = false;
      this.circuit.isHalfOpen = false;
      return result;
    } catch (error) {
      // Failure - increment counter
      this.circuit.failures++;
      this.circuit.lastFailure = Date.now();

      // P1-1 FIX: If half-open probe failed, re-open circuit immediately
      if (this.circuit.isHalfOpen) {
        this.circuit.isOpen = true;
        this.circuit.isHalfOpen = false;
        logger.error(`Circuit re-opened for ${this.name} after failed probe`);
      } else if (this.circuit.failures >= this.failureThreshold) {
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

  /** P2-1 FIX: Public accessor for circuit state instead of (p as any) cast */
  isCircuitOpen(): boolean {
    return this.circuit.isOpen;
  }
}

/**
 * Fallback email sender with multiple providers
 */
export class FallbackEmailSender {
  private providers: EmailProviderWithCircuitBreaker[];

  constructor(config: FallbackConfig) {
    // P1-11 FIX: Use ?? instead of || to prevent falsy gotcha.
    // Previously, failureThreshold: 0 (immediate open) silently defaulted to 5.
    this.providers = config.providers.map(
      (p, _i) => new EmailProviderWithCircuitBreaker(
        p.name,
        p,
        config.failureThreshold ?? 5,
        config.resetTimeoutMs ?? 60000
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
        // SECURITY FIX (Finding 14): Mask PII in logs
        logger.info(`Email sent via ${provider.name}`, {
          to: maskEmail(message.to),
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
  /** Maximum number of failed emails to keep in the retry queue */
  private static readonly MAX_FAILED_QUEUE_SIZE = 10000;

  private async queueForRetry(message: EmailMessage): Promise<void> {
    try {
      const redis = await getRedis();

      // P2-8 FIX: Strip attachment content to prevent memory amplification
      // (Buffer serialization via JSON.stringify causes 4-5x expansion)
      const failedMessage = {
        to: message.to,
        from: message.from,
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: message.headers,
        listUnsubscribe: message.listUnsubscribe,
        listUnsubscribePost: message.listUnsubscribePost,
        // Store attachment metadata only, not content
        attachmentNames: message.attachments?.map(a => a.filename),
        failedAt: new Date().toISOString(),
        retryCount: 0,
      };

      await redis.lpush('email:failed', JSON.stringify(failedMessage));
      // P1-3 FIX: Cap the queue size to prevent unbounded growth
      await redis.ltrim('email:failed', 0, FallbackEmailSender.MAX_FAILED_QUEUE_SIZE - 1);
      // SECURITY FIX (Finding 14): Mask PII in logs
      logger.info('Email queued for manual retry', { to: maskEmail(message.to) });
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
        circuitOpen: p.isCircuitOpen(),
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
      // SECURITY FIX (Finding 14): Mask PII in logs
      logger.info('[EMAIL-LOG] Would send email', {
        to: maskEmail(message.to),
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
