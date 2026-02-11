
# Alerting Contracts

## When to Alert

### Page (Human Wake-Up)
- Publishing backlog > threshold for 15 minutes
- DLQ growth > threshold
- Auth failures spike > 5x baseline

### Notify (Slack / Email)
- Publishing retries increasing
- Usage anomalies
- Region worker saturation

---

## When NOT to Alert
- Analytics lag
- Individual publishing failures with retries
- Single-region partial degradation
