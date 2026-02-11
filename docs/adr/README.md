# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records (ADRs) that document significant architectural decisions made in this project.

## What is an ADR?

An Architecture Decision Record (ADR) captures an important architectural decision made along with its context and consequences. ADRs help teams:

- Understand why decisions were made
- Onboard new team members faster
- Revisit decisions when context changes
- Avoid repeating past mistakes

## ADR Format

Each ADR follows this structure:

1. **Title**: ADR-XXX: Title
2. **Status**: Proposed | Accepted | Deprecated | Superseded by ADR-XXX
3. **Context**: What is the issue that we're seeing that is motivating this decision?
4. **Decision**: What is the change that we're proposing or have agreed to implement?
5. **Consequences**: What becomes easier or more difficult to do because of this change?

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-001](ADR-001-branded-types.md) | Use Branded Types for Type-Safe IDs | Accepted |
| [ADR-002](ADR-002-error-handling-pattern.md) | Structured Error Handling with Error Codes | Accepted |
| [ADR-003](ADR-003-exhaustiveness-checking.md) | Exhaustiveness Checking for Switch Statements | Accepted |
| [ADR-004](ADR-004-barrel-exports.md) | Barrel Exports for Clean Module Interfaces | Accepted |

## Contributing

When proposing a new ADR:

1. Create a new file following the naming convention: `ADR-XXX-short-title.md`
2. Use the template below
3. Submit for review via pull request
4. Update this README with the new ADR

## ADR Template

```markdown
# ADR-XXX: Title

## Status
Proposed

## Context
What is the issue that we're seeing that is motivating this decision?

## Decision
What is the change that we're proposing or have agreed to implement?

## Consequences

### Positive
- Benefit 1
- Benefit 2

### Negative
- Drawback 1
- Drawback 2

## Implementation
Where and how is this decision implemented?

## References
- Link 1
- Link 2
```
