
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

// P0-2 FIX: metricsEndpoint now requires authentication and admin/owner role
export function metricsEndpoint(): (req: { auth?: AuthContext | null }, res: { header: (name: string, value: string) => void; send?: (data: string) => void; status?: (code: number) => { send: (data: string) => void } }) => Promise<string> {
  return async (req: { auth?: AuthContext | null }, res: { header: (name: string, value: string) => void; send?: (data: string) => void; status?: (code: number) => { send: (data: string) => void } }): Promise<string> => {
  // P0-2 FIX: Require authentication
  const auth = req.auth;
  if (!auth) {
    res.header('Content-Type', 'application/json');
    return JSON.stringify({ error: 'Authentication required' });
  }

  // P0-2 FIX: Require admin or owner role
  try {
    requireRole(auth, ['admin', 'owner']);
  } catch {
    res.header('Content-Type', 'application/json');
    return JSON.stringify({ error: 'Admin access required' });
  }

  res.header('Content-Type', client.register.contentType);
  return client.register.metrics();
  };
}
