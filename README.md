# SmartBeak — Premium AI-Powered Multi-Tenant Content Publishing SaaS

SmartBeak is a staged-beta, multi-tenant content publishing platform built on **Supastarter Pro** (Turborepo + Next.js 15 + Hono + Drizzle ORM + Supabase). It delivers a premium SaaS experience for domain portfolio management, AI-assisted content creation, supported publishing workflows, SEO tracking, and operator-facing diligence review surfaces.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Cylosia/SmartBeak)

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Feature Set](#feature-set)
3. [Tech Stack](#tech-stack)
4. [Local Development Setup](#local-development-setup)
5. [Environment Variables](#environment-variables)
6. [Database Setup](#database-setup)
7. [Deploying to Vercel + Supabase](#deploying-to-vercel--supabase)
8. [Schema Governance](#schema-governance)
9. [RBAC and Multi-Tenancy](#rbac-and-multi-tenancy)
10. [SmartDeploy](#smartdeploy)

---

## Architecture Overview

The monorepo is structured as follows:

- `apps/web` — Next.js 15 App Router (main SaaS frontend)
- `packages/api` — Hono + oRPC API server with all SmartBeak modules (domains, content, media, publishing, SEO, billing, audit, portfolio, onboarding, AI ideas, settings)
- `packages/database` — Drizzle ORM + Prisma dual adapter
  - `drizzle/schema/smartbeak.ts` — **LOCKED v9 schema** (single source of truth)
  - `drizzle/schema/postgres.ts` — core SaaS tables
- `packages/auth` — better-auth configuration
- `packages/payments` — Stripe / Lemonsqueezy / Polar adapters
- `packages/mail` — Resend / Nodemailer / Postmark adapters
- `packages/storage` — S3-compatible storage
- `packages/ai` — Vercel AI SDK configuration
- `packages/ui` — shadcn/ui component library
- `tooling/` — Shared ESLint, Tailwind, TypeScript configs

---

## Feature Set

### Core Platform

- **Multi-tenant organizations** with full RBAC (owner / admin / editor / viewer)
- **Domain management** — recorded registry metadata, health snapshots, and deployment status
- **Rich content editor** — Tiptap-powered with revision history and AI idea generation
- **Media library** — S3-backed upload, storage, preview, and deletion workflows
- **Publishing orchestration** — supported social adapters with retry and live status, plus gated setup for unfinished targets
- **SEO tools** — per-domain SEO documents and keyword tracking

### Premium Dashboards

- **Portfolio ROI Dashboard** — aggregate portfolio scoring, trend analysis, and ROI metrics
- **Diligence Report** — per-domain checks, decay signals, and sell-readiness score
- **Timeline** — chronological event history per domain
- **Buyer Attribution** — session tracking and attribution for domain sale pipelines

### Operations

- **Billing and Usage** — Stripe sync, quota enforcement, monetization decay signals
- **Immutable Audit Log** — every mutation recorded via database trigger
- **Onboarding Wizard** — step-by-step guided setup with progress tracking
- **Feature Flags and Guardrails** — per-org feature toggles and abuse protection
- **SmartDeploy** — standalone legacy deploy surface for domain/site generation and Vercel deployment workflows

### Developer Experience

- Strict TypeScript throughout
- Zod validation on all API inputs and outputs
- Optimistic updates via TanStack Query
- Loading skeletons and error boundaries on every page
- Dark mode and responsive premium UI (shadcn/ui + Tailwind)

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Next.js 15 (App Router), React 19, TypeScript |
| **Styling** | Tailwind CSS v4, shadcn/ui, Lucide Icons |
| **API** | Hono, oRPC (type-safe RPC over HTTP) |
| **Database** | PostgreSQL via Supabase, Drizzle ORM + Prisma |
| **Auth** | better-auth (email/password, OAuth, organizations, RBAC) |
| **Payments** | Stripe (primary), Lemonsqueezy / Polar / Creem adapters |
| **Email** | Resend (primary), Nodemailer / Postmark / Mailgun adapters |
| **Storage** | S3-compatible (Supabase Storage, MinIO for local dev) |
| **AI** | Vercel AI SDK (OpenAI GPT-4.1) |
| **Charts** | Recharts |
| **Monorepo** | Turborepo + pnpm workspaces |
| **Deploy** | Vercel (frontend + API), Supabase (database + storage) |

---

## Local Development Setup

### Prerequisites

- **Node.js** >= 20 (via `nvm` or `fnm`)
- **pnpm** >= 9 (`npm install -g pnpm`)
- **Docker** (for local PostgreSQL + MinIO via Docker Compose)

### 1. Clone and install

```bash
git clone https://github.com/Cylosia/SmartBeak.git
cd SmartBeak
pnpm install
```

### 2. Start local services

```bash
docker-compose up -d
```

This starts PostgreSQL on `localhost:5432` and MinIO on `localhost:9000`.

### 3. Configure environment

```bash
cp .env.local.example .env.local
```

Minimum required variables for local development:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/supastarter"
NEXT_PUBLIC_SITE_URL="http://localhost:3000"
BETTER_AUTH_SECRET="any-random-32-char-string"
S3_ACCESS_KEY_ID="minioadmin"
S3_SECRET_ACCESS_KEY="minioadmin"
S3_ENDPOINT="http://localhost:9000"
S3_REGION="us-east-1"
NEXT_PUBLIC_AVATARS_BUCKET_NAME="avatars"
OPENAI_API_KEY="sk-..."
```

### 4. Run database migrations

```bash
# Push the Prisma schema (core SaaS tables)
pnpm --filter @repo/database push

# Push the Drizzle schema (SmartBeak v9 tables)
pnpm --filter @repo/database drizzle:push
```

### 5. Start the development server

```bash
pnpm dev
```

The app will be available at http://localhost:3000.

---

## Environment Variables

### Required

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (with connection pooling) |
| `NEXT_PUBLIC_SITE_URL` | Public URL of the application |
| `BETTER_AUTH_SECRET` | Random secret for better-auth session signing |

### Authentication (OAuth)

| Variable | Description |
|---|---|
| `GITHUB_CLIENT_ID` | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |

### Email

| Variable | Description |
|---|---|
| `RESEND_API_KEY` | Resend API key (recommended for production) |
| `MAIL_HOST` / `MAIL_PORT` / `MAIL_USER` / `MAIL_PASS` | SMTP credentials (alternative) |

### Payments (Stripe)

| Variable | Description |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `NEXT_PUBLIC_PRICE_ID_PRO_MONTHLY` | Stripe Price ID for Pro Monthly |
| `NEXT_PUBLIC_PRICE_ID_PRO_YEARLY` | Stripe Price ID for Pro Yearly |
| `NEXT_PUBLIC_PRICE_ID_LIFETIME` | Stripe Price ID for Lifetime |

### Storage

| Variable | Description |
|---|---|
| `S3_ACCESS_KEY_ID` | S3 access key ID |
| `S3_SECRET_ACCESS_KEY` | S3 secret access key |
| `S3_ENDPOINT` | S3 endpoint URL (e.g., Supabase Storage endpoint) |
| `S3_REGION` | S3 region |
| `NEXT_PUBLIC_AVATARS_BUCKET_NAME` | Bucket for user avatars |

### AI

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key for AI content idea generation |

### Analytics (optional)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_PIRSCH_CODE` | Pirsch analytics site code |
| `NEXT_PUBLIC_PLAUSIBLE_URL` | Plausible analytics URL |
| `NEXT_PUBLIC_MIXPANEL_TOKEN` | Mixpanel project token |
| `NEXT_PUBLIC_GOOGLE_ANALYTICS_ID` | Google Analytics measurement ID |

---

## Database Setup

SmartBeak uses a **dual-adapter** database strategy:

- **Prisma** manages the core SaaS tables (users, sessions, organizations, members, invitations, purchases).
- **Drizzle ORM** manages the SmartBeak v9 tables (domains, content, media, publishing, SEO, billing, audit, portfolio, etc.).

```bash
# Prisma (core SaaS tables)
pnpm --filter @repo/database migrate

# Drizzle (SmartBeak v9)
pnpm --filter @repo/database drizzle:push
```

---

## Deploying to Vercel + Supabase

### One-click deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Cylosia/SmartBeak)

### Manual steps

1. Create a Supabase project at https://supabase.com. Copy the connection strings.
2. Create storage buckets: `avatars` and `media`.
3. Connect your GitHub repo to Vercel with these settings:
   - **Root Directory:** repository root
   - **Build Command:** `pnpm exec turbo run build --filter=web`
   - **Install Command:** `pnpm install`
4. Add all environment variables to Vercel.
5. Run migrations against Supabase:

```bash
DATABASE_URL="your-supabase-url" pnpm --filter @repo/database push
DATABASE_URL="your-supabase-url" pnpm --filter @repo/database drizzle:push
```

6. Configure Stripe webhook at `https://your-domain.vercel.app/api/payments/webhook`.

---

## Schema Governance

The file `packages/database/drizzle/schema/smartbeak.ts` is the **locked v9 schema** and must never be modified. All future schema changes must be additive-only in new migration files. This file contains 26 tables, 4 enums, and all relationships, indexes, triggers, materialized views, and RLS policies for the SmartBeak platform.

---

## RBAC and Multi-Tenancy

| Role | Permissions |
|---|---|
| **owner** | Full access, billing management, member management, delete org |
| **admin** | All content operations, domain management, member management |
| **editor** | Create/edit/publish content, upload media |
| **viewer** | Read-only access to all resources |

Enforcement happens at three layers:

1. **API layer** — `requireOrgMembership()` validates membership on every procedure.
2. **Database layer** — Row-Level Security (RLS) policies on all SmartBeak tables.
3. **UI layer** — `useActiveOrganization()` hook gates admin-only UI elements.

---

## SmartDeploy

SmartDeploy exists today as two separate surfaces in this repository:

- The main SaaS route at `/app/[org]/smart-deploy`, which provides the in-app SmartBeak experience.
- A legacy standalone deploy surface under `client/` and `server/`, which manages themed static-site generation and Vercel deployments.

The standalone legacy surface is still present in the repo and has been partially hardened during this audit, but its supporting client toolchain files are incomplete in this snapshot.

---

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start all apps in development mode |
| `pnpm build` | Build all apps and packages |
| `pnpm type-check` | TypeScript type checking across the monorepo |
| `pnpm lint` | Biome linting across the monorepo |
| `pnpm --filter @repo/database push` | Push Prisma schema to database |
| `pnpm --filter @repo/database drizzle:push` | Push Drizzle-managed SmartBeak schema changes |
| `pnpm --filter @repo/database studio` | Open Prisma Studio |

---

## License

Proprietary — SmartBeak / Cylosia. All rights reserved.

---

## Phase 2A — SEO Intelligence & AI Content Module

Phase 2A extends the SmartBeak MVP with an integrated SEO Intelligence layer. All features are built on top of the existing v9 schema — no tables were added or modified.

### New Features

| Feature | Description |
|---|---|
| **Keyword Tracking Dashboard** | Full table with volume, difficulty, SERP position, and real-time decay signals. Supports manual entry, optimistic updates, and one-click keyword removal. |
| **Keyword Clusters** | Automatic topic clustering based on shared root terms. Each cluster shows keyword count, average position, and total search volume. |
| **Decay Signal Engine** | Every keyword carries a `decayFactor` (0–1) calculated from days since last update. Keywords below 0.5 trigger amber/red alerts. A background job procedure (`runDecayJob`) recalculates all stale keywords and returns critical/warning alert lists for email delivery. |
| **AI Content Idea Generator** | One-click generation of structured content ideas using the Vercel AI SDK. Each idea includes: title, meta description, full outline, target keywords, estimated read time, SEO score (0–100), and difficulty rating. Supports niche filtering and content type selection (article, listicle, guide, case study, comparison). |
| **Real-time Content Optimizer** | Live SEO scoring panel that updates as you type (600 ms debounce). Scores title, body, keywords, readability, and meta description independently. Shows keyword density per target keyword, a full suggestions list with severity levels (info/warning/error), and an overall score ring. |
| **Google Search Console Integration** | `syncGsc` procedure fetches keyword impressions, clicks, and average positions from the GSC Search Analytics API and upserts them into `keyword_tracking`. Includes a dialog UI for token and date range configuration. |
| **Ahrefs Integration** | The `syncAhrefs` procedure exists for manual/operator-driven imports, but the primary SmartBeak UI currently exposes Google Search Console sync as the supported SEO import flow. |
| **Daily SEO Report** | `getSeoReport` returns a structured domain-level or org-level report: top 10 keywords, decaying keywords, high-volume keywords, and per-domain summaries. External scheduling is possible if you wire your own cron or job runner. |
| **Org-level SEO Report Page** | `/[org]/seo-report` — table of all domains with SEO score progress bars, keyword counts, average positions, and decay badge counts. |
| **Domain-level SEO Intelligence Page** | `/[org]/domains/[domainId]/seo-intelligence` — the full keyword dashboard with all tabs and action panels. |
| **Materialized View** | `seo_dashboard_summary` materialized view (defined in v9 schema) is queried by `getSeoDashboardSummary()` for fast dashboard loads without full table scans. |

### New Files Added

```
packages/database/drizzle/
├── queries/seo-intelligence.ts          ← enriched keyword queries + materialized view helpers
└── zod-seo-intelligence.ts              ← Zod schemas for Phase 2A inputs/outputs

packages/api/modules/smartbeak/seo-intelligence/
├── procedures/
│   ├── get-keyword-dashboard.ts         ← keyword list + clusters + summary
│   ├── update-keyword-metrics.ts        ← manual position/volume/difficulty update
│   ├── generate-ai-ideas.ts             ← Vercel AI SDK structured idea generation
│   ├── optimize-content.ts              ← real-time SEO scoring engine
│   ├── sync-gsc.ts                      ← Google Search Console adapter
│   ├── sync-ahrefs.ts                   ← Ahrefs adapter
│   ├── run-decay-job.ts                 ← background decay recalculation job
│   └── get-seo-report.ts                ← daily report procedure
└── router.ts                            ← seoIntelligenceRouter

apps/web/modules/smartbeak/seo-intelligence/
├── components/
│   ├── SeoIntelligenceDashboard.tsx     ← premium keyword dashboard (3 tabs)
│   ├── AiIdeaPanel.tsx                  ← AI idea generator slide-over panel
│   ├── ContentOptimizerPanel.tsx        ← real-time optimizer slide-over panel
│   ├── GscSyncDialog.tsx                ← GSC sync dialog
│   └── SeoReportView.tsx                ← org-level SEO report table

apps/web/app/(saas)/app/(organizations)/[organizationSlug]/
├── seo-report/page.tsx                  ← org-level SEO report page
└── domains/[domainId]/seo-intelligence/page.tsx  ← domain SEO intelligence page
```

### Environment Variables (Phase 2A additions)

```env
# Google Search Console (optional — required for GSC sync)
# No server-side env var needed; user provides OAuth2 token at sync time.

# Ahrefs (optional — required for Ahrefs sync)
AHREFS_API_KEY=your_ahrefs_api_key

# Decay job cron (Supabase Edge Function or external cron)
# POST /api/smartbeak/seo-intelligence/jobs/decay
# Secure with your CRON_SECRET header
CRON_SECRET=your_cron_secret
```

### Running the Decay Job

The decay job is exposed as an authenticated API procedure. To run it on a schedule, create a Supabase Edge Function or use an external cron service:

```bash
# Dry run (no writes)
curl -X POST https://your-domain.com/api/smartbeak/seo-intelligence/jobs/decay \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"olderThanHours": 24, "dryRun": true}'

# Production run
curl -X POST https://your-domain.com/api/smartbeak/seo-intelligence/jobs/decay \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"olderThanHours": 24, "dryRun": false}'
```

### Schema Compliance

Phase 2A uses **only existing v9 schema tables**: `keyword_tracking`, `seo_metadata`, and the `seo_dashboard_summary` materialized view. No tables were added, renamed, or modified. The locked `smartbeak.ts` schema file remains untouched.

---

## Phase 2B — Full Publishing Suite

Phase 2B adds a multi-platform publishing workflow on top of the existing SmartBeak MVP, using only the locked v9 schema tables (`publish_targets`, `publishing_jobs`, `publish_attempts`, `webhook_events`, `integrations`).

### New Features

| Feature | Description |
|---|---|
| **Supported Platform Adapters** | LinkedIn, Pinterest, Facebook, WordPress, and SoundCloud are currently exposed as configurable publishing targets with encrypted credential storage |
| **Email Series Builder (Planned)** | Email series automation is not generally available yet; the current surface is guarded until per-step content and recipient modeling is implemented safely |
| **Bulk Scheduling** | Schedule multiple content items across multiple platforms in a single form submission |
| **Publishing Calendar** | Monthly calendar view showing all scheduled jobs per day, colour-coded by platform |
| **Unified Dashboard** | Org-level view of all publishing jobs with status summary, platform breakdown, and per-job execute/retry controls |
| **Post-Publish Analytics** | Not currently available in the SmartBeak UI because adapters do not yet ingest post-performance metrics such as views, clicks, engagement, or impressions |
| **Retry + DLQ** | Automatic retry on failure; dead-letter queue UI for reviewing, retrying, and bulk-retrying failed jobs and webhook events |
| **Platform Target Manager** | Configure and toggle supported publishing targets per domain with encrypted credential storage |

### New Files

```
packages/database/drizzle/queries/publishing-suite.ts   <- DB queries
packages/database/drizzle/zod-publishing-suite.ts       <- Zod schemas
packages/api/modules/smartbeak/publishing-suite/
  adapters/index.ts                                      <- adapter registry (supported and gated targets)
  procedures/execute-job.ts                              <- Job executor
  procedures/bulk-schedule.ts                            <- Bulk scheduler
  procedures/get-calendar.ts                             <- Calendar data
  procedures/get-unified-dashboard.ts                    <- Unified dashboard
  procedures/get-analytics.ts                            <- reserved analytics endpoint (UI currently unavailable)
  procedures/email-series.ts                             <- guarded placeholder (not yet available)
  procedures/manage-targets.ts                           <- Platform target CRUD
  procedures/dlq.ts                                      <- DLQ list/retry/replay
  router.ts                                              <- Router
apps/web/modules/smartbeak/publishing-suite/components/
  UnifiedPublishingDashboard.tsx
  PublishingCalendar.tsx
  EmailSeriesBuilder.tsx
  BulkScheduleDialog.tsx
  PublishAnalyticsView.tsx
  DLQView.tsx
  PlatformTargetsManager.tsx
apps/web/app/.../publishing-suite/page.tsx               <- Org-level page
apps/web/app/.../domains/[domainId]/publishing-suite/page.tsx <- Domain-level page
```

### Additional Environment Variables

```env
# Resend (email publishing)
RESEND_API_KEY=re_...

# Platform OAuth tokens are stored encrypted in publish_targets.encrypted_config
# No additional env vars required for other platforms -- credentials configured per-domain in the UI
```

### Schema Compliance

No v9 schema tables were modified. All Phase 2B features use existing tables:
- `publish_targets` -- stores encrypted platform credentials per domain
- `publishing_jobs` -- one row per scheduled publish
- `publish_attempts` -- retry history per job
- `webhook_events` -- DLQ source for failed webhook events
- `integrations` -- GSC/Ahrefs/platform integration metadata


---

## Phase 2C — Advanced Analytics & ROI

### New Features

| Feature | Description |
|---|---|
| **Portfolio ROI Dashboard** | Risk-adjusted scoring, aggregate portfolio score, performance trends, and Recharts visualisations |
| **Diligence Engine** | Recorded ownership, legal, financial, traffic, content, technical, brand, and monetisation checks with manual review controls |
| **Sell-Readiness Estimate** | Composite 0–100 estimate with breakdown by dimension and prioritised improvement recommendations |
| **Buyer Attribution** | Recorded buyer sessions, identified buyer/email capture metrics, intent breakdown pie chart, daily trend area chart, per-session table |
| **Advanced Analytics Overview** | Portfolio health radar, monetisation decay bar chart, decay signals table with risk badges |
| **Materialized View Helpers** | `refreshPortfolioSummaries()` and `refreshBuyerAttributionView()` for fast dashboard queries |

### New Files

| Path | Description |
|---|---|
| `packages/database/drizzle/queries/analytics-roi.ts` | All Phase 2C DB query functions |
| `packages/database/drizzle/zod-analytics-roi.ts` | Zod schemas for all Phase 2C inputs/outputs |
| `packages/api/modules/smartbeak/analytics-roi/procedures/get-portfolio-roi.ts` | Portfolio ROI + timeline procedure |
| `packages/api/modules/smartbeak/analytics-roi/procedures/diligence-engine.ts` | Run diligence, get report, and update recorded review checks |
| `packages/api/modules/smartbeak/analytics-roi/procedures/sell-ready-score.ts` | Sell-readiness estimate + recommendations |
| `packages/api/modules/smartbeak/analytics-roi/procedures/buyer-attribution.ts` | Domain + org-level buyer attribution |
| `packages/api/modules/smartbeak/analytics-roi/procedures/analytics-views.ts` | Overview, monetisation decay, materialized view refresh |
| `packages/api/modules/smartbeak/analytics-roi/router.ts` | Analytics ROI router |
| `apps/web/modules/smartbeak/analytics-roi/components/PortfolioRoiDashboard.tsx` | Portfolio ROI dashboard |
| `apps/web/modules/smartbeak/analytics-roi/components/DiligenceEngineView.tsx` | Diligence engine with recorded review controls |
| `apps/web/modules/smartbeak/analytics-roi/components/SellReadyPanel.tsx` | Sell-readiness estimate panel + recommendations |
| `apps/web/modules/smartbeak/analytics-roi/components/BuyerAttributionView.tsx` | Buyer attribution charts + session table |
| `apps/web/modules/smartbeak/analytics-roi/components/AdvancedAnalyticsOverview.tsx` | Radar + decay bar + decay table |
| `apps/web/app/.../analytics/page.tsx` | Org-level analytics page (3 tabs) |
| `apps/web/app/.../domains/[domainId]/analytics/page.tsx` | Domain-level analytics page (3 tabs) |

### Schema Compliance

Only existing v9 tables used: `portfolio_summaries`, `diligence_checks`, `buyer_sessions`, `monetization_decay_signals`, `timeline_events`, `site_shards`. The locked `smartbeak.ts` was not modified.


---

## Phase 2D — Growth & Marketing Layer

### Overview
Phase 2D adds the growth and marketing infrastructure: a public marketing site, waitlist system with referral tracking, admin-managed referral reward state, onboarding emails, and launch assets.

### New Database Tables

| Table | Description |
|---|---|
| `waitlist_entries` | Email waitlist with referral codes, status, and join timestamp |
| `referrals` | Referral tracking linking referrer → referred user, plus admin-managed reward state |

> These are new Drizzle tables in `packages/database/drizzle/schema/growth.ts`. The locked v9 `smartbeak.ts` is untouched.

### New Files

**Database**
- `packages/database/drizzle/schema/growth.ts` — waitlist_entries + referrals tables
- `packages/database/drizzle/queries/growth.ts` — all CRUD and analytics queries
- `packages/database/drizzle/zod-growth.ts` — Zod validation schemas

**API (`packages/api/modules/smartbeak/growth/`)**
- `procedures/waitlist.ts` — join, getStatus, adminList, approve, getStats
- `procedures/referrals.ts` — getMyReferrals, trackReferral, grantReward, getLeaderboard
- `procedures/onboarding-emails.ts` — sendWelcomeSequence (3-step Resend drip)
- `router.ts` — growth router

**Marketing Site**
- `apps/web/modules/marketing/home/components/SmartBeakHero.tsx` — premium hero with animated stats
- `apps/web/modules/marketing/home/components/SmartBeakFeatures.tsx` — 9-feature grid
- `apps/web/modules/marketing/home/components/Testimonials.tsx` — social proof section
- `apps/web/modules/marketing/home/components/SmartBeakPricing.tsx` — 3-tier pricing cards
- `apps/web/modules/marketing/waitlist/components/WaitlistSection.tsx` — waitlist form with referral tracking

**Pages**
- `apps/web/app/(marketing)/[locale]/page.tsx` — updated homepage
- `apps/web/app/(marketing)/[locale]/waitlist/page.tsx` — dedicated waitlist page
- `apps/web/app/(marketing)/[locale]/launch/page.tsx` — launch assets (Loom script, social templates, email template, checklist)
- `apps/web/app/(saas)/app/(organizations)/[organizationSlug]/referrals/page.tsx` — referral dashboard

**Components**
- `apps/web/modules/smartbeak/growth/components/ReferralDashboard.tsx` — referral stats, link sharing, history table

### New Environment Variables

```bash
# Waitlist & Referrals (no new vars needed — uses existing Resend + DB)
NEXT_PUBLIC_SITE_URL=https://your-domain.com   # Used to generate referral links
```

### Launch Instructions

1. Deploy to Vercel and set all environment variables
2. Run `pnpm --filter @repo/database drizzle:push` to create the `waitlist_entries` and `referrals` tables
3. Visit `/launch` for the complete launch checklist, Loom script, and social templates
4. Share `/waitlist` to start collecting early access signups
5. Approve waitlist entries via the admin API (`growth.approveWaitlistEntry`)
6. The first onboarding email is sent immediately via Resend when a user activates their account; later onboarding steps require an admin/queue trigger

### Referral Program

- Each user gets a unique referral code stored in `waitlist_entries.referralCode`
- Referral links are `{APP_URL}/waitlist?ref={code}`
- When a referred user signs up, a `referrals` record is created
- Rewards are granted by an admin via `growth.grantReward`
- Leaderboard available via `growth.getReferralLeaderboard`
