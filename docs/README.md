# SmartBeak Documentation

Welcome to the SmartBeak documentation. This repository contains comprehensive documentation for operating, developing, and maintaining the SmartBeak platform.

## Documentation Structure

```
docs/
├── README.md                    # This file
├── architecture/                # Architecture documentation
│   ├── system-architecture.md   # High-level system design
│   ├── data-flow.md            # Data flow documentation
│   └── integration-points.md   # Integration documentation
├── developers/                  # Developer guides
│   ├── local-development-setup.md
│   ├── testing-guide.md
│   └── contribution-guidelines.md
├── operations/                  # Operational documentation (existing)
│   ├── cache-invalidation.md
│   ├── checklists.md
│   ├── failure-drills.md
│   ├── postmortems.md
│   ├── rituals.md
│   └── storage-lifecycle.md
├── runbooks/                    # Operational runbooks
│   ├── database-failover.md
│   ├── redis-recovery.md
│   ├── payment-processing-issues.md
│   ├── security-incident-response.md
│   └── deployment-rollback.md
├── incident-response/           # Incident management
│   └── procedures.md
├── postmortems/                 # Post-mortem documentation
│   ├── template.md
│   └── process.md
├── reliability/                 # Reliability documentation (existing)
│   ├── alerting.md
│   ├── error-budgets.md
│   ├── runbooks/publishing.md
│   └── slo.md
└── security/                    # Security documentation (existing)
    ├── auth-audit.md
    └── threat-model.md
```

## Quick Links

### For Operators

- [Database Failover Runbook](./runbooks/database-failover.md) - Handle PostgreSQL failures
- [Redis Recovery Runbook](./runbooks/redis-recovery.md) - Handle Redis/cache issues
- [Payment Processing Issues](./runbooks/payment-processing-issues.md) - Fix payment problems
- [Security Incident Response](./runbooks/security-incident-response.md) - Respond to security incidents
- [Deployment Rollback](./runbooks/deployment-rollback.md) - Rollback failed deployments

### For Developers

- [Local Development Setup](./developers/local-development-setup.md) - Set up your dev environment
- [Testing Guide](./developers/testing-guide.md) - Testing practices and procedures
- [Contribution Guidelines](./developers/contribution-guidelines.md) - How to contribute

### For Architects

- [System Architecture](./architecture/system-architecture.md) - High-level system design
- [Data Flow](./architecture/data-flow.md) - Data flow documentation
- [Integration Points](./architecture/integration-points.md) - API and integration docs

### For Incident Response

- [Incident Procedures](./incident-response/procedures.md) - Incident response procedures
- [Post-Mortem Template](./postmortems/template.md) - Post-mortem documentation template
- [Post-Mortem Process](./postmortems/process.md) - Post-mortem process guide

## Documentation Standards

### Writing Style

- Be clear and concise
- Use specific examples
- Include command examples where applicable
- Use tables for structured information

### Formatting

- Use Markdown for all documentation
- Use code blocks for commands and code
- Use diagrams (ASCII or Mermaid) where helpful
- Include a table of contents for longer docs

### Maintenance

- Update docs when code changes
- Review docs quarterly
- Keep runbooks tested and current
- Archive outdated documentation

## Contributing to Documentation

See [Contribution Guidelines](./developers/contribution-guidelines.md) for how to contribute documentation updates.

## Support

- **Questions:** #docs Slack channel
- **Issues:** Create a GitHub issue
- **Suggestions:** Propose changes via PR

---

*Last updated: 2026-02-10*
