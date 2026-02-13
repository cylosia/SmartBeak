# Software Requirements Specification (SRS)

## SmartBeak — Multi-Tenant Content Management & Publishing Platform

| Field | Value |
|-------|-------|
| **Version** | 1.0 |
| **Date** | 2026-02-13 |
| **Status** | Draft |
| **Repository** | cylosia/SmartBeak |

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Overall Description](#2-overall-description)
3. [System Architecture](#3-system-architecture)
4. [Functional Requirements](#4-functional-requirements)
5. [Non-Functional Requirements](#5-non-functional-requirements)
6. [External Interfaces](#6-external-interfaces)
7. [Data Requirements](#7-data-requirements)
8. [Security Requirements](#8-security-requirements)
9. [Deployment & Infrastructure](#9-deployment--infrastructure)
10. [Testing Requirements](#10-testing-requirements)
11. [Glossary](#11-glossary)

---

## 1. Introduction

### 1.1 Purpose

This Software Requirements Specification defines the functional, non-functional, and architectural requirements for SmartBeak — a multi-tenant content management and publishing platform. It serves as the authoritative reference for the system's capabilities, constraints, and quality attributes.

### 1.2 Scope

SmartBeak enables organizations to create, manage, schedule, and publish content across multiple channels (WordPress, social media, email, podcasts) from a single unified platform. It includes domain portfolio management, SEO tooling, affiliate revenue tracking, billing, analytics, and AI-assisted content features.

### 1.3 Intended Audience

- Product owners and stakeholders
- Software engineers and architects
- QA engineers
- Operations and SRE teams
- Security reviewers

### 1.4 Definitions and Conventions

- **SHALL** — mandatory requirement
- **SHOULD** — recommended but not mandatory
- **MAY** — optional capability
- Requirements are identified as **FR-xxx** (functional) and **NFR-xxx** (non-functional)

---

## 2. Overall Description

### 2.1 Product Perspective

SmartBeak is a standalone SaaS platform deployed on the Vercel Edge Network. It operates as a monorepo (`acp`) containing:

- A **Next.js 15** web application (frontend)
- A **Fastify 5** API server (backend)
- A **control plane** that orchestrates 13 domain-driven bounded contexts
- **15 shared packages** for cross-cutting concerns
- **5 theme packages** for multi-site rendering
- A **WordPress plugin** for CMS integration

### 2.2 Product Features (High-Level)

| Feature Area | Description |
|---|---|
| Content Management | CRUD lifecycle for articles with draft, scheduled, published, and archived states |
| Multi-Channel Publishing | Orchestrated publishing to WordPress, LinkedIn, Facebook, TikTok, Instagram, Pinterest, YouTube, Vimeo, SoundCloud, podcast feeds, and email |
| Domain Portfolio | Register, verify ownership, monitor SEO health, and assess sale-readiness of web domains |
| SEO & Keyword Research | Integration with Ahrefs, Google Search Console, and SERP APIs for keyword clustering and ranking data |
| Affiliate Revenue | Track Amazon Associates, Commission Junction, and Impact Radius earnings |
| Billing & Subscriptions | Stripe and Paddle payment processing with plan management, usage tracking, and invoicing |
| Analytics & Reporting | Google Analytics integration, content ROI analysis, portfolio heatmaps, usage forecasting |
| Media Management | Upload, store, and deliver media assets via S3/Cloudflare R2 with CDN delivery and lifecycle management |
| Email Marketing | Campaign composition, subscriber management, deliverability monitoring, A/B experiments |
| AI-Powered Features | LLM-assisted content generation, AI image generation (DALL-E, Stability AI), next-actions advisor |
| Notifications | Multi-channel notification delivery with retry, dead-letter queue, and admin controls |
| Activity & Audit | Full activity timeline, admin audit logs with export capability |

### 2.3 User Classes

| Role | Permissions |
|---|---|
| **Owner** | Full organization control including billing, member management, and deletion |
| **Admin** | All operational features, member invites, domain management, integrations |
| **Editor** | Content CRUD, publishing, media management, analytics viewing |
| **Viewer** | Read-only access to content, analytics, and reports |

### 2.4 Operating Environment

| Component | Requirement |
|---|---|
| Runtime | Node.js >= 20.0.0, npm >= 10.0.0 |
| Module System | ESM (ECMAScript Modules) |
| Language | TypeScript 5.4 (strict mode) |
| Browser Support | Modern evergreen browsers (Chrome, Firefox, Safari, Edge) |

### 2.5 Constraints

- The system follows the **Architectural Contract** (see Section 3.2).
- All domain databases are isolated — one PostgreSQL database per domain.
- Plugins (adapters) are internal and capability-limited; failures must not block domain operations.
- Events crossing domain boundaries are versioned contracts.

### 2.6 Assumptions and Dependencies

- Clerk provides identity management and MFA; SmartBeak does not implement its own identity store.
- Stripe and/or Paddle handle PCI-compliant payment processing.
- Object storage (S3 or R2) is available for media assets.
- Redis is available for job queuing, caching, and rate limiting.
- PostgreSQL 15+ is available for all persistence needs.

---

## 3. System Architecture

### 3.1 Layered Architecture

The system is organized in four layers:

```
┌──────────────────────────────────────────────┐
│              CLIENT LAYER                     │
│  Next.js Web App · WordPress Plugin · API    │
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│             GATEWAY LAYER                     │
│  Vercel Edge / CDN · Rate Limiting · TLS     │
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│            CONTROL PLANE                      │
│  Fastify API Routes · Auth Middleware ·       │
│  Business Services · Job Orchestration        │
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│             DOMAIN LAYER                      │
│  13 Bounded Contexts (DDD)                    │
│  Content · Publishing · Media · SEO ·         │
│  Search · Notifications · Customers ·         │
│  Authors · Diligence · Domains ·              │
│  Planning · Activity · Shared                 │
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│          INFRASTRUCTURE LAYER                 │
│  PostgreSQL (per-domain) · Redis · S3/R2 ·    │
│  External APIs (Stripe, Clerk, Ahrefs, etc.)  │
└───────────────────────────────────────────────┘
```

### 3.2 Architectural Contract

The following invariants SHALL be maintained at all times:

1. **Control plane orchestrates; domains own data.** The control plane coordinates cross-domain workflows but never stores domain-specific business data.
2. **One database per domain.** Each bounded context has its own PostgreSQL database for data isolation.
3. **Domain = unit of deletion/export.** A domain and all its data can be fully exported or deleted independently.
4. **Plugins are internal, capability-limited.** External service adapters run within the application boundary with restricted capabilities.
5. **Events are versioned contracts.** Domain events that cross boundaries carry explicit version numbers.
6. **Plugins isolated; failures do not block domains.** Adapter failures (e.g., a LinkedIn API outage) SHALL NOT prevent core domain operations from completing.

### 3.3 Domain Structure

Each bounded context SHALL follow this internal structure:

```
domains/<name>/
├── application/       # Use cases, handlers, services
│   ├── handlers/      # Command/query handlers
│   └── ports/         # Repository interfaces
├── domain/            # Core logic, entities, events, tests
├── infra/             # Infrastructure (repository implementations)
└── db/migrations/     # Database schema migrations
```

### 3.4 Shared Packages

| Package | Purpose |
|---|---|
| `@smartbeak/kernel` | Core utilities and base abstractions |
| `@smartbeak/database` | Connection management, query builder, migrations |
| `@smartbeak/security` | Encryption, hashing, secret management |
| `@smartbeak/monitoring` | OpenTelemetry instrumentation |
| `@smartbeak/analytics` | Analytics event tracking |
| `@smartbeak/cache` | Redis caching abstractions |
| `@smartbeak/config` | Configuration loading and validation |
| `@smartbeak/errors` | Error types and formatting |
| `@smartbeak/middleware` | Shared HTTP middleware |
| `@smartbeak/types` | Shared TypeScript type definitions |
| `@smartbeak/utils` | General utilities |
| `@smartbeak/shutdown` | Graceful process shutdown |
| `@smartbeak/ml` | Machine learning utilities |

---

## 4. Functional Requirements

### 4.1 Authentication & Authorization

| ID | Requirement |
|---|---|
| FR-AUTH-001 | The system SHALL authenticate users via Clerk with support for email/password, SSO, and MFA. |
| FR-AUTH-002 | The system SHALL issue JWT tokens containing `userId`, `orgId`, `domainId`, and `roles` claims. |
| FR-AUTH-003 | The system SHALL support JWT key rotation with two concurrent signing keys for zero-downtime rotation. |
| FR-AUTH-004 | The system SHALL enforce role-based access control (RBAC) with roles: `owner`, `admin`, `editor`, `viewer`. |
| FR-AUTH-005 | The system SHALL reject invalid or expired tokens with a fail-closed policy (never bypass). |
| FR-AUTH-006 | JWT tokens SHALL have a configurable expiry (default: 24 hours) and max age (default: 7 days). |
| FR-AUTH-007 | The system SHALL tolerate clock skew up to 30 seconds when validating token timestamps. |

### 4.2 Organization Management

| ID | Requirement |
|---|---|
| FR-ORG-001 | The system SHALL support multi-tenant organizations with isolated data. |
| FR-ORG-002 | Organization owners SHALL be able to invite members via email. |
| FR-ORG-003 | The system SHALL support user onboarding flows with step tracking. |
| FR-ORG-004 | Organization settings SHALL include integration configuration for third-party services. |

### 4.3 Content Management

| ID | Requirement |
|---|---|
| FR-CNT-001 | The system SHALL support creating, reading, updating, and deleting content items. |
| FR-CNT-002 | Content items SHALL support lifecycle states: `draft`, `scheduled`, `published`, `archived`. |
| FR-CNT-003 | The system SHALL maintain a revision history for every content item. |
| FR-CNT-004 | Content scheduling SHALL allow specifying a future publish date and time. |
| FR-CNT-005 | The system SHALL provide a rich text editor (TipTap) for content composition. |
| FR-CNT-006 | The system SHALL support content filtering by status, date, author, and domain. |
| FR-CNT-007 | The system SHALL support bulk operations on content items (bulk review, bulk publish). |
| FR-CNT-008 | Content items SHALL support soft deletion (`deleted_at` timestamp). |

### 4.4 Publishing

| ID | Requirement |
|---|---|
| FR-PUB-001 | The system SHALL support publishing content to multiple targets simultaneously. |
| FR-PUB-002 | Supported publishing targets SHALL include: WordPress, LinkedIn, Facebook, TikTok, Instagram, Pinterest, YouTube, Vimeo, SoundCloud, podcast feeds, and email. |
| FR-PUB-003 | Publishing jobs SHALL be queued via BullMQ and processed asynchronously. |
| FR-PUB-004 | Publishing jobs SHALL track status: `pending`, `queued`, `active`, `completed`, `failed`, `retrying`. |
| FR-PUB-005 | Failed publishing attempts SHALL be retried with configurable backoff strategy. |
| FR-PUB-006 | The system SHALL support a publishing preview mode (dry-run) before committing. |
| FR-PUB-007 | The system SHALL support bulk publishing with dry-run confirmation. |
| FR-PUB-008 | Publishing jobs SHALL be idempotent to prevent duplicate posts on retry. |
| FR-PUB-009 | Each publishing adapter failure SHALL be isolated — one adapter's failure SHALL NOT block others. |

### 4.5 Media Management

| ID | Requirement |
|---|---|
| FR-MED-001 | The system SHALL support uploading media assets (images, video, audio, documents). |
| FR-MED-002 | Media assets SHALL be stored in object storage (S3 or Cloudflare R2). |
| FR-MED-003 | The system SHALL track upload sessions with status tracking. |
| FR-MED-004 | The system SHALL support linking media assets to content items. |
| FR-MED-005 | The system SHALL implement storage lifecycle policies for cost optimization. |
| FR-MED-006 | Media analytics SHALL track asset usage, attribution, and performance. |

### 4.6 Domain Portfolio Management

| ID | Requirement |
|---|---|
| FR-DOM-001 | The system SHALL maintain a domain registry for managing web domains. |
| FR-DOM-002 | The system SHALL support domain ownership verification. |
| FR-DOM-003 | The system SHALL assess domain sale-readiness with scoring. |
| FR-DOM-004 | The system SHALL provide domain-level analytics and SEO health monitoring. |
| FR-DOM-005 | The system SHALL support shard deployment of domain-specific sites via Vercel API. |

### 4.7 SEO & Keyword Research

| ID | Requirement |
|---|---|
| FR-SEO-001 | The system SHALL integrate with Ahrefs for keyword research data. |
| FR-SEO-002 | The system SHALL integrate with Google Search Console for search analytics. |
| FR-SEO-003 | The system SHALL support keyword clustering and tracking. |
| FR-SEO-004 | The system SHALL generate SEO reports for buyers and content ROI analysis. |
| FR-SEO-005 | The system SHALL fetch "People Also Ask" data via SERP APIs (SerpAPI, DataForSEO). |

### 4.8 Billing & Subscriptions

| ID | Requirement |
|---|---|
| FR-BIL-001 | The system SHALL integrate with Stripe as the primary payment processor. |
| FR-BIL-002 | The system SHALL integrate with Paddle as an alternative payment processor. |
| FR-BIL-003 | The system SHALL support plan-based subscriptions with usage tracking. |
| FR-BIL-004 | The system SHALL generate and manage invoices with export capability. |
| FR-BIL-005 | The system SHALL verify webhook signatures from payment providers (HMAC). |
| FR-BIL-006 | The system SHALL display billing status banners and upgrade prompts (CTA). |
| FR-BIL-007 | The system SHALL track usage against plan quotas and enforce guardrails. |

### 4.9 Analytics & Reporting

| ID | Requirement |
|---|---|
| FR-ANA-001 | The system SHALL integrate with Google Analytics (Data API v4) for traffic data. |
| FR-ANA-002 | The system SHALL provide content ROI analysis with revenue confidence scoring. |
| FR-ANA-003 | The system SHALL provide a portfolio heatmap visualization. |
| FR-ANA-004 | The system SHALL provide usage forecasting. |
| FR-ANA-005 | The system SHALL support data export in CSV format with configurable row limits. |
| FR-ANA-006 | The system SHALL provide an activity timeline for organizational events. |
| FR-ANA-007 | The system SHALL provide attribution tracking across content and channels. |

### 4.10 Affiliate Revenue Tracking

| ID | Requirement |
|---|---|
| FR-AFF-001 | The system SHALL integrate with Amazon Associates (Product Advertising API). |
| FR-AFF-002 | The system SHALL integrate with Commission Junction (CJ). |
| FR-AFF-003 | The system SHALL integrate with Impact Radius. |
| FR-AFF-004 | The system SHALL provide ROI and risk-adjusted revenue analysis. |

### 4.11 Email Marketing

| ID | Requirement |
|---|---|
| FR-EML-001 | The system SHALL support email campaign composition with a dedicated editor. |
| FR-EML-002 | The system SHALL manage email subscriber lists with audience segmentation. |
| FR-EML-003 | The system SHALL support A/B experiment building for email campaigns. |
| FR-EML-004 | The system SHALL provide email deliverability monitoring and compliance helpers. |
| FR-EML-005 | The system SHALL generate opt-in embed snippets for external use. |
| FR-EML-006 | Emails SHALL be sent via configurable providers: AWS SES, SendGrid, Postmark, or SMTP. |

### 4.12 AI-Powered Features

| ID | Requirement |
|---|---|
| FR-AI-001 | The system SHALL provide LLM-based content assistance endpoints. |
| FR-AI-002 | The system SHALL support AI image generation via OpenAI (DALL-E) and Stability AI. |
| FR-AI-003 | The system SHALL provide a "Next Actions Advisor" with AI-powered recommendations. |
| FR-AI-004 | AI features SHALL be gated behind the `ENABLE_AI` feature flag (default: disabled). |

### 4.13 Notifications

| ID | Requirement |
|---|---|
| FR-NOT-001 | The system SHALL deliver notifications to users for system events. |
| FR-NOT-002 | Notification delivery SHALL include retry logic with configurable attempts. |
| FR-NOT-003 | Failed notifications SHALL be routed to a dead-letter queue (DLQ) for investigation. |
| FR-NOT-004 | The system SHALL provide admin controls for notification management. |
| FR-NOT-005 | Notifications SHALL track delivery status: `pending`, `sent`, `failed`. |

### 4.14 Search

| ID | Requirement |
|---|---|
| FR-SRC-001 | The system SHALL provide full-text search using PostgreSQL FTS (Full-Text Search). |
| FR-SRC-002 | Search results SHALL be filterable and paginated. |

### 4.15 Admin & Audit

| ID | Requirement |
|---|---|
| FR-ADM-001 | The system SHALL provide admin audit logs for all significant operations. |
| FR-ADM-002 | Audit logs SHALL be exportable. |
| FR-ADM-003 | The system SHALL provide a system admin dashboard. |
| FR-ADM-004 | The system SHALL provide queue metrics and job queue management views. |

### 4.16 Feature Flags

| ID | Requirement |
|---|---|
| FR-FLG-001 | The system SHALL support feature flags for progressive feature rollout. |
| FR-FLG-002 | The following feature flags SHALL be supported (all default to `false`): `ENABLE_AI`, `ENABLE_SOCIAL_PUBLISHING`, `ENABLE_EMAIL_MARKETING`, `ENABLE_ANALYTICS`, `ENABLE_AFFILIATE`, `ENABLE_EXPERIMENTAL`. |
| FR-FLG-003 | Safety-related flags SHALL default to enabled: `ENABLE_CIRCUIT_BREAKER`, `ENABLE_RATE_LIMITING`. |

---

## 5. Non-Functional Requirements

### 5.1 Performance

| ID | Requirement |
|---|---|
| NFR-PERF-001 | API response time SHALL be below 500ms at p99 under normal load. |
| NFR-PERF-002 | The system SHALL support horizontal scaling of stateless API servers. |
| NFR-PERF-003 | Database read performance SHALL be scalable via read replicas. |
| NFR-PERF-004 | Worker process concurrency SHALL be configurable based on queue depth. |
| NFR-PERF-005 | Serverless functions SHALL have a maximum execution time of 30 seconds (API) or 60 seconds (webhooks, exports). |

### 5.2 Reliability & Availability

| ID | Requirement |
|---|---|
| NFR-REL-001 | **Content Creation SLO:** 99.9% successful requests over a rolling 30-day window. |
| NFR-REL-002 | **Content Publishing SLO:** 99.5% of publishing jobs SHALL succeed within 15 minutes. |
| NFR-REL-003 | **Scheduling SLO:** 99.5% of scheduled publishes SHALL execute within ±2 minutes of target time. |
| NFR-REL-004 | **Analytics SLO:** Best-effort; lag and data loss are acceptable under failure conditions. |
| NFR-REL-005 | The system SHALL implement circuit breakers for all external service integrations. |
| NFR-REL-006 | The system SHALL support graceful process shutdown, draining in-flight requests and jobs. |
| NFR-REL-007 | Publishing jobs SHALL use at-least-once delivery semantics. |

### 5.3 Scalability

| ID | Requirement |
|---|---|
| NFR-SCA-001 | The system SHALL support multi-region deployment (iad1, fra1, sin1). |
| NFR-SCA-002 | Redis SHALL be scalable via Redis Cluster for caching and queue workloads. |
| NFR-SCA-003 | The database-per-domain architecture SHALL allow independent scaling of domain databases. |

### 5.4 Observability

| ID | Requirement |
|---|---|
| NFR-OBS-001 | The system SHALL emit structured JSON logs for all services. |
| NFR-OBS-002 | The system SHALL include correlation IDs for distributed request tracing. |
| NFR-OBS-003 | The system SHALL instrument all services with OpenTelemetry for metrics, traces, and logs. |
| NFR-OBS-004 | Sensitive data SHALL be redacted from logs. |
| NFR-OBS-005 | Alerts SHALL fire when: error rate > 1%, queue depth > 1000, database connections > 80% of pool, memory > 85%. |

### 5.5 Maintainability

| ID | Requirement |
|---|---|
| NFR-MNT-001 | The codebase SHALL use TypeScript in strict mode with isolated modules. |
| NFR-MNT-002 | All packages SHALL support independent type-checking via `tsc --noEmit`. |
| NFR-MNT-003 | The project SHALL use a composite TypeScript build with project references. |
| NFR-MNT-004 | ESLint with security plugins SHALL pass with zero errors before merge. |

---

## 6. External Interfaces

### 6.1 Payment Providers

| Provider | Integration Type | Key Environment Variables |
|---|---|---|
| Stripe | REST API + Webhooks | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Paddle | REST API + Webhooks | `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET` |

### 6.2 Authentication

| Provider | Integration Type | Key Environment Variables |
|---|---|---|
| Clerk | SDK + Webhooks | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET` |

### 6.3 SEO & Search

| Provider | Integration Type | Key Environment Variables |
|---|---|---|
| Ahrefs | REST API | `AHREFS_API_TOKEN` |
| Google Search Console | OAuth2 REST API | `GSC_CLIENT_ID`, `GSC_CLIENT_SECRET` |
| SerpAPI / DataForSEO | REST API | Provider-specific keys |

### 6.4 Social Media Publishing

| Platform | Authentication | Key Environment Variables |
|---|---|---|
| LinkedIn | OAuth2 | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` |
| Facebook | Page Token | `FACEBOOK_PAGE_TOKEN` |
| Google Business Profile | OAuth2 (AES-256-GCM encrypted tokens) | `GBP_CLIENT_ID`, `GBP_CLIENT_SECRET`, `GBP_TOKEN_ENCRYPTION_KEY` |
| TikTok | OAuth2 | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` |
| Instagram | OAuth2 | Platform-specific keys |
| Pinterest | OAuth2 | Platform-specific keys |
| YouTube | OAuth2 | Platform-specific keys |
| Vimeo | OAuth2 | Platform-specific keys |
| SoundCloud | OAuth2 | Platform-specific keys |

### 6.5 Email Delivery

| Provider | Integration Type | Key Environment Variables |
|---|---|---|
| AWS SES | AWS SDK | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| SendGrid | REST API | `SENDGRID_API_KEY` |
| Postmark | REST API | `POSTMARK_SERVER_TOKEN` |
| SMTP | SMTP Protocol | Standard SMTP variables |

### 6.6 Affiliate Networks

| Provider | Integration Type | Key Environment Variables |
|---|---|---|
| Amazon Associates | Product Advertising API | `AMAZON_ACCESS_KEY`, `AMAZON_SECRET_KEY`, `AMAZON_ASSOCIATE_TAG` |
| Commission Junction | REST API | `CJ_PERSONAL_TOKEN`, `CJ_WEBSITE_ID` |
| Impact Radius | REST API | `IMPACT_ACCOUNT_SID`, `IMPACT_AUTH_TOKEN` |

### 6.7 AI & Image Generation

| Provider | Integration Type | Key Environment Variables |
|---|---|---|
| OpenAI (DALL-E) | REST API | `OPENAI_API_KEY` |
| Stability AI | REST API | `STABILITY_API_KEY` |

### 6.8 Analytics

| Provider | Integration Type | Key Environment Variables |
|---|---|---|
| Google Analytics | Data API v4 (Service Account) | Service account credentials |

### 6.9 Content Management

| Provider | Integration Type | Key Environment Variables |
|---|---|---|
| WordPress | REST API + Plugin | Per-target configuration |
| Vercel | Deployment API | `VERCEL_TOKEN`, `VERCEL_TEAM_ID` |

### 6.10 Infrastructure

| Provider | Integration Type | Key Environment Variables |
|---|---|---|
| Cloudflare R2 | S3-compatible API | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` |
| AWS S3 | AWS SDK | Standard AWS credentials |
| Slack | Webhooks | `SLACK_WEBHOOK_URL` |

---

## 7. Data Requirements

### 7.1 Database Architecture

The system uses a **multi-database strategy** with PostgreSQL 15+:

| Database | Purpose | Key Tables |
|---|---|---|
| Control Plane | Orchestration metadata, multi-tenancy | `organizations`, `users`, `memberships`, `invites`, `plans`, `subscriptions`, `domain_registry`, `usage`, `guardrails`, `job_queues` |
| Content Domain | Content lifecycle | `content_items`, `content_revisions` |
| Publishing Domain | Multi-platform publishing | `publish_targets`, `publishing_jobs`, `publish_attempts` |
| Media Domain | Asset management | `media_assets`, `upload_sessions`, `content_media_links` |
| SEO Domain | Keyword and ranking data | `keywords`, `seo_metrics`, `clusters` |
| Search Domain | Full-text search indexes | PostgreSQL FTS indexes |
| Notifications Domain | Notification delivery | `notifications`, `notification_attempts`, DLQ tables |
| Customers Domain | Customer data | Customer tables |
| Authors Domain | Author profiles | Author profile tables |
| Activity Domain | Activity logs | Activity log tables |

### 7.2 Schema Conventions

All domain tables SHALL follow these conventions:

- **Audit columns:** `created_at TIMESTAMP DEFAULT NOW()`, `updated_at TIMESTAMP DEFAULT NOW()`
- **Soft deletion:** `deleted_at TIMESTAMP` (nullable; non-null indicates deleted)
- **Multi-tenancy:** `org_id` and/or `domain_id` foreign keys on every record
- **UUID primary keys** for all entities

### 7.3 Index Strategy

| Index Type | Use Case |
|---|---|
| B-tree | Foreign keys, unique constraints |
| Partial | Status + deleted_at (filter soft-deleted rows) |
| GIN | JSONB columns, full-text search |
| BRIN | Time-series data (created_at on large tables) |
| Composite | `(domain_id, status)` for common query patterns |

### 7.4 Redis Data Model

| Key Pattern | Purpose | TTL |
|---|---|---|
| `bull:*` | BullMQ job queues | Varies by job type |
| `rl:*` | Rate limiting counters | 1 hour |
| `sess:*` | Session cache | 24 hours |
| `cb:*` | Circuit breaker state | 1 hour |
| `pub:status:*` | Publishing job status cache | 5 minutes |

### 7.5 Data Retention & Export

- Each domain SHALL be independently exportable per the architectural contract.
- Each domain SHALL be independently deletable (domain = unit of deletion).
- Audit logs SHALL be retained and exportable in CSV format.
- Export operations SHALL respect configurable row and file-size limits.

---

## 8. Security Requirements

### 8.1 Authentication & Session Security

| ID | Requirement |
|---|---|
| NFR-SEC-001 | All authentication SHALL be handled by Clerk with MFA support. |
| NFR-SEC-002 | JWT signing keys SHALL be 32 bytes and support rotation (two concurrent keys). |
| NFR-SEC-003 | JWT tokens SHALL be transported in `Authorization: Bearer` headers (not cookies for API calls). |
| NFR-SEC-004 | Authentication SHALL be fail-closed: invalid tokens are rejected, never bypassed. |

### 8.2 Transport Security

| ID | Requirement |
|---|---|
| NFR-SEC-005 | All production traffic SHALL use TLS 1.3. |
| NFR-SEC-006 | HSTS headers SHALL be enabled with a minimum max-age of 1 year. |
| NFR-SEC-007 | The following security headers SHALL be set: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, CSP with nonces. |

### 8.3 Data Protection

| ID | Requirement |
|---|---|
| NFR-SEC-008 | Secrets (API keys, OAuth tokens) SHALL be encrypted at rest using AES-256-GCM. |
| NFR-SEC-009 | Secrets SHALL NOT be stored in domain databases (control plane only). |
| NFR-SEC-010 | All database queries SHALL use parameterized statements to prevent SQL injection. |
| NFR-SEC-011 | Sensitive data SHALL be redacted in log output. |
| NFR-SEC-012 | Encryption keys SHALL be at least 32 bytes: `KEY_ENCRYPTION_SECRET`, `GBP_TOKEN_ENCRYPTION_KEY`. |

### 8.4 Rate Limiting & Abuse Prevention

| ID | Requirement |
|---|---|
| NFR-SEC-013 | The system SHALL enforce Redis-backed rate limiting with a fail-closed policy. |
| NFR-SEC-014 | Auth endpoints SHALL have stricter rate limits (default: 5 attempts per 15 minutes). |
| NFR-SEC-015 | Abuse guards SHALL enforce request and content-size limits. |

### 8.5 Webhook Security

| ID | Requirement |
|---|---|
| NFR-SEC-016 | All incoming webhooks SHALL verify signatures (Stripe HMAC, Clerk signatures, Paddle signatures). |
| NFR-SEC-017 | Webhook endpoints SHALL reject requests with invalid or missing signatures. |

### 8.6 Threat Mitigations

Based on the threat model:

| Threat | Mitigation |
|---|---|
| SSRF via publishing adapters | Strict adapter input validation; no outbound calls without allowlist |
| Privilege escalation (org/domain mismatch) | Domain ownership enforced at control-plane level |
| Secret leakage | Secrets never in domain DBs; TruffleHog scanning in CI |
| Replay/abuse of publishing retries | Idempotent publishing jobs |
| Cross-org data access | Per-domain database isolation; `org_id` scoping on all queries |

### 8.7 CI/CD Security Gates

| Gate | Tool | Threshold |
|---|---|---|
| Dependency audit | `npm audit` / `audit-ci` | No high or critical vulnerabilities |
| Secret scanning | TruffleHog | Zero verified secrets in commits |
| Security linting | ESLint security plugin | Zero errors |
| Type safety | `tsc --noEmit` | Zero type errors |

---

## 9. Deployment & Infrastructure

### 9.1 Deployment Platform

| Component | Platform | Configuration |
|---|---|---|
| Web Application | Vercel (Next.js) | Multi-region: `iad1`, `fra1`, `sin1` |
| API / Control Plane | Vercel Serverless Functions | Max duration: 30s (API), 60s (webhooks/exports) |
| Workers | Background processes | BullMQ job processing |
| Database | PostgreSQL 15+ (AWS RDS or equivalent) | Per-domain isolation |
| Cache / Queues | Redis 7 (ElastiCache or equivalent) | Cluster-mode capable |
| Object Storage | Cloudflare R2 or AWS S3 | CDN delivery |

### 9.2 CI/CD Pipeline

The CI pipeline (`.github/workflows/ci-guards.yml`) SHALL execute on every push to `main`/`develop` and on all pull requests to `main`:

1. **Type-check** — TypeScript compilation with zero errors
2. **Security audit** — Dependency vulnerability scan
3. **Secret scan** — TruffleHog commit scanning
4. **Lint** — ESLint including security rules
5. **Test** — Unit and integration tests against PostgreSQL 15 and Redis 7

### 9.3 Environment Configuration

The system SHALL be configurable via environment variables (787+ variables defined in `.env.example`) organized into:

- Core (database, auth, Node environment)
- Payment providers
- SEO APIs
- Email configuration
- Social media credentials
- Affiliate network keys
- AI service keys
- Infrastructure endpoints
- Feature flags
- Operational thresholds (queue concurrency, rate limits, circuit breaker settings, cache TTLs, pagination limits, retry strategies)

---

## 10. Testing Requirements

### 10.1 Testing Framework

| Framework | Purpose |
|---|---|
| Jest 29.7 | Unit and integration tests |
| Vitest 4.0 | Additional test suites |
| ts-jest | TypeScript test transformation |

### 10.2 Test Categories

| Category | Scope | Location |
|---|---|---|
| Domain unit tests | Entity logic, lifecycle, events | `domains/*/domain/*.test.ts` |
| Service tests | Business logic services | `control-plane/services/*.test.ts` |
| API route tests | Request/response validation | `apps/api/src/routes/__tests__/` |
| Security tests | SQL injection, auth bypass, export security | `test/security/`, `*security.test.ts` |
| Integration tests | Cross-service flows with real DB/Redis | `test/integration/` |
| Performance tests | Response time, throughput | `test/performance/` |
| Type safety tests | TypeScript type correctness | `test/types/` |

### 10.3 Coverage Requirements

| Scope | Minimum Coverage |
|---|---|
| Global branches | 70% |
| Global functions | 70% |
| Global lines | 80% |
| Billing code (critical path) | 90% |
| Job processing code | 80–85% |

### 10.4 Test Execution

| Command | Purpose |
|---|---|
| `npm run test:unit` | Run unit tests |
| `npm run test:integration` | Run integration tests (sequential) |
| `npm run type-check` | TypeScript compilation check |
| `npm run lint` | ESLint validation |
| `npm run lint:security` | Security-focused linting |

---

## 11. Glossary

| Term | Definition |
|---|---|
| **Bounded Context** | A domain-driven design pattern where each domain has clear boundaries and its own data model |
| **Control Plane** | The central orchestration layer that coordinates operations across domains |
| **Domain** | A bounded context representing a distinct area of business logic (e.g., Content, Publishing, Media) |
| **DLQ** | Dead-Letter Queue — stores messages/jobs that failed processing for later investigation |
| **Feature Flag** | A configuration toggle that enables or disables specific system capabilities at runtime |
| **RBAC** | Role-Based Access Control — authorization model where permissions are assigned to roles |
| **SLO** | Service Level Objective — a target reliability metric for a service |
| **Shard Deployment** | Deploying domain-specific site instances via the Vercel API |
| **Publishing Adapter** | An integration module that publishes content to a specific external platform |
| **Circuit Breaker** | A resilience pattern that stops calling a failing service after repeated failures |

---

*Generated from codebase analysis on 2026-02-13.*
