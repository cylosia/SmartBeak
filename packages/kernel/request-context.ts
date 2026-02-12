import { randomUUID } from 'crypto';

import { AsyncLocalStorage } from 'async_hooks';

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
  const context = asyncLocalStorage.getStore();
  if (!context && process.env.NODE_ENV === 'development') {
    console.warn('getRequestContext called outside of runWithContext');
  }
  return context;
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
* @param options - Optional context properties to override defaults
* @returns New request context
*/
export function createRequestContext(options?: Partial<RequestContext>): RequestContext {
  return {
  requestId: options?.requestId || randomUUID(),
  traceId: options?.["traceId"] || randomUUID(),
  spanId: randomUUID().slice(0, 16),
  userId: options?.["userId"],
  orgId: options?.["orgId"],
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
  return {
  requestId: parent?.requestId || randomUUID(),
  traceId: parent?.["traceId"] || randomUUID(),
  spanId: randomUUID().slice(0, 16),
  userId: parent?.["userId"],
  orgId: parent?.["orgId"],
  startTime: Date.now(),
  path: operation,
  method: 'child',
  };
}
