# SmartBeak — Project Analysis (from code)

## 1. What This Project Does

SmartBeak is a **multi-tenant SaaS platform for content management and multi-channel publishing**. Organizations use it to:

- **Create and manage content** (articles, pages, products, reviews, guides, posts, images, videos) through a lifecycle: `draft → scheduled → published → archived`
- **Publish to external platforms**: WordPress, LinkedIn, Facebook, TikTok, Instagram, Pinterest, YouTube, Vimeo, SoundCloud, podcast feeds, email newsletters
- **Manage a portfolio of domains** — register, verify ownership via DNS TXT records, track health, and value domains for sale
- **Track affiliate revenue** across Amazon Associates, Commission Junction, and Impact Radius
- **Run keyword research and SEO** via Ahrefs, Google Search Console, and SERP/PAA APIs
- **Handle billing and subscriptions** through Stripe and Paddle, with usage metering and overage pricing
- **Generate content with AI** — LLM-based content drafting, image generation
- **Send notifications** via email (AWS SES), Slack, and webhooks
- **Provide analytics dashboards** — content ROI, traffic, portfolio heatmaps

It is organized as a DDD monorepo with 13 bounded contexts (content, publishing, notifications, search, media, SEO, authors, customers, planning, activity, diligence, domains, shared).

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (strict mode, ESM-only, no `any`) |
| Frontend | Next.js 15, React 18, TanStack Query, Tailwind CSS, TipTap editor |
| API server | Fastify 5 (port 3001), `fastify-type-provider-zod` |
| Background jobs | BullMQ workers on Redis 7 |
| Database | PostgreSQL 15 via `pg` pool; Knex for migrations |
| Cache/queues | Redis 7 (ioredis) |
| Auth | Clerk (frontend), JWT (API), RBAC (owner/admin/editor/viewer) |
| Payments | Stripe, Paddle |
| Email | AWS SES, Postmark |
| Object storage | Cloudflare R2 / AWS S3 |
| Observability | OpenTelemetry tracing, Prometheus metrics, structured logger with auto-redaction |
| Deployment | Vercel (frontend), Docker Compose (local), Kubernetes + Terraform (prod) |
| Testing | Jest (unit/integration), Vitest (load/chaos/bench), Playwright (visual) |

**Key dependencies**: `bullmq`, `ioredis`, `pg`, `zod`, `p-limit`, `@clerk/nextjs`, `stripe`, `@aws-sdk/client-ses`, `googleapis`, `@opentelemetry/api`

---

## 3. Every Execution Entry Point

### A. HTTP Server — `control-plane/api/http.ts`

Fastify 5 app on port 3001. All business routes under `/v1` prefix via `control-plane/api/plugins/v1-routes.ts`. Infrastructure routes at root level.

**Infrastructure endpoints** (in `http.ts`):
- `GET /health` — basic health check
- `GET /readyz` — readiness probe (DB pool, sequences, repository health)
- `GET /livez` — liveness probe

**Business routes** (34 route modules, all under `/v1`):
- Content: CRUD, revisions, scheduling, content list
- Domains: CRUD, ownership verification, domain details, portfolio
- Publishing: targets, jobs, retry, create-job, preview
- Billing: subscribe, plan, invoices
- Organizations: create, members, invite
- Notifications: list, preferences, admin
- Search, SEO, Analytics, Usage, Planning
- Media: upload-intent, complete, lifecycle
- Affiliates, Attribution, ROI/Risk
- LLM (AI generation), Themes, Cache, Guardrails
- Admin: DLQ management, queue metrics, timeline, diligence
- Onboarding: step completion
- Migrated apps/api routes (`apps-api-routes`)

### B. Background Worker — `apps/api/src/jobs/worker.ts`

Standalone BullMQ worker process (`npm run worker` / `tsx apps/api/src/jobs/worker.ts`).

**8 named queues**: `high_priority`, `ai-tasks`, `publishing`, `low_priority_exports`, `notifications`, `analytics`, `feedback`, `experiments`

**5 registered job handlers**:

| Job | Queue | Timeout | Retries |
|-----|-------|---------|---------|
| `content-idea-generation` | ai-tasks | 120s | 2 |
| `domain-export` | low_priority_exports | 600s | 3 |
| `publish-execution` | publishing | 300s | 3 |
| `feedback-ingest` | feedback | 300s | 3 |
| `experiment-start` | experiments | 60s | 2 |

Worker concurrency: 5. Graceful shutdown on SIGTERM/SIGINT with 10s timeout.

### C. Scheduled Jobs (timer-based, not cron)

In `control-plane/jobs/`:

- **`content-scheduler.ts`** — `runContentScheduler()`: polls DB for content with `status='scheduled'` and `publishAt <= NOW()`, publishes via `PublishContent` handler. Concurrency: 5 (p-limit), batch: 100, retry: 3, timeout: 30s per item.
- **`media-cleanup.ts`** — `runMediaCleanup()`: archives cold media (30 days), deletes orphans (7 days). Concurrency: 10, batch: 100, timeout: 5min.

### D. Domain Event Bus — `packages/kernel/event-bus.ts`

In-process pub/sub with plugin subscriptions. Events like `content.published` trigger handlers (e.g., publishing plugin enqueues a publish job). Circuit breaker: 10 failures, 30s reset.

### E. Outbox Relay — `packages/database/outbox.ts`

Transactional outbox pattern: domain events written to `event_outbox` table within DB transactions, then relayed to the event bus by a background poller for at-least-once delivery.

### F. Next.js Frontend — `apps/web/`

Next.js 15 app with Clerk auth middleware. Has its own API routes under `apps/web/pages/api/` for:
- Content CRUD proxying
- Stripe webhook handling
- Webhook receivers

### G. CLI/Scripts

- `npm run migrate` — `scripts/migrate.ts` — Knex runner against `migrations/sql/*.up.sql`
- `npm run openapi:generate` — generates OpenAPI spec from Fastify routes

---

## 4. Top 5 Files to Read First

1. **`control-plane/api/http.ts`** — The main API server. Shows how Fastify boots, middleware ordering (CORS, security headers, backpressure, rate limiting, auth), health endpoints, and how the v1 route plugin is mounted. This is the front door.

2. **`control-plane/api/plugins/v1-routes.ts`** — The complete route registry. Every business endpoint in the system is imported and mounted here. This is the map of the entire API surface.

3. **`domains/content/domain/entities/ContentItem.ts`** — The central domain entity. Shows the DDD pattern used everywhere: immutable entities, state machine transitions, domain event emission, validation. Understanding this file means understanding every other domain entity.

4. **`apps/api/src/jobs/JobScheduler.ts`** — The BullMQ job orchestration engine. Shows queue management, priority system, rate limiting, distributed tracing propagation, backpressure, and worker lifecycle. This is how all async work gets done.

5. **`apps/api/src/jobs/index.ts`** — Job registration and queue definitions. Shows which jobs exist, their queues, timeouts, and retry policies. Combined with `worker.ts` (which is just a thin bootstrap), this explains the entire background processing system.
