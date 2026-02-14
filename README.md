# SmartBeak

AI-powered content publishing platform built with Next.js, Fastify, and PostgreSQL.

## Prerequisites

- Node.js >= 20.0.0
- npm >= 10.0.0
- Docker (for local PostgreSQL & Redis)

## Quick Start

```bash
cp .env.example .env        # configure environment variables
docker compose up -d         # start postgres & redis
npm ci                       # install dependencies
npm run migrate              # apply database migrations
npm run dev                  # start the API server
npm run build:web            # build the Next.js frontend (separate terminal)
```

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
| `npm run dev` | Start API server |
| `npm run build:web` | Build Next.js app |
| `npm run type-check` | TypeScript compilation check |
| `npm run lint` | ESLint |
| `npm run lint:security` | Security-focused linting |
| `npm run test:unit` | Unit tests |
| `npm run test:integration` | Integration tests |
| `npm run migrate` | Apply DB migrations |
| `npm run migrate:rollback` | Rollback DB migrations |
| `npm run migrate:status` | Show migration status |
| `npm run openapi:lint` | Lint OpenAPI spec |

## Documentation

See the `docs/` directory for detailed documentation including the OpenAPI specification.
