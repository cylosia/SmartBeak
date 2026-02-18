
import type { FastifyRequest, FastifyReply } from 'fastify';
import client from 'prom-client';
import { requireRole, type AuthContext } from './auth';

// ============================================================================
// Metric Registration
// ============================================================================

// P2-FIX: Use getSingleMetric() to recover an already-registered counter before
// creating a new one. Without this, hot-module reloading (ts-node --watch,
// Nodemon) and Jest test suites that re-import this module throw:
// "Error: A metric with the name http_requests_total has already been registered."
// crashing the dev server on every file save and all tests that import metrics.ts.

export const httpRequests = (
  client.register.getSingleMetric('http_requests_total') as client.Counter | undefined
) ?? new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  // P2-24 FIX: Added method and status labels for better observability
  labelNames: ['method', 'status', 'route'],
});

export const pluginFailures = (
  client.register.getSingleMetric('plugin_failures_total') as client.Counter | undefined
) ?? new client.Counter({
  name: 'plugin_failures_total',
  help: 'Total plugin failures',
  labelNames: ['plugin'],
});

// ============================================================================
// Metrics Handler
// ============================================================================

// P0-FIX (cross-tenant metrics): The prom-client default registry is PROCESS-GLOBAL.
// It contains aggregated metrics across ALL tenants, organizations, and system
// components — not scoped to any single org. An admin from org-A can call this
// endpoint and see request counts, error rates, and label values from org-B,
// leaking business-sensitive signals (request volumes, feature usage, error rates).
//
// REQUIRED INFRASTRUCTURE CONTROLS (BOTH required, not either/or):
//   1. Gate at the network/ingress layer: this route MUST only be reachable from
//      the internal monitoring network (Prometheus scraper IP range).
//   2. Require METRICS_INTERNAL_SECRET header: ensures that even if the ingress
//      rule is misconfigured, the endpoint cannot be reached by normal user tokens.
//
// P1-FIX (factory footgun): Previously metricsEndpoint() was a factory returning
// a handler. If registered as `app.get('/metrics', metricsEndpoint)` (without the
// () call), Fastify invoked the factory as the handler — receiving req/res as its
// single argument — and the inner handler was never called, returning 401 forever.
// Fix: export the handler directly as metricsHandler.
//
// P1-FIX (MetricsResponse): The previous custom `MetricsResponse` interface
// diverged from FastifyReply — code() returned MetricsResponse (not FastifyReply)
// and send() returned void (not FastifyReply). Runtime worked by duck-typing but
// a framework upgrade or adapter change would break silently. Now uses FastifyReply.
export async function metricsHandler(req: FastifyRequest, res: FastifyReply): Promise<void> {
  // P0-FIX: Require internal secret header as a defence-in-depth layer.
  // This must be set in the Prometheus scraper configuration and is NOT
  // exposed to end users. Fail closed if the env var is not set to avoid
  // accidentally exposing metrics in a misconfigured environment.
  const internalSecret = process.env['METRICS_INTERNAL_SECRET'];
  if (!internalSecret || req.headers['x-metrics-secret'] !== internalSecret) {
    void res.code(403).send({ error: 'Access denied - infrastructure endpoint' });
    return;
  }

  // P0-2 FIX: Require authentication — return 401 (not 200)
  const auth = (req as FastifyRequest & { auth?: AuthContext | null }).auth;
  if (!auth) {
    void res.code(401).send({ error: 'Authentication required' });
    return;
  }

  // P0-2 FIX: Require admin or owner role — return 403 (not 200)
  // P2-FIX (error swallowing): catch only RoleAccessError; rethrow unexpected errors
  // so they propagate as 500s rather than being silently converted to 403s,
  // which would mask internal bugs in requireRole.
  try {
    requireRole(auth, ['admin', 'owner']);
  } catch (roleErr) {
    void res.header('Content-Type', 'application/json').code(403).send(
      JSON.stringify({ error: 'Admin access required' })
    );
    return;
  }

  void res.header('Content-Type', client.register.contentType).send(
    await client.register.metrics()
  );
}
