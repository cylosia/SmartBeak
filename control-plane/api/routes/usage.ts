

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getLogger } from '@kernel/logger';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, AuthContext } from '../../services/auth';
import { UsageService } from '../../services/usage';
import { errors } from '@errors/responses';

const logger = getLogger('usage-routes');

// Schema mirrors the exact columns returned by UsageService.getUsage().
// Using .strict() ensures any unexpected DB columns are caught at the boundary
// rather than leaking internal fields to API consumers.
const UsageStatsSchema = z.object({
  org_id: z.string(),
  domain_count: z.number(),
  content_count: z.number(),
  media_count: z.number(),
  publish_count: z.number(),
  updated_at: z.union([z.date(), z.string()]).optional(),
}).strict();

export type UsageStats = z.infer<typeof UsageStatsSchema>;

export type AuthenticatedRequest = FastifyRequest & {
  auth?: AuthContext | undefined;
};

/**
* Usage routes
*/
export async function usageRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const usage = new UsageService(pool);

  /**
  * @openapi
  * /usage:
  *   get:
  *     summary: Get organization usage statistics
  *     tags: [Usage]
  *     security:
  *       - bearerAuth: []
  *     responses:
  *       200:
  *         description: Usage statistics retrieved
  *       403:
  *         description: Forbidden
  */
  app.get('/usage', async (
  req: FastifyRequest,
  res: FastifyReply
  ): Promise<void> => {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return errors.unauthorized(res);
    }
    requireRole(ctx, ['owner', 'admin']);
    // P1-FIX: Scope rate limit to org to prevent one user exhausting limit for all
    await rateLimit(`usage:${ctx["orgId"]}`, 50);

    let stats: UsageStats;
    try {
    const rawStats = await usage.getUsage(ctx['orgId']);
    stats = UsageStatsSchema.parse(rawStats);
    } catch (serviceError) {
    logger.error('[usage] Service error', serviceError instanceof Error ? serviceError : new Error(String(serviceError)));
    return errors.serviceUnavailable(res, 'Unable to fetch usage data. Please try again later.');
    }

    return res.send(stats);
  });
}
