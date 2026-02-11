# SmartBeak Integration Points Documentation

## Overview

This document describes all external and internal integration points in the SmartBeak platform, including APIs, webhooks, adapters, and data exchanges.

## External Integrations

### 1. Authentication & Identity

#### Clerk

**Purpose:** User authentication and identity management

**Integration Type:** SDK + Webhooks

**Configuration:**
```typescript
// apps/web/lib/clerk.ts
import { ClerkProvider } from '@clerk/nextjs';

const clerkConfig = {
  publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  secretKey: process.env.CLERK_SECRET_KEY,
  webhookSecret: process.env.CLERK_WEBHOOK_SECRET,
};
```

**Webhook Events:**
| Event | Handler | Action |
|-------|---------|--------|
| `user.created` | `webhooks/clerk.ts` | Create user in control plane |
| `user.updated` | `webhooks/clerk.ts` | Sync user changes |
| `user.deleted` | `webhooks/clerk.ts` | Soft delete user data |
| `organization.created` | `webhooks/clerk.ts` | Create org in control plane |
| `organizationMembership.created` | `webhooks/clerk.ts` | Add user to org |

**Data Flow:**
```
Clerk ──webhook──▶ SmartBeak API ──▶ Control Plane DB
  │                                     │
  │                                     ▼
  │                              ┌────────────┐
  └──────user login────────────▶ │  Session   │
                                 │  Created   │
                                 └────────────┘
```

---

### 2. Payment Processing

#### Stripe

**Purpose:** Primary payment processor for subscriptions

**Integration Type:** REST API + Webhooks

**Configuration:**
```typescript
// apps/web/lib/stripe.ts
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-01-01',
});
```

**API Endpoints:**
| Endpoint | Purpose | File |
|----------|---------|------|
| `POST /api/stripe/create-checkout-session` | Create checkout | `apps/web/pages/api/stripe/create-checkout-session.ts` |
| `POST /api/stripe/portal` | Customer portal | `apps/web/pages/api/stripe/portal.ts` |
| `POST /api/webhooks/stripe` | Webhook handler | `apps/web/pages/api/webhooks/stripe.ts` |

**Webhook Events:**
| Event | Handler | Action |
|-------|---------|--------|
| `invoice.payment_succeeded` | `stripeWebhook.ts` | Activate subscription |
| `invoice.payment_failed` | `stripeWebhook.ts` | Notify user, grace period |
| `customer.subscription.deleted` | `stripeWebhook.ts` | Deactivate subscription |
| `charge.dispute.created` | `stripeWebhook.ts` | Alert finance team |

#### Paddle

**Purpose:** Alternative payment processor (backup/fallback)

**Configuration:**
```typescript
// apps/api/src/billing/paddle.ts
const paddle = new Paddle(process.env.PADDLE_API_KEY);
```

**Webhook Events:**
| Event | Action |
|-------|--------|
| `subscription.created` | Create subscription record |
| `subscription.paid` | Activate/update subscription |
| `subscription.payment_failed` | Handle failed payment |

---

### 3. Content Publishing Adapters

#### WordPress

**Purpose:** Publish content to WordPress sites

**Integration Type:** REST API (WordPress REST API)

**Configuration:**
```typescript
// apps/api/src/adapters/wordpress/WordPressAdapter.ts
interface WordPressConfig {
  siteUrl: string;
  username: string;
  applicationPassword: string;
}
```

**API Methods:**
| Method | WordPress Endpoint | Purpose |
|--------|-------------------|---------|
| `createPost` | `POST /wp-json/wp/v2/posts` | Create new post |
| `updatePost` | `PUT /wp-json/wp/v2/posts/{id}` | Update existing post |
| `uploadMedia` | `POST /wp-json/wp/v2/media` | Upload featured image |
| `getCategories` | `GET /wp-json/wp/v2/categories` | List categories |

**Authentication:** Application Passwords (WordPress 5.6+)

#### LinkedIn

**Purpose:** Publish posts to LinkedIn profiles and company pages

**Integration Type:** LinkedIn UGC API v2

**Configuration:**
```typescript
// apps/api/src/adapters/linkedin/LinkedInAdapter.ts
interface LinkedInConfig {
  accessToken: string;
  organizationId?: string; // For company posts
}
```

**API Methods:**
| Method | LinkedIn Endpoint | Purpose |
|--------|------------------|---------|
| `createPost` | `POST /v2/ugcPosts` | Create personal post |
| `createCompanyPost` | `POST /v2/ugcPosts` | Create company post |
| `uploadImage` | `POST /v2/assets` | Upload media |
| `getAnalytics` | `GET /v2/socialActions` | Get post stats |

**Authentication:** OAuth 2.0

#### Google Business Profile

**Purpose:** Publish posts to Google Business listings

**Integration Type:** Google My Business API v4.9

**Configuration:**
```typescript
// apps/api/src/adapters/gbp/GbpAdapter.ts
interface GbpConfig {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}
```

**API Methods:**
| Method | GBP Endpoint | Purpose |
|--------|--------------|---------|
| `listLocations` | `GET /v4/{parent}/locations` | List business locations |
| `createPost` | `POST /v4/{name}/localPosts` | Create post |
| `createEvent` | `POST /v4/{name}/localPosts` | Create event |
| `getInsights` | `GET /v4/{name}/insights` | Get analytics |

#### TikTok

**Purpose:** Publish videos to TikTok

**Integration Type:** TikTok API for Business

**Configuration:**
```typescript
// apps/api/src/adapters/tiktok/TikTokAdapter.ts
interface TikTokConfig {
  accessToken: string;
  openId: string;
}
```

**API Methods:**
| Method | TikTok Endpoint | Purpose |
|--------|-----------------|---------|
| `publishVideo` | `POST /video/upload/` | Upload and publish video |
| `publishVideoDirect` | `POST /video/direct/post/` | Publish from URL |
| `getPublishStatus` | `GET /video/status/` | Check publish status |
| `getVideoMetrics` | `GET /video/data/` | Get video analytics |

---

### 4. Email Providers

#### AWS SES

**Purpose:** Transactional email delivery

**Integration Type:** AWS SDK

**Configuration:**
```typescript
// plugins/notification-adapters/email-adapter.ts
const sesConfig = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
};
```

**Features:**
- Template-based emails
- HTML and text versions
- Attachment support
- Delivery tracking

#### SMTP Fallback

**Providers Supported:** Gmail, SendGrid, Postmark, generic SMTP

**Configuration:**
```typescript
const smtpConfig = {
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
};
```

---

### 5. SEO & Analytics

#### Ahrefs

**Purpose:** Keyword research and backlink data

**Integration Type:** Ahrefs API v3

**Configuration:**
```typescript
// control-plane/adapters/keywords/ahrefs.ts
const ahrefsConfig = {
  token: process.env.AHREFS_API_TOKEN,
};
```

**API Methods:**
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `getOrganicKeywords` | `/v3/site-explorer/organic-keywords` | Get ranking keywords |
| `getBacklinks` | `/v3/site-explorer/backlinks` | Get backlink data |
| `getDomainRating` | `/v3/site-explorer/domain-rating` | Get DR score |

#### Google Search Console

**Purpose:** Search performance data

**Integration Type:** Google APIs Node.js Client

**Configuration:**
```typescript
// control-plane/adapters/keywords/gsc.ts
const gscConfig = {
  clientId: process.env.GSC_CLIENT_ID,
  clientSecret: process.env.GSC_CLIENT_SECRET,
  redirectUri: process.env.GSC_REDIRECT_URI,
};
```

**API Methods:**
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `getSearchAnalytics` | `sites/{siteUrl}/searchAnalytics/query` | Get search data |
| `getSitemaps` | `sites/{siteUrl}/sitemaps` | List sitemaps |
| `submitSitemap` | `sites/{siteUrl}/sitemaps` | Submit sitemap |

#### Google Analytics

**Purpose:** Traffic and user behavior analytics

**Integration Type:** Google Analytics Data API v1

**Configuration:**
```typescript
// apps/api/src/adapters/ga/GaAdapter.ts
const gaConfig = {
  propertyId: process.env.GA_PROPERTY_ID,
  credentials: serviceAccountCredentials,
};
```

---

### 6. Storage

#### AWS S3 / Cloudflare R2

**Purpose:** Media asset storage

**Integration Type:** AWS SDK (S3-compatible)

**Configuration:**
```typescript
// control-plane/services/storage.ts
const storageConfig = {
  endpoint: process.env.S3_ENDPOINT, // or R2_ENDPOINT
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  bucket: process.env.S3_BUCKET,
  region: process.env.S3_REGION,
};
```

**Operations:**
| Operation | Purpose |
|-----------|---------|
| `generateUploadUrl` | Create pre-signed URL for direct upload |
| `generateDownloadUrl` | Create pre-signed URL for download |
| `deleteObject` | Delete media file |
| `copyObject` | Copy between buckets (backup) |

---

### 7. Social Media (Additional)

#### Facebook/Instagram

**Purpose:** Publish to Facebook pages and Instagram accounts

**Integration Type:** Facebook Graph API

**Configuration:**
```typescript
// apps/api/src/adapters/facebook/FacebookAdapter.ts
const fbConfig = {
  pageAccessToken: process.env.FACEBOOK_PAGE_TOKEN,
  pageId: process.env.FACEBOOK_PAGE_ID,
};
```

#### Pinterest

**Purpose:** Create pins

**Integration Type:** Pinterest API v5

**Configuration:**
```typescript
// apps/api/src/adapters/pinterest/PinterestAdapter.ts
const pinterestConfig = {
  accessToken: process.env.PINTEREST_ACCESS_TOKEN,
};
```

#### YouTube

**Purpose:** Video uploads

**Integration Type:** YouTube Data API v3

**Configuration:**
```typescript
// apps/api/src/adapters/youtube/YouTubeAdapter.ts
const youtubeConfig = {
  refreshToken: process.env.YOUTUBE_REFRESH_TOKEN,
  clientId: process.env.YOUTUBE_CLIENT_ID,
  clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
};
```

---

### 8. Video Platforms

#### Vimeo

**Purpose:** Video hosting and publishing

**Integration Type:** Vimeo API

**Configuration:**
```typescript
// apps/api/src/adapters/vimeo/VimeoAdapter.ts
const vimeoConfig = {
  accessToken: process.env.VIMEO_ACCESS_TOKEN,
};
```

#### SoundCloud

**Purpose:** Audio publishing

**Integration Type:** SoundCloud API

---

### 9. Affiliate Networks

#### Amazon Associates

**Purpose:** Product linking and earnings reporting

**Integration Type:** Product Advertising API 5.0

**Configuration:**
```typescript
// control-plane/adapters/affiliate/amazon.ts
const amazonConfig = {
  accessKey: process.env.AMAZON_ACCESS_KEY,
  secretKey: process.env.AMAZON_SECRET_KEY,
  associateTag: process.env.AMAZON_ASSOCIATE_TAG,
  marketplace: process.env.AMAZON_MARKETPLACE || 'US',
};
```

#### Commission Junction (CJ)

**Purpose:** Commission tracking

**Integration Type:** CJ Developer API (GraphQL)

#### Impact

**Purpose:** Affiliate action tracking

**Integration Type:** Impact REST API v2

---

## Internal Integrations

### 1. Domain-to-Domain Communication

Domains communicate via the control plane, not directly:

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│   Content   │◀───────▶│   Control    │◀───────▶│ Publishing  │
│   Domain    │  Events │    Plane     │  Events │   Domain    │
└─────────────┘         └──────────────┘         └─────────────┘
```

**Event Bus Pattern:**
```typescript
// Event publication
await eventBus.publish({
  type: 'ContentPublished',
  aggregateId: contentId,
  payload: { contentId, url, publishedAt },
});

// Event subscription
eventBus.subscribe('ContentPublished', async (event) => {
  // Handle in publishing domain
  await publishingService.scheduleSocialPosts(event.payload);
});
```

### 2. Control Plane to Domain

**Database Routing:**
```typescript
// control-plane/services/repository-factory.ts
const getDomainDb = (domainId: string): Knex => {
  const config = domainRegistry.getDbConfig(domainId);
  return knex(config);
};
```

**API Routing:**
```typescript
// control-plane/api/routes/content.ts
router.get('/domains/:domainId/content', async (req, res) => {
  const db = getDomainDb(req.params.domainId);
  const repository = new PostgresContentRepository(db);
  const content = await repository.findAll();
  res.json(content);
});
```

### 3. Job Queue Integration

**Publisher:**
```typescript
// control-plane/services/publishing-create-job.ts
await queue.add('publishing', {
  contentId,
  targets,
  scheduledAt,
}, {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
});
```

**Consumer:**
```typescript
// apps/api/src/jobs/publishExecutionJob.ts
queue.process('publishing', async (job) => {
  const { contentId, targets } = job.data;
  const service = new PublishingService();
  await service.execute(contentId, targets);
});
```

## API Contract Summary

### REST API Endpoints

| Category | Base Path | Auth |
|----------|-----------|------|
| Content | `/v1/content` | JWT |
| Publishing | `/v1/publishing` | JWT |
| Media | `/v1/media` | JWT |
| Billing | `/v1/billing` | JWT |
| Admin | `/v1/admin/*` | JWT + Admin Role |
| Webhooks | `/webhooks/*` | Signature |
| Health | `/health` | None |

### Rate Limits

| Endpoint Type | Limit | Window |
|---------------|-------|--------|
| Standard | 100 | 1 minute |
| Upload | 10 | 1 minute |
| Admin | 1000 | 1 minute |
| Webhooks | 1000 | 1 minute |

### Response Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 204 | No Content |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 409 | Conflict |
| 422 | Unprocessable |
| 429 | Rate Limited |
| 500 | Server Error |
| 503 | Service Unavailable |

## Integration Monitoring

### Circuit Breaker Pattern

```typescript
// apps/api/src/utils/resilience.ts
const circuitBreaker = new CircuitBreaker(adapterCall, {
  failureThreshold: 5,
  resetTimeout: 30000,
});
```

### Health Checks

```typescript
// Integration health check endpoint
GET /v1/admin/health/integrations

Response:
{
  "stripe": { "status": "healthy", "latency_ms": 45 },
  "linkedin": { "status": "degraded", "latency_ms": 1200 },
  "ses": { "status": "healthy", "latency_ms": 23 }
}
```

## Security Considerations

### Webhook Security

- All webhooks use signature verification
- Timestamps validated to prevent replay attacks
- IP allowlisting where supported

### API Key Management

- Keys stored in encrypted vault
- Automatic rotation every 90 days
- Access scoped to minimum required permissions

### OAuth Token Handling

- Refresh tokens encrypted at rest
- Access tokens short-lived (1 hour)
- Automatic refresh on expiry

## Related Documentation

- [System Architecture](./system-architecture.md)
- [Data Flow Documentation](./data-flow.md)
- [API Documentation](../../control-plane/api/openapi.ts)
