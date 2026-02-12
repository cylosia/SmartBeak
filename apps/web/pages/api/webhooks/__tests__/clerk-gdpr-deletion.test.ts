/**
 * T5: GDPR Cascade Deletion Completeness Test
 *
 * Validates that user.deleted webhook event triggers complete data erasure
 * across all 9 tables per GDPR Article 17 requirements:
 *
 * 1. users - anonymized (email → deleted_<id>@anonymized.local, PII nulled)
 * 2. org_memberships - deleted
 * 3. user_sessions - deleted
 * 4. refresh_tokens - deleted
 * 5. api_keys - deleted
 * 6. audit_logs - anonymized (actor_email, actor_name, actor_ip)
 * 7. email_subscriptions - deleted
 * 8. notification_preferences - deleted
 * 9. Transaction atomicity
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import handler from '../clerk';
import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';

// Track all SQL queries executed during deletion
const executedQueries: { sql: string; params: any[] }[] = [];

// Mock environment
process.env.CLERK_WEBHOOK_SECRET = 'whsec_dGVzdHNlY3JldGtleWZvcnRlc3Rpbmc=';
process.env.REDIS_URL = 'redis://localhost:6379';

// Mock ioredis
vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
    on: vi.fn(),
  })),
}));

// Mock requireEnv
vi.mock('../../../../lib/env', () => ({
  requireEnv: vi.fn((key: string) => {
    if (key === 'CLERK_WEBHOOK_SECRET') return process.env.CLERK_WEBHOOK_SECRET;
    throw new Error(`Missing env: ${key}`);
  }),
}));

// Mock the database transaction to capture queries
vi.mock('../../../../lib/db', () => ({
  withTransaction: vi.fn(async (fn: any) => {
    const mockTrx = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
        executedQueries.push({ sql, params });

        // Return mock data for the user lookup query
        if (sql.includes('SELECT id FROM users WHERE clerk_id')) {
          return { rows: [{ id: 'internal-user-999' }], rowCount: 1 };
        }

        // Default: return empty result
        return { rows: [], rowCount: 1 };
      }),
    };
    return fn(mockTrx);
  }),
  getDb: vi.fn(),
}));

describe('GDPR Cascade Deletion (T5)', () => {
  let mockRes: Partial<NextApiResponse>;
  let jsonResponse: any;
  let statusCode: number;

  beforeEach(() => {
    vi.clearAllMocks();
    executedQueries.length = 0;
    jsonResponse = null;
    statusCode = 0;

    mockRes = {
      status: vi.fn().mockImplementation((code: number) => {
        statusCode = code;
        return mockRes;
      }),
      json: vi.fn().mockImplementation((data: any) => {
        jsonResponse = data;
        return mockRes;
      }),
    };
  });

  function calculateSvixSignature(
    secret: string,
    payload: string,
    timestamp: string,
    messageId: string
  ): string {
    const signedContent = `${messageId}.${timestamp}.${payload}`;
    const secretBytes = secret.startsWith('whsec_')
      ? Buffer.from(secret.slice(6), 'base64')
      : Buffer.from(secret, 'base64');
    return crypto
      .createHmac('sha256', secretBytes)
      .update(signedContent)
      .digest('base64');
  }

  function createDeleteWebhookRequest(userId: string) {
    const event = {
      data: { id: userId, deleted: true },
      object: 'event' as const,
      type: 'user.deleted',
    };

    const payload = JSON.stringify(event);
    const messageId = `msg-gdpr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const secret = process.env.CLERK_WEBHOOK_SECRET!;
    const sig = calculateSvixSignature(secret, payload, timestamp, messageId);

    return {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'svix-id': messageId,
        'svix-timestamp': timestamp,
        'svix-signature': `v1,${sig}`,
      },
      on: vi.fn().mockImplementation((event: string, callback: any) => {
        if (event === 'data') callback(Buffer.from(payload));
        if (event === 'end') callback();
        return {} as any;
      }),
    } as unknown as NextApiRequest;
  }

  it('should process user.deleted event successfully', async () => {
    const req = createDeleteWebhookRequest('user_gdpr_test_123');
    await handler(req, mockRes as NextApiResponse);
    expect(statusCode).toBe(200);
    expect(jsonResponse).toMatchObject({ received: true, event: 'user.deleted' });
  });

  it('should look up internal user ID from clerk_id', async () => {
    const req = createDeleteWebhookRequest('user_gdpr_lookup');
    await handler(req, mockRes as NextApiResponse);

    const lookupQuery = executedQueries.find(q =>
      q.sql.includes('SELECT id FROM users WHERE clerk_id')
    );
    expect(lookupQuery).toBeDefined();
    expect(lookupQuery!.params).toContain('user_gdpr_lookup');
  });

  it('should delete org_memberships for the user', async () => {
    const req = createDeleteWebhookRequest('user_gdpr_org');
    await handler(req, mockRes as NextApiResponse);

    const deleteQuery = executedQueries.find(q =>
      q.sql.includes('DELETE FROM org_memberships')
    );
    expect(deleteQuery).toBeDefined();
    expect(deleteQuery!.params).toContain('user_gdpr_org');
  });

  it('should delete user_sessions for the user', async () => {
    const req = createDeleteWebhookRequest('user_gdpr_sessions');
    await handler(req, mockRes as NextApiResponse);

    const deleteQuery = executedQueries.find(q =>
      q.sql.includes('DELETE FROM user_sessions')
    );
    expect(deleteQuery).toBeDefined();
    expect(deleteQuery!.params).toContain('user_gdpr_sessions');
  });

  it('should delete refresh_tokens for the user', async () => {
    const req = createDeleteWebhookRequest('user_gdpr_tokens');
    await handler(req, mockRes as NextApiResponse);

    const deleteQuery = executedQueries.find(q =>
      q.sql.includes('DELETE FROM refresh_tokens')
    );
    expect(deleteQuery).toBeDefined();
    expect(deleteQuery!.params).toContain('user_gdpr_tokens');
  });

  it('should delete api_keys for the user', async () => {
    const req = createDeleteWebhookRequest('user_gdpr_keys');
    await handler(req, mockRes as NextApiResponse);

    const deleteQuery = executedQueries.find(q =>
      q.sql.includes('DELETE FROM api_keys')
    );
    expect(deleteQuery).toBeDefined();
    expect(deleteQuery!.params).toContain('user_gdpr_keys');
  });

  it('should anonymize audit_logs (actor_email, actor_name, actor_ip)', async () => {
    const req = createDeleteWebhookRequest('user_gdpr_audit');
    await handler(req, mockRes as NextApiResponse);

    const auditQuery = executedQueries.find(q =>
      q.sql.includes('UPDATE audit_logs')
    );
    expect(auditQuery).toBeDefined();
    expect(auditQuery!.sql).toContain("actor_email = 'deleted_user'");
    expect(auditQuery!.sql).toContain("actor_name = 'Deleted User'");
    expect(auditQuery!.sql).toContain('actor_ip = NULL');
    expect(auditQuery!.params).toContain('user_gdpr_audit');
  });

  it('should delete email_subscriptions for the user', async () => {
    const req = createDeleteWebhookRequest('user_gdpr_email');
    await handler(req, mockRes as NextApiResponse);

    const deleteQuery = executedQueries.find(q =>
      q.sql.includes('DELETE FROM email_subscriptions')
    );
    expect(deleteQuery).toBeDefined();
    expect(deleteQuery!.params).toContain('user_gdpr_email');
  });

  it('should delete notification_preferences for the user', async () => {
    const req = createDeleteWebhookRequest('user_gdpr_notif');
    await handler(req, mockRes as NextApiResponse);

    const deleteQuery = executedQueries.find(q =>
      q.sql.includes('DELETE FROM notification_preferences')
    );
    expect(deleteQuery).toBeDefined();
    expect(deleteQuery!.params).toContain('user_gdpr_notif');
  });

  it('should anonymize the users table (email, PII nulled, deleted_at set)', async () => {
    const userId = 'user_gdpr_anon';
    const req = createDeleteWebhookRequest(userId);
    await handler(req, mockRes as NextApiResponse);

    const updateQuery = executedQueries.find(q =>
      q.sql.includes('UPDATE users') && q.sql.includes('deleted_at')
    );
    expect(updateQuery).toBeDefined();
    expect(updateQuery!.sql).toContain('email = $1');
    expect(updateQuery!.sql).toContain('first_name = null');
    expect(updateQuery!.sql).toContain('last_name = null');
    expect(updateQuery!.sql).toContain('phone = null');
    expect(updateQuery!.sql).toContain('avatar_url = null');
    expect(updateQuery!.params).toContain(`deleted_${userId}@anonymized.local`);
    expect(updateQuery!.params).toContain(userId);
  });

  it('should execute all 9 table operations in a single transaction', async () => {
    const req = createDeleteWebhookRequest('user_gdpr_txn');
    await handler(req, mockRes as NextApiResponse);

    // Verify withTransaction was called (all queries run within one transaction)
    const { withTransaction } = await import('../../../../lib/db');
    expect(withTransaction).toHaveBeenCalledTimes(1);

    // Verify all expected table operations occurred
    const tables = [
      'SELECT id FROM users',           // Lookup
      'DELETE FROM org_memberships',     // Table 2
      'DELETE FROM user_sessions',       // Table 3
      'DELETE FROM refresh_tokens',      // Table 4
      'DELETE FROM api_keys',            // Table 5
      'UPDATE audit_logs',              // Table 6
      'DELETE FROM email_subscriptions', // Table 7
      'DELETE FROM notification_preferences', // Table 8
      'UPDATE users',                   // Table 9 (anonymize)
    ];

    for (const table of tables) {
      const found = executedQueries.some(q => q.sql.includes(table));
      expect(found).toBe(true);
    }
  });

  it('should handle user not found in database gracefully', async () => {
    // Override the mock to return no user
    const { withTransaction } = await import('../../../../lib/db');
    (withTransaction as any).mockImplementationOnce(async (fn: any) => {
      const mockTrx = {
        query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
          executedQueries.push({ sql, params });
          // User not found
          if (sql.includes('SELECT id FROM users WHERE clerk_id')) {
            return { rows: [], rowCount: 0 };
          }
          return { rows: [], rowCount: 0 };
        }),
      };
      return fn(mockTrx);
    });

    const req = createDeleteWebhookRequest('user_nonexistent');
    await handler(req, mockRes as NextApiResponse);

    // Should still succeed (anonymize the user record even if internal ID not found)
    expect(statusCode).toBe(200);

    // Should still attempt to anonymize the users table
    const userUpdate = executedQueries.find(q =>
      q.sql.includes('UPDATE users') && q.sql.includes('deleted_at')
    );
    expect(userUpdate).toBeDefined();
  });
});
