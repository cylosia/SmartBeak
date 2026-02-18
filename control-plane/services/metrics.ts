
import client from 'prom-client';
import { requireRole, type AuthContext } from './auth';

// P2-24 FIX: Added method and status labels to httpRequests counter for better observability
export const httpRequests = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'status', 'route']
});

export const pluginFailures = new client.Counter({
  name: 'plugin_failures_total',
  help: 'Total plugin failures',
  labelNames: ['plugin']
});

// Minimal Fastify-compatible response type used only in this handler
interface MetricsResponse {
  header: (name: string, value: string) => void;
  code: (statusCode: number) => MetricsResponse;
  send: (data: string) => void;
}

// P0-2 FIX: metricsEndpoint now requires authentication and admin/owner role
// FIX(P1): Auth failures now return correct HTTP 401/403 status codes.
// Previously `res.status?.(...)` used optional chaining which silently no-ops
// when the host framework does not attach a `status` method — returning HTTP 200
// with an error body, breaking all auth-monitoring tooling.
export function metricsEndpoint(): (req: { auth?: AuthContext | null }, res: MetricsResponse) => Promise<void> {
  return async (req: { auth?: AuthContext | null }, res: MetricsResponse): Promise<void> => {
    // P0-2 FIX: Require authentication — return 401 (not 200)
    const auth = req.auth;
    if (!auth) {
      res.header('Content-Type', 'application/json');
      res.code(401).send(JSON.stringify({ error: 'Authentication required' }));
      return;
    }

    // P0-2 FIX: Require admin or owner role — return 403 (not 200)
    try {
      requireRole(auth, ['admin', 'owner']);
    } catch {
      res.header('Content-Type', 'application/json');
      res.code(403).send(JSON.stringify({ error: 'Admin access required' }));
      return;
    }

    res.header('Content-Type', client.register.contentType);
    res.send(await client.register.metrics());
  };
}
