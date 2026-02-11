
# Runbook: Publishing Failures

## Symptoms
- Publishing jobs stuck in pending
- DLQ growing
- Users report delayed publishes

## Steps
1. Check DLQ entries
2. Inspect affected region
3. Validate publish target configs
4. Retry jobs if safe
5. If needed, disable target via admin UI

## Escalation
- If cross-region: escalate to infra
- If adapter-specific: isolate adapter
