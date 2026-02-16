import { randomUUID } from 'crypto';

import { AsyncLocalStorage } from 'async_hooks';
import { context as otelContext, trace } from '@opentelemetry/api';

/**
* Request Context Module
* Provides request ID propagation and context management
*
* MEDIUM FIX M4: Request ID propagation across services
*/

export interface RequestContext {
  requestId: string;
  traceId?: string | undefined;
  spanId?: string | undefined;
  userId?: string | undefined;
  orgId?: string | undefined;
  startTime: number;
  path?: string | undefined;
  method?: string | undefined;
}

// AsyncLocalStorage for automatic context propagation
const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

/**
* Storage instance for request context
* Exported for advanced use cases
*/
export const requestContextStorage = asyncLocalStorage;

/**
* Get current request context
* @returns Current request context or undefined if not in a context
*/
export function getRequestContext(): RequestContext | undefined {
  return asyncLocalStorage.getStore();
}

/**
* Run function within a request context
* @param context - Request context to use
* @param fn - Function to execute
* @returns Promise that resolves with the function result
*/
export function runWithContext<T>(context: RequestContext, fn: () => Promise<T>): Promise<T> {
  return asyncLocalStorage.run(context, fn);
}

/**
* Generate new request context
* Bridges OTel trace context when available, falling back to random UUIDs.
* @param options - Optional context properties to override defaults
* @returns New request context
*/
export function createRequestContext(options?: Partial<RequestContext>): RequestContext {
  // Bridge trace/span IDs from the OTel active span when available.
  // This ensures loggers and error reporters see the same IDs as OTel spans.
  let otelTraceId: string | undefined;
  let otelSpanId: string | undefined;

  try {
    const activeSpan = trace.getSpan(otelContext.active());
    if (activeSpan) {
      const spanCtx = activeSpan.spanContext();
      if (spanCtx.traceId && spanCtx.traceId !== '00000000000000000000000000000000') {
        otelTraceId = spanCtx.traceId;
        otelSpanId = spanCtx.spanId;
      }
    }
  } catch {
    // OTel not available or not initialized — fall through to random IDs
  }

  return {
    requestId: options?.requestId || randomUUID(),
    traceId: options?.traceId || otelTraceId || randomUUID(),
    spanId: otelSpanId || randomUUID().slice(0, 16),
    userId: options?.userId,
    orgId: options?.orgId,
    startTime: Date.now(),
    path: options?.path,
    method: options?.method,
  };
}

/**
* Get request ID from current context or generate new one
* @returns Request ID from context or newly generated UUID
*/
export function getRequestId(): string {
  return getRequestContext()?.requestId || randomUUID();
}

/**
* Get elapsed time since request started
* @returns Elapsed time in milliseconds, or 0 if no context
*/
export function getElapsedMs(): number {
  const context = getRequestContext();
  if (!context) return 0;
  return Date.now() - context.startTime;
}

/**
* Create child context for nested operations
* @param operation - Name of the child operation
* @returns New child context with inherited parent properties
*/
export function createChildContext(operation: string): RequestContext {
  const parent = getRequestContext();

  let otelSpanId: string | undefined;
  try {
    const activeSpan = trace.getSpan(otelContext.active());
    if (activeSpan) {
      otelSpanId = activeSpan.spanContext().spanId;
    }
  } catch {
    // OTel not available
  }

  return {
    requestId: parent?.requestId || randomUUID(),
    traceId: parent?.traceId || randomUUID(),
    spanId: otelSpanId || randomUUID().slice(0, 16),
    userId: parent?.userId,
    orgId: parent?.orgId,
    startTime: Date.now(),
    path: operation,
    method: 'child',
  };
}
