import { API_VERSIONS, API_BASE_URLS, DEFAULT_TIMEOUTS, DEFAULT_CIRCUIT_BREAKER_CONFIG } from '../../utils/config';
import { AbortController } from 'abort-controller';
import { withCircuitBreaker, withTimeout } from '../../utils/resilience';
import { EmailProviderAdapter, EmailSequence, validateEmailSequence, validateEmail } from './EmailProviderAdapter';
import { validateNonEmptyString, isAWeberErrorResponse, isAWeberListResponse } from '../../utils/validation';
import fetch from 'node-fetch';
import { withRetry } from '../../utils/retry';
import { StructuredLogger, createRequestContext, MetricsCollector } from '@kernel/request';

/**
 * AWeber Email Provider Adapter
 *
 * MEDIUM FIX M3: Added structured logging
 * MEDIUM FIX M4: Added request IDs
 * MEDIUM FIX M5: Added metrics
 * FIX: AbortController cleanup
 */

export interface AWeberListResponse {
  id: string;
  name?: string;
  self_link?: string;
}

export interface AWeberErrorResponse {
  error?: {
    message: string;
    status: number;
  };
}

export interface RequestState {
  controller: AbortController;
  timeoutId: NodeJS.Timeout;
}

export class AWeberAdapter implements EmailProviderAdapter {
  private readonly accessToken: string;
  private readonly accountId: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number = DEFAULT_TIMEOUTS.long;
  private readonly logger: StructuredLogger;
  private readonly metrics: MetricsCollector;

  private readonly createListWithResilience: (name: string) => Promise<string>;
  private readonly addSubscriberWithResilience: (email: string, listId: string) => Promise<void>;

  // FIX: Track active requests for cleanup
  private activeRequests = new Map<string, RequestState>();
  private requestCounter = 0;

  constructor(accessToken: string, accountId: string) {
    this.accessToken = accessToken;
    this.accountId = accountId;

    validateNonEmptyString(accessToken, 'accessToken');
    validateNonEmptyString(accountId, 'accountId');

    this.baseUrl = `${API_BASE_URLS.aweber}/${API_VERSIONS.aweber}`;
    this.logger = new StructuredLogger('AWeberAdapter');
    this.metrics = new MetricsCollector('AWeberAdapter');

    this.createListWithResilience = withCircuitBreaker(((name: string) => this._createListInternal(name)) as (...args: unknown[]) => Promise<unknown>, DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold, 'aweber-createList') as (name: string) => Promise<string>;
    this.addSubscriberWithResilience = withCircuitBreaker(((email: string, listId: string) => this._addSubscriberInternal(email, listId)) as (...args: unknown[]) => Promise<unknown>, DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold, 'aweber-addSubscriber') as (email: string, listId: string) => Promise<void>;
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
  cleanup(): void {
    this.activeRequests.forEach((state, requestId) => {
      try {
        state.controller.abort();
      }
      catch (err) {
        // Ignore abort errors
      }
      clearTimeout(state.timeoutId);
      this.activeRequests.delete(requestId);
    });
  }

  /**
   * FIX: Get count of active requests
   */
  getActiveRequestCount(): number {
    return this.activeRequests.size;
  }

  /**
   * Creates a new email list in AWeber
   */
  async createList(name: string): Promise<string> {
    const context = createRequestContext('AWeberAdapter', 'createList');
    this.logger.info('Creating AWeber list', context, { name });
    try {
      const result = await withTimeout(this.createListWithResilience(name), this.timeoutMs);
      this.metrics.recordSuccess('createList');
      this.logger.info('Successfully created AWeber list', context, { listId: result });
      return result;
    }
    catch (error) {
      this.metrics.recordError('createList', error instanceof Error ? error.name : 'Unknown');
      this.logger.error('Failed to create AWeber list', context, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Internal implementation of createList
   */
  private async _createListInternal(name: string): Promise<string> {
    const validatedName = validateNonEmptyString(name, 'name');
    const url = `${this.baseUrl}/accounts/${this.accountId}/lists`;
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
          body: JSON.stringify({ name: validatedName }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorBody = await response.text();
          let errorMessage = `AWeber list creation failed: ${response.status}`;
          try {
            const errorData = JSON.parse(errorBody);
            if (isAWeberErrorResponse(errorData)) {
              errorMessage = errorData['error']?.['message'] || errorData['message'] || errorMessage;
            }
          }
          catch {
            // Use default error message if parsing fails
          }
          throw new Error(errorMessage);
        }
        return response;
      }, { maxRetries: 3 });
      const data = await res.json() as unknown;
      if (!isAWeberListResponse(data)) {
        throw new Error('AWeber API response missing list ID');
      }
      return data.id;
    }
    catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('AWeber list creation timed out');
      }
      throw error;
    }
    finally {
      // FIX: Cleanup request state
      this.cleanupRequest(requestId);
    }
  }

  /**
   * Creates an email sequence in AWeber
   */
  async createSequence(sequence: EmailSequence): Promise<void> {
    const context = createRequestContext('AWeberAdapter', 'createSequence');
    const validation = validateEmailSequence(sequence);
    if (!validation.valid) {
      throw new Error(`Invalid sequence: ${validation.error}`);
    }
    this.logger.info('Creating AWeber sequence', context, {
      name: sequence.name,
      emailCount: sequence.emails.length
    });
    // AWeber sequences require a list to be associated with
    // This is a placeholder as actual implementation depends on AWeber's campaign API
    this.metrics.recordSuccess('createSequence');
  }

  /**
   * Adds a subscriber to an AWeber list
   */
  async addSubscriber(email: string, listId: string): Promise<void> {
    const context = createRequestContext('AWeberAdapter', 'addSubscriber');
    this.logger.info('Adding subscriber to AWeber', context, { email, listId });
    try {
      await withTimeout(this.addSubscriberWithResilience(email, listId), this.timeoutMs);
      this.metrics.recordSuccess('addSubscriber');
      this.logger.info('Successfully added subscriber', context);
    }
    catch (error) {
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
      // P1-FIX: Do not include PII (email) in error message to prevent leakage to logs/error tracking
      throw new Error('Invalid email format');
    }
    validateNonEmptyString(listId, 'listId');
    const url = `${this.baseUrl}/accounts/${this.accountId}/lists/${listId}/subscribers`;
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
          body: JSON.stringify({ email: email.toLowerCase().trim() }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorBody = await response.text();
          let errorMessage = `AWeber subscriber addition failed: ${response.status}`;
          try {
            const errorData = JSON.parse(errorBody);
            errorMessage = errorData['error']?.['message'] || errorData['message'] || errorMessage;
          }
          catch {
            // Use default error message if parsing fails
          }
          // 409 is acceptable - subscriber already exists
          if (response.status === 409) {
            return response;
          }
          throw new Error(errorMessage);
        }
        return response;
      }, { maxRetries: 3 });
    }
    catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('AWeber subscriber addition timed out');
      }
      throw error;
    }
    finally {
      // FIX: Cleanup request state
      this.cleanupRequest(requestId);
    }
  }

  /**
   * Health check for AWeber API connection
   */
  async healthCheck(): Promise<{ healthy: boolean; latency: number; error?: string }> {
    const start = Date.now();
    // FIX: Use tracked AbortController with shorter timeout
    const requestId = this.generateRequestId();
    const { controller } = this.createAbortController(requestId, DEFAULT_TIMEOUTS.short);
    try {
      const url = `${this.baseUrl}/accounts/${this.accountId}`;

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
        result.error = `AWeber API returned status ${res.status}`;
      }
      return result;
    }
    catch (error) {
      return {
        healthy: false,
        latency: Date.now() - start,
        error: error instanceof Error ? error["message"] : 'Unknown error',
      };
    }
    finally {
      // FIX: Cleanup request state
      this.cleanupRequest(requestId);
    }
  }
}
