

import { FastifyInstance, FastifyRequest } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getLogger } from '../../../packages/kernel/logger';
import { createRouteErrorHandler } from '@errors';
import { InviteService } from '../../services/invite-service';
import { MembershipService } from '../../services/membership-service';
import { OrgService } from '../../services/org-service';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, AuthContext } from '../../services/auth';
import { errors } from '@errors/responses';

const logger = getLogger('Orgs');
const handleError = createRouteErrorHandler({ logger });

export type AuthenticatedRequest = FastifyRequest & {
  auth?: AuthContext | undefined;
};

// SECURITY FIX: Add Zod validation schema for org name
const CreateOrgSchema = z.object({
  name: z.string()
  .min(1, 'Organization name is required')
  .max(100, 'Organization name must be 100 characters or less')
  .regex(/^[a-zA-Z0-9\s\-_.]+$/, 'Organization name contains invalid characters')
  .trim(),
});

// SECURITY FIX (C01): Validate invite body - prevents privilege escalation and XSS via email
const InviteSchema = z.object({
  email: z.string().email('Invalid email address').max(254).toLowerCase().trim(),
  role: z.enum(['admin', 'editor', 'viewer'], {
    message: 'Role must be one of: admin, editor, viewer',
  }),
});

// SECURITY FIX (C02): Validate add-member body - prevents privilege escalation to owner
const AddMemberSchema = z.object({
  userId: z.string().uuid('Invalid user ID format'),
  role: z.enum(['admin', 'editor', 'viewer'], {
    message: 'Role must be one of: admin, editor, viewer',
  }),
});

// SECURITY FIX (H08): Validate org ID route parameter
const OrgIdParamsSchema = z.object({
  id: z.string().uuid('Invalid organization ID format'),
});

export async function orgRoutes(app: FastifyInstance, pool: Pool) {
  const orgs = new OrgService(pool);
  const members = new MembershipService(pool);
  const invites = new InviteService(pool);

  app.post('/orgs', async (req, res) => {
  try {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return errors.unauthorized(res);
    }
    requireRole(ctx, ['admin','owner']);
    await rateLimit(`orgs:create:${ctx.userId}`, 20);

    // SECURITY FIX: Validate org name with Zod
    const bodyResult = CreateOrgSchema.safeParse(req.body);
    if (!bodyResult.success) {
    return errors.validationFailed(res, bodyResult["error"].issues);
    }

    const { name } = bodyResult.data;
    return await orgs.createOrg(name, ctx.userId);
  } catch (error) {
    logger.error('[orgs] Error', error instanceof Error ? error : new Error(String(error)));
    // FIX: Added return before reply.send()
    return errors.internal(res, 'Failed to create organization');
    return handleError(res, error, 'create organization');
  }
  });

  app.get('/orgs/:id/members', async (req, res) => {
  try {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return errors.unauthorized(res);
    }
    requireRole(ctx, ['admin','owner']);
    await rateLimit(`orgs:members:${ctx.userId}`, 50);

    // SECURITY FIX (H08): Validate route params
    const paramsResult = OrgIdParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
    return errors.badRequest(res, 'Invalid organization ID');
    }
    const { id } = paramsResult.data;

    // IDOR FIX: Verify user has access to this org
    if (ctx["orgId"] !== id) {
    logger.warn(`[IDOR] User ${ctx.userId} attempted to access org ${id} members without permission`);
    return errors.notFound(res, 'Organization');
    }

    return await orgs.listMembers(id);
  } catch (error) {
    logger.error('[orgs/:id/members] Error', error instanceof Error ? error : new Error(String(error)));
    // FIX: Added return before reply.send()
    return errors.internal(res, 'Failed to retrieve members');
    return handleError(res, error, 'list organization members');
  }
  });

  app.post('/orgs/:id/invite', async (req, res) => {
  try {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return errors.unauthorized(res);
    }
    requireRole(ctx, ['admin','owner']);
    await rateLimit(`orgs:invite:${ctx.userId}`, 30);

    // SECURITY FIX (H08): Validate route params
    const paramsResult = OrgIdParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
    return errors.badRequest(res, 'Invalid organization ID');
    }
    const { id } = paramsResult.data;

    // IDOR FIX: Verify user has access to this org
    if (ctx["orgId"] !== id) {
    logger.warn(`[IDOR] User ${ctx.userId} attempted to invite to org ${id} without permission`);
    return errors.notFound(res, 'Organization');
    }

    // SECURITY FIX (C01): Validate invite body with Zod
    const bodyResult = InviteSchema.safeParse(req.body);
    if (!bodyResult.success) {
    return errors.validationFailed(res, bodyResult.error.issues);
    }
    const { email, role } = bodyResult.data;
    return await invites.invite(id, email, role);
  } catch (error) {
    logger.error('[orgs/:id/invite] Error', error instanceof Error ? error : new Error(String(error)));
    // FIX: Added return before reply.send()
    return errors.internal(res, 'Failed to send invite');
    return handleError(res, error, 'send organization invite');
  }
  });

  app.post('/orgs/:id/members', async (req, res) => {
  try {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return errors.unauthorized(res);
    }
    requireRole(ctx, ['admin','owner']);
    await rateLimit(`orgs:members:add:${ctx.userId}`, 30);

    // SECURITY FIX (H08): Validate route params
    const paramsResult = OrgIdParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
    return errors.badRequest(res, 'Invalid organization ID');
    }
    const { id } = paramsResult.data;

    // IDOR FIX: Verify user has access to this org
    if (ctx["orgId"] !== id) {
    logger.warn(`[IDOR] User ${ctx.userId} attempted to add member to org ${id} without permission`);
    return errors.notFound(res, 'Organization');
    }

    // SECURITY FIX (C02): Validate add-member body with Zod
    const bodyResult = AddMemberSchema.safeParse(req.body);
    if (!bodyResult.success) {
    return errors.validationFailed(res, bodyResult.error.issues);
    }
    const { userId, role } = bodyResult.data;
    await members.addMember(id, userId, role);
    return { ok: true };
  } catch (error) {
    logger.error('[orgs/:id/members] Error', error instanceof Error ? error : new Error(String(error)));
    // FIX: Added return before reply.send()
    return errors.internal(res, 'Failed to add member');
    return handleError(res, error, 'add organization member');
  }
  });
}
