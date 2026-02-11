import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDb } from '../../db';
import { getLogger } from '@kernel/logger';
import { rateLimitMiddleware } from './rateLimit';
import { authenticate, requireAuth as requireAuthHandler } from './auth';
import { SubscriberCreateInput, SubscriberUpdateInput, SubscriberQueryParams } from './types';
import { hashEmail, validateEmailFormat, sanitizeString, escapeLikePattern } from './utils';

const logger = getLogger('email-subscribers');

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
interface AuthContext {
  orgId: string;
  userId: string;
  roles: string[];
}

interface AuthenticatedRequest extends FastifyRequest {
  auth?: AuthContext;
}

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
      const { domainId } = req.params as { domainId: string };
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
          this.where('email_hash', hashEmail(sanitizedSearch))
            .orWhereRaw('first_name ILIKE ? ESCAPE \\', [`%${escapedSearch}%`])
            .orWhereRaw('last_name ILIKE ? ESCAPE \\', [`%${escapedSearch}%`]);
        });
      }

      // Get total count
      const countResult = await query.clone().count<{ count: string }>('* as count').first();
      const total = parseInt(countResult?.['count'] as string || '0', 10);

      // Sort and paginate
      const sortField = sortBy || 'createdAt';
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
      logger.error('Error listing subscribers: ' + (error instanceof Error ? error.message : String(error)));
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // POST /api/v1/domains/:domainId/subscribers - Create a new subscriber
  app.post('/api/v1/domains/:domainId/subscribers', async (req, reply) => {
    try {
      const { domainId } = req.params as { domainId: string };
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

      // Check for existing subscriber
      const existing = await db('email_subscribers')
        .where('domain_id', domainId)
        .where('email_hash', emailHash)
        .first();

      if (existing) {
        return reply.status(409).send({ error: 'Subscriber already exists' });
      }

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

      const [result] = await db('email_subscribers')
        .insert(subscriber)
        .returning('*');

      logger.info('Subscriber created', { subscriberId: result.id, domainId });
      
      return reply.status(201).send({
        data: result,
        message: doubleOptIn ? 'Confirmation email sent' : 'Subscriber created',
      });
    } catch (error) {
      logger.error('Error creating subscriber: ' + (error instanceof Error ? error.message : String(error)));
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /api/v1/domains/:domainId/subscribers/:subscriberId - Get a specific subscriber
  app.get('/api/v1/domains/:domainId/subscribers/:subscriberId', async (req, reply) => {
    try {
      const { domainId, subscriberId } = req.params as { domainId: string; subscriberId: string };
      const auth = await authenticate(req);
      if (!auth) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      
      const hasAccess = await canAccessDomain(auth.userId, domainId, auth.orgId);
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const db = await getDb();
      const subscriber = await db('email_subscribers')
        .where('id', subscriberId)
        .where('domain_id', domainId)
        .where('org_id', auth.orgId)
        .first();

      if (!subscriber) {
        return reply.status(404).send({ error: 'Subscriber not found' });
      }

      return reply.send({ data: subscriber });
    } catch (error) {
      logger.error('Error fetching subscriber: ' + (error instanceof Error ? error.message : String(error)));
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // PATCH /api/v1/domains/:domainId/subscribers/:subscriberId - Update a subscriber
  app.patch('/api/v1/domains/:domainId/subscribers/:subscriberId', async (req, reply) => {
    try {
      const { domainId, subscriberId } = req.params as { domainId: string; subscriberId: string };
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

      const db = await getDb();
      const existing = await db('email_subscribers')
        .where('id', subscriberId)
        .where('domain_id', domainId)
        .where('org_id', auth.orgId)
        .first();

      if (!existing) {
        return reply.status(404).send({ error: 'Subscriber not found' });
      }

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

      const [result] = await db('email_subscribers')
        .where('id', subscriberId)
        .update(updateData)
        .returning('*');

      logger.info('Subscriber updated', { subscriberId, domainId });
      
      return reply.send({ data: result });
    } catch (error) {
      logger.error('Error updating subscriber: ' + (error instanceof Error ? error.message : String(error)));
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // DELETE /api/v1/domains/:domainId/subscribers/:subscriberId - Delete a subscriber
  app.delete('/api/v1/domains/:domainId/subscribers/:subscriberId', async (req, reply) => {
    try {
      const { domainId, subscriberId } = req.params as { domainId: string; subscriberId: string };
      const auth = await authenticate(req);
      if (!auth) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      
      const hasAccess = await canAccessDomain(auth.userId, domainId, auth.orgId);
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const db = await getDb();
      const existing = await db('email_subscribers')
        .where('id', subscriberId)
        .where('domain_id', domainId)
        .where('org_id', auth.orgId)
        .first();

      if (!existing) {
        return reply.status(404).send({ error: 'Subscriber not found' });
      }

      await db('email_subscribers')
        .where('id', subscriberId)
        .delete();

      logger.info('Subscriber deleted', { subscriberId, domainId });
      
      return reply.status(204).send();
    } catch (error) {
      logger.error('Error deleting subscriber: ' + (error instanceof Error ? error.message : String(error)));
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}

// Export cleanup function for rate limiting
export { cleanupRateLimitStore } from './rateLimit';
