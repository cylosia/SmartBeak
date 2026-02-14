/**
 * Shard Deployment API Routes
 *
 * POST /shards/deploy - Deploy a new version of a site shard
 * POST /shards/:id/rollback - Rollback to a previous version
 * GET /shards/:siteId/versions - List all versions for a site
 *
 * SECURITY FIXES:
 * - P0 #4: Added authorization checks to all routes
 * - P1 #13: Sanitized error messages to prevent information disclosure
 * - P1 #17: Added themeId validation against known themes
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
// @ts-expect-error -- Should use getKnex() async; needs refactor to support lazy init
import { knex } from '../../../packages/database';
import {
  createShardVersion,
  deployShardToVercel,
  listShardVersions,
  rollbackShard,
} from '../../services/shard-deployment';
import { generateShardFiles, ThemeConfig, VALID_THEME_IDS } from '../../services/shard-generator';
import { errors } from '@errors/responses';

/**
 * Verify the authenticated user owns the given siteId.
 * SECURITY FIX P0 #4: Prevent IDOR on shard operations.
 */
async function verifySiteOwnership(
  request: FastifyRequest,
  siteId: string
): Promise<boolean> {
  const user = (request as FastifyRequest & { user?: { orgId?: string } }).user;
  if (!user?.orgId) return false;

  const site = await knex('sites')
    .where({ id: siteId, org_id: user.orgId })
    .first();

  return !!site;
}

export default async function shardRoutes(fastify: FastifyInstance) {

  /**
   * Deploy a new shard version
   */
  fastify.post('/deploy', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as {
        siteId: string;
        themeId: string;
        themeConfig: ThemeConfig;
        vercelProjectId: string;
      };

      // Validate required fields
      if (!body.siteId || !body.themeId || !body.vercelProjectId) {
        return errors.badRequest(reply, 'Missing required fields: siteId, themeId, vercelProjectId');
      }

      // SECURITY FIX P1 #17: Validate themeId against known themes
      if (!VALID_THEME_IDS.includes(body.themeId)) {
        return errors.badRequest(reply, `Invalid themeId. Must be one of: ${VALID_THEME_IDS.join(', ')}`);
      }

      // SECURITY FIX P0 #4: Verify site ownership
      if (!(await verifySiteOwnership(request, body.siteId))) {
        return errors.forbidden(reply);
      }

      // 1. Generate shard files from template
      const files = generateShardFiles(body.themeId, body.themeConfig);

      // 2. Save to storage and database
      const { shardId } = await createShardVersion(
        {
          siteId: body.siteId,
          themeId: body.themeId,
          themeConfig: body.themeConfig as unknown as Record<string, unknown>,
        },
        files
      );

      // 3. Deploy to Vercel
      const deployment = await deployShardToVercel(shardId, body.vercelProjectId);

      if (!deployment.success) {
        return errors.internal(reply, 'Deployment failed');
      }

      return reply.send({
        success: true,
        shardId,
        deploymentId: deployment.deploymentId,
        url: deployment.url,
      });

    } catch (error) {
      // SECURITY FIX P1 #13: Don't expose internal error messages
      fastify.log.error(error);
      return errors.internal(reply);
    }
  });

  /**
   * List all shard versions for a site
   */
  fastify.get('/:siteId/versions', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { siteId } = request.params as { siteId: string };

      // SECURITY FIX P0 #4: Verify site ownership
      if (!(await verifySiteOwnership(request, siteId))) {
        return errors.forbidden(reply);
      }

      const versions = await listShardVersions(siteId);

      return reply.send({
        siteId,
        versions: versions.map((v: { id: string; version: number; status: string; vercel_url: string; created_at: string; deployed_at: string }) => ({
          id: v.id,
          version: v.version,
          status: v.status,
          url: v.vercel_url,
          createdAt: v.created_at,
          deployedAt: v.deployed_at,
        })),
      });

    } catch (error) {
      fastify.log.error(error);
      return errors.internal(reply, 'Failed to fetch versions');
    }
  });

  /**
   * Rollback to a specific version
   */
  fastify.post('/:siteId/rollback', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { siteId } = request.params as { siteId: string };
      const { targetVersion, vercelProjectId } = request.body as {
        targetVersion: number;
        vercelProjectId: string;
      };

      if (!targetVersion || !vercelProjectId) {
        return errors.badRequest(reply, 'Missing required fields: targetVersion, vercelProjectId');
      }

      // SECURITY FIX P0 #4: Verify site ownership
      if (!(await verifySiteOwnership(request, siteId))) {
        return errors.forbidden(reply);
      }

      const result = await rollbackShard(siteId, targetVersion, vercelProjectId);

      if (!result.success) {
        return errors.internal(reply, 'Rollback failed');
      }

      return reply.send({
        success: true,
        deploymentId: result.deploymentId,
        url: result.url,
      });

    } catch (error) {
      fastify.log.error(error);
      return errors.internal(reply, 'Rollback failed');
    }
  });
}
