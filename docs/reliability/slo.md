
# Service Level Objectives (SLOs)

## Scope
These SLOs define **what we promise** and **what we do not**.
They are intentionally conservative and enforceable.

---

## Core SLOs

### Content Creation
- **SLO**: 99.9% successful requests over 30 days
- **Scope**: create draft, update draft
- **Notes**: synchronous, strongly consistent

### Content Publishing
- **SLO**: 99.5% publishing jobs succeed within 15 minutes
- **Scope**: publishing jobs per target
- **Notes**: async, at-least-once delivery

### Scheduling
- **SLO**: 99.5% scheduled publishes execute within ±2 minutes
- **Scope**: scheduler job execution

### Analytics
- **SLO**: Best effort
- **Scope**: analytics read models
- **Notes**: lag and loss acceptable

---

## Explicit Non-Goals
- No global strong consistency guarantees
- No zero-latency publishing promise
- No analytics accuracy guarantees under failure
