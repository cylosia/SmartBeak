# Shard Deployment Strategy

## Overview

This document outlines the architecture for deploying individual website shards directly to Vercel using a 1:1 ratio (one Vercel project per website), with code and themes stored separately.

## Storage Strategy: Hybrid Approach (Recommended)

### Why Hybrid?

| Layer | Storage | Reason |
|-------|---------|--------|
| **Metadata** | Postgres | Fast queries, ACID transactions, relations |
| **File Content** | R2/S3 (Object Storage) | Cheap, scalable, CDN-friendly |
| **Temp Processing** | Local Disk | Required for Vercel API file uploads |

### Alternative: Why Not Just Database?

```
Storing 1000 shards × 600KB = 600MB in Postgres

Pros:
- Everything in one system
- Transactional integrity

Cons:
- Bloats database backups
- Hard to diff/merge code changes
- Slower queries with large JSONB columns
- More expensive (DB storage > Object storage)
```

### Alternative: Why Not Just Filesystem?

```
Pros:
- Fast local access
- Easy git integration

Cons:
- Stateful servers (hard to scale horizontally)
- Risk of data loss
- Container complexity
- Harder to replicate across regions
```

## Architecture Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  USER REQUEST: Deploy site-123                                  │
└─────────────────────────┬───────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. GENERATE SHARD FILES                                        │
│     shard-generator.ts                                          │
│     - Select theme template (affiliate, authority, etc.)        │
│     - Inject site-specific config (colors, name, etc.)          │
│     - Output: Array of {path, content}                          │
└─────────────────────────┬───────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. SAVE TO OBJECT STORAGE (R2/S3)                              │
│     - Path: shards/{site-id}/v{version}/                        │
│     - Files: pages/index.tsx, styles/globals.css, etc.          │
│     - Metadata: SHA1 hashes for each file                       │
└─────────────────────────┬───────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. SAVE METADATA TO DATABASE                                   │
│     site_shards table:                                          │
│     - id, site_id, version                                      │
│     - storage_path (R2 location)                                │
│     - file_manifest (JSON: {path: {sha, size}})                 │
│     - theme_config (JSON: theme settings)                       │
│     - status: 'draft'                                           │
└─────────────────────────┬───────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. DEPLOY TO VERCEL                                            │
│     shard-deployment.ts                                         │
│     a) Fetch files from R2 → temp directory                     │
│     b) Calculate SHA1 hashes                                    │
│     c) Upload to Vercel API (/v9/files)                         │
│     d) Create deployment (/v9/deployments)                      │
│     e) Update DB status: 'deployed'                             │
│     f) Clean up temp files                                      │
└─────────────────────────────────────────────────────────────────┘
```

## Directory Structure

### Object Storage (R2/S3)

```
shards/
├── site-123/
│   ├── v1/
│   │   ├── pages/
│   │   │   ├── index.tsx
│   │   │   └── api/
│   │   │       └── webhook.ts
│   │   ├── styles/
│   │   │   └── globals.css
│   │   ├── theme/
│   │   │   └── config.json
│   │   └── package.json
│   ├── v2/
│   │   └── ... (modified files)
│   └── latest -> v2/ (symlink)
│
├── site-456/
│   ├── v1/
│   └── v2/
│
└── ... (1000+ sites)
```

### Database (Postgres)

```sql
site_shards:
  id: uuid (primary key)
  site_id: uuid (foreign key -> sites)
  version: int
  status: enum (draft, building, deployed, failed)
  storage_backend: enum (r2, s3, local)
  storage_path: text (e.g., "shards/site-123/v1")
  file_manifest: jsonb
    {
      "pages/index.tsx": {"sha": "abc123...", "size": 2048},
      "styles/globals.css": {"sha": "def456...", "size": 1024}
    }
  theme_config: jsonb
    {
      "themeId": "affiliate-comparison",
      "primaryColor": "#3b82f6",
      "siteName": "Best Tech Reviews"
    }
  vercel_project_id: text
  vercel_deployment_id: text
  vercel_url: text
  created_at: timestamptz
  deployed_at: timestamptz
```

## Benefits of This Architecture

### 1. Separation of Concerns
- **Database**: Fast metadata queries, relationships, transactions
- **Object Storage**: Cheap, durable file storage
- **Vercel**: Edge deployment and hosting

### 2. Scalability
- Stateless servers (all data in DB + Object Storage)
- Easy horizontal scaling
- CDN-friendly file access

### 3. Cost Efficiency
- R2: $0.015/GB (no egress fees!)
- S3: $0.023/GB + egress
- 1000 sites × 600KB = 600MB = ~$0.01/month

### 4. Version Control
- Each deployment is a new version
- Easy rollback to previous versions
- Audit trail in database

### 5. Theme Management
- Themes stored as templates in codebase
- Site-specific config stored in DB
- Easy to update themes across all sites

## Implementation Files

| File | Purpose |
|------|---------|
| `control-plane/services/shard-generator.ts` | Generate shard files from templates |
| `control-plane/services/shard-deployment.ts` | Save to storage, deploy to Vercel |
| `control-plane/api/routes/shard-deploy.ts` | API endpoints for deployment |
| `apps/api/src/adapters/vercel/VercelAdapter.ts` | Vercel API client (needs direct upload method) |

## Environment Variables

```bash
# Database
DATABASE_URL=postgresql://...

# R2 (Cloudflare) - Recommended
R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=xxx
R2_SECRET_ACCESS_KEY=xxx
R2_BUCKET_NAME=smartbeak-shards

# Or S3 (AWS)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
S3_BUCKET_NAME=smartbeak-shards

# Vercel
VERCEL_TOKEN=xxx
```

## API Usage Examples

### Deploy a New Site

```bash
curl -X POST http://api.smartbeak.com/shards/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "siteId": "site-123",
    "themeId": "affiliate-comparison",
    "themeConfig": {
      "siteName": "Best Tech Reviews",
      "primaryColor": "#3b82f6",
      "siteDescription": "Honest product comparisons"
    },
    "vercelProjectId": "prj_xxx"
  }'

Response:
{
  "success": true,
  "shardId": "shard-uuid",
  "deploymentId": "dpl_xxx",
  "url": "https://best-tech-reviews-xxx.vercel.app"
}
```

### List Versions

```bash
curl http://api.smartbeak.com/shards/site-123/versions

Response:
{
  "siteId": "site-123",
  "versions": [
    {"id": "shard-2", "version": 2, "status": "deployed", "url": "..."},
    {"id": "shard-1", "version": 1, "status": "deployed", "url": "..."}
  ]
}
```

### Rollback

```bash
curl -X POST http://api.smartbeak.com/shards/site-123/rollback \
  -H "Content-Type: application/json" \
  -d '{
    "targetVersion": 1,
    "vercelProjectId": "prj_xxx"
  }'
```

## Migration from Current Architecture

### Current: Git-based Monorepo
```
apps/web/ → 1 Vercel project serves all sites
```

### Target: Shard-based 1:1
```
shard-{site-id}/ → 1 Vercel project per site
```

### Migration Steps

1. **Create Vercel projects** for each existing site
2. **Generate shards** from current site configs
3. **Deploy** using new shard deployment service
4. **Update DNS** to point to new Vercel URLs
5. **Archive** old monorepo approach

## Cost Estimates (1000 Sites)

| Component | Monthly Cost |
|-----------|-------------|
| R2 Storage (600MB) | ~$0.01 |
| R2 Operations | ~$5 |
| Vercel (1000 projects) | ~$0 (hobby) or $20/pro |
| Postgres (1M rows) | Included in existing DB |
| **Total** | **~$5-25/month** |

## Conclusion

The **Hybrid Storage** approach (Database for metadata + R2/S3 for files) provides:

✅ Best scalability (stateless servers)  
✅ Lowest cost (R2 has no egress fees)  
✅ Fast queries (metadata in Postgres)  
✅ Easy rollbacks (versioned storage)  
✅ Clean separation of concerns  

This is the recommended architecture for the 1:1 Vercel project:website ratio with direct file uploads.
