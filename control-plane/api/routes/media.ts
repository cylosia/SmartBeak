


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

const UploadIntentBodySchema = z.object({
  id: z.string().uuid(),
  mimeType: z.string().min(1),
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
    return res.status(401).send({ error: 'Unauthorized' });
    }
    requireRole(ctx, ['admin', 'editor']);
    await rateLimit('media', 20, req, res);

    // Validate body
    const bodyResult = UploadIntentBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
    res.status(400).send({
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details: bodyResult["error"].issues
    });
    return;
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
    return res.status(500).send({
    error: 'Failed to create upload intent',
    message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
  });

  app.post('/media/:id/complete', async (
  req: FastifyRequest,
  res: FastifyReply
  ): Promise<void> => {
  try {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return res.status(401).send({ error: 'Unauthorized' });
    }
    requireRole(ctx, ['admin', 'editor']);
    await rateLimit('media', 20, req, res);

    // Validate params
    const paramsResult = CompleteUploadParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
    res.status(400).send({
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details: paramsResult["error"].issues
    });
    return;
    }

    const { id } = paramsResult.data;

    const isAuthorized = await verifyMediaOwnership(ctx.userId, id, pool);
    if (!isAuthorized) {
    res.status(404).send({
    error: 'Media not found',
    code: 'NOT_FOUND'
    });
    return;
    }

    const repo = new PostgresMediaRepository(getPool(resolveDomainDb('media')));
    const handler = new CompleteUpload(repo);

    const event = await handler.execute(id);
    return res.send({ ok: true, event });
  } catch (error) {
    logger.error('[media/complete] Error:', error instanceof Error ? error : new Error(String(error)));
    // FIX: Added return before reply.send()
    return res.status(500).send({
    error: 'Failed to complete upload',
    message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
  });
}
