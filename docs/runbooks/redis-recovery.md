# Runbook: Redis Recovery

## Overview

This runbook covers the procedures for handling Redis cache and job queue failures in the SmartBeak platform.

## Redis Usage in SmartBeak

| Component | Usage | Impact if Unavailable |
|-----------|-------|----------------------|
| Job Queue | BullMQ job queues for background processing | Publishing delays, notification delays |
| Rate Limiting | Request rate limiting | Rate limits may not be enforced |
| Session Cache | User session storage | Users logged out, auth failures |
| Publishing Status | Publishing job status cache | Status display issues |
| Circuit Breaker | Adapter circuit breaker state | Adapters may retry unnecessarily |

## Severity Levels

| Level | Description | Response Time |
|-------|-------------|---------------|
| P0 | Redis completely unavailable, job processing stopped | Immediate |
| P1 | Redis degraded, slow job processing | 15 minutes |
| P2 | Partial cache inconsistency | 30 minutes |

## Symptoms

- Publishing jobs not processing
- Notification delivery delays
- BullMQ queue dashboard showing errors
- `ECONNREFUSED` or `ETIMEDOUT` errors to Redis
- High memory usage alerts on Redis instance
- Circuit breakers not functioning correctly

## Prerequisites

- Redis connection string: `REDIS_URL`
- Redis CLI access or Redis Insight
- Access to job queue monitoring dashboard

## Procedures

### 1. Immediate Assessment

```bash
# Test Redis connectivity
redis-cli -u $REDIS_URL ping
# Expected response: PONG

# Check Redis info
redis-cli -u $REDIS_URL INFO server
redis-cli -u $REDIS_URL INFO memory
redis-cli -u $REDIS_URL INFO stats

# Check connected clients
redis-cli -u $REDIS_URL INFO clients

# Monitor real-time activity (run for 30 seconds)
redis-cli -u $REDIS_URL MONITOR
```

### 2. Common Issues and Resolution

#### 2.1 Redis Memory Exhaustion

**Symptoms:**
- Error: `OOM command not allowed when used memory > 'maxmemory'`
- High memory usage alerts
- Write operations failing

**Diagnosis:**
```bash
# Check memory usage
redis-cli -u $REDIS_URL INFO memory

# Check for large keys
redis-cli -u $REDIS_URL --bigkeys

# Check memory usage by key patterns
redis-cli -u $REDIS_URL EVAL "
  local keys = redis.call('keys', ARGV[1])
  local result = {}
  for _, key in ipairs(keys) do
    local size = redis.call('memory', 'usage', key)
    table.insert(result, {key, size})
  end
  return result
" 0 "bull:*"
```

**Resolution:**

1. **Immediate relief - Clear non-critical caches:**
   ```bash
   # Clear rate limit entries (safe to clear)
   redis-cli -u $REDIS_URL EVAL "
     local keys = redis.call('keys', 'rl:*')
     for _, key in ipairs(keys) do
       redis.call('del', key)
     end
     return #keys
   " 0
   
   # Clear circuit breaker cache (will reset circuit states)
   redis-cli -u $REDIS_URL EVAL "
     local keys = redis.call('keys', 'cb:*')
     for _, key in ipairs(keys) do
       redis.call('del', key)
     end
     return #keys
   " 0
   ```

2. **Trim completed/failed jobs (use with caution):**
   ```bash
   # List all BullMQ queues
   redis-cli -u $REDIS_URL KEYS "bull:*:id"
   
   # Trim completed jobs from a specific queue
   redis-cli -u $REDIS_URL LTRIM "bull:publishing:completed" 0 100
   redis-cli -u $REDIS_URL LTRIM "bull:notifications:completed" 0 100
   ```

3. **Increase memory or enable eviction (if using managed Redis):**
   - AWS ElastiCache: Scale up node type
   - Redis Cloud: Upgrade plan
   - Self-hosted: Update `maxmemory` in redis.conf

#### 2.2 Redis Connection Issues

**Symptoms:**
- Connection timeout errors
- `ECONNREFUSED` errors
- Intermittent connection failures

**Diagnosis:**
```bash
# Check if Redis is reachable
redis-cli -u $REDIS_URL ping

# Check network connectivity
telnet $(echo $REDIS_URL | sed 's/.*@//; s/:.*//') $(echo $REDIS_URL | sed 's/.*://')

# Check for max clients reached
redis-cli -u $REDIS_URL INFO clients | grep connected_clients
redis-cli -u $REDIS_URL CONFIG GET maxclients
```

**Resolution:**

1. **If max clients reached:**
   ```bash
   # List and kill idle connections (use with extreme caution)
   redis-cli -u $REDIS_URL CLIENT LIST | grep "idle="
   
   # Kill specific connection by ID
   redis-cli -u $REDIS_URL CLIENT KILL ID <client_id>
   
   # Or kill by address
   redis-cli -u $REDIS_URL CLIENT KILL ADDR <ip:port>
   ```

2. **Restart Redis service (if self-hosted):**
   ```bash
   sudo systemctl restart redis
   # or
   sudo service redis-server restart
   ```

3. **Failover to replica (if using Redis Sentinel or Cluster):**
   ```bash
   # Sentinel will handle this automatically
   # Check sentinel status
   redis-cli -p 26379 SENTINEL get-master-addr-by-name mymaster
   ```

#### 2.3 Job Queue Stuck/Delayed

**Symptoms:**
- Jobs not processing
- Queue depth growing
- Workers not picking up jobs

**Diagnosis:**
```bash
# Check queue depths
redis-cli -u $REDIS_URL LLEN "bull:publishing:wait"
redis-cli -u $REDIS_URL LLEN "bull:notifications:wait"
redis-cli -u $REDIS_URL LLEN "bull:search-indexing:wait"

# Check active jobs
redis-cli -u $REDIS_URL LRANGE "bull:publishing:active" 0 -1

# Check stalled jobs
redis-cli -u $REDIS_URL SMEMBERS "bull:publishing:stalled"

# Check delayed jobs
redis-cli -u $REDIS_URL ZRANGEBYSCORE "bull:publishing:delayed" 0 $(date +%s%3N)
```

**Resolution:**

1. **Check worker status:**
   ```bash
   # Check if workers are running
   ps aux | grep "worker"
   
   # Check worker logs
   pm2 logs worker
   # or
   journalctl -u smartbeak-worker -f
   ```

2. **Restart workers:**
   ```bash
   # If using PM2
   pm2 restart worker
   
   # If using systemd
   sudo systemctl restart smartbeak-worker
   
   # If using Docker
   docker restart smartbeak-worker
   ```

3. **Move stalled jobs back to wait queue:**
   ```bash
   # This requires BullMQ admin or custom script
   # Access BullMQ admin UI at: /admin/queues
   
   # Or use API to retry stalled jobs
   curl -X POST https://api.smartbeak.io/v1/admin/queues/retry-stalled \
     -H "Authorization: Bearer $ADMIN_TOKEN"
   ```

4. **Clean up old job data:**
   ```bash
   # Remove completed jobs older than 7 days
   redis-cli -u $REDIS_URL EVAL "
     local keys = redis.call('keys', 'bull:*:completed')
     local removed = 0
     for _, key in ipairs(keys) do
       local jobs = redis.call('lrange', key, 0, -1)
       for _, job in ipairs(jobs) do
         local jobKey = 'bull:' .. job:match('([^:]+):') .. ':' .. job
         local timestamp = redis.call('hget', jobKey, 'processedOn')
         if timestamp and (tonumber(timestamp) < (ARGV[1] - 604800000)) then
           redis.call('del', jobKey)
           removed = removed + 1
         end
       end
     end
     return removed
   " 0 $(date +%s%3N)
   ```

### 3. Redis Persistence Issues

**Symptoms:**
- Redis started but data missing
- `LOADING Redis is loading the dataset in memory` errors
- AOF or RDB corruption warnings

**Resolution:**

```bash
# Check persistence status
redis-cli -u $REDIS_URL INFO persistence

# If AOF is corrupted, fix it
# 1. Stop Redis
# 2. Run AOF fix
redis-check-aof --fix appendonly.aof

# 3. Restart Redis

# If data loss occurred, restore from backup
# (Procedure depends on your backup strategy - AWS snapshots, etc.)
```

### 4. Complete Redis Failure - Emergency Procedures

If Redis is completely unavailable and cannot be recovered quickly:

#### 4.1 Bypass Cache (Temporary Mode)

```bash
# Set environment variable to bypass cache
export CACHE_DISABLED=true
export REDIS_FALLBACK_MODE=true

# Update application configuration
kubectl set env deployment/api CACHE_DISABLED=true
# or
vercel env add CACHE_DISABLED production
```

#### 4.2 Direct Database Mode for Jobs

**Note:** This is a degraded mode with reduced performance.

1. Enable direct database job processing:
   ```bash
   # Update configuration
   export JOB_QUEUE_MODE=database
   
   # Restart API with degraded mode
   pm2 restart api --env production
   ```

2. Monitor database load:
   ```sql
   -- Watch for connection pool exhaustion
   SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE '%smartbeak%';
   ```

3. Process critical jobs manually:
   ```bash
   # Trigger publishing jobs directly
   curl -X POST https://api.smartbeak.io/v1/admin/jobs/process-pending \
     -H "Authorization: Bearer $ADMIN_TOKEN"
   ```

### 5. Recovery Verification

```bash
# Test Redis connectivity
redis-cli -u $REDIS_URL ping

# Verify queue processing
redis-cli -u $REDIS_URL INFO stats | grep instantaneous_ops_per_sec

# Check application health
curl https://api.smartbeak.io/health

# Verify job processing
redis-cli -u $REDIS_URL LLEN "bull:publishing:wait"
# Should be 0 or decreasing

# Test rate limiting
curl -X GET https://api.smartbeak.io/v1/content \
  -H "Authorization: Bearer $TEST_TOKEN"
# Check if rate limit headers are present
```

### 6. Post-Recovery Tasks

1. **Monitor queue processing rates** for 30 minutes
2. **Check for job failures** that occurred during outage:
   ```bash
   curl https://api.smartbeak.io/v1/admin/jobs/failed?since=<outage_start_time> \
     -H "Authorization: Bearer $ADMIN_TOKEN"
   ```
3. **Retry failed jobs** if appropriate
4. **Review memory usage** trends
5. **Update monitoring thresholds** if needed

## Prevention

1. **Enable Redis persistence:**
   - RDB snapshots every 15 minutes
   - AOF enabled for durability

2. **Set up Redis Sentinel or Cluster** for high availability

3. **Monitor key metrics:**
   - Memory usage
   - Connection count
   - Hit/miss ratio
   - Queue depths

4. **Configure alerts for:**
   - Memory usage > 80%
   - Connection count > 80% of max
   - Queue depth > 1000
   - Replication lag > 1 second

## Communication Template

**Subject:** [INCIDENT] Redis Service Disruption - SmartBeak

```
Status: Investigating/Resolved
Impact: [Description of user impact]
Start Time: [ISO timestamp]
Affected Services: Publishing, Notifications, Rate Limiting

Summary:
[Description of the issue and resolution]

User Impact:
- Publishing delays: [Duration]
- Notification delays: [Duration]
- Rate limiting: [Status]

Next Steps:
1. [Action item 1]
2. [Action item 2]
```

## Related Runbooks

- [Database Failover](./database-failover.md)
- [Publishing Failures](../reliability/runbooks/publishing.md)
- [Post-Mortem Template](../postmortems/template.md)
