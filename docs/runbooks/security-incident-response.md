# Runbook: Security Incident Response

## Overview

This runbook outlines the procedures for responding to security incidents in the SmartBeak platform, including data breaches, unauthorized access, and vulnerability exploitation.

## Severity Levels

| Level | Description | Examples | Response Time |
|-------|-------------|----------|---------------|
| **Critical (SEV-1)** | Active exploitation, data breach, system compromise | RCE in production, database exposed, active attack in progress | Immediate (< 15 min) |
| **High (SEV-2)** | Potential breach, critical vulnerability disclosed | 0-day in dependency, suspicious admin activity | 1 hour |
| **Medium (SEV-3)** | Security issue requiring investigation | Unusual access patterns, failed auth spikes | 4 hours |
| **Low (SEV-4)** | Policy violation, minor security concern | Password policy violation, misconfiguration | 24 hours |

## Incident Response Team

| Role | Responsibility | Contact |
|------|----------------|---------|
| Incident Commander | Overall coordination, decision making | [On-call security lead] |
| Technical Lead | Technical investigation, containment | [On-call engineer] |
| Communications | Internal/external communication | [Communications lead] |
| Legal/Compliance | Regulatory requirements, legal implications | [Legal contact] |

## Response Phases

### Phase 1: Detection & Assessment

#### Detection Sources
- Security monitoring alerts (Datadog, Splunk)
- Bug bounty reports
- Customer reports
- Automated vulnerability scanners
- Infrastructure monitoring
- Audit logs

#### Initial Assessment Checklist

```bash
# 1. Verify the incident scope
echo "=== Incident Assessment ==="
echo "Time detected: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Detection source: [alert/report/monitoring]"
echo "Affected systems: [list systems]"
echo "Potential impact: [data/systems/users]"

# 2. Gather initial evidence
# Save logs before rotation
tar -czf /tmp/incident-$(date +%Y%m%d-%H%M%S)-logs.tar.gz /var/log/smartbeak/

# 3. Check recent deployments
echo "Recent deployments:"
vercel list --meta
# or
kubectl get deployments -o yaml | grep -A5 "image:"
```

### Phase 2: Containment

#### 2.1 Immediate Containment (SEV-1/SEV-2)

**If database compromise suspected:**
```bash
# 1. Rotate database credentials immediately
# AWS RDS
aws rds modify-db-instance \
  --db-instance-identifier smartbeak-db \
  --master-user-password "$(openssl rand -base64 32)"

# 2. Update application with new credentials
kubectl set env deployment/api \
  CONTROL_PLANE_DB="postgresql://user:NEW_PASSWORD@host/db"

# 3. Kill existing database connections
psql $CONTROL_PLANE_DB -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'app_user';"
```

**If API key/token compromise suspected:**
```bash
# 1. Revoke all active sessions
curl -X POST https://api.smartbeak.io/v1/admin/sessions/revoke-all \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Security incident - INCIDENT-123"}'

# 2. Rotate JWT signing keys
# Generate new keys
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Update environment
kubectl set env deployment/api JWT_KEY_1="new_key_1" JWT_KEY_2="new_key_2"

# 3. Invalidate all API keys
curl -X POST https://api.smartbeak.io/v1/admin/api-keys/invalidate-all \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**If specific user account compromised:**
```bash
# Disable user account
curl -X POST https://api.smartbeak.io/v1/admin/users/<user_id>/disable \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Security incident", "force_logout": true}'

# Revoke all sessions for user
curl -X POST https://api.smartbeak.io/v1/admin/users/<user_id>/sessions/revoke \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**If malicious code deployed:**
```bash
# Immediate rollback to last known good version
vercel rollback --yes
# or
kubectl rollout undo deployment/api

# Disable deployments temporarily
kubectl annotate deployment/api deployment.kubernetes.io/paused="true"
```

#### 2.2 Network Containment

```bash
# Block suspicious IP addresses
# AWS WAF
aws wafv2 update-ip-set \
  --name smartbeak-blocklist \
  --scope REGIONAL \
  --id <ip-set-id> \
  --addresses "192.0.2.1/32" "198.51.100.0/24"

# Or at application level
curl -X POST https://api.smartbeak.io/v1/admin/firewall/block \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ips": ["192.0.2.1", "198.51.100.0/24"], "duration_hours": 24}'
```

### Phase 3: Eradication

#### 3.1 Remove Threat Actor Access

```bash
# 1. Audit all active sessions
curl https://api.smartbeak.io/v1/admin/sessions/active \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -s | jq '.sessions[] | {user_id, ip_address, user_agent, created_at}'

# 2. Identify suspicious sessions
curl https://api.smartbeak.io/v1/admin/sessions/suspicious \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 3. Terminate suspicious sessions
curl -X POST https://api.smartbeak.io/v1/admin/sessions/terminate \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "criteria": {
      "ip_country": ["XX"],
      "user_agent_pattern": "suspicious"
    }
  }'
```

#### 3.2 Patch Vulnerabilities

```bash
# 1. Check for vulnerable dependencies
npm audit --audit-level=high

# 2. Update dependencies
npm update
# or specific package
npm install package-name@latest

# 3. Deploy patched version
vercel deploy --prod
# or
kubectl set image deployment/api api=smartbeak/api:patched-v1.2.3
```

### Phase 4: Recovery

#### 4.1 Systematic Restoration

1. **Verify all backdoors removed:**
   - Review all admin accounts
   - Check for unauthorized SSH keys
   - Verify no unauthorized API keys

2. **Restore from clean backups if necessary:**
   ```bash
   # If database integrity compromised
   # Restore from pre-incident backup
   aws rds restore-db-instance-to-point-in-time \
     --source-db-instance-identifier smartbeak-db \
     --target-db-instance-identifier smartbeak-db-recovery \
     --restore-time 2026-01-15T10:00:00Z
   ```

3. **Gradual service restoration:**
   ```bash
   # Enable services one by one, monitoring closely
   # 1. Enable read-only endpoints
   # 2. Enable non-critical write endpoints
   # 3. Full service restoration
   ```

#### 4.2 Enhanced Monitoring

```bash
# Enable additional logging for 48 hours
curl -X POST https://api.smartbeak.io/v1/admin/monitoring/enhanced \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "duration_hours": 48,
    "includes": ["auth", "admin_actions", "data_access"]
  }'
```

### Phase 5: Post-Incident

## Incident Types

### Type 1: Data Breach

**Immediate Actions:**
1. Contain the breach (stop ongoing exfiltration)
2. Determine scope of data accessed
3. Preserve evidence
4. Notify Legal/Compliance within 1 hour

**Investigation Steps:**
```sql
-- Identify affected records
SELECT 
  table_name,
  COUNT(*) as record_count,
  MIN(accessed_at) as first_access,
  MAX(accessed_at) as last_access
FROM audit_logs
WHERE accessed_by = '<suspicious_user_or_ip>'
  AND accessed_at BETWEEN '<start_time>' AND '<end_time>'
GROUP BY table_name;

-- Check for bulk exports
SELECT 
  user_id,
  action,
  COUNT(*) as record_count
FROM audit_logs
WHERE action IN ('export', 'bulk_download')
  AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY user_id, action
HAVING COUNT(*) > 100;
```

**Regulatory Notifications:**
| Regulation | Timeline | Trigger |
|------------|----------|---------|
| GDPR | 72 hours | Personal data of EU residents |
| CCPA | Without unreasonable delay | California residents |
| State laws | Varies | Varies by state |

### Type 2: Unauthorized Access

**Detection:**
- Impossible travel alerts
- Login from new device/location
- Privilege escalation attempts

**Response:**
```bash
# Review access logs
curl https://api.smartbeak.io/v1/admin/audit/logs \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -G -d "user_id=<suspicious_user>" -d "since=<timestamp>"

# Check for privilege escalation
SELECT 
  user_id,
  old_role,
  new_role,
  changed_by,
  changed_at
FROM role_changes
WHERE changed_at > NOW() - INTERVAL '24 hours';
```

### Type 3: Malware/Ransomware

**Immediate Actions:**
1. Isolate affected systems
2. Do NOT pay ransom
3. Preserve forensic evidence
4. Activate disaster recovery if needed

### Type 4: DDoS Attack

**Response:**
```bash
# Enable DDoS protection mode
curl -X POST https://api.smartbeak.io/v1/admin/ddos/protect \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "level": "aggressive",
    "challenge_suspicious": true,
    "rate_limit_factor": 0.1
  }'

# Enable Cloudflare/AWS Shield if available
```

### Type 5: Dependency Vulnerability

**Response:**
```bash
# 1. Identify vulnerable dependency
npm audit --json | jq '.vulnerabilities'

# 2. Check if exploitable in our context
# Review usage of the package

# 3. Apply fix
npm audit fix
# or manually update

# 4. Emergency patch if no fix available
# Apply workaround/patch via postinstall
```

## Evidence Preservation

### Log Preservation

```bash
# Create immutable evidence package
INCIDENT_ID="INC-$(date +%Y%m%d)-001"
EVIDENCE_DIR="/secure/evidence/$INCIDENT_ID"
mkdir -p $EVIDENCE_DIR

# Copy logs
cp /var/log/smartbeak/*.log $EVIDENCE_DIR/
cp /var/log/nginx/*.log $EVIDENCE_DIR/
cp /var/log/auth.log $EVIDENCE_DIR/

# Database audit logs
pg_dump --table=audit_logs --data-only $CONTROL_PLANE_DB > $EVIDENCE_DIR/audit_logs.sql

# Container logs
kubectl logs deployment/api --all-containers --since=24h > $EVIDENCE_DIR/k8s_logs.txt

# Create hash for integrity
cd /secure/evidence
tar -czf "${INCIDENT_ID}.tar.gz" "$INCIDENT_ID"
sha256sum "${INCIDENT_ID}.tar.gz" > "${INCIDENT_ID}.sha256"

# Upload to secure storage
aws s3 cp "${INCIDENT_ID}.tar.gz" s3://smartbeak-security-evidence/
```

## Communication Plan

### Internal Escalation

| Time | Action | Recipient |
|------|--------|-----------|
| 0 min | Page on-call security | On-call security |
| 15 min | Notify engineering leadership | CTO, VP Engineering |
| 30 min | Legal/Compliance brief | Legal, CISO |
| 1 hour | Executive briefing | CEO, Board (if critical) |

### External Communication

**Customer Notification (if data affected):**
```
Subject: Security Incident Notification

We are writing to inform you of a security incident that may have affected your account.

What happened:
[Brief, factual description]

What information was involved:
[Specific data types]

What we are doing:
[Remediation steps]

What you can do:
[Recommended user actions]

We sincerely apologize for this incident.
```

## Recovery Checklist

- [ ] Threat actor access removed
- [ ] All systems patched
- [ ] Credentials rotated
- [ ] Sessions reset
- [ ] Monitoring enhanced
- [ ] Logs preserved
- [ ] Post-mortem scheduled
- [ ] Regulatory notifications sent (if required)
- [ ] Customer notifications sent (if required)

## Related Runbooks

- [Database Failover](./database-failover.md)
- [Deployment Rollback](./deployment-rollback.md)
- [Post-Mortem Template](../postmortems/template.md)

## References

- NIST Cybersecurity Framework: https://www.nist.gov/cyberframework
- SANS Incident Handler's Handbook: https://www.sans.org/reading-room/
- GDPR Breach Notification: https://gdpr.eu/article-33-breach-notification/
