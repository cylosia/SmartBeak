

import { FastifyInstance, FastifyRequest } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getLogger } from '../../../packages/kernel/logger';
import { InviteService } from '../../services/invite-service';
import { MembershipService } from '../../services/membership-service';
import { OrgService } from '../../services/org-service';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, AuthContext } from '../../services/auth';

const logger = getLogger('Orgs');

export type AuthenticatedRequest = FastifyRequest & {
  auth?: AuthContext | undefined;
};

// SECURITY FIX: Add Zod validation schema for org name
const CreateOrgSchema = z.object({
  name: z.string()
  .min(1, 'Organization name is required')
  .max(100, 'Organization name must be 100 characters or less')
  .regex(/^[a-zA-Z0-9\s\-_\.]+$/, 'Organization name contains invalid characters')
  .trim(),
});

export async function orgRoutes(app: FastifyInstance, pool: Pool) {
  const orgs = new OrgService(pool);
  const members = new MembershipService(pool);
  const invites = new InviteService(pool);

  app.post('/orgs', async (req, res) => {
  try {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return res.status(401).send({ error: 'Unauthorized' });
    }
    requireRole(ctx, ['admin','owner']);
    await rateLimit('orgs:create', 20);

    // SECURITY FIX: Validate org name with Zod
    const bodyResult = CreateOrgSchema.safeParse(req.body);
    if (!bodyResult.success) {
    return res.status(400).send({
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details: bodyResult["error"].issues,
    });
    }

    const { name } = bodyResult.data;
    return await orgs.createOrg(name, ctx.userId);
  } catch (error) {
    logger.error('[orgs] Error', error instanceof Error ? error : new Error(String(error)));
    // FIX: Added return before reply.send()
    return res.status(500).send({ error: 'Failed to create organization' });
  }
  });

  app.get('/orgs/:id/members', async (req, res) => {
  try {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return res.status(401).send({ error: 'Unauthorized' });
    }
    requireRole(ctx, ['admin','owner']);
    await rateLimit('orgs:members', 50);
    const { id } = req.params as { id: string };

    // IDOR FIX: Verify user has access to this org
    if (ctx["orgId"] !== id) {
    logger.warn(`[IDOR] User ${ctx.userId} attempted to access org ${id} members without permission`);
    return res.status(404).send({ error: 'Organization not found' });
    }

    return await orgs.listMembers(id);
  } catch (error) {
    console["error"]('[orgs/:id/members] Error:', error);
    // FIX: Added return before reply.send()
    return res.status(500).send({ error: 'Failed to retrieve members' });
  }
  });

  app.post('/orgs/:id/invite', async (req, res) => {
  try {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return res.status(401).send({ error: 'Unauthorized' });
    }
    requireRole(ctx, ['admin','owner']);
    await rateLimit('orgs:invite', 30);
    const { id } = req.params as { id: string };

    // IDOR FIX: Verify user has access to this org
    if (ctx["orgId"] !== id) {
    logger.warn(`[IDOR] User ${ctx.userId} attempted to invite to org ${id} without permission`);
    return res.status(404).send({ error: 'Organization not found' });
    }

    const { email, role } = req.body as { email: string; role: string };
    return await invites.invite(id, email, role);
  } catch (error) {
    console["error"]('[orgs/:id/invite] Error:', error);
    // FIX: Added return before reply.send()
    return res.status(500).send({ error: 'Failed to send invite' });
  }
  });

  app.post('/orgs/:id/members', async (req, res) => {
  try {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return res.status(401).send({ error: 'Unauthorized' });
    }
    requireRole(ctx, ['admin','owner']);
    await rateLimit('orgs:members:add', 30);
    const { id } = req.params as { id: string };

    // IDOR FIX: Verify user has access to this org
    if (ctx["orgId"] !== id) {
    logger.warn(`[IDOR] User ${ctx.userId} attempted to add member to org ${id} without permission`);
    return res.status(404).send({ error: 'Organization not found' });
    }

    const { userId, role } = req.body as { userId: string; role: string };
    await members.addMember(id, userId, role);
    return { ok: true };
  } catch (error) {
    console["error"]('[orgs/:id/members] Error:', error);
    // FIX: Added return before reply.send()
    return res.status(500).send({ error: 'Failed to add member' });
  }
  });
}
