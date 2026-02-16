# CLAUDE.md

## Commands

```bash
# Dev
npm run dev                  # Fastify API server (port 3001)
npm run build                # Full TypeScript build
npm run build:web            # Next.js frontend build

# Checks (run before committing)
npm run type-check           # TypeScript type checking (no emit)
npm run lint                 # ESLint on all .ts/.tsx
npm run lint:security        # Security-focused ESLint rules

# Tests
npm run test:unit            # Jest unit tests (parallel)
npm run test:integration     # Jest integration tests (serial, needs DB + Redis)
npm run test:a11y            # Accessibility tests (jsdom)
npm run test:load            # Vitest load tests
npm run test:chaos           # Vitest chaos tests
npm run test:bench           # Vitest benchmarks
npm run test:visual          # Playwright visual regression

# Database
npm run migrate              # Apply SQL migrations
npm run migrate:rollback     # Rollback last migration batch
npm run migrate:make         # Create new migration file pair

# OpenAPI
npm run openapi:generate     # Generate OpenAPI spec from routes
npm run openapi:lint         # Lint OpenAPI spec (Spectral)
```

Local infra: `docker compose up -d` starts PostgreSQL 15 and Redis 7.

## Architecture

Monorepo using npm workspaces (`packages/*`, `apps/*`).

```
apps/web/              Next.js 15 frontend (React 18, TanStack Query, Tailwind)
apps/api/              BullMQ worker for background jobs
control-plane/         Fastify 5 REST API (port 3001)
  api/routes/          Route handlers with Zod schema validation
  api/middleware/      Auth, rate limiting, security headers
  services/            Business logic services
  adapters/            External integrations (Facebook, LinkedIn, etc.)
  db/                  Database access layer
  jobs/                Scheduled jobs
domains/               Domain modules (DDD)
  {name}/domain/       Entities, value objects, domain events
  {name}/application/  Use-case handlers and port interfaces
  {name}/infra/        Repository implementations
packages/              Shared libraries
  kernel/              Logger, branded types, Redis, queues, retry, validation
  errors/              AppError subclasses, ErrorCodes, sanitization
  database/            PostgreSQL pool, health checks, connection management
  config/              Environment config, feature flags
  security/            Auth utilities, CSRF, SSRF protection, encryption
  monitoring/          OpenTelemetry tracing, Prometheus metrics
  middleware/          Shared Fastify middleware
  types/               Shared TypeScript type definitions
  utils/               General utilities
migrations/            SQL migration files (Knex): *.up.sql + *.down.sql pairs
plugins/               Plugin system
themes/                Theme templates
infra/                 K8s, Terraform, observability configs
```

## Code Conventions

### TypeScript

Strict mode with additional checks enabled:

- `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`
- **No `any`** -- ESLint error. Use `unknown` instead. (`any` is allowed in test files only.)
- **No floating promises** -- ESLint errors for `no-floating-promises` and `no-misused-promises`
- Catch parameters must be `unknown`. Use `getErrorMessage(error)` from `@errors` to extract messages.
- Access indexed/mapped properties with bracket notation: `obj['key']` not `obj.key`
- ESM only (`"type": "module"`). Use `import`/`export`, never `require`.

### Naming

| Context | Convention | Example |
|---------|-----------|---------|
| Variables, functions | camelCase | `getContent`, `idempotencyKey` |
| Classes, types, interfaces | PascalCase | `ContentItem`, `AppError` |
| Constants | UPPER_SNAKE_CASE | `ERROR_CODES`, `TOKEN_EXPIRY_MS` |
| Files | kebab-case | `content-scheduler.ts` |
| DB tables, columns | snake_case | `lead_magnets`, `created_at` |
| Tests | `*.test.ts` or `*.spec.ts` | `flags.test.ts` |

### Imports

Always use path aliases for cross-package imports:

```typescript
import { getLogger } from '@kernel/logger';
import { AppError, ValidationError, ErrorCodes, getErrorMessage } from '@errors';
import { validateEnv } from '@config';
import { getDb } from '@database';
import type { UserId, OrgId } from '@kernel/branded';
import type { ContentItem } from '@domain/content/domain/entities/ContentItem';
```

Available aliases: `@kernel/*`, `@security/*`, `@errors`, `@config`, `@database`, `@utils/*`, `@types/*`, `@domain/*`, `@adapters/*`, `@packages/*`, `@shutdown`, `@monitoring`

### Error Handling

Throw `AppError` subclasses from `@errors`: `ValidationError`, `AuthError`, `ForbiddenError`, `NotFoundError`, `DatabaseError`, `RateLimitError`, `ConflictError`, `PayloadTooLargeError`, `ServiceUnavailableError`.

- Use error codes from `ErrorCodes` constant (e.g., `ErrorCodes.NOT_FOUND`)
- Use `sanitizeErrorForClient(error)` for HTTP responses -- strips internal details in production
- Use `DatabaseError.fromDBError(err)` for database errors -- sanitizes SQL details
- Include `requestId` in error responses for distributed tracing

### Logging

Never use `console.log`. Use the structured logger:

```typescript
import { getLogger } from '@kernel/logger';
const logger = getLogger('ServiceName');
logger.info('message', { key: 'value' });
logger.error('failed', error);
```

Logger auto-redacts sensitive fields (tokens, passwords, API keys).

### Validation

- Zod schemas for all request validation, defined at the top of route files
- Use `.strict()` on Zod object schemas to reject extra properties
- Fastify routes use `fastify-type-provider-zod` for type-safe schemas

### Database

- PostgreSQL via `pg` pool (`@database`), migrations via Knex
- Migration files are SQL pairs: `{timestamp}_{name}.up.sql` / `{timestamp}_{name}.down.sql`
- Transactions: acquire client from pool, explicit `BEGIN` / `COMMIT` / `ROLLBACK` with rollback error logging
- Branded types for IDs (`UserId`, `OrgId`, `ContentId`) -- use factory functions like `createUserId(id)`

### Auth

- Clerk for user authentication (frontend + API)
- JWT for API token auth
- Roles: `owner`, `admin`, `editor`, `viewer`
- Rate limiting runs before auth checks

### Testing

- Jest: unit + integration. Vitest: load, chaos, benchmarks. Playwright: visual regression.
- Coverage thresholds: 70% branches / 80% lines globally; 90% for billing paths
- `clearMocks: true` and `restoreMocks: true` set globally in Jest config

## Common Pitfalls

- **Indexed access required**: `noPropertyAccessFromIndexSignature` means write `process.env['VAR_NAME']` and `obj['key']`, not dot notation, for index-signature types.
- **Optional properties**: `exactOptionalPropertyTypes` means `undefined` is NOT assignable to optional props. Declare as `prop?: string | undefined` if you need to set `undefined` explicitly.
- **No Prettier**: Formatting is ESLint-only. Do not add Prettier configs.
- **Migration roundtrip**: CI verifies migrations apply AND rollback cleanly. Always write both `.up.sql` and `.down.sql`.
- **Unused variables**: Prefix with underscore (`_unused`) to suppress the lint warning.
- **Unused imports/params in tests**: `no-explicit-any`, `no-var-requires`, and `no-non-null-assertion` are disabled in test files only.
