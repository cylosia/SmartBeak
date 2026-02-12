
import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';

import { getLogger } from '../../../../packages/kernel/logger';
import { requireEnv } from '../../../lib/env';

const logger = getLogger('ClerkWebhook');
// F16-FIX: Use the shared Redis client from @kernel/redis instead of creating
// a standalone connection. The standalone client had no environment-based key
// prefix, so prod and staging shared the same dedup namespace when using the
// same Redis instance, causing cross-environment webhook dedup collisions.
import { getRedis } from '../../../../packages/kernel/redis';

/**
* Maximum allowed payload size for webhooks (10MB)
* SECURITY FIX: P1 - Backpressure protection against memory exhaustion
*/
const MAX_PAYLOAD_SIZE = 10 * 1024 * 1024; // 10MB

/**
* Read raw body from Next.js request
* Required because bodyParser is disabled for webhook signature verification
* SECURITY FIX: P1 - Track payload size and reject if exceeded
*/
async function getRawBody(req: NextApiRequest, res: NextApiResponse): Promise<string> {
  const chunks: Buffer[] = [];
  let totalSize = 0;

  return new Promise((resolve, reject) => {
  req.on('data', (chunk: Buffer) => {
    totalSize += chunk.length;
    if (totalSize > MAX_PAYLOAD_SIZE) {
      res.status(413).json({ error: 'Payload too large' });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', () => {
    const rawBody = Buffer.concat(chunks).toString('utf8');
    resolve(rawBody);
  });

  req.on('error', (err) => {
    reject(err);
  });
  });
}

/**
* Verifies Clerk webhook signature using Svix-compatible verification
* Clerk webhooks use Svix format: https://docs.svix.com/receiving/verifying-payloads/how-manual
*
* Headers:
* - svix-id: Unique webhook ID
* - svix-timestamp: Unix timestamp
* - svix-signature: v1,<base64_signature>
*/
function verifyClerkWebhook(
  payload: string,
  headers: {
  'svix-id'?: string;
  'svix-timestamp'?: string;
  'svix-signature'?: string;
  }
): boolean {
  const secret = requireEnv('CLERK_WEBHOOK_SECRET');

  const id = headers['svix-id'];
  const timestamp = headers['svix-timestamp'];
  const signature = headers['svix-signature'];

  if (!id || !timestamp || !signature) {
  logger.warn('Missing Svix headers');
  return false;
  }

  // Check timestamp to prevent replay attacks (allow 5 minute window)
  const now = Math.floor(Date.now() / 1000);
  const webhookTimestamp = parseInt(timestamp, 10);
  if (isNaN(webhookTimestamp)) {
  logger.warn('Invalid timestamp');
  return false;
  }
  
  // P1-HIGH FIX: Check if timestamp is too old (older than 5 minutes)
  if (now - webhookTimestamp > 300) {
  logger.warn('Timestamp too old');
  return false;
  }
  
  // P1-HIGH FIX: Check if timestamp is in the future (allow 30s tolerance for clock skew)
  if (webhookTimestamp > now + 30) {
  logger.warn('Timestamp in future');
  return false;
  }

  // Construct signed content (svix-id.svix-timestamp.body)
  const signedContent = `${id}.${timestamp}.${payload}`;

  // Clerk webhooks use base64-encoded secret
  // The secret starts with 'whsec_' and needs to be base64 decoded
  let secretBytes: Buffer;
  if (secret.startsWith('whsec_')) {
  secretBytes = Buffer.from(secret.slice(6), 'base64');
  } else {
  secretBytes = Buffer.from(secret, 'base64');
  }

  // Compute expected signature
  const expectedSignature = crypto
  .createHmac('sha256', secretBytes)
  .update(signedContent)
  .digest('base64');

  // Parse signature header (format: 'v1,<signature>[,v1,<signature...]')
  // SECURITY FIX: P0-CRITICAL - Use constant-time comparison to prevent timing attacks
  const expectedSigBuffer = Buffer.from(expectedSignature, 'base64');
  const signatures = signature.split(' ');
  let matched = false;

  for (const sig of signatures) {
  const [version, sigValue] = sig.split(',');
  if (version === 'v1' && sigValue) {
    try {
    const actualSigBuffer = Buffer.from(sigValue, 'base64');
    if (actualSigBuffer.length === expectedSigBuffer.length &&
        crypto.timingSafeEqual(actualSigBuffer, expectedSigBuffer)) {
      matched = true;
    }
    } catch {
    // Invalid base64 - continue to next signature
    }
  }
  }

  if (!matched) {
  logger.warn('Signature mismatch');
  }
  return matched;
}

export interface ClerkWebhookEvent {
  data: {
  id: string;
  email_addresses?: Array<{ email_address: string }>;
  first_name?: string;
  last_name?: string;
  organization_id?: string;
  public_metadata?: Record<string, unknown>;
  };
  object: 'event';
  type: string;
}

/**
* POST /api/webhooks/clerk
* Handles Clerk webhook events for user and organization management
*
* Events handled:
* - user.created: Create internal user record
* - user.updated: Update user metadata
* - user.deleted: Soft delete user
* - organizationMembership.created: Add user to org
* - organizationMembership.deleted: Remove user from org
*/
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
  return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
  // Get raw body for signature verification
  const rawBody = await getRawBody(req, res);

  // Parse the body after getting raw bytes for signature verification
  const event = JSON.parse(rawBody) as ClerkWebhookEvent;

  // Extract and validate headers
  const svixId = req.headers['svix-id'];
  const svixTimestamp = req.headers['svix-timestamp'];
  const svixSignature = req.headers['svix-signature'];

  if (typeof svixId !== 'string' || typeof svixTimestamp !== 'string' || typeof svixSignature !== 'string') {
    return res.status(400).json({ error: 'Missing required Svix headers' });
  }

  // Verify webhook signature
  const isValid = verifyClerkWebhook(rawBody, {
    'svix-id': svixId,
    'svix-timestamp': svixTimestamp,
    'svix-signature': svixSignature,
  });

  if (!isValid) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  // Validate event structure
  if (!event.type || !event.data?.["id"]) {
    return res.status(400).json({ error: 'Invalid event structure' });
  }

  // P0-FIX: Event deduplication - prevent replay attacks and double processing
  const eventId = `${svixId}:${event.type}`;
  const redis = await getRedis().catch(() => null);
  if (!redis) {
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  }
  const dedupeKey = `webhook:clerk:${eventId}`;
  const alreadyProcessed = await redis.get(dedupeKey);
  
  if (alreadyProcessed) {
    logger.info('Duplicate event ignored', { eventId });
    return res.status(200).json({ received: true, duplicate: true });
  }
  
  // Mark as processed with 24h TTL
  await redis.setex(dedupeKey, 86400, '1');
  
  logger.info('Processing event', { eventType: event.type, userId: event.data["id"] });

  // Handle different event types
  switch (event.type) {
    case 'user.created': {
      const email = event.data.email_addresses?.[0]?.email_address;
      const clerkId = event.data.id;
      logger.info('Creating user', { email });
      
      // P0-FIX: Use transaction with locking to prevent race conditions
      const { withTransaction } = await import('../../../lib/db');
      
      await withTransaction(async (trx) => {
        // Check if user already exists with lock
        const { rows: existing } = await trx.query(
          'SELECT id FROM users WHERE clerk_id = $1 FOR UPDATE',
          [clerkId]
        );
        
        if (existing.length > 0) {
          logger.info('User already exists, skipping', { clerkId });
          return;
        }
        
        // Insert new user
        await trx.query(
          `INSERT INTO users (clerk_id, email, first_name, last_name, email_verified, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            clerkId,
            email,
            event.data.first_name || null,
            event.data.last_name || null,
            false,
            new Date(),
            new Date(),
          ]
        );
        
        logger.info('User created successfully', { clerkId });
      });
      break;
    }

    case 'user.updated': {
      const clerkId = event.data.id;
      logger.info('Updating user', { clerkId });
      
      // P0-FIX: Use transaction to ensure atomic update
      const { withTransaction } = await import('../../../lib/db');
      
      await withTransaction(async (trx) => {
        // Lock the row before updating to prevent race conditions
        const { rows: existing } = await trx.query(
          'SELECT id FROM users WHERE clerk_id = $1 FOR UPDATE',
          [clerkId]
        );
        
        if (existing.length === 0) {
          logger.warn('User not found for update', { clerkId });
          return;
        }
        
        await trx.query(
          `UPDATE users 
           SET email = $1, first_name = $2, last_name = $3, updated_at = $4
           WHERE clerk_id = $5`,
          [
            event.data.email_addresses?.[0]?.email_address || null,
            event.data.first_name || null,
            event.data.last_name || null,
            new Date(),
            clerkId,
          ]
        );
        
        logger.info('User updated successfully', { clerkId });
      });
      break;
    }

    case 'user.deleted': {
    const userId = event.data["id"];
    logger.info('Deleting user', { userId });

    // SECURITY FIX (Finding 15): GDPR Article 17 - Comprehensive data erasure
    // Must delete ALL personal data across all tables, not just soft-delete the user record
    try {
      const { withTransaction } = await import('../../../lib/db');
      await withTransaction(async (client) => {
        // 1. Get internal user ID for cascading deletes
        const { rows: userRows } = await client.query(
          'SELECT id FROM users WHERE clerk_id = $1',
          [userId]
        );
        const internalUserId = userRows[0]?.id;

        if (internalUserId) {
          // F22-FIX: Use internalUserId (from users table PK) for cascading deletes,
          // not userId (clerk_id). FK references in related tables point to the
          // internal user ID, not the external Clerk ID. Using the wrong ID meant
          // these DELETEs found nothing, violating GDPR Article 17.
          // SECURITY FIX: Use internalUserId (DB primary key) not userId (Clerk external ID)
          // Previous code used Clerk ID against internal FK columns, matching zero rows (GDPR violation)

          // 2. Delete org memberships (user removed from all orgs)
          // Try both internal ID and clerk_id since different tables may use different FK
          await client.query(
            'DELETE FROM org_memberships WHERE user_id = $1 OR user_id = $2',
            [internalUserId, userId]
          );

          // 3. Delete user sessions
          await client.query(
            'DELETE FROM user_sessions WHERE user_id = $1 OR user_id = $2',
            [internalUserId, userId]
          );

          // 4. Delete refresh tokens
          await client.query(
            'DELETE FROM refresh_tokens WHERE user_id = $1 OR user_id = $2',
            [internalUserId, userId]
          );

          // 5. Delete API keys
          await client.query(
            'DELETE FROM api_keys WHERE user_id = $1 OR user_id = $2',
            [internalUserId, userId]
          );

          // 6. Anonymize audit logs (keep structure, remove PII)
          await client.query(
            `UPDATE audit_logs SET
               actor_email = 'deleted_user',
               actor_name = 'Deleted User',
               actor_ip = NULL
             WHERE actor_id = $1 OR actor_id = $2`,
            [internalUserId, userId]
          );

          // 7. Delete email subscriptions
          await client.query(
            'DELETE FROM email_subscriptions WHERE user_id = $1 OR user_id = $2',
            [internalUserId, userId]
          );

          // 8. Delete notification preferences
          await client.query(
            'DELETE FROM notification_preferences WHERE user_id = $1 OR user_id = $2',
            [internalUserId, userId]
          );
        }

        // 9. Hard-anonymize user record (GDPR: right to erasure)
        await client.query(
          `UPDATE users
           SET deleted_at = NOW(),
               email = $1,
               email_verified = false,
               encrypted_password = null,
               first_name = null,
               last_name = null,
               phone = null,
               avatar_url = null,
               metadata = '{}'::jsonb
           WHERE clerk_id = $2`,
          [`deleted_${userId}@anonymized.local`, userId]
        );

        logger.info('GDPR deletion completed', { userId, tablesCleared: 9 });
      });
    } catch (err) {
      logger.error('Failed to delete user', err instanceof Error ? err : new Error(String(err)));
      throw err; // Re-throw to return 500
    }
    break;
    }

    case 'organizationMembership.created': {
      // F21-FIX: For membership events, event.data.id is the MEMBERSHIP ID, not the user ID.
      // The user ID is in event.data.public_user_data.user_id for Clerk membership events.
      const membershipData = event.data as { id: string; organization_id?: string; public_user_data?: { user_id?: string }; role?: string };
      const userId = membershipData.public_user_data?.user_id || membershipData.id;
      const orgId = membershipData.organization_id;
      logger.info('User joined org', { userId, orgId });

      if (!orgId) {
        logger.warn('Missing organization_id in membership event');
        return res.status(400).json({ error: 'Missing organization_id' });
      }

      // P0-FIX: Verify org and user exist before creating membership
      const { getDb } = await import('../../../lib/db');
      const db = await getDb();

      // Verify organization exists
      const org = await db('orgs').where({ id: orgId }).first();
      if (!org) {
        logger.warn('Org not found, skipping membership', { orgId });
        return res.status(400).json({ error: 'Invalid organization' });
      }

      // Verify user exists in our database
      const user = await db('users').where({ clerk_id: userId }).first();
      if (!user) {
        logger.warn('User not found, creating', { userId });
        // Create minimal user record to maintain referential integrity
        await db('users').insert({
          clerk_id: userId,
          email: `pending_${userId}@clerk.local`,
          email_verified: false,
          created_at: new Date(),
          updated_at: new Date(),
        }).onConflict('clerk_id').ignore();
      }

      // F23-FIX: Validate role against allowed values instead of unsafe (event.data as any).role
      const ALLOWED_ROLES = ['admin', 'editor', 'viewer', 'member', 'org:admin', 'org:member'];
      const rawRole = membershipData.role;
      const role = (rawRole && ALLOWED_ROLES.includes(rawRole)) ? rawRole : 'member';

      await db('org_memberships').insert({
        user_id: userId,
        org_id: orgId,
        role,
        created_at: new Date(),
      }).onConflict(['user_id', 'org_id']).merge();
      break;
    }

    case 'organizationMembership.deleted': {
      // F21-FIX: Same as created - use public_user_data.user_id for membership events
      const deleteMembershipData = event.data as { id: string; organization_id?: string; public_user_data?: { user_id?: string } };
      const userId = deleteMembershipData.public_user_data?.user_id || deleteMembershipData.id;
      const orgId = deleteMembershipData.organization_id;
      logger.info('User left org', { userId, orgId });
      
      // P0-FIX: Verify membership exists before deleting
      const { getDb } = await import('../../../lib/db');
      const db = await getDb();
      
      // Verify organization exists
      const org = await db('orgs').where({ id: orgId }).first();
      if (!org) {
        logger.warn('Org not found, skipping deletion', { orgId });
        return res.status(400).json({ error: 'Invalid organization' });
      }
      
      // Check if membership exists before attempting delete
      const membership = await db('org_memberships')
        .where({ user_id: userId, org_id: orgId })
        .first();
      
      if (!membership) {
        logger.warn('Membership not found', { userId, orgId });
        return res.status(200).json({ received: true, warning: 'Membership not found' });
      }
      
      await db('org_memberships')
        .where({ user_id: userId, org_id: orgId })
        .delete();
      break;
    }

    default:
    logger.info('Unhandled event type', { eventType: event.type });
  }

  return res.status(200).json({
    received: true,
    event: event.type,
    id: event.data["id"],
  });
  } catch (error: unknown) {
  logger.error('Error processing webhook', error instanceof Error ? error : new Error(String(error)));

  const err = error instanceof Error ? error : new Error(String(error));
  if (err.message?.includes('CLERK_WEBHOOK_SECRET')) {
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  if (err.message?.includes('REDIS_URL')) {
    return res.status(503).json({ error: 'Service configuration error' });
  }

  return res.status(500).json({ error: 'Internal server error' });
  }
}

// Disable body parsing to get raw body for signature verification
export const config = {
  api: {
  bodyParser: false,
  },
};
