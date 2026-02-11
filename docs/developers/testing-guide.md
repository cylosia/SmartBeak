# Testing Guide

## Overview

This guide covers testing practices and procedures for the SmartBeak platform.

## Testing Philosophy

- **Unit tests** verify individual units of code
- **Integration tests** verify component interactions
- **E2E tests** verify complete user flows
- **Contract tests** verify API compatibility
- **Performance tests** verify system behavior under load

## Test Structure

```
project/
├── apps/
│   ├── web/
│   │   ├── __tests__/           # Component tests
│   │   └── cypress/             # E2E tests
│   └── api/
│       ├── src/
│       │   └── **/*.test.ts     # Unit tests alongside source
│       └── tests/               # Integration tests
├── control-plane/
│   └── **/*.test.ts             # Unit tests alongside source
├── domains/
│   └── [domain]/
│       └── domain/
│           └── *.test.ts        # Domain logic tests
└── packages/
    └── [package]/
        └── __tests__/           # Package tests
```

## Running Tests

### All Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch
```

### Specific Packages

```bash
# Web app tests
cd apps/web && npm test

# API tests
cd apps/api && npm test

# Control plane tests
cd control-plane && npm test

# Domain tests
npm run test:domains
```

### Test Patterns

```bash
# Run specific test file
npm test -- content.test.ts

# Run tests matching pattern
npm test -- --grep "publishing"

# Run tests for changed files only
npm test -- --changedSince=main
```

## Unit Testing

### Test Framework

We use **Vitest** for unit testing:

```typescript
// Example: domains/content/domain/content.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ContentItem } from '../entities/ContentItem';

describe('ContentItem', () => {
  let content: ContentItem;

  beforeEach(() => {
    content = ContentItem.create({
      title: 'Test Article',
      type: 'article',
      authorId: 'author_123',
    });
  });

  it('should create a draft content item', () => {
    expect(content.status).toBe('draft');
    expect(content.title).toBe('Test Article');
  });

  it('should not allow publishing without content', () => {
    expect(() => content.publish()).toThrow('Content body is required');
  });

  it('should transition to published state', () => {
    content.updateBody('Test content');
    content.publish();
    
    expect(content.status).toBe('published');
    expect(content.publishedAt).toBeDefined();
  });
});
```

### Mocking

```typescript
import { vi } from 'vitest';

// Mock a module
vi.mock('../lib/db', () => ({
  db: {
    query: vi.fn(),
  },
}));

// Mock a function
const mockSendEmail = vi.fn();
vi.mock('../services/email', () => ({
  sendEmail: mockSendEmail,
}));

// Spy on method
const spy = vi.spyOn(repository, 'save');

// Mock return value
mockSendEmail.mockResolvedValue({ messageId: '123' });
```

### Testing React Components

```typescript
// apps/web/components/__tests__/ContentEditor.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ContentEditor } from '../ContentEditor';

describe('ContentEditor', () => {
  it('renders editor with initial content', () => {
    render(<ContentEditor initialTitle="Test" initialBody="Content" />);
    
    expect(screen.getByDisplayValue('Test')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('calls onSave when save button clicked', () => {
    const onSave = vi.fn();
    render(<ContentEditor onSave={onSave} />);
    
    fireEvent.click(screen.getByText('Save'));
    
    expect(onSave).toHaveBeenCalled();
  });
});
```

### Testing API Routes

```typescript
// apps/api/tests/routes/content.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app';

describe('Content API', () => {
  let app;

  beforeAll(async () => {
    app = await buildApp({ testing: true });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /v1/content returns paginated results', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/content?limit=10',
      headers: { authorization: `Bearer ${testToken}` },
    });

    expect(response.statusCode).toBe(200);
    const data = JSON.parse(response.body);
    expect(data).toHaveProperty('data');
    expect(data).toHaveProperty('pagination');
  });

  it('POST /v1/content creates new content', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/content',
      headers: { 
        authorization: `Bearer ${testToken}`,
        'content-type': 'application/json',
      },
      payload: {
        title: 'Test Article',
        type: 'article',
      },
    });

    expect(response.statusCode).toBe(201);
    const data = JSON.parse(response.body);
    expect(data.title).toBe('Test Article');
  });
});
```

## Integration Testing

### Database Integration Tests

```typescript
// apps/api/tests/integration/publishing.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb } from '../helpers/database';
import { PublishingService } from '../../src/services/publishing';

describe('Publishing Integration', () => {
  let db;
  let service: PublishingService;

  beforeAll(async () => {
    db = await setupTestDb();
    service = new PublishingService(db);
  });

  afterAll(async () => {
    await teardownTestDb(db);
  });

  it('creates and processes publishing job', async () => {
    // Create content
    const content = await db.content.create({
      title: 'Test',
      status: 'published',
    });

    // Create publishing job
    const job = await service.createJob({
      contentId: content.id,
      targets: [{ type: 'wordpress', siteId: 'test' }],
    });

    expect(job.status).toBe('pending');

    // Process job
    await service.processJob(job.id);

    // Verify job completed
    const updated = await service.getJob(job.id);
    expect(updated.status).toBe('completed');
  });
});
```

### External Service Mocks

```typescript
// tests/helpers/mocks/stripe.ts
export const mockStripe = {
  paymentIntents: {
    create: vi.fn().mockResolvedValue({
      id: 'pi_test',
      status: 'requires_confirmation',
    }),
    confirm: vi.fn().mockResolvedValue({
      id: 'pi_test',
      status: 'succeeded',
    }),
  },
  customers: {
    create: vi.fn().mockResolvedValue({ id: 'cus_test' }),
  },
};

// Usage in test
vi.mock('stripe', () => ({
  default: vi.fn(() => mockStripe),
}));
```

## E2E Testing

### Cypress Setup

```bash
# Install Cypress dependencies
cd apps/web && npm run cypress:install

# Open Cypress UI
npm run cypress:open

# Run headless
npm run cypress:run
```

### Writing E2E Tests

```typescript
// apps/web/cypress/e2e/content/publishing.cy.ts
describe('Content Publishing', () => {
  beforeEach(() => {
    cy.login('test@example.com', 'password');
    cy.visit('/domains/test-domain/content');
  });

  it('creates and publishes content', () => {
    // Create content
    cy.get('[data-testid="new-content"]').click();
    cy.get('[data-testid="title-input"]').type('E2E Test Article');
    cy.get('[data-testid="editor"]').type('Test content body');
    cy.get('[data-testid="save-draft"]').click();

    // Verify content created
    cy.url().should('include', '/content/');
    cy.get('[data-testid="content-status"]').should('contain', 'Draft');

    // Publish content
    cy.get('[data-testid="publish-button"]').click();
    cy.get('[data-testid="confirm-publish"]').click();

    // Verify published
    cy.get('[data-testid="content-status"]').should('contain', 'Published');
  });
});
```

### E2E Test Data

```typescript
// cypress/support/commands.ts
Cypress.Commands.add('login', (email, password) => {
  cy.session([email, password], () => {
    cy.request('POST', '/api/auth/login', {
      email,
      password,
    }).then((response) => {
      window.localStorage.setItem('token', response.body.token);
    });
  });
});

Cypress.Commands.add('createTestDomain', () => {
  cy.request({
    method: 'POST',
    url: '/api/domains',
    body: {
      name: `Test Domain ${Date.now()}`,
      slug: `test-${Date.now()}`,
    },
  });
});
```

## Domain Testing

### Testing Domain Logic

```typescript
// domains/publishing/domain/publishing.lifecycle.test.ts
import { describe, it, expect } from 'vitest';
import { PublishingJob } from '../entities/PublishingJob';
import { PublishingTarget } from '../entities/PublishTarget';

describe('PublishingJob Lifecycle', () => {
  it('can be created with valid targets', () => {
    const targets = [
      PublishingTarget.create({ type: 'wordpress', config: {} }),
    ];
    
    const job = PublishingJob.create({
      contentId: 'content_123',
      targets,
    });
    
    expect(job.status).toBe('pending');
    expect(job.targets).toHaveLength(1);
  });

  it('transitions through states correctly', () => {
    const job = PublishingJob.create({
      contentId: 'content_123',
      targets: [],
    });

    job.start();
    expect(job.status).toBe('active');

    job.markTargetComplete('target_1');
    expect(job.completedTargets).toHaveLength(1);

    job.complete();
    expect(job.status).toBe('completed');
    expect(job.completedAt).toBeDefined();
  });

  it('handles failures with retry logic', () => {
    const job = PublishingJob.create({
      contentId: 'content_123',
      targets: [],
      maxRetries: 3,
    });

    job.start();
    job.markTargetFailed('target_1', new Error('Network error'));
    
    expect(job.retryCount).toBe(1);
    expect(job.canRetry()).toBe(true);

    // Simulate max retries
    job.markTargetFailed('target_1', new Error('Network error'));
    job.markTargetFailed('target_1', new Error('Network error'));
    
    expect(job.canRetry()).toBe(false);
    expect(job.status).toBe('failed');
  });
});
```

## Performance Testing

### Load Testing with k6

```javascript
// tests/performance/api-load.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 100 },   // Ramp up
    { duration: '3m', target: 100 },   // Stay at 100
    { duration: '1m', target: 200 },   // Ramp to 200
    { duration: '2m', target: 200 },   // Stay at 200
    { duration: '1m', target: 0 },     // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% under 500ms
    http_req_failed: ['rate<0.01'],    // Error rate < 1%
  },
};

export default function () {
  const res = http.get('https://api.smartbeak.io/v1/content?limit=10', {
    headers: {
      authorization: `Bearer ${__ENV.TEST_TOKEN}`,
    },
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  sleep(1);
}
```

Run:
```bash
k6 run --env TEST_TOKEN=xxx tests/performance/api-load.js
```

### Database Performance Tests

```typescript
// apps/api/tests/performance/db-queries.test.ts
import { describe, it, expect } from 'vitest';
import { db } from '../../src/db';

describe('Database Query Performance', () => {
  it('content listing query completes under 100ms', async () => {
    const start = Date.now();
    
    await db.content.findMany({
      where: { domainId: 'test' },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
    
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(100);
  });
});
```

## Test Data Management

### Factories

```typescript
// tests/factories/content.ts
import { faker } from '@faker-js/faker';

export const contentFactory = {
  create: (overrides = {}) => ({
    id: faker.string.uuid(),
    title: faker.lorem.sentence(),
    body: faker.lorem.paragraphs(3),
    status: 'draft',
    type: 'article',
    authorId: faker.string.uuid(),
    domainId: faker.string.uuid(),
    createdAt: faker.date.past(),
    updatedAt: faker.date.recent(),
    ...overrides,
  }),

  createMany: (count: number, overrides = {}) =>
    Array.from({ length: count }, () => contentFactory.create(overrides)),
};

// Usage
const content = contentFactory.create({ status: 'published' });
const drafts = contentFactory.createMany(10, { status: 'draft' });
```

### Database Seeds

```typescript
// scripts/seed.ts
import { db } from '../apps/api/src/db';
import { contentFactory } from '../tests/factories/content';

async function seed() {
  // Create test organization
  const org = await db.orgs.create({
    data: { name: 'Test Org', slug: 'test-org' },
  });

  // Create test user
  const user = await db.users.create({
    data: {
      email: 'test@example.com',
      orgId: org.id,
    },
  });

  // Create test content
  const contents = contentFactory.createMany(50, {
    authorId: user.id,
    domainId: 'test-domain',
  });

  await db.content.createMany({ data: contents });

  console.log('Seed completed');
}

seed();
```

## Coverage Requirements

| Code Type | Minimum Coverage |
|-----------|------------------|
| Domain logic | 90% |
| Application services | 80% |
| API routes | 70% |
| Infrastructure | 60% |
| UI components | 70% |

### Coverage Report

```bash
# Generate coverage report
npm run test:coverage

# View HTML report
open coverage/index.html

# Check coverage threshold
npm run test:coverage:check
```

## Continuous Integration

Tests run automatically on:

1. **Pull Request:** All tests must pass
2. **Merge to main:** Full test suite + coverage
3. **Nightly:** Performance tests + security scans

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_PASSWORD: postgres
      redis:
        image: redis:7
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run test:ci
      - run: npm run test:coverage
```

## Best Practices

### DO

- Write tests before fixing bugs
- Use descriptive test names
- Arrange-Act-Assert pattern
- Clean up test data
- Test edge cases and error conditions
- Use factories for test data

### DON'T

- Test implementation details
- Share state between tests
- Write tests with external dependencies
- Skip tests without explanation
- Write tests that depend on order

## Related Documentation

- [Local Development Setup](./local-development-setup.md)
- [Contribution Guidelines](./contribution-guidelines.md)
