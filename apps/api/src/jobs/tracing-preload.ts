/**
 * Tracing Preload Module for Background Worker
 *
 * MUST be loaded before any instrumented libraries (pg, ioredis, bullmq).
 * This module initializes OpenTelemetry so that monkey-patching happens
 * before the libraries are imported by worker.ts.
 *
 * Usage: tsx --import ./apps/api/src/jobs/tracing-preload.ts apps/api/src/jobs/worker.ts
 */
import { initTelemetry } from '@smartbeak/monitoring';

// FIXED (TP-1): Clamp and validate sampling rate.
// parseFloat('abc') → NaN; NaN comparison → always false → 0% sampling (silent blind-spot).
const rawRate = parseFloat(process.env['OTEL_SAMPLING_RATE'] || '1.0');
const samplingRate = Number.isFinite(rawRate) ? Math.max(0, Math.min(1, rawRate)) : 1.0;
if (!Number.isFinite(rawRate)) {
  console.error(`[tracing-preload] Invalid OTEL_SAMPLING_RATE="${process.env['OTEL_SAMPLING_RATE']}", defaulting to 1.0`);
}

// FIXED (TP-3): Wrap in try/catch — an invalid OTLP endpoint or exporter init error
// must NOT crash the entire background job worker process at startup.
try {
  initTelemetry({
    serviceName: process.env['SERVICE_NAME'] || 'smartbeak-worker',
    serviceVersion: process.env['npm_package_version'] || '1.0.0',
    environment: process.env['NODE_ENV'] || 'development',
    ...(process.env['OTEL_EXPORTER_OTLP_ENDPOINT']
      ? { collectorEndpoint: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] }
      : {}),
    enableConsoleExporter: process.env['NODE_ENV'] === 'development',
    samplingRate,
    autoInstrumentations: true,
  });
} catch (err) {
  // Tracing is non-critical — log and continue so jobs keep processing
  console.error('[tracing-preload] Failed to initialize telemetry, continuing without tracing:', err);
}
