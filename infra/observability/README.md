# Observability

## Distributed Tracing

SmartBeak uses OpenTelemetry for distributed tracing across the API server and background workers.

### Local Development Stack

Start the full observability stack:

```bash
cd infra/observability
docker compose up -d
```

This starts:
- **Jaeger UI**: http://localhost:16686 — trace visualization
- **OTel Collector**: localhost:4318 (HTTP) / localhost:4317 (gRPC) — receives spans
- **Prometheus**: http://localhost:9090 — metrics
- **Grafana**: http://localhost:3333 — dashboards

### Configuration

Set these environment variables to enable trace export:

```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces
OTEL_SAMPLING_RATE=1.0
```

Without `OTEL_EXPORTER_OTLP_ENDPOINT`, spans are logged to console in development.

### What is Traced

- HTTP requests (Fastify auto-instrumentation)
- PostgreSQL queries (pg auto-instrumentation)
- Redis commands (ioredis auto-instrumentation)
- Background job processing (BullMQ — manual instrumentation)
- EventBus event publishing and handling (manual instrumentation)

### Architecture

```
App (OTel SDK) → OTel Collector → Jaeger (traces)
                                 → Prometheus (metrics from traces)
```

---

## Circuit Breakers

### Metrics
- circuit_failure{name}
- circuit_open{name}
- circuit_open_block{name}
- circuit_closed{name}

### Alerts
- CircuitBreakerOpenTooLong:
  Fires when a circuit breaker remains open for more than 5 minutes.

### Operator Actions
1. Check adapter credentials (Vault)
2. Check provider status (GA/GSC/FB/Vercel)
3. Retry after provider recovery
