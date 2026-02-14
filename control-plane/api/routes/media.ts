


import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getLogger } from '@kernel/logger';

import { CompleteUpload } from '../../../domains/media/application/handlers/CompleteUpload';
import { CreateUploadIntent } from '../../../domains/media/application/handlers/CreateUploadIntent';
import { generateSignedUploadUrl, generateStorageKey } from '../../services/storage';
import { PostgresMediaRepository } from '../../../domains/media/infra/persistence/PostgresMediaRepository';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, AuthContext } from '../../services/auth';
import { resolveDomainDb } from '../../services/domain-registry';
import { getPool } from '../../services/repository-factory';
import { errors } from '@errors/responses';

const logger = getLogger('Media');

// Uses EXISTS query which provides constant-time evaluation and doesn't leak
// Information about media existence through timing differences
async function verifyMediaOwnership(userId: string, mediaId: string, pool: Pool): Promise<boolean> {
  const result = await pool.query(
  `SELECT EXISTS(
    SELECT 1 FROM media m
    JOIN memberships mem ON mem.org_id = m.org_id
    WHERE m["id"] = $1 AND mem.user_id = $2
  ) as has_access`,
  [mediaId, userId]
  );
  return result.rows[0]?.has_access === true;
}

// P1 FIX: Allowlist of accepted media MIME types to prevent arbitrary file uploads
const ALLOWED_MEDIA_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm',
  'application/pdf',
] as const;

const UploadIntentBodySchema = z.object({
  id: z.string().uuid(),
  mimeType: z.enum(ALLOWED_MEDIA_TYPES, {
    message: `MIME type must be one of: ${ALLOWED_MEDIA_TYPES.join(', ')}`,
  }),
});

const CompleteUploadParamsSchema = z.object({
  id: z.string().uuid(),
});

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
    requireRole(ctx, ['admin', 'editor']);
    await rateLimit('media', 20, req, res);

    // Validate body
    const bodyResult = UploadIntentBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
    return errors.validationFailed(res, bodyResult["error"].issues);
    }

    const { id, mimeType } = bodyResult.data;
    const storageKey = generateStorageKey('media');

    const repo = new PostgresMediaRepository(getPool(resolveDomainDb('media')));
    const handler = new CreateUploadIntent(repo);
    await handler.execute(id, storageKey, mimeType);

    const signedUrl = generateSignedUploadUrl(storageKey);
    return res.send({ url: signedUrl });
  } catch (error) {
    logger.error('[media/upload-intent] Error:', error instanceof Error ? error : new Error(String(error)));
    // FIX: Added return before reply.send()
    // P1-1 FIX: Do not leak internal error details to clients
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
    await rateLimit('media', 20, req, res);

    // Validate params
    const paramsResult = CompleteUploadParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
    return errors.validationFailed(res, paramsResult["error"].issues);
    }

    const { id } = paramsResult.data;

    const isAuthorized = await verifyMediaOwnership(ctx.userId, id, pool);
    if (!isAuthorized) {
    return errors.notFound(res, 'Media');
    }

    const repo = new PostgresMediaRepository(getPool(resolveDomainDb('media')));
    const handler = new CompleteUpload(repo);

    const event = await handler.execute(id);
    return res.send({ ok: true, event });
  } catch (error) {
    logger.error('[media/complete] Error:', error instanceof Error ? error : new Error(String(error)));
    // FIX: Added return before reply.send()
    // P1-1 FIX: Do not leak internal error details to clients
    return errors.internal(res, 'Failed to complete upload');
  }
  });
}
