# SmartBeak System Architecture

## Overview

SmartBeak is a multi-tenant content management and publishing platform built with a domain-driven design approach. The architecture follows the principles outlined in the Architectural Contract:

> - Control plane orchestrates; domains own data.
> - One database per domain.
> - Domain = unit of deletion/export.
> - Plugins are internal, capability-limited.
> - Events are versioned contracts.
> - Plugins isolated; failures do not block domains.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   Web App    │  │  Mobile App  │  │  WordPress   │  │  API Clients │    │
│  │   (Next.js)  │  │   (Future)   │  │   Plugin     │  │              │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
└─────────┼─────────────────┼─────────────────┼─────────────────┼────────────┘
          │                 │                 │                 │
          └─────────────────┴─────────────────┴─────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           GATEWAY LAYER                                      │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                         CDN / Load Balancer                           │   │
│  │                    (Vercel Edge / CloudFront)                        │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CONTROL PLANE                                        │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │   API Routes    │  │   Middleware    │  │   Auth/Guard    │              │
│  │   (Fastify)     │  │ (Rate/Caching)  │  │   (Clerk JWT)   │              │
│  └────────┬────────┘  └─────────────────┘  └─────────────────┘              │
│           │                                                                  │
│           ▼                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                      Business Services                                │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │   │
│  │  │ Billing  │ │ Domains  │ │   Auth   │ │  Queue   │ │ Analytics│   │   │
│  │  │ Service  │ │ Registry │ │ Service  │ │ Service  │ │ Service  │   │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DOMAIN LAYER                                       │
│                                                                              │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │   Content   │ │  Publishing │ │  Authors    │ │   Media     │           │
│  │   Domain    │ │   Domain    │ │   Domain    │ │   Domain    │           │
│  │             │ │             │ │             │ │             │           │
│  │ ┌─────────┐ │ │ ┌─────────┐ │ │ ┌─────────┐ │ │ ┌─────────┐ │           │
│  │ │ Entities│ │ │ │ Entities│ │ │ │ Entities│ │ │ │ Entities│ │           │
│  │ │Events   │ │ │ │Jobs     │ │ │ │Events   │ │ │ │Events   │ │           │
│  │ └─────────┘ │ │ └─────────┘ │ │ └─────────┘ │ │ └─────────┘ │           │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘           │
│                                                                              │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │     SEO     │ │   Search    │ │ Notifications│ │  Customers  │           │
│  │   Domain    │ │   Domain    │ │   Domain    │ │   Domain    │           │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      INFRASTRUCTURE LAYER                                    │
│                                                                              │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌──────────────┐ │
│  │  PostgreSQL   │  │    Redis      │  │ Object Store  │  │  External    │ │
│  │  (Per-Domain) │  │  (Job Queue)  │  │   (S3/R2)     │  │   APIs       │ │
│  │               │  │               │  │               │  │              │ │
│  │ ┌───────────┐ │  │ ┌───────────┐ │  │ ┌───────────┐ │  │ ┌──────────┐ │ │
│  │ │ Control   │ │  │ │  BullMQ   │ │  │ │  Media    │ │  │ │  Stripe  │ │ │
│  │ │   Plane   │ │  │ │  Queues   │ │  │ │  Assets   │ │  │ │  Clerk   │ │ │
│  │ └───────────┘ │  │ └───────────┘ │  │ └───────────┘ │  │ │  GSC     │ │ │
│  └───────────────┘  └───────────────┘  └───────────────┘  │ │  etc.    │ │ │
│                                                            │ └──────────┘ │ │
│                                                            └──────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Component Details

### 1. Client Layer

#### Web Application (Next.js)
- **Location:** `apps/web/`
- **Framework:** Next.js 14+ with App Router
- **Authentication:** Clerk integration
- **State Management:** React Query + Zustand
- **Key Features:**
  - Domain management UI
  - Content editor
  - Publishing dashboard
  - Analytics visualization

#### WordPress Plugin
- **Location:** `wordpress-plugin/`
- **Purpose:** Bridge between WordPress and SmartBeak
- **Features:**
  - Content synchronization
  - Publishing target configuration
  - SEO metadata sync

### 2. Gateway Layer

- **Vercel Edge Network:** Static asset delivery, edge caching
- **Rate Limiting:** Redis-based token bucket algorithm
- **DDoS Protection:** AWS Shield / Cloudflare
- **SSL/TLS:** Automatic certificate management

### 3. Control Plane

The control plane orchestrates operations across domains without owning domain data.

#### API Routes (Fastify)
- **Location:** `control-plane/api/routes/`
- **Responsibilities:**
  - Request routing and validation
  - Authentication middleware
  - Rate limiting
  - Response formatting

#### Core Services

| Service | Location | Responsibility |
|---------|----------|----------------|
| Billing Service | `control-plane/services/billing.ts` | Stripe/Paddle integration, invoicing |
| Domain Registry | `control-plane/services/domain-registry.ts` | Domain lifecycle management |
| Queue Service | `control-plane/services/region-queue.ts` | Job queue orchestration |
| Auth Service | `control-plane/services/auth.ts` | JWT validation, permissions |
| Analytics | `control-plane/services/analytics-read-model.ts` | Usage tracking, reporting |

### 4. Domain Layer

Each domain follows the same internal structure:

```
domains/[domain-name]/
├── application/          # Use cases, handlers, services
│   ├── handlers/         # Command/query handlers
│   ├── ports/            # Repository interfaces
│   └── [Domain]Service.ts
├── domain/               # Core domain logic
│   ├── entities/         # Domain entities
│   ├── events/           # Domain events
│   └── [domain].test.ts  # Domain tests
├── infra/                # Infrastructure implementations
│   └── persistence/      # Repository implementations
└── db/migrations/        # Database migrations
```

#### Content Domain
- **Purpose:** Content lifecycle management
- **Key Entities:** ContentItem, ContentRevision
- **Events:** ContentPublished, ContentScheduled, ContentArchived

#### Publishing Domain
- **Purpose:** Multi-platform publishing orchestration
- **Key Entities:** PublishingJob, PublishTarget, PublishAttempt
- **Events:** PublishingStarted, PublishingSucceeded, PublishingFailed

#### Media Domain
- **Purpose:** Asset management and CDN integration
- **Key Entities:** MediaAsset
- **Events:** MediaUploaded, MediaUploadCompleted

#### Notifications Domain
- **Purpose:** User notification delivery
- **Key Entities:** Notification, NotificationAttempt
- **Events:** NotificationSent, NotificationFailed

### 5. Infrastructure Layer

#### Database Architecture

**Control Plane Database:**
- Stores: Organizations, users, billing data, domain registry
- Single database for control plane metadata

**Domain Databases:**
- Each domain has its own PostgreSQL database
- Supports per-domain database routing for multi-tenant scenarios
- Isolation ensures domain = unit of deletion/export

#### Redis Usage

| Purpose | Key Pattern | TTL |
|---------|-------------|-----|
| Job Queues | `bull:*` | Varies |
| Rate Limiting | `rl:*` | 1 hour |
| Session Cache | `sess:*` | 24 hours |
| Circuit Breakers | `cb:*` | 1 hour |
| Publishing Status | `pub:status:*` | 5 minutes |

#### External Integrations

| Provider | Purpose | Adapter Location |
|----------|---------|------------------|
| Stripe | Payments | `apps/api/src/billing/stripe.ts` |
| Paddle | Alternative payments | `apps/api/src/billing/paddle.ts` |
| Clerk | Authentication | `apps/web/lib/clerk.ts` |
| Ahrefs | SEO data | `control-plane/adapters/keywords/ahrefs.ts` |
| Google Search Console | Search analytics | `control-plane/adapters/keywords/gsc.ts` |
| LinkedIn | Social publishing | `apps/api/src/adapters/linkedin/` |
| AWS S3/Cloudflare R2 | Media storage | `control-plane/services/storage.ts` |

## Data Flow Examples

### Content Publishing Flow

```
User Action → Web App → Control Plane API
                               │
                               ▼
                    ┌──────────────────────┐
                    │  Publishing Service  │
                    │  (Create Job)        │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │  Redis Job Queue     │
                    │  (BullMQ)            │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │  Publishing Worker   │
                    │  (Process Job)       │
                    └──────────┬───────────┘
                               │
                 ┌─────────────┼─────────────┐
                 │             │             │
                 ▼             ▼             ▼
           ┌─────────┐   ┌─────────┐   ┌─────────┐
           │ WordPress│   │ LinkedIn│   │  Email  │
           │ Adapter  │   │ Adapter │   │ Adapter │
           └─────────┘   └─────────┘   └─────────┘
```

### User Authentication Flow

```
User Login → Clerk → JWT Token
                         │
                         ▼
              ┌──────────────────┐
              │  Web App Stores  │
              │  Token in Cookie │
              └────────┬─────────┘
                       │
         ┌─────────────┼─────────────┐
         │             │             │
         ▼             ▼             ▼
   ┌──────────┐ ┌──────────┐ ┌──────────┐
   │ API Req 1│ │ API Req 2│ │ API Req 3│
   └────┬─────┘ └────┬─────┘ └────┬─────┘
        │            │            │
        └────────────┼────────────┘
                     │
                     ▼
            ┌────────────────┐
            │ Control Plane  │
            │ JWT Validation │
            └────────┬───────┘
                     │
                     ▼
            ┌────────────────┐
            │ Domain Context │
            │ Enrichment     │
            └────────────────┘
```

## Deployment Architecture

### Production Environment

```
┌─────────────────────────────────────────────────────────┐
│                      Vercel Edge                        │
│              (Global CDN + Edge Functions)              │
└─────────────────────────────────────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
           ▼               ▼               ▼
    ┌────────────┐  ┌────────────┐  ┌────────────┐
    │   Web App  │  │   API      │  │  Control   │
    │  (Next.js) │  │  (Node.js) │  │   Plane    │
    │            │  │            │  │  (Fastify) │
    └────────────┘  └────────────┘  └────────────┘
                                           │
                           ┌───────────────┼───────────────┐
                           │               │               │
                           ▼               ▼               ▼
                    ┌──────────┐   ┌──────────┐   ┌──────────┐
                    │  AWS RDS │   │ElastiCache│   │   S3     │
                    │  (PostgreSQL)│ (Redis)  │   │ (Assets) │
                    └──────────┘   └──────────┘   └──────────┘
```

## Scaling Considerations

### Horizontal Scaling

- **Stateless API servers:** Can be scaled horizontally
- **Database:** Read replicas for scaling reads
- **Redis:** Redis Cluster for scaling

### Vertical Scaling

- **Worker processes:** Increase concurrency based on queue depth
- **Database:** Vertical scaling for write-heavy workloads

## Security Architecture

See [Threat Model](../security/threat-model.md) for detailed security documentation.

### Key Security Measures

1. **Authentication:** Clerk handles user auth with MFA support
2. **Authorization:** JWT tokens with domain-level scoping
3. **Data Isolation:** Domain-specific databases
4. **Secret Management:** Encrypted at rest, rotated regularly
5. **Network:** TLS 1.3 everywhere, private subnets for databases

## Monitoring and Observability

### Metrics

| Metric | Source | Alert Threshold |
|--------|--------|-----------------|
| API Response Time | Fastify | p99 > 500ms |
| Error Rate | Application | > 1% |
| Queue Depth | Redis | > 1000 |
| Database Connections | PostgreSQL | > 80% of max |
| Memory Usage | Application | > 85% |

### Logging

- **Structured JSON logs** for all services
- **Correlation IDs** for request tracing
- **Sensitive data redaction** in logs

## References

- [Architectural Contract](../../ARCHITECTURAL_CONTRACT.md)
- [Integration Points](./integration-points.md)
- [Data Flow Documentation](./data-flow.md)
- [Threat Model](../security/threat-model.md)
