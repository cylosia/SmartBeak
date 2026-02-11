# SmartBeak Data Flow Documentation

## Overview

This document describes the data flows within the SmartBeak platform, covering how data moves between components, domains, and external systems.

## Core Data Flows

### 1. Content Lifecycle Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Draft     │────▶│  Review     │────▶│  Scheduled  │────▶│  Published  │
│  (Create)   │     │  (Update)   │     │  (Queue)    │     │  (Publish)  │
└─────────────┘     └─────────────┘     └─────────────┘     └──────┬──────┘
                                                                    │
                                                                    ▼
                                                           ┌─────────────┐
                                                           │  Archived   │
                                                           │  (Cleanup)  │
                                                           └─────────────┘
```

#### Detailed Flow

1. **Content Creation**
   ```
   User → Web App → POST /api/content
                           │
                           ▼
                    ┌──────────────┐
                    │ Control Plane│
                    │ - Validation │
                    │ - Auth Check │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ Content      │
                    │ Domain DB    │
                    │ - content_items
                    │ - content_revisions
                    └──────────────┘
   ```

2. **Content Update**
   ```
   User → Web App → POST /api/content/update
                           │
                           ▼
                    ┌──────────────┐
                    │ Control Plane│
                    │ - Version Check
                    │ - Lock Check │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ Content      │
                    │ Domain       │
                    │ - Create Revision
                    │ - Update Item
                    └──────────────┘
   ```

3. **Publishing Flow**
   ```
   User → Web App → POST /api/publishing/jobs
                           │
                           ▼
                    ┌──────────────┐
                    │ Publishing   │
                    │ Service      │
                    │ - Validate   │
                    │ - Create Job │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ Redis Queue  │
                    │ (BullMQ)     │
                    │ publishing:wait
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ Publishing   │
                    │ Worker       │
                    │ - Process Job│
                    │ - Call Adapters
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │WordPress │ │ LinkedIn │ │  Email   │
        │  API     │ │  API     │ │  API     │
        └──────────┘ └──────────┘ └──────────┘
   ```

### 2. User Authentication Flow

```
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│  User   │───▶│  Clerk  │───▶│   JWT   │───▶│  Web    │───▶│  Store  │
│ Login   │    │   UI    │    │  Token  │    │   App   │    │ Cookie  │
└─────────┘    └─────────┘    └─────────┘    └─────────┘    └────┬────┘
                                                                  │
                              ┌────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  API Request    │
                    │  Authorization  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │  Verify  │  │ Extract  │  │  Check   │
        │   JWT    │  │ Org/Domain│  │   Perms  │
        └──────────┘  └──────────┘  └──────────┘
```

**Detailed Steps:**

1. User initiates login via Clerk component
2. Clerk authenticates user (password, SSO, MFA)
3. Clerk issues JWT token with claims:
   ```json
   {
     "sub": "user_xxx",
     "org_id": "org_xxx",
     "domain_id": "domain_xxx",
     "permissions": ["content:read", "content:write"]
   }
   ```
4. Web app stores token in secure, httpOnly cookie
5. Subsequent API requests include token in Authorization header
6. Control plane validates JWT and extracts context

### 3. Media Upload Flow

```
User → Select File → Web App
                         │
                         ▼
              ┌──────────────────┐
              │ Request Upload   │
              │ Intent           │
              └────────┬─────────┘
                       │
                       ▼
              ┌──────────────────┐
              │ Control Plane    │
              │ - Validate       │
              │ - Generate URL   │
              │ - Create Record  │
              └────────┬─────────┘
                       │
                       ▼
              ┌──────────────────┐
              │ Pre-signed URL   │
              │ (S3/R2)          │
              └────────┬─────────┘
                       │
                       ▼
              ┌──────────────────┐
              │ Direct Upload    │
              │ (Browser → S3)   │
              └────────┬─────────┘
                       │
                       ▼
              ┌──────────────────┐
              │ Webhook:         │
              │ Upload Complete  │
              └────────┬─────────┘
                       │
                       ▼
              ┌──────────────────┐
              │ Media Domain     │
              │ - Update Status  │
              │ - Generate CDN   │
              │   URLs           │
              └──────────────────┘
```

### 4. Publishing Job Flow

```
┌──────────────┐
│  Job Created │
│  (pending)   │
└──────┬───────┘
       │
       ▼
┌──────────────┐     ┌──────────────┐
│   Queued     │────▶│   Picked Up  │
│  (bull:wait) │     │  by Worker   │
└──────────────┘     └──────┬───────┘
                            │
                            ▼
                     ┌──────────────┐
                     │   Active     │
                     │  (processing)│
                     └──────┬───────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
              ▼             ▼             ▼
       ┌──────────┐  ┌──────────┐  ┌──────────┐
       │ Success  │  │  Failed  │  │  Retry   │
       │          │  │          │  │  (delay) │
       └────┬─────┘  └────┬─────┘  └────┬─────┘
            │             │             │
            ▼             ▼             │
     ┌──────────┐   ┌──────────┐       │
     │Completed │   │   DLQ    │◀──────┘
     │  (done)  │   │(max retry│
     └──────────┘   │ reached) │
                    └──────────┘
```

**State Transitions:**

| From State | To State | Trigger |
|------------|----------|---------|
| `pending` | `queued` | Job validated and added to queue |
| `queued` | `active` | Worker picks up job |
| `active` | `completed` | All targets successfully published |
| `active` | `failed` | Unrecoverable error |
| `active` | `retrying` | Transient error, retry scheduled |
| `retrying` | `active` | Retry attempt started |
| `retrying` | `failed` | Max retries exceeded |

### 5. Notification Delivery Flow

```
Trigger Event → Notification Service
                      │
                      ▼
               ┌──────────────┐
               │ Create       │
               │ Notification │
               └──────┬───────┘
                      │
                      ▼
               ┌──────────────┐
               │ Determine    │
               │ Channels     │
               └──────┬───────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
        ▼             ▼             ▼
   ┌─────────┐  ┌─────────┐  ┌─────────┐
   │  Email  │  │   SMS   │  │  Push   │
   │ Adapter │  │ Adapter │  │ Adapter │
   └────┬────┘  └────┬────┘  └────┬────┘
        │            │            │
        ▼            ▼            ▼
   ┌─────────┐  ┌─────────┐  ┌─────────┐
   │  SES    │  │Twilio   │  │Firebase │
   │SendGrid │  │etc.     │  │FCM      │
   └─────────┘  └─────────┘  └─────────┘
```

### 6. Analytics and Reporting Flow

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Events     │───▶│   Usage      │───▶│   Aggregate  │
│  (Domain DB) │    │  Batcher     │    │  (Hourly)    │
└──────────────┘    └──────────────┘    └──────┬───────┘
                                               │
                                               ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Reports    │◀───│   Read Model │◀───│   Analytics  │
│   Generated  │    │  (Query API) │    │   Storage    │
└──────────────┘    └──────────────┘    └──────────────┘
```

**Event Sources:**
- Content creation/update
- Publishing attempts
- User actions
- Billing events

**Aggregation Pipeline:**
1. Events written to domain database
2. Usage batcher processes events hourly
3. Aggregated data stored in analytics tables
4. Read model serves query requests

### 7. SEO Data Ingestion Flow

```
Scheduled Job → Keyword Service
                      │
                      ▼
               ┌──────────────┐
               │ Ahrefs/GSC   │
               │ API Request  │
               └──────┬───────┘
                      │
                      ▼
               ┌──────────────┐
               │ Normalize    │
               │ & Validate   │
               └──────┬───────┘
                      │
                      ▼
               ┌──────────────┐
               │ SEO Domain   │
               │ Store        │
               └──────┬───────┘
                      │
                      ▼
               ┌──────────────┐
               │ Trigger      │
               │ Analysis     │
               └──────────────┘
```

## Data Storage Patterns

### Domain Data Isolation

```
┌─────────────────────────────────────────────────────────────┐
│                     Control Plane DB                         │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │   orgs     │  │  domains   │  │   users    │            │
│  │  (metadata)│  │  (registry)│  │  (auth)    │            │
│  └────────────┘  └────────────┘  └────────────┘            │
└─────────────────────────────────────────────────────────────┘

┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  Domain DB: A    │  │  Domain DB: B    │  │  Domain DB: C    │
│  ┌────────────┐  │  │  ┌────────────┐  │  │  ┌────────────┐  │
│  │ content_   │  │  │  │ content_   │  │  │  │ content_   │  │
│  │ items      │  │  │  │ items      │  │  │  │ items      │  │
│  ├────────────┤  │  │  ├────────────┤  │  │  ├────────────┤  │
│  │ publishing │  │  │  │ publishing │  │  │  │ publishing │  │
│  │ _jobs      │  │  │  │ _jobs      │  │  │  │ _jobs      │  │
│  ├────────────┤  │  │  ├────────────┤  │  │  ├────────────┤  │
│  │ media_     │  │  │  │ media_     │  │  │  │ media_     │  │
│  │ assets     │  │  │  │ assets     │  │  │  │ assets     │  │
│  └────────────┘  │  │  └────────────┘  │  │  └────────────┘  │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

### Event Sourcing Pattern

```
┌─────────────────────────────────────────────┐
│            Event Store (PostgreSQL)          │
├─────────────────────────────────────────────┤
│  event_id    │ UUID, PK                     │
│  aggregate_id│ UUID (content_id, job_id)   │
│  type        │ VARCHAR (event type)         │
│  version     │ INT (sequence number)        │
│  payload     │ JSONB (event data)           │
│  occurred_at │ TIMESTAMPTZ                  │
└─────────────────────────────────────────────┘
```

### CQRS Pattern

```
        ┌──────────────┐
        │   Command    │
        │  (Write)     │
        └──────┬───────┘
               │
               ▼
        ┌──────────────┐
        │   Domain     │
        │   Model      │
        └──────┬───────┘
               │
        ┌──────┴──────┐
        │             │
        ▼             ▼
 ┌──────────┐  ┌──────────┐
 │  Event   │  │  Read    │
 │  Store   │  │  Model   │
 └────┬─────┘  └──────────┘
      │             ▲
      │             │
      ▼             │
 ┌──────────┐       │
 │ Projector│───────┘
 │ (Update  │  Query
 │  Read    │  (Read)
 │  Model)  │
 └──────────┘
```

## Data Retention and Archival

### Content Lifecycle

| State | Retention | Action |
|-------|-----------|--------|
| Published | Indefinite | - |
| Draft | 90 days | Auto-archive if no activity |
| Archived | 1 year | Move to cold storage |
| Deleted | 30 days | Soft delete, then purge |

### Analytics Data

| Granularity | Retention |
|-------------|-----------|
| Raw events | 30 days |
| Hourly aggregates | 90 days |
| Daily aggregates | 1 year |
| Monthly aggregates | Indefinite |

### Audit Logs

| Type | Retention |
|------|-----------|
| Authentication logs | 1 year |
| Admin actions | 2 years |
| Data access logs | 90 days |
| Security events | 3 years |

## Error Handling and Dead Letter Queues

### DLQ Structure

```
┌─────────────────────────────────────────────┐
│          Dead Letter Queue (DLQ)             │
├─────────────────────────────────────────────┤
│  job_id          │ UUID                      │
│  original_queue  │ VARCHAR                   │
│  error_type      │ VARCHAR                   │
│  error_message   │ TEXT                      │
│  failed_at       │ TIMESTAMPTZ               │
│  retry_count     │ INT                       │
│  payload         │ JSONB                     │
└─────────────────────────────────────────────┘
```

### Error Categories

| Category | Action | Retry |
|----------|--------|-------|
| Transient | Auto-retry with backoff | Yes |
| Adapter Error | Mark target failed, continue | Partial |
| Validation Error | Move to DLQ, alert | No |
| System Error | Move to DLQ, page on-call | Manual |

## Performance Considerations

### Read Optimization

1. **Read Replicas:** Analytics queries use read replicas
2. **Caching:** Redis for frequently accessed data
3. **Materialized Views:** Pre-computed aggregates
4. **Pagination:** All list endpoints use cursor pagination

### Write Optimization

1. **Batch Writes:** Usage events batched before write
2. **Async Processing:** Non-critical writes use queues
3. **Connection Pooling:** Database connections pooled
4. **Write-Behind:** Cache writes deferred where possible

## Related Documentation

- [System Architecture](./system-architecture.md)
- [Integration Points](./integration-points.md)
- [Database Schema](../operations/storage-lifecycle.md)
