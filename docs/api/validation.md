# Validation API Documentation

The `@kernel/validation` package provides comprehensive type validation utilities including branded types, type guards, and exhaustiveness checking.

## Table of Contents

- [Branded Types](#branded-types)
- [Type Guards](#type-guards)
- [Exhaustiveness Checking](#exhaustiveness-checking)
- [Result Type](#result-type)
- [Error Handling](#error-handling)

## Branded Types

Branded types provide compile-time type safety for ID strings.

### Creating Branded IDs

```typescript
import { createUserId, createOrgId, createContentId } from '@kernel/validation';

// Valid UUID - creates branded type
const userId = createUserId('123e4567-e89b-12d3-a456-426614174000');
// type: UserId

// Invalid UUID - throws ValidationError
createUserId('invalid-id'); 
// throws: ValidationError: Invalid UserId format: invalid-id. Expected valid UUID.
```

### Available Branded Types

| Type | Factory Function | Type Guard |
|------|-----------------|------------|
| `UserId` | `createUserId(id)` | `isUserId(value)` |
| `OrgId` | `createOrgId(id)` | `isOrgId(value)` |
| `ContentId` | `createContentId(id)` | `isContentId(value)` |
| `DomainId` | `createDomainId(id)` | `isDomainId(value)` |
| `CustomerId` | `createCustomerId(id)` | `isCustomerId(value)` |
| `InvoiceId` | `createInvoiceId(id)` | `isInvoiceId(value)` |
| `PaymentId` | `createPaymentId(id)` | `isPaymentId(value)` |
| `PublishingJobId` | `createPublishingJobId(id)` | - |
| `NotificationId` | `createNotificationId(id)` | - |
| `MediaAssetId` | `createMediaAssetId(id)` | - |
| `SearchIndexId` | `createSearchIndexId(id)` | - |
| `IndexingJobId` | `createIndexingJobId(id)` | - |
| `AuthorId` | `createAuthorId(id)` | - |
| `RevisionId` | `createRevisionId(id)` | - |
| `CommentId` | `createCommentId(id)` | - |
| `WebhookId` | `createWebhookId(id)` | - |
| `ApiKeyId` | `createApiKeyId(id)` | - |
| `AuditEventId` | `createAuditEventId(id)` | - |

### Type Safety Benefits

```typescript
import type { UserId, OrgId } from '@kernel/validation';

function getUser(userId: UserId, orgId: OrgId) {
  // Implementation
}

const userId = createUserId('...');
const orgId = createOrgId('...');

getUser(userId, orgId);     // ✓ OK
getUser(orgId, userId);     // ✗ Type Error: OrgId not assignable to UserId
```

### Unsafe Casting (Database Reads)

When reading from the database where UUID format is already validated:

```typescript
import { unsafeAsUserId } from '@kernel/validation';

// Database returns plain string
const userRow = await db.query('SELECT id FROM users WHERE ...');
const userId = unsafeAsUserId(userRow.id); // Cast to branded type
```

## Type Guards

### Primitive Guards

```typescript
import { 
  isNonEmptyString, 
  isUUID, 
  isPositiveInteger,
  isNonNegativeInteger 
} from '@kernel/validation';

isNonEmptyString('hello');     // true
isNonEmptyString('');          // false
isNonEmptyString(null);        // false

isUUID('123e4567-e89b-12d3-a456-426614174000');  // true
isUUID('invalid');                                 // false

isPositiveInteger(42);    // true
isPositiveInteger(-1);    // false
isPositiveInteger(0);     // false

isNonNegativeInteger(0);  // true
isNonNegativeInteger(42); // true
isNonNegativeInteger(-1); // false
```

### ID Type Guards

```typescript
import { isUserId, isOrgId, isContentId } from '@kernel/validation';

const value: unknown = fetchSomeId();

if (isUserId(value)) {
  // value is typed as UserId
  await getUser(value);
}
```

## Exhaustiveness Checking

### assertNever

Ensures switch statements handle all cases:

```typescript
import { assertNever } from '@kernel/validation';

type Status = 'pending' | 'active' | 'completed';

function getStatusColor(status: Status): string {
  switch (status) {
    case 'pending':   return 'yellow';
    case 'active':    return 'green';
    case 'completed': return 'blue';
    default: return assertNever(status);
    //    ^ Compile error if any case is missing
  }
}
```

### handleExhaustive

Graceful handling of exhaustive checks:

```typescript
import { handleExhaustive } from '@kernel/validation';

function getStatusLabel(status: Status): string {
  switch (status) {
    case 'pending':   return 'Waiting...';
    case 'active':    return 'Running';
    case 'completed': return 'Done';
    default: return handleExhaustive(status, 'Unknown');
    // Returns 'Unknown' if somehow reached
  }
}
```

## Result Type

The `Result<T, E>` type provides a safe way to handle operations that can fail without throwing exceptions.

### Creating Results

```typescript
import { ok, err, type Result } from '@kernel/validation';

function parsePositiveInt(str: string): Result<number, string> {
  const num = parseInt(str, 10);
  if (isNaN(num) || num <= 0) {
    return err('Not a positive integer');
  }
  return ok(num);
}
```

### Working with Results

```typescript
import { unwrap, mapResult, flatMapResult } from '@kernel/validation';

const result = parsePositiveInt('42');

// Unwrap (throws on error)
const value = unwrap(result); // 42

// Map values
const doubled = mapResult(result, n => n * 2); // ok(84)

// Chain operations
const chained = flatMapResult(result, n => 
  n > 100 ? err('Too large') : ok(n)
);
```

### Pattern Matching

```typescript
const result = parsePositiveInt('42');

if (result.ok) {
  console.log('Success:', result.value);
} else {
  console.log('Error:', result.error);
}
```

## Error Handling

### ValidationError

```typescript
import { ValidationError, ErrorCodes } from '@kernel/validation';

const error = new ValidationError(
  'Invalid email format',
  'email',
  ErrorCodes.INVALID_FORMAT
);

console.log(error.message);  // "Invalid email format"
console.log(error.field);    // "email"
console.log(error.code);     // "INVALID_FORMAT"

// Serialize for API response
const json = error.toJSON();
// { message: "Invalid email format", code: "INVALID_FORMAT", field: "email" }
```

### Error Context

```typescript
import { createErrorContext } from '@kernel/validation';

const context = createErrorContext(
  'createUser',
  'UserService',
  { userId: '123', attempt: 3 }
);
// {
//   operation: 'createUser',
//   component: 'UserService',
//   metadata: { userId: '123', attempt: 3 },
//   timestamp: Date
// }
```

### Error Classification

```typescript
import { classifyError, getHttpStatusForErrorClass } from '@kernel/validation';

const errorClass = classifyError(error);
// 'validation' | 'authentication' | 'authorization' | 
// 'not_found' | 'conflict' | 'rate_limit' | 
// 'service_unavailable' | 'internal' | 'network' | 'unknown'

const statusCode = getHttpStatusForErrorClass(errorClass);
// 400, 401, 403, 404, 409, 429, 503, or 500
```

## Best Practices

1. **Always use branded types for IDs** in function signatures
2. **Use factory functions** (`createUserId`) for new IDs
3. **Use unsafe casts** (`unsafeAsUserId`) only for database reads
4. **Add exhaustiveness checks** to all switch statements on union types
5. **Return Result types** for operations that can reasonably fail
6. **Include error context** when logging or reporting errors
