
import client from 'prom-client';

export const httpRequests = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests'
});

export const pluginFailures = new client.Counter({
  name: 'plugin_failures_total',
  help: 'Total plugin failures',
  labelNames: ['plugin']
});

export function metricsEndpoint(): (_req: unknown, res: { header: (name: string, value: string) => void; send?: (data: string) => void }) => Promise<string> {
  return async (_req: unknown, res: { header: (name: string, value: string) => void; send?: (data: string) => void }): Promise<string> => {
  res.header('Content-Type', client.register.contentType);
  return client.register.metrics();
  };
}
