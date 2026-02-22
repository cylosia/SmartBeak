

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { CompleteUpload } from '../../../domains/media/application/handlers/CompleteUpload';
import { CreateUploadIntent } from '../../../domains/media/application/handlers/CreateUploadIntent';
import { generateSignedUploadUrl, generateStorageKey } from '../../services/storage';
import { PostgresMediaRepository } from '../../../domains/media/infra/persistence/PostgresMediaRepository';
import { checkRateLimitAsync } from '../../services/rate-limit';
import { requireRole, AuthContext } from '../../services/auth';
import { resolveDomainDb } from '../../services/domain-registry';
import { getPool } from '../../services/repository-factory';
import { errors } from '@errors/responses';

// P1-3 FIX: Use the same pool for ownership verification and operations
async function verifyMediaOwnership(userId: string, mediaId: string, pool: Pool): Promise<boolean> {
  const result = await pool.query(
    `SELECT EXISTS(
      SELECT 1 FROM media_assets m
      JOIN memberships mem ON mem.org_id = m.org_id
      WHERE m.id = $1 AND mem.user_id = $2
    ) as has_access`,
    [mediaId, userId]
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
  app.post('/media/upload-intent', async (
    req: FastifyRequest,
    res: FastifyReply
  ): Promise<void> => {
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
      return res.status(429).send({ error: 'Too many requests', retryAfter: Math.ceil((rlResult.resetTime - Date.now()) / 1000) });
    }

    const bodyResult = UploadIntentBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return errors.validationFailed(res, bodyResult['error'].issues);
    }

    const { mimeType } = bodyResult.data;
    // P0-6 FIX: Server generates ID - no client-controlled IDs
    const id = crypto.randomUUID();
    const storageKey = generateStorageKey('media');

    // P1-3 FIX: Use same pool instance for all operations
    const domainPool = getPool(resolveDomainDb('media'));
    const repo = new PostgresMediaRepository(domainPool);
    const handler = new CreateUploadIntent(repo);
    // P1-14 FIX: Check handler result for errors
    const result = await handler.execute(id, storageKey, mimeType);
    if (!result.success) {
      return errors.validationFailed(res, [{ message: result.error || 'Upload intent creation failed' }]);
    }

    const signedUrl = generateSignedUploadUrl(storageKey);
    return res.send({ id, url: signedUrl });
  });

  app.post('/media/:id/complete', async (
    req: FastifyRequest,
    res: FastifyReply
  ): Promise<void> => {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
      return errors.unauthorized(res);
    }
    requireRole(ctx, ['admin', 'editor']);
    // FIX(P0): same double-send fix as upload-intent route above
    const rlResult = await checkRateLimitAsync(`media:${ctx.userId}`, 'media.complete');
    if (!rlResult.allowed) {
      return res.status(429).send({ error: 'Too many requests', retryAfter: Math.ceil((rlResult.resetTime - Date.now()) / 1000) });
    }

    const paramsResult = CompleteUploadParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
      return errors.validationFailed(res, paramsResult['error'].issues);
    }

    const { id } = paramsResult.data;

    // P1-3 FIX: Use same pool for ownership check and operations
    const domainPool = getPool(resolveDomainDb('media'));
    const isAuthorized = await verifyMediaOwnership(ctx.userId, id, domainPool);
    if (!isAuthorized) {
      return errors.notFound(res, 'Media');
    }

    const repo = new PostgresMediaRepository(domainPool);
    const handler = new CompleteUpload(repo);

    // FIX(P0): Check result.success — handler never throws; failures return
    // { success: false, error: '...' }. Previously a failed completion would
    // still return { ok: true, event: undefined } to the caller.
    const result = await handler.execute(id);
    if (!result.success) {
      return errors.validationFailed(res, [{ message: 'Upload completion failed' }]);
    }
    // FIX(P1): Return a stable public DTO instead of the raw DomainEventEnvelope,
    // which exposed internal topology (meta.source, meta.domainId, version).
    return res.send({ ok: true, mediaId: id, completedAt: result.event?.occurredAt });
  });
}
