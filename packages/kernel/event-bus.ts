import { DomainEventEnvelope } from '@types/domain-event';
import { trace, context as otelContext, SpanKind, SpanStatusCode } from '@opentelemetry/api';

import { CircuitBreaker } from './retry';
import { runSafely } from './safe-handler';

/**
* Safe handler type for event handlers
*/
export type SafeHandler<T> = {
  /** Plugin name that registered the handler */
  plugin: string;
  /** Handler function */
  handle: (e: DomainEventEnvelope<T>) => Promise<void>
};

/**
* Event bus for pub/sub communication between plugins
*
* Handles event subscription, unsubscription, and publishing
* with safe handler execution and error isolation.
*/
export class EventBus {
  // P2-TYPE FIX: Replace `any` with `unknown` to enforce type safety on event handlers
  /** Map of event names to their handlers */
  private readonly handlers = new Map<string, SafeHandler<unknown>[]>();
  /** Logger instance for event bus operations */
  private readonly logger: Console;
  /** Circuit breaker for event publishing protection */
  private readonly circuitBreaker: CircuitBreaker;
  /** P2-FIX: Maximum number of handlers per event to prevent memory leaks */
  private readonly maxHandlersPerEvent = 50;

  /**
  * Create a new EventBus instance
  * @param logger - Console logger instance (defaults to console)
  */
  constructor(logger: Console = console) {
  this.logger = logger;

  this.circuitBreaker = new CircuitBreaker('EventBus', {
    failureThreshold: 10,
    resetTimeoutMs: 30000,
    halfOpenMaxCalls: 5,
  });
  }

  /**
  * Subscribe to an event
  * @param eventName - Name of the event to subscribe to
  * @param plugin - Name of the plugin subscribing
  * @param handler - Handler function for the event
  */
  subscribe<T>(eventName: string, plugin: string, handler: (e: DomainEventEnvelope<T>) => Promise<void>): void {
  // Prevent duplicate subscriptions from same plugin
  const existing = this.handlers.get(eventName) ?? [];
  const alreadySubscribed = existing.some(h => h.plugin === plugin);

  if (alreadySubscribed) {
    this.logger.warn(`[EventBus] Plugin ${plugin} already subscribed to ${eventName}, skipping`);
    return;
  }

  // P2-FIX: Enforce maximum handlers per event to prevent memory leaks
  if (existing.length >= this.maxHandlersPerEvent) {
    this.logger["error"](`[EventBus] Maximum handlers (${this.maxHandlersPerEvent}) reached for event ${eventName}. Rejecting subscription from ${plugin}`);
    throw new Error(`Maximum handlers exceeded for event: ${eventName}`);
  }

  existing.push({ plugin, handle: handler as (e: DomainEventEnvelope<unknown>) => Promise<void> });
  this.handlers.set(eventName, existing);

  this.logger.log(`[EventBus] Plugin ${plugin} subscribed to ${eventName}`);
  }

  /**
  * Unsubscribe from an event
  * @param eventName - Name of the event to unsubscribe from
  * @param plugin - Name of the plugin unsubscribing
  */
  unsubscribe<_T>(eventName: string, plugin: string): void {
  const existing = this.handlers.get(eventName);
  if (!existing) return;

  const filtered = existing.filter(h => h.plugin !== plugin);
  this.handlers.set(eventName, filtered);

  this.logger.log(`[EventBus] Plugin ${plugin} unsubscribed from ${eventName}`);
  }

  /**
  * Get all registered handlers
  * @returns Copy of the handlers map
  */
  // P2-CONCURRENCY FIX: Deep copy to prevent callers from mutating internal handler arrays
  getHandlers(): Map<string, SafeHandler<unknown>[]> {
  return new Map([...this.handlers].map(([k, v]) => [k, [...v]]));
  }

  /**
  * Publish an event to all subscribers

  * @param event - Event envelope to publish
  * @returns Promise that resolves when all handlers have executed
  */
  async publish<T>(event: DomainEventEnvelope<T>): Promise<void> {
  const handlers = this.handlers.get(event.name) ?? [];

  if (handlers.length === 0) {
    this.logger.warn(`[EventBus] No handlers for event: ${event.name}`);
    return;
  }

  // Create a span for the publish operation (non-critical — wrapped in try/catch)
  let publishSpan: ReturnType<ReturnType<typeof trace.getTracer>['startSpan']> | undefined;
  let tracer: ReturnType<typeof trace.getTracer> | undefined;
  try {
    tracer = trace.getTracer('smartbeak-eventbus', '1.0.0');
    publishSpan = tracer.startSpan(`eventbus.publish ${event.name}`, {
      kind: SpanKind.PRODUCER,
      attributes: {
        'eventbus.event_name': event.name,
        'eventbus.handler_count': handlers.length,
      },
    });
  } catch {
    // OTel not available — proceed without tracing
  }

  try {
    await this.circuitBreaker.execute(async () => {
    const results = await Promise.allSettled(
    handlers.map(({ plugin, handle }) => {
        // Create child span per handler
        let handlerSpan: ReturnType<ReturnType<typeof trace.getTracer>['startSpan']> | undefined;
        try {
          if (tracer && publishSpan) {
            const ctx = trace.setSpan(otelContext.active(), publishSpan);
            handlerSpan = tracer.startSpan(`eventbus.handle ${event.name}`, {
              kind: SpanKind.CONSUMER,
              attributes: {
                'eventbus.handler_plugin': plugin,
                'eventbus.event_name': event.name,
              },
            }, ctx);
          }
        } catch {
          // Continue without span
        }

        return runSafely(plugin, event.name, () => handle(event), async (f) => {
          this.logger["error"]('[EventBus] Plugin failure:', f);
        }).then(() => {
          handlerSpan?.setStatus({ code: SpanStatusCode.OK });
          handlerSpan?.end();
        }).catch((err) => {
          handlerSpan?.setStatus({
            code: SpanStatusCode.ERROR,
            message: err instanceof Error ? err.message : String(err),
          });
          if (err instanceof Error) handlerSpan?.recordException(err);
          handlerSpan?.end();
          throw err;
        });
    })
    );

    // Log any failures
    results.forEach((result, index) => {
    if (result.status === 'rejected') {
    this.logger["error"](
        `[EventBus] Handler ${handlers[index]!.plugin} failed for ${event.name}:`,
        result.reason
    );
    }
    });

    // If all handlers failed, throw to trigger circuit breaker
    const allFailed = results.every(r => r.status === 'rejected');
    if (allFailed && results.length > 0) {
    throw new Error(`All handlers failed for event: ${event.name}`);
    }
    });

    publishSpan?.setStatus({ code: SpanStatusCode.OK });
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    publishSpan?.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    publishSpan?.recordException(err);
    this.logger["error"](`[EventBus] Circuit breaker error for ${event.name}:`, err["message"]);
    throw error;
  } finally {
    publishSpan?.end();
  }
  }

  /**
  * Clear all handlers (useful for testing)
  */
  clear(): void {
  this.handlers.clear();
  }
}
