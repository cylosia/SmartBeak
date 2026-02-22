import { timeoutConfig } from '@config';
import { StructuredLogger, createRequestContext, MetricsCollector } from '@kernel/request';

/**
 * Standardized API error for external adapter failures.
 * Replaces ad-hoc error monkey-patching (Object.assign, `as Error & { status }`)
 * across all adapter implementations.
 */
export class AdapterApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfter?: string | undefined,
  ) {
    super(message);
    this.name = 'AdapterApiError';
  }
}

/**
 * Result of an adapter health check.
 */
export interface HealthCheckResult {
  healthy: boolean;
  latency: number;
  error?: string | undefined;
}

/**
 * Abstract base for external API adapters.
 *
 * Extracts the repetitive boilerplate shared by every adapter:
 * - StructuredLogger + MetricsCollector initialisation
 * - Method instrumentation (timing, success/error metrics, logging)
 * - Health-check scaffold with timeout
 */
export abstract class BaseExternalAdapter {
  protected readonly logger: StructuredLogger;
  protected readonly metrics: MetricsCollector;
  protected readonly timeoutMs: number;

  constructor(
    protected readonly adapterName: string,
    timeoutMs?: number,
  ) {
    this.logger = new StructuredLogger(adapterName);
    this.metrics = new MetricsCollector(adapterName);
    this.timeoutMs = timeoutMs ?? timeoutConfig.long;
  }

  /**
   * Instrument a method call with structured logging, timing, and metrics.
   *
   * Wraps the supplied function with:
   *  - createRequestContext() + info log on entry
   *  - latency recording on success/failure
   *  - success/error metric counters
   *  - error logging on failure
   */
  protected async instrumented<T>(
    method: string,
    fn: (context: ReturnType<typeof createRequestContext>) => Promise<T>,
    logPayload?: Record<string, unknown>,
  ): Promise<T> {
    const context = createRequestContext(this.adapterName, method);
    if (logPayload) {
      this.logger.info(`${method}`, context, logPayload);
    }

    const startTime = Date.now();
    try {
      const result = await fn(context);
      const latency = Date.now() - startTime;
      this.metrics.recordLatency(method, latency, true);
      this.metrics.recordSuccess(method);
      return result;
    } catch (error) {
      const latency = Date.now() - startTime;
      this.metrics.recordLatency(method, latency, false);
      this.metrics.recordError(method, error instanceof Error ? error.name : 'Unknown');
      this.logger.error(
        `Failed: ${method}`,
        context,
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }

  /**
   * Standard health-check scaffold with timeout.
   *
   * @param probe - async function that performs the actual check.
   *   Receives an AbortSignal and should return true/false or a Response.
   */
  protected async healthProbe(
    probe: (signal: AbortSignal) => Promise<boolean | Response>,
  ): Promise<HealthCheckResult> {
    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutConfig.short);

    try {
      const result = await probe(controller.signal);
      const healthy = typeof result === 'boolean' ? result : result.ok;
      const latency = Date.now() - start;
      if (healthy) {
        return { healthy, latency };
      }
      return {
        healthy,
        latency,
        error: typeof result === 'boolean'
          ? 'Health check returned false'
          : `API returned status ${result.status}`,
      };
    } catch (error) {
      return {
        healthy: false,
        latency: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Create an AdapterApiError for a rate-limited response (HTTP 429).
   * Centralizes the retry-after header extraction that every adapter duplicated.
   */
  protected createRateLimitError(
    serviceName: string,
    status: number,
    headers: { get(name: string): string | null },
  ): AdapterApiError {
    const retryAfter = headers.get('retry-after') || undefined;
    return new AdapterApiError(
      `${serviceName} rate limited: ${status}`,
      status,
      retryAfter,
    );
  }
}
