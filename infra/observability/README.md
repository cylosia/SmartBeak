# Observability: Circuit Breakers

## Metrics
- circuit_failure{name}
- circuit_open{name}
- circuit_open_block{name}
- circuit_closed{name}

## Alerts
- CircuitBreakerOpenTooLong:
  Fires when a circuit breaker remains open for more than 5 minutes.

## Operator Actions
1. Check adapter credentials (Vault)
2. Check provider status (GA/GSC/FB/Vercel)
3. Retry after provider recovery
