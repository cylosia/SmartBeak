

import { FastifyInstance, FastifyRequest } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getLogger } from '@kernel/logger';
import { InviteService } from '../../services/invite-service';
import { MembershipService } from '../../services/membership-service';
import { OrgService } from '../../services/org-service';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, AuthContext, RoleAccessError } from '../../services/auth';
import { errors } from '@errors/responses';

const logger = getLogger('Orgs');

export type AuthenticatedRequest = FastifyRequest & {
  auth?: AuthContext | undefined;
};

// P2-4: Add .strict() to all schemas to reject unknown extra properties.
const CreateOrgSchema = z.object({
  name: z.string()
    .min(1, 'Organization name is required')
    .max(100, 'Organization name must be 100 characters or less')
    .regex(/^[a-zA-Z0-9\s\-_.]+$/, 'Organization name contains invalid characters')
    .trim(),
}).strict();

// P2-4: Add .strict()
const InviteSchema = z.object({
  email: z.string().email('Invalid email address').max(254).toLowerCase().trim(),
  role: z.enum(['admin', 'editor', 'viewer'], {
    message: 'Role must be one of: admin, editor, viewer',
  }),
}).strict();

// P2-4: Add .strict()
const AddMemberSchema = z.object({
  userId: z.string().uuid('Invalid user ID format'),
  role: z.enum(['admin', 'editor', 'viewer'], {
    message: 'Role must be one of: admin, editor, viewer',
  }),
}).strict();

// P2-4: Add .strict()
const OrgIdParamsSchema = z.object({
  id: z.string().uuid('Invalid organization ID format'),
}).strict();

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
      // P1-2: Rate limit BEFORE role check
      await rateLimit(`orgs:create:${ctx.userId}`, 20);
      requireRole(ctx, ['admin', 'owner']);

      const bodyResult = CreateOrgSchema.safeParse(req.body);
      if (!bodyResult.success) {
        return errors.validationFailed(res, bodyResult['error'].issues);
      }

      const { name } = bodyResult.data;
      return await orgs.createOrg(name, ctx.userId);
    } catch (error) {
      // P1-3: Discriminate role and rate-limit errors before falling through to 500
      if (error instanceof RoleAccessError) return errors.forbidden(res, 'Insufficient permissions');
      if (error instanceof Error && error.message === 'Rate limit exceeded') {
        return errors.rateLimited(res, 60);
      }
      logger.error('[orgs] Error', error instanceof Error ? error : new Error(String(error)));
      return errors.internal(res, 'Failed to create organization');
    }
  });

  app.get('/orgs/:id/members', async (req, res) => {
    try {
      const { auth: ctx } = req as AuthenticatedRequest;
      if (!ctx) {
        return errors.unauthorized(res);
      }
      // P1-2: Rate limit BEFORE role check
      await rateLimit(`orgs:members:${ctx.userId}`, 50);
      requireRole(ctx, ['admin', 'owner']);

      const paramsResult = OrgIdParamsSchema.safeParse(req.params);
      if (!paramsResult.success) {
        return errors.badRequest(res, 'Invalid organization ID');
      }
      const { id } = paramsResult.data;

      // P0-4: Replace JWT-claim-only IDOR check with a DB membership query.
      // The previous string comparison (ctx.orgId !== id) trusted the JWT claim
      // alone and would allow revoked members to retain access until token expiry.
      const { rows: membership } = await pool.query(
        'SELECT 1 FROM memberships WHERE user_id = $1 AND org_id = $2',
        [ctx.userId, id]
      );
      if (membership.length === 0) {
        logger.warn(`[IDOR] DB membership check failed: user ${ctx.userId} is not a member of org ${id}`);
        return errors.notFound(res, 'Organization');
      }

      return await orgs.listMembers(id);
    } catch (error) {
      // P1-3: Discriminate role and rate-limit errors
      if (error instanceof RoleAccessError) return errors.forbidden(res, 'Insufficient permissions');
      if (error instanceof Error && error.message === 'Rate limit exceeded') {
        return errors.rateLimited(res, 60);
      }
      logger.error('[orgs/:id/members] Error', error instanceof Error ? error : new Error(String(error)));
      return errors.internal(res, 'Failed to retrieve members');
    }
  });

  app.post('/orgs/:id/invite', async (req, res) => {
    try {
      const { auth: ctx } = req as AuthenticatedRequest;
      if (!ctx) {
        return errors.unauthorized(res);
      }
      // P1-2: Rate limit BEFORE role check
      await rateLimit(`orgs:invite:${ctx.userId}`, 30);
      requireRole(ctx, ['admin', 'owner']);

      const paramsResult = OrgIdParamsSchema.safeParse(req.params);
      if (!paramsResult.success) {
        return errors.badRequest(res, 'Invalid organization ID');
      }
      const { id } = paramsResult.data;

      // P0-4: DB membership check instead of JWT-claim comparison
      const { rows: membership } = await pool.query(
        'SELECT 1 FROM memberships WHERE user_id = $1 AND org_id = $2',
        [ctx.userId, id]
      );
      if (membership.length === 0) {
        logger.warn(`[IDOR] DB membership check failed: user ${ctx.userId} attempted invite to org ${id}`);
        return errors.notFound(res, 'Organization');
      }

      const bodyResult = InviteSchema.safeParse(req.body);
      if (!bodyResult.success) {
        return errors.validationFailed(res, bodyResult.error.issues);
      }
      const { email, role } = bodyResult.data;
      return await invites.invite(id, email, role);
    } catch (error) {
      // P1-3
      if (error instanceof RoleAccessError) return errors.forbidden(res, 'Insufficient permissions');
      if (error instanceof Error && error.message === 'Rate limit exceeded') {
        return errors.rateLimited(res, 60);
      }
      logger.error('[orgs/:id/invite] Error', error instanceof Error ? error : new Error(String(error)));
      return errors.internal(res, 'Failed to send invite');
    }
  });

  app.post('/orgs/:id/members', async (req, res) => {
    try {
      const { auth: ctx } = req as AuthenticatedRequest;
      if (!ctx) {
        return errors.unauthorized(res);
      }
      // P1-2: Rate limit BEFORE role check
      await rateLimit(`orgs:members:add:${ctx.userId}`, 30);
      requireRole(ctx, ['admin', 'owner']);

      const paramsResult = OrgIdParamsSchema.safeParse(req.params);
      if (!paramsResult.success) {
        return errors.badRequest(res, 'Invalid organization ID');
      }
      const { id } = paramsResult.data;

      // P0-4: DB membership check instead of JWT-claim comparison
      const { rows: membership } = await pool.query(
        'SELECT 1 FROM memberships WHERE user_id = $1 AND org_id = $2',
        [ctx.userId, id]
      );
      if (membership.length === 0) {
        logger.warn(`[IDOR] DB membership check failed: user ${ctx.userId} attempted add-member to org ${id}`);
        return errors.notFound(res, 'Organization');
      }

      const bodyResult = AddMemberSchema.safeParse(req.body);
      if (!bodyResult.success) {
        return errors.validationFailed(res, bodyResult.error.issues);
      }
      const { userId, role } = bodyResult.data;

      // P0-5: Verify the target user exists before adding them as a member.
      // Without this check, any org admin could inject arbitrary UUIDs as members.
      const { rows: userRows } = await pool.query(
        'SELECT 1 FROM users WHERE id = $1',
        [userId]
      );
      if (userRows.length === 0) {
        return errors.badRequest(res, 'User not found');
      }

      await members.addMember(id, userId, role);
      return { ok: true };
    } catch (error) {
      // P1-3
      if (error instanceof RoleAccessError) return errors.forbidden(res, 'Insufficient permissions');
      if (error instanceof Error && error.message === 'Rate limit exceeded') {
        return errors.rateLimited(res, 60);
      }
      logger.error('[orgs/:id/members] Error', error instanceof Error ? error : new Error(String(error)));
      return errors.internal(res, 'Failed to add member');
    }
  });
}
