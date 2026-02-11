# ADR-004: Barrel Exports for Clean Module Interfaces

## Status
Accepted

## Context
As the codebase grows, modules accumulate many exports. Consumers need to understand the public API of each module without knowing internal file structure.

Without barrel exports:
```typescript
// Consumer needs to know internal file structure
import { createUserId } from '@kernel/validation/branded';
import { isUUID } from '@kernel/validation/uuid';
import { ValidationError } from '@kernel/validation/types-base';
```

## Decision
Each package will expose a clean public API through barrel exports in `index.ts`:

```typescript
// Consumer uses clean public API
import { createUserId, isUUID, ValidationError } from '@kernel/validation';
```

## Structure
```
packages/kernel/validation/
├── index.ts      # Barrel exports - public API
├── branded.ts    # Internal implementation
├── uuid.ts       # Internal implementation
└── types.ts      # Internal implementation
```

## Consequences

### Positive
- **Clean imports**: Single import statement for related functionality
- **Refactoring freedom**: Can reorganize internals without breaking consumers
- **Clear public API**: Index.ts documents what's meant to be public
- **Tree-shaking**: Modern bundlers eliminate unused exports

### Negative
- **Potential for circular dependencies**: Need to be careful with imports
- **Discoverability**: IDEs may show less detail in autocomplete

## Implementation Guidelines

1. **Organize exports by category**:
```typescript
// Base Types (no dependencies)
export { ... } from './types-base';

// Branded Types
export type { ... } from './branded';
export { ... } from './branded';

// Schema Validation
export { ... } from './schemas';
```

2. **Document the public API**:
```typescript
/**
 * @example
 * ```typescript
 * import { createUserId } from '@kernel/validation';
 * const userId = createUserId('...');
 * ```
 */
```

3. **Avoid deep barrel chains**: Don't have index.ts export from another index.ts

## References
- [TypeScript: Module Resolution](https://www.typescriptlang.org/docs/handbook/module-resolution.html)
- [Barrel Pattern in TypeScript](https://basarat.gitbook.io/typescript/main-1/barrel)
