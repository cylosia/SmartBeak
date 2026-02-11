# Runbook: Deployment Rollback

## Overview

This runbook covers the procedures for rolling back deployments in the SmartBeak platform when a release causes issues.

## Deployment Targets

| Component | Platform | Rollback Method |
|-----------|----------|-----------------|
| Web Frontend (Next.js) | Vercel | `vercel rollback` |
| API Backend | Vercel/Kubernetes | `vercel rollback` / `kubectl rollout undo` |
| Control Plane | Kubernetes | `kubectl rollout undo` |
| Workers | Kubernetes/PM2 | `kubectl rollout undo` / `pm2 restart` |
| Database Migrations | Manual | Reverse migrations |

## When to Rollback

**Immediate Rollback Criteria:**
- Error rate > 5% for > 2 minutes
- Complete service outage
- Data corruption detected
- Security vulnerability introduced
- Performance degradation > 200% latency increase

**Consider Rollback:**
- Feature-specific failures affecting > 10% users
- Non-critical errors with no immediate fix
- Third-party integration failures

## Severity-Based Response

| Severity | Response Time | Rollback Decision |
|----------|---------------|-------------------|
| P0 | Immediate | Auto-rollback or immediate manual |
| P1 | 5 minutes | Rollback if no fix in 15 min |
| P2 | 15 minutes | Rollback if no fix in 30 min |

## Rollback Procedures

### 1. Vercel Deployment Rollback

#### 1.1 Web Frontend Rollback

```bash
# List recent deployments
vercel list

# Output:
# smartbeak-web  production  https://smartbeak.io  1h ago   v1.2.3 (current)
# smartbeak-web  production  https://smartbeak.io  2h ago   v1.2.2
# smartbeak-web  production  https://smartbeak.io  1d ago   v1.2.1

# Rollback to previous deployment
vercel rollback <deployment_id>

# Or rollback to specific version
vercel rollback --yes

# Verify rollback
vercel list

# Monitor for recovery
curl -s https://smartbeak.io/api/health | jq
```

#### 1.2 API Rollback (if deployed on Vercel)

```bash
# Same procedure as web frontend
vercel rollback <deployment_id> --scope=api

# Verify API health
curl https://api.smartbeak.io/health
curl https://api.smartbeak.io/v1/content?limit=1
```

### 2. Kubernetes Deployment Rollback

#### 2.1 API Deployment Rollback

```bash
# View rollout history
kubectl rollout history deployment/api

# Output:
# REVISION  CHANGE-CAUSE
# 1         kubectl apply --filename=api-v1.2.1.yaml
# 2         kubectl apply --filename=api-v1.2.2.yaml
# 3         kubectl apply --filename=api-v1.2.3.yaml (current)

# Rollback to previous revision
kubectl rollout undo deployment/api

# Or rollback to specific revision
kubectl rollout undo deployment/api --to-revision=2

# Monitor rollout status
kubectl rollout status deployment/api

# Verify pods are running
kubectl get pods -l app=api

# Check logs for errors
kubectl logs -l app=api --tail=100
```

#### 2.2 Worker Rollback

```bash
# Rollback publishing worker
kubectl rollout undo deployment/publishing-worker

# Rollback notification worker
kubectl rollout undo deployment/notification-worker

# Rollback all workers
kubectl rollout undo deployment/publishing-worker
kubectl rollout undo deployment/notification-worker
kubectl rollout undo deployment/search-indexing-worker
```

#### 2.3 Control Plane Rollback

```bash
# Rollback control plane services
kubectl rollout undo deployment/control-plane-api
kubectl rollout undo deployment/control-plane-worker

# Verify control plane health
curl https://control-plane.smartbeak.io/health
```

### 3. Docker/PM2 Rollback (Self-Hosted)

```bash
# List available images
docker images | grep smartbeak

# Rollback to previous image
kubectl set image deployment/api api=smartbeak/api:v1.2.2

# Or with PM2
pm2 reload ecosystem.config.js --env production

# With specific version
pm2 start app.js --name api -- --version=1.2.2
```

### 4. Database Migration Rollback

**⚠️ WARNING: Database rollbacks are complex and risky. Only proceed with DBA approval.**

#### 4.1 Check Migration Status

```bash
# List applied migrations
psql $CONTROL_PLANE_DB -c "SELECT * FROM schema_migrations ORDER BY applied_at DESC LIMIT 10;"

# Or using migration tool
npx knex migrate:status
```

#### 4.2 Reverse Migration (if reversible)

```bash
# For reversible migrations with Knex
npx knex migrate:rollback

# For specific migration
npx knex migrate:down 20260227_add_content_archive_tables.js
```

#### 4.3 Manual Rollback (if irreversible)

If migration is not reversible, you must create and run a reverse migration:

```sql
-- Example: Reverse migration for content_archive_tables
-- Create reverse migration file

-- Down migration: 20260227_add_content_archive_tables_rollback.sql

-- 1. Archive data if needed
CREATE TABLE IF NOT EXISTS content_archive_backup AS 
SELECT * FROM content_archive_audit WHERE created_at > NOW() - INTERVAL '24 hours';

-- 2. Remove foreign key constraints
ALTER TABLE content_archive_audit DROP CONSTRAINT IF EXISTS fk_content_archive_audit_intent;

-- 3. Drop new tables
DROP TABLE IF EXISTS content_archive_audit;
DROP TABLE IF EXISTS content_archive_intents;

-- 4. Remove columns from existing tables
ALTER TABLE content_items 
  DROP COLUMN IF EXISTS archived_at,
  DROP COLUMN IF EXISTS restored_at,
  DROP COLUMN IF EXISTS restored_reason,
  DROP COLUMN IF EXISTS previous_status,
  DROP COLUMN IF EXISTS content_type,
  DROP COLUMN IF EXISTS domain_id;

-- 5. Update schema_migrations record
DELETE FROM schema_migrations WHERE version = '20260227';
```

#### 4.4 Execute Manual Rollback

```bash
# Run rollback script
psql $CONTROL_PLANE_DB -f migrations/rollback/20260227_add_content_archive_tables_rollback.sql

# Verify rollback
psql $CONTROL_PLANE_DB -c "\dt"
psql $CONTROL_PLANE_DB -c "SELECT * FROM schema_migrations ORDER BY applied_at DESC LIMIT 5;"
```

### 5. Configuration Rollback

#### 5.1 Environment Variables Rollback

```bash
# Vercel - restore from previous deployment
vercel env ls

# Get previous values from deployment logs
curl https://api.vercel.com/v6/deployments/<deployment_id> \
  -H "Authorization: Bearer $VERCEL_TOKEN"

# Restore specific variable
vercel env add CONTROL_PLANE_DB production
# Enter previous value when prompted
```

#### 5.2 Feature Flag Rollback

```bash
# Disable problematic feature
curl -X POST https://api.smartbeak.io/v1/admin/flags \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "flag": "new_feature_x",
    "value": false,
    "reason": "Rollback due to INCIDENT-123"
  }'

# Or use feature flag service
# LaunchDarkly, Split.io, etc.
```

### 6. Redis/Data Cache Rollback

```bash
# Clear potentially corrupted cache
redis-cli -u $REDIS_URL FLUSHDB

# Or selectively clear
curl -X POST https://api.smartbeak.io/v1/admin/cache/clear \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "patterns": ["content:*", "user:*"],
    "reason": "Rollback cache clear"
  }'
```

## Verification After Rollback

### 1. Health Checks

```bash
# API health
curl -f https://api.smartbeak.io/health || echo "HEALTH CHECK FAILED"

# Web health
curl -f https://smartbeak.io/api/health || echo "WEB HEALTH CHECK FAILED"

# Database connectivity
psql $CONTROL_PLANE_DB -c "SELECT NOW();" || echo "DB CONNECTION FAILED"

# Redis connectivity
redis-cli -u $REDIS_URL ping || echo "REDIS CONNECTION FAILED"
```

### 2. Key Functionality Tests

```bash
# Test authentication
curl -X POST https://api.smartbeak.io/v1/auth/verify \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -s | jq '.authenticated'

# Test content API (read)
curl https://api.smartbeak.io/v1/content?limit=1 \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -s | jq '.data[0].id'

# Test content API (write) - use test endpoint
curl -X POST https://api.smartbeak.io/v1/test/content \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Rollback Test", "type": "test"}' \
  -s | jq '.id'
```

### 3. Error Rate Monitoring

```bash
# Check error rates
curl https://api.smartbeak.io/v1/admin/metrics/error-rate \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -s | jq '{error_rate_5m, error_rate_1h}'

# Should show: error_rate_5m < 0.01 (1%)
```

### 4. Job Queue Verification

```bash
# Check queue depths
redis-cli -u $REDIS_URL LLEN "bull:publishing:wait"
redis-cli -u $REDIS_URL LLEN "bull:notifications:wait"

# Should be 0 or stable (not growing)
```

## Post-Rollback Actions

### 1. Create Incident Record

```bash
# Log rollback event
curl -X POST https://api.smartbeak.io/v1/admin/incidents \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "rollback",
    "severity": "P1",
    "description": "Rolled back deployment v1.2.3 due to [reason]",
    "rolled_back_from": "v1.2.3",
    "rolled_back_to": "v1.2.2",
    "affected_services": ["api", "web"],
    "trigger": "error_rate_spike"
  }'
```

### 2. Stabilization Period

- Monitor for 30 minutes post-rollback
- Keep deployment frozen for 2 hours
- Document any data inconsistencies

### 3. Fix Forward Planning

```bash
# Create hotfix branch
git checkout -b hotfix/v1.2.4 v1.2.3

# Revert problematic changes
git revert <commit_hash>

# Or fix the issue
git cherry-pick <fix_commit>

# Test thoroughly
npm run test
npm run test:integration

# Deploy hotfix
vercel deploy --prod
```

## Communication Template

**Subject:** [ROLLBACK] SmartBeak Deployment Rollback Completed

```
Status: Rolled Back
Previous Version: v1.2.3
Rolled Back To: v1.2.2
Time: [ISO timestamp]
Duration: [X minutes]

Reason:
[Description of the issue that triggered rollback]

Impact:
- Services affected: [List]
- User impact: [Description]
- Duration: [X minutes]

Current Status:
- All services operational
- Monitoring for stability
- No user action required

Next Steps:
1. Incident post-mortem scheduled for [time]
2. Hotfix deployment planned for [time]
3. [Other actions]
```

## Prevention Measures

### 1. Pre-Deployment Checklist

- [ ] All tests passing
- [ ] Integration tests completed
- [ ] Database migrations tested on staging
- [ ] Performance benchmarks met
- [ ] Feature flags configured
- [ ] Rollback plan documented
- [ ] On-call engineer notified

### 2. Deployment Best Practices

- Use canary deployments when possible
- Deploy during low-traffic hours
- Enable automated rollback triggers
- Maintain deployment audit log

### 3. Automated Safeguards

```yaml
# Example: Kubernetes automated rollback
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  progressDeadlineSeconds: 600  # 10 minutes
```

```javascript
// Example: Application-level health check for auto-rollback
if (errorRate > 0.05 && duration > 120000) {
  await triggerAutoRollback({
    reason: 'Error rate exceeded 5% for 2 minutes',
    currentVersion: process.env.DEPLOYMENT_VERSION
  });
}
```

## Related Runbooks

- [Database Failover](./database-failover.md)
- [Redis Recovery](./redis-recovery.md)
- [Post-Mortem Template](../postmortems/template.md)

## References

- Vercel Rollback: https://vercel.com/docs/cli/rollback
- Kubernetes Rollout: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#rolling-back-a-deployment
- Blue/Green Deployment: https://docs.aws.amazon.com/whitepapers/latest/overview-deployment-options/bluegreen-deployments.html
