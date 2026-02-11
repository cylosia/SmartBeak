# Adapter Synthetic Canaries

Canaries run periodically (cron / scheduler) to validate:
- credentials are valid
- provider APIs are reachable
- circuit breakers should remain closed

Metrics:
- canary_success{name}
- canary_failure{name}

Failures should be correlated with circuit breaker alerts.
