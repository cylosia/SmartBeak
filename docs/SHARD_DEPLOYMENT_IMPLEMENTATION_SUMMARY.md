# Shard Deployment Implementation Summary

## Overview

This document summarizes the implementation of the shard deployment system for SmartBeak, enabling direct file uploads to Vercel without Git for a 1:1 Vercel project:website ratio.

## Files Created

### 1. Vercel Direct Upload Adapter
**File:** `apps/api/src/adapters/vercel/VercelDirectUpload.ts`

**Purpose:** Handles the complete flow for deploying files directly to Vercel via API

**Key Features:**
- Calculate SHA1 hashes for all files (required by Vercel)
- Check which files Vercel already has (deduplication)
- Upload missing files in batches
- Create deployment with file manifest
- Poll deployment status
- Support for production and staging deployments

**Main Method:**
```typescript
const adapter = new VercelDirectUploadAdapter(token);
const deployment = await adapter.deployFiles(files, {
  projectId: 'prj_xxx',
  target: 'production',
});
```

### 2. Database Migration
**File:** `infra/migrations/003_site_shards.sql`

**Purpose:** Creates the database schema for storing shard metadata

**Key Tables:**
- `site_shards` - Main table for shard versions
- `site_shard_files` - Optional file cache

**Key Features:**
- Versioning support (rollback capability)
- Status tracking (draft, building, deployed, failed)
- File manifest storage (JSONB with SHA hashes)
- Theme configuration storage
- Vercel integration tracking
- Indexes for fast queries

**View:**
- `site_shards_latest` - Get the latest version per site

**Function:**
- `get_next_shard_version(site_id)` - Auto-increment version numbers

### 3. Storage Configuration
**File:** `packages/config/storage.ts`

**Purpose:** Centralized configuration for object storage (R2, S3, GCS, local)

**Key Features:**
- Multi-provider support (R2, S3, GCS, local)
- Environment-based configuration
- S3-compatible client creation
- Path builders
- Configuration validation

**Usage:**
```typescript
import { getStorageConfig, createStorageClient } from '@config/storage';

const config = getStorageConfig();
const client = createStorageClient(config);
```

### 4. R2/S3 Terraform Configuration
**File:** `infra/terraform/r2-storage.tf`

**Purpose:** Infrastructure as Code for Cloudflare R2 bucket

**Resources Created:**
- R2 bucket with versioning
- CORS configuration
- Lifecycle rules (cleanup old versions)
- Security policies

**Alternative Configurations:**
- `infra/config/r2-bucket-policy.json` - Bucket policy
- `infra/config/r2-cors-policy.xml` - CORS rules
- `infra/config/s3-policy.json` - AWS IAM policy
- `infra/config/s3-lifecycle.json` - S3 lifecycle rules

### 5. Environment Variables
**Updated:** `.env.example`

**New Sections Added:**
- `STORAGE_BACKEND` - Provider selection (r2, s3, gcs, local)
- `R2_*` - Cloudflare R2 credentials
- `S3_*` / `AWS_*` - AWS S3 credentials
- `GCS_*` - Google Cloud Storage credentials
- `VERCEL_*` - Vercel API configuration
- `SHARD_*` - Shard deployment settings
- `THEME_*` - Theme configuration

### 6. Setup Documentation
**File:** `docs/developers/shard-deployment-setup.md`

**Purpose:** Step-by-step guide for setting up the shard deployment system

**Covers:**
- Database migration
- Object storage setup (R2, S3, MinIO)
- Vercel token creation
- Environment variable configuration
- Testing procedures
- Troubleshooting
- Cost estimates

### 7. Architecture Documentation
**File:** `docs/architecture/shard-deployment-strategy.md`

**Purpose:** Explains the hybrid storage architecture

**Key Concepts:**
- Why Hybrid? (DB for metadata, R2 for files)
- Architecture flow
- Directory structure
- Benefits and trade-offs
- Migration strategy

### 8. Additional Services (Previously Created)
**Files:**
- `control-plane/services/shard-deployment.ts` - Deployment orchestration
- `control-plane/services/shard-generator.ts` - Template-based file generation
- `control-plane/api/routes/shard-deploy.ts` - API endpoints

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER REQUEST                                │
│                    "Deploy site-123 with affiliate theme"           │
└─────────────────────────┬───────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 1. GENERATE FILES                                                   │
│    shard-generator.ts                                               │
│    - Select theme template                                          │
│    - Inject site config (colors, name, etc.)                        │
│    - Output: Array of {path, content}                               │
└─────────────────────────┬───────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. SAVE TO OBJECT STORAGE                                           │
│    packages/config/storage.ts                                       │
│    - Path: shards/{site-id}/v{version}/                             │
│    - Provider: R2 / S3 / GCS                                        │
└─────────────────────────┬───────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. SAVE METADATA TO DATABASE                                        │
│    infra/migrations/003_site_shards.sql                             │
│    - site_shards table                                              │
│    - file_manifest: {path: {sha, size}}                             │
│    - theme_config: {themeId, colors, etc.}                          │
└─────────────────────────┬───────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. DEPLOY TO VERCEL                                                 │
│    VercelDirectUpload.ts                                            │
│    a) Calculate SHA hashes                                          │
│    b) Check /v9/files for existing                                  │
│    c) Upload missing files                                          │
│    d) POST /v9/deployments                                          │
│    e) Update DB status: 'deployed'                                  │
└─────────────────────────────────────────────────────────────────────┘
```

## Storage Options

| Provider | Best For | Cost (1000 sites) |
|----------|----------|-------------------|
| **Cloudflare R2** | Production | ~$5/month (no egress fees!) |
| AWS S3 | Enterprise | ~$20-50/month |
| Google Cloud Storage | GCP users | ~$20-40/month |
| MinIO (local) | Development | Free |

## Quick Start

### 1. Setup Database
```bash
psql $DATABASE_URL -f infra/migrations/003_site_shards.sql
```

### 2. Setup R2 Bucket
```bash
# Get credentials from Cloudflare Dashboard
export R2_ACCOUNT_ID=xxx
export R2_ACCESS_KEY_ID=xxx
export R2_SECRET_ACCESS_KEY=xxx
export R2_BUCKET_NAME=smartbeak-shards
```

### 3. Setup Vercel Token
```bash
export VERCEL_TOKEN=xxx
```

### 4. Deploy Test Shard
```bash
curl -X POST http://localhost:3001/shards/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "siteId": "site-123",
    "themeId": "affiliate-comparison",
    "themeConfig": {
      "siteName": "Test Site",
      "primaryColor": "#3b82f6"
    },
    "vercelProjectId": "prj_xxx"
  }'
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/shards/deploy` | POST | Deploy a new shard version |
| `/shards/:siteId/versions` | GET | List all versions for a site |
| `/shards/:siteId/rollback` | POST | Rollback to a previous version |

## Cost Breakdown (1000 Sites)

| Component | Monthly Cost |
|-----------|-------------|
| R2 Storage (600MB) | $0.01 |
| R2 Operations | $5 |
| Vercel (Hobby) | $0 |
| Postgres (included) | $0 |
| **Total** | **~$5/month** |

## Next Steps

1. **Install dependencies:**
   ```bash
   npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
   ```

2. **Run database migration**

3. **Configure environment variables**

4. **Test with a single site**

5. **Scale to multiple sites**

## Files Checklist

- [x] `apps/api/src/adapters/vercel/VercelDirectUpload.ts` - Vercel direct upload
- [x] `infra/migrations/003_site_shards.sql` - Database schema
- [x] `packages/config/storage.ts` - Storage configuration
- [x] `infra/terraform/r2-storage.tf` - Terraform config
- [x] `infra/config/r2-bucket-policy.json` - R2 policy
- [x] `infra/config/r2-cors-policy.xml` - CORS config
- [x] `infra/config/s3-policy.json` - S3 policy
- [x] `infra/config/s3-lifecycle.json` - S3 lifecycle
- [x] `.env.example` - Environment variables (updated)
- [x] `docs/developers/shard-deployment-setup.md` - Setup guide
- [x] `docs/architecture/shard-deployment-strategy.md` - Architecture doc
- [x] `control-plane/services/shard-deployment.ts` - Deployment service
- [x] `control-plane/services/shard-generator.ts` - File generator
- [x] `control-plane/api/routes/shard-deploy.ts` - API routes

## Maintenance

### Cleaning Up Old Versions

```sql
-- Delete versions older than 30 days, keeping at least 3 per site
DELETE FROM site_shards
WHERE id IN (
  SELECT id FROM (
    SELECT 
      id,
      ROW_NUMBER() OVER (PARTITION BY site_id ORDER BY version DESC) as rn
    FROM site_shards
    WHERE created_at < NOW() - INTERVAL '30 days'
  ) ranked
  WHERE rn > 3
);
```

### Monitoring Deployments

```sql
-- Failed deployments in last 24 hours
SELECT 
  site_id,
  version,
  deployment_error,
  created_at
FROM site_shards
WHERE status = 'failed'
  AND created_at > NOW() - INTERVAL '24 hours';
```

---

**Implementation Status:** ✅ Complete and Ready for Testing
