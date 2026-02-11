/**
 * Shard Deployment API Routes
 * 
 * POST /shards/deploy - Deploy a new version of a site shard
 * POST /shards/:id/rollback - Rollback to a previous version
 * GET /shards/:siteId/versions - List all versions for a site
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  createShardVersion,
  deployShardToVercel,
  listShardVersions,
  rollbackShard,
} from '../../services/shard-deployment';
import { generateShardFiles, ThemeConfig } from '../../services/shard-generator';

export default async function shardRoutes(fastify: FastifyInstance) {
  
  /**
   * Deploy a new shard version
   * 
   * Request body:
   * {
   *   siteId: string,
   *   themeId: string,
   *   themeConfig: {
   *     siteName: string,
   *     primaryColor: string,
   *     ...
   *   },
   *   vercelProjectId: string
   * }
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
        return reply.status(400).send({
          error: 'Missing required fields: siteId, themeId, vercelProjectId',
        });
      }
      
      // 1. Generate shard files from template
      const files = generateShardFiles(body.themeId, body.themeConfig);
      
      // 2. Save to storage and database
      const { shardId } = await createShardVersion(
        {
          siteId: body.siteId,
          themeId: body.themeId,
          themeConfig: body.themeConfig,
        },
        files
      );
      
      // 3. Deploy to Vercel
      const deployment = await deployShardToVercel(shardId, body.vercelProjectId);
      
      if (!deployment.success) {
        return reply.status(500).send({
          error: 'Deployment failed',
          details: deployment.error,
          shardId,
        });
      }
      
      return reply.send({
        success: true,
        shardId,
        deploymentId: deployment.deploymentId,
        url: deployment.url,
      });
      
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
  
  /**
   * List all shard versions for a site
   */
  fastify.get('/:siteId/versions', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { siteId } = request.params as { siteId: string };
      
      const versions = await listShardVersions(siteId);
      
      return reply.send({
        siteId,
        versions: versions.map(v => ({
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
      return reply.status(500).send({ error: 'Failed to fetch versions' });
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
        return reply.status(400).send({
          error: 'Missing required fields: targetVersion, vercelProjectId',
        });
      }
      
      const result = await rollbackShard(siteId, targetVersion, vercelProjectId);
      
      if (!result.success) {
        return reply.status(500).send({
          error: 'Rollback failed',
          details: result.error,
        });
      }
      
      return reply.send({
        success: true,
        deploymentId: result.deploymentId,
        url: result.url,
      });
      
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Rollback failed' });
    }
  });
}

/**
 * Example usage:
 * 
 * POST /shards/deploy
 * {
 *   "siteId": "site-123",
 *   "themeId": "affiliate-comparison",
 *   "themeConfig": {
 *     "siteName": "Best Tech Reviews",
 *     "primaryColor": "#3b82f6",
 *     "siteDescription": "Honest tech product comparisons"
 *   },
 *   "vercelProjectId": "prj_xxx"
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "shardId": "shard-uuid",
 *   "deploymentId": "dpl_xxx",
 *   "url": "https://best-tech-reviews-xxx.vercel.app"
 * }
 */
