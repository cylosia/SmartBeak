

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getLogger } from '@kernel/logger';

import { CompleteUpload } from '../../../domains/media/application/handlers/CompleteUpload';
import { CreateUploadIntent } from '../../../domains/media/application/handlers/CreateUploadIntent';
import { generateSignedUploadUrl, generateStorageKey } from '../../services/storage';
import { PostgresMediaRepository } from '../../../domains/media/infra/persistence/PostgresMediaRepository';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, RoleAccessError, AuthContext } from '../../services/auth';
import { resolveDomainDb } from '../../services/domain-registry';
import { getPool } from '../../services/repository-factory';
import { errors } from '@errors/responses';

const logger = getLogger('Media');

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
    try {
      const { auth: ctx } = req as AuthenticatedRequest;
      if (!ctx) {
        return errors.unauthorized(res);
      }
      // P0-3 FIX: Catch RoleAccessError before generic catch
      requireRole(ctx, ['admin', 'editor']);
      // P1-16 FIX: Per-user rate limiting
      await rateLimit(`media:${ctx.userId}`, 20, req, res);

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
      await rateLimit(`media:${ctx.userId}`, 20, req, res);

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

      const event = await handler.execute(id);
      return res.send({ ok: true, event });
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
