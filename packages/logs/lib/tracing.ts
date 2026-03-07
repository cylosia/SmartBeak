import { randomUUID } from "node:crypto";
import { logger } from "./logger";

interface SpanContext {
	traceId: string;
	spanId: string;
	operation: string;
	attributes: Record<string, unknown>;
	startTime: number;
}

/**
 * Lightweight structured tracing layer.
 *
 * Emits JSON log entries compatible with OpenTelemetry semantic conventions,
 * making them parseable by any OTel-compatible log collector (Datadog,
 * Grafana Loki, etc.) without requiring the full OTel SDK.
 *
 * When a full OTel SDK is added later, replace these with real spans.
 */
export function startSpan(
	operation: string,
	attributes: Record<string, unknown> = {},
	parentTraceId?: string,
): SpanContext {
	const span: SpanContext = {
		traceId: parentTraceId ?? randomUUID(),
		spanId: randomUUID(),
		operation,
		attributes,
		startTime: performance.now(),
	};

	logger.info("[trace:start]", {
		traceId: span.traceId,
		spanId: span.spanId,
		operation,
		...attributes,
	});

	return span;
}

export function endSpan(
	span: SpanContext,
	result: "ok" | "error" = "ok",
	extra: Record<string, unknown> = {},
): void {
	const durationMs = Math.round(performance.now() - span.startTime);

	logger.info("[trace:end]", {
		traceId: span.traceId,
		spanId: span.spanId,
		operation: span.operation,
		durationMs,
		result,
		...span.attributes,
		...extra,
	});
}

/**
 * Wraps an async function in a trace span.
 * Automatically records duration, result status, and any error message.
 */
export async function withSpan<T>(
	operation: string,
	attributes: Record<string, unknown>,
	fn: (span: SpanContext) => Promise<T>,
	parentTraceId?: string,
): Promise<T> {
	const span = startSpan(operation, attributes, parentTraceId);
	try {
		const result = await fn(span);
		endSpan(span, "ok");
		return result;
	} catch (error) {
		endSpan(span, "error", {
			errorMessage:
				error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}
