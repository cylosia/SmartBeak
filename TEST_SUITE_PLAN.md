# Comprehensive Test Suite Plan
## Addressing Critical Testing Gap (5% → 85%+ Coverage)

**Status:** Draft  
**Target:** 85%+ code coverage  
**Timeline:** 4-6 weeks  
**Priority:** CRITICAL (blocking production confidence)

---

## Executive Summary

### Current State
| Test Type | Count | Coverage |
|-----------|-------|----------|
| Unit Tests | 0 | 0% |
| Integration Tests | 0 | 0% |
| Route Tests | 0 | 0% |
| Security Tests | 60 cases | ~5% |
| **TOTAL** | **60 cases** | **~5%** |

### Target State
| Test Type | Count | Coverage Target |
|-----------|-------|-----------------|
| Unit Tests | 150+ | 60% |
| Integration Tests | 40+ | 20% |
| Route Tests | 40+ | 15% |
| E2E Tests | 15+ | Critical flows |
| **TOTAL** | **245+ cases** | **85%+** |

---

## Phase 1: Test Infrastructure (Week 1)

### 1.1 Test Environment Setup

```typescript
// test/setup.ts - Enhanced version
import { jest } from '@jest/globals';
import { getPool } from '@database/pool';
import { getRedis } from '@kernel/redis';

// Global test configuration
beforeAll(async () => {
  // Set test environment
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-jwt-secret-minimum-32-characters-long';
  process.env.GBP_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64); // 32-byte hex
  
  // Initialize test database schema
  await initializeTestDatabase();
});

beforeEach(async () => {
  // Clean database between tests
  await cleanDatabase();
  
  // Clear Redis test database
  const redis = await getRedis();
  await redis.flushdb();
  
  // Reset all mocks
  jest.clearAllMocks();
});

afterAll(async () => {
  // Close all connections
  const pool = await getPool();
  await pool.end();
  
  const redis = await getRedis();
  await redis.quit();
});
```

### 1.2 Test Database Strategy

```yaml
# docker-compose.test.yml
version: '3.8'
services:
  postgres-test:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: smartbeak_test
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
    ports:
      - "5433:5432"
    volumes:
      - ./test/migrations:/docker-entrypoint-initdb.d
      
  redis-test:
    image: redis:7-alpine
    ports:
      - "6380:6379"
```

### 1.3 Test Utilities & Helpers

```typescript
// test/helpers/factories.ts
export const factories = {
  user: (overrides?: Partial<User>) => ({
    id: crypto.randomUUID(),
    clerk_id: `user_${faker.string.alphanumeric(24)}`,
    email: faker.internet.email(),
    first_name: faker.person.firstName(),
    last_name: faker.person.lastName(),
    created_at: new Date(),
    ...overrides,
  }),
  
  org: (overrides?: Partial<Org>) => ({
    id: crypto.randomUUID(),
    name: faker.company.name(),
    slug: faker.helpers.slugify(faker.company.name()),
    plan: 'starter',
    ...overrides,
  }),
  
  // More factories...
};

// test/helpers/authentication.ts
export async function createAuthenticatedRequest(
  user: User,
  org?: Org
): Promise<RequestContext> {
  // Generate valid JWT
  const token = await generateTestToken(user, org);
  return {
    headers: { authorization: `Bearer ${token}` },
    user,
    org,
  };
}
```

### 1.4 Mock Strategies

```typescript
// test/mocks/stripe.ts
export const stripeMock = {
  customers: {
    create: jest.fn(),
    retrieve: jest.fn(),
  },
  subscriptions: {
    create: jest.fn(),
    cancel: jest.fn(),
  },
  webhooks: {
    constructEvent: jest.fn(),
  },
};

// test/mocks/clerk.ts
export const clerkMock = {
  users: {
    getUser: jest.fn(),
    deleteUser: jest.fn(),
  },
  verifyToken: jest.fn(),
};

// test/mocks/redis.ts
export const redisMock = {
  get: jest.fn(),
  set: jest.fn(),
  setex: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
  flushdb: jest.fn(),
};
```

---

## Phase 2: Unit Tests (Weeks 1-3)

### 2.1 Services Layer (40 tests)

```typescript
// packages/services/__tests__/billing.service.test.ts
describe('BillingService', () => {
  describe('createCheckoutSession', () => {
    it('should create Stripe checkout for valid org and plan', async () => {
      // Arrange
      const org = factories.org();
      const plan = { id: 'pro', stripe_price_id: 'price_123' };
      
      // Act
      const result = await billingService.createCheckoutSession(org.id, plan.id);
      
      // Assert
      expect(result.url).toBeDefined();
      expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          client_reference_id: org.id,
          mode: 'subscription',
        })
      );
    });
    
    it('should throw error for invalid plan', async () => {
      await expect(
        billingService.createCheckoutSession('org-123', 'invalid-plan')
      ).rejects.toThrow('Invalid plan');
    });
    
    it('should enforce rate limiting (max 5/min)', async () => {
      // Test rate limit enforcement
    });
  });
  
  describe('handleWebhook', () => {
    it('should process valid Stripe webhook', async () => {
      // Arrange
      const event = factories.stripeEvent('invoice.payment_succeeded');
      stripeMock.webhooks.constructEvent.mockReturnValue(event);
      
      // Act
      await billingService.handleWebhook(payload, signature);
      
      // Assert
      expect(eventProcessor).toHaveBeenCalledWith(event);
    });
    
    it('should deduplicate duplicate events', async () => {
      // First call
      await billingService.handleWebhook(payload, signature);
      // Second call with same event ID
      await billingService.handleWebhook(payload, signature);
      
      // Should only process once
      expect(eventProcessor).toHaveBeenCalledTimes(1);
    });
    
    it('should reject invalid signatures', async () => {
      stripeMock.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('Invalid signature');
      });
      
      await expect(
        billingService.handleWebhook(payload, 'invalid-sig')
      ).rejects.toThrow('Invalid signature');
    });
  });
});
```

### 2.2 Database Layer (30 tests)

```typescript
// packages/database/__tests__/pool.test.ts
describe('ConnectionPool', () => {
  describe('acquireAdvisoryLock', () => {
    it('should acquire lock and return client', async () => {
      const client = await acquireAdvisoryLock('test-lock');
      expect(client).toBeDefined();
      
      // Verify lock is held
      const { rows } = await client.query(
        'SELECT pg_try_advisory_lock($1) as acquired',
        ['test-lock']
      );
      expect(rows[0].acquired).toBe(false); // Should fail (already locked)
      
      await releaseAdvisoryLock(client, 'test-lock');
    });
    
    it('should timeout if lock cannot be acquired', async () => {
      // Hold lock in another connection
      const holder = await acquireAdvisoryLock('contended-lock');
      
      // Try to acquire with short timeout
      await expect(
        acquireAdvisoryLock('contended-lock', 100)
      ).rejects.toThrow('Failed to acquire lock');
      
      await releaseAdvisoryLock(holder, 'contended-lock');
    });
    
    it('should release connection on timeout failure', async () => {
      const poolSizeBefore = (await getPool()).totalCount;
      
      try {
        await acquireAdvisoryLock('test-lock', 1);
      } catch (e) {
        // Expected
      }
      
      // Connection should be released
      expect((await getPool()).totalCount).toBe(poolSizeBefore);
    });
  });
  
  describe('withTransaction', () => {
    it('should commit on success', async () => {
      let committed = false;
      
      await withTransaction(async (trx) => {
        await trx.query('INSERT INTO test_table (id) VALUES ($1)', ['test-1']);
        committed = true;
      });
      
      expect(committed).toBe(true);
      // Verify data exists
    });
    
    it('should rollback on error', async () => {
      await expect(
        withTransaction(async (trx) => {
          await trx.query('INSERT INTO test_table (id) VALUES ($1)', ['test-2']);
          throw new Error('Intentional failure');
        })
      ).rejects.toThrow('Intentional failure');
      
      // Verify data does not exist
    });
  });
});
```

### 2.3 Utilities & Helpers (25 tests)

```typescript
// packages/kernel/__tests__/encryption.test.ts
describe('Token Encryption', () => {
  it('should encrypt and decrypt tokens correctly', () => {
    const token = 'sensitive-refresh-token-123';
    const encrypted = encryptToken(token);
    
    expect(encrypted).not.toBe(token);
    expect(encrypted).toContain(':'); // iv:authTag:ciphertext format
    
    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(token);
  });
  
  it('should produce different ciphertexts for same plaintext', () => {
    const token = 'test-token';
    const encrypted1 = encryptToken(token);
    const encrypted2 = encryptToken(token);
    
    expect(encrypted1).not.toBe(encrypted2);
  });
  
  it('should fail to decrypt tampered ciphertext', () => {
    const token = 'test-token';
    const encrypted = encryptToken(token);
    const tampered = encrypted.replace(/.$/, 'X');
    
    expect(() => decryptToken(tampered)).toThrow();
  });
});

// packages/kernel/__tests__/validation.test.ts
describe('Input Validation', () => {
  describe('validateEmail', () => {
    it('should accept valid emails', () => {
      expect(validateEmail('user@example.com')).toBe(true);
      expect(validateEmail('user+tag@example.co.uk')).toBe(true);
    });
    
    it('should reject invalid emails', () => {
      expect(validateEmail('invalid')).toBe(false);
      expect(validateEmail('@example.com')).toBe(false);
      expect(validateEmail('user@')).toBe(false);
    });
  });
});
```

### 2.4 Job Processor Tests (20 tests)

```typescript
// apps/api/src/jobs/__tests__/JobScheduler.test.ts
describe('JobScheduler', () => {
  describe('graceful shutdown', () => {
    it('should complete active jobs before shutdown', async () => {
      const scheduler = new JobScheduler();
      let jobCompleted = false;
      
      // Add slow job
      scheduler.addJob('test-queue', async () => {
        await sleep(500);
        jobCompleted = true;
      });
      
      // Start job
      await scheduler.startWorkers();
      
      // Trigger shutdown
      const shutdownPromise = scheduler.stop();
      
      // Should wait for job
      await shutdownPromise;
      expect(jobCompleted).toBe(true);
    });
    
    it('should timeout and force close after 10 seconds', async () => {
      const scheduler = new JobScheduler();
      
      // Add very slow job
      scheduler.addJob('test-queue', async () => {
        await sleep(20000); // 20 seconds
      });
      
      await scheduler.startWorkers();
      
      const start = Date.now();
      await scheduler.stop();
      const elapsed = Date.now() - start;
      
      // Should timeout around 10s
      expect(elapsed).toBeLessThan(12000);
      expect(elapsed).toBeGreaterThan(9000);
    });
    
    it('should prevent duplicate workers with isRunning() check', async () => {
      const scheduler = new JobScheduler();
      await scheduler.startWorkers();
      
      // Second start should be no-op
      await scheduler.startWorkers();
      
      expect(scheduler.workers.size).toBe(1);
    });
  });
});
```

---

## Phase 3: Integration Tests (Weeks 2-4)

### 3.1 Database Integration (15 tests)

```typescript
// packages/database/__tests__/integration/transactions.test.ts
describe('Transaction Integration', () => {
  it('should maintain isolation between concurrent transactions', async () => {
    const orgId = crypto.randomUUID();
    
    // Transaction 1: Insert and hold
    const tx1Promise = withTransaction(async (trx) => {
      await trx.query('INSERT INTO orgs (id, name) VALUES ($1, $2)', [orgId, 'Test']);
      await sleep(100);
      return 'tx1-complete';
    });
    
    // Transaction 2: Try to read (should wait or use snapshot)
    const tx2Promise = withTransaction(async (trx) => {
      await sleep(50); // Start after tx1
      const { rows } = await trx.query('SELECT * FROM orgs WHERE id = $1', [orgId]);
      return rows.length;
    });
    
    const [tx1Result, tx2Result] = await Promise.all([tx1Promise, tx2Promise]);
    
    expect(tx1Result).toBe('tx1-complete');
    expect(tx2Result).toBe(1); // Should see committed data
  });
  
  it('should handle deadlock detection and retry', async () => {
    // Test deadlock scenarios
  });
  
  it('should enforce foreign key constraints', async () => {
    // Insert without parent should fail
    await expect(
      db.query('INSERT INTO content (org_id) VALUES ($1)', ['non-existent-org'])
    ).rejects.toThrow('foreign key constraint');
  });
});
```

### 3.2 External Service Integration (15 tests)

```typescript
// apps/api/src/adapters/__tests__/stripe.integration.test.ts
describe('Stripe Integration', () => {
  it('should create customer with metadata', async () => {
    const result = await stripeAdapter.createCustomer({
      email: 'test@example.com',
      orgId: 'org-123',
    });
    
    expect(result.stripeCustomerId).toMatch(/^cus_/);
    
    // Verify in Stripe test mode
    const customer = await stripe.customers.retrieve(result.stripeCustomerId);
    expect(customer.metadata?.org_id).toBe('org-123');
  });
  
  it('should handle webhook deduplication across instances', async () => {
    const eventId = `evt_${crypto.randomUUID()}`;
    
    // Simulate two instances receiving same webhook
    const result1 = await processWebhook(eventId, payload1);
    const result2 = await processWebhook(eventId, payload2);
    
    expect(result1.processed).toBe(true);
    expect(result2.processed).toBe(false); // Duplicate
    expect(result2.reason).toBe('duplicate');
  });
});

// packages/database/__tests__/integration/redis.test.ts
describe('Redis Integration', () => {
  it('should handle cluster failover gracefully', async () => {
    // Test Redis cluster behavior
  });
  
  it('should expire keys according to TTL', async () => {
    const key = 'test-key';
    await redis.setex(key, 1, 'value');
    
    expect(await redis.get(key)).toBe('value');
    
    await sleep(1100);
    expect(await redis.get(key)).toBeNull();
  });
});
```

### 3.3 Job Queue Integration (10 tests)

```typescript
// apps/api/src/jobs/__tests__/integration/queue.test.ts
describe('Job Queue Integration', () => {
  it('should process job and update status', async () => {
    const jobId = await queue.add('send-email', {
      to: 'user@example.com',
      template: 'welcome',
    });
    
    // Wait for processing
    await waitForJobCompletion(jobId, 5000);
    
    const job = await queue.getJob(jobId);
    expect(job?.returnvalue).toEqual({ sent: true });
  });
  
  it('should move failed jobs to DLQ after retries', async () => {
    const jobId = await queue.add('failing-job', {});
    
    await waitForJobCompletion(jobId, 10000);
    
    const job = await queue.getJob(jobId);
    expect(job?.failedReason).toBeDefined();
    expect(job?.attemptsMade).toBeGreaterThanOrEqual(3);
  });
  
  it('should respect job priorities', async () => {
    const processed: string[] = [];
    
    // Add low priority job first
    await queue.add('task', { name: 'low' }, { priority: 5 });
    
    // Add high priority job
    await queue.add('task', { name: 'high' }, { priority: 1 });
    
    // Process and verify order
    await processQueue((job) => {
      processed.push(job.data.name);
    });
    
    expect(processed).toEqual(['high', 'low']);
  });
});
```

---

## Phase 4: Route/API Tests (Weeks 3-5)

### 4.1 Authentication Routes (10 tests)

```typescript
// apps/web/pages/api/__tests__/auth.test.ts
describe('Authentication Routes', () => {
  describe('POST /api/auth/login', () => {
    it('should return JWT for valid credentials', async () => {
      const response = await testHandler(loginHandler, {
        method: 'POST',
        body: {
          email: 'user@example.com',
          password: 'correct-password',
        },
      });
      
      expect(response.status).toBe(200);
      expect(response.json.token).toBeDefined();
      expect(response.json.user).toBeDefined();
    });
    
    it('should return 401 for invalid credentials', async () => {
      const response = await testHandler(loginHandler, {
        method: 'POST',
        body: {
          email: 'user@example.com',
          password: 'wrong-password',
        },
      });
      
      expect(response.status).toBe(401);
    });
    
    it('should enforce rate limiting (5 attempts per 15 min)', async () => {
      // 5 failed attempts
      for (let i = 0; i < 5; i++) {
        await testHandler(loginHandler, {
          method: 'POST',
          body: { email: 'user@example.com', password: 'wrong' },
        });
      }
      
      // 6th attempt should be rate limited
      const response = await testHandler(loginHandler, {
        method: 'POST',
        body: { email: 'user@example.com', password: 'wrong' },
      });
      
      expect(response.status).toBe(429);
      expect(response.json.retryAfter).toBeDefined();
    });
  });
});
```

### 4.2 Webhook Routes (15 tests)

```typescript
// apps/web/pages/api/webhooks/__tests__/stripe.test.ts
describe('Stripe Webhook Routes', () => {
  it('should process valid webhook', async () => {
    const event = factories.stripeEvent('invoice.payment_succeeded');
    const signature = generateStripeSignature(event);
    
    const response = await testHandler(stripeWebhookHandler, {
      method: 'POST',
      headers: { 'stripe-signature': signature },
      body: event,
    });
    
    expect(response.status).toBe(200);
    expect(eventProcessor).toHaveBeenCalledWith(event);
  });
  
  it('should reject invalid signature', async () => {
    const response = await testHandler(stripeWebhookHandler, {
      method: 'POST',
      headers: { 'stripe-signature': 'invalid' },
      body: {},
    });
    
    expect(response.status).toBe(401);
  });
  
  it('should deduplicate events', async () => {
    const event = factories.stripeEvent('invoice.payment_succeeded');
    const signature = generateStripeSignature(event);
    
    // First request
    await testHandler(stripeWebhookHandler, {
      method: 'POST',
      headers: { 'stripe-signature': signature },
      body: event,
    });
    
    // Duplicate request
    const response = await testHandler(stripeWebhookHandler, {
      method: 'POST',
      headers: { 'stripe-signature': signature },
      body: event,
    });
    
    expect(response.status).toBe(200);
    expect(eventProcessor).toHaveBeenCalledTimes(1);
  });
  
  it('should reject events with future timestamps', async () => {
    const event = factories.stripeEvent('invoice.payment_succeeded', {
      created: Math.floor(Date.now() / 1000) + 3600, // 1 hour in future
    });
    
    const response = await testHandler(stripeWebhookHandler, {
      method: 'POST',
      headers: { 'stripe-signature': generateStripeSignature(event) },
      body: event,
    });
    
    expect(response.status).toBe(400);
  });
});

// apps/web/pages/api/webhooks/__tests__/clerk.test.ts
describe('Clerk Webhook Routes', () => {
  it('should create user on user.created event', async () => {
    const event = factories.clerkEvent('user.created', {
      data: {
        id: 'user_clerk123',
        email_addresses: [{ email_address: 'new@example.com' }],
        first_name: 'John',
        last_name: 'Doe',
      },
    });
    
    const response = await testHandler(clerkWebhookHandler, {
      method: 'POST',
      headers: generateSvixHeaders(event),
      body: event,
    });
    
    expect(response.status).toBe(200);
    
    // Verify user created in database
    const user = await db('users').where({ clerk_id: 'user_clerk123' }).first();
    expect(user).toBeDefined();
    expect(user.email).toBe('new@example.com');
  });
  
  it('should handle duplicate user.created events (race condition)', async () => {
    const event = factories.clerkEvent('user.created');
    
    // Send two identical requests simultaneously
    const [res1, res2] = await Promise.all([
      testHandler(clerkWebhookHandler, {
        method: 'POST',
        headers: generateSvixHeaders(event),
        body: event,
      }),
      testHandler(clerkWebhookHandler, {
        method: 'POST',
        headers: generateSvixHeaders(event),
        body: event,
      }),
    ]);
    
    // Both should succeed (one creates, one is noop)
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    
    // Only one user should exist
    const count = await db('users').where({ clerk_id: event.data.id }).count();
    expect(count[0].count).toBe('1');
  });
});
```

### 4.3 API Routes with Tenant Isolation (15 tests)

```typescript
// control-plane/api/routes/__tests__/content.test.ts
describe('Content Routes', () => {
  describe('GET /api/content', () => {
    it('should return only content from user org', async () => {
      const { user, org, token } = await createTestUserWithOrg();
      
      // Create content in user's org
      await db('content').insert([
        { org_id: org.id, title: 'My Content' },
      ]);
      
      // Create content in other org
      const otherOrg = await db('orgs').insert({ name: 'Other' }).returning('*');
      await db('content').insert([
        { org_id: otherOrg[0].id, title: 'Other Content' },
      ]);
      
      const response = await testHandler(contentListHandler, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      });
      
      expect(response.status).toBe(200);
      expect(response.json.data).toHaveLength(1);
      expect(response.json.data[0].title).toBe('My Content');
    });
    
    it('should reject access to content from other orgs', async () => {
      const { user, org, token } = await createTestUserWithOrg();
      const otherOrg = await createTestOrg();
      
      const [content] = await db('content')
        .insert({ org_id: otherOrg.id, title: 'Secret' })
        .returning('*');
      
      const response = await testHandler(contentGetHandler, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        query: { id: content.id },
      });
      
      expect(response.status).toBe(403);
    });
    
    it('should enforce role-based access control', async () => {
      const { token: viewerToken } = await createTestUserWithRole('viewer');
      const { token: adminToken } = await createTestUserWithRole('admin');
      
      // Viewer can read
      const readResponse = await testHandler(contentListHandler, {
        method: 'GET',
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(readResponse.status).toBe(200);
      
      // Viewer cannot delete
      const deleteResponse = await testHandler(contentDeleteHandler, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${viewerToken}` },
        query: { id: 'some-id' },
      });
      expect(deleteResponse.status).toBe(403);
      
      // Admin can delete
      const adminDeleteResponse = await testHandler(contentDeleteHandler, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${adminToken}` },
        query: { id: 'some-id' },
      });
      expect(adminDeleteResponse.status).toBe(200);
    });
  });
});
```

---

## Phase 5: Security Tests (Week 4)

### 5.1 Expand Existing SQL Injection Tests

```typescript
// test/security/sql-injection.test.ts (extend existing)
describe('SQL Injection Prevention', () => {
  // Existing 60 test cases...
  
  describe('Parameterized Queries', () => {
    it('should prevent injection in search queries', async () => {
      const maliciousInput = "'; DROP TABLE users; --";
      
      const result = await db('content')
        .whereRaw('title ILIKE ?', [`%${maliciousInput}%`])
        .select('*');
      
      // Should not throw or drop table
      expect(await db.schema.hasTable('users')).toBe(true);
    });
  });
  
  describe('NoSQL Injection', () => {
    it('should sanitize object inputs', async () => {
      const maliciousInput = { $ne: null };
      
      // Should not allow NoSQL injection patterns
    });
  });
});
```

### 5.2 Add New Security Test Categories

```typescript
// test/security/authentication.test.ts
describe('Authentication Security', () => {
  it('should reject expired JWT tokens', async () => {
    const expiredToken = generateExpiredToken();
    
    const response = await testHandler(protectedRouteHandler, {
      headers: { authorization: `Bearer ${expiredToken}` },
    });
    
    expect(response.status).toBe(401);
  });
  
  it('should reject tampered JWT tokens', async () => {
    const token = generateValidToken();
    const tamperedToken = token.slice(0, -5) + 'XXXXX';
    
    const response = await testHandler(protectedRouteHandler, {
      headers: { authorization: `Bearer ${tamperedToken}` },
    });
    
    expect(response.status).toBe(401);
  });
  
  it('should prevent timing attacks on password comparison', async () => {
    const start = Date.now();
    await testHandler(loginHandler, {
      body: { email: 'user@example.com', password: 'short' },
    });
    const shortTime = Date.now() - start;
    
    const start2 = Date.now();
    await testHandler(loginHandler, {
      body: { email: 'user@example.com', password: 'verylongpasswordthatismuchlonger' },
    });
    const longTime = Date.now() - start2;
    
    // Timing should be similar (within 50ms) regardless of password length
    expect(Math.abs(shortTime - longTime)).toBeLessThan(50);
  });
});

// test/security/authorization.test.ts
describe('Authorization Security', () => {
  it('should prevent IDOR attacks on content', async () => {
    const attacker = await createTestUserWithOrg();
    const victim = await createTestUserWithOrg();
    
    const [victimContent] = await db('content')
      .insert({ org_id: victim.org.id })
      .returning('*');
    
    // Attacker tries to access victim's content
    const response = await testHandler(contentGetHandler, {
      headers: { authorization: `Bearer ${attacker.token}` },
      query: { id: victimContent.id },
    });
    
    expect(response.status).toBe(403);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('IDOR')
    );
  });
  
  it('should prevent privilege escalation', async () => {
    const user = await createTestUserWithRole('viewer');
    
    // Try to access admin-only endpoint
    const response = await testHandler(adminOnlyHandler, {
      headers: { authorization: `Bearer ${user.token}` },
    });
    
    expect(response.status).toBe(403);
  });
});

// test/security/headers.test.ts
describe('Security Headers', () => {
  it('should include HSTS header', async () => {
    const response = await testHandler(apiHandler, {
      method: 'GET',
    });
    
    expect(response.headers['strict-transport-security']).toMatch(
      /max-age=31536000/
    );
  });
  
  it('should include CSP header', async () => {
    const response = await testHandler(apiHandler);
    expect(response.headers['content-security-policy']).toBeDefined();
  });
  
  it('should prevent clickjacking with X-Frame-Options', async () => {
    const response = await testHandler(apiHandler);
    expect(response.headers['x-frame-options']).toBe('DENY');
  });
});

// test/security/rate-limiting.test.ts
describe('Rate Limiting', () => {
  it('should limit auth endpoints to 5 requests per 15 minutes', async () => {
    const requests = Array(6).fill(null).map(() =>
      testHandler(loginHandler, {
        method: 'POST',
        body: { email: 'test@example.com', password: 'wrong' },
      })
    );
    
    const responses = await Promise.all(requests);
    
    const rateLimited = responses.filter(r => r.status === 429);
    expect(rateLimited.length).toBeGreaterThanOrEqual(1);
  });
  
  it('should track rate limits per IP', async () => {
    // Different IPs should have separate limits
  });
});
```

---

## Phase 6: E2E Tests (Week 5-6)

### 6.1 Critical User Flows (15 tests)

```typescript
// test/e2e/user-registration.test.ts
describe('User Registration Flow', () => {
  it('should complete full registration flow', async () => {
    // 1. User signs up via Clerk
    const clerkUser = await clerkClient.users.createUser({
      emailAddress: ['newuser@example.com'],
      password: 'SecurePass123!',
    });
    
    // 2. Webhook creates user in our DB
    await waitForWebhookProcessing('user.created', 5000);
    
    const dbUser = await db('users')
      .where({ clerk_id: clerkUser.id })
      .first();
    expect(dbUser).toBeDefined();
    
    // 3. User can log in
    const loginResponse = await apiClient.post('/api/auth/login', {
      email: 'newuser@example.com',
      password: 'SecurePass123!',
    });
    expect(loginResponse.token).toBeDefined();
    
    // 4. User can access protected resources
    const meResponse = await apiClient.get('/api/me', {
      headers: { authorization: `Bearer ${loginResponse.token}` },
    });
    expect(meResponse.email).toBe('newuser@example.com');
  });
});

// test/e2e/billing-flow.test.ts
describe('Billing Flow', () => {
  it('should complete subscription flow', async () => {
    const { user, org, token } = await createTestUserWithOrg();
    
    // 1. Create checkout session
    const checkout = await apiClient.post('/api/billing/checkout', {
      planId: 'pro',
    }, { headers: { authorization: `Bearer ${token}` } });
    
    expect(checkout.url).toMatch(/^https:\/\/checkout\.stripe\.com/);
    
    // 2. Simulate successful payment webhook
    await simulateStripeWebhook('checkout.session.completed', {
      client_reference_id: org.id,
      customer: 'cus_test123',
      subscription: 'sub_test123',
    });
    
    // 3. Verify org upgraded
    const updatedOrg = await db('orgs').where({ id: org.id }).first();
    expect(updatedOrg.plan).toBe('pro');
    expect(updatedOrg.stripe_customer_id).toBe('cus_test123');
    
    // 4. Verify user can access pro features
    const features = await apiClient.get('/api/features', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(features.aiGenerations).toBeGreaterThan(100);
  });
  
  it('should handle failed payments gracefully', async () => {
    // Test payment failure scenarios
  });
});

// test/e2e/tenant-isolation.test.ts
describe('Multi-tenant Isolation', () => {
  it('should maintain strict isolation between orgs', async () => {
    // Create two separate organizations
    const orgA = await createTestOrg({ name: 'Org A' });
    const orgB = await createTestOrg({ name: 'Org B' });
    
    // Add content to Org A
    const contentA = await apiClient.post('/api/content', {
      title: 'Secret A',
    }, { headers: { authorization: `Bearer ${orgA.token}` } });
    
    // Add content to Org B
    const contentB = await apiClient.post('/api/content', {
      title: 'Secret B',
    }, { headers: { authorization: `Bearer ${orgB.token}` } });
    
    // Org A cannot access Org B's content
    const response = await apiClient.get(`/api/content/${contentB.id}`, {
      headers: { authorization: `Bearer ${orgA.token}` },
    });
    expect(response.status).toBe(403);
    
    // Verify data isolation at database level
    const content = await db('content').where({ org_id: orgA.org.id });
    expect(content).toHaveLength(1);
    expect(content[0].title).toBe('Secret A');
  });
});
```

---

## Phase 7: Performance & Load Tests (Week 6)

```typescript
// test/performance/api-load.test.ts
describe('API Performance', () => {
  it('should handle 100 concurrent requests', async () => {
    const requests = Array(100).fill(null).map(() =>
      apiClient.get('/api/health')
    );
    
    const start = Date.now();
    const responses = await Promise.all(requests);
    const duration = Date.now() - start;
    
    expect(responses.every(r => r.status === 200)).toBe(true);
    expect(duration).toBeLessThan(5000); // Should complete within 5s
  });
  
  it('should maintain p95 latency under 200ms', async () => {
    const latencies: number[] = [];
    
    for (let i = 0; i < 1000; i++) {
      const start = Date.now();
      await apiClient.get('/api/content');
      latencies.push(Date.now() - start);
    }
    
    const p95 = percentile(latencies, 95);
    expect(p95).toBeLessThan(200);
  });
});

// test/performance/database-load.test.ts
describe('Database Performance', () => {
  it('should handle high concurrency without deadlocks', async () => {
    const operations = Array(50).fill(null).map((_, i) =>
      withTransaction(async (trx) => {
        await trx.query('UPDATE counters SET value = value + 1 WHERE id = $1', [i % 10]);
      })
    );
    
    await expect(Promise.all(operations)).resolves.not.toThrow();
  });
});
```

---

## Test Infrastructure

### Jest Configuration

```typescript
// jest.config.ts (enhanced)
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  maxWorkers: '50%',
  
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/*.spec.ts',
    '**/test/**/*.test.ts',
  ],
  
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/.next/',
  ],
  
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@kernel/(.*)$': '<rootDir>/packages/kernel/$1',
    '^@database/(.*)$': '<rootDir>/packages/database/$1',
    '^@services/(.*)$': '<rootDir>/packages/services/$1',
    '^@apps/api/(.*)$': '<rootDir>/apps/api/$1',
    '^@apps/web/(.*)$': '<rootDir>/apps/web/$1',
  },
  
  setupFilesAfterEnv: [
    '<rootDir>/test/setup.ts',
    '<rootDir>/test/setupMocks.ts',
  ],
  
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 85,
      lines: 85,
      statements: 85,
    },
    './apps/api/src/billing/**/*.ts': {
      branches: 95,
      functions: 95,
      lines: 95,
      statements: 95,
    },
    './packages/database/**/*.ts': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
  
  collectCoverageFrom: [
    'apps/**/*.{ts,tsx}',
    'packages/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/dist/**',
    '!**/__tests__/**',
    '!**/test/**',
  ],
  
  testTimeout: 10000,
  clearMocks: true,
  restoreMocks: true,
  
  // Parallel execution
  projects: [
    {
      displayName: 'unit',
      testMatch: ['**/*.unit.test.ts'],
    },
    {
      displayName: 'integration',
      testMatch: ['**/*.integration.test.ts'],
      testTimeout: 30000,
    },
    {
      displayName: 'e2e',
      testMatch: ['**/test/e2e/**/*.test.ts'],
      testTimeout: 60000,
    },
  ],
};

export default config;
```

### CI/CD Integration

```yaml
# .github/workflows/test.yml
name: Test Suite

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432
          
      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 6379:6379
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - run: npm ci
      
      - name: Run Unit Tests
        run: npm run test:unit -- --coverage
      
      - name: Run Integration Tests
        run: npm run test:integration -- --coverage
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test
          REDIS_URL: redis://localhost:6379/0
      
      - name: Upload Coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
          fail_ci_if_error: true
```

### NPM Scripts

```json
{
  "scripts": {
    "test": "jest",
    "test:unit": "jest --selectProjects unit",
    "test:integration": "jest --selectProjects integration",
    "test:e2e": "jest --selectProjects e2e",
    "test:security": "jest test/security",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:ci": "jest --ci --coverage --maxWorkers=2",
    "test:db:setup": "docker-compose -f docker-compose.test.yml up -d",
    "test:db:teardown": "docker-compose -f docker-compose.test.yml down"
  }
}
```

---

## Implementation Timeline

| Week | Focus | Deliverables |
|------|-------|--------------|
| 1 | Infrastructure | Test DB, mocks, helpers, factories |
| 2 | Unit Tests | Services (40), Utils (25) |
| 3 | Unit Tests | Database (30), Jobs (20) |
| 4 | Integration + Security | DB integration (15), External (15), Security (25) |
| 5 | Route Tests + E2E | Routes (40), E2E critical flows (10) |
| 6 | Performance + Polish | Load tests, coverage to 85%, CI/CD |

---

## Coverage Targets

```
Target Coverage by End of Implementation:
├── apps/api/src/          90%
│   ├── billing/            95%
│   ├── jobs/               90%
│   └── routes/             85%
├── apps/web/api/          85%
├── packages/
│   ├── database/           90%
│   ├── services/           85%
│   ├── kernel/             80%
│   └── security/           95%
├── control-plane/         80%
└── OVERALL                 85%+
```

---

## Success Criteria

- [ ] **Unit Tests:** 150+ passing
- [ ] **Integration Tests:** 40+ passing
- [ ] **Route Tests:** 40+ passing
- [ ] **E2E Tests:** 15+ passing
- [ ] **Security Tests:** 100+ cases
- [ ] **Code Coverage:** 85%+ overall
- [ ] **Critical Path Coverage:** 95%+
- [ ] **CI/CD Integration:** Automated test runs
- [ ] **Flaky Test Rate:** <1%

---

**Next Steps:**
1. Approve plan and allocate resources (2-3 engineers)
2. Set up test infrastructure (Week 1)
3. Begin unit test implementation (Week 1-3)
4. Parallel integration and security testing (Week 2-4)
5. Route and E2E testing (Week 3-5)
6. Performance testing and coverage polish (Week 6)
7. CI/CD integration and documentation (Week 6)
