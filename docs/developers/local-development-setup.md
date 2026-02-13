# Local Development Setup Guide

## Overview

This guide walks through setting up the SmartBeak development environment on your local machine.

## Prerequisites

### Required Software

| Software | Version | Purpose |
|----------|---------|---------|
| Node.js | >= 20.0.0 | Runtime |
| npm | >= 10.0.0 | Package manager |
| PostgreSQL | >= 15 | Database |
| Redis | >= 7 | Job queue, cache |
| Git | >= 2.30 | Version control |

### Optional but Recommended

| Software | Purpose |
|----------|---------|
| Docker | Containerization |
| Docker Compose | Multi-container setup |
| tmux/screen | Terminal multiplexing |
| ngrok | Webhook testing |

## Quick Start (Docker)

The fastest way to get started is using Docker Compose:

```bash
# Clone the repository
git clone https://github.com/smartbeak/smartbeak.git
cd smartbeak

# Copy environment template
cp .env.example .env

# Start all services (postgres, redis, api, worker, web)
# Health checks ensure services start in the correct order
docker compose up -d

# Run database migrations
docker compose exec api npm run migrate

# Access the application
# Web app: http://localhost:3000
# API:     http://localhost:3001/health
open http://localhost:3000
```

## Manual Setup

### 1. Clone Repository

```bash
git clone https://github.com/smartbeak/smartbeak.git
cd smartbeak
```

### 2. Install Dependencies

```bash
# Install all dependencies (npm workspaces handles sub-packages automatically)
npm install
```

### 3. Database Setup

#### Option A: Local PostgreSQL

```bash
# macOS with Homebrew
brew install postgresql@15
brew services start postgresql@15

# Create databases
createdb smartbeak_control_plane
createdb smartbeak_domain_template

# Verify connection
psql smartbeak_control_plane -c "SELECT version();"
```

#### Option B: Docker PostgreSQL

```bash
# Run PostgreSQL container
docker run -d \
  --name smartbeak-postgres \
  -e POSTGRES_USER=smartbeak \
  -e POSTGRES_PASSWORD=dev_password \
  -e POSTGRES_DB=smartbeak_control_plane \
  -p 5432:5432 \
  postgres:15-alpine

# Create additional databases
docker exec smartbeak-postgres createdb -U smartbeak smartbeak_domain_template
```

### 4. Redis Setup

#### Option A: Local Redis

```bash
# macOS with Homebrew
brew install redis
brew services start redis

# Verify
redis-cli ping
```

#### Option B: Docker Redis

```bash
docker run -d \
  --name smartbeak-redis \
  -p 6379:6379 \
  redis:7-alpine
```

### 5. Environment Configuration

```bash
# Copy example environment file
cp .env.example .env

# Edit .env with your values
# Required minimum configuration:
cat > .env << 'EOF'
# Database
CONTROL_PLANE_DB=postgresql://smartbeak:dev_password@localhost:5432/smartbeak_control_plane

# Redis
REDIS_URL=redis://localhost:6379

# Clerk (get from https://dashboard.clerk.dev)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_YOUR_KEY
CLERK_SECRET_KEY=sk_test_YOUR_KEY
CLERK_WEBHOOK_SECRET=whsec_YOUR_SECRET

# Stripe (optional for most development)
STRIPE_SECRET_KEY=sk_test_YOUR_KEY
STRIPE_WEBHOOK_SECRET=whsec_YOUR_SECRET

# App URLs
NEXT_PUBLIC_APP_URL=http://localhost:3000
APP_URL=http://localhost:3001
EOF
```

### 6. Database Migrations

```bash
# Run all pending migrations (control plane and domain tables)
npm run migrate

# Check migration status
npm run migrate:status
```

All migrations live in `migrations/sql/` and are managed by `scripts/migrate.ts` using Knex with a custom `SqlMigrationSource`. Migration files follow the naming convention `YYYYMMDDHHMMSS_[cp|dom|infra|pkg]_description.[up|down].sql`.

### 7. Start Development Servers

```bash
# Terminal 1: Control Plane API (Fastify, port 3001)
npm run dev

# Terminal 2: Web app (Next.js, port 3000)
cd apps/web && npm run dev

# Terminal 3: Worker processes (optional, for background job processing)
npm run worker
```

`npm run dev` starts the control-plane API server with OpenTelemetry tracing enabled. The API routes from `apps/api` are registered within the control-plane server, so there is no need to start them separately.

### 8. Verify Setup

```bash
# API health check
curl http://localhost:3001/health

# Web app check
curl http://localhost:3000

# Database check (confirm migrations ran)
npm run migrate:status

# Redis check
redis-cli ping
```

## IDE Setup

### VS Code

Recommended extensions:

```json
// .vscode/extensions.json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "bradlc.vscode-tailwindcss",
    "ms-vscode.vscode-typescript-next",
    "eamodio.gitlens",
    "ms-vscode.vscode-json"
  ]
}
```

Settings:

```json
// .vscode/settings.json
{
  "editor.formatOnSave": true,
  "typescript.tsdk": "node_modules/typescript/lib",
  "eslint.workingDirectories": [{ "mode": "auto" }]
}
```

### WebStorm / IntelliJ

1. Open project root
2. Configure TypeScript compiler for each module
3. Set up ESLint integration

## Development Workflow

### Branch Naming

```
feature/description    # New features
bugfix/description     # Bug fixes
hotfix/description     # Production hotfixes
chore/description      # Maintenance tasks
docs/description       # Documentation
```

### Commit Messages

Follow conventional commits:

```
feat: add user authentication
fix: resolve content loading issue
docs: update API documentation
chore: update dependencies
refactor: simplify publishing logic
test: add unit tests for auth service
```

### Running Tests

```bash
# Unit tests
npm run test:unit

# Integration tests (runs serially with --runInBand)
npm run test:integration
```

### Code Quality

```bash
# Lint all files
npm run lint

# Security-focused linting
npm run lint:security

# Type check
npm run type-check
```

## External Services Setup

### Clerk (Required)

1. Sign up at https://dashboard.clerk.dev
2. Create a new application
3. Copy API keys to `.env`
4. Configure webhook endpoint (for local: use ngrok)

```bash
# Start ngrok for webhook testing
ngrok http 3000

# Configure webhook URL in Clerk dashboard:
# https://your-ngrok-url.ngrok.io/api/webhooks/clerk
```

### Stripe (Optional)

1. Sign up at https://dashboard.stripe.com
2. Switch to test mode
3. Copy API keys to `.env`
4. Install Stripe CLI for webhook testing

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks to local
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# Copy webhook signing secret to .env
```

### External APIs (Optional)

Most external integrations work in mock mode during development. To test real integrations:

1. **Ahrefs:** Get API token from https://ahrefs.com/v3/api
2. **GSC:** Create OAuth credentials in Google Cloud Console
3. **LinkedIn:** Create app at https://www.linkedin.com/developers

## Troubleshooting

### Common Issues

#### Port Already in Use

```bash
# Find process using port 3000
lsof -i :3000

# Kill process
kill -9 <PID>

# Or use different port
PORT=3002 npm run dev
```

#### Database Connection Failed

```bash
# Check PostgreSQL is running
brew services list | grep postgresql

# Check connection string
psql postgresql://user:pass@localhost:5432/dbname

# Rollback and re-apply migrations
npm run migrate:rollback
npm run migrate
```

#### Redis Connection Failed

```bash
# Check Redis is running
redis-cli ping

# If using Docker
docker ps | grep redis
```

#### Module Not Found

```bash
# Clear node_modules and reinstall
rm -rf node_modules apps/*/node_modules control-plane/node_modules
npm install
```

#### TypeScript Errors

```bash
# Type check
npm run type-check

# Full build
npm run build

# Clear TS cache
rm -rf apps/*/tsconfig.tsbuildinfo
```

### Getting Help

1. Check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
2. Search existing GitHub issues
3. Ask in #dev-help Slack channel
4. Create new issue with reproduction steps

## Advanced Configuration

### Using Local SSL

```bash
# Generate self-signed certificate
mkdir -p .cert
openssl req -x509 -newkey rsa:4096 -keyout .cert/key.pem -out .cert/cert.pem -days 365 -nodes

# Update .env
NEXT_PUBLIC_APP_URL=https://localhost:3000
HTTPS=true
SSL_CRT_FILE=.cert/cert.pem
SSL_KEY_FILE=.cert/key.pem
```

### Debugging

#### Node.js Debugger

```bash
# Start with debugger
node --inspect-brk control-plane/api/http.ts
```

Then attach in VS Code or Chrome DevTools.

#### Logging Levels

```bash
# Debug logging
LOG_LEVEL=debug npm run dev
```

### Performance Profiling

```bash
# Analyze bundle size
npm run analyze:bundle
```

## Next Steps

1. Read [Testing Guide](./testing-guide.md)
2. Read [Contribution Guidelines](./contribution-guidelines.md)
3. Explore [Architecture Documentation](../architecture/)
4. Join the team Slack channel

## Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [Fastify Documentation](https://fastify.dev/docs/)
- [Knex.js Documentation](https://knexjs.org/guide/)
- [BullMQ Documentation](https://docs.bullmq.io/)
