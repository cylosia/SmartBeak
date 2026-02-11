
# Operational Rituals

These rituals keep the system healthy over time.
They are mandatory once in production.

---

## Weekly
- Review publishing DLQ
- Review usage anomalies
- Check error budget burn rates

## Monthly
- Restore a domain DB backup
- Rotate one secret (non-breaking)
- Review publishing adapter logs

## Quarterly
- Permission & role review
- Dependency vulnerability scan
- Cost vs. usage review

---

Failure to run rituals is a process bug.
