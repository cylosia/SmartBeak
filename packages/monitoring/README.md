# SmartBeak Monitoring Package

Comprehensive monitoring and observability solution with OpenTelemetry distributed tracing, metrics collection, health checks, and alerting.

## Features

### 1. Distributed Tracing (OpenTelemetry)
- Automatic instrumentation for HTTP, PostgreSQL, Redis, Express
- Manual span creation and context propagation
- W3C Trace Context propagation across services
- OTLP export to collectors

### 2. Metrics Collection
- **Business Metrics**: User signups, payments, content published, jobs
- **System Metrics**: CPU, memory, event loop lag, uptime
- **Custom Metrics**: Counters, gauges, histograms, timings
- Automatic aggregation and percentile calculations

### 3. Health Checks
- **Deep Health Checks**: Database, Redis, external APIs
- **Readiness Probes**: Critical dependency checks
- **Liveness Probes**: Process health and basic metrics
- HTTP middleware for Kubernetes-compatible endpoints

### 4. Alerting Rules
- **15+ Built-in Rules**: Latency, error rate, business, infrastructure
- **Flexible Conditions**: Multiple operators, aggregations, durations
- **Multi-channel Notifications**: Slack, webhook, email, PagerDuty
- **Alert Lifecycle**: Firing, acknowledged, resolved states

## Installation

```bash
npm install @smartbeak/monitoring
```

## Quick Start

### Basic Initialization

```typescript
import { initMonitoring } from '@smartbeak/monitoring';
import { Pool } from 'pg';
import Redis from 'ioredis';

const db = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL);

const monitoring = initMonitoring({
  service: {
    name: 'smartbeak-api',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
  },
  telemetry: {
    enabled: true,
    collectorEndpoint: process.env.OTEL_COLLECTOR_URL,
    samplingRate: 0.1, // 10% sampling
  },
  metrics: {
    enabled: true,
    intervalMs: 60000,
  },
  health: {
    enabled: true,
    checks: {
      database: {
        query: () => db.query('SELECT 1'),
        getPoolStatus: () => ({
          total: db.totalCount,
          idle: db.idleCount,
          waiting: db.waitingCount,
        }),
      },
      redis: {
        ping: () => redis.ping(),
        getInfo: async () => {
          const info = await redis.info('memory');
          return { memory: info };
        },
      },
      externalApis: [
        { name: 'stripe', url: 'https://api.stripe.com/v1/health' },
      ],
    },
  },
  alerting: {
    enabled: true,
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
    webhookUrl: process.env.ALERT_WEBHOOK_URL,
    db, // For alert persistence
  },
  db,
});
```

### Express/Fastify Integration

```typescript
import { createHealthMiddleware, createMetricsMiddleware } from '@smartbeak/monitoring';
import { getHealthChecks, getMetricsCollector } from '@smartbeak/monitoring';

// Health endpoints middleware
app.use(createHealthMiddleware(getHealthChecks(), {
  healthPath: '/health',
  readyPath: '/ready',
  livePath: '/live',
}));

// Prometheus metrics endpoint
app.use(createMetricsMiddleware(getMetricsCollector(), {
  path: '/metrics',
}));
```

## Distributed Tracing

### Automatic Instrumentation

The monitoring package automatically instruments:
- HTTP requests (incoming and outgoing)
- PostgreSQL queries
- Redis commands
- Express routes

### Manual Span Creation

```typescript
import { withSpan, addSpanAnnotation, addSpanAttributes } from '@smartbeak/monitoring';

// Execute code within a span
const result = await withSpan(
  {
    spanName: 'process-payment',
    kind: 'internal',
    attributes: { paymentId: '123', amount: 100 },
  },
  async (span) => {
    // Add annotations
    addSpanAnnotation({
      name: 'validation.complete',
      attributes: { validationTime: Date.now() },
    });
    
    // Add attributes
    addSpanAttributes({ userId: 'user-456' });
    
    // Your business logic
    return await processPayment(paymentId);
  }
);
```

### Trace Context Propagation

```typescript
import { injectTraceContext, extractTraceContext, withSpan } from '@smartbeak/monitoring';

// Server: Extract trace context from incoming request
app.post('/api/webhook', async (req, res) => {
  const parentContext = extractTraceContext(req.headers);
  
  await withSpan(
    { spanName: 'webhook-handler', parentContext },
    async () => {
      // Handle webhook
    }
  );
});

// Client: Inject trace context into outgoing request
const headers = injectTraceContext();
const response = await fetch('https://api.external.com/data', {
  headers,
});
```

### Decorator-style Tracing

```typescript
import { Trace } from '@smartbeak/monitoring';

class PaymentService {
  @Trace('process-payment', { service: 'payments' })
  async processPayment(paymentId: string) {
    // This method is automatically traced
    return await this.doProcess(paymentId);
  }
}
```

## Metrics Collection

### Recording Metrics

```typescript
import { counter, gauge, timing, getMetricsCollector } from '@smartbeak/monitoring';

// Counter - for counting events
counter('user.signup', 1, { source: 'web' });

// Gauge - for point-in-time values
gauge('queue.size', queue.length, { queue: 'payments' });

// Timing - for duration measurements
const start = Date.now();
await processJob();
timing('job.duration', Date.now() - start, { type: 'payment' });

// Using the collector directly
const collector = getMetricsCollector();

// Business metrics
collector.recordUserSignup('mobile');
collector.recordPayment(99.99, 'USD', 'success');
collector.recordJobCompleted('email-send', 250);
collector.recordJobFailed('email-send', 'timeout');
collector.recordApiCall('/api/users', 'GET', 200, 45);
```

### System Metrics

System metrics are automatically collected:
- CPU usage and load average
- Memory usage (system and heap)
- Event loop lag
- Process uptime

```typescript
import { getMetricsCollector } from '@smartbeak/monitoring';

const metrics = getMetricsCollector();
const systemMetrics = metrics.getSystemMetrics();

console.log(`CPU: ${systemMetrics.cpu.usagePercent}%`);
console.log(`Memory: ${systemMetrics.memory.usedPercent}%`);
console.log(`Event Loop Lag: ${systemMetrics.eventLoop.lagMs}ms`);
```

### Accessing Aggregations

```typescript
const collector = getMetricsCollector();

// Get aggregation for a metric
const latency = collector.getAggregation('business.api_duration', {
  endpoint: '/api/users',
});

console.log(`P95 Latency: ${latency?.percentiles?.p95}ms`);
console.log(`Avg Latency: ${latency?.avg}ms`);
```

## Health Checks

### Built-in Health Checks

```typescript
import { initHealthChecks, createDatabaseHealthCheck } from '@smartbeak/monitoring';

const health = initHealthChecks('1.0.0', 'production');

// Register database health check
health.register({
  name: 'database',
  check: createDatabaseHealthCheck({
    query: () => db.query('SELECT 1'),
    getPoolStatus: () => ({
      total: db.totalCount,
      idle: db.idleCount,
      waiting: db.waitingCount,
    }),
  }),
  intervalMs: 30000,
  severity: 'critical',
});

// Register custom health check
health.register({
  name: 'stripe-api',
  check: async () => {
    const start = Date.now();
    try {
      await stripe.healthcheck();
      return {
        name: 'stripe-api',
        status: 'healthy',
        latencyMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        name: 'stripe-api',
        status: 'unhealthy',
        message: error.message,
        latencyMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      };
    }
  },
  intervalMs: 60000,
  severity: 'warning',
});
```

### Running Health Checks

```typescript
// Run all checks
const report = await health.runAllChecks();
console.log(`Status: ${report.status}`);
console.log(`Healthy: ${report.summary.healthy}/${report.summary.total}`);

// Check readiness (critical checks only)
const readiness = await health.checkReadiness();
if (!readiness.ready) {
  console.log('Service not ready:', readiness.dependencies);
}

// Check liveness
const liveness = health.checkLiveness();
console.log(`Uptime: ${liveness.uptime}s`);
console.log(`Memory: ${JSON.stringify(liveness.memory)}`);
```

## Alerting Rules

### Built-in Alert Rules

The package includes 15+ pre-configured alert rules:

| Rule | Category | Severity | Description |
|------|----------|----------|-------------|
| latency-api-p95 | Latency | warning | API P95 latency > 500ms |
| latency-api-p99 | Latency | critical | API P99 latency > 1s |
| error-rate-api-critical | Error Rate | critical | API error rate > 5% |
| business-payment-failures | Business | critical | Payment failure rate > 10% |
| infra-memory-critical | Infrastructure | critical | Memory usage > 90% |
| availability-db | Availability | critical | Database unavailable |

### Custom Alert Rules

```typescript
import { initAlertRules, getAlertRules } from '@smartbeak/monitoring';

const alerting = initAlertRules({ db, metricsCollector });

// Add custom rule
const rule = {
  id: 'custom-api-latency',
  name: 'Custom API Latency Alert',
  category: 'latency' as const,
  severity: 'warning' as const,
  metric: 'custom.api.latency',
  operator: 'gt' as const,
  threshold: 1000,
  aggregation: 'avg' as const,
  aggregationWindow: '5m',
  duration: '5m',
  cooldown: '15m',
  channels: ['slack', 'email'] as const,
  enabled: true,
};

alerting.addRule(rule);

// Register notification handlers
alerting.registerNotificationHandler('slack', async (payload) => {
  console.log('Sending Slack notification:', payload.alert.message);
});
```

### Alert Lifecycle

```typescript
const alerting = getAlertRules();

// Get active alerts
const activeAlerts = alerting.getActiveAlerts();

// Get alerts by category
const latencyAlerts = alerting.getAlertsByCategory('latency');

// Get critical alerts
const criticalAlerts = alerting.getAlertsBySeverity('critical');

// Acknowledge an alert
await alerting.acknowledgeAlert('alert-123', 'user-456');
```

## Environment Variables

```bash
# Telemetry
OTEL_COLLECTOR_URL=https://otel-collector.internal:4318
OTEL_SAMPLING_RATE=0.1

# Alerting
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
ALERT_WEBHOOK_URL=https://monitoring.internal/alerts
ALERT_EMAIL_ADDRESSES=ops@company.com,dev@company.com

# Service Info
SERVICE_NAME=smartbeak-api
SERVICE_VERSION=1.0.0
NODE_ENV=production
```

## Graceful Shutdown

```typescript
import { shutdownMonitoring } from '@smartbeak/monitoring';

process.on('SIGTERM', async () => {
  await shutdownMonitoring();
  process.exit(0);
});
```

## API Reference

See the TypeScript type definitions for complete API documentation.

## License

UNLICENSED - Proprietary Software
