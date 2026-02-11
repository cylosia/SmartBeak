import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

import { AuthContext } from '../types/fastify';
import { rateLimit } from '../utils/rateLimit';

function requireRole(auth: AuthContext, allowedRoles: string[]): void {
  const hasRole = auth.roles.some(role => allowedRoles.includes(role));
  if (!hasRole) {
    throw new Error('permission denied: insufficient role');
  }
}

export interface MetricRecord {
  platform: string;
  metrics: Record<string, number | string>;
}

const ExportRequestSchema = z.object({
  records: z.array(z.object({
    platform: z.string(),
    metrics: z.record(z.string(), z.union([z.number(), z.string()]))
  })).optional()
});

export type ExportRequestBody = z.infer<typeof ExportRequestSchema>;

export interface ExportRouteParams {
  Body: ExportRequestBody;
}

export async function mediaAnalyticsExportRoutes(app: FastifyInstance): Promise<void> {
  app.get<ExportRouteParams>('/media/analytics/export', async (
    req: FastifyRequest<ExportRouteParams>,
    reply: FastifyReply
  ): Promise<void> => {
    try {
      const parseResult = ExportRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        reply.status(400).send({
          error: 'Invalid request body',
          code: 'VALIDATION_ERROR',
          details: parseResult.error.issues
        });
        return;
      }

      const auth = req.auth;
      if (!auth) {
        reply.status(401).send({
          error: 'Unauthorized',
          code: 'UNAUTHORIZED'
        });
        return;
      }

      requireRole(auth, ['owner', 'admin', 'editor']);

      await rateLimit('media:analytics:export', 10, req, reply);

      const records = parseResult.data.records || [];

      const header = 'platform,metric,value\n';

      const body = records
        .map((r: MetricRecord) => {
          if (!r.platform || !r.metrics) {
            return '';
          }
          return Object.entries(r.metrics)
            .map(([k, v]) => `${escapeCsv(r.platform)},${escapeCsv(k)},${escapeCsv(String(v))}`)
            .join('\n');
        })
        .filter(Boolean)
        .join('\n');

      reply
        .header('Content-Type', 'text/csv')
        .header('Content-Disposition', "attachment; filename='media_analytics.csv'")
        .send(header + body);
    } catch (error) {
      console.error('[mediaAnalyticsExport] Error:', error);

      const errWithCode = error as Error & { code?: string };
      const hasPermissionError = error instanceof Error &&
        (errWithCode.code === 'PERMISSION_DENIED' ||
         errWithCode.code === 'FORBIDDEN');
      if (hasPermissionError) {
        reply.status(403).send({
          error: 'Permission denied',
          code: 'FORBIDDEN'
        });
        return;
      }

      return reply.status(500).send({
        error: 'Export failed',
        code: 'EXPORT_ERROR',
        message: error instanceof Error ? error["message"] : 'Unknown error'
      });
    }
  });
}

function escapeCsv(value: string): string {
  let sanitized = String(value).replace(/"/g, '""');
  if (/^[=+\-\@\t\r]/.test(sanitized)) {
    sanitized = "'" + sanitized;
  }
  return `"${sanitized}"`;
}
