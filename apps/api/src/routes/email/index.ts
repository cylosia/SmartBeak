import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { getLogger } from '@kernel/logger';
import { addSecurityHeaders, whitelistFields } from './utils';

const logger = getLogger('EmailService');
import {
  EmailSchema,
  LeadMagnetSchema,
  SequenceSchema,
  FormSchema,
  EmailSendSchema,
  EmailQuerySchema,
  ALLOWED_LEAD_MAGNET_FIELDS,
  ALLOWED_SEQUENCE_FIELDS,
  ALLOWED_FORM_FIELDS,
  RESPONSE_LEAD_MAGNET_FIELDS,
  RESPONSE_SEQUENCE_FIELDS,
  RESPONSE_FORM_FIELDS,
} from './types';
import { getDb } from '../../db';
import { recordAuditEvent } from './audit';
import { verifyAuth, canAccessDomain } from './auth';

interface AuthContext {
  userId: string;
  orgId: string;
}

export async function emailRoutes(app: FastifyInstance): Promise<void> {
  // POST /email/lead-magnets - Create lead magnet
  app.post('/email/lead-magnets', async (req, reply) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';

    const auth = await verifyAuth(req);
    if (!auth) {
    return reply.status(401).send({ error: 'Unauthorized. Bearer token required.' });
    }

    try {
    const parseResult = LeadMagnetSchema.safeParse(req.body);
    if (!parseResult.success) {
        return reply.status(400).send({
        error: 'Invalid input',
        code: 'VALIDATION_ERROR',
        details: parseResult.error.issues
        });
    }

    const data = whitelistFields(
        parseResult.data,
        ALLOWED_LEAD_MAGNET_FIELDS
    );

    const domainIdStr = data.domain_id;
    if (!domainIdStr) {
        return reply.status(400).send({ error: 'domain_id is required' });
    }
    const hasAccess = await canAccessDomain(auth.userId, domainIdStr, auth.orgId);
    if (!hasAccess) {
        logger.warn('Unauthorized access attempt to create lead magnet', { userId: auth.userId, domainId: domainIdStr });
        return reply.status(403).send({ error: 'Access denied to domain' });
    }

    const db = await getDb();
    // SECURITY FIX: Only return whitelisted fields, not returning('*') which exposes all columns
    const result = await db('lead_magnets').insert(data).returning(RESPONSE_LEAD_MAGNET_FIELDS as unknown as string[]);

    await recordAuditEvent({
        orgId: auth.orgId,
        userId: auth.userId,
        action: 'lead_magnet_created',
        entityType: 'lead_magnet',
        entityId: result[0]?.id,
        metadata: {
        domain_id: domainIdStr,
        name: data.name,
        },
        ip,
    });

    addSecurityHeaders(reply);
    return reply.send(result);
    } catch (error) {
    // P2-MEDIUM FIX: error: unknown with proper type guard
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error creating lead magnet', error instanceof Error ? error : undefined, { message: errorMessage });
    return reply.status(500).send({
        error: 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && error instanceof Error && { message: error.message })
    });
    }
  });

  // GET /email/lead-magnets - List lead magnets
  app.get('/email/lead-magnets', async (req, reply) => {
    const auth = await verifyAuth(req);
    if (!auth) {
    return reply.status(401).send({ error: 'Unauthorized. Bearer token required.' });
    }

    try {
    const queryResult = EmailQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
        return reply.status(400).send({
        error: 'Invalid query parameters',
        code: 'VALIDATION_ERROR',
        details: queryResult.error.issues,
        });
    }

    const { domain_id, limit, offset } = queryResult.data;

    if (domain_id) {
        const hasAccess = await canAccessDomain(auth.userId, domain_id, auth.orgId);
        if (!hasAccess) {
        return reply.status(403).send({ error: 'Access denied to domain' });
        }
    }

    const db = await getDb();
    let query = db('lead_magnets')
        .whereIn('domain_id', function() {
        this.select('domain_id')
            .from('domain_registry')
            .where('org_id', auth.orgId);
        });

    if (domain_id) {
        query = query.where('domain_id', domain_id);
    }

    const total = await query.clone().count('id as count').first();
    const items = await query.limit(limit).offset(offset);

    addSecurityHeaders(reply);
    return reply.send({
        data: items,
        pagination: {
        total: parseInt(String(total?.['count']) || '0', 10),
        }
    });
    } catch (error) {
    // P2-MEDIUM FIX: error: unknown with proper type guard
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error listing lead magnets', error instanceof Error ? error : undefined, { message: errorMessage });
    return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // POST /email/sequences - Create email sequence
  app.post('/email/sequences', async (req, reply) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';

    const auth = await verifyAuth(req);
    if (!auth) {
    return reply.status(401).send({ error: 'Unauthorized. Bearer token required.' });
    }

    try {
    const parseResult = SequenceSchema.safeParse(req.body);
    if (!parseResult.success) {
        return reply.status(400).send({
        error: 'Invalid input',
        code: 'VALIDATION_ERROR',
        details: parseResult.error.issues
        });
    }

    const data = whitelistFields(
        parseResult.data,
        ALLOWED_SEQUENCE_FIELDS
    );

    const domainIdStr = data.domain_id;
    if (!domainIdStr) {
        return reply.status(400).send({ error: 'domain_id is required' });
    }
    const hasAccess = await canAccessDomain(auth.userId, domainIdStr, auth.orgId);
    if (!hasAccess) {
        logger.warn('Unauthorized access attempt to create email sequence', { userId: auth.userId, domainId: domainIdStr });
        return reply.status(403).send({ error: 'Access denied to domain' });
    }

    const db = await getDb();
    // SECURITY FIX: Only return whitelisted fields, not returning('*') which exposes all columns
    const result = await db('email_sequences').insert(data).returning(RESPONSE_SEQUENCE_FIELDS as unknown as string[]);

    await recordAuditEvent({
        orgId: auth.orgId,
        userId: auth.userId,
        action: 'email_sequence_created',
        entityType: 'email_sequence',
        entityId: result[0]?.id,
        metadata: {
        domain_id: domainIdStr,
        name: data.name,
        },
        ip,
    });

    addSecurityHeaders(reply);
    return reply.send(result);
    } catch (error) {
    // P2-MEDIUM FIX: error: unknown with proper type guard
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error creating email sequence', error instanceof Error ? error : undefined, { message: errorMessage });
    return reply.status(500).send({
        error: 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && error instanceof Error && { message: error.message })
    });
    }
  });

  // GET /email/sequences - List email sequences
  app.get('/email/sequences', async (req, reply) => {
    const auth = await verifyAuth(req);
    if (!auth) {
    return reply.status(401).send({ error: 'Unauthorized. Bearer token required.' });
    }

    try {
    const queryResult = EmailQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
        return reply.status(400).send({
        error: 'Invalid query parameters',
        code: 'VALIDATION_ERROR',
        details: queryResult.error.issues,
        });
    }

    const { domain_id, limit, offset } = queryResult.data;

    if (domain_id) {
        const hasAccess = await canAccessDomain(auth.userId, domain_id, auth.orgId);
        if (!hasAccess) {
        return reply.status(403).send({ error: 'Access denied to domain' });
        }
    }

    const db = await getDb();
    let query = db('email_sequences')
        .whereIn('domain_id', function() {
        this.select('domain_id')
            .from('domain_registry')
            .where('org_id', auth.orgId);
        });

    if (domain_id) {
        query = query.where('domain_id', domain_id);
    }

    const total = await query.clone().count('id as count').first();
    const items = await query.limit(limit).offset(offset);

    addSecurityHeaders(reply);
    return reply.send({
        data: items,
        pagination: {
        total: parseInt(String(total?.['count']) || '0', 10),
        }
    });
    } catch (error) {
    // P2-MEDIUM FIX: error: unknown with proper type guard
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error listing email sequences', error instanceof Error ? error : undefined, { message: errorMessage });
    return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // POST /email/forms - Create opt-in form
  app.post('/email/forms', async (req, reply) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';

    const auth = await verifyAuth(req);
    if (!auth) {
    return reply.status(401).send({ error: 'Unauthorized. Bearer token required.' });
    }

    try {
    const parseResult = FormSchema.safeParse(req.body);
    if (!parseResult.success) {
        return reply.status(400).send({
        error: 'Invalid input',
        code: 'VALIDATION_ERROR',
        details: parseResult.error.issues
        });
    }

    const data = whitelistFields(
        parseResult.data,
        ALLOWED_FORM_FIELDS
    );

    const domainIdStr = data.domain_id;
    if (!domainIdStr) {
        return reply.status(400).send({ error: 'domain_id is required' });
    }
    const hasAccess = await canAccessDomain(auth.userId, domainIdStr, auth.orgId);
    if (!hasAccess) {
        logger.warn('Unauthorized access attempt to create opt-in form', { userId: auth.userId, domainId: domainIdStr });
        return reply.status(403).send({ error: 'Access denied to domain' });
    }

    const db = await getDb();
    // SECURITY FIX: Only return whitelisted fields, not returning('*') which exposes all columns
    const result = await db('email_optin_forms').insert(data).returning(RESPONSE_FORM_FIELDS as unknown as string[]);

    await recordAuditEvent({
        orgId: auth.orgId,
        userId: auth.userId,
        action: 'email_optin_form_created',
        entityType: 'email_optin_form',
        entityId: result[0]?.id,
        metadata: {
        domain_id: domainIdStr,
        name: data.name,
        },
        ip,
    });

    addSecurityHeaders(reply);
    return reply.send(result);
    } catch (error) {
    // P2-MEDIUM FIX: error: unknown with proper type guard
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error creating opt-in form', error instanceof Error ? error : undefined, { message: errorMessage });
    return reply.status(500).send({
        error: 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && error instanceof Error && { message: error.message })
    });
    }
  });

  // GET /email/forms - List opt-in forms
  app.get('/email/forms', async (req, reply) => {
    const auth = await verifyAuth(req);
    if (!auth) {
    return reply.status(401).send({ error: 'Unauthorized. Bearer token required.' });
    }

    try {
    const queryResult = EmailQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
        return reply.status(400).send({
        error: 'Invalid query parameters',
        code: 'VALIDATION_ERROR',
        details: queryResult.error.issues,
        });
    }

    const { domain_id, limit, offset } = queryResult.data;

    if (domain_id) {
        const hasAccess = await canAccessDomain(auth.userId, domain_id, auth.orgId);
        if (!hasAccess) {
        return reply.status(403).send({ error: 'Access denied to domain' });
        }
    }

    const db = await getDb();
    let query = db('email_optin_forms')
        .whereIn('domain_id', function() {
        this.select('domain_id')
            .from('domain_registry')
            .where('org_id', auth.orgId);
        });

    if (domain_id) {
        query = query.where('domain_id', domain_id);
    }

    const total = await query.clone().count('id as count').first();
    const items = await query.limit(limit).offset(offset);

    addSecurityHeaders(reply);
    return reply.send({
        data: items,
        pagination: {
        total: parseInt(String(total?.['count']) || '0', 10),
        }
    });
    } catch (error) {
    // P2-MEDIUM FIX: error: unknown with proper type guard
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error listing opt-in forms', error instanceof Error ? error : undefined, { message: errorMessage });
    return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // POST /email/send - Send email
  app.post('/email/send', async (req, reply) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';

    const auth = await verifyAuth(req);
    if (!auth) {
    return reply.status(401).send({ error: 'Unauthorized. Bearer token required.' });
    }

    try {
    const parseResult = EmailSendSchema.safeParse(req.body);
    if (!parseResult.success) {
        return reply.status(400).send({
        error: 'Invalid email parameters',
        code: 'VALIDATION_ERROR',
        details: parseResult.error.issues
        });
    }

    const { to, subject, body, from, reply_to, cc, bcc } = parseResult.data;

    const recipients = Array.isArray(to) ? to : [to];

    // Validate each recipient
    for (const email of recipients) {
        const emailValidation = EmailSchema.safeParse(email);
        if (!emailValidation.success) {
        return reply.status(400).send({
            error: `Invalid recipient email: ${email}`,
            code: 'VALIDATION_ERROR',
        });
        }
    }

    await recordAuditEvent({
        orgId: auth.orgId,
        userId: auth.userId,
        action: 'email_send_attempt',
        entityType: 'email',
        metadata: {
        recipient_count: recipients.length,
        subject: subject.substring(0, 100),
        body_length: body.length,
        },
        ip,
    });

    addSecurityHeaders(reply);
    return reply.send({
        status: 'queued',
        recipients: recipients.length,
        message: 'Email queued for delivery',
    });
    } catch (error) {
    // P2-MEDIUM FIX: error: unknown with proper type guard
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error sending email', error instanceof Error ? error : undefined, { message: errorMessage });
    return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
