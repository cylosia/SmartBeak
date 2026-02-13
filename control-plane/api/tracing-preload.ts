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

initTelemetry({
  serviceName: process.env['SERVICE_NAME'] || 'smartbeak-api',
  serviceVersion: process.env['npm_package_version'] || '1.0.0',
  environment: process.env['NODE_ENV'] || 'development',
  collectorEndpoint: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] || undefined,
  enableConsoleExporter: process.env['NODE_ENV'] === 'development',
  samplingRate: parseFloat(process.env['OTEL_SAMPLING_RATE'] || '1.0'),
  autoInstrumentations: true,
});
