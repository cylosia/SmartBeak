# SmartBeak

AI-powered content publishing platform built with Next.js, Fastify, and PostgreSQL.

## Prerequisites

- Node.js >= 20.0.0
- npm >= 10.0.0
- Docker (for local PostgreSQL & Redis)

## Quick Start

```bash
cp .env.example .env        # configure environment variables (see below)
docker compose up -d         # start PostgreSQL 15 & Redis 7
npm ci                       # install dependencies
npm run migrate              # apply database migrations
npm run dev                  # start the Fastify API server (port 3001)
```

In a separate terminal:

```bash
cd apps/web && npm run dev   # start Next.js dev server (port 3000)
```

Optionally, in a third terminal:

```bash
npm run worker               # start BullMQ background job worker
```

Verify everything is running:

```bash
curl http://localhost:3001/health   # API health check
curl http://localhost:3000          # Web app
```

### Minimum environment variables

After copying `.env.example`, you **must** replace placeholders for at least these variables
(the Zod startup validator rejects placeholder strings like `your_*`):

| Variable | How to get it |
|----------|--------------|
| `CONTROL_PLANE_DB` | `postgresql://smartbeak:smartbeak@localhost:5432/smartbeak` (Docker Compose defaults) |
| `REDIS_URL` | `redis://localhost:6379` (Docker Compose defaults) |
| `JWT_KEY_1` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `JWT_KEY_2` | Generate again — must differ from `JWT_KEY_1` |
| `KEY_ENCRYPTION_SECRET` | Generate the same way (32+ bytes) |
| `CLERK_SECRET_KEY` | From [Clerk dashboard](https://dashboard.clerk.dev) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | From [Clerk dashboard](https://dashboard.clerk.dev) |
| `CLERK_WEBHOOK_SECRET` | From [Clerk dashboard](https://dashboard.clerk.dev) |

All other API keys (Stripe, OpenAI, Ahrefs, etc.) are optional — they're gated behind
feature flags that default to `false`. Delete or leave blank any lines you don't need,
but **do not leave placeholder values** or the app will refuse to start.

## Repository Structure

```
apps/web/             Next.js frontend
apps/api/             Background worker / job runner
control-plane/        Fastify API server (REST + OpenAPI)
domains/              Domain modules (content, publishing, etc.)
packages/             Shared libraries (config, database, logger, etc.)
themes/               Theme templates for published sites
infra/                Infrastructure configs (K8s, Terraform, observability)
migrations/sql/       Database migrations
```

## Key Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start API server (port 3001) |
| `cd apps/web && npm run dev` | Start Next.js dev server (port 3000) |
| `npm run worker` | Start BullMQ background worker |
| `npm run build` | Full TypeScript build |
| `npm run build:web` | Next.js production build |
| `npm run type-check` | TypeScript compilation check |
| `npm run lint` | ESLint |
| `npm run lint:security` | Security-focused linting |
| `npm run test:unit` | Unit tests (Jest, parallel) |
| `npm run test:integration` | Integration tests (Jest, serial — needs DB + Redis) |
| `npm run test:a11y` | Accessibility tests (jsdom) |
| `npm run test:load` | Load tests (Vitest) |
| `npm run test:chaos` | Chaos tests (Vitest) |
| `npm run test:bench` | Benchmarks (Vitest) |
| `npm run test:visual` | Visual regression (Playwright) |
| `npm run migrate` | Apply DB migrations |
| `npm run migrate:rollback` | Rollback DB migrations |
| `npm run migrate:status` | Show migration status |
| `npm run openapi:generate` | Generate OpenAPI spec |
| `npm run openapi:lint` | Lint OpenAPI spec |

## Common Gotchas

- **Env placeholder rejection**: The Zod startup validator rejects placeholder strings (`your_*`, `xxx`, `test`, `demo`, `fake`, `mock`). Delete unused lines from `.env` instead of leaving placeholders.
- **Docker Compose DB creds**: Docker creates `smartbeak`/`smartbeak`/`smartbeak` (user/pass/db). The `.env.example` has generic `user:password` — update to match.
- **JWT keys must differ**: `JWT_KEY_1` and `JWT_KEY_2` must be different values or validation fails at startup.
- **Bracket notation required**: `noPropertyAccessFromIndexSignature` means `process.env['VAR']` and `obj['key']`, not dot notation.
- **No `any`**: ESLint errors on `any` in production code. Use `unknown` with type guards. (`any` is allowed in test files.)
- **No `console.log`**: Use `getLogger('Name')` from `@kernel/logger`.
- **ESM only**: Use `import`/`export`, never `require()`.
- **No Prettier**: Formatting is ESLint-only. Don't add Prettier configs.
- **Migration roundtrip**: CI verifies both `.up.sql` and `.down.sql` apply cleanly. Always write both.
- **Clerk webhooks locally**: Use ngrok to tunnel to `localhost:3000/api/webhooks/clerk`.

## Documentation

See the `docs/` directory for detailed documentation:

- [Local Development Setup](docs/developers/local-development-setup.md) — full setup walkthrough
- [Testing Guide](docs/developers/testing-guide.md) — test patterns and conventions
- [Contribution Guidelines](docs/developers/contribution-guidelines.md)
- [System Architecture](docs/architecture/system-architecture.md)
