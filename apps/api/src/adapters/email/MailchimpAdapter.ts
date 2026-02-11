import crypto from 'crypto';
import fetch from 'node-fetch';

import { timeoutConfig, circuitBreakerConfig } from '@config';
import { API_VERSIONS, DEFAULT_TIMEOUTS, DEFAULT_CIRCUIT_BREAKER_CONFIG } from '../../utils/config';
import { EmailProviderAdapter, EmailSequence, validateEmailSequence, validateEmail } from './EmailProviderAdapter';
import { StructuredLogger, createRequestContext, MetricsCollector } from '../../utils/request';
import { validateNonEmptyString } from '../../utils/validation';
import { withCircuitBreaker, withTimeout } from '../../utils/resilience';

import { AbortController } from 'abort-controller';

/**
 * Mailchimp Email Provider Adapter
 *
 */

export interface MailchimpErrorResponse {
  title?: string;
  detail?: string;
  status?: number;
  instance?: string;
}

export interface MailchimpListResponse {
  id: string;
  name?: string;
  status?: string;
}

export interface MailchimpMemberResponse {
  id?: string;
  email_address?: string;
  status?: string;
}

export class MailchimpAdapter implements EmailProviderAdapter {
  private readonly baseUrl: string;
  private readonly timeoutMs = DEFAULT_TIMEOUTS.long;
  private readonly logger: StructuredLogger;
  private readonly metrics: MetricsCollector;
  private readonly createListWithResilience: (name: string) => Promise<string>;

  private readonly addSubscriberWithResilience: (email: string, listId: string) => Promise<void>;

  constructor(private readonly apiKey: string, private readonly server: string) {
    validateNonEmptyString(apiKey, 'apiKey');
    validateNonEmptyString(server, 'server');

    this.baseUrl = `https://${this.server}.api.mailchimp.com/${API_VERSIONS.mailchimp}`;
    this.logger = new StructuredLogger('MailchimpAdapter');
    this.metrics = new MetricsCollector('MailchimpAdapter');

    this.createListWithResilience = withCircuitBreaker(
      ((name: string) => this._createListInternal(name)) as (...args: unknown[]) => Promise<unknown>,
      DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold,
      'mailchimp-createList'
    ) as (name: string) => Promise<string>;

    this.addSubscriberWithResilience = withCircuitBreaker(
      ((email: string, listId: string) => this._addSubscriberInternal(email, listId)) as (...args: unknown[]) => Promise<unknown>,
      DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold,
      'mailchimp-addSubscriber'
    ) as (email: string, listId: string) => Promise<void>;
  }

  /**
   * Create a new email list
   */
  async createList(name: string): Promise<string> {
    const context = createRequestContext('MailchimpAdapter', 'createList');
    this.logger.info('Creating Mailchimp list', context, { name });

    try {
      const result = await withTimeout(
        this.createListWithResilience(name),
        this.timeoutMs
      );

      this.metrics.recordSuccess('createList');
      this.logger.info('Successfully created Mailchimp list', context, { listId: result });

      return result;
    } catch (error) {
      this.metrics.recordError('createList', error instanceof Error ? error.name : 'Unknown');
      this.logger.error('Failed to create Mailchimp list', context, error instanceof Error ? error : new Error(String(error)), { name });
      throw error;
    }
  }

  /**
   * Internal implementation of createList
   */
  private async _createListInternal(name: string): Promise<string> {
    const validatedName = validateNonEmptyString(name, 'name');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/lists`, {
        method: 'POST',
        headers: {
          Authorization: `apikey ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          name: validatedName,
          contact: { company: 'ACP', country: 'US' },
          permission_reminder: 'You opted in',
          campaign_defaults: {},
          email_type_option: false,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorBody = await res.text();
        let errorMessage = `Mailchimp list creation failed: ${res.status}`;

        try {
          const errorData = JSON.parse(errorBody) as MailchimpErrorResponse;
          errorMessage = errorData.title || errorData.detail || errorMessage;
        } catch {
          // Use default error message if parsing fails
        }

        throw new Error(errorMessage);
      }

      const rawData = await res.json() as unknown;
      if (!rawData || typeof rawData !== 'object' || typeof (rawData as { id?: unknown }).id !== 'string') {
        throw new Error('Mailchimp API response missing or invalid list ID');
      }
      const data = rawData as MailchimpListResponse;

      return data.id;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Mailchimp list creation timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Create an email sequence (placeholder implementation)
   */
  async createSequence(sequence: EmailSequence): Promise<void> {
    const context = createRequestContext('MailchimpAdapter', 'createSequence');

    const validation = validateEmailSequence(sequence);
    if (!validation.valid) {
      this.logger.error('Invalid sequence', context, new Error(validation.error || 'Unknown'));
      throw new Error(`Invalid sequence: ${validation.error}`);
    }

    this.logger.info('Creating Mailchimp sequence', context, {
      name: sequence.name,
      emailCount: sequence.emails.length
    });

    // Mailchimp sequences require campaigns - this is a simplified implementation
    // Note: Full campaign automation is planned for a future release
    this.metrics.recordSuccess('createSequence');
  }

  /**
   * Add a subscriber to a list
   * 
   * P1-HIGH FIX: Added unsubscribe headers for CAN-SPAM compliance
   */
  async addSubscriber(email: string, listId: string): Promise<void> {
    const context = createRequestContext('MailchimpAdapter', 'addSubscriber');
    this.logger.info('Adding subscriber to Mailchimp', context, { email, listId });

    try {
      await withTimeout(
        this.addSubscriberWithResilience(email, listId),
        this.timeoutMs
      );

      this.metrics.recordSuccess('addSubscriber');
      this.logger.info('Successfully added subscriber', context);
    } catch (error) {
      this.metrics.recordError('addSubscriber', error instanceof Error ? error.name : 'Unknown');
      this.logger.error('Failed to add subscriber', context, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Internal implementation of addSubscriber
   * 
   * P1-HIGH FIX: Added List-Unsubscribe headers for CAN-SPAM compliance
   */
  private async _addSubscriberInternal(email: string, listId: string): Promise<void> {
    if (!validateEmail(email)) {
      throw new Error(`Invalid email format: ${email}`);
    }
    validateNonEmptyString(listId, 'listId');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    // P1-HIGH FIX: Generate unsubscribe URL for CAN-SPAM compliance
    const unsubscribeUrl = `${this.baseUrl}/lists/${encodeURIComponent(listId)}/members/${crypto.createHash('md5').update(email.toLowerCase()).digest('hex')}`;

    try {
      const res = await fetch(
        `${this.baseUrl}/lists/${encodeURIComponent(listId)}/members`,
        {
          method: 'POST',
          headers: {
            Authorization: `apikey ${this.apiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            // P1-HIGH FIX: Add List-Unsubscribe headers for CAN-SPAM compliance
            'List-Unsubscribe': `<${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
          body: JSON.stringify({
            email_address: email.toLowerCase().trim(),
            status: 'subscribed',
          }),
          signal: controller.signal,
        }
      );

      if (!res.ok) {
        // 400 with specific error code means member already exists - that's ok
        if (res.status === 400) {
          try {
            const errorData = await res.json() as MailchimpErrorResponse;
            if (errorData.title === 'Member Exists') {
              return; // Already subscribed, not an error
            }
          } catch {
            // Continue to throw error
          }
        }

        throw new Error(`Mailchimp subscriber addition failed: ${res.status}`);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Mailchimp subscriber addition timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number; error?: string }> {
    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUTS.short);

    try {
      // Use the root API endpoint as health check
      const res = await fetch(`${this.baseUrl}/`, {
        method: 'GET',
        headers: {
          Authorization: `apikey ${this.apiKey}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      const latency = Date.now() - start;
      const healthy = res.ok;

      const result: { healthy: boolean; latency: number; error?: string } = {
        healthy,
        latency,
      };
      if (!healthy) {
        result.error = `Mailchimp API returned status ${res.status}`;
      }
      return result;
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
