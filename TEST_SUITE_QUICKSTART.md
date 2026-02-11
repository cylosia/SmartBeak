# Test Suite Quick Start Guide

## Current State → Target State

```
Current:  60 test cases (5% coverage) ──────────────────────► Target: 245+ cases (85% coverage)
          ❌ No unit tests                                          ✅ 150+ unit tests
          ❌ No integration tests                                    ✅ 40+ integration tests  
          ❌ No route tests                                          ✅ 40+ route tests
          ✅ 60 security tests                                       ✅ 100+ security tests
          ❌ No E2E tests                                            ✅ 15+ E2E tests
```

## Week 1: Infrastructure Setup (Start Here)

### Day 1-2: Test Environment

```bash
# 1. Create test Docker environment
cat > docker-compose.test.yml << 'EOF'
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
      
  redis-test:
    image: redis:7-alpine
    ports:
      - "6380:6379"
EOF

# Start test infrastructure
docker-compose -f docker-compose.test.yml up -d

# Verify connectivity
psql postgresql://test:test@localhost:5433/smartbeak_test -c "SELECT 1"
redis-cli -p 6380 ping
```

### Day 3-4: Test Utilities

Create these files in order:

```
test/
├── setup.ts              # Global setup
├── setupMocks.ts         # Mock configuration
├── helpers/
│   ├── factories.ts      # Data factories
│   ├── authentication.ts # Auth helpers
│   └── database.ts       # DB cleanup helpers
└── mocks/
    ├── stripe.ts
    ├── clerk.ts
    ├── paddle.ts
    └── redis.ts
```

### Day 5: First Test

Write your first test to verify infrastructure:

```typescript
// packages/database/__tests__/connection.test.ts
import { getPool } from '../pool';

describe('Database Connection', () => {
  it('should connect to test database', async () => {
    const pool = await getPool();
    const { rows } = await pool.query('SELECT NOW() as now');
    expect(rows[0].now).toBeDefined();
  });
});
```

Run it:
```bash
npm run test:unit packages/database/__tests__/connection.test.ts
```

## Test Categories Priority

### Priority 1: Critical Security (Week 2)
Must have before production:

```typescript
// 1. Billing webhooks (highest priority)
apps/api/src/billing/__tests__/stripeWebhook.test.ts
apps/api/src/billing/__tests__/paddleWebhook.test.ts

// 2. Authentication
apps/web/pages/api/__tests__/auth.test.ts

// 3. Tenant isolation  
control-plane/api/routes/__tests__/content.test.ts
control-plane/api/routes/__tests__/orgs.test.ts

// 4. Token encryption
packages/kernel/__tests__/encryption.test.ts
```

### Priority 2: Critical Reliability (Week 3)

```typescript
// 1. Job scheduling
apps/api/src/jobs/__tests__/JobScheduler.test.ts

// 2. Database transactions
packages/database/__tests__/transactions.test.ts

// 3. Advisory locks
packages/database/__tests__/pool.test.ts

// 4. Redis operations
packages/database/__tests__/redis.test.ts
```

### Priority 3: Business Logic (Week 4-5)

```typescript
// Services layer
packages/services/__tests__/billing.service.test.ts
packages/services/__tests__/content.service.test.ts
packages/services/__tests__/user.service.test.ts
```

## Running Tests

```bash
# All tests
npm test

# Unit tests only (fast)
npm run test:unit

# Integration tests (needs DB/Redis)
npm run test:integration

# Specific file
npm test -- packages/services/__tests__/billing.service.test.ts

# Watch mode (development)
npm run test:watch

# With coverage
npm run test:coverage
```

## Test Writing Patterns

### Unit Test Pattern

```typescript
// Arrange
const user = factories.user({ email: 'test@example.com' });

// Act
const result = await userService.create(user);

// Assert
expect(result.email).toBe('test@example.com');
expect(mockDb.insert).toHaveBeenCalledWith(
  expect.objectContaining({ email: 'test@example.com' })
);
```

### Integration Test Pattern

```typescript
// Setup test data
const org = await factories.createOrg();
const user = await factories.createUser({ org_id: org.id });

// Execute operation
const result = await contentService.list({ org_id: org.id });

// Verify database state
const dbRecords = await db('content').where({ org_id: org.id });
expect(dbRecords).toHaveLength(result.length);
```

### Route Test Pattern

```typescript
const response = await testHandler(contentHandler, {
  method: 'GET',
  headers: { authorization: `Bearer ${token}` },
  query: { org_id: org.id },
});

expect(response.status).toBe(200);
expect(response.json.data).toBeArray();
```

## Coverage Check

```bash
# Generate coverage report
npm run test:coverage

# View HTML report
open coverage/lcov-report/index.html
```

## Common Issues

### Database Connection Errors
```bash
# Ensure test DB is running
docker-compose -f docker-compose.test.yml ps

# Reset if needed
docker-compose -f docker-compose.test.yml down -v
docker-compose -f docker-compose.test.yml up -d
```

### Port Conflicts
```bash
# If 5433 or 6380 are in use
# Edit docker-compose.test.yml to use different ports
```

### Test Timeouts
```typescript
// For slow tests, increase timeout
jest.setTimeout(30000); // 30 seconds
```

## Success Checklist

Week by week progress:

- [ ] **Week 1:** Infrastructure running, first test passes
- [ ] **Week 2:** 40+ critical security tests passing
- [ ] **Week 3:** 80+ unit tests passing
- [ ] **Week 4:** 120+ tests, integration tests running
- [ ] **Week 5:** 180+ tests, route tests running
- [ ] **Week 6:** 245+ tests, 85%+ coverage achieved

## Resources

- **Full Plan:** `TEST_SUITE_PLAN.md`
- **Jest Docs:** https://jestjs.io/docs/getting-started
- **Testing Best Practices:** See TEST_SUITE_PLAN.md Appendix
