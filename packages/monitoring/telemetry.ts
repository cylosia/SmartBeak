/**
 * OpenTelemetry Distributed Tracing Module
 * 
 * Provides comprehensive tracing capabilities:
 * - OpenTelemetry instrumentation setup
 * - Trace context propagation across services
 * - Span annotations for key operations
 * - Trace export to collector
 */

import {
  NodeTracerProvider,
} from '@opentelemetry/sdk-trace-node';
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  SpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from '@opentelemetry/semantic-conventions';
import {
  context,
  trace,
  Span,
  SpanStatusCode,
  SpanKind,
  Context,
  propagation,
  ROOT_CONTEXT,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { FastifyInstrumentation } from '@opentelemetry/instrumentation-fastify';

import { getLogger } from '@kernel/logger';

const logger = getLogger('telemetry');

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Telemetry configuration options
 */
export interface TelemetryConfig {
  /** Service name for tracing */
  serviceName: string;
  /** Service version */
  serviceVersion?: string;
  /** Deployment environment */
  environment?: string;
  /** OTLP collector endpoint */
  collectorEndpoint?: string | undefined;
  /** Enable console exporter (for debugging) */
  enableConsoleExporter?: boolean;
  /** Sampling rate (0.0 to 1.0) */
  samplingRate?: number;
  /** Enable automatic instrumentations */
  autoInstrumentations?: boolean;
  /** Additional resource attributes */
  resourceAttributes?: Record<string, string>;
}

/**
 * Span annotation options
 */
export interface SpanAnnotation {
  /** Event name */
  name: string;
  /** Event attributes */
  attributes?: Record<string, unknown>;
  /** Event timestamp */
  timestamp?: number;
}

/**
 * Traced operation options
 */
export interface TracedOperationOptions {
  /** Span name */
  spanName: string;
  /** Span kind */
  kind?: 'internal' | 'server' | 'client' | 'producer' | 'consumer';
  /** Initial attributes */
  attributes?: Record<string, unknown>;
  /** Parent context (for cross-service propagation) */
  parentContext?: Context;
}

// Type definitions for instrumentation hooks
interface HttpRequest {
  headers: Record<string, string | string[] | undefined>;
}

interface HttpResponse {
  headers: Record<string, string | string[] | undefined>;
}

// ============================================================================
// Global State
// ============================================================================

let tracerProvider: NodeTracerProvider | null = null;
let isInitialized = false;

/**
 * Get the global tracer provider
 */
export function getTracerProvider(): NodeTracerProvider | null {
  return tracerProvider;
}

/**
 * Check if telemetry is initialized
 */
export function isTelemetryInitialized(): boolean {
  return isInitialized;
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize OpenTelemetry tracing
 * @param config - Telemetry configuration
 */
export function initTelemetry(config: TelemetryConfig): void {
  if (isInitialized) {
    logger.warn('Telemetry already initialized, skipping');
    return;
  }

  try {
    // Create resource with service information
    const resource = new Resource({
      [SEMRESATTRS_SERVICE_NAME]: config.serviceName,
      [SEMRESATTRS_SERVICE_VERSION]: config.serviceVersion || '1.0.0',
      [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: config.environment || 'development',
      ...config.resourceAttributes,
    });

    // P1-4 FIX: Validate samplingRate before use. parseFloat() of a non-numeric
    // env var returns NaN, and Math.random() < NaN is always false — meaning 0%
    // of traces would be sampled with zero indication of the misconfiguration.
    const rawRate = config.samplingRate ?? 1.0;
    const samplingRate = Number.isFinite(rawRate) && rawRate >= 0 && rawRate <= 1
      ? rawRate
      : (() => {
          logger.warn('Invalid samplingRate — must be a finite number in [0, 1]. Defaulting to 1.0.', { rawRate });
          return 1.0;
        })();

    // Configure provider
    const providerConfig: ConstructorParameters<typeof NodeTracerProvider>[0] = {
      resource,
      sampler: {
        shouldSample: () => ({
          decision: Math.random() < samplingRate ? 1 : 0,
          attributes: {},
        }),
        toString: () => `ProbabilitySampler(${samplingRate})`,
      },
    };

    tracerProvider = new NodeTracerProvider(providerConfig);

    // Configure exporters
    const exporters: SpanExporter[] = [];

    // OTLP HTTP exporter
    if (config.collectorEndpoint) {
      const otlpExporter = new OTLPTraceExporter({
        url: config.collectorEndpoint,
      });
      exporters.push(otlpExporter);
      tracerProvider.addSpanProcessor(new BatchSpanProcessor(otlpExporter));
    }

    // Console exporter for debugging
    if (config.enableConsoleExporter || !config.collectorEndpoint) {
      const consoleExporter = new ConsoleSpanExporter();
      tracerProvider.addSpanProcessor(new SimpleSpanProcessor(consoleExporter));
    }

    // Register provider
    tracerProvider.register();

    // Set global propagator for trace context propagation
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());

    // Register automatic instrumentations
    if (config.autoInstrumentations !== false) {
      registerInstrumentations({
        instrumentations: [
          new HttpInstrumentation({
            // P2-1 FIX: Removed `as never` type escape. The hooks use type inference
            // from the OTel library's own parameter types (letting TS infer `span`
            // and `request`/`response`), then access headers via a safe cast to the
            // known header shape. This eliminates the `as never` assertion while
            // keeping the header access type-safe at the boundary we control.
            requestHook: (span, request) => {
              const headers = (request as { headers: Record<string, string | string[] | undefined> }).headers;
              span.setAttribute('http.request.body.size', headers['content-length'] || 0);
            },
            responseHook: (span, response) => {
              const headers = (response as { headers: Record<string, string | string[] | undefined> }).headers;
              span.setAttribute('http.response.body.size', headers['content-length'] || 0);
            },
          }),
          new PgInstrumentation({
            enhancedDatabaseReporting: true,
          }),
          new IORedisInstrumentation({
            dbStatementSerializer: (cmd: string, args: unknown[]) => {
              // Sanitize arguments - don't include sensitive data
              return `${cmd} [${args.length} args]`;
            },
          }),
          new FastifyInstrumentation(),
        ],
      });
    }

    isInitialized = true;
    logger.info('OpenTelemetry tracing initialized', {
      serviceName: config.serviceName,
      environment: config.environment,
      collectorEndpoint: config.collectorEndpoint,
    });
  } catch (error) {
    // P2-11 FIX: Don't re-throw — telemetry is non-critical infrastructure.
    // A failure should not crash the application.
    logger.error('Failed to initialize telemetry', error as Error);
    isInitialized = false;
    tracerProvider = null;
  }
}

/**
 * Shutdown telemetry and flush pending spans
 */
export async function shutdownTelemetry(): Promise<void> {
  if (!tracerProvider) {
    return;
  }

  try {
    await tracerProvider.shutdown();
    isInitialized = false;
    tracerProvider = null;
    logger.info('Telemetry shutdown complete');
  } catch (error) {
    logger.error('Error during telemetry shutdown', error as Error);
    throw error;
  }
}

// ============================================================================
// Trace Context Propagation
// ============================================================================

/**
 * Extract trace context from incoming request headers
 * @param headers - HTTP headers
 * @returns Extracted context or undefined
 */
export function extractTraceContext(
  headers: Record<string, string | string[] | undefined>
): Context {
  const carrier: Record<string, string> = {};
  
  // Normalize headers to lowercase
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      carrier[key.toLowerCase()] = value;
    } else if (Array.isArray(value)) {
      carrier[key.toLowerCase()] = value.join(', ');
    }
  }

  return propagation.extract(ROOT_CONTEXT, carrier);
}

/**
 * Inject trace context into outgoing request headers
 * @param context - Current context
 * @returns Headers with trace context
 */
export function injectTraceContext(ctx?: Context): Record<string, string> {
  const currentContext = ctx || context.active();
  const carrier: Record<string, string> = {};
  
  propagation.inject(currentContext, carrier);
  
  return carrier;
}

/**
 * Get current trace ID from context
 * @returns Trace ID or undefined
 */
export function getCurrentTraceId(): string | undefined {
  const span = trace.getSpan(context.active());
  return span?.spanContext().traceId;
}

/**
 * Get current span ID from context
 * @returns Span ID or undefined
 */
export function getCurrentSpanId(): string | undefined {
  const span = trace.getSpan(context.active());
  return span?.spanContext().spanId;
}

// ============================================================================
// Span Operations
// ============================================================================

/**
 * Get or create a tracer
 */
function getTracer() {
  return trace.getTracer('smartbeak-monitoring', '1.0.0');
}

// Map string kind to SpanKind enum
const spanKindMap: Record<string, SpanKind> = {
  internal: SpanKind.INTERNAL,
  server: SpanKind.SERVER,
  client: SpanKind.CLIENT,
  producer: SpanKind.PRODUCER,
  consumer: SpanKind.CONSUMER,
};

/**
 * Start a new span
 * @param name - Span name
 * @param options - Span options
 * @returns Span instance
 */
export function startSpan(
  name: string,
  options?: {
    kind?: TracedOperationOptions['kind'];
    attributes?: Record<string, unknown>;
    parentContext?: Context;
  }
): Span {
  const tracer = getTracer();
  const spanOptions: Parameters<typeof tracer.startSpan>[1] = {};
  
  if (options?.kind) {
    const kind = spanKindMap[options.kind];
    if (kind !== undefined) {
      spanOptions.kind = kind;
    }
  }
  if (options?.attributes) {
    spanOptions.attributes = options.attributes as Record<string, AttributeValue>;
  }

  const ctx = options?.parentContext || context.active();
  return tracer.startSpan(name, spanOptions, ctx);
}

/**
 * Execute a function within a span
 * @param options - Operation options
 * @param fn - Function to execute
 * @returns Function result
 */
export async function withSpan<T>(
  options: TracedOperationOptions,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const spanOptions: { kind?: TracedOperationOptions['kind']; attributes?: Record<string, unknown>; parentContext?: Context } = {};
  if (options.kind !== undefined) spanOptions.kind = options.kind;
  if (options.attributes !== undefined) spanOptions.attributes = options.attributes;
  if (options.parentContext !== undefined) spanOptions.parentContext = options.parentContext;
  
  const span = startSpan(options.spanName, spanOptions);

  const ctx = trace.setSpan(options.parentContext || context.active(), span);

  try {
    const result = await context.with(ctx, () => fn(span));
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    span.recordException(error as Error);
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Add annotation/event to current span
 * @param annotation - Annotation details
 */
export function addSpanAnnotation(annotation: SpanAnnotation): void {
  const span = trace.getSpan(context.active());
  if (!span) {
    logger.debug('No active span for annotation', { name: annotation.name });
    return;
  }

  span.addEvent(annotation.name, annotation.attributes as Record<string, AttributeValue> | undefined, annotation.timestamp);
}

/**
 * Add attributes to current span
 * @param attributes - Attributes to add
 */
export function addSpanAttributes(attributes: Record<string, unknown>): void {
  const span = trace.getSpan(context.active());
  if (!span) {
    logger.debug('No active span for attributes');
    return;
  }

  Object.entries(attributes).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      span.setAttribute(key, value as AttributeValue);
    }
  });
}

/**
 * Record exception in current span
 * @param error - Error to record
 * @param attributes - Additional attributes
 */
export function recordSpanException(
  error: Error,
  attributes?: Record<string, unknown>
): void {
  const span = trace.getSpan(context.active());
  if (!span) {
    logger.debug('No active span for exception', { error: error.message });
    return;
  }

  span.recordException(error);
  if (attributes) {
    addSpanAttributes(attributes);
  }
}

/**
 * Set span status
 * @param code - Status code
 * @param message - Optional message
 */
export function setSpanStatus(
  code: 'ok' | 'error',
  message?: string
): void {
  const span = trace.getSpan(context.active());
  if (!span) {
    return;
  }

  const status: { code: SpanStatusCode; message?: string } = {
    code: code === 'ok' ? SpanStatusCode.OK : SpanStatusCode.ERROR,
  };
  if (message !== undefined) {
    status.message = message;
  }
  span.setStatus(status);
}

// ============================================================================
// Decorator-style Tracing (for manual instrumentation)
// ============================================================================

/**
 * Trace an **async** class method.
 *
 * P1-2 FIX: This decorator ONLY works correctly on methods that already return
 * a Promise. Applying it to a synchronous method silently changes the return
 * type from T to Promise<T>, breaking callers that expect a synchronous value.
 * TypeScript cannot detect this mismatch through PropertyDescriptor.
 *
 * If you need to trace a synchronous method, wrap its body manually with
 * withSpan() instead of using this decorator.
 *
 * P2-15 FIX: Removed JSON.stringify(args.map(typeof)) from the hot path.
 * On high-throughput methods this created measurable overhead per call.
 * Argument shape information is available in the span attributes (args.count).
 *
 * @param spanName - Optional custom span name (defaults to ClassName.methodName)
 * @param attributes - Static attributes added to every span
 */
export function Trace(
  spanName?: string,
  attributes: Record<string, unknown> = {}
) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const originalMethod: (...args: unknown[]) => Promise<unknown> = descriptor.value;
    const name = spanName || `${target.constructor.name}.${propertyKey}`;

    // Guard: warn loudly at decoration time if the original is not async.
    // This runs once at class-definition time, not per call.
    if (originalMethod.constructor.name !== 'AsyncFunction') {
      // eslint-disable-next-line no-console
      console.warn(
        `[Trace] @Trace applied to non-async method "${String(target.constructor.name)}.${propertyKey}". ` +
        'The decorated method will return Promise<T> instead of T. ' +
        'Use withSpan() directly for synchronous methods.'
      );
    }

    descriptor.value = async function (...args: unknown[]) {
      return withSpan(
        {
          spanName: name,
          kind: 'internal',
          attributes: {
            ...attributes,
            'method.name': propertyKey,
            'method.args.count': args.length,
          },
        },
        async (_span) => {
          const result = await originalMethod.apply(this, args);
          return result;
        }
      );
    };

    return descriptor;
  };
}

// ============================================================================
// Utility Types
// ============================================================================

type AttributeValue = string | number | boolean | Array<string> | Array<number> | Array<boolean>;
