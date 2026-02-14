import { FastifyInstance, FastifyRequest } from 'fastify';
import { Pool } from 'pg';

import { getLogger } from '@kernel/logger';
import { PublishingPreviewService } from '../../services/publishing-preview';
import { requireRole, AuthContext, RoleAccessError } from '../../services/auth';
import { errors } from '@errors/responses';
import { ErrorCodes } from '@errors';

const logger = getLogger('publishing-preview');




/**
* Query parameters for preview requests
*/
export interface PreviewQueryParams {
  content_id?: string;
  org_id?: string;
}

/**
* Authenticated request with typed params
*/
export type AuthenticatedRequest = FastifyRequest & {
  auth?: AuthContext | undefined;
};

/**
* @openapi
* /publishing/preview/facebook:
*   get:
*     summary: Get Facebook preview for content
*     tags: [Publishing]
*     security:
*       - bearerAuth: []
*     parameters:
*       - name: content_id
*         in: query
*         required: true
*         schema:
*           type: string
*           format: uuid
*     responses:
*       200:
*         description: Preview generated
*       400:
*         description: Invalid request
*       403:
*         description: Forbidden
*
*/
export async function publishingPreviewRoutes(app: FastifyInstance, pool: Pool) {
  const svc = new PublishingPreviewService(pool);

  app.get('/publishing/preview/facebook', async (req, res) => {
  try {
    const { auth: ctx, query } = req as AuthenticatedRequest & { query: PreviewQueryParams };
    if (!ctx) {
    return errors.unauthorized(res);
    }
    requireRole(ctx, ['owner','admin','editor','viewer']);

    const content_id = query.content_id;
    if (!content_id || typeof content_id !== 'string') {
    return errors.badRequest(res, 'Missing required parameter: content_id', ErrorCodes.MISSING_PARAMETER);
    }

    const result = await svc.facebookPreview(content_id, ctx["orgId"]);
    return res.send(result);
  } catch (error) {
    if (error instanceof RoleAccessError) {
    return errors.forbidden(res);
    }
    console["error"]('Route error:', error);
    return errors.internal(res);
  }
  });
}
