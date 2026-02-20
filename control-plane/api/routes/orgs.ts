

import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getLogger } from '@kernel/logger';
import { InviteService } from '../../services/invite-service';
import { MembershipService } from '../../services/membership-service';
import { OrgService } from '../../services/org-service';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, AuthError } from '../../services/auth';
import { errors } from '@errors/responses';
// FIX (OG-03/OG-04): Import error types so ConflictError and ValidationError
// produce the correct HTTP status codes rather than falling through to 500.
import { ConflictError, ValidationError } from '@errors';
import type { AuthenticatedRequest } from '../types';

const logger = getLogger('Orgs');

// SECURITY FIX: Add Zod validation schema for org name
const CreateOrgSchema = z.object({
  name: z.string()
  .min(1, 'Organization name is required')
  .max(100, 'Organization name must be 100 characters or less')
  .regex(/^[a-zA-Z0-9\s\-_.]+$/, 'Organization name contains invalid characters')
  .trim(),
}).strict();

// SECURITY FIX (C01): Validate invite body - prevents privilege escalation and XSS via email
const InviteSchema = z.object({
  email: z.string().email('Invalid email address').max(254).toLowerCase().trim(),
  role: z.enum(['admin', 'editor', 'viewer'], {
    message: 'Role must be one of: admin, editor, viewer',
  }),
}).strict();

// SECURITY FIX (C02): Validate add-member body - prevents privilege escalation to owner
const AddMemberSchema = z.object({
  userId: z.string().uuid('Invalid user ID format'),
  role: z.enum(['admin', 'editor', 'viewer'], {
    message: 'Role must be one of: admin, editor, viewer',
  }),
}).strict();

// SECURITY FIX (H08): Validate org ID route parameter
const OrgIdParamsSchema = z.object({
  id: z.string().uuid('Invalid organization ID format'),
}).strict();

// FIX (P2-pagination): Validate pagination query params.  Callers must be
// able to page beyond the first N members; without this the response was
// silently truncated at the service default and there was no way to advance.
const MembersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

export async function orgRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const orgs = new OrgService(pool);
  const members = new MembershipService(pool);
  const invites = new InviteService(pool);

  app.post('/orgs', async (req, res) => {
  try {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return errors.unauthorized(res);
    }
    // SECURITY FIX (order): Rate-limit before role check so that authenticated
    // users with the wrong role cannot probe authorization state without
    // consuming rate-limit quota (unlimited auth-enumeration attack vector).
    await rateLimit(`orgs:create:${ctx.userId}`, 20);
    requireRole(ctx, ['admin','owner']);

    // SECURITY FIX: Validate org name with Zod
    const bodyResult = CreateOrgSchema.safeParse(req.body);
    if (!bodyResult.success) {
    return errors.validationFailed(res, bodyResult["error"].issues);
    }

    const { name } = bodyResult.data;
    // FIX (P2-201): Resource creation must return HTTP 201, not the default 200.
    return res.code(201).send(await orgs.createOrg(name, ctx.userId));
  } catch (error) {
    // AUDIT-FIX P0: Name-based fallback for cross-module AuthError.
    // Five independent AuthError classes exist (security/jwt, kernel/auth, @errors,
    // control-plane/services/auth, apps/web/lib/auth). instanceof only matches the
    // imported class. The name check catches errors from any AuthError variant.
    if (error instanceof AuthError || (error instanceof Error && error.name === 'AuthError')) {
      const status = error instanceof AuthError ? error.statusCode : 401;
      return status === 403
        ? errors.forbidden(res)
        : errors.unauthorized(res);
    }
    if (error instanceof Error && error.message === 'Rate limit exceeded') {
      return errors.rateLimited(res, 60);
    }
    // FIX (OG-03): ConflictError (e.g. duplicate org name) and ValidationError
    // must return 409/400 rather than falling through to 500.
    if (error instanceof ConflictError) {
      return errors.conflict(res, error.message);
    }
    if (error instanceof ValidationError) {
      return errors.badRequest(res, error.message);
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
    // SECURITY FIX (order): Rate-limit before role check (see POST /orgs for rationale).
    await rateLimit(`orgs:members:${ctx.userId}`, 50);
    requireRole(ctx, ['admin','owner']);

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

    // FIX (P2-pagination): Validate and forward pagination params so callers
    // can page through orgs with more than the default limit of members.
    const queryResult = MembersQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
    return errors.validationFailed(res, queryResult.error.issues);
    }
    const { limit, offset } = queryResult.data;

    return res.send(await orgs.listMembers(id, limit, offset));
  } catch (error) {
    // AUDIT-FIX P0: Name-based fallback for cross-module AuthError.
    // Five independent AuthError classes exist (security/jwt, kernel/auth, @errors,
    // control-plane/services/auth, apps/web/lib/auth). instanceof only matches the
    // imported class. The name check catches errors from any AuthError variant.
    if (error instanceof AuthError || (error instanceof Error && error.name === 'AuthError')) {
      const status = error instanceof AuthError ? error.statusCode : 401;
      return status === 403
        ? errors.forbidden(res)
        : errors.unauthorized(res);
    }
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
    // SECURITY FIX (order): Rate-limit before role check (see POST /orgs for rationale).
    await rateLimit(`orgs:invite:${ctx.userId}`, 30);
    requireRole(ctx, ['admin','owner']);

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
    return res.send(await invites.invite(id, email, role));
  } catch (error) {
    // AUDIT-FIX P0: Name-based fallback for cross-module AuthError.
    // Five independent AuthError classes exist (security/jwt, kernel/auth, @errors,
    // control-plane/services/auth, apps/web/lib/auth). instanceof only matches the
    // imported class. The name check catches errors from any AuthError variant.
    if (error instanceof AuthError || (error instanceof Error && error.name === 'AuthError')) {
      const status = error instanceof AuthError ? error.statusCode : 401;
      return status === 403
        ? errors.forbidden(res)
        : errors.unauthorized(res);
    }
    if (error instanceof Error && error.message === 'Rate limit exceeded') {
      return errors.rateLimited(res, 60);
    }
    // FIX (OG-04): ConflictError from duplicate invite must return 409,
    // not fall through to 500.
    if (error instanceof ConflictError) {
      return errors.conflict(res, error.message);
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
    // SECURITY FIX (order): Rate-limit before role check (see POST /orgs for rationale).
    await rateLimit(`orgs:members:add:${ctx.userId}`, 30);
    requireRole(ctx, ['admin','owner']);

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
    // SECURITY FIX (OG-01): Pass ctx.userId as actorUserId so MembershipService
    // enforces the permission hierarchy (actors cannot grant roles above their own).
    // Previously this was called without actorUserId, which bypassed all permission
    // checks inside addMember() entirely.
    await members.addMember(id, userId, role, ctx.userId);
    return res.send({ ok: true });
  } catch (error) {
    // AUDIT-FIX P0: Name-based fallback for cross-module AuthError.
    // Five independent AuthError classes exist (security/jwt, kernel/auth, @errors,
    // control-plane/services/auth, apps/web/lib/auth). instanceof only matches the
    // imported class. The name check catches errors from any AuthError variant.
    if (error instanceof AuthError || (error instanceof Error && error.name === 'AuthError')) {
      const status = error instanceof AuthError ? error.statusCode : 401;
      return status === 403
        ? errors.forbidden(res)
        : errors.unauthorized(res);
    }
    if (error instanceof Error && error.message === 'Rate limit exceeded') {
      return errors.rateLimited(res, 60);
    }
    if (error instanceof ConflictError) {
      return errors.conflict(res, error.message);
    }
    logger.error('[orgs/:id/members] Error', error instanceof Error ? error : new Error(String(error)));
    return errors.internal(res, 'Failed to add member');
  }
  });
}
