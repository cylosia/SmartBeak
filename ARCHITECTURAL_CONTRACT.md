
# Architectural Contract
- Control plane orchestrates; domains own data.
- One database per domain.
- Domain = unit of deletion/export.
- Plugins are internal, capability-limited.
- Events are versioned contracts.
- Plugins isolated; failures do not block domains.
