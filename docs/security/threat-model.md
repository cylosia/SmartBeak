
# Threat Model (Phase 5.3)

## Assets
- Content data
- Publishing targets & credentials
- Domain ownership
- Billing & usage data

## Primary Threats
- SSRF via publishing adapters
- Privilege escalation (org/domain mismatch)
- Secret leakage
- Replay or abuse of publishing retries
- Cross-org data access

## Mitigations
- Strict adapter input validation
- No outbound network calls without allowlist
- Domain ownership enforced in control plane
- Secrets never stored in domain DBs
- Idempotent publishing jobs
