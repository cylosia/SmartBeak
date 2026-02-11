# ADR-003: Exhaustiveness Checking for Switch Statements

## Status
Accepted

## Context
TypeScript's type system can ensure that switch statements handle all possible cases of a union type. When a new case is added to a union, we want the compiler to flag all switch statements that need updating.

Without exhaustiveness checking:
```typescript
type Status = 'pending' | 'active' | 'completed';

function getStatusText(status: Status): string {
  switch (status) {
    case 'pending': return 'Waiting...';
    case 'active': return 'Running';
    // Forgot 'completed' - no compiler error!
  }
}
```

## Decision
We will use the `assertNever` pattern for exhaustiveness checking:

```typescript
import { assertNever } from '@kernel/validation';

function getStatusText(status: Status): string {
  switch (status) {
    case 'pending': return 'Waiting...';
    case 'active': return 'Running';
    case 'completed': return 'Done';
    default: assertNever(status); // Compile error if case missing!
  }
}
```

When a new status is added:
```typescript
type Status = 'pending' | 'active' | 'completed' | 'failed';
// Compiler error: Argument of type 'string' is not assignable to parameter of type 'never'
```

## Consequences

### Positive
- **Compile-time safety**: Cannot forget to handle new cases
- **Refactoring support**: Adding variants forces updating all switches
- **Self-documenting**: Makes it clear that all cases should be handled

### Negative
- **Slight verbosity**: Need to include default case
- **Runtime check**: `assertNever` throws at runtime if reached

## Implementation
```typescript
export function assertNever(value: never, message?: string): never {
  throw new Error(message || `Unhandled case: ${String(value)}`);
}
```

## Usage Guidelines
1. Always use `assertNever` in the default case of exhaustive switches
2. Prefer switch statements over if/else chains for union types
3. Document when a switch is intentionally non-exhaustive

## References
- [TypeScript: Exhaustiveness checking](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking)
