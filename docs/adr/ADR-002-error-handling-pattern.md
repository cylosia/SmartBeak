# ADR-002: Structured Error Handling with Error Codes

## Status
Accepted

## Context
The application needs consistent error handling across multiple layers:
- API routes need to return appropriate HTTP status codes
- Background jobs need to handle retries and failures
- Client code needs to understand what went wrong

Without a structured approach, errors are handled inconsistently, leading to:
- Information leakage in production
- Incorrect HTTP status codes
- Difficult debugging

## Decision
We will implement a structured error handling system with:

1. **Centralized error codes**: Standardized error codes as string constants
2. **Typed error classes**: Specific error classes extending a base `AppError`
3. **Error classification**: Automatic classification of errors (validation, auth, etc.)
4. **Sanitization**: Safe error responses that don't leak internal details

## Error Hierarchy
```
AppError (base)
├── ValidationError
├── AuthError
├── ForbiddenError
├── NotFoundError
├── DatabaseError
├── RateLimitError
├── ConflictError
└── ServiceUnavailableError
```

## Error Response Format
```typescript
interface ErrorResponse {
  error: string;      // Human-readable message
  code: string;       // Machine-readable code
  details?: unknown;  // Additional context (dev only)
  requestId?: string; // For tracing
}
```

## Consequences

### Positive
- **Consistent API responses**: All errors follow the same structure
- **Type-safe error handling**: Switch on error codes exhaustively
- **Security**: Automatic sanitization prevents info leakage
- **Debuggability**: Request IDs enable tracing across services

### Negative
- **More boilerplate**: Need to create specific error instances
- **Learning curve**: Developers need to understand error hierarchy

## Implementation
- Error codes: `packages/errors/index.ts`
- Validation errors: `packages/kernel/validation/types-base.ts`
- Error helpers: `packages/kernel/validation/errorHelpers.ts`
