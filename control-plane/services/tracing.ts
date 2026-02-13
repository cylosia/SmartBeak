/**
 * OpenTelemetry tracing initialization
 *
 * Delegates to the shared monitoring package's telemetry module.
 * The preload module (tracing-preload.ts) handles actual initialization
 * before any instrumented libraries are imported.
 *
 * This module exists for backward compatibility with any code that imports it.
 */
import { isTelemetryInitialized, initTelemetry } from '@smartbeak/monitoring';
import { getLogger } from '@kernel/logger';

const logger = getLogger('tracing');

/**
 * Initialize distributed tracing
 * @deprecated Use tracing-preload.ts or initMonitoring() instead.
 * This function is a no-op if telemetry is already initialized via the preload.
 */
export function initTracing(): void {
  if (isTelemetryInitialized()) {
    logger.info('Telemetry already initialized via preload, skipping initTracing()');
    return;
  }

  // Fallback: initialize with defaults if preload was not used
  try {
    initTelemetry({
      serviceName: process.env['SERVICE_NAME'] || 'smartbeak-api',
      serviceVersion: '1.0.0',
      environment: process.env['NODE_ENV'] || 'development',
      enableConsoleExporter: true,
      samplingRate: 1.0,
    });
  } catch (error) {
    logger.error('Failed to initialize tracing', error instanceof Error ? error : new Error(String(error)));
  }
}
