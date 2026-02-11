# Shard Deployment Setup Guide

This guide walks you through setting up the shard deployment system for deploying websites directly to Vercel without Git.

## Prerequisites

- Node.js 18+ and npm/yarn/pnpm
- PostgreSQL 14+ database
- Cloudflare account (for R2) OR AWS account (for S3)
- Vercel account with API token

## 1. Database Setup

### Run the Migration

```bash
# Using knex
npx knex migrate:latest --specific 003_site_shards.sql

# Or run the SQL directly
psql $DATABASE_URL -f infra/migrations/003_site_shards.sql
```

### Verify the Migration

```sql
-- Check table exists
\dt site_shards

-- Check indexes
\di site_shards*

-- Check view
\dv site_shards_latest
```

## 2. Object Storage Setup (Choose One)

### Option A: Cloudflare R2 (Recommended)

R2 is recommended because it has **no egress fees**, making it cost-effective for the shard deployment system.

#### Create R2 Bucket

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **R2** → **Create Bucket**
3. Name: `smartbeak-shards` (or your preferred name)
4. Location: Automatic

#### Create API Token

1. Go to **R2** → **Manage R2 API Tokens**
2. Click **Create API Token**
3. Name: `SmartBeak Shard Deployment`
4. Permissions:
   - **Object Read & Write**: Allow
5. Click **Create API Token**
6. Save the **Access Key ID** and **Secret Access Key**

#### Get Account ID

Your Cloudflare Account ID is visible in the right sidebar of the R2 page.

#### Update Environment Variables

```bash
STORAGE_BACKEND=r2
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET_NAME=smartbeak-shards
R2_ENDPOINT=https://your_account_id.r2.cloudflarestorage.com
```

#### Using Terraform (Optional)

```bash
cd infra/terraform

# Create terraform.tfvars
cat > terraform.tfvars <<EOF
r2_account_id = "your_account_id"
r2_access_key_id = "your_access_key"
r2_secret_access_key = "your_secret_key"
environment = "production"
EOF

# Apply
terraform init
terraform plan
terraform apply
```

### Option B: AWS S3

#### Create S3 Bucket

```bash
aws s3api create-bucket \
  --bucket smartbeak-shards \
  --region us-east-1

# Enable versioning
aws s3api put-bucket-versioning \
  --bucket smartbeak-shards \
  --versioning-configuration Status=Enabled

# Set lifecycle policy
aws s3api put-bucket-lifecycle-configuration \
  --bucket smartbeak-shards \
  --lifecycle-configuration file://infra/config/s3-lifecycle.json
```

#### Create IAM User

```bash
# Create user
aws iam create-user --user-name smartbeak-shards

# Create policy
aws iam create-policy \
  --policy-name SmartBeakShardsAccess \
  --policy-document file://infra/config/s3-policy.json

# Attach policy
aws iam attach-user-policy \
  --user-name smartbeak-shards \
  --policy-arn arn:aws:iam::YOUR_ACCOUNT_ID:policy/SmartBeakShardsAccess

# Create access keys
aws iam create-access-key --user-name smartbeak-shards
```

#### Update Environment Variables

```bash
STORAGE_BACKEND=s3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
S3_BUCKET_NAME=smartbeak-shards
```

### Option C: MinIO (Local Development)

For local development, you can use MinIO:

```bash
# Run MinIO in Docker
docker run -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data --console-address ":9001"

# Create bucket
mc alias set local http://localhost:9000 minioadmin minioadmin
mc mb local/smartbeak-shards
```

```bash
STORAGE_BACKEND=s3
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET_NAME=smartbeak-shards
S3_ENDPOINT=http://localhost:9000
```

## 3. Vercel Setup

### Create API Token

1. Go to [Vercel Tokens](https://vercel.com/account/tokens)
2. Click **Create Token**
3. Name: `SmartBeak Shard Deployment`
4. Scope: Choose appropriate scope (Full Account or specific team)
5. Click **Create Token**
6. Copy the token immediately (you won't see it again)

### Update Environment Variables

```bash
VERCEL_TOKEN=your_vercel_token
VERCEL_TEAM_ID=team_xxx  # Optional, if using a team
```

### Test Vercel Connection

```bash
# Test API token
curl -H "Authorization: Bearer $VERCEL_TOKEN" \
  https://api.vercel.com/v9/user
```

## 4. Environment Variables Setup

Create `.env` file from the example:

```bash
cp .env.example .env
```

Fill in all the required values from the sections above.

### Required Variables Checklist

```bash
# Database
DATABASE_URL=postgresql://...

# Storage (R2 recommended)
STORAGE_BACKEND=r2
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=smartbeak-shards
R2_ENDPOINT=...

# Vercel
VERCEL_TOKEN=...
VERCEL_TEAM_ID=...  # Optional

# Shard Deployment
SHARD_MAX_SIZE_BYTES=10485760
SHARD_MAX_FILES=500
SHARD_UPLOAD_CONCURRENCY=10
SHARD_DEPLOYMENT_TIMEOUT_MS=300000

# Themes
DEFAULT_THEME_ID=affiliate-comparison
AVAILABLE_THEMES=affiliate-comparison,authority-site,landing-leadgen,local-business,media-newsletter
```

## 5. Testing the Setup

### Test Database Connection

```bash
npx ts-node -e "
import { knex } from './packages/database';
async function test() {
  const result = await knex.raw('SELECT NOW()');
  console.log('Database connected:', result.rows[0]);
  await knex.destroy();
}
test();
"
```

### Test Storage Connection

```bash
npx ts-node -e "
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
const client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
async function test() {
  const result = await client.send(new ListBucketsCommand({}));
  console.log('Buckets:', result.Buckets?.map(b => b.Name));
}
test();
"
```

### Test Vercel Connection

```bash
npx ts-node -e "
import { VercelDirectUploadAdapter } from './apps/api/src/adapters/vercel/VercelDirectUpload';
const adapter = new VercelDirectUploadAdapter(process.env.VERCEL_TOKEN);
async function test() {
  // Test with a simple file
  const deployment = await adapter.deployFiles(
    [
      {
        path: 'index.html',
        content: '<html><body>Hello from SmartBeak!</body></html>',
      },
    ],
    {
      projectId: 'your_test_project_id',
      target: 'production',
    }
  );
  console.log('Deployment:', deployment);
}
test().catch(console.error);
"
```

## 6. API Endpoints

Once everything is set up, you can use these endpoints:

### Deploy a New Shard

```bash
curl -X POST http://localhost:3001/shards/deploy \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{
    "siteId": "site-123",
    "themeId": "affiliate-comparison",
    "themeConfig": {
      "siteName": "My Tech Reviews",
      "primaryColor": "#3b82f6",
      "siteDescription": "Honest product reviews"
    },
    "vercelProjectId": "prj_xxx"
  }'
```

### List Shard Versions

```bash
curl http://localhost:3001/shards/site-123/versions \
  -H "Authorization: Bearer $API_TOKEN"
```

### Rollback to Previous Version

```bash
curl -X POST http://localhost:3001/shards/site-123/rollback \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{
    "targetVersion": 1,
    "vercelProjectId": "prj_xxx"
  }'
```

## 7. Monitoring

### Check Deployment Status

```sql
-- List recent deployments
SELECT 
  site_id,
  version,
  status,
  vercel_url,
  created_at,
  deployed_at,
  EXTRACT(EPOCH FROM (deployed_at - created_at)) as deployment_time_seconds
FROM site_shards
ORDER BY created_at DESC
LIMIT 10;

-- Count deployments by status
SELECT 
  status,
  COUNT(*) as count
FROM site_shards
GROUP BY status;

-- Find sites with failed deployments
SELECT 
  site_id,
  MAX(version) as latest_version,
  MAX(CASE WHEN status = 'failed' THEN version END) as last_failed_version
FROM site_shards
GROUP BY site_id
HAVING MAX(CASE WHEN status = 'failed' THEN version END) IS NOT NULL;
```

## 8. Troubleshooting

### "Access Denied" from R2/S3

- Check your access keys are correct
- Verify the bucket exists
- Check IAM permissions include `s3:PutObject`, `s3:GetObject`, `s3:ListBucket`

### "Unauthorized" from Vercel

- Verify your Vercel token is valid
- Check if you're using the correct team ID
- Ensure the token has the required scopes

### Deployment Stuck in "building" State

- Check Vercel dashboard for build logs
- Verify your shard files are valid (no syntax errors)
- Check that all required files are included (package.json, etc.)

### Database Connection Errors

- Verify `DATABASE_URL` is correct
- Check PostgreSQL is running
- Ensure the migration has been applied

## 9. Cost Estimates

### R2 (Cloudflare) - Recommended

| Component | Cost |
|-----------|------|
| Storage (1 GB) | $0.015/month |
| Operations (1M reads) | $0.36 |
| Egress | **$0** (no egress fees!) |
| **Total for 1000 sites** | **~$5/month** |

### S3 (AWS)

| Component | Cost |
|-----------|------|
| Storage (1 GB) | $0.023/month |
| Operations | ~$0.40 per 1M |
| Egress | $0.09/GB |
| **Total for 1000 sites** | **~$20-50/month** |

### Vercel

| Plan | Cost per Project |
|------|-----------------|
| Hobby | Free |
| Pro | $20/month |

For 1000 sites on Hobby plan: **$0/month**

## Next Steps

1. Read the [Architecture Overview](../architecture/shard-deployment-strategy.md)
2. Review the [API Documentation](../api/shard-deployment.md)
3. Set up monitoring and alerting
4. Configure CI/CD for automated deployments
