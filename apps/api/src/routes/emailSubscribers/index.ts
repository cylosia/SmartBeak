import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../../db';
import { getLogger } from '@kernel/logger';
import { authenticate } from './auth';
import { hashEmail, validateEmailFormat, sanitizeString, escapeLikePattern } from './utils';

const logger = getLogger('email-subscribers');

// P1-SECURITY FIX: Whitelist response columns to prevent leaking internal DB fields
const SUBSCRIBER_RESPONSE_FIELDS = [
  'id', 'email_hash', 'first_name', 'last_name', 'status',
  'tags', 'metadata', 'source', 'created_at', 'updated_at', 'last_activity_at'
] as const;

// Validation schemas
const CreateSubscriberSchema = z.object({
  email: z.string().email('Invalid email format'),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  source: z.string().max(100).optional(),
  doubleOptIn: z.boolean().optional(),
});

const UpdateSubscriberSchema = z.object({
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(['active', 'unsubscribed', 'bounced', 'complained']).optional(),
});

const QueryParamsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['active', 'unsubscribed', 'bounced', 'complained', 'all']).optional(),
  tag: z.string().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['createdAt', 'email', 'lastActivity']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

// Types
interface _AuthContext {
  orgId: string;
  userId: string;
  roles: string[];
}

// P1-SECURITY FIX: Validate domainId from URL params as UUID instead of unsafe cast
const DomainIdParamsSchema = z.object({
  domainId: z.string().uuid('Domain ID must be a valid UUID'),
});

const SubscriberIdParamsSchema = z.object({
  domainId: z.string().uuid('Domain ID must be a valid UUID'),
  subscriberId: z.string().uuid('Subscriber ID must be a valid UUID'),
});

// Check if user can access domain
async function canAccessDomain(userId: string, domainId: string, orgId: string): Promise<boolean> {
  const db = await getDb();
  const row = await db('domain_registry')
    .join('memberships', 'memberships.org_id', 'domain_registry.org_id')
    .where('domain_registry.domain_id', domainId)
    .where('memberships.user_id', userId)
    .where('domain_registry.org_id', orgId)
    .select('memberships.role')
    .first();
  return !!row;
}

/**
 * Email subscriber routes
 */
export async function emailSubscriberRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/domains/:domainId/subscribers - List subscribers for a domain
  app.get('/api/v1/domains/:domainId/subscribers', async (req, reply) => {
    try {
      // P1-SECURITY FIX: Validate domainId as UUID instead of unsafe cast
      const paramsResult = DomainIdParamsSchema.safeParse(req.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid domain ID', details: paramsResult.error.issues });
      }
      const { domainId } = paramsResult.data;
      const auth = await authenticate(req);
      if (!auth) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      
      const hasAccess = await canAccessDomain(auth.userId, domainId, auth.orgId);
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const queryResult = QueryParamsSchema.safeParse(req.query);
      if (!queryResult.success) {
        return reply.status(400).send({ 
          error: 'Invalid query parameters', 
          details: queryResult.error.issues 
        });
      }

      const { page, limit, status, tag, search, sortBy, sortOrder } = queryResult.data;
      const db = await getDb();
      
      let query = db('email_subscribers')
        .where('domain_id', domainId)
        .where('org_id', auth.orgId);

      if (status && status !== 'all') {
        query = query.where('status', status);
      }

      if (tag) {
        query = query.whereRaw('? = ANY(tags)', [tag]);
      }

      if (search) {
        const sanitizedSearch = sanitizeString(search);
        // SECURITY FIX: Properly escape LIKE wildcards and use ESCAPE clause
        const escapedSearch = escapeLikePattern(sanitizedSearch);
        query = query.where(function() {
          void this.where('email_hash', hashEmail(sanitizedSearch))
            .orWhereRaw("first_name ILIKE ? ESCAPE '\\'", [`%${escapedSearch}%`])
            .orWhereRaw("last_name ILIKE ? ESCAPE '\\'", [`%${escapedSearch}%`]);
        });
      }

      // Get total count
      const countResult = await query.clone().count<{ count: string }>('* as count').first();
      const total = parseInt(countResult?.['count'] as string || '0', 10);

      // P0-SQL FIX: Map camelCase sort fields to snake_case DB column names
      const SORT_FIELD_MAP: Record<string, string> = {
        createdAt: 'created_at',
        email: 'email',
        lastActivity: 'last_activity_at',
      };
      const sortField = SORT_FIELD_MAP[sortBy || 'createdAt'] || 'created_at';
      const order = sortOrder || 'desc';
      query = query.orderBy(sortField, order)
        .offset((page - 1) * limit)
        .limit(limit);

      const subscribers = await query.select([
        'id',
        'email_hash',
        'first_name',
        'last_name',
        'status',
        'tags',
        'metadata',
        'source',
        'created_at',
        'updated_at',
        'last_activity_at'
      ]);

      return reply.send({
        data: subscribers,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      logger.error('Error listing subscribers', error instanceof Error ? error : new Error(String(error)));
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // POST /api/v1/domains/:domainId/subscribers - Create a new subscriber
  app.post('/api/v1/domains/:domainId/subscribers', async (req, reply) => {
    try {
      const paramsResult = DomainIdParamsSchema.safeParse(req.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid domain ID', details: paramsResult.error.issues });
      }
      const { domainId } = paramsResult.data;
      const auth = await authenticate(req);
      if (!auth) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      
      const hasAccess = await canAccessDomain(auth.userId, domainId, auth.orgId);
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const parseResult = CreateSubscriberSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({ 
          error: 'Invalid input', 
          details: parseResult.error.issues 
        });
      }

      const { email, firstName, lastName, tags, metadata, source, doubleOptIn } = parseResult.data;
      
      if (!validateEmailFormat(email)) {
        return reply.status(400).send({ error: 'Invalid email format' });
      }

      const emailHash = hashEmail(email.toLowerCase().trim());
      const db = await getDb();

      // P1-CONCURRENCY FIX: Use INSERT ... ON CONFLICT to prevent TOCTOU race condition
      // Two concurrent requests for the same email can no longer both insert
      const now = new Date();
      const subscriber = {
        domain_id: domainId,
        org_id: auth.orgId,
        email_hash: emailHash,
        first_name: firstName || null,
        last_name: lastName || null,
        status: doubleOptIn ? 'pending' : 'active',
        tags: tags || [],
        metadata: metadata || {},
        source: source || 'api',
        created_at: now,
        updated_at: now,
        last_activity_at: now,
      };

      const insertResult = await db('email_subscribers')
        .insert(subscriber)
        .onConflict(['domain_id', 'email_hash'])
        .ignore()
        .returning(SUBSCRIBER_RESPONSE_FIELDS as unknown as string[]);

      if (insertResult.length === 0) {
        return reply.status(409).send({ error: 'Subscriber already exists' });
      }

      const [result] = insertResult;

      logger.info('Subscriber created', { subscriberId: result.id, domainId });
      
      return reply.status(201).send({
        data: result,
        message: doubleOptIn ? 'Confirmation email sent' : 'Subscriber created',
      });
    } catch (error) {
      logger.error('Error creating subscriber', error instanceof Error ? error : new Error(String(error)));
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /api/v1/domains/:domainId/subscribers/:subscriberId - Get a specific subscriber
  app.get('/api/v1/domains/:domainId/subscribers/:subscriberId', async (req, reply) => {
    try {
      const paramsResult = SubscriberIdParamsSchema.safeParse(req.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid parameters', details: paramsResult.error.issues });
      }
      const { domainId, subscriberId } = paramsResult.data;
      const auth = await authenticate(req);
      if (!auth) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      
      const hasAccess = await canAccessDomain(auth.userId, domainId, auth.orgId);
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const db = await getDb();
      // P1-SECURITY FIX: Select only whitelisted columns instead of all columns
      const subscriber = await db('email_subscribers')
        .where('id', subscriberId)
        .where('domain_id', domainId)
        .where('org_id', auth.orgId)
        .select(SUBSCRIBER_RESPONSE_FIELDS as unknown as string[])
        .first();

      if (!subscriber) {
        return reply.status(404).send({ error: 'Subscriber not found' });
      }

      return reply.send({ data: subscriber });
    } catch (error) {
      logger.error('Error fetching subscriber', error instanceof Error ? error : new Error(String(error)));
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // PATCH /api/v1/domains/:domainId/subscribers/:subscriberId - Update a subscriber
  app.patch('/api/v1/domains/:domainId/subscribers/:subscriberId', async (req, reply) => {
    try {
      const paramsResult = SubscriberIdParamsSchema.safeParse(req.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid parameters', details: paramsResult.error.issues });
      }
      const { domainId, subscriberId } = paramsResult.data;
      const auth = await authenticate(req);
      if (!auth) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      
      const hasAccess = await canAccessDomain(auth.userId, domainId, auth.orgId);
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const parseResult = UpdateSubscriberSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({ 
          error: 'Invalid input', 
          details: parseResult.error.issues 
        });
      }

      // P1-CONCURRENCY FIX: Use direct UPDATE...WHERE...RETURNING instead of
      // check-then-act pattern to prevent TOCTOU race condition
      const db = await getDb();

      const updateData: Record<string, unknown> = {
        updated_at: new Date(),
      };

      if (parseResult.data.firstName !== undefined) {
        updateData['first_name'] = parseResult.data.firstName;
      }
      if (parseResult.data.lastName !== undefined) {
        updateData['last_name'] = parseResult.data.lastName;
      }
      if (parseResult.data.tags !== undefined) {
        updateData['tags'] = parseResult.data.tags;
      }
      if (parseResult.data.metadata !== undefined) {
        updateData['metadata'] = parseResult.data.metadata;
      }
      if (parseResult.data.status !== undefined) {
        updateData['status'] = parseResult.data.status;
      }

      const updateResult = await db('email_subscribers')
        .where('id', subscriberId)
        .where('domain_id', domainId)
        .where('org_id', auth.orgId)
        .update(updateData)
        .returning(SUBSCRIBER_RESPONSE_FIELDS as unknown as string[]);

      if (updateResult.length === 0) {
        return reply.status(404).send({ error: 'Subscriber not found' });
      }

      const [result] = updateResult;

      logger.info('Subscriber updated', { subscriberId, domainId });

      return reply.send({ data: result });
    } catch (error) {
      logger.error('Error updating subscriber', error instanceof Error ? error : new Error(String(error)));
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // DELETE /api/v1/domains/:domainId/subscribers/:subscriberId - Delete a subscriber
  app.delete('/api/v1/domains/:domainId/subscribers/:subscriberId', async (req, reply) => {
    try {
      const paramsResult = SubscriberIdParamsSchema.safeParse(req.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid parameters', details: paramsResult.error.issues });
      }
      const { domainId, subscriberId } = paramsResult.data;
      const auth = await authenticate(req);
      if (!auth) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      
      const hasAccess = await canAccessDomain(auth.userId, domainId, auth.orgId);
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      // P1-CONCURRENCY FIX: Use direct DELETE...WHERE with row count check
      // instead of check-then-act to prevent TOCTOU race condition
      const db = await getDb();
      const deleteCount = await db('email_subscribers')
        .where('id', subscriberId)
        .where('domain_id', domainId)
        .where('org_id', auth.orgId)
        .delete();

      if (deleteCount === 0) {
        return reply.status(404).send({ error: 'Subscriber not found' });
      }

      logger.info('Subscriber deleted', { subscriberId, domainId });

      return reply.status(204).send();
    } catch (error) {
      logger.error('Error deleting subscriber', error instanceof Error ? error : new Error(String(error)));
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}

// Export cleanup function for rate limiting
export { cleanupRateLimitStore } from './rateLimit';
