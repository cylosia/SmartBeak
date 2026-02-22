

import { FastifyInstance, FastifyRequest } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { PublishingCreateJobService } from '../../services/publishing-create-job';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, type Role } from '../../services/auth';
import { errors } from '@errors/responses';

// P3-FIX: Moved schema and interface to module level.
// Previously both were redefined inside `publishingCreateJobRoutes` on every
// invocation, rebuilding the Zod schema object on each call (wasteful) and
// making the interface inaccessible to tests and other modules.
const CreateJobSchema = z.object({
  contentId: z.string().uuid(),
  targetId: z.string().min(1).max(255),
  scheduleAt: z.string().datetime().optional(),
});

/**
* Authenticated request interface
*/
interface AuthenticatedRequest extends FastifyRequest {
  auth: {
  userId: string;
  orgId: string;
  domainId?: string;
  roles: Role[];
  };
}

export async function publishingCreateJobRoutes(app: FastifyInstance, pool: Pool) {
  const svc = new PublishingCreateJobService(pool);

  app.post('/publishing/jobs', async (req, res) => {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return errors.unauthorized(res);
    }
    requireRole(ctx, ['owner','admin','editor']);
    await rateLimit('content', 50);

    // Validate input
    const parseResult = CreateJobSchema.safeParse(req.body);
    if (!parseResult.success) {
    return errors.validationFailed(res, parseResult["error"].issues);
    }

    const { contentId, targetId, scheduleAt } = parseResult.data;

    // P0-FIX: domainId is optional on the auth context (API tokens may not
    // carry a domain scope). The prior non-null assertion `ctx["domainId"]!`
    // silently passed undefined, which would insert a NULL domain_id bypassing
    // domain isolation entirely. Fail fast with a 400 instead.
    const domainId = ctx["domainId"];
    if (!domainId) {
    return errors.badRequest(res, 'Domain ID is required for publishing jobs', 'REQUIRED_FIELD');
    }

    const result = await svc.createJob({
    domainId,
    contentId,
    targetId,
    ...(scheduleAt !== undefined && { scheduleAt }),
    });
    return res.status(201).send(result);
  });
}
