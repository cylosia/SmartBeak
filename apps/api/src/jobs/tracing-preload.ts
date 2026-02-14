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

initTelemetry({
  serviceName: process.env['SERVICE_NAME'] || 'smartbeak-worker',
  serviceVersion: process.env['npm_package_version'] || '1.0.0',
  environment: process.env['NODE_ENV'] || 'development',
  ...(process.env['OTEL_EXPORTER_OTLP_ENDPOINT']
    ? { collectorEndpoint: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] }
    : {}),
  enableConsoleExporter: process.env['NODE_ENV'] === 'development',
  samplingRate: parseFloat(process.env['OTEL_SAMPLING_RATE'] || '1.0'),
  autoInstrumentations: true,
});
