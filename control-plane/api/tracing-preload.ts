/**
 * Tracing Preload Module
 *
 * MUST be loaded before any instrumented libraries (fastify, pg, ioredis).
 * This module initializes OpenTelemetry so that monkey-patching happens
 * before the libraries are imported by http.ts.
 *
 * Usage: tsx --import ./control-plane/api/tracing-preload.ts control-plane/api/http.ts
 */
import { initTelemetry } from '@smartbeak/monitoring';

// FIXED (PRELOAD-1): Clamp and validate sampling rate.
// parseFloat('abc') → NaN; NaN < samplingRate check → always false → 0% sampling (silent blind-spot).
// Values outside [0,1] are clamped rather than rejected to allow gradual rollout configurations.
const rawRate = parseFloat(process.env['OTEL_SAMPLING_RATE'] || '1.0');
const samplingRate = Number.isFinite(rawRate) ? Math.max(0, Math.min(1, rawRate)) : 1.0;
if (!Number.isFinite(rawRate)) {
  console.error(`[tracing-preload] Invalid OTEL_SAMPLING_RATE="${process.env['OTEL_SAMPLING_RATE']}", defaulting to 1.0`);
}

// FIXED (PRELOAD-2): Wrap in try/catch — an invalid OTLP endpoint URL or exporter
// initialisation error must NOT crash the API server at startup.
try {
  initTelemetry({
    serviceName: process.env['SERVICE_NAME'] || 'smartbeak-api',
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
  // Tracing is non-critical infrastructure — log and continue without it
  console.error('[tracing-preload] Failed to initialize telemetry, continuing without tracing:', err);
}
