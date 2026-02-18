

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getLogger } from '@kernel/logger';

import { CompleteUpload } from '../../../domains/media/application/handlers/CompleteUpload';
import { CreateUploadIntent } from '../../../domains/media/application/handlers/CreateUploadIntent';
import { generateSignedUploadUrl, generateStorageKey } from '../../services/storage';
import { PostgresMediaRepository } from '../../../domains/media/infra/persistence/PostgresMediaRepository';
import { checkRateLimitAsync } from '../../services/rate-limit';
import { requireRole, RoleAccessError, AuthContext } from '../../services/auth';
import { errors } from '@errors/responses';

const logger = getLogger('Media');

// P1-FIX: Added explicit orgId parameter so the query asserts the asset belongs
// to the authenticated user's org directly, rather than relying on an implicit
// join condition (which would silently break if the memberships schema changes).
// Without the explicit org_id = $3 predicate a user in org-A who obtained a
// media UUID from org-B would pass this check if the join happened to resolve.
async function verifyMediaOwnership(userId: string, mediaId: string, orgId: string, pool: Pool): Promise<boolean> {
  const result = await pool.query(
    `SELECT EXISTS(
      SELECT 1 FROM media_assets m
      JOIN memberships mem ON mem.org_id = m.org_id
      WHERE m.id = $1 AND mem.user_id = $2 AND m.org_id = $3
    ) as has_access`,
    [mediaId, userId, orgId]
  );
  return result.rows[0]?.['has_access'] === true;
}

// P1-15 FIX: Remove SVG from allowed types (XSS vector)
const ALLOWED_MEDIA_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm',
  'application/pdf',
] as const;

// P2-1 FIX: Add .strict() to reject extra properties
// P0-6 FIX: Remove client-controlled id; server generates the ID
// P1-1 FIX: Server generates ID to prevent client-controlled ID attacks
const UploadIntentBodySchema = z.object({
  mimeType: z.enum(ALLOWED_MEDIA_TYPES, {
    message: `MIME type must be one of: ${ALLOWED_MEDIA_TYPES.join(', ')}`,
  }),
}).strict();

const CompleteUploadParamsSchema = z.object({
  id: z.string().uuid(),
}).strict();

export type AuthenticatedRequest = FastifyRequest & {
  auth?: AuthContext | undefined;
};

/**
* Media routes
*/
export async function mediaRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  // P0-FIX: Use the passed `pool` parameter throughout instead of calling
  // getPool(resolveDomainDb('media')) on every request.  The previous code
  // silently discarded the caller's pool and resolved a fresh one each time,
  // making it impossible to inject a controlled pool in tests or transactions.
  const repo = new PostgresMediaRepository(pool);

  app.post('/media/upload-intent', async (
    req: FastifyRequest,
    res: FastifyReply
  ): Promise<void> => {
    try {
      const { auth: ctx } = req as AuthenticatedRequest;
      if (!ctx) {
        return errors.unauthorized(res);
      }
      // P0-3 FIX: Catch RoleAccessError before generic catch
      requireRole(ctx, ['admin', 'editor']);
      // FIX(P0): Use checkRateLimitAsync to avoid double-send: the legacy 4-arg
      // rateLimit overload sends 429 directly then rejects, which caused the outer
      // catch block to attempt a second response (500) on an already-replied request.
      const rlResult = await checkRateLimitAsync(`media:${ctx.userId}`, 'media.upload');
      if (!rlResult.allowed) {
        // P2-FIX: Use errors.rateLimited for canonical shape (code, requestId, Retry-After header)
        return errors.rateLimited(res, Math.ceil((rlResult.resetTime - Date.now()) / 1000));
      }

      const bodyResult = UploadIntentBodySchema.safeParse(req.body);
      if (!bodyResult.success) {
        return errors.validationFailed(res, bodyResult['error'].issues);
      }

      const { mimeType } = bodyResult.data;
      // P0-6 FIX: Server generates ID - no client-controlled IDs
      const id = crypto.randomUUID();
      const storageKey = generateStorageKey('media');

      const handler = new CreateUploadIntent(repo);
      // P1-14 FIX: Check handler result for errors
      const result = await handler.execute(id, storageKey, mimeType);
      if (!result.success) {
        return errors.validationFailed(res, [{ message: result.error || 'Upload intent creation failed' }]);
      }

      // P1-FIX: Destructure the SignedUrlResult so `url` is the string, not the
      // full object.  Previously `res.send({ id, url: signedUrl })` sent
      // `{ id, url: { url: "https://...", expiresIn: 300 } }` — a nested object
      // that caused every subsequent PUT to the signed URL to fail because clients
      // treated `response.url` as a string and called `.startsWith()` on an object.
      const { url, expiresIn } = generateSignedUploadUrl(storageKey);
      return res.send({ id, url, expiresIn });
    } catch (error) {
      // P0-3 FIX: Surface RoleAccessError as 403 instead of masking as 500
      if (error instanceof RoleAccessError) {
        return errors.forbidden(res, error.message);
      }
      logger.error('[media/upload-intent] Error:', error instanceof Error ? error : new Error(String(error)));
      return errors.internal(res, 'Failed to create upload intent');
    }
  });

  app.post('/media/:id/complete', async (
    req: FastifyRequest,
    res: FastifyReply
  ): Promise<void> => {
    try {
      const { auth: ctx } = req as AuthenticatedRequest;
      if (!ctx) {
        return errors.unauthorized(res);
      }
      requireRole(ctx, ['admin', 'editor']);
      // FIX(P0): same double-send fix as upload-intent route above
      const rlResult = await checkRateLimitAsync(`media:${ctx.userId}`, 'media.complete');
      if (!rlResult.allowed) {
        // P2-FIX: Use errors.rateLimited for canonical shape (code, requestId, Retry-After header)
        return errors.rateLimited(res, Math.ceil((rlResult.resetTime - Date.now()) / 1000));
      }

      const paramsResult = CompleteUploadParamsSchema.safeParse(req.params);
      if (!paramsResult.success) {
        return errors.validationFailed(res, paramsResult['error'].issues);
      }

      const { id } = paramsResult.data;

      // P1-FIX: Pass ctx.orgId to explicitly assert the asset belongs to the
      // authenticated user's org (not relying on implicit join condition alone).
      const isAuthorized = await verifyMediaOwnership(ctx.userId, id, ctx.orgId, pool);
      if (!isAuthorized) {
        return errors.notFound(res, 'Media');
      }

      const handler = new CompleteUpload(repo);

      // FIX(P0): Check result.success — handler never throws; failures return
      // { success: false, error: '...' }. Previously a failed completion would
      // still return { ok: true, event: undefined } to the caller.
      const result = await handler.execute(id);
      if (!result.success) {
        return errors.validationFailed(res, [{ message: 'Upload completion failed' }]);
      }
      // FIX(P1): Return a stable public DTO: extract only occurredAt from the
      // DomainEventEnvelope to avoid leaking internal topology fields
      // (meta.source, meta.domainId, version) to API consumers.
      const completedAt = result.event?.occurredAt ?? null;
      return res.send({ ok: true, mediaId: id, completedAt });
    } catch (error) {
      // P0-3 FIX: Surface RoleAccessError as 403
      if (error instanceof RoleAccessError) {
        return errors.forbidden(res, error.message);
      }
      logger.error('[media/complete] Error:', error instanceof Error ? error : new Error(String(error)));
      return errors.internal(res, 'Failed to complete upload');
    }
  });
}
