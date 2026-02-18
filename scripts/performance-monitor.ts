/**
 * Performance Monitoring Script
 * 
 * P2 OPTIMIZATION: Monitors system performance metrics and reports alerts
 * Run this as a background service for continuous monitoring
 */

import { getGlobalCache, PerformanceMonitor, generatePerformanceReport } from '../packages/cache';
import { getLogger } from '../packages/kernel/logger';

const logger = getLogger('PerformanceMonitor');

// ============================================================================
// Configuration
// ============================================================================

const MONITOR_CONFIG = {
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  sampleIntervalMs: parseInt(process.env.MONITOR_INTERVAL_MS || '60000', 10), // 1 minute
  alertWebhook: process.env.ALERT_WEBHOOK_URL,
  thresholds: {
    minCacheHitRate: parseFloat(process.env.MIN_CACHE_HIT_RATE || '0.8'),
    maxQueryTimeMs: parseInt(process.env.MAX_QUERY_TIME_MS || '1000', 10),
    maxMemoryPercent: parseInt(process.env.MAX_MEMORY_PERCENT || '85', 10),
    maxLatencyMs: parseInt(process.env.MAX_LATENCY_MS || '500', 10),
  },
};

// ============================================================================
// Alert Handlers
// ============================================================================

/**
 * Validate that a webhook URL is safe to send alerts to.
 * P1-FIX: ALERT_WEBHOOK_URL was previously used in fetch() with no validation.
 * An operator who misconfigures this variable with an internal address (e.g.
 * AWS IMDS 169.254.169.254, internal DB host) would cause the monitoring
 * script to exfiltrate alert payloads to those services (SSRF).
 * Allow only https:// URLs to non-private, non-loopback hosts.
 */
function validateWebhookUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`ALERT_WEBHOOK_URL is not a valid URL: ${url}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`ALERT_WEBHOOK_URL must use HTTPS, got: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  // Strip IPv6 brackets so "[::1]" becomes "::1" for comparison.
  const bare = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;

  const blockedHosts = ['localhost', '127.0.0.1', '::1', '0.0.0.0', '169.254.169.254', '169.254.170.2'];
  if (
    blockedHosts.includes(bare) ||
    /^10\./.test(bare) ||
    /^192\.168\./.test(bare) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(bare) ||
    /^169\.254\./.test(bare) ||
    /^::1$/.test(bare) ||
    /^fe[89ab][0-9a-f]:/i.test(bare) ||
    /^fc[0-9a-f]{2}:/i.test(bare) ||
    /^fd[0-9a-f]{2}:/i.test(bare)
  ) {
    throw new Error(`ALERT_WEBHOOK_URL points to a private/reserved address: ${bare}`);
  }
}

// Validate alert webhook URL at startup (fail fast before monitoring begins).
if (MONITOR_CONFIG.alertWebhook) {
  validateWebhookUrl(MONITOR_CONFIG.alertWebhook);
}

async function sendWebhookAlert(alert: {
  type: string;
  severity: string;
  message: string;
  metric: string;
  value: number;
  threshold: number;
}): Promise<void> {
  if (!MONITOR_CONFIG.alertWebhook) {
    logger.info('Alert triggered', {
      severity: alert.severity,
      type: alert.type,
      message: alert.message,
      metric: alert.metric,
      value: alert.value,
      threshold: alert.threshold
    });
    if (process.env['CLI_MODE']) {
      console.log(`[Alert] ${alert.severity.toUpperCase()}: ${alert.message}`);
    }
    return;
  }

  try {
    const response = await fetch(MONITOR_CONFIG.alertWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...alert,
        timestamp: new Date().toISOString(),
        service: 'smartbeak',
      }),
    });

    if (!response.ok) {
      logger.error('Failed to send webhook alert', undefined, { 
        status: response.status, 
        statusText: response.statusText 
      });
    }
  } catch (error) {
    logger.error('Webhook alert error', error instanceof Error ? error : undefined, { 
      alertType: alert.type 
    });
  }
}

function onAlert(alert: {
  type: string;
  severity: string;
  message: string;
  metric: string;
  value: number;
  threshold: number;
}): void {
  // Log structured alert
  logger.warn('Performance alert triggered', {
    type: alert.type,
    severity: alert.severity,
    message: alert.message,
    metric: alert.metric,
    value: alert.value,
    threshold: alert.threshold,
  });

  // CLI output for user-facing messages
  if (process.env['CLI_MODE']) {
    const emoji = alert.severity === 'critical' ? '🔴' : alert.severity === 'warning' ? '🟡' : '🔵';
    console.log(`${emoji} [${alert.type.toUpperCase()}] ${alert.message}`);
    console.log(`   Metric: ${alert.metric} = ${alert.value} (threshold: ${alert.threshold})`);
  }

  // Send webhook
  sendWebhookAlert(alert).catch((err) => logger.error('Send webhook alert failed', err));
}

function onMetrics(metrics: {
  timestamp: number;
  cache: {
    l1HitRate: number;
    l2HitRate: number;
    overallHitRate: number;
    totalRequests: number;
  };
  memory: {
    percentUsed: number;
    heapUsed: number;
    heapTotal: number;
  };
  latency: {
    p50: number;
    p95: number;
    p99: number;
    avg: number;
  };
}): void {
  // Log structured metrics
  logger.info('Performance metrics collected', {
    timestamp: metrics.timestamp,
    cache: metrics.cache,
    memory: metrics.memory,
    latency: metrics.latency,
  });

  // CLI output for user-facing summary
  if (process.env['CLI_MODE']) {
    console.log('');
    console.log('─'.repeat(50));
    console.log(`Performance Metrics - ${new Date(metrics.timestamp).toISOString()}`);
    console.log('─'.repeat(50));
    console.log(`Cache Hit Rate: ${(metrics.cache.overallHitRate * 100).toFixed(1)}% (L1: ${(metrics.cache.l1HitRate * 100).toFixed(1)}%, L2: ${(metrics.cache.l2HitRate * 100).toFixed(1)}%)`);
    console.log(`Memory Usage: ${metrics.memory.percentUsed.toFixed(1)}% (${formatBytes(metrics.memory.heapUsed)} / ${formatBytes(metrics.memory.heapTotal)})`);
    console.log(`Latency: P50=${metrics.latency.p50.toFixed(2)}ms, P95=${metrics.latency.p95.toFixed(2)}ms, P99=${metrics.latency.p99.toFixed(2)}ms`);
    console.log('─'.repeat(50));
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

// ============================================================================
// Main Execution
// ============================================================================

async function main(): Promise<void> {
  // CLI header output
  if (process.env['CLI_MODE']) {
    console.log('=================================');
    console.log('Performance Monitoring Service');
    console.log('=================================');
    console.log('');
  }

  logger.info('Starting performance monitoring service');

  try {
    // Initialize cache for monitoring
    logger.info('Initializing cache for monitoring');
    const cache = getGlobalCache({
      l1MaxSize: 100,
      l1TtlMs: 10000,
      keyPrefix: 'monitor:',
    });

    try {
      await cache.initializeRedis(MONITOR_CONFIG.redisUrl);
      logger.info('Redis connection established');
    } catch (error) {
      logger.warn('Redis not available, using memory cache only', { 
        redisUrl: MONITOR_CONFIG.redisUrl,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Create and start monitor
    logger.info('Starting performance monitor', { 
      sampleIntervalMs: MONITOR_CONFIG.sampleIntervalMs,
      thresholds: MONITOR_CONFIG.thresholds
    });
    const monitor = new PerformanceMonitor(cache, {
      enabled: true,
      sampleIntervalMs: MONITOR_CONFIG.sampleIntervalMs,
      thresholds: MONITOR_CONFIG.thresholds,
      onAlert,
      onMetrics,
    });

    monitor.start();

    logger.info('Performance monitor started successfully');

    // CLI configuration output
    if (process.env['CLI_MODE']) {
      console.log('');
      console.log('Monitoring Configuration:');
      console.log(`  Sample Interval: ${MONITOR_CONFIG.sampleIntervalMs}ms`);
      console.log(`  Min Cache Hit Rate: ${(MONITOR_CONFIG.thresholds.minCacheHitRate * 100).toFixed(0)}%`);
      console.log(`  Max Query Time: ${MONITOR_CONFIG.thresholds.maxQueryTimeMs}ms`);
      console.log(`  Max Memory: ${MONITOR_CONFIG.thresholds.maxMemoryPercent}%`);
      console.log(`  Max Latency: ${MONITOR_CONFIG.thresholds.maxLatencyMs}ms`);
      console.log('');
      console.log('Press Ctrl+C to stop');
      console.log('');
    }

    // Simulate some operations for demonstration
    logger.info('Simulating cache operations for demonstration');
    
    // Simulate cache hits and misses
    // P0-FIX: Wrap async interval body in try-catch. setInterval does not await
    // the async callback — an unhandled rejection from getOrCompute would crash
    // the process in Node.js. Errors are logged and the simulation continues.
    const simulationInterval = setInterval(() => {
      (async () => {
        await cache.getOrCompute('test-key-1', async () => ({ data: 'test' }), {
          l1TtlMs: 5000,
          l2TtlSeconds: 10,
        });

        await cache.getOrCompute('test-key-2', async () => ({ data: 'test2' }), {
          l1TtlMs: 5000,
          l2TtlSeconds: 10,
        });
      })().catch((error: unknown) => {
        logger.error('Simulation interval error', error instanceof Error ? error : undefined);
      });
    }, 1000).unref();

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down performance monitor');
      clearInterval(simulationInterval);
      monitor.stop();
      await cache.close();

      const finalReport = generatePerformanceReport(monitor.getMetrics());
      logger.info('Final performance report', { report: finalReport });

      if (process.env['CLI_MODE']) {
        console.log('\n');
        console.log('Final Performance Report:');
        console.log(finalReport);
        console.log('\n[Monitor] Goodbye!');
      }
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Shutting down performance monitor (SIGTERM)');
      clearInterval(simulationInterval);
      monitor.stop();
      await cache.close();
      logger.info('Performance monitor stopped');
      if (process.env['CLI_MODE']) {
        console.log('[Monitor] Goodbye!');
      }
      process.exit(0);
    });

    // Keep process alive
    await new Promise(() => {});

  } catch (error) {
    logger.error('Performance monitor error', error instanceof Error ? error : undefined);
    process.exit(1);
  }
}

// ============================================================================
// CLI Commands
// ============================================================================

function printUsage(): void {
  console.log('Usage: tsx scripts/performance-monitor.ts [options]');
  console.log('');
  console.log('Options:');
  console.log('  --help    Show this help message');
  console.log('');
  console.log('Environment Variables:');
  console.log('  REDIS_URL              Redis connection URL');
  console.log('  MONITOR_INTERVAL_MS    Sampling interval in milliseconds (default: 60000)');
  console.log('  ALERT_WEBHOOK_URL      Webhook URL for alerts');
  console.log('  MIN_CACHE_HIT_RATE     Minimum acceptable cache hit rate (default: 0.8)');
  console.log('  MAX_QUERY_TIME_MS      Maximum acceptable query time (default: 1000)');
  console.log('  MAX_MEMORY_PERCENT     Maximum acceptable memory usage % (default: 85)');
  console.log('  MAX_LATENCY_MS         Maximum acceptable latency in ms (default: 500)');
}

// Handle CLI arguments
if (process.argv.includes('--help')) {
  printUsage();
  process.exit(0);
}

// Run main
main().catch((err) => logger.error('Main execution error', err));
