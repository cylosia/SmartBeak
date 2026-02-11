# Runbook: Database Failover

## Overview

This runbook covers the procedures for handling PostgreSQL database failures and performing failover operations for the SmartBeak platform.

## Severity Levels

| Level | Description | Response Time |
|-------|-------------|---------------|
| P0 | Primary database completely unavailable | Immediate |
| P1 | Primary database degraded (high latency, connection errors) | 15 minutes |
| P2 | Read replica unavailable | 30 minutes |

## Symptoms

- Application returning 500/503 errors
- Database connection timeout errors in logs
- Increased latency on database-dependent operations
- Monitoring alerts: `db_connection_errors`, `db_latency_high`
- Dead Letter Queue (DLQ) growing due to database failures

## Prerequisites

- Access to database infrastructure (AWS RDS, Google Cloud SQL, or self-hosted)
- Access to environment variables and secrets
- Administrative access to the control plane

## Procedures

### 1. Immediate Assessment (All Hands on Deck for P0)

```bash
# Check database connectivity
psql $CONTROL_PLANE_DB -c "SELECT version();"

# Check connection pool status
# (Via monitoring dashboard or database admin tools)

# Check recent application logs for database errors
tail -f /var/log/smartbeak/api.log | grep -i "database\|connection\|timeout"
```

### 2. Identify Failure Type

#### 2.1 Connection Pool Exhaustion

**Symptoms:**
- Error messages: "connection pool exhausted"
- Intermittent failures, not complete outage
- High number of active connections

**Resolution:**
```bash
# Check current connection count
psql $CONTROL_PLANE_DB -c "SELECT count(*) FROM pg_stat_activity;"

# View active connections
psql $CONTROL_PLANE_DB -c "SELECT pid, usename, application_name, state FROM pg_stat_activity;"

# If necessary, terminate idle connections (use with caution)
psql $CONTROL_PLANE_DB -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND state_change < NOW() - INTERVAL '1 hour';"
```

#### 2.2 Primary Database Instance Failure

**Symptoms:**
- Complete inability to connect to primary
- All write operations failing
- Read operations may still work (if replicas exist)

**Resolution (AWS RDS):**
```bash
# Initiate failover using AWS CLI
aws rds failover-db-cluster --db-cluster-identifier smartbeak-cluster

# Or via AWS Console:
# RDS > Databases > Select cluster > Actions > Failover
```

**Resolution (Google Cloud SQL):**
```bash
# Initiate failover using gcloud
gcloud sql instances failover smartbeak-primary
```

### 3. Control Plane Database Switch

If the primary database has failed over to a new endpoint:

```bash
# 1. Get the new endpoint from your cloud provider console
# 2. Update environment variables
export CONTROL_PLANE_DB="postgresql://user:password@NEW_ENDPOINT:5432/smartbeak"

# 3. Apply to running application (if using Kubernetes)
kubectl set env deployment/api CONTROL_PLANE_DB="$CONTROL_PLANE_DB"

# 4. Or update .env file and restart services
# For Vercel deployments:
vercel env add CONTROL_PLANE_DB production
```

### 4. Domain Database Failover

For domain-specific databases (if using per-domain database routing):

```bash
# Update domain database configuration in control plane
curl -X POST https://api.smartbeak.io/v1/admin/domains/DB_ID/update-endpoint \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "newEndpoint": "NEW_ENDPOINT",
    "reason": "Failover due to primary failure"
  }'
```

### 5. Verify Recovery

```bash
# Test database connectivity
psql $CONTROL_PLANE_DB -c "SELECT NOW();"

# Run health check endpoint
curl https://api.smartbeak.io/health

# Check application error rates
# (Via monitoring dashboard or log analysis)

# Verify critical operations
# 1. User authentication
curl -X POST https://api.smartbeak.io/v1/auth/verify \
  -H "Authorization: Bearer $TEST_TOKEN"

# 2. Content creation (write operation)
curl -X POST https://api.smartbeak.io/v1/content \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Failover Test", "type": "article"}'

# 3. Content listing (read operation)
curl https://api.smartbeak.io/v1/content?limit=1 \
  -H "Authorization: Bearer $TEST_TOKEN"
```

### 6. Post-Failover Tasks

After successful failover:

1. **Monitor replication lag** (if using read replicas):
   ```sql
   SELECT 
     client_addr,
     state,
     sent_lsn,
     write_lsn,
     flush_lsn,
     replay_lsn
   FROM pg_stat_replication;
   ```

2. **Check for data consistency**:
   ```sql
   -- Run on both old primary (if accessible) and new primary
   SELECT COUNT(*) FROM content_items;
   SELECT COUNT(*) FROM publishing_jobs;
   SELECT COUNT(*) FROM notifications;
   ```

3. **Process accumulated DLQ items**:
   ```bash
   # Review DLQ
   curl https://api.smartbeak.io/v1/admin/dlq \
     -H "Authorization: Bearer $ADMIN_TOKEN"
   
   # Retry failed jobs
   curl -X POST https://api.smartbeak.io/v1/admin/dlq/retry \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"since": "2026-01-01T00:00:00Z"}'
   ```

4. **Update connection pool configuration** if needed:
   - Review `DB_POOL_SIZE` setting
   - Consider temporary increase during recovery

## Rollback Procedure

If failover needs to be reverted:

1. Ensure old primary is fully recovered
2. Verify data consistency
3. Perform switch back during maintenance window
4. Follow steps 3-6 above with original endpoint

## Communication Template

**Subject:** [INCIDENT] Database Failover - SmartBeak

```
Status: Investigating/Resolved
Impact: [Description of user impact]
Start Time: [ISO timestamp]
Affected Services: API, Publishing, Notifications

Summary:
[Description of the issue and resolution]

User Impact:
- Content creation: [Status]
- Publishing: [Status]
- Notifications: [Status]

Next Steps:
1. [Action item 1]
2. [Action item 2]
```

## Related Runbooks

- [Redis Recovery](./redis-recovery.md)
- [Deployment Rollback](./deployment-rollback.md)
- [Post-Mortem Template](../postmortems/template.md)

## References

- [PostgreSQL Failover Documentation](https://www.postgresql.org/docs/current/high-availability.html)
- AWS RDS Failover: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Managing.Failure.html
- Google Cloud SQL Failover: https://cloud.google.com/sql/docs/mysql/high-availability
