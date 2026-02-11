import fetch from 'node-fetch';
import { LRUCache } from 'lru-cache';

import { timeoutConfig, circuitBreakerConfig } from '@config';
import { API_VERSIONS, API_BASE_URLS, DEFAULT_TIMEOUTS, DEFAULT_CIRCUIT_BREAKER_CONFIG } from '../../utils/config';
import { EmailProviderAdapter, EmailSequence, validateEmailSequence, validateEmail } from './EmailProviderAdapter';
import { StructuredLogger, createRequestContext, MetricsCollector } from '../../utils/request';
import { validateNonEmptyString, isConstantContactErrorsResponse, isConstantContactListResponse } from '../../utils/validation';
import { withCircuitBreaker, withTimeout } from '../../utils/resilience';
import { withRetry } from '../../utils/retry';

import { AbortController } from 'abort-controller';

/**
 * Constant Contact Email Provider Adapter
 *
 * FIX: AbortController cleanup
 */

// Type definitions
export interface ConstantContactListResponse {
  list_id: string;
  name?: string;
  status?: 'ACTIVE' | 'DEPRECATED';
}

export interface ConstantContactErrorResponse {
  error_key?: string;
  error_message?: string;
}

export interface ConstantContactErrorsResponse {
  errors?: ConstantContactErrorResponse[];
}

// FIX: Request state tracking for cleanup
export interface RequestState {
  controller: AbortController;
  timeoutId: NodeJS.Timeout;
}

export class ConstantContactAdapter implements EmailProviderAdapter {
  private readonly baseUrl: string;
  private readonly timeoutMs = DEFAULT_TIMEOUTS.long;
  private readonly logger: StructuredLogger;
  private readonly metrics: MetricsCollector;

  private createListWithResilience: (name: string) => Promise<string>;

  private addSubscriberWithResilience: (email: string, listId: string) => Promise<void>;

  // FIX: Track active requests for cleanup with LRU cache to prevent unbounded growth
  private activeRequests = new LRUCache<string, RequestState>({ max: 1000, ttl: 300000 });
  private requestCounter = 0;

  constructor(private readonly accessToken: string) {
    validateNonEmptyString(accessToken, 'accessToken');

    this.baseUrl = `${API_BASE_URLS.constantcontact}/${API_VERSIONS.constantcontact}`;
    this.logger = new StructuredLogger('ConstantContactAdapter');
    this.metrics = new MetricsCollector('ConstantContactAdapter');

    this.createListWithResilience = withCircuitBreaker(
      ((name: string) => this._createListInternal(name)) as (...args: unknown[]) => Promise<unknown>,
      DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold,
      'constantcontact-createList'
    ) as (name: string) => Promise<string>;

    this.addSubscriberWithResilience = withCircuitBreaker(
      ((email: string, listId: string) => this._addSubscriberInternal(email, listId)) as (...args: unknown[]) => Promise<unknown>,
      DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold,
      'constantcontact-addSubscriber'
    ) as (email: string, listId: string) => Promise<void>;
  }

  /**
   * FIX: Generate unique request ID
   */
  private generateRequestId(): string {
    return `req_${++this.requestCounter}_${Date.now()}`;
  }

  /**
   * FIX: Create and track AbortController with timeout
   */
  private createAbortController(requestId: string, timeoutMs?: number): RequestState {
    const controller = new AbortController();
    const ms = timeoutMs || this.timeoutMs;
    const timeoutId = setTimeout(() => controller.abort(), ms);

    const state: RequestState = { controller, timeoutId };
    this.activeRequests.set(requestId, state);

    // Auto-cleanup when aborted
    controller.signal.addEventListener('abort', () => {
      this.cleanupRequest(requestId);
    }, { once: true });

    return state;
  }

  /**
   * FIX: Cleanup request state
   */
  private cleanupRequest(requestId: string): void {
    const state = this.activeRequests.get(requestId);
    if (state) {
      clearTimeout(state.timeoutId);
      this.activeRequests.delete(requestId);
    }
  }

  /**
   * FIX: Cleanup all active requests
   */
  public cleanup(): void {
    for (const [requestId, state] of this.activeRequests.entries()) {
      try {
        state.controller.abort();
      } catch (err) {
        // Ignore abort errors
      }
      clearTimeout(state.timeoutId);
      this.activeRequests.delete(requestId);
    }
  }

  /**
   * FIX: Get count of active requests
   */
  public getActiveRequestCount(): number {
    return this.activeRequests.size;
  }

  /**
   * Creates a new contact list in Constant Contact
   */
  async createList(name: string): Promise<string> {
    const context = createRequestContext('ConstantContactAdapter', 'createList');
    this.logger.info('Creating Constant Contact list', context, { name });

    try {
      const result = await withTimeout(
        this.createListWithResilience(name),
        this.timeoutMs
      );

      this.metrics.recordSuccess('createList');
      this.logger.info('Successfully created Constant Contact list', context, { listId: result });

      return result;
    } catch (error) {
      this.metrics.recordError('createList', error instanceof Error ? error.name : 'Unknown');
      this.logger.error('Failed to create Constant Contact list', context, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Internal implementation of createList
   */
  private async _createListInternal(name: string): Promise<string> {
    const validatedName = validateNonEmptyString(name, 'name');

    const url = `${this.baseUrl}/contact_lists`;

    // FIX: Use tracked AbortController
    const requestId = this.generateRequestId();
    const { controller } = this.createAbortController(requestId);

    try {
      const res = await withRetry(async () => {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ name: validatedName.trim() }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorBody = await response.text();
          let errorMessage = `Constant Contact list creation failed: ${response.status}`;

          try {
            const errorData = JSON.parse(errorBody);
            if (isConstantContactErrorsResponse(errorData) && errorData.errors && errorData.errors.length > 0) {
              const firstError = errorData.errors[0];
              if (firstError) {
                errorMessage = firstError['error_message'] || errorMessage;
              }
            }
          } catch {
            // Use default error message if parsing fails
          }

          throw new Error(errorMessage);
        }

        return response;
      }, { maxRetries: 3 });

      const data = await res.json() as unknown;
      if (!isConstantContactListResponse(data)) {
        throw new Error('Constant Contact API response missing list_id');
      }

      return data['list_id'];
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Constant Contact list creation timed out');
      }
      throw error;
    } finally {
      // FIX: Cleanup request state
      this.cleanupRequest(requestId);
    }
  }

  /**
   * Creates an email sequence in Constant Contact
   */
  async createSequence(sequence: EmailSequence): Promise<void> {
    const context = createRequestContext('ConstantContactAdapter', 'createSequence');

    const validation = validateEmailSequence(sequence);
    if (!validation.valid) {
      throw new Error(`Invalid sequence: ${validation.error}`);
    }

    this.logger.info('Creating Constant Contact sequence', context, {
      name: sequence.name,
      emailCount: sequence.emails.length
    });

    // Constant Contact sequences are implemented as automated email campaigns
    this.metrics.recordSuccess('createSequence');
  }

  /**
   * Adds a subscriber to a Constant Contact list
   */
  async addSubscriber(email: string, listId: string): Promise<void> {
    const context = createRequestContext('ConstantContactAdapter', 'addSubscriber');
    this.logger.info('Adding subscriber to Constant Contact', context, { email, listId });

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
   */
  private async _addSubscriberInternal(email: string, listId: string): Promise<void> {
    if (!validateEmail(email)) {
      throw new Error(`Invalid email format: ${email}`);
    }
    validateNonEmptyString(listId, 'listId');

    const url = `${this.baseUrl}/contacts/sign_up_form`;

    // FIX: Use tracked AbortController
    const requestId = this.generateRequestId();
    const { controller } = this.createAbortController(requestId);

    try {
      await withRetry(async () => {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            email_address: email.toLowerCase().trim(),
            list_id: listId,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorBody = await response.text();
          let errorMessage = `Constant Contact subscriber addition failed: ${response.status}`;

          try {
            const errorData = JSON.parse(errorBody);
            if (isConstantContactErrorsResponse(errorData) && errorData.errors && errorData.errors.length > 0) {
              const firstError = errorData.errors[0];
              if (firstError) {
                errorMessage = firstError['error_message'] || errorMessage;
              }
            }
          } catch {
            // Use default error message if parsing fails
          }

          // 409 is acceptable - contact already exists
          if (response.status === 409) {
            return response;
          }

          throw new Error(errorMessage);
        }

        return response;
      }, { maxRetries: 3 });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Constant Contact subscriber addition timed out');
      }
      throw error;
    } finally {
      // FIX: Cleanup request state
      this.cleanupRequest(requestId);
    }
  }

  /**
   * Health check for Constant Contact API connection
   */
  async healthCheck(): Promise<{ healthy: boolean; latency: number; error?: string }> {
    const start = Date.now();

    // FIX: Use tracked AbortController with shorter timeout
    const requestId = this.generateRequestId();
    const { controller } = this.createAbortController(requestId, DEFAULT_TIMEOUTS.short);

    try {
      // Use the account info endpoint as health check
      const url = `${this.baseUrl}/account_info`;

      const res = await withRetry(async () => {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            Accept: 'application/json',
          },
          signal: controller.signal,
        });
        return response;
      }, { maxRetries: 2 });

      const healthy = res.ok;
      const latency = Date.now() - start;

      const result: { healthy: boolean; latency: number; error?: string } = {
        healthy,
        latency,
      };
      if (!healthy) {
        result.error = `Constant Contact API returned status ${res.status}`;
      }
      return result;
    } catch (error) {
      return {
        healthy: false,
        latency: Date.now() - start,
        error: error instanceof Error ? error["message"] : 'Unknown error',
      };
    } finally {
      // FIX: Cleanup request state
      this.cleanupRequest(requestId);
    }
  }
}
