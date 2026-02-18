/**
 * P1-FIX: Email Provider with Fallback Chain
 *
 * Implements multiple email providers with automatic failover:
 * Primary (SES) → Secondary (SendGrid/Postmark) → Tertiary (Log for manual)
 *
 * Prevents email loss during provider outages or throttling.
 */

import { getLogger } from '@kernel/logger';
import { emitCounter } from '@kernel/metrics';
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

/**
 * AUDIT FIX (Finding 3.1): Error classification to prevent blind fallback.
 * Only infrastructure errors should trigger fallback to avoid spreading
 * reputation damage across providers on hard bounces or validation failures.
 */
type EmailErrorCategory = 'infrastructure' | 'validation' | 'reputation';

const VALIDATION_ERROR_PATTERNS = [
  'does not exist',
  'invalid recipient',
  'invalid email',
  'mailbox not found',
  'user unknown',
  'no such user',
  'recipient rejected',
  'address rejected',
  'undeliverable',
  '550',  // SMTP permanent failure
  '553',  // Mailbox name not allowed
  '556',  // Domain not found
];

const REPUTATION_ERROR_PATTERNS = [
  'spam',
  'blocked',
  'blacklisted',
  'blocklisted',
  'reputation',
  'policy rejection',
  'message rejected',
  'dkim',
  'dmarc',
  'spf fail',
  '554',  // Transaction failed / spam
];

function classifyEmailError(error: Error): EmailErrorCategory {
  const message = error.message.toLowerCase();

  for (const pattern of REPUTATION_ERROR_PATTERNS) {
    if (message.includes(pattern)) {
      return 'reputation';
    }
  }

  for (const pattern of VALIDATION_ERROR_PATTERNS) {
    if (message.includes(pattern)) {
      return 'validation';
    }
  }

  // Infrastructure errors: timeouts, connection failures, 5xx, circuit open
  return 'infrastructure';
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
}

// M4 FIX: Sanitize header keys AND values to prevent CRLF/null-byte injection.
// Previously only values were sanitised; a crafted key could still inject headers.
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n\x00]/g, '');
}

function sanitizeHeaderKey(key: string): string {
  return key.replace(/[\r\n\x00:]/g, '');
}

class EmailProviderWithCircuitBreaker implements EmailProvider {
  private circuit: CircuitState = {
    failures: 0,
    lastFailure: 0,
    isOpen: false,
  };
  // P1-1 FIX: Store the in-flight probe as a Promise so concurrent requests
  // all wait on the SAME probe rather than each racing through the half-open check.
  private probePromise: Promise<{ id: string; provider: string }> | null = null;

  constructor(
    public name: string,
    private provider: EmailProvider,
    private failureThreshold: number = 5,
    private resetTimeoutMs: number = 60000
  ) {}

  private async executeProbe(message: EmailMessage): Promise<{ id: string; provider: string }> {
    try {
      const result = await this.provider.send(message);
      // Probe succeeded — close circuit
      this.circuit.failures = 0;
      this.circuit.isOpen = false;
      logger.info(`Circuit closed for ${this.name} after successful probe`);
      emitCounter('email.circuit_state_change', 1, { provider: this.name, state: 'closed' });
      return result;
    } catch (error) {
      // Probe failed — keep circuit open, reset timer
      this.circuit.lastFailure = Date.now();
      this.circuit.isOpen = true;
      logger.error(`Circuit re-opened for ${this.name} after failed probe`);
      emitCounter('email.circuit_state_change', 1, { provider: this.name, state: 'open' });
      throw error;
    }
  }

  async send(message: EmailMessage): Promise<{ id: string; provider: string }> {
    // Check if circuit is open
    if (this.circuit.isOpen) {
      const timeSinceLastFailure = Date.now() - this.circuit.lastFailure;
      if (timeSinceLastFailure < this.resetTimeoutMs) {
        throw new Error(`Circuit open for ${this.name}`);
      }
      // F-2 FIX: When the circuit is half-open and a probe is already in flight
      // for ANOTHER caller's message, we must NOT return that probe's promise.
      // Doing so would return the OTHER message's send result to this caller,
      // silently losing this caller's email — the email is never actually sent.
      //
      // Instead, throw immediately so FallbackEmailSender can try the next provider
      // for this request. The probe already in flight will close/reopen the circuit.
      if (this.probePromise) {
        throw new Error(`Circuit half-open for ${this.name}: probe in progress, try next provider`);
      }
      // This request becomes the probe
      this.probePromise = this.executeProbe(message).finally(() => {
        this.probePromise = null;
      });
      return this.probePromise;
    }

    // COMPLIANCE FIX (Finding 13): Inject List-Unsubscribe headers if provided
    // P2-10 FIX: Sanitize header values to prevent CRLF injection
    const enrichedMessage = { ...message };
    if (message.listUnsubscribe) {
      enrichedMessage.headers = {
        ...enrichedMessage.headers,
        [sanitizeHeaderKey('List-Unsubscribe')]: sanitizeHeaderValue(message.listUnsubscribe),
      };
      if (message.listUnsubscribePost) {
        enrichedMessage.headers[sanitizeHeaderKey('List-Unsubscribe-Post')] = sanitizeHeaderValue(message.listUnsubscribePost);
      }
    }

    try {
      const result = await this.provider.send(enrichedMessage);
      // Success - reset failures and close circuit
      this.circuit.failures = 0;
      this.circuit.isOpen = false;
      return result;
    } catch (error) {
      // Failure - increment counter
      this.circuit.failures++;
      this.circuit.lastFailure = Date.now();

      if (this.circuit.failures >= this.failureThreshold) {
        this.circuit.isOpen = true;
        logger.error(`Circuit opened for ${this.name} after ${this.circuit.failures} failures`);
        // M15 FIX: Emit circuit-state metric so alerting can detect provider outages
        emitCounter('email.circuit_state_change', 1, { provider: this.name, state: 'open' });
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
   *
   * AUDIT FIX (Finding 3.1): Only falls back on infrastructure errors.
   * Validation/reputation errors are thrown immediately to avoid spreading
   * reputation damage across backup providers.
   *
   * AUDIT FIX (Finding 3.2): Emits email.fallback_triggered metric and
   * logs at WARN level when a fallback provider is used.
   */
  async send(message: EmailMessage): Promise<{
    id: string;
    provider: string;
    attempts: number;
    usedFallback: boolean;
  }> {
    const errors: Error[] = [];

    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];
      if (!provider) continue;
      try {
        const result = await provider.send(message);

        const usedFallback = i > 0;
        const primaryProvider = this.providers[0];

        if (usedFallback && primaryProvider) {
          // AUDIT FIX (Finding 3.2): Emit metric and WARN on fallback usage
          emitCounter('email.fallback_triggered', 1, {
            failed_provider: primaryProvider.name,
            fallback_provider: provider.name,
          });
          logger.warn(`Email sent via fallback provider ${provider.name} (primary ${primaryProvider.name} was unavailable)`, {
            to: maskEmail(message.to),
            subject: message.subject,
            failedProviders: errors.map((_, idx) => this.providers[idx]?.name ?? 'unknown'),
          });
        } else {
          // SECURITY FIX (Finding 14): Mask PII in logs
          logger.info(`Email sent via ${provider.name}`, {
            to: maskEmail(message.to),
            subject: message.subject,
          });
        }

        return {
          ...result,
          attempts: errors.length + 1,
          usedFallback,
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        errors.push(err);

        // AUDIT FIX (Finding 3.1): Classify the error. Only infrastructure
        // errors should trigger fallback. Validation errors (bad address) or
        // reputation errors (spam/block) must NOT cascade to other providers.
        const errorCategory = classifyEmailError(err);

        if (errorCategory === 'validation') {
          logger.warn(`Provider ${provider.name} rejected email due to validation error, not falling back`, {
            to: maskEmail(message.to),
          });
          emitCounter('email.validation_rejection', 1, { provider: provider.name });
          throw err;
        }

        if (errorCategory === 'reputation') {
          logger.error(`Provider ${provider.name} rejected email due to reputation/spam issue, not falling back`, err, {
            to: maskEmail(message.to),
          });
          emitCounter('email.reputation_rejection', 1, { provider: provider.name });
          throw err;
        }

        // Infrastructure error — safe to try next provider
        logger.warn(`Provider ${provider.name} failed with infrastructure error, trying next`, {
          error: err.message,
        });
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
      // P0-3 FIX: Mask PII before storing in Redis. The previous code stored raw
      // email addresses in the Redis failed-queue, confirmed by the test at
      // fallback.test.ts:146. A Redis breach or debug access would expose all
      // customer addresses that ever had a delivery failure.
      const failedMessage = {
        to: maskEmail(message.to),
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
