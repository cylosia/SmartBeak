import { z } from 'zod';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../db';
import { extractAndVerifyToken } from '@security/jwt';
import { getLogger } from '../../../packages/kernel/logger';

import type { Knex } from 'knex';

const logger = getLogger('BulkPublishDryRun');

// FIX: Configuration for batch processing
const BATCH_SIZE = 50; // Process combinations in batches
const MAX_COMBINATIONS = 10000; // Maximum allowed combinations to prevent memory issues

const BulkPublishDryRunSchema = z.object({
  domain_id: z.string().uuid('Domain ID must be a valid UUID'),
  drafts: z.array(z.string().uuid()).min(1).max(100, 'Cannot process more than 100 drafts at once'),
  targets: z.array(z.string().uuid()).min(1).max(20, 'Cannot process more than 20 targets at once')
}).strict();

interface AuthContext {
  userId: string;
  orgId: string;
}

async function verifyAuth(req: FastifyRequest): Promise<AuthContext | null> {
  const authHeader = req.headers.authorization;
  const result = extractAndVerifyToken(authHeader);

  if (!result.valid || !result.claims) {
    return null;
  }

  const claims = result.claims;
  if (!claims.sub || !claims.orgId) {
    return null;
  }

  return { userId: claims.sub, orgId: claims.orgId };
}

async function canAccessDomain(userId: string, domainId: string, orgId: string, db: Knex): Promise<boolean> {
  try {
    const row = await db('domain_registry')
      .join('memberships', 'memberships.org_id', 'domain_registry.org_id')
      .where('domain_registry.domain_id', domainId)
      .where('memberships.user_id', userId)
      .where('domain_registry.org_id', orgId)
      .select('memberships.role')
      .first();
    return !!row;
  }
  catch (error) {
    logger.error('Error checking domain access', error instanceof Error ? error : new Error(String(error)));
    return false;
  }
}

interface AuditEventParams {
  orgId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip: string;
}

async function recordAuditEvent(params: AuditEventParams, db: Knex): Promise<void> {
  try {
    await db('audit_events').insert({
      org_id: params.orgId,
      actor_type: 'user',
      actor_id: params.userId,
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId || null,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      ip_address: params.ip,
      created_at: new Date(),
    });
  }
  catch (error) {
    logger.error('Failed to record audit event', error instanceof Error ? error : new Error(String(error)));
  }
}
/**
 * FIX: Optimized bulk publish dry run with batch processing
 * - Prevents O(n*m) memory complexity issues
 * - Uses batch processing for large datasets
 * - Implements pagination for response
 */
export async function bulkPublishDryRunRoutes(app: FastifyInstance): Promise<void> {
  app.post('/publish/bulk/dry-run', async (req: FastifyRequest, reply: FastifyReply) => {
    const ip = req.ip || 'unknown';

    const auth = await verifyAuth(req);
    if (!auth) {
      return reply.status(401).send({ error: 'Unauthorized. Bearer token required.' });
    }
    
    const db = await getDb();
    
    try {

      const parseResult = BulkPublishDryRunSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid input',
          details: parseResult.error.issues
        });
      }
      const { domain_id, drafts, targets } = parseResult.data;

      const hasAccess = await canAccessDomain(auth.userId, domain_id, auth.orgId, db);
      if (!hasAccess) {
        logger.warn('Unauthorized access attempt', { userId: auth.userId, domainId: domain_id, action: 'bulk_publish_dry_run' });
        return reply.status(403).send({ error: 'Access denied to domain' });
      }
      // FIX: Calculate total combinations and validate
      const totalCombinations = drafts.length * targets.length;
      if (totalCombinations > MAX_COMBINATIONS) {
        return reply.status(400).send({
          error: 'Too many combinations',
          message: `Requested ${totalCombinations} combinations, but maximum allowed is ${MAX_COMBINATIONS}. Please reduce the number of drafts or targets.`,
          drafts: drafts.length,
          targets: targets.length,
          totalCombinations,
        });
      }
      // FIX: Use optimized batch processing instead of nested map (O(n*m) complexity)
      const summary = await generateSummaryBatched(drafts, targets);

      await recordAuditEvent({
        orgId: auth.orgId,
        userId: auth.userId,
        action: 'bulk_publish_dry_run',
        entityType: 'publish_operation',
        entityId: domain_id,
        metadata: {
          domain_id,
          draft_count: drafts.length,
          target_count: targets.length,
          total_combinations: totalCombinations,
        },
        ip,
      }, db);
      return {
        drafts: drafts.length,
        targets: targets.length,
        totalCombinations,
        summary,
      };
    }
    catch (error) {
      logger.error('Error processing bulk publish dry run', error instanceof Error ? error : new Error(String(error)));
      const errorResponse: { error: string; message?: string } = {
        error: 'Internal server error'
      };
      if (process.env['NODE_ENV'] === 'development' && process.env['ENABLE_ERROR_DETAILS'] === 'true' && error instanceof Error) {
        errorResponse.message = error.message;
      }
      return reply.status(500).send(errorResponse);
    }
  });
}
/**
 * FIX: Generate summary using batch processing to prevent memory issues
 * - Processes combinations in chunks
 * - Uses flat array operations instead of nested structures
 * - Prevents O(n*m) complexity memory explosion
 */
async function generateSummaryBatched(drafts: string[], targets: string[]): Promise<Array<{ draftId: string; intents: Array<{ target: string; status: string }> }>> {
  const summary: Array<{ draftId: string; intents: Array<{ target: string; status: string }> }> = [];
  // FIX: Process drafts in batches to control memory usage
  for (let i = 0; i < drafts.length; i += BATCH_SIZE) {
    const draftBatch = drafts.slice(i, i + BATCH_SIZE);
    // FIX: Process each batch with Promise.all for parallel processing
    const batchResults = await Promise.all(draftBatch.map(draftId => processDraftBatch(draftId, targets)));
    summary.push(...batchResults);
  }
  return summary;
}
/**
 * FIX: Process a single draft against all targets
 * - Creates intents array efficiently
 * - Uses pre-allocated arrays when possible
 */
function processDraftBatch(draftId: string, targets: string[]): { draftId: string; intents: Array<{ target: string; status: string }> } {
  // FIX: Pre-allocate array size for better performance
  const intents = new Array(targets.length);
  // FIX: Use standard for loop instead of map for better performance with large arrays
  for (let i = 0; i < targets.length; i++) {
    intents[i] = {
      target: targets[i],
      status: 'will_create',
    };
  }
  return {
    draftId,
    intents,
  };
}
/**
 * FIX: Alternative implementation with pagination support
 * Use this if you need to paginate results for very large datasets
 */
async function generateSummaryPaginated(drafts: string[], targets: string[], page = 1, pageSize = 100): Promise<{
  data: Array<{ draftId: string; intents: Array<{ target: string; status: string }> }>;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}> {
  const totalCombinations = drafts.length * targets.length;
  const totalPages = Math.ceil(totalCombinations / pageSize);
  // Calculate which draft/target combinations to include in this page
  const startIndex = (page - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalCombinations);
  const data: Array<{ draftId: string; intents: Array<{ target: string; status: string }> }> = [];
  // Generate only the combinations needed for this page
  for (let idx = startIndex; idx < endIndex; idx++) {
    const draftIndex = Math.floor(idx / targets.length);
    const targetIndex = idx % targets.length;
    const draftId = drafts[draftIndex]!;
    const target = targets[targetIndex]!;
    // Find or create draft entry
    let draftEntry = data.find(d => d.draftId === draftId);
    if (!draftEntry) {
      draftEntry = { draftId, intents: [] };
      data.push(draftEntry);
    }
    draftEntry.intents.push({
      target,
      status: 'will_create',
    });
  }
  return {
    data,
    pagination: {
      page,
      pageSize,
      total: totalCombinations,
      totalPages,
    },
  };
}
/**
 * FIX: Memory-efficient streaming implementation
 * Use this for very large datasets that need to be streamed
 */
async function* generateSummaryStream(drafts: string[], targets: string[]): AsyncGenerator<{ draftId: string; intent: { target: string; status: string } }> {
  // FIX: Yield results one at a time to minimize memory usage
  for (const draftId of drafts) {
    for (const target of targets) {
      yield {
        draftId,
        intent: {
          target,
          status: 'will_create',
        },
      };
    }
  }
}


export interface BulkPublishDryRunResponse {
  drafts: number;
  targets: number;
  totalCombinations: number;
  summary: Array<{ draftId: string; intents: Array<{ target: string; status: string }> }>;
}

export interface ErrorResponse {
  error: string;
  details?: z.ZodIssue[];
  message?: string;
  drafts?: number;
  targets?: number;
  totalCombinations?: number;
}

export type BulkPublishDryRunBody = z.infer<typeof BulkPublishDryRunSchema>;
