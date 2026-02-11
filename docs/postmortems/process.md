# Post-Mortem Process

## Overview

This document defines the post-mortem process for SmartBeak, ensuring we learn from incidents and continuously improve our systems and processes.

## When to Write a Post-Mortem

A post-mortem is required for:

| Severity | When Required | Timeline |
|----------|---------------|----------|
| SEV-1 (Critical) | Always | Within 24 hours |
| SEV-2 (High) | Always | Within 48 hours |
| SEV-3 (Medium) | If SLO breached or data affected | Within 1 week |
| SEV-4 (Low) | Optional | N/A |

### Additional Triggers

- Any customer-visible outage > 5 minutes
- Data loss or corruption
- Security incident
- Cascading failure affecting multiple services
- Manual intervention required to restore service

## Post-Mortem Principles

### 1. Blameless Culture

- Focus on system failures, not individual mistakes
- Assume everyone did their best with the information they had
- Ask "how" and "what", not "who" and "why"
- Avoid naming individuals in a negative context

### 2. Learning Oriented

- The goal is to learn and improve
- Every incident is an opportunity
- Share findings widely
- Implement preventive measures

### 3. Specific and Actionable

- Include specific timelines
- Provide concrete action items
- Assign clear owners
- Set realistic deadlines

## The Post-Mortem Process

### Phase 1: Immediate (During Incident)

#### 1.1 Document Timeline

In real-time or as soon as possible, document:
- Detection time
- Key events during response
- Actions taken
- Communications sent

**Tools:**
- Incident Slack channel
- Shared document
- Voice recording (if appropriate)

#### 1.2 Preserve Evidence

Before systems return to normal:
```bash
# Save logs
tar -czf incident-$(date +%Y%m%d)-logs.tar.gz /var/log/smartbeak/

# Capture metrics screenshots
# Save database snapshots
# Export monitoring data
```

#### 1.3 Identify Immediate Actions

Note any immediate fixes or workarounds that need to be:
- Applied immediately
- Implemented within 24 hours
- Tracked for completion

### Phase 2: Draft (0-24 hours for SEV-1)

#### 2.1 Schedule Post-Mortem Meeting

- Schedule within 24 hours for SEV-1
- Schedule within 48 hours for SEV-2
- Include key responders and stakeholders
- Optional for SEV-3

#### 2.2 Create Draft Document

Using the [post-mortem template](./template.md):

1. **Fill in metadata**
2. **Complete timeline** (use chat logs, commit times, etc.)
3. **Document impact** (metrics, affected users)
4. **Draft root cause analysis**
5. **List what went well/wrong**

#### 2.3 Gather Data

| Data Source | What to Collect | Owner |
|-------------|-----------------|-------|
| Monitoring | Metrics, graphs, alert history | On-call |
| Logs | Error logs, application logs | Engineering |
| Traces | Request traces, span data | Engineering |
| Communications | Slack logs, emails, status updates | Incident Commander |
| Customer Reports | Support tickets, user feedback | Support |

### Phase 3: Meeting (24-48 hours)

#### 3.1 Pre-Meeting Preparation

Attendees should:
- Review the draft document
- Come with questions
- Think about improvements

#### 3.2 Meeting Agenda (60 minutes)

| Time | Topic | Owner |
|------|-------|-------|
| 5 min | Introduction and context | Facilitator |
| 10 min | Timeline review | Incident Commander |
| 10 min | Impact assessment | Product/Engineering |
| 15 min | Root cause analysis | Technical Lead |
| 10 min | What went well/wrong | All |
| 5 min | Action items draft | Facilitator |
| 5 min | Wrap-up and next steps | Facilitator |

#### 3.3 Meeting Guidelines

**Do:**
- Stick to the timeline
- Focus on facts
- Encourage participation
- Document action items

**Don't:**
- Assign blame
- Get stuck on minor details
- Skip the "what went well" section
- Rush to solutions

### Phase 4: Finalize (24-48 hours after meeting)

#### 4.1 Update Document

- Incorporate meeting feedback
- Finalize action items
- Assign owners and due dates
- Add any missing details

#### 4.2 Review and Approve

Reviewers:
- [ ] Incident Commander
- [ ] Technical Lead
- [ ] Engineering Manager
- [ ] Product Owner (if user-facing)

#### 4.3 Distribute

Share with:
- Engineering team
- Leadership (SEV-1, SEV-2)
- Affected teams
- Wider company (optional, for learning)

### Phase 5: Follow-Up (Ongoing)

#### 5.1 Track Action Items

Weekly review of action item status:

```
Post-Mortem Action Items Review
Date: YYYY-MM-DD

Open Items:
- [ ] A1: Fix alerting (Due: YYYY-MM-DD, Owner: @alice)
- [ ] A2: Update runbook (Due: YYYY-MM-DD, Owner: @bob)

Completed:
- [x] A3: Add monitoring (Completed: YYYY-MM-DD)
```

#### 5.2 Verify Effectiveness

After implementing fixes:
- Did we prevent similar incidents?
- Did monitoring improvements help?
- Are runbooks more accurate?

#### 5.3 Update Documentation

- Update relevant runbooks
- Update architecture documentation
- Update onboarding/training materials

## Action Item Tracking

### Priority Levels

| Priority | Timeline | Examples |
|----------|----------|----------|
| P0 | 24 hours | Critical security fix, data loss prevention |
| P1 | 1 week | Monitoring gaps, alerting improvements |
| P2 | 1 month | Process improvements, tooling updates |
| P3 | 1 quarter | Architecture improvements, refactoring |

### Tracking Process

1. **Create tickets** for all action items in project management tool
2. **Label** with `postmortem` and incident ID
3. **Review** in weekly engineering meetings
4. **Escalate** if items are at risk of missing deadlines

### Closure Criteria

An action item is complete when:
- [ ] Code/fix is deployed
- [ ] Documentation is updated
- [ ] Team has been notified
- [ ] Effectiveness has been verified (if applicable)

## Post-Mortem Review

### Monthly Review

Monthly meeting to review:
- All post-mortems from the month
- Common patterns
- Action item completion rates
- Process improvements needed

### Quarterly Review

Quarterly analysis:
- MTTR (Mean Time To Recovery) trends
- Incident frequency by service
- Action item completion rates
- System reliability improvements

### Annual Review

Year-end summary:
- Major incidents summary
- Lessons learned across all incidents
- Process improvements implemented
- Goals for next year

## Communication

### Internal Communication

| Audience | When | Method |
|----------|------|--------|
| Engineering team | After each post-mortem | Slack + Email |
| Leadership | SEV-1, SEV-2 | Email summary |
| All staff | Monthly | Newsletter section |
| New hires | Onboarding | Training session |

### External Communication

| Scenario | Communication | Channel |
|----------|---------------|---------|
| Customer-affecting incident | Post-incident summary | Email to affected customers |
| Major outage | Blog post | Company blog |
| Ongoing pattern | Transparency report | Quarterly report |

## Tools and Resources

### Documentation
- [Post-Mortem Template](./template.md)
- [Incident Tracking](https://incidents.smartbeak.io)
- [Action Item Dashboard](https://actions.smartbeak.io)

### Communication
- #incidents Slack channel
- #postmortems Slack channel
- Email: postmortems@smartbeak.io

### Storage
- Post-mortems stored in: `docs/postmortems/`
- Naming: `INC-YYYY-MM-DD-NNN.md`
- Archive: incidents.smartbeak.io

## Best Practices

### For Incident Commanders

1. **Start early** - Begin drafting during the incident
2. **Be thorough** - Include all relevant details
3. **Be specific** - Avoid vague statements
4. **Follow up** - Ensure action items are completed

### For Attendees

1. **Come prepared** - Review the draft beforehand
2. **Be constructive** - Focus on improvement
3. **Be respectful** - Remember blameless culture
4. **Participate** - Share your perspective

### For Authors

1. **Use the template** - Ensures consistency
2. **Include metrics** - Quantify impact when possible
3. **Be honest** - Don't hide uncomfortable facts
4. **Update status** - Keep action items current

## Metrics and Goals

### Target Metrics

| Metric | Target |
|--------|--------|
| Post-mortem completion rate | 100% for SEV-1/2 |
| Post-mortem timeliness | Within 48 hours |
| Action item completion rate | > 90% within deadline |
| Mean time between repeat incidents | Increasing |

### Continuous Improvement

We regularly review and improve this process based on:
- Feedback from participants
- Completion metrics
- Incident trends
- Industry best practices

## Related Documentation

- [Post-Mortem Template](./template.md)
- [Incident Response Procedures](../incident-response/)
- [Operational Runbooks](../runbooks/)
- [Security Incident Response](../runbooks/security-incident-response.md)

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-10 | Engineering | Initial process documentation |

---

*This document is a living document. Please suggest improvements via pull request or discuss in #postmortems.*
