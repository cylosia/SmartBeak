# ADR-001: Use Branded Types for Type-Safe IDs

## Status
Accepted

## Context
The application uses UUID strings to identify various entities (users, organizations, content, domains, etc.). Without type safety measures, it's easy to accidentally mix up different ID types, leading to subtle bugs that are only caught at runtime.

For example:
```typescript
// Without branded types - error-prone
function getUser(userId: string, orgId: string) { ... }
getUser(orgId, userId); // Compiles fine, but wrong argument order!
```

## Decision
We will use TypeScript "branded types" to create nominal types from primitive strings. This provides compile-time guarantees that IDs are used correctly.

```typescript
// With branded types - type-safe
type UserId = string & { readonly __brand: 'UserId' };
type OrgId = string & { readonly __brand: 'OrgId' };

function getUser(userId: UserId, orgId: OrgId) { ... }
getUser(orgId, userId); // Type error: OrgId is not assignable to UserId
```

## Consequences

### Positive
- **Compile-time safety**: Cannot accidentally mix ID types
- **Self-documenting code**: Function signatures clearly show expected ID types
- **Zero runtime overhead**: Brands are compile-time only
- **Easy to adopt incrementally**: Can introduce branded types gradually

### Negative
- **Requires factory functions**: Need to use `createUserId()` instead of direct assignment
- **Slight learning curve**: Developers need to understand branded types
- **Database reads need casting**: When reading from DB, need to cast strings to branded types

## Implementation
All ID types are defined in `packages/kernel/validation/branded.ts` with:
- Type definitions (e.g., `UserId`, `OrgId`)
- Factory functions (e.g., `createUserId()`, `createOrgId()`)
- Type guards (e.g., `isUserId()`, `isOrgId()`)
- Unsafe cast functions for database reads (e.g., `unsafeAsUserId()`)

## References
- [TypeScript: Creating types from primitive types](https://www.typescriptlang.org/docs/handbook/2/types-from-types.html)
- [Nominal typing techniques in TypeScript](https://michalzalecki.com/nominal-typing-in-typescript/)
