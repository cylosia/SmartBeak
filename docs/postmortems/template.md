# Post-Mortem Template

## Overview

This template provides a structured format for documenting post-mortems. All sections should be completed with specific, factual information.

---

## Metadata

| Field | Value |
|-------|-------|
| **Incident ID** | INC-YYYY-MM-DD-NNN |
| **Date** | YYYY-MM-DD |
| **Severity** | SEV-1 / SEV-2 / SEV-3 / SEV-4 |
| **Duration** | HH:MM:SS |
| **Status** | Resolved / Ongoing |
| **Reporter** | Name |
| **Reviewers** | Names |

---

## Executive Summary

### One-Line Summary
Brief, tweet-length summary of what happened.

### Impact Overview
- **Services Affected:** List affected services
- **User Impact:** Number of users affected, severity
- **Data Impact:** Any data loss or corruption
- **Financial Impact:** Revenue impact if applicable

---

## Timeline

### Detection

| Time (UTC) | Event | Notes |
|------------|-------|-------|
| 00:00 | Monitoring alert fired | Alert: API error rate > 5% |
| 00:05 | On-call engineer paged | Engineer acknowledged |
| 00:10 | Incident declared | SEV-2, #incident-123 channel created |

### Investigation

| Time (UTC) | Event | Notes |
|------------|-------|-------|
| 00:15 | Initial assessment | Identified database connection issues |
| 00:25 | Root cause identified | Connection pool exhaustion |
| 00:30 | Mitigation started | Scaling database connections |

### Resolution

| Time (UTC) | Event | Notes |
|------------|-------|-------|
| 00:45 | Service restored | Error rates back to normal |
| 01:00 | Monitoring confirmed | All systems green |
| 01:30 | Incident closed | Declared resolved |

---

## Impact Assessment

### User Impact

| Metric | Value |
|--------|-------|
| Total users affected | X |
| Failed requests | X |
| Error rate peak | X% |
| Average response time increase | X ms |

### Service Impact

| Service | Impact | Duration |
|---------|--------|----------|
| API | Degraded | 45 min |
| Publishing | Delayed | 30 min |
| Notifications | Delayed | 30 min |
| Web App | Slow | 45 min |

### Business Impact

| Metric | Impact |
|--------|--------|
| Revenue impact | $X (if applicable) |
| Customer complaints | X tickets |
| SLA breach | Yes/No |

---

## Root Cause Analysis

### Problem Statement
Clear, specific description of what went wrong.

### Contributing Factors

1. **Primary Cause:**
   - Description
   - How it led to the incident

2. **Contributing Factor 1:**
   - Description
   - Impact on the incident

3. **Contributing Factor 2:**
   - Description
   - Impact on the incident

### 5 Whys Analysis

1. **Why** did the service fail?
   - Answer

2. **Why** [answer from 1]?
   - Answer

3. **Why** [answer from 2]?
   - Answer

4. **Why** [answer from 3]?
   - Answer

5. **Why** [answer from 4]?
   - Root cause

### Technical Details

```
Include relevant:
- Error messages
- Stack traces
- Log excerpts
- Metrics/graphs
- Configuration details
```

---

## What Went Well

List things that worked during the incident response:

1. Detection was fast - alert fired within 2 minutes
2. Runbook was accurate and up-to-date
3. Communication was clear in Slack channel
4. Database failover worked as expected

---

## What Went Wrong

List things that didn't work or could be improved:

1. Alert didn't page the right team initially
2. Logs were incomplete, making diagnosis harder
3. Rollback took longer than expected
4. Customer communication was delayed

---

## Lessons Learned

### Technical Lessons

1. **Lesson:** Description
   - **Context:** Why this matters
   - **Action:** What to do differently

2. **Lesson:** Description
   - **Context:** Why this matters
   - **Action:** What to do differently

### Process Lessons

1. **Lesson:** Description
   - **Context:** Why this matters
   - **Action:** What to do differently

2. **Lesson:** Description
   - **Context:** Why this matters
   - **Action:** What to do differently

---

## Action Items

### Immediate (This Week)

| ID | Action | Owner | Due Date | Status |
|----|--------|-------|----------|--------|
| A1 | Fix alerting threshold | @alice | YYYY-MM-DD | Open |
| A2 | Update runbook with new steps | @bob | YYYY-MM-DD | Open |

### Short-term (This Month)

| ID | Action | Owner | Due Date | Status |
|----|--------|-------|----------|--------|
| B1 | Implement connection pool monitoring | @carol | YYYY-MM-DD | Open |
| B2 | Add circuit breaker for database calls | @dave | YYYY-MM-DD | Open |

### Long-term (This Quarter)

| ID | Action | Owner | Due Date | Status |
|----|--------|-------|----------|--------|
| C1 | Refactor database connection handling | @team-db | YYYY-MM-DD | Open |
| C2 | Improve observability for connection metrics | @team-obs | YYYY-MM-DD | Open |

---

## Metrics and Monitoring

### Current State

| Metric | Before | During | After | Target |
|--------|--------|--------|-------|--------|
| Error rate | 0.1% | 15% | 0.1% | < 1% |
| Response time | 100ms | 500ms | 100ms | < 200ms |
| Availability | 99.99% | 95% | 99.99% | 99.99% |

### Monitoring Gaps Identified

1. **Gap:** Description
   - **Proposed Solution:** What to add
   - **Priority:** High/Medium/Low

2. **Gap:** Description
   - **Proposed Solution:** What to add
   - **Priority:** High/Medium/Low

---

## Communication Log

### Internal Communication

| Time | Channel | Message | Sender |
|------|---------|---------|--------|
| 00:10 | #incidents | Incident INC-123 declared | @oncall |
| 00:30 | #engineering | Update: root cause identified | @oncall |
| 00:45 | #incidents | Service restored | @oncall |

### External Communication

| Time | Channel | Message | Audience |
|------|---------|---------|----------|
| 01:00 | Status Page | Incident resolved | Public |
| 01:30 | Email | Post-incident summary | Affected customers |

---

## Resources and References

### Related Documentation
- [Runbook: Database Failover](../runbooks/database-failover.md)
- [Monitoring Dashboard](https://monitoring.smartbeak.io)
- [Related Incident: INC-2026-01-15-001](link)

### Data Sources
- [Metrics: Grafana](https://grafana.smartbeak.io)
- [Logs: Datadog](https://datadog.smartbeak.io)
- [Traces: Jaeger](https://jaeger.smartbeak.io)

---

## Appendix

### A. Raw Logs

```
Include relevant log excerpts
```

### B. Error Messages

```
Include full error messages and stack traces
```

### C. Configuration Changes

```
List any configuration changes made during or after the incident
```

### D. Screenshots

Include relevant screenshots:
- Monitoring dashboards during incident
- Error messages
- Metrics graphs

---

## Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Incident Commander | | | |
| Technical Lead | | | |
| Product Owner | | | |
| Engineering Manager | | | |

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | YYYY-MM-DD | Name | Initial post-mortem |
| 1.1 | YYYY-MM-DD | Name | Updated action items status |

---

## Notes

Additional notes, observations, or context not covered above.
